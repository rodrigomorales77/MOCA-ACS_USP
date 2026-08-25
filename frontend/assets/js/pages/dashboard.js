'use strict';

const DashboardPage = (() => {
  let autoRefreshInterval = null;
  let autoRefreshSeconds = 0;

  const autoRefreshOptions = [
    { value: 0, label: 'Desactivado' },
    { value: 30, label: '30 segundos' },
    { value: 60, label: '1 minuto' },
    { value: 120, label: '2 minutos' },
    { value: 300, label: '5 minutos' },
    { value: 600, label: '10 minutos' },
    { value: 1800, label: '30 minutos' },
    { value: 3600, label: '1 hora' }
  ];

  function setAutoRefresh(seconds) {
    autoRefreshSeconds = seconds;
    localStorage.setItem('dashboard_autorefresh', seconds);

    if (autoRefreshInterval) clearInterval(autoRefreshInterval);

    if (seconds > 0) {
      autoRefreshInterval = setInterval(() => render(), seconds * 1000);
    }
  }

  async function render() {
    Header.render('Dashboard');
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="dashboard-loading"><div class="spinner"></div><p>Cargando métricas...</p></div>';

    try {
      const [faultsRes, stats] = await Promise.all([
        API.get('/faults?limit=200&sort=' + encodeURIComponent('{"timestamp":-1}')),
        API.get('/devices/stats/summary')
      ]);
      const faultList = Array.isArray(faultsRes) ? faultsRes : (faultsRes.faults || []);
      const faultsTotal = Array.isArray(faultsRes) ? faultsRes.length : (faultsRes.total ?? faultList.length);

      const lastUpdate = Config.formatDate(new Date());
      const onlinePercent = stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0;
      const offlinePercent = stats.total > 0 ? Math.round((stats.offline / stats.total) * 100) : 0;

      content.innerHTML = `
        <div class="dashboard-container">
          <div class="dashboard-header">
            <div>
              <h1 class="dashboard-title">Sistema de Dispositivos</h1>
              <p class="dashboard-subtitle">Monitoreo en tiempo real de tu red</p>
            </div>
            <div class="dashboard-controls">
              <div class="control-group">
                <label class="control-label">Auto-actualizar:</label>
                <select id="autorefresh-select" class="control-select">
                  ${autoRefreshOptions.map(o => `<option value="${o.value}" ${autoRefreshSeconds === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
              </div>
              <button id="refresh-btn" class="btn-refresh">↻ Actualizar</button>
            </div>
          </div>

          <div class="metrics-grid">
            <div class="metric-card metric-card-primary" style="animation-delay: 0s">
              <div class="metric-icon">📊</div>
              <div class="metric-content">
                <div class="metric-value">${stats.total}</div>
                <div class="metric-label">Total Dispositivos</div>
              </div>
            </div>

            <div class="metric-card metric-card-success" style="animation-delay: 0.05s">
              <div class="metric-icon">✓</div>
              <div class="metric-content">
                <div class="metric-value">${stats.online}</div>
                <div class="metric-label">Online <span class="metric-percent">${onlinePercent}%</span></div>
              </div>
              <div class="metric-bar" style="width: ${onlinePercent}%"></div>
            </div>

            <div class="metric-card metric-card-danger" style="animation-delay: 0.1s">
              <div class="metric-icon">✕</div>
              <div class="metric-content">
                <div class="metric-value">${stats.offline}</div>
                <div class="metric-label">Offline <span class="metric-percent">${offlinePercent}%</span></div>
              </div>
              <div class="metric-bar" style="width: ${offlinePercent}%; background: var(--color-offline)"></div>
            </div>

            <div class="metric-card metric-card-warning" style="animation-delay: 0.15s">
              <div class="metric-icon">⚠</div>
              <div class="metric-content">
                <div class="metric-value">${faultsTotal}</div>
                <div class="metric-label">Fallas Activas</div>
              </div>
            </div>

            <div class="metric-card metric-card-primary" style="animation-delay: 0.2s">
              <div class="metric-icon">🏭</div>
              <div class="metric-content">
                <div class="metric-value">${stats.manufacturerCount}</div>
                <div class="metric-label">Fabricantes</div>
              </div>
            </div>

            <div class="metric-card metric-card-primary" style="animation-delay: 0.25s">
              <div class="metric-icon">📦</div>
              <div class="metric-content">
                <div class="metric-value">${stats.modelCount}</div>
                <div class="metric-label">Modelos</div>
              </div>
            </div>
          </div>

          <div class="charts-section">
            <div class="chart-container chart-container-half">
              <div class="chart-title">Online vs Offline</div>
              <div id="chart-status"></div>
            </div>

            <div class="chart-container chart-container-half">
              <div class="chart-title">Top Fabricantes</div>
              <div id="chart-brands"></div>
            </div>
          </div>

          <div class="dashboard-footer">
            <div class="footer-left">
              <span class="update-label">Última actualización:</span>
              <span class="update-time">${lastUpdate}</span>
            </div>
            <div class="footer-right">
              <span class="status-indicator status-live"></span>
              <span class="status-text">En vivo</span>
            </div>
          </div>
        </div>`;

      // Renderizar gráficos
      renderStatusChart(stats.online, stats.offline);
      renderBrandsChart(stats.brands);

      document.getElementById('autorefresh-select').addEventListener('change', (e) => {
        setAutoRefresh(parseInt(e.target.value));
      });

      document.getElementById('refresh-btn').addEventListener('click', () => {
        render();
      });
    } catch (err) {
      content.innerHTML = `<div class="empty-state">Error al cargar el dashboard: ${err.message}</div>`;
    }
  }

  function renderStatusChart(online, offline) {
    const container = document.getElementById('chart-status');
    const total = online + offline;
    const onlinePercent = total > 0 ? (online / total) * 100 : 0;
    const offlinePercent = total > 0 ? (offline / total) * 100 : 0;

    container.innerHTML = `
      <div class="simple-chart">
        <div class="pie-chart">
          <svg viewBox="0 0 100 100" width="150" height="150">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#e0e7ff" stroke-width="8" />
            <circle cx="50" cy="50" r="45" fill="none" stroke="#7EC8A4" stroke-width="8"
              stroke-dasharray="${onlinePercent * 2.83} 283"
              stroke-linecap="round"
              style="transform: rotate(-90deg); transform-origin: 50% 50%;" />
          </svg>
          <div class="pie-label">
            <div class="pie-value">${onlinePercent.toFixed(0)}%</div>
            <div class="pie-text">Online</div>
          </div>
        </div>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-color" style="background: #7EC8A4"></span>
            <span>Online: <strong>${online}</strong></span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: #E07B8A"></span>
            <span>Offline: <strong>${offline}</strong></span>
          </div>
        </div>
      </div>`;
  }

  function renderBrandsChart(brands) {
    const container = document.getElementById('chart-brands');

    if (!brands || brands.length === 0) {
      container.innerHTML = '<div class="empty-chart">Sin datos de fabricantes</div>';
      return;
    }

    const maxCount = Math.max(...brands.map(b => b.count));
    const colors = ['#6C9BCF', '#7EC8A4', '#F4A96A', '#E07B8A', '#A78BFA'];

    const barsHTML = brands.slice(0, 5).map((brand, i) => {
      const percent = (brand.count / maxCount) * 100;
      const color = colors[i % colors.length];
      return `
        <div class="bar-item">
          <div class="bar-label">${brand.name}</div>
          <div class="bar-container">
            <div class="bar-fill" style="width: ${percent}%; background: ${color}"></div>
          </div>
          <div class="bar-value">${brand.count}</div>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="bar-chart">${barsHTML}</div>`;
  }

  return {
    render: function() {
      const saved = localStorage.getItem('dashboard_autorefresh');
      if (saved) {
        autoRefreshSeconds = parseInt(saved);
        if (autoRefreshSeconds > 0) {
          setAutoRefresh(autoRefreshSeconds);
        }
      }
      render();
    }
  };
})();
