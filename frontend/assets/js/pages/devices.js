'use strict';

const DevicesPage = (() => {
  const PAGE_SIZE = 25;
  let currentSkip = 0;
  let currentSearch = '';
  let currentStatusFilter = ''; // '' = todos, 'online', 'offline', 'pending'
  let pendingActionsByDevice = {}; // deviceId -> count
  let searchTimer = null; // debounce del buscador
  let requestSeq = 0; // descarta respuestas desactualizadas si tipean rápido

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
      // Debounce: una request por tecla satura al backend y puede resolver
      // fuera de orden mientras se tipea.
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentSkip = 0;
        loadDevices();
      }, 300);
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

    // Filtro de estado y búsqueda se aplican server-side sobre el snapshot de
    // flota: la paginación es coherente porque el backend filtra ANTES del slice
    // (el filtro client-side sobre páginas ya recortadas mostraba tablas vacías).
    let queryParams = '';
    if (currentSearch) queryParams += `&search=${encodeURIComponent(currentSearch)}`;
    if (currentStatusFilter) queryParams += `&status=${encodeURIComponent(currentStatusFilter)}`;

    const seq = ++requestSeq;

    // El backend responde { total, devices }: total es el tamaño del conjunto
    // FILTRADO completo y devices la página actual — así el contador y el
    // paginador reflejan el total aunque se muestren de a 25.
    const data = await API.get(
      `/devices?limit=${PAGE_SIZE}&skip=${currentSkip}${queryParams}`
    );
    if (seq !== requestSeq) return; // llegó una búsqueda más nueva: esta respuesta ya no aplica

    const { total, devices } = data;

    // Cargar acciones pendientes para marcar dispositivos
    try {
      const response = await API.get('/pending-actions?limit=1000&status=pending');
      if (seq !== requestSeq) return;
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

    Table.render({
      container: tableEl,
      columns: [
        { key: '_id', label: 'Device ID' },
        {
          label: 'Modelo',
          // El backend garantiza el fallback a _ProductClass (Zhone no reporta
          // ModelName en el Inform), así que basta con el campo plano.
          render: d => d._model || '—'
        },
        {
          label: 'IP MGMT',
          render: d => d._mgmtIp || '—'
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
      rows: devices,
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
    if (countEl) countEl.textContent = `${total} resultado(s)`;

    const pagEl = document.getElementById('devices-pagination');
    if (pagEl) {
      pagEl.innerHTML = `
        <span>${total === 0 ? 'Sin resultados' : `${currentSkip + 1}–${Math.min(currentSkip + PAGE_SIZE, total)} de ${total}`}</span>
        <div class="pagination-buttons">
          <button class="btn btn-ghost btn-sm" id="pag-prev" ${currentSkip === 0 ? 'disabled' : ''}>← Anterior</button>
          <button class="btn btn-ghost btn-sm" id="pag-next" ${currentSkip + PAGE_SIZE >= total ? 'disabled' : ''}>Siguiente →</button>
        </div>`;

      document.getElementById('pag-prev').onclick = () => { currentSkip = Math.max(0, currentSkip - PAGE_SIZE); loadDevices(); };
      document.getElementById('pag-next').onclick = () => { currentSkip += PAGE_SIZE; loadDevices(); };
    }
  }

  return { render };
})();
