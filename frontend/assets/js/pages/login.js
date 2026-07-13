'use strict';

const LoginPage = (() => {
  function render() {
    document.getElementById('login-screen').innerHTML = `
      <div class="login-card">
        <div class="login-logo">MOCA <span>ACS</span></div>
        <div class="login-subtitle">Sistema de Gestión de Dispositivos TR-069</div>
        <div id="login-error"></div>
        <div class="form-group">
          <label class="form-label" for="login-user">Usuario</label>
          <input class="form-input" id="login-user" type="text" placeholder="admin" autocomplete="username" />
        </div>
        <div class="form-group">
          <label class="form-label" for="login-pass">Contraseña</label>
          <input class="form-input" id="login-pass" type="password" placeholder="••••••••" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" id="login-btn" style="width:100%;justify-content:center;margin-top:0.5rem">
          Ingresar
        </button>
      </div>`;

    const doLogin = async () => {
      const btn = document.getElementById('login-btn');
      const errDiv = document.getElementById('login-error');
      const username = document.getElementById('login-user').value.trim();
      const password = document.getElementById('login-pass').value;
      errDiv.innerHTML = '';

      if (!username || !password) {
        errDiv.innerHTML = '<div class="alert alert-error">Completá usuario y contraseña</div>';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Ingresando...';

      try {
        await Auth.login(username, password);
        Router.showApp();
        Sidebar.render();
        Header.render();
        Router.navigate('/dashboard');
        Router.resolve();
      } catch (err) {
        errDiv.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
    };

    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('login-pass').addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
  }

  return { render };
})();
