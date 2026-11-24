/* ============================================================
   AI Enabled Unified Real-Time Air Quality Analytics
   Frontend logic: data fetching, rendering, charts, refresh
   ============================================================ */

/* ---------- 1. CONFIGURATION ---------- */
const CONFIG = {
  API: {
    dashboard: '/api/dashboard',   // Flask endpoint: current readings + prediction
    history: '/api/history',       // Flask endpoint: historical readings for charts
    timeoutMs: 8000
  },

  REFRESH_INTERVAL_MS: 60000,      // Auto-refresh every 60 seconds

  /*
   * ILLUSTRATIVE THRESHOLDS ONLY.
   * These are NOT health or regulatory limits. Replace them with values
   * approved for your project. Set a value to null to keep a sensor neutral.
   */
  THRESHOLDS: {
    pm25:        { attention: 35 },   // illustrative: red when above this
    pm10:        { attention: 100 },  // illustrative: red when above this
    mq135:       { monitor: 200 },    // illustrative: amber when above this (calibration/monitoring)
    temperature: null,                // neutral unless configured
    humidity:    null,                // neutral unless configured
    light:       null                 // neutral unless configured
  }
};

/* Sensor display metadata */
const SENSOR_META = {
  temperature: { label: 'Temperature', emoji: '🌡️', unit: '°C',    name: 'Temperature' },
  humidity:    { label: 'Humidity',    emoji: '💧', unit: '%',     name: 'Humidity' },
  light:       { label: 'Light',       emoji: '💡', unit: 'lux',   name: 'Light Intensity' },
  mq135:       { label: 'MQ135',       emoji: '🧪', unit: 'raw',   name: 'MQ135 Gas Sensor' },
  pm25:        { label: 'PM2.5',       emoji: '🌫️', unit: 'µg/m³', name: 'PM2.5' },
  pm10:        { label: 'PM10',        emoji: '🌫️', unit: 'µg/m³', name: 'PM10' }
};

/* Suggested actions when a sensor needs attention */
const SUGGESTIONS = {
  pm25:  'Check ventilation, reduce indoor smoke or dust sources, and review the PM2.5 trend before taking further action.',
  pm10:  'Inspect dust sources nearby and consider filtration or ventilation changes. Verify sensor placement.',
  mq135: 'Recalibrate the MQ135 sensor and confirm readings against a reference before drawing conclusions.'
};

/* Category text (generic placeholders) */
const STATUS_INFO = {
  GOOD:     { emoji: '🟢', label: 'GOOD',     level: 'good',     text: 'Air quality appears satisfactory based on current readings.' },
  MODERATE: { emoji: '🟡', label: 'MODERATE', level: 'moderate', text: 'Air quality is acceptable overall, but some readings warrant monitoring.' },
  BAD:      { emoji: '🔴', label: 'BAD',      level: 'bad',      text: 'Air quality may be poor. Review the highlighted readings and consider reducing exposure.' },
  UNKNOWN:  { emoji: '⚪', label: 'UNKNOWN',  level: 'unknown',  text: 'No prediction is available yet.' }
};

/* ---------- 2. DEMO DATA (used when backend is unavailable) ---------- */
function getDemoDashboard() {
  return {
    project_name: 'AI Enabled Unified Real-Time Air Quality Analytics',
    data_source: 'demo',
    last_updated: new Date().toISOString(),
    prediction: 'MODERATE',
    estimated_aqi: null,                 // null -> displayed as N/A
    explanation: 'Demo prediction: PM2.5 is slightly elevated relative to the illustrative threshold. Other sensors are within normal demo ranges.',
    model: { name: 'Decision Tree', primary_feature: 'PM2.5' },
    sensors: {
      temperature: 27.4,
      humidity: 61,
      light: 412,
      mq135: 168,
      pm25: 38.5,
      pm10: 74
    }
  };
}

function getDemoHistory(points = 24) {
  const labels = [];
  const pm25 = [], pm10 = [], temperature = [], humidity = [];
  const now = new Date();

  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 60 * 1000);
    labels.push(t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    const phase = (points - 1 - i) / 3;
    pm25.push(+(30 + 14 * Math.sin(phase) + Math.random() * 6).toFixed(1));
    pm10.push(+(65 + 25 * Math.sin(phase + 0.6) + Math.random() * 10).toFixed(1));
    temperature.push(+(26.5 + 2.2 * Math.sin(phase / 2) + Math.random() * 0.5).toFixed(1));
    humidity.push(+(60 + 6 * Math.cos(phase / 2) + Math.random() * 2).toFixed(1));
  }

  return { labels, pm25, pm10, temperature, humidity, data_source: 'demo' };
}

