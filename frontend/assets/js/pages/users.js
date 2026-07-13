'use strict';

const UsersPage = (() => {
  async function render() {
    Header.render('Usuarios');
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading">Cargando usuarios...</div>';

    const allUsers = await API.get('/users');
    const currentUser = Auth.getUser();

    // Filtrar usuario root a menos que el usuario logueado sea root
    const users = allUsers.filter(u => u.username !== 'root' || currentUser.username === 'root');

    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h1 class="page-title" style="margin:0">Usuarios</h1>
        <button class="btn btn-primary" id="btn-new-user">+ Nuevo Usuario</button>
      </div>
      <div class="table-wrapper">
        <div id="users-table"></div>
      </div>`;

    Table.render({
      container: document.getElementById('users-table'),
      columns: [
        { key: 'username', label: 'Usuario' },
        {
          label: 'Nombre',
          render: u => u.nombre && u.apellido ? `${u.apellido}, ${u.nombre}` : (u.nombre || '—')
        },
        { label: 'Rol',    render: u => Badge.role(u.role) },
        { label: 'Estado', render: u => u.active
          ? '<span class="badge badge-online">Activo</span>'
          : '<span class="badge badge-offline">Inactivo</span>' },
        { label: 'Último acceso', render: u => u.last_login
          ? Config.formatDate(new Date(u.last_login))
          : '—' },
        {
          label: 'Acciones',
          render: u => `
            <button class="btn btn-ghost btn-sm" data-edit="${u.id}">Editar</button>
            ${u.id !== currentUser.id && u.username !== 'root' ? `<button class="btn btn-danger btn-sm" data-del="${u.id}" style="margin-left:0.5rem">Eliminar</button>` : ''}`
        }
      ],
      rows: users,
      emptyMessage: 'Sin usuarios'
    });

    document.getElementById('btn-new-user').onclick = () => showUserModal(null, render);

    document.getElementById('users-table').querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const user = users.find(u => u.id == btn.dataset.edit);
        showUserModal(user, render);
      };
    });

    document.getElementById('users-table').querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!await Modal.confirm('¿Eliminar este usuario?')) return;
        await API.delete(`/users/${btn.dataset.del}`);
        render();
      };
    });
  }

  function showUserModal(user, onSuccess) {
    const isEdit = !!user;
    Modal.open({
      title: isEdit ? 'Editar Usuario' : 'Nuevo Usuario',
      body: `
        <div class="form-group">
          <label class="form-label">Usuario</label>
          <input class="form-input" id="m-username" value="${user?.username || ''}" ${isEdit ? 'disabled' : ''} placeholder="nombre de usuario" />
        </div>
        ${isEdit ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
            <div class="form-group">
              <label class="form-label">Nombre</label>
              <input class="form-input" id="m-nombre" value="${user?.nombre || ''}" placeholder="Juan" />
            </div>
            <div class="form-group">
              <label class="form-label">Apellido</label>
              <input class="form-input" id="m-apellido" value="${user?.apellido || ''}" placeholder="García" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Correo Electrónico</label>
            <input class="form-input" id="m-correo" type="email" value="${user?.correo || ''}" placeholder="usuario@example.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Teléfono</label>
            <input class="form-input" id="m-telefono" value="${user?.telefono || ''}" placeholder="+54 11 1234 5678" />
          </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">Contraseña${isEdit ? ' (dejar vacío para no cambiar)' : ''}</label>
          <input class="form-input" id="m-password" type="password" placeholder="••••••••" />
        </div>
        <div class="form-group">
          <label class="form-label">Rol</label>
          <select class="form-select" id="m-role">
            <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="viewer" ${user?.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          </select>
        </div>
        <div id="m-error"></div>`,
      confirmLabel: isEdit ? 'Guardar' : 'Crear',
      onConfirm: async () => {
        const username = document.getElementById('m-username').value.trim();
        const password = document.getElementById('m-password').value;
        const role = document.getElementById('m-role').value;
        const errEl = document.getElementById('m-error');

        try {
          if (isEdit) {
            // Primero actualizar perfil si hay cambios
            const perfil = {};
            const nombre = document.getElementById('m-nombre')?.value || '';
            const apellido = document.getElementById('m-apellido')?.value || '';
            const correo = document.getElementById('m-correo')?.value || '';
            const telefono = document.getElementById('m-telefono')?.value || '';

            if (nombre !== user.nombre || apellido !== user.apellido || correo !== user.correo || telefono !== user.telefono) {
              perfil.nombre = nombre;
              perfil.apellido = apellido;
              perfil.correo = correo;
              perfil.telefono = telefono;
              await API.patch(`/users/${user.id}/profile`, perfil);
            }

            // Luego actualizar credenciales si hay cambios
            const credenciales = { role };
            if (password) credenciales.password = password;
            await API.put(`/users/${user.id}`, credenciales);
          } else {
            if (!username || !password) throw new Error('Usuario y contraseña requeridos');
            await API.post('/users', { username, password, role });
          }
          onSuccess();
        } catch (err) {
          errEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
          throw err;
        }
      }
    });
  }

  return { render };
})();
