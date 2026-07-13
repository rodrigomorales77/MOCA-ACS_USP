'use strict';

const Sidebar = (() => {
  const navItems = [
    { path: '/dashboard', icon: '📊', label: 'Dashboard',           adminOnly: false },
    { path: '/devices',   icon: '📡', label: 'Dispositivos',       adminOnly: false },
    { path: '/faults',    icon: '⚠️',  label: 'Fallas',             adminOnly: false },
    { path: '/firmwares', icon: '💾', label: 'Firmwares',          adminOnly: true  },
    { path: '/pending-actions', icon: '⚙️', label: 'Acciones Pendientes', adminOnly: false },
    { path: '/users',     icon: '👤', label: 'Usuarios',           adminOnly: true  },
    { path: '/audit',     icon: '📋', label: 'Auditoría',          adminOnly: true  },
  ];

  function render() {
    const sidebar = document.getElementById('sidebar');
    const isAdmin = Auth.isAdmin();

    const items = navItems
      .filter(item => !item.adminOnly || isAdmin)
      .map(item => `
        <div class="nav-item" data-path="${item.path}">
          <span class="nav-icon">${item.icon}</span>
          <span>${item.label}</span>
        </div>`)
      .join('');

    sidebar.innerHTML = `
      <div class="sidebar-logo">MOCA <span>ACS</span></div>
      <nav class="sidebar-nav">${items}</nav>`;

    sidebar.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => Router.navigate(el.dataset.path));
    });
  }

  return { render };
})();
