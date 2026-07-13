'use strict';

(function init() {
  // Registrar rutas
  Router.register('/dashboard', () => DashboardPage.render());

  Router.register('/devices', (path) => {
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 1) return DeviceDetailPage.render(parts[1]);
    return DevicesPage.render();
  });

  Router.register('/faults', () => FaultsPage.render());
  Router.register('/firmwares', () => FirmwaresPage.render());
  Router.register('/pending-actions', () => PendingActionsPage.render());
  Router.register('/users',  () => UsersPage.render());
  Router.register('/audit',  () => AuditPage.render());

  if (Auth.isLoggedIn()) {
    Router.showApp();
    Sidebar.render();
    Header.render();
    Router.resolve();
  } else {
    Router.showLogin();
    LoginPage.render();
  }
})();
