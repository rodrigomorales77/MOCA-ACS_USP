'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/db');
const { requireAdmin } = require('../middleware/authorize');

const router = express.Router();

// PATCH /api/users/:id/profile - Editar perfil (nombre, apellido, correo, teléfono)
// Definida ANTES de requireAdmin: cualquier usuario puede editar SU propio perfil,
// los admins pueden editar cualquiera. (Antes estaba detrás de requireAdmin y los
// viewers no podían editar su perfil, contradiciendo el diseño documentado.)
router.patch('/:id/profile', (req, res) => {
  const id = Number(req.params.id);
  const isAdmin = req.user.role === 'admin';

  // Los no-admins solo pueden editar su propio perfil
  if (!isAdmin && req.user.id !== id) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }

  const { nombre, apellido, correo, telefono } = req.body;
  const updates = [];
  const values = [];

  if (nombre !== undefined) {
    updates.push('nombre = ?');
    values.push(nombre || '');
  }
  if (apellido !== undefined) {
    updates.push('apellido = ?');
    values.push(apellido || '');
  }
  if (correo !== undefined) {
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(400).json({ error: 'Correo inválido' });
    }
    updates.push('correo = ?');
    values.push(correo || '');
  }
  if (telefono !== undefined) {
    updates.push('telefono = ?');
    values.push(telefono || '');
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'Nada para actualizar' });
  }

  values.push(id);
  getDb().prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ message: 'Perfil actualizado' });
});

// Todas las rutas siguientes son solo admin
router.use(requireAdmin);

// GET /api/users
router.get('/', (req, res) => {
  const users = getDb().prepare(
    'SELECT id, username, nombre, apellido, correo, telefono, role, active, created_at, last_login FROM users ORDER BY created_at DESC'
  ).all();

  // Filtrar usuario root a menos que el usuario autenticado sea root
  const filtered = req.user.username === 'root'
    ? users
    : users.filter(u => u.username !== 'root');

  res.json(filtered);
});

// POST /api/users
router.post('/', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['admin', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'username, password y role (admin|viewer) requeridos' });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = getDb().prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, hash, role);
    res.status(201).json({ id: result.lastInsertRowid, username, role });
  } catch {
    res.status(409).json({ error: 'El username ya existe' });
  }
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  const { password, role, active } = req.body;
  const id = Number(req.params.id);

  // No permitir que el admin se desactive a sí mismo
  if (req.user.id === id && active === 0) {
    return res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
  }

  const updates = [];
  const values = [];

  if (password) {
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(password, 10));
  }
  if (role && ['admin', 'viewer'].includes(role)) {
    updates.push('role = ?');
    values.push(role);
  }
  if (active !== undefined) {
    updates.push('active = ?');
    values.push(active ? 1 : 0);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'Nada para actualizar' });
  }

  values.push(id);
  getDb().prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ message: 'Usuario actualizado' });
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.user.id === id) {
    return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'Usuario eliminado' });
});

module.exports = router;
