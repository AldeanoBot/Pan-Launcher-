(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { hydrateIcons } = Nexus.utils;

  const VIEW_TITLES = Object.freeze({
    home: 'Inicio',
    versions: 'Versiones de Minecraft',
    installations: 'Mis instalaciones',
    newInstall: 'Nueva instalación',
    folders: 'Carpetas de la instalación',
    fabric: 'Instalación de Fabric',
    forge: 'Forge y NeoForge',
    performance: 'Rendimiento y modo PvP',
    mods: 'Mods de rendimiento',
    skins: 'Administrador de skins',
    ram: 'Configuración de RAM',
    java: 'Configuración de Java',
    accounts: 'Cuentas Microsoft',
    players: 'Modo y jugadores',
    settings: 'Configuración general'
  });

  // Las sub-secciones comparten la entrada principal correspondiente del sidebar.
  const NAV_FOR_VIEW = Object.freeze({
    home: 'home',
    versions: 'versions',
    installations: 'installations',
    newInstall: 'installations',
    folders: 'installations',
    performance: 'performance',
    mods: 'performance',
    players: 'players',
    skins: 'skins',
    settings: 'settings',
    ram: 'settings',
    java: 'settings',
    accounts: 'settings',
    fabric: 'settings',
    forge: 'settings'
  });

  let current = 'home';

  function normalize(hash) {
    const name = String(hash || '')
      .replace(/^#\/?/, '')
      .split('/')[0];
    return Object.prototype.hasOwnProperty.call(VIEW_TITLES, name) ? name : 'home';
  }

  function render() {
    current = normalize(window.location.hash);

    const title = document.getElementById('view-title');
    if (title) title.textContent = VIEW_TITLES[current];

    document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
      const active = button.getAttribute('data-view') === NAV_FOR_VIEW[current];
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    const root = document.getElementById('view-root');
    if (!root) return;

    if (Nexus.skinPreview && typeof Nexus.skinPreview.disposeAll === 'function') {
      Nexus.skinPreview.disposeAll();
    }

    const renderView = Nexus.views && Nexus.views[current];
    if (typeof renderView !== 'function' || !Nexus.state) {
      root.innerHTML = '<div class="error-state"><h2>Vista no disponible</h2><p>La interfaz no se ha inicializado correctamente.</p></div>';
      return;
    }

    root.innerHTML = renderView(Nexus.state);
    root.scrollTop = 0;
    hydrateIcons(root);
    if (Nexus.skinPreview) Nexus.skinPreview.mountAll(root);
  }

  function init() {
    window.addEventListener('hashchange', render);
    if (!Object.prototype.hasOwnProperty.call(VIEW_TITLES, normalize(window.location.hash))) {
      window.location.replace('#/home');
    }
    render();
  }

  function navigate(view) {
    if (!Object.prototype.hasOwnProperty.call(VIEW_TITLES, view)) return;
    if (window.location.hash === `#/${view}`) render();
    else window.location.hash = `#/${view}`;
  }

  Nexus.router = {
    init,
    navigate,
    refresh: render,
    get current() {
      return current;
    }
  };
})();