/* ---------- 3. API FUNCTIONS ---------- */
async function fetchWithTimeout(url, timeoutMs = CONFIG.API.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches current dashboard data from /api/dashboard */
async function fetchDashboard() {
  return fetchWithTimeout(CONFIG.API.dashboard);
}

/** Fetches historical readings from /api/history */
async function fetchHistory() {
  return fetchWithTimeout(CONFIG.API.history);
}

/* ---------- 4. EVALUATION LOGIC ---------- */
/** Returns a status level for a sensor: 'neutral' | 'ok' | 'monitor' | 'attention' */
function evaluateSensor(key, value) {
  const rule = CONFIG.THRESHOLDS[key];
  if (value === null || value === undefined || Number.isNaN(value)) return 'neutral';
  if (!rule) return 'neutral';

  if (rule.attention !== undefined && value > rule.attention) return 'attention';
  if (rule.monitor !== undefined && value > rule.monitor) return 'monitor';
  return 'ok';
}

const LEVEL_TEXT = {
  neutral:   'Neutral',
  ok:        'Normal',
  monitor:   'Monitor',
  attention: 'Attention'
};

/** Builds the list of readings that need review */
function buildAlerts(sensors) {
  const alerts = [];
  for (const key of Object.keys(SENSOR_META)) {
    const level = evaluateSensor(key, sensors[key]);
    if (level === 'attention' || level === 'monitor') {
      alerts.push({
        key,
        level,
        icon: level === 'attention' ? '🔴' : '🟡',
        title: `${SENSOR_META[key].label}: ${sensors[key]} ${SENSOR_META[key].unit}`,
        message: level === 'attention'
          ? 'Above the configured attention threshold.'
          : 'Above the configured monitoring threshold.',
        suggestion: SUGGESTIONS[key] || 'Review this reading against your project guidelines.'
      });
    }
  }
  return alerts;
}

/* ---------- 5. RENDERING ---------- */
function renderStatus(data) {
  const key = (data.prediction || 'UNKNOWN').toUpperCase();
  const info = STATUS_INFO[key] || STATUS_INFO.UNKNOWN;

  document.getElementById('statusCard').dataset.level = info.level;
  document.getElementById('statusEmoji').textContent = info.emoji;
  document.getElementById('statusLabel').textContent = info.label;
  document.getElementById('predictedValue').textContent = info.label;

  const aqi = data.estimated_aqi;
  document.getElementById('aqiValue').textContent =
    aqi === null || aqi === undefined ? 'N/A' : aqi;

  document.getElementById('statusExplanation').textContent =
    data.explanation || info.text;
}

function renderSensors(sensors) {
  for (const key of Object.keys(SENSOR_META)) {
    const value = sensors[key];
    const level = evaluateSensor(key, value);

    // Value text
    const valEl = document.getElementById(`val-${key}`);
    valEl.textContent = (value === null || value === undefined)
      ? '--'
      : (Number.isInteger(value) ? value : Number(value).toFixed(1));

    // Status pill
    const pill = document.getElementById(`status-${key}`);
    pill.className = 'status-pill ' + (level === 'neutral' ? 'neutral' : level);
    pill.textContent = LEVEL_TEXT[level];

    // Card highlight (PM2.5, PM10 red; MQ135 amber; others neutral)
    const card = document.querySelector(`.sensor-card[data-sensor="${key}"]`);
    card.classList.remove('attention', 'monitor');
    if (level === 'attention' || level === 'monitor') card.classList.add(level);
  }
}

function renderAlerts(sensors, prediction) {
  const alerts = buildAlerts(sensors);
  const list = document.getElementById('alertList');
  const countEl = document.getElementById('alertCount');
  const suggestionEl = document.getElementById('suggestedAction');

  countEl.textContent = alerts.length;

  if (alerts.length === 0) {
    list.innerHTML = `<li class="alert-empty">✅ All configured readings are within illustrative thresholds.</li>`;
    suggestionEl.textContent = 'Continue monitoring. No immediate action is suggested by the current readings.';
    return;
  }

  list.innerHTML = alerts.map(a => `
    <li class="alert-item ${a.level}">
      <span class="alert-icon">${a.icon}</span>
      <div>
        <strong>${a.title}</strong>
        <p>${a.message}</p>
      </div>
    </li>
  `).join('');

  // Use the first alert's suggestion as the headline action
  suggestionEl.textContent = alerts[0].suggestion;
}

function renderTable(history) {
  const body = document.getElementById('readingsBody');
  const rows = [];
  const n = history.labels.length;
  const start = Math.max(0, n - 10);

  for (let i = n - 1; i >= start; i--) {
    const temp = history.temperature[i];
    const hum = history.humidity[i];
    const pm25 = history.pm25[i];
    const pm10 = history.pm10[i];

    rows.push(`
      <tr>
        <td>${history.labels[i]}</td>
        <td>${temp}</td>
        <td>${hum}</td>
        <td class="${evaluateSensor('pm25', pm25) === 'attention' ? 'hot' : ''}">${pm25}</td>
        <td class="${evaluateSensor('pm10', pm10) === 'attention' ? 'hot' : ''}">${pm10}</td>
      </tr>
    `);
  }

  body.innerHTML = rows.join('') ||
    `<tr><td colspan="5" class="muted center">No readings available.</td></tr>`;
}

/* ---------- 6. CHARTS ---------- */
const charts = {};

function createChart(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, color + '55');
  gradient.addColorStop(1, color + '00');

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: gradient,
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: color
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700 },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,13,31,0.95)',
          borderColor: 'rgba(139,92,246,0.4)',
          borderWidth: 1,
          padding: 10,
          titleColor: '#e2e8f0',
          bodyColor: '#cbd5e1'
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 8 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(255,255,255,0.06)' }
        }
      }
    }
  });
}

