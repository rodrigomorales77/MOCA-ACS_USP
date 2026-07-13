'use strict';

const express = require('express');
const { nbi } = require('../config/genieacs');

const router = express.Router();

// Middleware: Solo accesible desde IP privada.
// Se validan AMBAS direcciones:
// - req.socket.remoteAddress: bloquea acceso público directo (no falsificable).
// - req.ip (derivada de X-Forwarded-For vía nginx): bloquea clientes públicos
//   que llegan a través del proxy nginx, cuyo socket siempre es privado.
const isPrivate = (ip) => {
  const clean = (ip || '').replace(/^::ffff:/, ''); // normalizar IPv4-mapped IPv6
  return /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(clean) || clean === '::1' || clean === '127.0.0.1';
};

const restrictToPrivateIP = (req, res, next) => {
  if (!isPrivate(req.socket.remoteAddress) || !isPrivate(req.ip)) {
    return res.status(403).json({ error: 'Acceso solo desde IP privada' });
  }
  next();
};

router.use(restrictToPrivateIP);

// GET /api/genieacs/devices - Buscar dispositivos
router.get('/devices', async (req, res, next) => {
  try {
    const params = {};
    if (req.query.query) params.query = req.query.query;
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.skip) params.skip = req.query.skip;
    if (req.query.projection) params.projection = req.query.projection;

    const { data } = await nbi.get('/devices/', { params });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/genieacs/devices/:id - Obtener dispositivo específico
router.get('/devices/:id', async (req, res, next) => {
  try {
    const query = JSON.stringify({ _id: req.params.id });
    const { data } = await nbi.get('/devices/', { params: { query } });
    if (!data.length) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    res.json(data[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/genieacs/tasks - Buscar tareas
router.get('/tasks', async (req, res, next) => {
  try {
    const params = {};
    if (req.query.query) params.query = req.query.query;
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.skip) params.skip = req.query.skip;

    const { data } = await nbi.get('/tasks/', { params });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/genieacs/faults - Buscar fallos
router.get('/faults', async (req, res, next) => {
  try {
    const params = {};
    if (req.query.query) params.query = req.query.query;
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.skip) params.skip = req.query.skip;

    const { data } = await nbi.get('/faults/', { params });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/genieacs/presets - Listar presets
router.get('/presets', async (req, res, next) => {
  try {
    const { data } = await nbi.get('/presets/');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/genieacs/files - Listar archivos
router.get('/files', async (req, res, next) => {
  try {
    const { data } = await nbi.get('/files/');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/genieacs/devices/:id/tasks - Crear tarea para dispositivo
router.post('/devices/:id/tasks', async (req, res, next) => {
  try {
    const connReq = req.query.connection_request !== undefined ? '?connection_request' : '';
    const { data, status } = await nbi.post(
      `/devices/${encodeURIComponent(req.params.id)}/tasks${connReq}`,
      req.body
    );
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/genieacs/tasks/:id/retry - Reintentar tarea
router.post('/tasks/:id/retry', async (req, res, next) => {
  try {
    const { data } = await nbi.post(`/tasks/${req.params.id}/retry`, {});
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/genieacs/tasks/:id - Eliminar tarea
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    await nbi.delete(`/tasks/${req.params.id}`);
    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/genieacs/devices/:id - Eliminar dispositivo
router.delete('/devices/:id', async (req, res, next) => {
  try {
    await nbi.delete(`/devices/${encodeURIComponent(req.params.id)}`);
    res.json({ message: 'Dispositivo eliminado' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/genieacs/faults/:id - Eliminar fallo
router.delete('/faults/:id', async (req, res, next) => {
  try {
    await nbi.delete(`/faults/${encodeURIComponent(req.params.id)}`);
    res.json({ message: 'Fallo eliminado' });
  } catch (err) {
    next(err);
  }
});

// POST /api/genieacs/devices/:id/tags/:tag - Agregar tag
router.post('/devices/:id/tags/:tag', async (req, res, next) => {
  try {
    const { data } = await nbi.post(
      `/devices/${encodeURIComponent(req.params.id)}/tags/${encodeURIComponent(req.params.tag)}`,
      {}
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/genieacs/devices/:id/tags/:tag - Remover tag
router.delete('/devices/:id/tags/:tag', async (req, res, next) => {
  try {
    await nbi.delete(
      `/devices/${encodeURIComponent(req.params.id)}/tags/${encodeURIComponent(req.params.tag)}`
    );
    res.json({ message: 'Tag removido' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/genieacs/presets/:name - Crear/actualizar preset
router.put('/presets/:name', async (req, res, next) => {
  try {
    const { data } = await nbi.put(
      `/presets/${encodeURIComponent(req.params.name)}`,
      req.body
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/genieacs/presets/:name - Eliminar preset
router.delete('/presets/:name', async (req, res, next) => {
  try {
    await nbi.delete(`/presets/${encodeURIComponent(req.params.name)}`);
    res.json({ message: 'Preset eliminado' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/genieacs/files/:name - Subir archivo
router.put('/files/:name', async (req, res, next) => {
  try {
    const headers = {};
    if (req.headers['filetype']) headers['fileType'] = req.headers['filetype'];
    if (req.headers['filecontent']) headers['fileContent'] = req.headers['filecontent'];

    const { data } = await nbi.put(
      `/files/${encodeURIComponent(req.params.name)}`,
      req.body,
      { headers }
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
