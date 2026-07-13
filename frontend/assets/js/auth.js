'use strict';

const Auth = (() => {
  function getToken()  { return localStorage.getItem('moca_token'); }
  function getUser()   { return JSON.parse(localStorage.getItem('moca_user') || 'null'); }
  function isLoggedIn(){ return !!getToken(); }
  function isAdmin()   { return getUser()?.role === 'admin'; }

  function set(token, user) {
    localStorage.setItem('moca_token', token);
    localStorage.setItem('moca_user', JSON.stringify(user));
  }

  function clear() {
    localStorage.removeItem('moca_token');
    localStorage.removeItem('moca_user');
  }

  async function login(username, password) {
    const data = await API.post('/auth/login', { username, password });
    set(data.token, data.user);
    return data.user;
  }

  async function logout() {
    try { await API.post('/auth/logout'); } catch {}
    clear();
  }

  return { getToken, getUser, isLoggedIn, isAdmin, login, logout, clear };
})();
