'use strict';

const FaultsPage = (() => {
  const LIMIT = 100;
  let skip = 0;
  let total = 0;

  async function load(targetSkip) {
    Header.render('Fallas');
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading">Cargando fallas...</div>';

    const sort = encodeURIComponent('{"timestamp":-1}');
    const res = await API.get(`/faults?limit=${LIMIT}&skip=${targetSkip}&sort=${sort}`);

    const faults = Array.isArray(res) ? res : (res.faults || []);
    total = Array.isArray(res) ? res.length : (res.total ?? faults.length);
    skip = Array.isArray(res) ? 0 : (res.skip ?? targetSkip);

    const isAdmin = Auth.isAdmin();

    const start = total === 0 ? 0 : skip + 1;
    const end = Math.min(skip + faults.length, total);
    const rangeText = total === 0 ? 'Sin fallas' : `Mostrando ${start}–${end} de ${total}`;

    content.innerHTML = `
      <h1 class="page-title">Fallas Activas <span style="font-size:1rem;color:var(--color-text-muted)">(${total})</span></h1>
      <div style="margin:8px 0 12px;color:var(--color-text-muted);font-size:0.9rem">${rangeText} · orden: más recientes primero</div>
      <div class="table-wrapper">
        <div id="faults-table"></div>
      </div>
      <div id="faults-pagination" style="display:flex;gap:8px;align-items:center;margin-top:12px">
        <button id="faults-prev" class="btn btn-sm" ${skip === 0 ? 'disabled' : ''}>← Anterior</button>
        <span style="font-size:0.9rem;color:var(--color-text-muted)">Página ${total === 0 ? 0 : Math.floor(skip / LIMIT) + 1} de ${Math.max(1, Math.ceil(total / LIMIT))}</span>
        <button id="faults-next" class="btn btn-sm" ${skip + LIMIT >= total ? 'disabled' : ''}>Siguiente →</button>
      </div>`;

    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function faultDetail(f) {
      const d = f.detail || {};
      const spv = d.setParameterValuesFault && d.setParameterValuesFault[0];
      if (spv) {
        const name = spv.parameterName || '';
        const msg = spv.faultString || spv.faultCode || '';
        const full = name ? `${name}: ${msg}` : msg;
        return `<span title="${escapeHtml(full)}">${escapeHtml(full) || '—'}</span>`;
      }
      if (d.faultString) return `<span title="${escapeHtml(d.faultString)}">${escapeHtml(d.faultString)}</span>`;
      if (d.faultCode) return `<span title="${escapeHtml(d.faultCode)}">${escapeHtml(d.faultCode)}</span>`;
      return '—';
    }

    const columns = [
      { key: '_id',     label: 'ID' },
      { key: 'device',  label: 'Dispositivo' },
      { key: 'channel', label: 'Canal' },
      { key: 'code',    label: 'Código' },
      { key: 'message', label: 'Mensaje' },
      { label: 'Detalle', render: faultDetail },
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

    document.getElementById('faults-prev').addEventListener('click', () => {
      if (skip === 0) return;
      load(Math.max(0, skip - LIMIT));
    });
    document.getElementById('faults-next').addEventListener('click', () => {
      if (skip + LIMIT >= total) return;
      load(skip + LIMIT);
    });

    if (isAdmin) {
      document.getElementById('faults-table').querySelectorAll('[data-fault]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const faultId = btn.dataset.fault;
          if (!await Modal.confirm(`¿Limpiar la falla "${faultId}"?`)) return;
          await API.delete(`/faults/${encodeURIComponent(faultId)}`);
          // Recargar página actual; si era el último de la página y queda vacía, retroceder
          const remaining = total - 1;
          const maxSkip = Math.max(0, Math.ceil(remaining / LIMIT) - 1) * LIMIT;
          const nextSkip = skip > maxSkip ? maxSkip : skip;
          total = remaining;
          load(nextSkip);
        });
      });
    }
  }

  async function render() {
    skip = 0;
    await load(0);
  }

  return { render };
})();
