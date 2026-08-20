'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/authorize');
const { getDb } = require('../config/db');
const { nbi } = require('../config/genieacs');

const router = express.Router();
const FIRMWARES_DIR = path.join(__dirname, '../../data/firmwares');

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '../../data/uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (_req, file, cb) => {
    const allowedExt = ['.bin', '.img', '.zip', '.tar', '.gz'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// Ensure firmwares directory exists
if (!fs.existsSync(FIRMWARES_DIR)) {
  fs.mkdirSync(FIRMWARES_DIR, { recursive: true });
}

// Initialize firmwares and rules tables
function initTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS firmwares (
      id TEXT PRIMARY KEY,
      oui TEXT NOT NULL,
      modelo TEXT NOT NULL,
      version TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(oui, modelo, version)
    );

    CREATE TABLE IF NOT EXISTS firmware_rules (
      id TEXT PRIMARY KEY,
      vendor TEXT NOT NULL,
      model TEXT NOT NULL,
      hw_version TEXT NOT NULL,
      sw_version TEXT NOT NULL,
      firmware_id TEXT NOT NULL,
      firmware_file TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      FOREIGN KEY (firmware_id) REFERENCES firmwares(id) ON DELETE CASCADE
    );
  `);
}

initTable();

// Normaliza un parámetro TR-069 a string: puede venir como
// {_value, _type}, como valor crudo o no venir.
function paramValue(param) {
  if (param == null) return '';
  if (typeof param === 'object') return String(param._value ?? '');
  return String(param);
}

// GET /api/firmwares - List all firmwares
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, oui, modelo, version, file_name, file_size, created_at
      FROM firmwares
      ORDER BY created_at DESC
    `);
    const firmwares = stmt.all();
    res.json(firmwares);
  } catch (err) {
    console.error('[Firmwares] Error listing:', err);
    res.status(500).json({ error: 'Error al obtener firmwares' });
  }
});

// GET /api/firmwares/inventory - Device inventory grouped by vendor/model/versions
router.get('/inventory/list', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Get all devices from GenieACS with optimized projection
    const projection = JSON.stringify({
      '_deviceId': 1,
      'InternetGatewayDevice.DeviceInfo.Manufacturer': 1,
      'InternetGatewayDevice.DeviceInfo.ModelName': 1,
      'InternetGatewayDevice.DeviceInfo.HardwareVersion': 1,
      'InternetGatewayDevice.DeviceInfo.SoftwareVersion': 1
    });

    const response = await nbi.get('/devices/', {
      params: {
        limit: 100000,
        projection
      }
    });

    const devices = response.data || [];

    // Debug: log first device structure
    if (devices.length > 0) {
      console.log('[Inventory] First device structure:', JSON.stringify(devices[0], null, 2));
    }

    // Group devices by vendor, model, hw version, sw version
    const inventory = {};
    devices.forEach(device => {
      // Extract values - handle both object and value cases
      const deviceInfo = device?.InternetGatewayDevice?.DeviceInfo || {};
      // Fallback: algunos CPEs (p.ej. Zhone ZNID) no reportan
      // DeviceInfo.Manufacturer/ModelName; el header DeviceId del SOAP
      // (persistido por GenieACS en _deviceId) siempre los trae.
      const deviceIdMeta = device?._deviceId || {};

      // Values might be objects with _value property
      const vendor = paramValue(deviceInfo.Manufacturer) || deviceIdMeta._Manufacturer || 'Desconocido';
      const model = paramValue(deviceInfo.ModelName) || deviceIdMeta._ProductClass || 'Desconocido';
      const hwVersion = paramValue(deviceInfo.HardwareVersion) || 'Desconocido';
      const swVersion = paramValue(deviceInfo.SoftwareVersion) || 'Desconocido';

      const key = `${vendor}|${model}|${hwVersion}|${swVersion}`;

      if (!inventory[key]) {
        inventory[key] = {
          vendor,
          model,
          hwVersion,
          swVersion,
          count: 0
        };
      }
      inventory[key].count++;
    });

    // Convert to array and sort
    const inventoryArray = Object.values(inventory)
      .sort((a, b) => {
        if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
        if (a.model !== b.model) return a.model.localeCompare(b.model);
        if (a.hwVersion !== b.hwVersion) return a.hwVersion.localeCompare(b.hwVersion);
        return a.swVersion.localeCompare(b.swVersion);
      });

    // Paginate
    const total = inventoryArray.length;
    const paginatedData = inventoryArray.slice(offset, offset + limit);

    res.json({
      data: paginatedData,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('[Firmwares] Error listing inventory:', err);
    res.status(500).json({ error: 'Error al obtener inventario de dispositivos' });
  }
});

