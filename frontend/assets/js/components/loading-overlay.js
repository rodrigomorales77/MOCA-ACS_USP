'use strict';

const LoadingOverlay = (() => {
  let overlay = null;

  return {
    show(message = 'Procesando...') {
      if (overlay) return; // Ya está visible

      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      `;

      overlay.innerHTML = `
        <div style="
          text-align: center;
          background: white;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        ">
          <div style="
            width: 50px;
            height: 50px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #6c9bcf;
            border-radius: 50%;
            margin: 0 auto 1rem;
            animation: spin 1s linear infinite;
          "></div>
          <div style="
            font-size: 1rem;
            color: #333;
            margin-bottom: 0.5rem;
          ">${message}</div>
          <div style="
            font-size: 0.85rem;
            color: #999;
          ">Por favor espera...</div>
        </div>

        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `;

      document.body.appendChild(overlay);
    },

    hide() {
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
    }
  };
})();
