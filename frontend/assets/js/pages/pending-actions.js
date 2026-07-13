'use strict';

const PendingActionsPage = (() => {
  const PAGE_SIZE = 25;
  let currentPage = 1;
  let currentSearch = '';
  let currentStatus = 'pending'; // Default to pending status
  let totalActions = 0;

  async function render() {
    Header.render('Acciones Pendientes');
    const content = document.getElementById('page-content');
    const isAdmin = Auth.isAdmin();

    content.innerHTML = `
      <h1 class="page-title">Acciones Pendientes</h1>
      <div class="table-wrapper">
        <div class="table-toolbar">
          <input class="search-input" id="search" placeholder="Buscar dispositivo o parámetro..." value="${currentSearch}" style="width:350px" />
          <select id="status-filter" class="form-select" style="width:auto;padding:0.45rem;font-size:var(--font-size-sm)">
            <option value="">Todos los estados</option>
            <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>Pendiente</option>
            <option value="scheduled" ${currentStatus === 'scheduled' ? 'selected' : ''}>Programado</option>
            <option value="applied" ${currentStatus === 'applied' ? 'selected' : ''}>Aplicado</option>
            <option value="failed" ${currentStatus === 'failed' ? 'selected' : ''}>Error</option>
          </select>
          <span id="count" style="color:var(--color-text-muted);font-size:0.875rem"></span>
        </div>
        <div id="actions-table"></div>
        <div class="pagination" id="pagination"></div>
      </div>

      <div class="card" style="margin-top:1.5rem">
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-apply-selected" ${!isAdmin ? 'disabled' : ''} title="${!isAdmin ? 'Solo administradores' : ''}">✓ Aplicar seleccionadas</button>
          <button class="btn btn-danger" id="btn-delete-selected" ${!isAdmin ? 'disabled' : ''} title="${!isAdmin ? 'Solo administradores' : ''}">🗑 Eliminar seleccionadas</button>
          <button class="btn btn-ghost" id="btn-clear-filters">Limpiar filtros</button>
        </div>
      </div>`;

    document.getElementById('search').addEventListener('input', e => {
      currentSearch = e.target.value;
      currentPage = 1;
      loadActions();
    });

    document.getElementById('status-filter').addEventListener('change', e => {
      currentStatus = e.target.value;
      currentPage = 1;
      loadActions();
    });

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      currentSearch = '';
      currentStatus = '';
      currentPage = 1;
      document.getElementById('search').value = '';
      document.getElementById('status-filter').value = '';
      loadActions();
    });

    if (isAdmin) {
      document.getElementById('btn-apply-selected').addEventListener('click', applySelected);
      document.getElementById('btn-delete-selected').addEventListener('click', deleteSelected);
    }

    window.pendingActionsIsAdmin = isAdmin; // Global para usar en renderTable
    loadActions();
  }

  async function loadActions() {
    const tableEl = document.getElementById('actions-table');
    tableEl.innerHTML = '<div class="loading">Cargando...</div>';

    try {
      let url = `/pending-actions?limit=${PAGE_SIZE}&skip=${(currentPage - 1) * PAGE_SIZE}`;
      if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;
      if (currentStatus) url += `&status=${currentStatus}`;

      const response = await API.get(url);
      totalActions = response.total;

      renderTable(response.actions, tableEl);
      renderPagination(response.actions.length);
      document.getElementById('count').textContent = `${totalActions} acción(es)`;
    } catch (err) {
      tableEl.innerHTML = `<div class="empty-state">Error al cargar: ${err.message}</div>`;
    }
  }

  function renderTable(actions, container) {
    if (!actions.length) {
      container.innerHTML = '<div class="empty-state">No hay acciones pendientes</div>';
      return;
    }

    const rows = actions.map(a => {
      const status = getStatusBadge(a.status);
      const scheduledText = a.scheduled_for ? `<br><small style="color:var(--color-text-muted)">Programado: ${Config.formatDate(a.scheduled_for)}</small>` : '';
      const errorText = a.error ? `<br><small style="color:var(--color-danger)">${a.error}</small>` : '';
      const isApplied = a.status === 'applied';
      const canModify = (a.status === 'pending' || a.status === 'scheduled') && window.pendingActionsIsAdmin;

      return `
        <tr ${isApplied ? 'style="opacity:0.6"' : ''}>
          <td style="width:2%"><input type="checkbox" class="action-checkbox" value="${a.id}" ${isApplied || !window.pendingActionsIsAdmin ? 'disabled' : ''} /></td>
          <td style="width:15%"><strong>${a.device_id}</strong><br><small>${a.device_ip || '—'}</small></td>
          <td style="width:30%">
            <code style="font-size:0.75rem;word-break:break-all">${a.parameter_path}</code>
          </td>
          <td style="width:15%">
            <small><strong>${truncate(a.old_value, 20)}</strong></small><br>
            <small style="color:var(--color-primary)">→ ${truncate(a.new_value, 20)}</small>
          </td>
          <td style="width:12%">${status}${scheduledText}${errorText}</td>
          <td style="width:12%">
            <small>${a.username}</small><br>
            <small style="color:var(--color-text-muted)">${Config.formatDate(a.created_at)}</small>
          </td>
          <td style="width:14%;text-align:center">
            ${canModify ? `
              <button class="btn btn-primary btn-sm" onclick="PendingActionsPage.editSchedule(${a.id}, '${a.scheduled_for}')">📅</button>
              <button class="btn btn-danger btn-sm" onclick="PendingActionsPage.deleteAction(${a.id})">🗑</button>
            ` : isApplied ? '<span style="color:var(--color-text-muted)">Aplicado</span>' : '-'}
          </td>
        </tr>`;
    }).join('');

    container.innerHTML = `<table class="param-table">
      <thead>
        <tr>
          <th style="width:2%"><input type="checkbox" id="select-all" /></th>
          <th style="width:15%">Dispositivo</th>
          <th style="width:30%">Parámetro</th>
          <th style="width:15%">Valor</th>
          <th style="width:12%">Estado</th>
          <th style="width:12%">Usuario</th>
          <th style="width:14%">Acciones</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

    // Select all checkbox (only affects non-disabled checkboxes)
    document.getElementById('select-all').addEventListener('change', function() {
      document.querySelectorAll('.action-checkbox:not(:disabled)').forEach(cb => cb.checked = this.checked);
    });
  }

  function renderPagination(pageSize) {
    const totalPages = Math.ceil(totalActions / PAGE_SIZE);
    const pagEl = document.getElementById('pagination');

    if (totalPages <= 1) {
      pagEl.innerHTML = '';
      return;
    }

    pagEl.innerHTML = `
      <span>${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalActions)} de ${totalActions}</span>
      <div class="pagination-buttons">
        <button class="btn btn-ghost btn-sm" id="pag-prev" ${currentPage === 1 ? 'disabled' : ''}>← Anterior</button>
        <span style="font-size:0.875rem;color:var(--color-text-muted)">Página ${currentPage}/${totalPages}</span>
        <button class="btn btn-ghost btn-sm" id="pag-next" ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente →</button>
      </div>`;

    document.getElementById('pag-prev').onclick = () => {
      if (currentPage > 1) { currentPage--; loadActions(); }
    };
    document.getElementById('pag-next').onclick = () => {
      if (currentPage < totalPages) { currentPage++; loadActions(); }
    };
  }

  function getStatusBadge(status) {
    const badges = {
      pending: '<span class="badge badge-offline">Pendiente</span>',
      scheduled: '<span class="badge badge-fault">Programado</span>',
      applied: '<span class="badge badge-online">Aplicado</span>',
      failed: '<span class="badge" style="background:#FDE8EB;color:#9B2335">Error</span>'
    };
    return badges[status] || status;
  }

  function truncate(str, len) {
    if (!str) return '—';
    const s = String(str);
    return s.length > len ? s.substring(0, len) + '…' : s;
  }

  async function applySelected() {
    const selected = Array.from(document.querySelectorAll('.action-checkbox:checked')).map(cb => parseInt(cb.value));
    if (selected.length === 0) {
      alert('Selecciona al menos una acción');
      return;
    }

    if (!confirm(`¿Aplicar ${selected.length} acción(es)?`)) return;

    LoadingOverlay.show('Aplicando acciones...');
    try {
      const response = await API.post('/pending-actions/apply-batch', { actionIds: selected });
      LoadingOverlay.hide();

      // Mostrar resultados detallados
      if (response.results) {
        const successCount = response.results.filter(r => r.success).length;
        const failCount = response.results.filter(r => !r.success).length;

        let message = `✓ Aplicadas: ${successCount}`;
        if (failCount > 0) {
          const errors = response.results.filter(r => !r.success).map(r => `${r.deviceId}: ${r.error}`).join('\n');
          message += `\n✗ Errores: ${failCount}\n\n${errors}`;
        }
        alert(message);
      } else {
        alert('✓ Acciones procesadas');
      }

      currentPage = 1;
      loadActions();
    } catch (err) {
      LoadingOverlay.hide();
      alert('Error: ' + err.message);
    }
  }

  async function deleteSelected() {
    const selected = Array.from(document.querySelectorAll('.action-checkbox:checked')).map(cb => parseInt(cb.value));
    if (selected.length === 0) {
      alert('Selecciona al menos una acción');
      return;
    }

    if (!confirm(`¿Eliminar ${selected.length} acción(es)? No se puede deshacer.`)) return;

    try {
      for (const id of selected) {
        await API.delete(`/pending-actions/${id}`);
      }
      alert('Acciones eliminadas');
      currentPage = 1;
      loadActions();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  return {
    render,
    deleteAction: async function(id) {
      if (confirm('¿Eliminar esta acción?')) {
        try {
          await API.delete(`/pending-actions/${id}`);
          loadActions();
        } catch (err) {
          alert('Error: ' + err.message);
        }
      }
    },
    editSchedule: async function(id, currentScheduled) {
      const newTime = await DatePicker.show('Agendar ejecución', currentScheduled);
      if (newTime === null) return;

      try {
        await API.patch(`/pending-actions/${id}`, {
          scheduledFor: newTime || null
        });
        loadActions();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  };
})();
