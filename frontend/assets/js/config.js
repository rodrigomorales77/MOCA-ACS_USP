'use strict';

// Configuración global de la aplicación
const Config = (() => {
  // Zona horaria y formato global
  const timezone = 'America/Argentina/Buenos_Aires'; // GMT-3
  const locale = 'es-AR';
  const dateFormat = '24hs'; // '24hs' o '12hs'

  return {
    timezone,
    locale,

    // Formatear fecha en la zona horaria configurada, formato 24hs
    formatDate(date, options = {}) {
      if (!date) return '—';

      const d = new Date(date);
      if (isNaN(d.getTime())) return '—';

      const defaultOptions = {
        timeZone: this.timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      };

      return d.toLocaleString(this.locale, { ...defaultOptions, ...options });
    },

    // Formatear solo la hora (para campos específicos)
    formatTime(date) {
      if (!date) return '—';
      const d = new Date(date);
      if (isNaN(d.getTime())) return '—';

      return d.toLocaleString(this.locale, {
        timeZone: this.timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    },

    // Formatear solo la fecha
    formatDateOnly(date) {
      if (!date) return '—';
      const d = new Date(date);
      if (isNaN(d.getTime())) return '—';

      return d.toLocaleString(this.locale, {
        timeZone: this.timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    }
  };
})();
