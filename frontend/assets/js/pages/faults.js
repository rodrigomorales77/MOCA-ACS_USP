'use strict';

const FaultsPage = (() => {
  async function render() {
    Header.render('Fallas');
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading">Cargando fallas...</div>';

    const faults = await API.get('/faults?limit=100');
    const isAdmin = Auth.isAdmin();

    content.innerHTML = `
      <h1 class="page-title">Fallas Activas <span style="font-size:1rem;color:var(--color-text-muted)">(${faults.length})</span></h1>
      <div class="table-wrapper">
        <div id="faults-table"></div>
      </div>`;

    const columns = [
      { key: '_id',     label: 'ID' },
      { key: 'device',  label: 'Dispositivo' },
      { key: 'channel', label: 'Canal' },
      { key: 'code',    label: 'Código' },
      { key: 'message', label: 'Mensaje' },
      {
        label: 'Fecha',
        render: f => f.timestamp
          ? Config.formatDate(new Date(f.timestamp.$date || f.timestamp))
          : '—'
      }
    ];

    if (isAdmin) {
      columns.push({
        label: 'Acción',
        render: f => `<button class="btn btn-danger btn-sm" data-fault="${f._id}">Limpiar</button>`
      });
    }

    Table.render({
      container: document.getElementById('faults-table'),
      columns,
      rows: faults,
      emptyMessage: '✅ Sin fallas activas'
    });

    if (isAdmin) {
      document.getElementById('faults-table').querySelectorAll('[data-fault]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const faultId = btn.dataset.fault;
          if (!await Modal.confirm(`¿Limpiar la falla "${faultId}"?`)) return;
          await API.delete(`/faults/${encodeURIComponent(faultId)}`);
          render();
        });
      });
    }
  }

  return { render };
})();
