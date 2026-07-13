'use strict';

const AuditPage = (() => {
  let currentPage = 1;
  let pageSize = 50;
  let totalRecords = 0;
  let currentSearch = '';
  let currentAction = '';
  let currentTarget = '';

  async function loadAudit() {
    try {
      const params = new URLSearchParams({
        limit: pageSize,
        skip: (currentPage - 1) * pageSize,
        ...(currentSearch && { search: currentSearch }),
        ...(currentAction && { action: currentAction }),
        ...(currentTarget && { target: currentTarget })
      });

      const response = await API.get(`/audit?${params.toString()}`);
      return response;
    } catch (err) {
      console.error('Error loading audit:', err);
      return { data: [], total: 0 };
    }
  }

  async function render() {
    Header.render('Auditoría');
    const content = document.getElementById('page-content');

    content.innerHTML = `
      <div class="page-title">Logs de Auditoría</div>

      <div class="audit-controls">
        <div class="search-box">
          <input type="text" id="search-input" placeholder="Buscar por usuario, acción o archivo..." value="${currentSearch}" />
        </div>
        <div class="filter-box">
          <input type="text" id="action-filter" placeholder="Filtrar por acción" value="${currentAction}" />
          <input type="text" id="target-filter" placeholder="Filtrar por objetivo" value="${currentTarget}" />
          <button class="btn btn-sm btn-primary" id="apply-filters-btn">Filtrar</button>
          <button class="btn btn-sm btn-ghost" id="clear-filters-btn">Limpiar</button>
        </div>
      </div>

      <div id="audit-table" class="table-container">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Objetivo</th>
              <th>IP</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="5" style="text-align:center">Cargando...</td></tr>
          </tbody>
        </table>
      </div>

      <div class="pagination-controls">
        <button class="btn btn-sm btn-ghost" id="prev-page-btn" disabled>← Anterior</button>
        <span id="page-info" style="margin:0 1rem;font-size:0.9rem">Página 1</span>
        <button class="btn btn-sm btn-ghost" id="next-page-btn" disabled>Siguiente →</button>
      </div>
    `;

    // Load initial data
    await renderAuditTable();

    // Event listeners
    document.getElementById('apply-filters-btn').addEventListener('click', () => {
      currentSearch = document.getElementById('search-input').value.trim();
      currentAction = document.getElementById('action-filter').value.trim();
      currentTarget = document.getElementById('target-filter').value.trim();
      currentPage = 1;
      renderAuditTable();
    });

    document.getElementById('clear-filters-btn').addEventListener('click', () => {
      currentSearch = '';
      currentAction = '';
      currentTarget = '';
      document.getElementById('search-input').value = '';
      document.getElementById('action-filter').value = '';
      document.getElementById('target-filter').value = '';
      currentPage = 1;
      renderAuditTable();
    });

    document.getElementById('prev-page-btn').addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderAuditTable();
      }
    });

    document.getElementById('next-page-btn').addEventListener('click', () => {
      const maxPages = Math.ceil(totalRecords / pageSize);
      if (currentPage < maxPages) {
        currentPage++;
        renderAuditTable();
      }
    });

    // Allow Enter key on search
    document.getElementById('search-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('apply-filters-btn').click();
      }
    });
  }

  async function renderAuditTable() {
    const { data, total } = await loadAudit();
    totalRecords = total;

    const tbody = document.getElementById('audit-tbody');

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted)">Sin registros</td></tr>';
      updatePaginationControls();
      return;
    }

    tbody.innerHTML = data.map(log => {
      const date = typeof log.created_at === 'string' ? new Date(log.created_at) : log.created_at;
      const formattedDate = Config.formatDate(date);

      return `
        <tr>
          <td>${escapeHtml(log.username || '-')}</td>
          <td>${escapeHtml(log.action || '-')}</td>
          <td>${escapeHtml(log.target || '-')}</td>
          <td>${escapeHtml(log.ip || '-')}</td>
          <td>${formattedDate}</td>
        </tr>
      `;
    }).join('');

    updatePaginationControls();
  }

  function updatePaginationControls() {
    const maxPages = Math.ceil(totalRecords / pageSize);
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= maxPages;
    pageInfo.textContent = `Página ${currentPage} de ${maxPages || 1} (Total: ${totalRecords})`;
  }

  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  return { render };
})();
