'use strict';

const DeviceDetailPage = (() => {
  let allParams = [];
  let deviceId = '';
  let deviceIp = '';
  let currentPageSize = 10;
  let currentPage = 1;
  let searchFilter = '';
  let pendingActions = []; // Acciones locales (no guardadas aún en BD)

  function formatUptime(upTimeSeconds) {
    if (!upTimeSeconds || upTimeSeconds < 0) return { formatted: '—', since: '—' };

    const seconds = Math.floor(upTimeSeconds);
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    // Calcular fecha exacta de encendido
    const now = new Date();
    const onlineSinceMs = now.getTime() - (upTimeSeconds * 1000);
    const onlineSince = new Date(onlineSinceMs);
    const sinceFormatted = Config.formatDate(onlineSince);

    return {
      formatted: parts.join(' '),
      since: sinceFormatted
    };
  }

  async function render(encodedId) {
    deviceId = decodeURIComponent(encodedId);
    Header.render('Detalle de Dispositivo');
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading">Cargando dispositivo...</div>';

    const device = await API.get(`/devices/${encodedId}`);
    const isAdmin = Auth.isAdmin();
    window.deviceIsAdmin = isAdmin; // Global para usar en renderParams

    const info = device?.InternetGatewayDevice?.DeviceInfo || {};
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const rawLastInform = device._lastInform;
    const lastInform = rawLastInform ? new Date(rawLastInform.$date || rawLastInform) : null;
    const isOnline = lastInform && lastInform.getTime() > fiveMinAgo;

    // Extraer IP MGMT (puede estar en ConnectionRequestURL o en parámetros de interfaz)
    let ipMgmt = '';
    const connectionRequestURL = device?.InternetGatewayDevice?.ManagementServer?.ConnectionRequestURL?._value || '';
    if (connectionRequestURL) {
      const urlMatch = connectionRequestURL.match(/https?:\/\/([0-9.]+)/);
      ipMgmt = urlMatch ? urlMatch[1] : '';
    }
    // Fallback: usar ExternalIPAddress si no hay IP MGMT
    if (!ipMgmt) {
      ipMgmt = device?.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1']?.ExternalIPAddress?._value || '';
    }
    deviceIp = ipMgmt;

    // Extraer UpTime (en segundos)
    const upTimeValue = info.UpTime?._value || info.UpTime || 0;
    const upTimeData = formatUptime(upTimeValue);

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
        <button class="btn btn-ghost btn-sm" id="btn-back">← Volver</button>
        <h1 class="page-title" style="margin:0;font-size:1.1rem;word-break:break-all">${deviceId}</h1>
        ${Badge.status(isOnline)}
      </div>

      <div class="card detail-section">
        <div class="detail-section-title">Información del Dispositivo</div>
        <table class="param-table">
          <tr><td>Fabricante</td><td>${info.Manufacturer?._value || '—'}</td></tr>
          <tr><td>Modelo</td><td>${info.ModelName?._value || '—'}</td></tr>
          <tr><td>Versión SW</td><td>${info.SoftwareVersion?._value || '—'}</td></tr>
          <tr><td>Versión HW</td><td>${info.HardwareVersion?._value || '—'}</td></tr>
          <tr><td>Serial</td><td>${info.SerialNumber?._value || '—'}</td></tr>
          <tr><td>IP MGMT</td><td>${ipMgmt || '—'}</td></tr>
          <tr><td>UpTime</td><td>${upTimeData.formatted} (desde ${upTimeData.since})</td></tr>
          <tr><td>Último Inform</td><td>${Config.formatDate(lastInform)}</td></tr>
        </table>
      </div>

      ${isAdmin ? `
      <div class="card detail-section">
        <div class="detail-section-title">Acciones</div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="btn-reboot">🔄 Reiniciar</button>
          <button class="btn btn-primary btn-sm" id="btn-refresh">🔃 Refresh parámetros</button>
          <button class="btn btn-sm" id="btn-pending-actions" style="background:#d4edda;color:#155724;border:none">⚙️ Acciones Pendientes (<span id="pending-count">0</span>)</button>
          <button class="btn btn-danger btn-sm" id="btn-delete">🗑 Eliminar dispositivo</button>
        </div>
      </div>` : ''}

      <div class="card detail-section">
        <div class="detail-section-title">Parámetros</div>
        <div class="table-toolbar">
          <div style="display:flex;gap:0.5rem;align-items:center;flex:1">
            <input class="search-input" id="param-search" placeholder="Buscar parámetro..." style="flex:1;max-width:300px" />
            <button id="param-clear-btn" class="btn btn-ghost btn-sm" style="display:none;padding:0.4rem 0.8rem">✕ Limpiar</button>
          </div>
          <div style="display:flex;gap:0.75rem;align-items:center">
            <span id="param-count" style="color:var(--color-text-muted);font-size:0.875rem"></span>
            <select id="param-page-size" class="form-select" style="width:auto;padding:0.45rem;font-size:var(--font-size-sm)">
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
        <div id="raw-params"></div>
        <div class="pagination" id="params-pagination"></div>
      </div>

      <!-- Panel lateral de Acciones -->
      <div id="actions-panel" style="
        position: fixed;
        right: -400px;
        top: 0;
        width: 400px;
        height: 100vh;
        background: white;
        box-shadow: -2px 0 10px rgba(0,0,0,0.1);
        overflow-y: auto;
        transition: right 0.3s ease;
        z-index: 999;
        border-left: 1px solid var(--color-border);
      ">
        <div style="padding: 1.5rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: white;">
          <h3 style="margin: 0; font-size: 1.1rem;">⚙️ Acciones</h3>
          <button id="close-panel" style="background: none; border: none; cursor: pointer; font-size: 1.5rem;">✕</button>
        </div>
        <div id="actions-list" style="padding: 1rem;"></div>
      </div>`;

    document.getElementById('btn-back').onclick = () => Router.navigate('/devices');

    // Botón de acciones pendientes con color dinámico
    if (document.getElementById('btn-pending-actions')) {
      document.getElementById('btn-pending-actions').onclick = () => Router.navigate('/pending-actions');
    }

    // Panel lateral
    const panel = document.getElementById('actions-panel');
    document.getElementById('close-panel').onclick = () => {
      panel.style.right = '-400px';
    };

    // Cargar todos los parámetros
    allParams = flattenDevice(device);

    // Configurar eventos de búsqueda y paginación
    const paramSearchInput = document.getElementById('param-search');
    const paramClearBtn = document.getElementById('param-clear-btn');

    paramSearchInput.addEventListener('input', e => {
      searchFilter = e.target.value.toLowerCase();
      currentPage = 1;
      paramClearBtn.style.display = searchFilter ? 'block' : 'none';
      renderParams();
    });

    paramClearBtn.addEventListener('click', () => {
      searchFilter = '';
      paramSearchInput.value = '';
      currentPage = 1;
      paramClearBtn.style.display = 'none';
      renderParams();
    });

    document.getElementById('param-page-size').addEventListener('change', e => {
      currentPageSize = parseInt(e.target.value);
      currentPage = 1;
      renderParams();
    });

    renderParams();
    updatePendingCount();

    if (isAdmin) {
      document.getElementById('btn-reboot').onclick = async () => {
        if (!await Modal.confirm('¿Reiniciar el dispositivo?')) return;
        await API.post(`/devices/${encodedId}/tasks?connection_request`, { name: 'reboot' });
        alert('Tarea de reboot enviada');
      };

      document.getElementById('btn-refresh').onclick = async () => {
        await API.post(`/devices/${encodedId}/tasks?connection_request`, {
          name: 'refreshObject', objectName: ''
        });
        alert('Refresh enviado');
      };

      document.getElementById('btn-delete').onclick = async () => {
        if (!await Modal.confirm(`¿Eliminar permanentemente "${deviceId}"?`)) return;
        await API.delete(`/devices/${encodedId}`);
        Router.navigate('/devices');
      };
    }
  }

  function renderParams() {
    const filtered = allParams.filter(param => {
      if (!searchFilter) return true;
      const path = param.path.toLowerCase();
      const value = String(param.value).toLowerCase();
      return path.includes(searchFilter) || value.includes(searchFilter);
    });

    const paramsEl = document.getElementById('raw-params');

    if (!filtered.length) {
      paramsEl.innerHTML = '<div class="empty-state">Sin parámetros disponibles</div>';
      document.getElementById('params-pagination').innerHTML = '';
      document.getElementById('param-count').textContent = '0 resultado(s)';
      return;
    }

    const totalPages = Math.ceil(filtered.length / currentPageSize);
    const startIdx = (currentPage - 1) * currentPageSize;
    const endIdx = startIdx + currentPageSize;
    const paginatedParams = filtered.slice(startIdx, endIdx);

    const rows = paginatedParams.map((param, idx) => {
      const { path, value, writable, type } = param;
      const stringValue = String(value);
      const isWritable = writable;

      if (isWritable) {
        return `
          <tr style="background:rgba(108,155,207,0.05)">
            <td style="word-break:break-all;max-width:400px">
              <code style="font-size:0.75rem;display:block">${path}</code>
            </td>
            <td style="max-width:500px">
              <div style="display:flex;align-items:center;gap:0.5rem;width:100%">
                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help;background:rgba(108,155,207,0.1);padding:0.25rem 0.5rem;border-radius:4px" title="${stringValue}">
                  ${escapeHtml(stringValue)}
                </span>
                ${window.deviceIsAdmin ? `<button class="btn btn-primary btn-sm" onclick="DeviceDetailPage.editParam('${escapeJs(path)}', '${escapeJs(stringValue)}', '${type}')">✏️</button>` : ''}
              </div>
            </td>
          </tr>`;
      } else {
        return `
          <tr>
            <td style="word-break:break-all;max-width:400px"><code style="font-size:0.75rem">${path}</code></td>
            <td style="max-width:500px">
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;width:100%;cursor:help;background:rgba(200,200,200,0.05);padding:0.25rem 0.5rem;border-radius:4px" title="${stringValue}">
                ${escapeHtml(stringValue)}
              </span>
            </td>
          </tr>`;
      }
    }).join('');

    paramsEl.innerHTML = `<table class="param-table">${rows}</table>`;
    document.getElementById('param-count').textContent = `${filtered.length} resultado(s)`;

    const pagEl = document.getElementById('params-pagination');
    if (totalPages > 1) {
      pagEl.innerHTML = `
        <span>${startIdx + 1}–${Math.min(endIdx, filtered.length)} de ${filtered.length}</span>
        <div class="pagination-buttons">
          <button class="btn btn-ghost btn-sm" id="pag-prev" ${currentPage === 1 ? 'disabled' : ''}>← Anterior</button>
          <span style="font-size:0.875rem;color:var(--color-text-muted)">Página ${currentPage}/${totalPages}</span>
          <button class="btn btn-ghost btn-sm" id="pag-next" ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente →</button>
        </div>`;

      document.getElementById('pag-prev').onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          renderParams();
        }
      };

      document.getElementById('pag-next').onclick = () => {
        if (currentPage < totalPages) {
          currentPage++;
          renderParams();
        }
      };
    } else {
      pagEl.innerHTML = '';
    }
  }

  function updatePendingCount() {
    const count = pendingActions.filter(a => a.status === 'pending').length;

    // Solo actualizar si existen los elementos (solo para admin)
    const countEl = document.getElementById('pending-count');
    if (countEl) {
      countEl.textContent = count;
    }

    // Actualizar color del botón
    const btn = document.getElementById('btn-pending-actions');
    if (btn) {
      if (count === 0) {
        // Verde si 0 acciones
        btn.style.background = '#d4edda';
        btn.style.color = '#155724';
      } else {
        // Naranja si 1 o más
        btn.style.background = '#fff3cd';
        btn.style.color = '#856404';
      }
    }
  }

  function renderActionsPanel() {
    const list = document.getElementById('actions-list');

    if (pendingActions.length === 0) {
      list.innerHTML = '<div class="empty-state">Sin acciones</div>';
      return;
    }

    const html = pendingActions.map((action, idx) => {
      const statusColor = {
        pending: '#FEF0E6',
        applying: '#E0EDFB',
        success: '#D4EDDA',
        failed: '#FDE8EB'
      };
      const statusText = {
        pending: '⏳ Pendiente',
        applying: '⏳ Aplicando...',
        success: '✓ Exitosa',
        failed: '✗ Falló'
      };

      return `
        <div style="
          background: ${statusColor[action.status]};
          border-left: 3px solid ${action.status === 'success' ? '#276749' : action.status === 'failed' ? '#9B2335' : '#9B4A00'};
          padding: 1rem;
          margin-bottom: 0.75rem;
          border-radius: 4px;
        ">
          <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
            <code>${action.path}</code>
          </div>
          <div style="margin-bottom: 0.75rem;">
            <div style="font-size: 0.85rem; margin-bottom: 0.25rem;"><strong>De:</strong></div>
            <div style="font-size: 0.8rem; background: rgba(0,0,0,0.05); padding: 0.5rem; border-radius: 3px; word-break: break-all;">
              ${escapeHtml(action.oldValue)}
            </div>
          </div>
          <div style="margin-bottom: 0.75rem;">
            <div style="font-size: 0.85rem; margin-bottom: 0.25rem;"><strong>Para:</strong></div>
            <div style="font-size: 0.8rem; background: rgba(108,155,207,0.15); padding: 0.5rem; border-radius: 3px; word-break: break-all; color: var(--color-primary);">
              ${escapeHtml(action.newValue)}
            </div>
          </div>
          <div style="font-size: 0.85rem; margin-bottom: 1rem; padding: 0.5rem; background: rgba(0,0,0,0.05); border-radius: 3px;">
            ${statusText[action.status]}
            ${action.error ? `<br><span style="color: #9B2335;">Error: ${action.error}</span>` : ''}
          </div>
          ${action.status === 'pending' ? `
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-primary btn-sm" onclick="DeviceDetailPage.confirmAction(${idx})" style="flex:1;">Confirmar</button>
              <button class="btn btn-danger btn-sm" onclick="DeviceDetailPage.deleteAction(${idx})">Borrar</button>
            </div>
          ` : ''}
        </div>`;
    }).join('');

    list.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '—';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeJs(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  function flattenDevice(obj, prefix = '') {
    const result = [];
    for (const [key, val] of Object.entries(obj || {})) {
      if (key.startsWith('_')) continue;
      const path = prefix ? `${prefix}.${key}` : key;

      if (val && typeof val === 'object' && '_value' in val) {
        result.push({
          path,
          value: val._value ?? '',
          writable: val._writable === true,
          type: val._type || 'unknown'
        });
      } else if (val && typeof val === 'object') {
        result.push(...flattenDevice(val, path));
      }
    }
    return result;
  }

  return {
    render,
    editParam: function(path, currentValue, type) {
      // Detectar si es booleano
      const isBoolean = currentValue === 'true' || currentValue === 'false' || currentValue === true || currentValue === false;

      if (isBoolean) {
        // Mostrar modal con dropdown para booleanos
        const modal = document.createElement('div');
        modal.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5); display: flex;
          align-items: center; justify-content: center; z-index: 10000;
        `;

        const currentBool = String(currentValue).toLowerCase() === 'true';

        modal.innerHTML = `
          <div style="background:white;padding:2rem;border-radius:8px;max-width:400px;width:90%">
            <h3 style="margin-top:0">${path}</h3>
            <p style="color:#666">Valor actual: <strong>${currentValue}</strong></p>
            <select id="bool-select" style="width:100%;padding:0.75rem;border:1px solid #ddd;border-radius:4px;font-size:1rem;margin-bottom:1.5rem">
              <option value="false" ${!currentBool ? 'selected' : ''}>false</option>
              <option value="true" ${currentBool ? 'selected' : ''}>true</option>
            </select>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end">
              <button onclick="this.closest('div').parentElement.remove()" class="btn btn-ghost" style="padding:0.5rem 1rem">Cancelar</button>
              <button id="bool-confirm" class="btn btn-primary" style="padding:0.5rem 1rem;background:#6c9bcf;color:white;border:none;border-radius:4px;cursor:pointer">Guardar</button>
            </div>
          </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('bool-confirm').onclick = () => {
          const newValue = document.getElementById('bool-select').value;
          modal.remove();

          if (newValue === String(currentValue)) return;

          const action = { path, oldValue: currentValue, newValue, type, status: 'pending', error: null };
          pendingActions.push(action);
          updatePendingCount();
          const panel = document.getElementById('actions-panel');
          panel.style.right = '0';
          renderActionsPanel();
          alert('✓ Acción agregada al panel lateral');
        };

        document.getElementById('bool-select').focus();
      } else {
        // Input de texto para otros valores
        const newValue = prompt(`Editar parámetro:\n${path}\n\nValor actual: ${currentValue}\n\nNuevo valor:`, currentValue);

        if (newValue === null || newValue === currentValue) return;

        const action = { path, oldValue: currentValue, newValue, type, status: 'pending', error: null };
        pendingActions.push(action);
        updatePendingCount();
        const panel = document.getElementById('actions-panel');
        panel.style.right = '0';
        renderActionsPanel();
        alert('✓ Acción agregada al panel lateral');
      }
    },
    confirmAction: async function(idx) {
      const action = pendingActions[idx];
      action.status = 'applying';
      renderActionsPanel();

      try {
        await API.post('/pending-actions', {
          deviceId,
          deviceIp,
          parameterPath: action.path,
          parameterType: action.type,
          oldValue: action.oldValue,
          newValue: action.newValue,
          scheduledFor: null
        });

        action.status = 'success';
        renderActionsPanel();
      } catch (err) {
        action.status = 'failed';
        action.error = err.message;
        renderActionsPanel();
      }
    },
    deleteAction: function(idx) {
      if (!confirm('¿Eliminar esta acción?')) return;
      pendingActions.splice(idx, 1);
      updatePendingCount();
      renderActionsPanel();
    }
  };
})();
