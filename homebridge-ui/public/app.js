(() => {
  const el = id => document.getElementById(id);
  let config = {}, paths, devices = [], loaded = false, pending = false, busy = false;
  let nextSms = 0;
  const message = text => { el('status').textContent = text; };
  function buttons() {
    el('request').disabled = busy || !paths?.bootstrapReady || Date.now() < nextSms;
    el('verify').disabled = busy || !pending;
    el('discover').disabled = busy || !paths?.loggedIn;
    el('save').disabled = busy || !loaded;
  }
  async function run(action) {
    if (busy) return;
    busy = true; buttons();
    try { await action(); }
    catch (error) { message(error?.message || 'Request failed. Try again.'); }
    finally { busy = false; buttons(); }
  }
  function render() {
    el('devices').replaceChildren();
    for (const device of devices) {
      const label = document.createElement('label'); label.className = 'd-block mb-2';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'me-2';
      checkbox.dataset.deviceId = device.id; checkbox.disabled = !device.supported;
      checkbox.checked = device.supported && !config.excludeDeviceIds?.includes(device.id) && (!config.includeDeviceIds?.length || config.includeDeviceIds.includes(device.id));
      label.append(checkbox, document.createTextNode(`${device.name} — ${device.online ? (device.on === null ? 'state unknown' : device.on ? 'on' : 'off') : 'offline'}${device.supported ? '' : ' (unsupported)'}`));
      el('devices').append(label);
    }
    if (!devices.length) el('devices').textContent = 'No devices found in this account.';
  }
  async function discover() {
    const result = await homebridge.request('/discover');
    devices = result; loaded = true; render();
    message(`Found ${devices.length} cloud devices. Select the boilers to show in Homebridge.`);
  }
  el('request').onclick = () => run(async () => {
    pending = false;
    await homebridge.request('/request-code', { phone: el('phone').value.trim() });
    nextSms = Date.now() + 60000; pending = true;
    el('code').value = ''; el('code').focus(); message('SMS requested. Enter the code to sign in.');
    setTimeout(buttons, 60000);
  });
  el('verify').onclick = () => run(async () => {
    const code = el('code').value.trim(); el('code').value = '';
    await homebridge.request('/verify-code', { code });
    pending = false; loaded = false; devices = []; render(); el('phone').value = ''; paths = await homebridge.request('/status');
    message('Signed in. Session saved privately.'); await discover();
  });
  el('discover').onclick = () => run(discover);
  el('save').onclick = () => run(async () => {
    const pollInterval = Number(el('poll').value);
    if (!Number.isInteger(pollInterval) || pollInterval < 15 || pollInterval > 300) throw Error('Choose a refresh interval from 15 to 300 seconds.');
    const excluded = new Set(config.excludeDeviceIds || []);
    for (const checkbox of el('devices').querySelectorAll('input[data-device-id]')) {
      if (checkbox.disabled) continue;
      if (checkbox.checked) excluded.delete(checkbox.dataset.deviceId); else excluded.add(checkbox.dataset.deviceId);
    }
    config = { ...config, platform: 'SmartGradeSecure', name: config.name || 'SmartGrade Secure', sessionFile: paths.sessionFile, bootstrapFile: paths.bootstrapFile, pollInterval, includeDeviceIds: [], excludeDeviceIds: [...excluded] };
    await homebridge.updatePluginConfig([config]); await homebridge.savePluginConfig();
    message('Settings saved. Restart Homebridge to apply device visibility changes.');
  });
  run(async () => {
    const configs = await homebridge.getPluginConfig(); config = configs[0] || {};
    el('poll').value = config.pollInterval ?? 30;
    paths = await homebridge.request('/status');
    el('bootstrap').textContent = paths.bootstrapReady ? 'Use the same phone number as the SmartGrade app. Login details are saved privately.' : 'Application credentials are missing. Follow the README private bootstrap setup once before requesting SMS.';
    message(paths.loggedIn ? 'A saved session is available.' : 'Sign in to discover your boilers.');
    if (paths.loggedIn) await discover();
  });
})();