// POST /api/firmwares/upload - Upload firmware from file
router.post('/upload', authenticate, requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    // Handle multer errors
    if (err) {
      console.error('[Firmwares] Multer error:', err);
      return res.status(400).json({ error: err.message || 'Error al procesar archivo' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se proporciono archivo' });
    }

    const { oui, modelo, version } = req.body;

    // Validate inputs
    if (!modelo || !version) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Modelo y versión son requeridos' });
    }

    // Validate OUI format only if provided (hex, 12 chars)
    if (oui && !/^[0-9A-Fa-f]{12}$/i.test(oui.replace(/[:\-]/g, ''))) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'OUI inválido. Debe ser 12 caracteres hexadecimales' });
    }

    try {
      const db = getDb();
      const id = require('crypto').randomUUID();
      const ext = path.extname(req.file.originalname);
      const fileName = `${id}${ext}`;
      const filePath = path.join(FIRMWARES_DIR, fileName);

      // Move file to firmwares directory
      fs.renameSync(req.file.path, filePath);
      const fileSize = fs.statSync(filePath).size;

      // Store in database
      const stmt = db.prepare(`
        INSERT INTO firmwares (id, oui, modelo, version, file_name, file_path, file_size, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        oui ? oui.toUpperCase() : '',
        modelo,
        version,
        req.file.originalname,
        filePath,
        fileSize,
        new Date().toISOString(),
        req.user.id
      );

      // Audit log
      const auditStmt = db.prepare(`
        INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      auditStmt.run(
        req.user.id,
        req.user.username,
        'Subio firmware',
        req.file.originalname,
        req.ip,
        new Date().toISOString()
      );

      res.json({ id, message: 'Firmware guardado correctamente' });
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error('[Firmwares] Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });
});

// POST /api/firmwares/upload-url - Download and upload firmware from URL
router.post('/upload-url', authenticate, requireAdmin, async (req, res) => {
  const { oui, modelo, version, url } = req.body;

  // Validate inputs
  if (!modelo || !version || !url) {
    return res.status(400).json({ error: 'Modelo, versión y URL son requeridos' });
  }

  // Validate OUI format only if provided
  if (oui && !/^[0-9A-Fa-f]{12}$/i.test(oui.replace(/[:\-]/g, ''))) {
    return res.status(400).json({ error: 'OUI inválido' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch (err) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  try {
    const db = getDb();
    // Download file
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 500 * 1024 * 1024, // 500MB, igual que upload por archivo
      maxBodyLength: 500 * 1024 * 1024
    });

    const fileBuffer = Buffer.from(response.data);
    const id = require('crypto').randomUUID();

    // Extract original filename from URL
    const urlPath = new URL(url).pathname;
    let originalFileName = path.basename(urlPath);

    // If no filename in URL, generate one
    if (!originalFileName || originalFileName.includes('?') || originalFileName === '') {
      const ext = path.extname(urlPath) || '.bin';
      originalFileName = `firmware${ext}`;
    }

    // For physical storage, use UUID to avoid collisions
    const ext = path.extname(originalFileName);
    const fileStorageName = `${id}${ext}`;
    const filePath = path.join(FIRMWARES_DIR, fileStorageName);

    // Write file
    fs.writeFileSync(filePath, fileBuffer);
    const fileSize = fileBuffer.length;

    // Store in database
    const stmt = db.prepare(`
      INSERT INTO firmwares (id, oui, modelo, version, file_name, file_path, file_size, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      oui ? oui.toUpperCase() : '',
      modelo,
      version,
      originalFileName,
      filePath,
      fileSize,
      new Date().toISOString(),
      req.user.id
    );

    // Audit log
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Descargo firmware desde URL',
      originalFileName,
      req.ip,
      new Date().toISOString()
    );

    res.json({ id, message: 'Firmware guardado correctamente' });
  } catch (err) {
    console.error('[Firmwares] URL upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/firmwares/:id - Delete firmware
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const db = getDb();
    const stmt = db.prepare('SELECT file_path, oui, modelo, version FROM firmwares WHERE id = ?');
    const firmware = stmt.get(id);

    if (!firmware) {
      return res.status(404).json({ error: 'Firmware no encontrado' });
    }

    // Delete file
    if (fs.existsSync(firmware.file_path)) {
      fs.unlinkSync(firmware.file_path);
    }

    // Delete from database
    const deleteStmt = db.prepare('DELETE FROM firmwares WHERE id = ?');
    deleteStmt.run(id);

    // Audit log
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Elimino firmware',
      firmware.file_name,
      req.ip,
      new Date().toISOString()
    );

    res.json({ message: 'Firmware eliminado correctamente' });
  } catch (err) {
    console.error('[Firmwares] Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/firmwares/rules/list - List firmware rules
router.get('/rules/list', authenticate, (req, res) => {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, vendor, model, hw_version, sw_version, firmware_file, status, created_at
      FROM firmware_rules
      ORDER BY created_at DESC
    `);
    const rules = stmt.all();
    res.json(rules);
  } catch (err) {
    console.error('[Rules] Error listing:', err);
    res.status(500).json({ error: 'Error al obtener reglas' });
  }
});

// POST /api/firmwares/rules - Create firmware rule
router.post('/rules', authenticate, requireAdmin, (req, res) => {
  const { vendor, model, hwVersion, swVersion, firmwareId, firmwareFile } = req.body;

  if (!vendor || !model || !hwVersion || !swVersion || !firmwareId || !firmwareFile) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }

  try {
    const db = getDb();
    const id = require('crypto').randomUUID();

    const stmt = db.prepare(`
      INSERT INTO firmware_rules (id, vendor, model, hw_version, sw_version, firmware_id, firmware_file, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    stmt.run(
      id,
      vendor,
      model,
      hwVersion,
      swVersion,
      firmwareId,
      firmwareFile,
      new Date().toISOString(),
      req.user.id
    );

    // Audit log
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Creo regla de firmware',
      `${vendor}/${model}`,
      req.ip,
      new Date().toISOString()
    );

    res.json({ id, message: 'Regla creada correctamente' });
  } catch (err) {
    console.error('[Rules] Create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/firmwares/rules/compatible - Get compatible firmwares for a device
router.get('/rules/compatible', authenticate, (req, res) => {
  const { vendor, model } = req.query;

  if (!vendor || !model) {
    return res.status(400).json({ error: 'vendor y model son requeridos' });
  }

  try {
    const db = getDb();
    // Extract OUI from vendor (if it's a full vendor name, we need to map it)
    // For now, just search by modelo
    const stmt = db.prepare(`
      SELECT id, oui, modelo, version, file_name, file_size
      FROM firmwares
      WHERE modelo = ?
      ORDER BY created_at DESC
    `);
    const firmwares = stmt.all(model);
    res.json(firmwares);
  } catch (err) {
    console.error('[Rules] Compatible error:', err);
    res.status(500).json({ error: 'Error al obtener firmwares compatibles' });
  }
});

// PATCH /api/firmwares/rules/:id - Update firmware rule
router.patch('/rules/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { firmwareId, firmwareFile } = req.body;

  if (!firmwareId || !firmwareFile) {
    return res.status(400).json({ error: 'firmwareId y firmwareFile son requeridos' });
  }

  try {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE firmware_rules
      SET firmware_id = ?, firmware_file = ?
      WHERE id = ?
    `);
    stmt.run(firmwareId, firmwareFile, id);

    // Audit log
    const rule = db.prepare('SELECT vendor, model FROM firmware_rules WHERE id = ?').get(id);
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Actualizo regla de firmware',
      rule ? `${rule.vendor}/${rule.model}` : id,
      req.ip,
      new Date().toISOString()
    );

    res.json({ message: 'Regla actualizada correctamente' });
  } catch (err) {
    console.error('[Rules] Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/firmwares/rules/:id/activate - Activate rule (pending -> active)
router.patch('/rules/:id/activate', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const db = getDb();
    const getStmt = db.prepare('SELECT status FROM firmware_rules WHERE id = ?');
    const rule = getStmt.get(id);

    if (!rule) {
      return res.status(404).json({ error: 'Regla no encontrada' });
    }

    if (rule.status !== 'pending') {
      return res.status(400).json({ error: 'Solo se pueden activar reglas en estado Pendiente' });
    }

    const updateStmt = db.prepare('UPDATE firmware_rules SET status = ? WHERE id = ?');
    updateStmt.run('active', id);

    // Audit log
    const auditRuleData = db.prepare('SELECT vendor, model FROM firmware_rules WHERE id = ?').get(id);
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Activó regla de firmware',
      auditRuleData ? `${auditRuleData.vendor}/${auditRuleData.model}` : id,
      req.ip,
      new Date().toISOString()
    );

    res.json({ message: 'Regla activada correctamente', status: 'active' });
  } catch (err) {
    console.error('[Rules] Activate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/firmwares/rules/:id/deactivate - Deactivate rule (active -> disabled)
router.patch('/rules/:id/deactivate', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const db = getDb();
    const getStmt = db.prepare('SELECT status FROM firmware_rules WHERE id = ?');
    const rule = getStmt.get(id);

    if (!rule) {
      return res.status(404).json({ error: 'Regla no encontrada' });
    }

    if (rule.status !== 'active') {
      return res.status(400).json({ error: 'Solo se pueden desactivar reglas en estado Activo' });
    }

    const updateStmt = db.prepare('UPDATE firmware_rules SET status = ? WHERE id = ?');
    updateStmt.run('disabled', id);

    // Audit log
    const auditRuleData = db.prepare('SELECT vendor, model FROM firmware_rules WHERE id = ?').get(id);
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Desactivó regla de firmware',
      auditRuleData ? `${auditRuleData.vendor}/${auditRuleData.model}` : id,
      req.ip,
      new Date().toISOString()
    );

    res.json({ message: 'Regla desactivada correctamente', status: 'disabled' });
  } catch (err) {
    console.error('[Rules] Deactivate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/firmwares/rules/:id - Delete rule
router.delete('/rules/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const db = getDb();

    // Get rule info before deleting
    const auditRuleData = db.prepare('SELECT vendor, model FROM firmware_rules WHERE id = ?').get(id);

    // Delete rule
    const stmt = db.prepare('DELETE FROM firmware_rules WHERE id = ?');
    stmt.run(id);

    // Audit log
    const auditStmt = db.prepare(`
      INSERT INTO audit_log (user_id, username, action, target, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditStmt.run(
      req.user.id,
      req.user.username,
      'Elimino regla de firmware',
      auditRuleData ? `${auditRuleData.vendor}/${auditRuleData.model}` : id,
      req.ip,
      new Date().toISOString()
    );

    res.json({ message: 'Regla eliminada correctamente' });
  } catch (err) {
    console.error('[Rules] Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
