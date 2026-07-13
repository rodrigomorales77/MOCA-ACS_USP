'use strict';

const Header = (() => {
  function render(title) {
    const user = Auth.getUser();
    const displayName = (user?.apellido && user?.nombre)
      ? `${user.apellido}, ${user.nombre}`
      : user?.username || 'Usuario';
    const initial = (user?.apellido?.[0] || user?.username?.[0] || '?').toUpperCase();

    document.getElementById('header').innerHTML = `
      <div class="header-left">
        <img src="assets/img/moca-logo.svg" alt="MOCA Automations" class="header-logo" title="${title || 'MOCA ACS'}" />
      </div>
      <div class="header-user">
        <span style="color:var(--color-text-muted);font-size:0.8rem">${displayName}</span>
        ${Badge.role(user?.role)}
        <div class="user-avatar">${initial}</div>
        <button class="btn btn-ghost btn-sm" id="logout-btn" title="Cerrar sesión">Salir</button>
      </div>`;

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await Auth.logout();
      Router.showLogin();
      LoginPage.render();
    });
  }

  return { render };
})();
