/* Read-only consumer: DSH's ui-theme namespace remains the sole authority. */
(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let settings = {preference: 'system', fontSize: 14}, pending = false;
  const valid = value => ({preference: ['light','dark','system'].includes(value?.preference) ? value.preference : 'system',
    fontSize: Number.isInteger(value?.fontSize) && value.fontSize >= 12 && value.fontSize <= 17 ? value.fontSize : 14});
  function apply(value) {
    settings = valid(value);
    const dark = settings.preference === 'dark' || (settings.preference === 'system' && media.matches);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.dsThemeSource = settings.preference;
    document.body.toggleAttribute('data-ds-dark-theme', dark);
    document.body.style.setProperty('--dsh-content-font-size', settings.fontSize + 'px');
    try { localStorage.setItem('dsh-desktop-appearance', JSON.stringify(settings)); } catch {}
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      // Remote diagnostic webviews expose __TAURI__ too, but have no local IPC
      // permission. They must read the appearance from their authenticated host.
      if (!window.location?.pathname?.startsWith('/desktop-diagnostics') && window.__TAURI__?.core?.invoke) apply(await window.__TAURI__.core.invoke('appearance'));
      else {
        const response = await fetch('/desktop-diagnostics/api/appearance', {cache:'no-store'});
        if (response.ok) apply(await response.json());
      }
    } catch { /* Keep the last known appearance during an engine restart. */ }
    finally { pending = false; }
  }
  try { apply(JSON.parse(localStorage.getItem('dsh-desktop-appearance'))); } catch { apply(settings); }
  media.addEventListener('change', () => apply(settings));
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('storage', event => { if (event.key === 'dsh-desktop-appearance' && event.newValue) { try { apply(JSON.parse(event.newValue)); } catch {} } });
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 2000);
})();
