// Desktop-only decoration for the pinned official DSH UI; no upstream files are changed.
(() => {
  if (window.top !== window || location.hostname !== '127.0.0.1') return;
  const install = () => {
    if (document.getElementById('dsh-desktop-theme')) return;
    const style = document.createElement('style');
    style.id = 'dsh-desktop-theme';
    // DSH 0.1.5-rc.2's ConversationRoot publishes data-phase on its root.
    // Isolation keeps this layer behind text but above the root background.
    style.textContent = `
      [data-phase]:is([data-phase="blank"], [data-phase="hero"], [data-phase="settling"], [data-phase="active"]) {
        isolation: isolate;
      }
      [data-phase]:is([data-phase="blank"], [data-phase="hero"], [data-phase="settling"], [data-phase="active"])::before {
        content: "";
        position: absolute;
        inset: 24px;
        z-index: -1;
        pointer-events: none;
        background: url("__WALLPAPER_DATA_URL__") center / contain no-repeat;
        opacity: 0.14;
      }
      @media (forced-colors: active) {
        [data-phase]::before { display: none; }
      }
    `;
    document.head.appendChild(style);
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = '__ICON_DATA_URL__';
    document.head.appendChild(icon);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once: true});
  else install();
})();
