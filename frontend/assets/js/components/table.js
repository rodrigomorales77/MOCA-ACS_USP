'use strict';

const Table = (() => {
  function render({ container, columns, rows, onRowClick, emptyMessage = 'Sin resultados', rowStyle = null }) {
    if (!rows.length) {
      container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
      return;
    }

    const thead = columns.map(c => `<th>${c.label}</th>`).join('');
    const tbody = rows.map(row => {
      const id = row._id || row.id || '';
      const cells = columns.map(c => `<td>${c.render ? c.render(row) : (row[c.key] ?? '')}</td>`).join('');
      const style = rowStyle ? ` style="${rowStyle(row)}"` : '';
      return `<tr class="${onRowClick ? 'clickable-row' : ''}" data-id="${id}"${style}>${cells}</tr>`;
    }).join('');

    container.innerHTML = `
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>`;

    if (onRowClick) {
      container.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const row = rows.find(r => String(r._id || r.id) === tr.dataset.id);
          onRowClick(tr.dataset.id, row);
        });
      });
    }
  }

  return { render };
})();
