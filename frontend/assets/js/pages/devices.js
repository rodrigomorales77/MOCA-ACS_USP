'use strict';

const DevicesPage = (() => {
  const PAGE_SIZE = 25;
  let currentSkip = 0;
  let currentSearch = '';
  let currentStatusFilter = ''; // '' = todos, 'online', 'offline', 'pending'
  let pendingActionsByDevice = {}; // deviceId -> count

  async function render() {
    Header.render('Dispositivos');
    const content = document.getElementById('page-content');

    content.innerHTML = `
      <h1 class="page-title">Dispositivos</h1>
      <div class="table-wrapper">
        <div class="table-toolbar">
          <input class="search-input" id="device-search" placeholder="Buscar por ID, modelo o IP..." value="${currentSearch}" />
          <select id="status-filter" class="form-select" style="width:auto;padding:0.45rem;font-size:var(--font-size-sm)">
            <option value="">Todos los estados</option>
            <option value="online" ${currentStatusFilter === 'online' ? 'selected' : ''}>Online</option>
            <option value="offline" ${currentStatusFilter === 'offline' ? 'selected' : ''}>Offline</option>
            <option value="pending" ${currentStatusFilter === 'pending' ? 'selected' : ''}>Pendientes</option>
          </select>
          <span id="device-count" style="color:var(--color-text-muted);font-size:0.875rem"></span>
        </div>
        <div id="devices-table"></div>
        <div class="pagination" id="devices-pagination"></div>
      </div>`;

    document.getElementById('device-search').addEventListener('input', e => {
      currentSearch = e.target.value;
      currentSkip = 0;
      loadDevices();
    });

    document.getElementById('status-filter').addEventListener('change', e => {
      currentStatusFilter = e.target.value;
      currentSkip = 0;
      loadDevices();
    });

    loadDevices();
  }

  async function loadDevices() {
    const tableEl = document.getElementById('devices-table');
    tableEl.innerHTML = '<div class="loading">Cargando...</div>';

    let queryParam = '';
    if (currentSearch) {
      const q = { _id: { $regex: currentSearch, $options: 'i' } };
      queryParam = `&query=${encodeURIComponent(JSON.stringify(q))}`;
    }

    const projection = encodeURIComponent(
      'InternetGatewayDevice.DeviceInfo.ModelName,InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress,_lastInform'
    );
    const devices = await API.get(
      `/devices?limit=${PAGE_SIZE}&skip=${currentSkip}&projection=${projection}${queryParam}`
    );

    // Cargar acciones pendientes para marcar dispositivos
    try {
      const response = await API.get('/pending-actions?limit=1000&status=pending');
      const allActions = response.actions || response || [];
      pendingActionsByDevice = {};
      allActions.forEach(action => {
        const devId = action.device_id || action.deviceId;
        if (devId) {
          pendingActionsByDevice[devId] = (pendingActionsByDevice[devId] || 0) + 1;
        }
      });
    } catch (err) {
      console.warn('Error cargando acciones pendientes:', err);
      pendingActionsByDevice = {};
    }

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    // Filtrar por estado si está seleccionado
    let filteredDevices = devices;
    if (currentStatusFilter) {
      filteredDevices = devices.filter(d => {
        const raw = d._lastInform;
        const isOnline = raw && new Date(raw.$date || raw).getTime() > fiveMinAgo;
        const hasPending = pendingActionsByDevice[d._id] > 0;

        if (currentStatusFilter === 'online') return isOnline;
        if (currentStatusFilter === 'offline') return !isOnline;
        if (currentStatusFilter === 'pending') return hasPending;
        return true;
      });
    }

    Table.render({
      container: tableEl,
      columns: [
        { key: '_id', label: 'Device ID' },
        {
          label: 'Modelo',
          render: d => d?.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || '—'
        },
        {
          label: 'IP WAN',
          render: d => {
            const wan = d?.InternetGatewayDevice?.WANDevice?.['1']
              ?.WANConnectionDevice?.['1']?.WANIPConnection?.['1']
              ?.ExternalIPAddress?._value;
            return wan || '—';
          }
        },
        {
          label: 'Estado',
          render: d => {
            const raw = d._lastInform;
            if (!raw) return Badge.status(false);
            const t = new Date(raw.$date || raw).getTime();
            return Badge.status(t > fiveMinAgo);
          }
        },
        {
          label: 'Último Inform',
          render: d => d._lastInform
            ? Config.formatDate(new Date(d._lastInform.$date || d._lastInform))
            : '—'
        }
      ],
      rows: filteredDevices,
      onRowClick: (id) => Router.navigate(`/devices/${encodeURIComponent(id)}`),
      emptyMessage: 'No se encontraron dispositivos',
      rowStyle: (d) => {
        // Resaltar dispositivos con acciones pendientes
        if (pendingActionsByDevice[d._id] > 0) {
          return 'background-color: rgba(255, 193, 7, 0.15); border-left: 3px solid #FFC107;';
        }
        return '';
      }
    });

    const countEl = document.getElementById('device-count');
    if (countEl) countEl.textContent = `${devices.length} resultado(s)`;

    const pagEl = document.getElementById('devices-pagination');
    if (pagEl) {
      pagEl.innerHTML = `
        <span>${currentSkip + 1}–${currentSkip + devices.length}</span>
        <div class="pagination-buttons">
          <button class="btn btn-ghost btn-sm" id="pag-prev" ${currentSkip === 0 ? 'disabled' : ''}>← Anterior</button>
          <button class="btn btn-ghost btn-sm" id="pag-next" ${devices.length < PAGE_SIZE ? 'disabled' : ''}>Siguiente →</button>
        </div>`;

      document.getElementById('pag-prev').onclick = () => { currentSkip = Math.max(0, currentSkip - PAGE_SIZE); loadDevices(); };
      document.getElementById('pag-next').onclick = () => { currentSkip += PAGE_SIZE; loadDevices(); };
    }
  }

  return { render };
})();
