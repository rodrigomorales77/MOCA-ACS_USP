'use strict';

const API = (() => {
  const BASE = '/api';

  async function request(method, path, body) {
    const token = localStorage.getItem('moca_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      Auth.clear();
      Router.navigate('/login');
      throw new Error('Sesión expirada');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  return {
    get:    (path)        => request('GET', path),
    post:   (path, body)  => request('POST', path, body),
    put:    (path, body)  => request('PUT', path, body),
    patch:  (path, body)  => request('PATCH', path, body),
    delete: (path)        => request('DELETE', path)
  };
})();
