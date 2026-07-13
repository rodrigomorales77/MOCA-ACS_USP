'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

function ensureAdminPassword() {
  const db = getDb();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';

  // Obtener usuario admin
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');

  if (admin) {
    // Verificar si la contraseña actual coincide
    const isCorrect = bcrypt.compareSync(adminPassword, admin.password_hash);
    if (!isCorrect) {
      // Actualizar contraseña
      const newHash = bcrypt.hashSync(adminPassword, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newHash, 'admin');
      console.log('[seed-admin] ✓ Contraseña del usuario admin actualizada');
    }
  }
}

module.exports = { ensureAdminPassword };
