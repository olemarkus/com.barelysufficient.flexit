(function () {
  'use strict';

  const MIN_WIDGET_HEIGHT = 96;
  const REFRESH_INTERVAL_MS = 30000;
  const TEMPORARY_MODE_IDS = new Set(['temporary_high', 'fireplace', 'cooker_hood']);

  const root = document.getElementById('widget-root');
  const deviceName = document.getElementById('device-name');
  const modeList = document.getElementById('mode-list');
  const emptyMessage = document.getElementById('empty-message');
  const freshness = document.getElementById('freshness');

  let homey = null;
  let ready = false;
  let refreshTimer = null;
  let refreshInFlight = false;
  let currentWidgetHeight = 0;
  let heightFrame = null;

  function clearChildren(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function parseCssNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function measureWidgetHeight() {
    const bodyStyle = window.getComputedStyle(document.body);
    const verticalPadding = parseCssNumber(bodyStyle.paddingTop) + parseCssNumber(bodyStyle.paddingBottom);
    return Math.max(MIN_WIDGET_HEIGHT, Math.ceil(root.getBoundingClientRect().height + verticalPadding));
  }

  function applyWidgetHeight() {
    if (!homey) return;
    if (heightFrame) window.cancelAnimationFrame(heightFrame);
    heightFrame = window.requestAnimationFrame(() => {
      heightFrame = null;
      const height = measureWidgetHeight();

      if (!ready) {
        ready = true;
        currentWidgetHeight = height;
        if (typeof homey.ready === 'function') homey.ready({ height });
        return;
      }

      if (height === currentWidgetHeight) return;
      currentWidgetHeight = height;
      if (typeof homey.setHeight === 'function') homey.setHeight(height);
    });
  }

  function createText(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
  }

  function normalizeModeState(mode) {
    const state = mode && mode.state;
    if (state === 'active' || state === 'off' || state === 'disabled' || state === 'unknown') return state;
    if (mode && (mode.active === true || TEMPORARY_MODE_IDS.has(mode.id))) return 'active';
    if (!mode || mode.detail === 'Unknown') return 'unknown';
    if (mode.detail === 'Disabled') return 'disabled';
    return 'off';
  }

  function valueClassForState(state) {
    if (state === 'active') return 'homey-text-medium';
    if (state === 'off') return 'homey-text-regular';
    return 'homey-text-small-light';
  }

  function createModeRow(label, value, state) {
    const row = document.createElement('div');
    row.className = 'mode-row';

    const labelElement = createText('homey-text-small-light mode-row__label', label);
    const valueClass = valueClassForState(state);
    const valueElement = createText(`${valueClass} mode-row__value`, value);

    row.append(labelElement, valueElement);
    return row;
  }

  function getMode(status, id) {
    const modes = Array.isArray(status.modes) ? status.modes : [];
    return modes.find((mode) => mode && mode.id === id);
  }

  function findTemporaryMode(status) {
    const explicitMode = status.temporaryMode && getMode(status, status.temporaryMode.id);
    if (explicitMode) return explicitMode;

    const modes = Array.isArray(status.modes) ? status.modes : [];
    return modes.find((mode) => mode && TEMPORARY_MODE_IDS.has(mode.id))
      || status.temporaryMode
      || undefined;
  }

  function formatTemporaryMode(temporaryMode) {
    const label = String(temporaryMode.label || 'Temporary').trim() || 'Temporary';
    const detail = String(temporaryMode.detail || '').trim();
    if (!detail || detail === 'Temporary ventilation') return label;
    return `${label} · ${detail.replace(' min left', ' min')}`;
  }

  function createFeatureRow(status, id, fallbackLabel) {
    const mode = getMode(status, id);
    return createModeRow(
      mode && mode.label ? mode.label : fallbackLabel,
      mode && mode.detail ? mode.detail : 'Unknown',
      normalizeModeState(mode),
    );
  }

  function renderRows(status) {
    clearChildren(modeList);

    const fanMode = getMode(status, 'fan_mode');
    modeList.appendChild(createModeRow(
      'Fan',
      status.fanModeLabel || fanMode?.label || 'Unknown',
      normalizeModeState(fanMode),
    ));

    const temporaryMode = findTemporaryMode(status);
    if (temporaryMode) {
      modeList.appendChild(createModeRow(
        'Temporary',
        formatTemporaryMode(temporaryMode),
        normalizeModeState(temporaryMode),
      ));
    }

    modeList.appendChild(createFeatureRow(status, 'dehumidification', 'Dehumidify'));
    modeList.appendChild(createFeatureRow(status, 'free_cooling', 'Free cooling'));
  }

  function applyFreshness(status) {
    const offline = status.available === false;
    const stale = status.stale === true;
    root.dataset.freshness = offline ? 'offline' : (stale ? 'stale' : 'live');
    if (!freshness) return;
    const label = offline ? 'Offline' : (stale ? 'Stale' : '');
    freshness.textContent = label;
    freshness.hidden = label === '';
  }

  function clearFreshness() {
    root.dataset.freshness = 'live';
    if (!freshness) return;
    freshness.textContent = '';
    freshness.hidden = true;
  }

  function setMessage(title, detail) {
    root.dataset.state = 'message';
    deviceName.textContent = 'Flexit ventilation';
    clearFreshness();
    emptyMessage.textContent = detail || title;
    emptyMessage.hidden = false;
    clearChildren(modeList);
  }

  function renderStatus(status) {
    if (!status || status.state !== 'ready') {
      const detail = status && status.message ? status.message : 'Ventilation status is not available yet.';
      setMessage('No status', detail);
      return;
    }

    root.dataset.state = 'ready';
    emptyMessage.hidden = true;
    deviceName.textContent = status.device && status.device.name ? status.device.name : 'Flexit ventilation';
    applyFreshness(status);
    renderRows(status);
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
      setMessage('No status', 'Could not read ventilation status.');
      if (typeof console !== 'undefined') console.error(error);
    } finally {
      refreshInFlight = false;
      applyWidgetHeight();
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
      setHeight() {},
    };
  }

  function createPreviewStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('theme') === 'dark') document.body.classList.add('homey-dark-mode');
    const scenario = params.get('preview') || 'temporary';
    if (scenario === 'disabled') return previewDisabledStatus();
    if (scenario === 'freecooling') return previewFreeCoolingStatus();
    if (scenario === 'quiet') return previewQuietStatus();
    if (scenario === 'offline') return previewOfflineStatus();
    return previewTemporaryStatus();
  }

  function previewOfflineStatus() {
    return {
      ...previewTemporaryStatus(),
      available: false,
      stale: true,
    };
  }

  function previewBaseStatus() {
    return {
      state: 'ready',
      available: true,
      stale: false,
      device: { name: 'Nordic S4' },
    };
  }

  function previewTemporaryStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'high',
      fanModeLabel: 'High',
      temporaryMode: { id: 'temporary_high', label: 'Temp high', detail: '18 min left', remainingMinutes: 18 },
      modes: [
        { id: 'fan_mode', label: 'High', active: true, state: 'active', detail: 'Active', tone: 'primary' },
        { id: 'temporary_high', label: 'Temp high', active: true, state: 'active', detail: '18 min left', tone: 'warning' },
        { id: 'dehumidification', label: 'Dehumidify', active: true, state: 'active', detail: 'On', tone: 'warning' },
        { id: 'free_cooling', label: 'Free cooling', active: false, state: 'off', detail: 'Off', tone: 'neutral' },
      ],
    };
  }

  function previewFreeCoolingStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'home',
      fanModeLabel: 'Home',
      modes: [
        { id: 'fan_mode', label: 'Home', active: true, state: 'active', detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, state: 'off', detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: true, state: 'active', detail: 'On', tone: 'success' },
      ],
    };
  }

  function previewDisabledStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'home',
      fanModeLabel: 'Home',
      modes: [
        { id: 'fan_mode', label: 'Home', active: true, state: 'active', detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, state: 'off', detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: false, state: 'disabled', detail: 'Disabled', tone: 'neutral' },
      ],
    };
  }

  function previewQuietStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'away',
      fanModeLabel: 'Away',
      modes: [
        { id: 'fan_mode', label: 'Away', active: true, state: 'active', detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, state: 'off', detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: false, state: 'unknown', detail: 'Unknown', tone: 'neutral' },
      ],
    };
  }

  window.onHomeyReady = start;
  if (new URLSearchParams(window.location.search).has('preview')) {
    start(createPreviewHomey());
  }
}());
