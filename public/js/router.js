(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { hydrateIcons } = Nexus.utils;

  function tr(key, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const v = Nexus.i18n.t(key);
      if (v !== key || !fallback) return v;
    }
    return String(fallback || key);
  }

  const VIEW_TITLE_KEYS = Object.freeze({
    home: 'view.home',
    versions: 'view.versions',
    mods: 'view.mods',
    resourcepacks: 'view.resourcepacks',
    newInstall: 'view.newInstall',
    folders: 'view.folders',
    fabric: 'view.fabric',
    forge: 'view.forge',
    performance: 'view.performance',
    skins: 'view.skins',
    ram: 'view.ram',
    java: 'view.java',
    accounts: 'view.accounts',
    players: 'view.players',
    settings: 'view.settings'
  });

  // Las sub-secciones comparten la entrada principal correspondiente del sidebar.
  const NAV_FOR_VIEW = Object.freeze({
    home: 'home',
    versions: 'versions',
    mods: 'mods',
    resourcepacks: 'resourcepacks',
    newInstall: 'mods',
    folders: 'mods',
    performance: 'performance',
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
    if (name === 'installations') return 'mods';
    return Object.prototype.hasOwnProperty.call(VIEW_TITLE_KEYS, name) ? name : 'home';
  }

  function render() {
    current = normalize(window.location.hash);

    const title = document.getElementById('view-title');
    if (title) title.textContent = tr(VIEW_TITLE_KEYS[current], current);

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
      root.innerHTML = `<div class="error-state"><h2>${Nexus.utils.escapeHtml(tr('shell.viewUnavailableTitle', 'Vista no disponible'))}</h2><p>${Nexus.utils.escapeHtml(tr('shell.viewUnavailableDesc', 'La interfaz no se ha inicializado correctamente.'))}</p></div>`;
      return;
    }

    root.innerHTML = renderView(Nexus.state);
    root.scrollTop = 0;
    hydrateIcons(root);
    if (Nexus.skinPreview) Nexus.skinPreview.mountAll(root);
  }

  function init() {
    window.addEventListener('hashchange', render);
    if (!Object.prototype.hasOwnProperty.call(VIEW_TITLE_KEYS, normalize(window.location.hash))) {
      window.location.replace('#/home');
    }
    render();
  }

  function navigate(view) {
    if (!Object.prototype.hasOwnProperty.call(VIEW_TITLE_KEYS, view)) return;
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
