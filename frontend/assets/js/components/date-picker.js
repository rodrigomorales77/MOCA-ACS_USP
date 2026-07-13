'use strict';

const DatePicker = (() => {
  return {
    // Abre un modal con date picker
    // callback recibe la fecha ISO en GMT-3 o null si cancela
    show(title = 'Seleccionar fecha y hora', currentValue = null) {
      return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        `;

        // Parsear valor actual
        let dateValue = '';
        let timeValue = '00:00';
        if (currentValue) {
          const d = new Date(currentValue);
          if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            dateValue = `${year}-${month}-${day}`;
            timeValue = `${hours}:${minutes}`;
          }
        }

        modal.innerHTML = `
          <div style="
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            max-width: 400px;
            width: 90%;
          ">
            <h3 style="margin-top: 0; margin-bottom: 1.5rem;">${title}</h3>

            <div style="margin-bottom: 1rem;">
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Fecha</label>
              <input
                type="date"
                id="picker-date"
                value="${dateValue}"
                style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid #ddd;
                  border-radius: 4px;
                  font-size: 1rem;
                  box-sizing: border-box;
                "
              />
            </div>

            <div style="margin-bottom: 1.5rem;">
              <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Hora (GMT-3)</label>
              <input
                type="time"
                id="picker-time"
                value="${timeValue}"
                style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid #ddd;
                  border-radius: 4px;
                  font-size: 1rem;
                  box-sizing: border-box;
                "
              />
            </div>

            <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
              <button
                id="picker-cancel"
                class="btn btn-ghost"
                style="padding: 0.5rem 1rem; border: none; cursor: pointer; border-radius: 4px; background: #f0f0f0;"
              >
                Cancelar
              </button>
              <button
                id="picker-confirm"
                class="btn btn-primary"
                style="padding: 0.5rem 1rem; border: none; cursor: pointer; border-radius: 4px; background: #6c9bcf; color: white;"
              >
                Agendar
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(modal);

        const dateInput = document.getElementById('picker-date');
        const timeInput = document.getElementById('picker-time');

        document.getElementById('picker-cancel').onclick = () => {
          modal.remove();
          resolve(null);
        };

        document.getElementById('picker-confirm').onclick = () => {
          const date = dateInput.value;
          const time = timeInput.value;

          if (!date || !time) {
            alert('Por favor selecciona fecha y hora');
            return;
          }

          // Combinar fecha y hora con offset GMT-3
          // El offset -03:00 asegura que se interprete correctamente en todo lado
          const isoDateTime = `${date}T${time}:00-03:00`;
          modal.remove();
          resolve(isoDateTime);
        };

        // Focus en el input de fecha
        dateInput.focus();
      });
    }
  };
})();
