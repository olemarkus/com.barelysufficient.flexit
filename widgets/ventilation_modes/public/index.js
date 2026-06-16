(function () {
  'use strict';

  const WIDGET_HEIGHT = 300;
  const REFRESH_INTERVAL_MS = 30000;
  const MAX_MODES = 6;
  const MAX_READINGS = 3;

  const root = document.getElementById('widget-root');
  const deviceName = document.getElementById('device-name');
  const fanMode = document.getElementById('fan-mode');
  const modeDetail = document.getElementById('mode-detail');
  const freshnessPill = document.getElementById('freshness-pill');
  const modeStrip = document.getElementById('mode-strip');
  const readingGrid = document.getElementById('reading-grid');
  const emptyMessage = document.getElementById('empty-message');

  let homey = null;
  let ready = false;
  let refreshTimer = null;
  let refreshInFlight = false;

  function clearChildren(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function setReady() {
    if (ready) return;
    ready = true;
    if (homey && typeof homey.ready === 'function') homey.ready({ height: WIDGET_HEIGHT });
  }

  function setMessage(title, detail, tone) {
    root.dataset.state = 'message';
    root.classList.remove('has-many-modes');
    deviceName.textContent = 'Flexit ventilation';
    fanMode.textContent = title;
    modeDetail.textContent = detail;
    freshnessPill.textContent = tone === 'danger' ? 'Error' : 'Setup';
    freshnessPill.dataset.tone = tone;
    emptyMessage.textContent = detail;
    emptyMessage.hidden = false;
    clearChildren(modeStrip);
    clearChildren(readingGrid);
  }

  function setFreshness(status) {
    if (status.available === false) {
      freshnessPill.textContent = 'Offline';
      freshnessPill.dataset.tone = 'danger';
      return;
    }
    if (status.stale) {
      freshnessPill.textContent = 'Stale';
      freshnessPill.dataset.tone = 'warning';
      return;
    }
    freshnessPill.textContent = 'Live';
    freshnessPill.dataset.tone = 'neutral';
  }

  function createModeChip(mode) {
    const chip = document.createElement('article');
    chip.className = 'mode-chip';
    chip.dataset.tone = mode.tone || 'neutral';
    chip.classList.toggle('is-active', Boolean(mode.active));

    const top = document.createElement('div');
    top.className = 'mode-chip__top';

    const dot = document.createElement('span');
    dot.className = 'mode-chip__dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'mode-chip__label';
    label.textContent = mode.label || 'Mode';

    const detail = document.createElement('div');
    detail.className = 'mode-chip__detail';
    detail.textContent = mode.detail || (mode.active ? 'On' : 'Off');

    top.append(dot, label);
    chip.append(top, detail);
    return chip;
  }

  function renderModes(modes) {
    clearChildren(modeStrip);
    const visibleModes = modes.slice(0, MAX_MODES);
    root.classList.toggle('has-many-modes', visibleModes.length > 4);
    for (const mode of visibleModes) {
      modeStrip.appendChild(createModeChip(mode));
    }
  }

  function formatReading(reading) {
    const value = Number(reading.value);
    if (!Number.isFinite(value)) return '';
    if (reading.unit === '%') return `${Math.round(value)}%`;
    if (reading.unit === 'W') return `${Math.round(value)} W`;
    if (reading.unit === 'degC') return `${value.toFixed(1)} degC`;
    return `${value.toFixed(1)} ${reading.unit || ''}`.trim();
  }

  function createReading(reading) {
    const item = document.createElement('div');
    item.className = 'reading';

    const label = document.createElement('span');
    label.className = 'reading__label';
    label.textContent = reading.label;

    const value = document.createElement('span');
    value.className = 'reading__value';
    value.textContent = formatReading(reading);

    item.append(label, value);
    return item;
  }

  function renderReadings(readings) {
    clearChildren(readingGrid);
    for (const reading of readings.slice(0, MAX_READINGS)) {
      const formatted = formatReading(reading);
      if (formatted) readingGrid.appendChild(createReading(reading));
    }
    readingGrid.hidden = readingGrid.childElementCount === 0;
  }

  function renderStatus(status) {
    if (!status || status.state !== 'ready') {
      const detail = status && status.message ? status.message : 'Ventilation status is not available yet.';
      setMessage('No status', detail, status && status.state === 'unavailable' ? 'danger' : 'warning');
      return;
    }

    root.dataset.state = 'ready';
    emptyMessage.hidden = true;
    deviceName.textContent = status.device && status.device.name ? status.device.name : 'Flexit ventilation';
    fanMode.textContent = status.fanModeLabel || 'Unknown';
    modeDetail.textContent = status.fanModeDetail || 'Waiting for mode signals';
    setFreshness(status);
    renderModes(status.modes || []);
    renderReadings(status.readings || []);
  }

  function getSelectedDeviceId() {
    if (!homey || typeof homey.getDeviceIds !== 'function') return '';
    const ids = homey.getDeviceIds();
    return Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : '';
  }

  async function refreshStatus() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const deviceId = getSelectedDeviceId();
      const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
      const status = await homey.api('GET', `/status${query}`, {});
      renderStatus(status);
    } catch (error) {
      setMessage('No status', 'Could not read ventilation status.', 'danger');
      if (typeof console !== 'undefined') console.error(error);
    } finally {
      refreshInFlight = false;
      setReady();
    }
  }

  function start(Homey) {
    homey = Homey;
    void refreshStatus();
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      void refreshStatus();
    }, REFRESH_INTERVAL_MS);
  }

  function createPreviewHomey() {
    return {
      api() {
        return Promise.resolve(createPreviewStatus());
      },
      getDeviceIds() {
        return ['preview-device'];
      },
      ready() {},
    };
  }

  function createPreviewStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('theme') === 'dark') document.body.classList.add('preview-dark');
    const scenario = params.get('preview') || 'temporary';
    if (scenario === 'freecooling') return previewFreeCoolingStatus();
    if (scenario === 'quiet') return previewQuietStatus();
    return previewTemporaryStatus();
  }

  function previewBaseStatus() {
    return {
      state: 'ready',
      available: true,
      stale: false,
      device: { name: 'Nordic S4' },
      readings: [
        { label: 'Supply fan', value: 82, unit: '%' },
        { label: 'Extract fan', value: 79, unit: '%' },
        { label: 'Supply setpoint', value: 84, unit: '%' },
        { label: 'Extract setpoint', value: 80, unit: '%' },
        { label: 'Target', value: 20.5, unit: 'degC' },
        { label: 'Humidity', value: 47, unit: '%' },
      ],
    };
  }

  function previewTemporaryStatus() {
    return {
      ...previewBaseStatus(),
      fanModeLabel: 'High',
      fanModeDetail: '18 min left',
      modes: [
        { id: 'fan_mode', label: 'High', active: true, detail: 'Active', tone: 'primary' },
        { id: 'temporary_high', label: 'Temp high', active: true, detail: '18 min left', tone: 'warning' },
        { id: 'dehumidification', label: 'Dehumidify', active: true, detail: 'On', tone: 'warning' },
        { id: 'free_cooling', label: 'Free cooling', active: false, detail: 'Off', tone: 'neutral' },
        { id: 'heating_coil', label: 'Heating coil', active: false, detail: 'Off', tone: 'neutral' },
      ],
    };
  }

  function previewFreeCoolingStatus() {
    return {
      ...previewBaseStatus(),
      fanModeLabel: 'Home',
      fanModeDetail: 'Normal fan profile',
      modes: [
        { id: 'fan_mode', label: 'Home', active: true, detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: true, detail: 'On', tone: 'success' },
        { id: 'heating_coil', label: 'Heating coil', active: false, detail: 'Off', tone: 'neutral' },
      ],
    };
  }

  function previewQuietStatus() {
    return {
      ...previewBaseStatus(),
      fanModeLabel: 'Away',
      fanModeDetail: 'Normal fan profile',
      readings: [
        { label: 'Supply fan', value: 32, unit: '%' },
        { label: 'Extract fan', value: 31, unit: '%' },
        { label: 'Target', value: 18, unit: 'degC' },
        { label: 'Filter', value: 78, unit: '%' },
      ],
      modes: [
        { id: 'fan_mode', label: 'Away', active: true, detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: false, detail: 'Off', tone: 'neutral' },
        { id: 'heating_coil', label: 'Heating coil', active: false, detail: 'Off', tone: 'neutral' },
      ],
    };
  }

  window.onHomeyReady = start;
  if (new URLSearchParams(window.location.search).has('preview')) {
    start(createPreviewHomey());
  }
}());
