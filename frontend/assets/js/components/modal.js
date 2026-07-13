'use strict';

const Modal = (() => {
  function open({ title, body, onConfirm, confirmLabel = 'Confirmar', confirmClass = 'btn-primary' }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="modal-cancel">Cancelar</button>
          <button class="btn ${confirmClass}" id="modal-confirm">${confirmLabel}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#modal-confirm').onclick = async () => {
      try {
        if (onConfirm) await onConfirm(overlay);
        overlay.remove();
      } catch {
        // onConfirm lanza para mantener modal abierto (ej: error de validación)
      }
    };

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  function confirm(message) {
    return new Promise(resolve => {
      let resolved = false;
      open({
        title: 'Confirmar',
        body: `<p>${message}</p>`,
        confirmLabel: 'Confirmar',
        confirmClass: 'btn-danger',
        onConfirm: () => { resolved = true; resolve(true); }
      });
    });
  }

  return { open, confirm };
})();