function initCharts() {
  charts.pm25 = createChart('pm25Chart', 'PM2.5 (µg/m³)', '#8b5cf6');
  charts.pm10 = createChart('pm10Chart', 'PM10 (µg/m³)', '#3b82f6');
  charts.temperature = createChart('temperatureChart', 'Temperature (°C)', '#22d3ee');
  charts.humidity = createChart('humidityChart', 'Humidity (%)', '#a78bfa');
}

function renderCharts(history) {
  const map = {
    pm25: history.pm25,
    pm10: history.pm10,
    temperature: history.temperature,
    humidity: history.humidity
  };

  for (const key of Object.keys(map)) {
    const chart = charts[key];
    chart.data.labels = history.labels;
    chart.data.datasets[0].data = map[key];
    chart.update();
  }
}

/* ---------- 7. UI STATE HELPERS ---------- */
function setSystemStatus(state, text) {
  const el = document.getElementById('systemStatus');
  el.className = 'system-status' + (state === 'live' ? '' : ' ' + state);
  document.getElementById('statusText').textContent = text;
}

function setDemoMode(isDemo) {
  document.getElementById('demoBadge').classList.toggle('hidden', !isDemo);
}

function showBanner(message) {
  const banner = document.getElementById('statusBanner');
  document.getElementById('bannerText').textContent = message;
  banner.classList.remove('hidden');
}

function hideBanner() {
  document.getElementById('statusBanner').classList.add('hidden');
}

function setLastUpdated(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  const text = date.toLocaleString([], {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  document.getElementById('lastUpdated').textContent = text;
  document.getElementById('footerTime').textContent = 'Updated ' + text;
}

/* ---------- 8. MAIN FLOW ---------- */
let secondsLeft = CONFIG.REFRESH_INTERVAL_MS / 1000;
let refreshTimer = null;
let countdownTimer = null;

/** Loads dashboard + history. Falls back to demo data if the backend is down. */
async function loadAll() {
  const refreshBtns = [document.getElementById('refreshBtn'), document.getElementById('mobileRefresh')];
  refreshBtns.forEach(b => b && b.classList.add('spinning'));

  let dashboard, history;
  let backendOk = true;

  try {
    [dashboard, history] = await Promise.all([fetchDashboard(), fetchHistory()]);
    hideBanner();
    setSystemStatus('live', 'System Online');
    setDemoMode(dashboard.data_source === 'demo');
  } catch (err) {
    console.warn('Backend unavailable, using demo data:', err);
    backendOk = false;
    dashboard = getDemoDashboard();
    history = getDemoHistory();

    setSystemStatus('error', 'Backend Offline');
    setDemoMode(true);
    showBanner('⚠️ Backend not reachable. Showing DEMO data. Start your Flask server to see live readings.');
  }

  // Render everything
  renderStatus(dashboard);
  renderSensors(dashboard.sensors);
  renderAlerts(dashboard.sensors, dashboard.prediction);
  renderCharts(history);
  renderTable(history);
  setLastUpdated(dashboard.last_updated);

  // Reset countdown
  secondsLeft = CONFIG.REFRESH_INTERVAL_MS / 1000;
  document.getElementById('nextRefresh').textContent = secondsLeft;

  refreshBtns.forEach(b => b && b.classList.remove('spinning'));
  return backendOk;
}

/** Shows a countdown and triggers auto refresh every 60 seconds */
function startAutoRefresh() {
  clearInterval(countdownTimer);
  clearInterval(refreshTimer);

  countdownTimer = setInterval(() => {
    secondsLeft--;
    document.getElementById('nextRefresh').textContent = Math.max(secondsLeft, 0);
  }, 1000);

  refreshTimer = setInterval(loadAll, CONFIG.REFRESH_INTERVAL_MS);
}

/* ---------- 9. UI EVENTS ---------- */
function setupEvents() {
  // Manual refresh
  const refresh = async () => {
    await loadAll();
    startAutoRefresh();   // restart the 60s cycle after a manual refresh
  };
  document.getElementById('refreshBtn').addEventListener('click', refresh);
  document.getElementById('mobileRefresh').addEventListener('click', refresh);

  // Mobile sidebar
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menuToggle');
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  const closeMenu = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  };

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', closeMenu);

  // Close sidebar on nav click (mobile) and highlight active link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 992) closeMenu();
    });
  });

  // Highlight the nav link for the section currently in view
  const sections = document.querySelectorAll('section[id], header[id], article[id], div[id]');
  const navLinks = document.querySelectorAll('.nav-link');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + entry.target.id));
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });

  sections.forEach(s => s.id && observer.observe(s));
}

/* ---------- 10. INIT ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  initCharts();
  setupEvents();
  await loadAll();
  startAutoRefresh();
});