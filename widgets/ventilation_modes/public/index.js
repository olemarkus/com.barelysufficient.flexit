(function () {
  'use strict';

  const WIDGET_HEIGHT = 180;
  const REFRESH_INTERVAL_MS = 30000;

  const root = document.getElementById('widget-root');
  const deviceName = document.getElementById('device-name');
  const modeList = document.getElementById('mode-list');
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

  function createText(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
  }

  function createModeRow(label, value, active) {
    const row = document.createElement('div');
    row.className = 'mode-row';

    const labelElement = createText('homey-text-small-light mode-row__label', label);
    const valueClass = active ? 'homey-text-medium' : 'homey-text-regular';
    const valueElement = createText(`${valueClass} mode-row__value`, value);

    row.append(labelElement, valueElement);
    return row;
  }

  function getMode(status, id) {
    const modes = Array.isArray(status.modes) ? status.modes : [];
    return modes.find((mode) => mode && mode.id === id);
  }

  function formatBooleanMode(status, id) {
    const mode = getMode(status, id);
    if (!mode) return { value: 'Unknown', active: false };
    return {
      value: mode.detail || (mode.active ? 'On' : 'Off'),
      active: mode.active === true,
    };
  }

  function formatTemporaryMode(status) {
    const temporaryMode = status.temporaryMode;
    if (!temporaryMode) return undefined;
    const label = String(temporaryMode.label || 'Temporary').trim() || 'Temporary';
    const detail = String(temporaryMode.detail || '').trim();
    if (!detail || detail === 'Temporary ventilation') return label;
    return `${label} · ${detail.replace(' min left', ' min')}`;
  }

  function renderRows(status) {
    clearChildren(modeList);

    const fanMode = getMode(status, 'fan_mode');
    modeList.appendChild(createModeRow(
      'Fan',
      status.fanModeLabel || fanMode?.label || 'Unknown',
      status.fanMode !== undefined,
    ));

    const temporaryMode = formatTemporaryMode(status);
    if (temporaryMode) {
      modeList.appendChild(createModeRow('Temporary', temporaryMode, true));
    }

    const dehumidify = formatBooleanMode(status, 'dehumidification');
    modeList.appendChild(createModeRow('Dehumidify', dehumidify.value, dehumidify.active));

    const freeCooling = formatBooleanMode(status, 'free_cooling');
    modeList.appendChild(createModeRow('Free cooling', freeCooling.value, freeCooling.active));
  }

  function setMessage(title, detail) {
    root.dataset.state = 'message';
    deviceName.textContent = 'Flexit ventilation';
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
    if (params.get('theme') === 'dark') document.body.classList.add('homey-dark-mode');
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
    };
  }

  function previewTemporaryStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'high',
      fanModeLabel: 'High',
      temporaryMode: { id: 'temporary_high', label: 'Temp high', detail: '18 min left', remainingMinutes: 18 },
      modes: [
        { id: 'fan_mode', label: 'High', active: true, detail: 'Active', tone: 'primary' },
        { id: 'temporary_high', label: 'Temp high', active: true, detail: '18 min left', tone: 'warning' },
        { id: 'dehumidification', label: 'Dehumidify', active: true, detail: 'On', tone: 'warning' },
        { id: 'free_cooling', label: 'Free cooling', active: false, detail: 'Off', tone: 'neutral' },
      ],
    };
  }

  function previewFreeCoolingStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'home',
      fanModeLabel: 'Home',
      modes: [
        { id: 'fan_mode', label: 'Home', active: true, detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: true, detail: 'On', tone: 'success' },
      ],
    };
  }

  function previewQuietStatus() {
    return {
      ...previewBaseStatus(),
      fanMode: 'away',
      fanModeLabel: 'Away',
      modes: [
        { id: 'fan_mode', label: 'Away', active: true, detail: 'Active', tone: 'primary' },
        { id: 'dehumidification', label: 'Dehumidify', active: false, detail: 'Off', tone: 'neutral' },
        { id: 'free_cooling', label: 'Free cooling', active: false, detail: 'Off', tone: 'neutral' },
      ],
    };
  }

  window.onHomeyReady = start;
  if (new URLSearchParams(window.location.search).has('preview')) {
    start(createPreviewHomey());
  }
}());
