'use strict';

const Badge = (() => {
  function status(value) {
    const map = {
      true:    ['online',  '● Online'],
      false:   ['offline', '● Offline'],
      online:  ['online',  '● Online'],
      offline: ['offline', '● Offline'],
    };
    const [cls, label] = map[String(value)] || ['fault', value];
    return `<span class="badge badge-${cls}">${label}</span>`;
  }

  function role(value) {
    return `<span class="badge badge-${value}">${value}</span>`;
  }

  return { status, role };
})();
