'use strict';

const Router = (() => {
  const routes = {};

  function register(path, handler) {
    routes[path] = handler;
  }

  function getCurrentPath() {
    return location.hash.replace('#', '') || '/dashboard';
  }

  function navigate(path) {
    location.hash = path;
  }

  function resolve() {
    if (!Auth.isLoggedIn()) {
      showLogin();
      return;
    }

    const path = getCurrentPath();
    const content = document.getElementById('page-content');

    // Rutas solo admin
    const adminOnly = ['/users', '/audit', '/firmwares'];
    if (adminOnly.includes(path) && !Auth.isAdmin()) {
      navigate('/dashboard');
      return;
    }

    // Actualizar nav activo
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === path);
    });

    // Buscar handler de ruta exacta o ruta base
    const basePath = '/' + path.split('/').filter(Boolean)[0];
    const handler = routes[path] || routes[basePath];

    if (handler) {
      content.innerHTML = '<div class="loading">Cargando...</div>';
      Promise.resolve(handler(path)).catch(err => {
        content.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      });
    } else {
      navigate('/dashboard');
    }
  }

  function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  }

  window.addEventListener('hashchange', resolve);

  return { register, navigate, resolve, showLogin, showApp };
})();
