(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, hydrateIcons, toast, confirmModal } = Nexus.utils;

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const translated = Nexus.i18n.t(key, vars);
      if (translated !== key || !fallback) return translated;
    }
    return String(fallback || key);
  }

  let root = null;
  let searchTimer = null;
  let skinsPromise = null;
  let javaOptionsPromise = null;
  const unsubscribers = [];

  function lowEndPageSize(kind) {
    const lowEnd = Boolean(state() && state().config && state().config.general && state().config.general.lowEndMode);
    if (kind === 'versions') return lowEnd ? 24 : 48;
    if (kind === 'newVersions') return lowEnd ? 24 : 36;
    if (kind === 'loaders') return lowEnd ? 16 : 48;
    return lowEnd ? 16 : 48;
  }

  function applyLowEndMode(config) {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('low-end-mode', Boolean(config && config.general && config.general.lowEndMode));
  }

  function resetPageSizes() {
    const current = state();
    if (!current) return;
    current.ui.limit = lowEndPageSize('versions');
    current.newInstall.limit = lowEndPageSize('newVersions');
    current.newInstall.catalogLimit = lowEndPageSize('loaders');
    current.loaders.versionLimit = lowEndPageSize('loaders');
  }

  function cancelPendingSearch() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function scheduleSearchRefresh(kind) {
    cancelPendingSearch();
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      if (kind === 'versions') refreshVersionGrid();
      else refreshNewInstallVersions();
    }, 120);
  }

  function state() {
    return Nexus.state;
  }

  const DIRECT_LOADER_LABELS = Object.freeze({
    vanilla: 'Vanilla',
    fabric: 'Fabric',
    forge: 'Forge',
    neoforge: 'NeoForge',
    quilt: 'Quilt'
  });

  function currentVersionId() {
    const current = state();
    if (!current || !current.config) return '—';
    const active = (current.installations && current.installations.list || [])
      .find((item) => item.id === current.config.launch.activeInstallationId);
    if (active) return `${active.name} · ${active.versionId}`;
    if (!current.versions || current.versions.length === 0) return '—';
    const ver = current.config.launch.versionId;
    const loader = String(current.config.launch.loader || 'vanilla').toLowerCase();
    return loader !== 'vanilla'
      ? `${ver} · ${DIRECT_LOADER_LABELS[loader] || loader}`
      : ver;
  }

  function setChip(id, icon, text) {
    const chip = document.getElementById(id);
    if (!chip) return;
    chip.innerHTML = `<span class="nav-icon" data-icon="${icon}"></span><span class="side-chip-text">${escapeHtml(text)}</span>`;
    hydrateIcons(chip);
  }

  function applyLogo(logo) {
    const image = document.getElementById('brand-logo');
    const fallback = document.getElementById('brand-mark');
    const available = Boolean(logo && logo.available && logo.dataUrl);
    if (image && available) image.src = logo.dataUrl;
    if (image) image.hidden = !available;
    if (fallback) fallback.hidden = available;
  }

  function updateShell() {
    const current = state();
    if (!current) return;
    const auth = current.auth || {};
    const sessionState = current.session || { mode: 'online', profile: null };
    const mode = sessionState.mode === 'offline'
      ? t('home.offlineLabel', null, 'Offline')
      : t('home.onlineLabel', null, 'Online');
    const profile = sessionState.profile || auth.profile;
    const accountLabel = profile
      ? `${profile.name} · ${mode}`
      : auth.canRestore
        ? `${t('shell.savedSession', null, 'Sesión guardada')} · ${mode}`
        : `${t('shell.noSession', null, 'Sin sesión')} · ${mode}`;

    setChip('version-chip', 'cube', currentVersionId());
    setChip('account-chip', profile ? 'check' : 'user', accountLabel);

    const systemStatus = document.querySelector('.topbar-status .status-indicator');
    if (systemStatus) {
      const label = profile
        ? `${mode}: ${profile.name}`
        : auth.canRestore
          ? `${t('shell.savedSession', null, 'Sesión guardada')} · ${mode}`
          : t('shell.systemReady', null, 'Sistema listo');
      systemStatus.innerHTML = `<span class="status-dot"></span> ${escapeHtml(label)}`;
    }

    const versionLabel = document.getElementById('app-version');
    if (versionLabel && current.info) {
      versionLabel.textContent = `v${current.info.version}`;
    }
  }

  function refresh() {
    updateShell();
    Nexus.router.refresh();
    // El router vuelve a crear el DOM de la vista. Si el envío está en curso,
    // el template desactiva el botón; al terminar hay que volver a sincronizarlo
    // aunque el nodo original ya no esté en el documento.
    if (Nexus.router.current === 'newInstall') updateNewInstallSubmitState();
    if (Nexus.tour && Nexus.tour.isActive() && typeof Nexus.tour.reposition === 'function') {
      window.requestAnimationFrame(() => Nexus.tour.reposition());
    }
  }

  async function applyConfig(patch, successMessage) {
    try {
      const previousLowEnd = Boolean(state().config && state().config.general && state().config.general.lowEndMode);
      state().config = await Nexus.api.updateConfig(patch);
      applyLowEndMode(state().config);
      const nextLowEnd = Boolean(state().config.general.lowEndMode);
      if (previousLowEnd !== nextLowEnd) resetPageSizes();
      refresh();
      refreshLaunchPreflight().catch(() => {});
      if (successMessage) toast(successMessage);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function refreshAuthAndConfig() {
    const [auth, config, sessionStatus] = await Promise.all([
      Nexus.api.auth.status(),
      Nexus.api.getConfig(),
      Nexus.api.session.status()
    ]);
    state().auth = auth;
    state().config = config;
    state().session = sessionStatus;
    refresh();
    refreshLaunchPreflight().catch(() => {});
  }

  async function refreshSession(message) {
    try {
      state().session = await Nexus.api.session.status();
      refresh();
      await refreshLaunchPreflight();
      if (message) toast(message);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function refreshVersionGrid() {
    const grid = document.getElementById('version-grid');
    if (!grid || !Nexus.views.versionGrid) return;
    grid.innerHTML = Nexus.views.versionGrid(state());
    hydrateIcons(grid);
  }

  function refreshInstallProgress() {
    const panel = document.getElementById('install-progress-panel');
    if (!panel || !Nexus.views.installProgress) return;
    panel.innerHTML = Nexus.views.installProgress(state());
    hydrateIcons(panel);
  }

  function refreshInstallationGrid() {
    const grid = document.getElementById('installation-grid');
    if (!grid || !Nexus.views.installationGrid) return;
    grid.innerHTML = Nexus.views.installationGrid(state());
    hydrateIcons(grid);
  }

  function refreshInstallationProgress() {
    const panel = document.getElementById('installation-progress-panel');
    if (!panel || !Nexus.views.installationProgress) return;
    panel.innerHTML = Nexus.views.installationProgress(state());
    hydrateIcons(panel);
  }

  function updateNewInstallSubmitState() {
    const button = document.querySelector('[data-action="new-install-create"]');
    if (!button || !state()) return;
    const form = state().newInstall;
    const ready = Boolean(form.name && form.gameVersion && form.ramMb && form.minRamMb)
      && (form.loader === 'vanilla' || Boolean(form.loaderVersion))
      && form.catalogState !== 'loading'
      && !form.submitting
      && !(state().installations && state().installations.status.active);
    button.disabled = !ready;
  }

  function refreshNewInstallPanel() {
    const panel = document.getElementById('new-install-panel');
    if (!panel || !Nexus.views.newInstallPanel) return;
    panel.innerHTML = Nexus.views.newInstallPanel(state());
    hydrateIcons(panel);
    updateNewInstallSubmitState();
  }

  function refreshNewInstallVersions() {
    const list = document.getElementById('new-install-version-list');
    if (!list || !Nexus.views.newInstallVersionList) return;
    list.innerHTML = Nexus.views.newInstallVersionList(state());
    hydrateIcons(list);
  }

  function refreshFolderGrid() {
    const grid = document.getElementById('folder-grid');
    if (!grid || !Nexus.views.folderGrid) return;
    grid.innerHTML = Nexus.views.folderGrid(state());
    hydrateIcons(grid);
  }

  function refreshSkinGrid() {
    const grid = document.getElementById('skin-grid');
    if (!grid || !Nexus.views.skinGrid) return;
    grid.innerHTML = Nexus.views.skinGrid(state());
    hydrateIcons(grid);
    if (Nexus.skinPreview) Nexus.skinPreview.mountAll(grid);
  }

  async function refreshFolders(message) {
    const folders = state().folders;
    if (!folders.installationId) {
      folders.items = [];
      folders.error = null;
      refreshFolderGrid();
      if (message) toast(message);
      return;
    }
    try {
      folders.items = await Nexus.api.folders.list(folders.installationId);
      folders.error = null;
    } catch (error) {
      folders.error = error.message;
    }
    refreshFolderGrid();
    if (message) toast(message);
  }

  async function ensureSkins(force) {
    const current = state();
    if (!current) return;
    if (!force && current.skins.loaded) return;
    if (skinsPromise) return skinsPromise;

    skinsPromise = Nexus.api.skins.list()
      .then((items) => {
        current.skins.items = Array.isArray(items) ? items : [];
        current.skins.loaded = true;
        refreshSkinGrid();
      })
      .finally(() => { skinsPromise = null; });
    return skinsPromise;
  }

  async function ensureJavaOptions(force) {
    const current = state();
    if (!current || !current.newInstall) return;
    if (!force && (current.newInstall.javaOptions || []).length) return;
    if (javaOptionsPromise) return javaOptionsPromise;

    javaOptionsPromise = Nexus.api.installations.javaOptions()
      .then((options) => {
        current.newInstall.javaOptions = (options && options.installations) || [];
        if (Nexus.router.current === 'newInstall') refreshNewInstallPanel();
      })
      .finally(() => { javaOptionsPromise = null; });
    return javaOptionsPromise;
  }

  async function refreshSkins(message) {
    try {
      await ensureSkins(true);
      if (message) toast(message);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function refreshLaunchPanel() {
    const panel = document.getElementById('launch-panel');
    if (panel && Nexus.views.launchPanel) {
      panel.innerHTML = Nexus.views.launchPanel(state());
      hydrateIcons(panel);
    }
    const playAllowed = Nexus.views.canPlay ? Nexus.views.canPlay(state()) : true;
    document.querySelectorAll('.hero-actions [data-action="play"]').forEach((btn) => {
      btn.disabled = !playAllowed;
    });
  }

  function appendConsoleLine() {
    // La consola en vivo se ha retirado de Inicio para mantener la interfaz limpia y ligera en RAM.
  }

  function installationProgressFromStatus(status) {
    if (!status || status.active || !status.lastResult) return null;
    const result = status.lastResult;
    return {
      installationId: result.installationId,
      versionId: result.versionId,
      phase: result.ok ? 'done' : result.cancelled ? 'cancelled' : 'error',
      phaseLabel: result.ok ? t('install.doneLabel') : result.cancelled ? t('install.cancelledLabel') : t('install.errorLabel'),
      percent: result.ok ? 100 : 0,
      filesDone: 0,
      filesTotal: 0,
      message: result.ok ? '' : result.error || ''
    };
  }

  function progressFromStatus(status) {
    if (status.active) return null;
    const result = status.lastResult;
    if (!result) return null;
    const phase = result.ok ? 'done' : result.cancelled ? 'cancelled' : 'error';
    return {
      versionId: result.versionId,
      phase,
      phaseLabel: result.ok ? t('install.doneLabel') : result.cancelled ? t('install.cancelledLabel') : t('install.errorLabel'),
      file: '',
      downloaded: 0,
      total: 0,
      percent: result.ok ? 100 : 0,
      speed: 0,
      eta: 0,
      filesDone: result.ok ? result.fileCount || 0 : 0,
      filesTotal: result.fileCount || 0,
      message: result.ok ? t('install.verifiedMsg') : result.error || ''
    };
  }

  async function refreshInstallStatus() {
    const status = await Nexus.api.install.status();
    const current = state();
    current.installed = Array.isArray(status.installed) ? status.installed : [];
    current.install.active = status.active;
    if (!status.active) current.install.progress = progressFromStatus(status);
    refresh();
    refreshLaunchPreflight().catch(() => {});
  }

  async function refreshInstallationStatus(message) {
    try {
      const [status, config] = await Promise.all([
        Nexus.api.installations.status(),
        Nexus.api.getConfig()
      ]);
      const current = state();
      current.config = config;
      current.installations.list = Array.isArray(status.installations) ? status.installations : [];
      current.installations.status = status || { active: null, lastResult: null };
      if (!status.active) current.installations.progress = installationProgressFromStatus(status);
      if (!current.folders.installationId) {
        const activeId = current.config.launch.activeInstallationId;
        const first = current.installations.list[0];
        current.folders.installationId = activeId || (first && first.id) || null;
      }
      updateShell();
      refreshInstallationGrid();
      refreshInstallationProgress();
      if (Nexus.router.current === 'folders') refreshFolders().catch(() => {});
      if (message) toast(message);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function loaderProgressFromStatus(status) {
    if (!status || status.active || !status.lastResult) return null;
    const result = status.lastResult;
    return {
      versionId: result.versionId,
      phase: result.ok ? 'done' : result.cancelled ? 'cancelled' : 'error',
      phaseLabel: result.ok ? t('install.profileDoneLabel') : result.cancelled ? t('install.cancelledLabel') : t('install.errorLabel'),
      file: '',
      downloaded: 0,
      total: 0,
      percent: result.ok ? 100 : 0,
      filesDone: 0,
      filesTotal: 0,
      message: result.ok ? '' : result.error || ''
    };
  }

  async function refreshLoaderStatus(message) {
    try {
      const status = await Nexus.api.loaders.status();
      const loaders = state().loaders;
      loaders.status = status;
      loaders.progress = loaders.progress || loaderProgressFromStatus(status);
      refresh();
      if (message) toast(message);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function refreshLoaderProgress() {
    const panel = document.getElementById('loader-progress-panel');
    if (!panel || !Nexus.views.loaderProgress) return;
    panel.innerHTML = Nexus.views.loaderProgress(state());
    hydrateIcons(panel);
  }

  function loaderForView(view) {
    if (view === 'fabric') return 'fabric';
    if (view === 'forge') {
      const cur = state().loaders.loader;
      return cur === 'neoforge' || cur === 'quilt' ? cur : 'forge';
    }
    return null;
  }

  async function ensureDirectLoaderCatalog(force) {
    const current = state();
    if (!current || !current.config || !current.config.launch) return;
    const dl = (current.directLoader = current.directLoader || {
      loader: null,
      gameVersion: null,
      state: 'idle',
      items: [],
      error: '',
      stale: false
    });
    const loader = String(current.config.launch.loader || 'vanilla').toLowerCase();
    const gv = String(current.config.launch.versionId || '').trim();
    if (loader === 'vanilla' || !gv || current.config.launch.activeInstallationId) {
      dl.loader = loader;
      dl.gameVersion = gv;
      dl.state = 'idle';
      dl.items = [];
      dl.error = '';
      dl.stale = false;
      return;
    }
    if (!force && dl.loader === loader && dl.gameVersion === gv && (dl.state === 'ready' || dl.state === 'loading')) {
      return;
    }
    dl.loader = loader;
    dl.gameVersion = gv;
    dl.state = 'loading';
    dl.items = [];
    dl.error = '';
    dl.stale = false;
    if (Nexus.router.current === 'home' || Nexus.router.current === 'versions') refresh();

    try {
      const res = await Nexus.api.catalogs.get(loader, gv, force ? { force: true } : undefined);
      if (dl.loader !== loader || dl.gameVersion !== gv) return;
      dl.items = Array.isArray(res && res.items) ? res.items : [];
      dl.stale = Boolean(res && res.stale);
      dl.error = dl.items.length
        ? ''
        : (res && res.warning ? res.warning : t('install.noOfficialBuilds', { loader: DIRECT_LOADER_LABELS[loader] || loader, mc: gv }));
      dl.state = 'ready';
    } catch (error) {
      if (dl.loader !== loader || dl.gameVersion !== gv) return;
      dl.items = [];
      dl.state = 'error';
      dl.error = publicErrorMessage(error);
    }
    if (Nexus.router.current === 'home' || Nexus.router.current === 'versions') refresh();
  }

  async function ensureLoaderVersions(loader, force) {
    const loaders = state().loaders;
    if (!loader) return;
    const base = loaders.base;

    if (!force && loaders.versionLoader === loader && loaders.versionBase === base
        && (loaders.versionState === 'ready' || loaders.versionState === 'loading')) {
      return;
    }

    loaders.versionLoader = loader;
    loaders.versionBase = base;
    loaders.versionState = 'loading';
    loaders.versionError = '';
    loaders.versionFetchedAt = null;
    loaders.versionSource = null;
    loaders.versionStale = false;
    loaders.versions = [];
    loaders.selected = '';
    loaders.versionLimit = lowEndPageSize('loaders');
    refresh();

    if (!base) {
      loaders.versionState = 'error';
      loaders.versionError = t('install.vanillaFirst');
      refresh();
      return;
    }

    try {
      const catalog = await Nexus.api.loaders.versions(loader, base, force ? { force: true } : undefined);
      if (loaders.versionLoader !== loader || loaders.versionBase !== base) return;
      loaders.versions = Array.isArray(catalog.items) ? catalog.items : [];
      loaders.versionFetchedAt = catalog.fetchedAt;
      loaders.versionSource = catalog.source;
      loaders.versionStale = Boolean(catalog.stale);
      loaders.versionError = catalog.stale
        ? (catalog.warning || t('install.cacheWarn'))
        : '';
      loaders.versionState = 'ready';
      loaders.selected = loaders.versions.length ? loaders.versions[0].id : '';
    } catch (error) {
      loaders.versionState = 'error';
      loaders.versionError = error.message;
      loaders.versions = [];
      loaders.selected = '';
    }
    refresh();
  }

  function wireLoaderProgress() {
    unsubscribers.push(Nexus.api.loaders.onProgress((progress) => {
      const current = state();
      if (!progress || !current) return;
      const terminal = ['done', 'error', 'cancelled'].includes(progress.phase);
      // Un loader instalado dentro de una instalación aislada emite el mismo
      // canal de progreso que el loader heredado. No debe cambiar la selección
      // global: la instalación se selecciona sola al terminar y validar.
      const belongsToInstallation = Boolean(current.installations.status.active)
        || Boolean(progress.gameDir && (current.installations.list || []).some(
          (item) => item && item.gameDir === progress.gameDir
        ));
      current.loaders.progress = progress;
      current.loaders.status.active = terminal
        ? null
        : { versionId: progress.versionId, phase: progress.phase };

      refreshLoaderProgress();
      refresh();
      if (terminal) {
        if (progress.phase === 'done') {
          if (!belongsToInstallation) {
            applyConfig({ launch: { versionId: progress.versionId, activeInstallationId: null } },
              t('msg.profileInstalledSelected', { id: progress.versionId }));
          }
        } else if (progress.phase === 'cancelled') {
          toast(t('msg.loaderCancelled'));
        } else {
          toast(progress.message || t('msg.loaderInstallFail'), 'error');
        }
        refreshLoaderStatus().catch(() => {});
      }
    }));
  }

  function applyLaunchStatus(status) {
    const current = state();
    if (!status || !current) return;
    current.launch.status = status;
    if (Array.isArray(status.lines)) {
      current.launch.lines = status.lines.slice(-40);
    }
    current.launch.starting = false;
    refreshLaunchPanel();
    setChip('version-chip', status.active ? 'play' : 'cube',
      status.active ? `${status.active.versionId} · ${statusLabel(status.status)}` : currentVersionId());
  }

  function statusLabel(value) {
    const known = ['idle', 'preparing', 'starting', 'playing', 'stopping', 'error'];
    const key = known.includes(value) ? `status.${value}` : 'status.idle';
    return t(key, null, 'Listo');
  }

  async function refreshLaunchPreflight() {
    const current = state();
    if (!current) return;
    try {
      current.launch.preflight = await Nexus.api.launch.preflight();
    } catch (error) {
      current.launch.preflight = {
        ready: false,
        reasons: [{ code: 'error', message: publicErrorMessage(error) }]
      };
    }
    // Un error anterior no debe seguir apareciendo cuando los requisitos ya
    // están resueltos; el diagnóstico queda disponible en la consola.
    if (current.launch.preflight.ready && current.launch.status
        && !current.launch.status.active && current.launch.status.status === 'error') {
      current.launch.status = { ...current.launch.status, status: 'idle', error: null };
    }
    refreshLaunchPanel();
    await refreshJavaStatus();
  }

  async function refreshJavaStatus() {
    const current = state();
    if (!current) return;
    const active = (current.installations && current.installations.list || [])
      .find((item) => item.id === current.config.launch.activeInstallationId);
    const versionId = active ? active.versionId : current.config.launch.versionId;
    try {
      current.launch.javaStatus = await Nexus.api.launch.javaStatus(versionId);
    } catch (error) {
      current.launch.javaStatus = { installations: [], selected: null, error: error.message };
    }
    if (Nexus.router.current === 'java') Nexus.router.refresh();
  }

  function wireLaunchEvents() {
    unsubscribers.push(Nexus.api.launch.onStatus((status) => applyLaunchStatus(status)));
    unsubscribers.push(Nexus.api.launch.onConsole((line) => {
      const current = state();
      if (!current || !line) return;
      if (!Array.isArray(current.launch.lines)) current.launch.lines = [];
      if (line.cleared) current.launch.lines = [];
      else {
        current.launch.lines.push(line);
        if (current.launch.lines.length > 40) current.launch.lines.shift();
      }
      appendConsoleLine(line);
    }));
  }

  function wireInstallProgress() {
    unsubscribers.push(Nexus.api.install.onProgress((progress) => {
      const current = state();
      if (!progress || !current) return;
      const terminal = ['done', 'error', 'cancelled'].includes(progress.phase);
      const wasActive = Boolean(current.install.active);
      current.install.progress = progress;
      current.install.active = terminal
        ? null
        : { versionId: progress.versionId, phase: progress.phase, percent: progress.percent };

      refreshInstallProgress();
      if (terminal || !wasActive) refreshVersionGrid();
      if (terminal) refreshInstallStatus().catch((error) => toast(error.message, 'error'));
    }));
  }

  function publicErrorMessage(error) {
    return String((error && error.message) || error || t('msg.unknownErr'))
      .replace(/^Error occurred in handler for '[^']+':\s*/, '')
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error:\s*/, '');
  }

  async function ensureNewInstallCatalog(force) {
    const form = state().newInstall;
    if (form.loader === 'vanilla') {
      form.catalog = [];
      form.catalogState = 'idle';
      form.catalogError = '';
      form.catalogWarning = '';
      form.catalogFetchedAt = null;
      form.catalogSource = null;
      form.catalogStale = false;
      form.catalogLoader = 'vanilla';
      form.catalogGameVersion = form.gameVersion;
      form.loaderVersion = null;
      if (Nexus.router.current === 'newInstall') refreshNewInstallPanel();
      return;
    }
    if (!form.gameVersion) {
      form.catalog = [];
      form.catalogState = 'idle';
      form.catalogError = '';
      form.catalogWarning = '';
      form.catalogFetchedAt = null;
      form.catalogSource = null;
      form.catalogStale = false;
      form.catalogLimit = lowEndPageSize('loaders');
      if (Nexus.router.current === 'newInstall') refreshNewInstallPanel();
      return;
    }
    if (!force && form.catalogLoader === form.loader && form.catalogGameVersion === form.gameVersion
        && (form.catalogState === 'ready' || form.catalogState === 'loading')) {
      return;
    }

    form.catalogLoader = form.loader;
    form.catalogGameVersion = form.gameVersion;
    form.catalogState = 'loading';
    form.catalogError = '';
    form.catalogWarning = '';
    form.catalogFetchedAt = null;
    form.catalogSource = null;
    form.catalogStale = false;
    form.catalogLimit = lowEndPageSize('loaders');
    if (Nexus.router.current === 'newInstall') refreshNewInstallPanel();

    try {
      const catalog = await Nexus.api.catalogs.get(form.loader, form.gameVersion, { force: Boolean(force) });
      if (form.catalogLoader !== form.loader || form.catalogGameVersion !== form.gameVersion) return;
      form.catalog = Array.isArray(catalog.items) ? catalog.items : [];
      form.catalogFetchedAt = catalog.fetchedAt;
      form.catalogSource = catalog.source;
      form.catalogStale = Boolean(catalog.stale);
      form.catalogWarning = catalog.stale || catalog.warning
        ? (catalog.warning || t('install.cacheWarn'))
        : '';
      form.catalogState = 'ready';
      if (form.catalog.length && !form.catalog.some((item) => item.id === form.loaderVersion)) {
        form.loaderVersion = form.catalog[0].id;
      }
    } catch (error) {
      if (form.catalogLoader !== form.loader || form.catalogGameVersion !== form.gameVersion) return;
      form.catalog = [];
      form.catalogState = 'error';
      form.catalogError = publicErrorMessage(error);
    }
    if (Nexus.router.current === 'newInstall') refreshNewInstallPanel();
  }

  function wireInstallationProgress() {
    unsubscribers.push(Nexus.api.installations.onProgress((progress) => {
      const current = state();
      if (!progress || !current) return;
      const terminal = ['done', 'error', 'cancelled'].includes(progress.phase);
      current.installations.progress = progress;
      current.installations.status.active = terminal
        ? null
        : {
            installationId: progress.installationId,
            versionId: progress.versionId,
            phase: progress.phase
          };

      refreshInstallationProgress();
      if (Nexus.router.current === 'installations') refreshInstallationGrid();
      if (Nexus.router.current === 'newInstall') refreshNewInstallPanel();
      if (terminal) {
        if (progress.phase === 'done') {
          refreshInstallationStatus(t('install.instDoneMsg', { id: progress.installationId }));
        } else if (progress.phase === 'cancelled') {
          refreshInstallationStatus(t('install.instCancelledMsg'));
        } else {
          refreshInstallationStatus();
          toast(progress.message || t('install.instFailMsg'), 'error');
        }
      }
    }));
  }

  function resolveLaunchProfileForMods(current) {
    const launchCfg = (current && current.config && current.config.launch) || {};
    const list = (current && current.installations && current.installations.list) || [];
    const active = list.find((item) => item.id === launchCfg.activeInstallationId) || null;
    if (active) {
      return {
        gameVersion: active.gameVersion || active.versionId || '1.21.4',
        loader: String(active.loader || 'vanilla').toLowerCase()
      };
    }
    const rawVer = String(launchCfg.versionId || '1.21.4');
    const match = rawVer.match(/^(fabric|forge|neoforge|quilt)-(.+)-([^-]+)$/i);
    if (match) {
      return { gameVersion: match[3], loader: match[1].toLowerCase() };
    }
    return {
      gameVersion: rawVer,
      loader: String(launchCfg.loader || 'vanilla').toLowerCase()
    };
  }

  function warnCompatibilityOnTargetChange(current) {
    const s = current || state();
    if (!s) return;
    const profile = resolveLaunchProfileForMods(s);
    const loaderLabel = DIRECT_LOADER_LABELS[profile.loader] || profile.loader;
    const modsList = (s.customMods && s.customMods.items) || [];
    const rpList = (s.resourcePacks && s.resourcePacks.items) || [];

    const incompatMods = Nexus.modInspector
      ? Nexus.modInspector.findIncompatibleEnabledMods(modsList, profile.gameVersion, profile.loader)
      : [];
    const incompatPacks = Nexus.resourcePackInspector
      ? Nexus.resourcePackInspector.findIncompatibleEnabledPacks(rpList, profile.gameVersion)
      : [];

    if (incompatMods.length > 0) {
      const names = incompatMods.slice(0, 2).map((e) => e.mod.name || e.mod.filename).join(', ')
        + (incompatMods.length > 2 ? ` (+${incompatMods.length - 2})` : '');
      toast(t('msg.switchIncompatMods', {
        mc: profile.gameVersion,
        loader: loaderLabel,
        count: incompatMods.length,
        names
      }), 'error');
    }
    if (incompatPacks.length > 0) {
      const names = incompatPacks.slice(0, 2).map((e) => e.pack.name || e.pack.filename).join(', ')
        + (incompatPacks.length > 2 ? ` (+${incompatPacks.length - 2})` : '');
      toast(t('msg.switchIncompatPacks', {
        mc: profile.gameVersion,
        count: incompatPacks.length,
        names
      }), 'error');
    }
  }

  async function refreshCustomMods() {
    const current = state();
    if (!current || !Nexus.api.mods) return;
    const items = await Nexus.api.mods.list();
    current.customMods.items = Array.isArray(items) ? items : [];
    if (Nexus.router.current === 'mods') refresh();
  }

  async function refreshResourcePacks() {
    const current = state();
    if (!current || !Nexus.api.resourcePacks) return;
    const items = await Nexus.api.resourcePacks.list();
    current.resourcePacks.items = Array.isArray(items) ? items : [];
    if (Nexus.router.current === 'resourcepacks') refresh();
  }

  async function handleCustomModFiles(fileList) {
    const current = state();
    if (!current || !fileList || fileList.length === 0) return;
    current.customMods.uploading = true;
    if (Nexus.router.current === 'mods') refresh();
    try {
      const result = await Nexus.api.mods.addFiles(fileList);
      current.customMods.items = Array.isArray(result.items) ? result.items : [];
      if (result.added > 0) {
        const profile = resolveLaunchProfileForMods(current);
        const incompat = Nexus.modInspector
          ? Nexus.modInspector.findIncompatibleEnabledMods(current.customMods.items, profile.gameVersion, profile.loader)
          : [];
        if (incompat.length > 0) {
          toast(t('msg.modsAddedIncompat', { count: result.added, incompat: incompat.length, mc: profile.gameVersion }), 'error');
        } else {
          toast(result.added === 1
            ? t('msg.modsAddedOk', { count: result.added })
            : t('msg.modsAddedPluralOk', { count: result.added }));
        }
      }
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        toast(result.errors[0], 'error');
      }
    } catch (error) {
      toast(publicErrorMessage(error), 'error');
    } finally {
      current.customMods.uploading = false;
      refresh();
    }
  }

  async function handleResourcePackFiles(fileList) {
    const current = state();
    if (!current || !fileList || fileList.length === 0 || !Nexus.api.resourcePacks) return;
    current.resourcePacks.uploading = true;
    if (Nexus.router.current === 'resourcepacks') refresh();
    try {
      const result = await Nexus.api.resourcePacks.addFiles(fileList);
      current.resourcePacks.items = Array.isArray(result.items) ? result.items : [];
      if (result.added > 0) {
        const profile = resolveLaunchProfileForMods(current);
        const incompat = Nexus.resourcePackInspector
          ? Nexus.resourcePackInspector.findIncompatibleEnabledPacks(current.resourcePacks.items, profile.gameVersion)
          : [];
        if (incompat.length > 0) {
          toast(t('msg.rpacksAddedIncompat', { count: result.added, incompat: incompat.length, mc: profile.gameVersion }), 'error');
        } else {
          toast(result.added === 1
            ? t('msg.rpacksAddedOk', { count: result.added })
            : t('msg.rpacksAddedPluralOk', { count: result.added }));
        }
      }
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        toast(result.errors[0], 'error');
      }
    } catch (error) {
      toast(publicErrorMessage(error), 'error');
    } finally {
      current.resourcePacks.uploading = false;
      refresh();
    }
  }

  function closeModCompatModal() {
    const existing = document.getElementById('mod-compat-modal');
    if (existing) existing.remove();
  }

  async function executePlayLaunch(playNode) {
    const current = state();
    if (!current) return;
    if (playNode) playNode.disabled = true;
    current.launch.starting = true;
    refreshLaunchPanel();
    try {
      const status = await Nexus.api.launch.start();
      applyLaunchStatus(status);
      toast(t('msg.startingMc', { ver: status.active ? status.active.versionId : current.config.launch.versionId }));
    } catch (error) {
      current.launch.starting = false;
      refreshLaunchPanel();
      toast(error.message, 'error');
    }
  }

  function showModCompatModal(options) {
    closeModCompatModal();
    const { profile, conflicts, playNode } = options;
    const loaderLabel = DIRECT_LOADER_LABELS[profile.loader] || profile.loader;
    const overlay = document.createElement('div');
    overlay.id = 'mod-compat-modal';
    overlay.className = 'pan-modal-backdrop';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mod-compat-title');

    const subtitleHtml = t('modModal.sub', {
      mc: escapeHtml(profile.gameVersion),
      loader: escapeHtml(loaderLabel)
    });

    overlay.innerHTML = `
      <div class="pan-modal">
        <div class="pan-modal-head">
          <div class="pan-modal-title-group">
            <span class="badge badge-error">${escapeHtml(t('modModal.badge'))}</span>
            <h3 id="mod-compat-title">${escapeHtml(t('modModal.title'))}</h3>
          </div>
          <button type="button" class="btn btn-xs" data-modal-action="cancel" aria-label="${escapeHtml(t('modModal.closeAria'))}">✕</button>
        </div>
        <p class="pan-modal-subtitle">${subtitleHtml}</p>
        <ul class="pan-modal-list">
          ${conflicts.map(({ mod, compat }) => `
            <li>
              <div>
                <strong>${escapeHtml(mod.name || mod.filename)}</strong>
                <code>${escapeHtml(mod.filename)}</code>
              </div>
              <p>${escapeHtml(compat.reason)}</p>
            </li>`).join('')}
        </ul>
        <div class="pan-modal-actions">
          <button type="button" class="btn btn-primary btn-sm" data-modal-action="disable-and-play">
            ${escapeHtml(t('modModal.disablePlay'))}
          </button>
          <button type="button" class="btn btn-sm" data-modal-action="play-anyway">
            ${escapeHtml(t('modModal.playAnyway'))}
          </button>
          <button type="button" class="btn btn-sm btn-ghost" data-modal-action="go-mods">
            ${escapeHtml(t('modModal.reviewMods'))}
          </button>
        </div>
      </div>`;

    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', onKeyDown);
        closeModCompatModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    overlay.addEventListener('click', async (ev) => {
      if (ev.target === overlay) {
        document.removeEventListener('keydown', onKeyDown);
        closeModCompatModal();
        return;
      }
      const btn = ev.target.closest('[data-modal-action]');
      if (!btn) return;
      const modalAction = btn.getAttribute('data-modal-action');
      document.removeEventListener('keydown', onKeyDown);

      if (modalAction === 'cancel') {
        closeModCompatModal();
      } else if (modalAction === 'go-mods') {
        closeModCompatModal();
        Nexus.router.navigate('mods');
      } else if (modalAction === 'play-anyway') {
        closeModCompatModal();
        await executePlayLaunch(playNode);
      } else if (modalAction === 'disable-and-play') {
        btn.disabled = true;
        try {
          const res = await Nexus.api.mods.disableIncompatible(profile.gameVersion, profile.loader);
          const current = state();
          if (current && Array.isArray(res.items)) {
            current.customMods.items = res.items;
          }
          closeModCompatModal();
          refresh();
          toast(t('msg.modsIncompatDisabled', { count: res.disabledCount || conflicts.length }));
          await executePlayLaunch(playNode);
        } catch (error) {
          closeModCompatModal();
          toast(publicErrorMessage(error), 'error');
        }
      }
    });

    document.body.appendChild(overlay);
  }

  async function handleAction(node) {
    const action = node.getAttribute('data-action');
    const current = state();

    switch (action) {
      case 'play': {
        if (!Nexus.views.canPlay(current)) {
          const reason = (current.launch.preflight && current.launch.preflight.reasons || [])[0];
          toast(reason ? reason.message : t('msg.reqsMissing'), 'error');
          break;
        }
        const profile = resolveLaunchProfileForMods(current);
        const modList = (current.customMods && current.customMods.items) || [];
        const conflicts = Nexus.modInspector
          ? Nexus.modInspector.findIncompatibleEnabledMods(modList, profile.gameVersion, profile.loader)
          : [];
        if (conflicts.length > 0) {
          showModCompatModal({ profile, conflicts, playNode: node });
          break;
        }
        await executePlayLaunch(node);
        break;
      }

      case 'stop-game': {
        node.disabled = true;
        try {
          await Nexus.api.launch.stop();
          toast(t('msg.stoppingMc'));
        } catch (error) {
          node.disabled = false;
          toast(error.message, 'error');
        }
        break;
      }

      case 'clear-console':
        try {
          await Nexus.api.launch.clearConsole();
          current.launch.lines = [];
          appendConsoleLine({ cleared: true });
        } catch (error) {
          toast(error.message, 'error');
        }
        break;

      case 'refresh-preflight':
        await refreshLaunchPreflight();
        toast(current.launch.preflight.ready ? t('msg.reqsOk') : t('msg.reqsCheckPanel'));
        break;

      case 'navigate':
        Nexus.router.navigate(node.getAttribute('data-view'));
        break;

      case 'select-version': {
        const id = node.getAttribute('data-version-id');
        if (!id || id === current.config.launch.versionId) return;
        if (!current.versions.some((version) => version.id === id)) {
          toast(t('msg.versionInvalid'), 'error');
          return;
        }
        await applyConfig({ launch: { versionId: id, loaderVersion: null, activeInstallationId: null } }, t('msg.versionSelected', { id }));
        warnCompatibilityOnTargetChange(state());
        ensureDirectLoaderCatalog(false).catch(() => {});
        break;
      }

      case 'set-launch-loader': {
        const loader = String(node.getAttribute('data-loader') || '').toLowerCase();
        if (!['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) return;
        const label = DIRECT_LOADER_LABELS[loader] || loader;
        await applyConfig(
          { launch: { loader, loaderVersion: null, activeInstallationId: null } },
          t('msg.loaderChanged', { label })
        );
        warnCompatibilityOnTargetChange(state());
        ensureDirectLoaderCatalog(false).catch(() => {});
        break;
      }

      case 'disable-all-incompatible': {
        const profile = resolveLaunchProfileForMods(current);
        let disabledTotal = 0;
        if (Nexus.api.mods && typeof Nexus.api.mods.disableIncompatible === 'function') {
          const modRes = await Nexus.api.mods.disableIncompatible(profile.gameVersion, profile.loader);
          if (Array.isArray(modRes.items)) current.customMods.items = modRes.items;
          disabledTotal += Number(modRes.disabledCount || 0);
        }
        if (Nexus.api.resourcePacks && typeof Nexus.api.resourcePacks.disableIncompatible === 'function') {
          const rpRes = await Nexus.api.resourcePacks.disableIncompatible(profile.gameVersion);
          if (Array.isArray(rpRes.items)) current.resourcePacks.items = rpRes.items;
          disabledTotal += Number(rpRes.disabledCount || 0);
        }
        refresh();
        toast(t('msg.allIncompatDisabled', { count: disabledTotal }));
        break;
      }

      case 'refresh-direct-loader-catalog':
        await ensureDirectLoaderCatalog(true);
        break;

      case 'install-version': {
        const id = node.getAttribute('data-version-id');
        if (!id || !current.versions.some((version) => version.id === id)) {
          toast(t('msg.versionInvalid'), 'error');
          return;
        }
        if (current.install.active || (current.installations && current.installations.status.active)) {
          toast(t('msg.otherInstallRunning'), 'error');
          return;
        }
        node.disabled = true;
        try {
          await Nexus.api.install.start(id);
          current.install.active = { versionId: id, phase: 'metadata', percent: 0 };
          current.install.progress = {
            versionId: id,
            phase: 'metadata',
            phaseLabel: t('install.preparingMeta'),
            file: '',
            downloaded: 0,
            total: 0,
            percent: 0,
            speed: 0,
            eta: 0,
            filesDone: 0,
            filesTotal: 0,
            message: `${id}…`
          };
          refreshInstallProgress();
          refreshVersionGrid();
          toast(t('msg.installingOfficial', { id }));
        } catch (error) {
          node.disabled = false;
          toast(error.message, 'error');
        }
        break;
      }

      case 'cancel-install': {
        const id = node.getAttribute('data-version-id');
        try {
          await Nexus.api.install.cancel(id || null);
          toast(t('msg.cancelRequested'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'show-more-versions':
        current.ui.limit = (current.ui.limit || lowEndPageSize('versions')) + lowEndPageSize('versions');
        refreshVersionGrid();
        break;

      case 'filter': {
        const filter = node.getAttribute('data-filter');
        if (!['all', 'release', 'snapshot', 'beta', 'alpha', 'installed'].includes(filter)) return;
        current.ui.filter = filter;
        Nexus.router.refresh();
        break;
      }

      case 'sort': {
        const sort = node.getAttribute('data-sort');
        if (sort !== 'newest' && sort !== 'oldest') return;
        current.ui.sort = sort;
        Nexus.router.refresh();
        break;
      }

      case 'reset-filters': {
        current.ui.search = '';
        current.ui.filter = 'all';
        current.ui.sort = 'newest';
        current.ui.limit = lowEndPageSize('versions');
        cancelPendingSearch();
        Nexus.router.refresh();
        break;
      }

      case 'new-install-category': {
        const category = node.getAttribute('data-category');
        if (!['all', 'release', 'snapshot', 'beta', 'alpha'].includes(category)) return;
        current.newInstall.category = category;
        refreshNewInstallVersions();
        break;
      }

      case 'set-ram': {
        const ramMb = Number(node.getAttribute('data-ram'));
        if (!Number.isInteger(ramMb) || ramMb < 1024 || ramMb > 16384) return;
        await applyConfig({ launch: { ramMb } }, t('msg.ramUpdated', { ram: formatRam(ramMb) }));
        break;
      }

      case 'save-min-ram': {
        const input = document.getElementById('min-ram');
        if (!input) return;
        const minRamMb = Number(input.value);
        if (!Number.isInteger(minRamMb) || minRamMb < 256 || minRamMb > 8192) {
          toast(t('msg.minRamRange'), 'error');
          return;
        }
        await applyConfig({ launch: { minRamMb } }, t('msg.minRamUpdated', { mb: minRamMb }));
        break;
      }

      case 'save-java': {
        const input = document.getElementById('java-path');
        if (!input) return;
        const javaPath = input.value.trim();
        if (javaPath.length > 1024) {
          toast(t('msg.javaTooLong'), 'error');
          return;
        }
        await applyConfig({ launch: { javaPath } }, javaPath ? t('msg.javaSaved') : t('msg.javaCleared'));
        break;
      }

      case 'detect-java':
        await refreshJavaStatus();
        toast(current.launch.javaStatus && current.launch.javaStatus.installations.length
          ? t('msg.javaDetected', { count: current.launch.javaStatus.installations.length })
          : t('msg.javaMissing'));
        break;

      case 'save-client-id': {
        const input = document.getElementById('ms-client-id');
        if (!input) return;
        const clientId = input.value.trim();
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (clientId && !uuid.test(clientId)) {
          toast(t('msg.clientIdInvalid'), 'error');
          return;
        }
        await applyConfig(
          { microsoft: { clientId } },
          clientId ? t('msg.clientIdSaved') : t('msg.clientIdCleared')
        );
        break;
      }

      case 'ms-login':
      case 'ms-restore':
      case 'ms-logout': {
        node.disabled = true;
        try {
          if (action === 'ms-logout') {
            await Nexus.api.auth.signOut();
            await refreshAuthAndConfig();
            toast(t('msg.signedOut'));
          } else {
            const profile = action === 'ms-restore'
              ? await Nexus.api.auth.restore()
              : await Nexus.api.auth.signIn();
            if (!profile) throw new Error(t('msg.msProfileFail'));
            await refreshAuthAndConfig();
            toast(t('msg.signedIn', { name: profile.name }));
          }
        } catch (error) {
          toast(error.message, 'error');
          node.disabled = false;
        }
        break;
      }

      case 'session-mode': {
        const mode = node.getAttribute('data-mode');
        if (mode !== 'online' && mode !== 'offline') return;
        node.disabled = true;
        try {
          await Nexus.api.session.setMode(mode);
          await refreshSession(mode === 'offline' ? t('msg.modeOffline') : t('msg.modeOnline'));
        } catch (error) {
          node.disabled = false;
          toast(error.message, 'error');
        }
        break;
      }

      case 'player-create': {
        const input = document.getElementById('new-player-name');
        if (!input) return;
        const name = input.value.trim();
        if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
          toast(t('msg.playerNameInvalid'), 'error');
          return;
        }
        try {
          await Nexus.api.players.create(name);
          input.value = '';
          await refreshSession(t('msg.playerCreated', { name }));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'player-save': {
        const id = node.getAttribute('data-player-id');
        const input = document.querySelector(`input[data-player-name="${id}"]`);
        if (!id || !input) return;
        const name = input.value.trim();
        if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
          toast(t('msg.playerNameInvalid'), 'error');
          return;
        }
        try {
          await Nexus.api.players.update(id, name);
          await refreshSession(t('msg.playerUpdated'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'player-remove': {
        const id = node.getAttribute('data-player-id');
        if (!id) return;
        try {
          await Nexus.api.players.remove(id);
          await refreshSession(t('msg.playerRemoved'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'player-select': {
        const id = node.getAttribute('data-player-id');
        if (!id) return;
        try {
          await Nexus.api.players.select(id);
          await refreshSession(t('msg.playerSelected'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'loader-switch': {
        const loader = node.getAttribute('data-loader');
        if (!['forge', 'neoforge', 'quilt'].includes(loader)) return;
        if (current.loaders.loader === loader) return;
        current.loaders.loader = loader;
        current.loaders.progress = null;
        await refreshLoaderStatus();
        await ensureLoaderVersions(loader, true);
        break;
      }

      case 'loader-refresh': {
        const loader = node.getAttribute('data-loader') || loaderForView(Nexus.router.current);
        await ensureLoaderVersions(loader, true);
        break;
      }

      case 'loader-install': {
        const loader = node.getAttribute('data-loader') || loaderForView(Nexus.router.current);
        const gameVersion = current.loaders.base;
        const loaderVersion = current.loaders.selected;
        if (!loader || !gameVersion || !loaderVersion) {
          toast(t('msg.loaderMissingFields'), 'error');
          return;
        }
        if (current.loaders.status.active) {
          toast(t('msg.loaderRunning'), 'error');
          return;
        }
        try {
          await Nexus.api.loaders.install({ loader, gameVersion, loaderVersion });
          current.loaders.status.active = { versionId: `${loader}-${loaderVersion}-${gameVersion}`, phase: 'metadata' };
          current.loaders.progress = {
            versionId: current.loaders.status.active.versionId,
            phase: 'metadata',
            phaseLabel: t('install.preparingInst'),
            file: '',
            downloaded: 0,
            total: 0,
            percent: 0,
            filesDone: 0,
            filesTotal: 0,
            message: `${loader} ${loaderVersion} (${gameVersion})…`
          };
          refresh();
          toast(t('msg.loaderInstalling', { loader }));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'loader-cancel':
        try {
          await Nexus.api.loaders.cancel();
          toast(t('msg.cancelRequested'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;

      case 'loader-select-profile': {
        const id = node.getAttribute('data-version-id');
        if (!id) return;
        const installed = (current.loaders.status.installed || []).some((item) => item.id === id);
        if (!installed) {
          toast(t('msg.loaderUnavailable'), 'error');
          return;
        }
        await applyConfig({ launch: { versionId: id, activeInstallationId: null } }, t('msg.profileSelected', { id }));
        warnCompatibilityOnTargetChange(state());
        break;
      }

      case 'new-install-set-loader': {
        const loader = node.getAttribute('data-loader');
        if (!['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) return;
        const form = current.newInstall;
        form.loader = loader;
        form.loaderVersion = null;
        form.catalog = [];
        form.catalogState = 'idle';
        refreshNewInstallPanel();
        ensureNewInstallCatalog(false).catch((error) => toast(error.message, 'error'));
        break;
      }

      case 'new-install-pick-version': {
        const versionId = node.getAttribute('data-version-id');
        if (!versionId || !current.versions.some((version) => version.id === versionId)) return;
        current.newInstall.gameVersion = versionId;
        current.newInstall.loaderVersion = null;
        refreshNewInstallPanel();
        ensureNewInstallCatalog(false).catch((error) => toast(error.message, 'error'));
        break;
      }

      case 'versions-refresh': {
        if (current.versionsLoading) break;
        current.versionsLoading = true;
        refresh();
        try {
          const result = await Nexus.api.listVersions({ force: true });
          current.versions = result.items;
          current.versionsWarning = result.warning;
          current.versionsStale = result.stale;
          current.versionsFetchedAt = result.fetchedAt;
          current.versionsSource = result.source;
          refresh();
          if (result.warning) toast(result.warning, 'warning');
          else toast(t('msg.versionsRefreshed'), 'success');
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        } finally {
          current.versionsLoading = false;
          refresh();
        }
        break;
      }

      case 'new-install-refresh-catalog':
        await ensureNewInstallCatalog(true);
        break;

      case 'new-install-show-more':
        current.newInstall.limit = (current.newInstall.limit || lowEndPageSize('newVersions')) + lowEndPageSize('newVersions');
        refreshNewInstallVersions();
        break;

      case 'loader-show-more': {
        const increment = lowEndPageSize('loaders');
        current.loaders.versionLimit = (current.loaders.versionLimit || increment) + increment;
        Nexus.router.refresh();
        break;
      }

      case 'new-install-show-more-loaders': {
        const increment = lowEndPageSize('loaders');
        current.newInstall.catalogLimit = (current.newInstall.catalogLimit || increment) + increment;
        refreshNewInstallPanel();
        break;
      }

      case 'apply-ram-recommendation': {
        const ramMb = Number(node.getAttribute('data-ram'));
        const minRamMb = Number(node.getAttribute('data-min-ram'));
        if (!Number.isInteger(ramMb) || !Number.isInteger(minRamMb) || minRamMb >= ramMb) break;
        await applyConfig({ launch: { ramMb, minRamMb } }, t('msg.ramRecApplied'));
        break;
      }

      case 'toggle-low-end-mode': {
        const enabled = !Boolean(current.config.general.lowEndMode);
        await applyConfig({ general: { lowEndMode: enabled } },
          enabled ? t('msg.lowEndOn') : t('msg.lowEndOff'));
        break;
      }

      case 'options-preset-apply':
      case 'options-preset-restore': {
        const id = node.getAttribute('data-id');
        if (!id) break;
        node.disabled = true;
        try {
          const result = action === 'options-preset-apply'
            ? await Nexus.api.options.presetApply(id)
            : await Nexus.api.options.presetRestore(id);
          const statuses = current.performance && current.performance.optionsPresets;
          if (Array.isArray(statuses)) {
            const index = statuses.findIndex((item) => item.installationId === id);
            if (index >= 0) {
              statuses[index] = await Nexus.api.options.presetStatus(id);
            }
          }
          toast(result.message, 'success');
          refreshInstallationGrid();
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          node.disabled = false;
        }
        break;
      }

      case 'new-install-create': {
        const form = current.newInstall;
        if (form.submitting) return;
        if (current.installations.status.active) {
          toast(t('msg.otherInstallRunning'), 'error');
          return;
        }
        if (!form.name || !form.gameVersion || !form.ramMb || !form.minRamMb) {
          toast(t('msg.newInstallMissing'), 'error');
          return;
        }
        if (form.loader !== 'vanilla' && !form.loaderVersion) {
          toast(t('msg.newInstallLoaderMissing'), 'error');
          return;
        }
        node.disabled = true;
        form.submitting = true;
        try {
          const installation = await Nexus.api.installations.create({
            name: form.name,
            gameVersion: form.gameVersion,
            loader: form.loader,
            loaderVersion: form.loaderVersion,
            ramMb: form.ramMb,
            minRamMb: form.minRamMb,
            javaPath: form.javaPath || ''
          });
          await Nexus.api.installations.start(installation.id);
          await refreshInstallationStatus();
          Nexus.router.navigate('installations');
          toast(t('msg.newInstallCreated', { name: installation.name }));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        } finally {
          form.submitting = false;
          node.disabled = false;
          updateNewInstallSubmitState();
        }
        break;
      }

      case 'installation-refresh':
        await refreshInstallationStatus(t('msg.instStatusUpdated'));
        break;

      case 'installation-select':
      case 'installation-legacy': {
        try {
          if (action === 'installation-select') {
            await Nexus.api.installations.select(node.getAttribute('data-id'));
          } else {
            await Nexus.api.installations.selectLegacy();
          }
          current.config = await Nexus.api.getConfig();
          await refreshLaunchPreflight();
          await refreshInstallationStatus();
          toast(action === 'installation-select' ? t('msg.instSelected') : t('msg.instLegacy'));
          warnCompatibilityOnTargetChange(state());
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'installation-start': {
        const id = node.getAttribute('data-id');
        try {
          const result = await Nexus.api.installations.start(id);
          current.installations.status.active = {
            installationId: result.installationId,
            versionId: result.versionId,
            phase: 'metadata'
          };
          current.installations.progress = {
            installationId: result.installationId,
            versionId: result.versionId,
            phase: 'metadata',
            phaseLabel: t('install.preparingInst'),
            percent: 0,
            filesDone: 0,
            filesTotal: 0,
            message: '…'
          };
          refreshInstallationProgress();
          refreshInstallationGrid();
          toast(t('msg.instStarted'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'installation-cancel':
        try {
          await Nexus.api.installations.cancel(node.getAttribute('data-id'));
          toast(t('msg.cancelRequested'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;

      case 'installation-save': {
        const id = node.getAttribute('data-id');
        const read = (field) => {
          const input = document.querySelector(`[data-install-field="${field}"][data-id="${id}"]`);
          return input ? input.value : undefined;
        };
        try {
          await Nexus.api.installations.update(id, {
            name: read('name'),
            javaPath: read('javaPath'),
            ramMb: Number(read('ramMb')),
            minRamMb: Number(read('minRamMb'))
          });
          await refreshInstallationStatus();
          await refreshLaunchPreflight();
          toast(t('msg.instUpdated'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'installation-remove': {
        const id = node.getAttribute('data-id');
        const installation = (current.installations.list || []).find((item) => item.id === id);
        if (!installation) return;
        const confirmed = await confirmModal({
          message: t('msg.instRemoveConfirm', { name: installation.name })
        });
        if (!confirmed) return;
        try {
          await Nexus.api.installations.remove(id);
          current.config = await Nexus.api.getConfig();
          if (current.folders.installationId === id) current.folders.installationId = null;
          await refreshInstallationStatus();
          await refreshLaunchPreflight();
          toast(t('msg.instRemoved'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'installation-folders': {
        current.folders.installationId = node.getAttribute('data-id');
        Nexus.router.navigate('folders');
        refreshFolders().catch((error) => toast(error.message, 'error'));
        break;
      }

      case 'installation-play': {
        const id = node.getAttribute('data-id');
        try {
          await Nexus.api.installations.select(id);
          current.config = await Nexus.api.getConfig();
          await refreshLaunchPreflight();
          await refreshInstallationStatus();
          Nexus.router.navigate('home');
          Nexus.router.refresh();
          const playButton = document.querySelector('[data-action="play"]');
          if (playButton) handleAction(playButton);
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'folders-refresh':
        await refreshFolders(t('msg.foldersRefreshed'));
        break;

      case 'folders-open': {
        try {
          const result = await Nexus.api.folders.open(current.folders.installationId, node.getAttribute('data-key'));
          if (!result.ok) throw new Error(result.error || t('msg.folderOpenFail'));
          toast(t('msg.folderOpened'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'folders-copy': {
        try {
          await Nexus.api.folders.copy(current.folders.installationId, node.getAttribute('data-key'));
          toast(t('msg.pathCopied'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'skin-import': {
        const modelSelect = document.getElementById('skin-import-model');
        const model = modelSelect ? modelSelect.value : (current.skins.importModel || 'classic');
        try {
          const result = await Nexus.api.skins.pickImport(model);
          if (result.cancelled) {
            toast(t('msg.skinCancelled'));
          } else {
            await refreshSkins(t('msg.skinImported', { name: result.skin.name }));
          }
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'skin-model': {
        try {
          await Nexus.api.skins.setModel(node.getAttribute('data-id'), node.getAttribute('data-model'));
          await refreshSkins(t('msg.skinModelUpdated'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'skin-select': {
        try {
          await Nexus.api.skins.select(node.getAttribute('data-id'));
          await refreshSkins(t('msg.skinSelected'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'skin-remove': {
        const id = node.getAttribute('data-id');
        const skin = (current.skins.items || []).find((item) => item.id === id);
        if (!skin) return;
        const confirmed = await confirmModal({
          message: t('msg.skinRemoveConfirm', { name: skin.name })
        });
        if (!confirmed) return;
        try {
          await Nexus.api.skins.remove(id);
          await refreshSkins(t('msg.skinRemoved'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }

      case 'skin-refresh':
        await refreshSkins(t('msg.skinsRefreshed'));
        break;

      case 'reset-config':
        try {
          await Nexus.api.resetConfig();
          await refreshAuthAndConfig();
          toast(t('msg.configReset'));
        } catch (error) {
          toast(error.message, 'error');
        }
        break;

      case 'perf-apply-preset': {
        const presetId = node.getAttribute('data-preset');
        const preset = Nexus.perfEngine && Nexus.perfEngine.PRESETS[presetId];
        if (!preset) break;
        const presetName = t(`perf.preset.${preset.id}.name`, null, preset.name);
        await applyConfig(
          {
            performance: {
              presetId: preset.id,
              gc: preset.gc,
              alwaysPreTouch: preset.alwaysPreTouch,
              stringDeduplication: preset.stringDeduplication,
              disableTelemetry: preset.disableTelemetry,
              modIds: [...preset.modIds],
              ...preset.video
            }
          },
          t('msg.presetActivated', { name: presetName })
        );
        break;
      }

      case 'perf-set-gc': {
        const gc = node.getAttribute('data-gc');
        if (!['ZGC', 'G1GC', 'Shenandoah'].includes(gc)) break;
        await applyConfig({ performance: { gc } }, t('msg.gcUpdated', { gc }));
        break;
      }

      case 'perf-copy-jvm': {
        if (!Nexus.perfEngine) break;
        const text = Nexus.perfEngine.evaluateFromConfig(current.config).jvmArgs.join(' ');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text).catch(() => {});
        }
        toast(t('msg.jvmCopied'));
        break;
      }

      case 'perf-copy-options': {
        if (!Nexus.perfEngine) break;
        const text = Nexus.perfEngine.evaluateFromConfig(current.config).optionsTxt;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text).catch(() => {});
        }
        toast(t('msg.optionsCopied'));
        break;
      }

      case 'perf-export-mrpack': {
        if (!Nexus.perfEngine) break;
        const evaluated = Nexus.perfEngine.evaluateFromConfig(current.config);
        const mcVersion = (current.config && current.config.launch && current.config.launch.versionId) || '1.21.4';
        const loader = evaluated.exportLoader || 'Fabric';
        const fabricOnly = new Set(['krypton', 'nvidium', 'vulkanmod', 'moreculling']);
        const modIds = evaluated.mods
          .filter((m) => m.enabled && m.id !== 'optifine' && (loader !== 'NeoForge' || !fabricOnly.has(m.id)))
          .map((m) => m.id);
        node.disabled = true;
        try {
          const blob = await Nexus.api.performance.exportMrpack({
            modIds,
            mcVersion,
            loader,
            profileName: `Pan-${evaluated.presetId}-${mcVersion}`,
            optionsTxt: evaluated.optionsTxt,
            jvmArgs: evaluated.jvmArgs.join(' ')
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Pan-launcher-${mcVersion.replace(/[^a-zA-Z0-9._-]/g, '')}.mrpack`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast(t('msg.mrpackDownloaded', { loader, mc: mcVersion }));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        } finally {
          node.disabled = false;
        }
        break;
      }

      case 'cycle-close-behavior': {
        const order = ['quit', 'minimize', 'keep'];
        const cur = (current.config.general && current.config.general.closeBehavior) || 'quit';
        const next = order[(order.indexOf(cur) + 1) % order.length];
        await applyConfig({ general: { closeBehavior: next } }, t(`close.${next}.toast`));
        break;
      }

      case 'custom-mods-pick': {
        const input = document.getElementById('mods-file-input');
        if (input) input.click();
        break;
      }

      case 'custom-mods-open-folder': {
        try {
          const res = await Nexus.api.mods.openFolder();
          if (res && res.ok === false && res.error) toast(res.error, 'error');
          else toast(t('msg.modsFolderOpened'));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'custom-mods-refresh': {
        try {
          await refreshCustomMods();
          toast(t('msg.modsSynced'));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'custom-mods-disable-incompatible': {
        const profile = resolveLaunchProfileForMods(current);
        try {
          const res = await Nexus.api.mods.disableIncompatible(profile.gameVersion, profile.loader);
          current.customMods.items = Array.isArray(res.items) ? res.items : [];
          refresh();
          toast(t('msg.modsIncompatDisabled', { count: res.disabledCount || 0 }));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'custom-mod-remove': {
        const id = node.getAttribute('data-id');
        if (!id) break;
        try {
          current.customMods.items = await Nexus.api.mods.remove(id);
          refresh();
          toast(t('msg.modRemoved'));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'rpacks-pick': {
        const input = document.getElementById('rpacks-file-input');
        if (input) input.click();
        break;
      }

      case 'rpacks-open-folder': {
        try {
          const res = await Nexus.api.resourcePacks.openFolder();
          if (res && res.ok === false && res.error) toast(res.error, 'error');
          else toast(t('msg.rpacksFolderOpened'));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'rpacks-refresh': {
        try {
          await refreshResourcePacks();
          toast(t('msg.rpacksSynced'));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'rpacks-disable-incompatible': {
        const profile = resolveLaunchProfileForMods(current);
        try {
          const res = await Nexus.api.resourcePacks.disableIncompatible(profile.gameVersion);
          current.resourcePacks.items = Array.isArray(res.items) ? res.items : [];
          refresh();
          toast(t('msg.rpacksIncompatDisabled', { count: res.disabledCount || 0 }));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'rpack-remove': {
        const id = node.getAttribute('data-id');
        if (!id) break;
        const pack = (current.resourcePacks && current.resourcePacks.items || []).find((p) => p.id === id);
        if (!pack) break;
        const confirmed = await confirmModal({
          message: t('rpack.removeConfirm', { name: pack.name || pack.filename })
        });
        if (!confirmed) break;
        try {
          current.resourcePacks.items = await Nexus.api.resourcePacks.remove(id);
          refresh();
          toast(t('msg.rpackRemoved'));
        } catch (error) {
          toast(publicErrorMessage(error), 'error');
        }
        break;
      }

      case 'start-tour':
        if (Nexus.tour && typeof Nexus.tour.start === 'function') {
          Nexus.tour.start(0);
        }
        break;

      case 'placeholder':
        toast(t('msg.placeholderNotice'));
        break;

      default:
        break;
    }
  }

  function wireEvents() {
    document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
      button.addEventListener('click', () => Nexus.router.navigate(button.getAttribute('data-view')));
    });

    const langBtn = document.getElementById('btn-lang-switch');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        if (!Nexus.i18n) return;
        const nextLang = Nexus.i18n.getLang() === 'en' ? 'es' : 'en';
        Nexus.i18n.setLang(nextLang, { syncConfig: true });
        if (state() && state().config && state().config.general) {
          state().config.general.language = nextLang;
        }
        const select = document.getElementById('language-select');
        if (select) select.value = nextLang;
        updateShell();
        refreshLaunchPreflight().catch(() => {});
        toast(t('msg.langSaved'));
      });
    }

    const tourBtn = document.getElementById('btn-start-tour');
    if (tourBtn) {
      tourBtn.addEventListener('click', () => {
        if (Nexus.tour && typeof Nexus.tour.start === 'function') {
          Nexus.tour.start(0);
        }
      });
    }

    root.addEventListener('click', (event) => {
      const node = event.target.closest('[data-action]');
      if (!node || !root.contains(node)) return;
      handleAction(node);
    });

    const hasDraggedFiles = (event) => {
      const types = event.dataTransfer && event.dataTransfer.types;
      return Boolean(types && Array.from(types).includes('Files'));
    };

    const getDropZone = (target) => target && (target.closest('#mods-dropzone') || target.closest('#rpacks-dropzone'));

    document.addEventListener('dragover', (event) => {
      if (hasDraggedFiles(event)) event.preventDefault();
    });

    document.addEventListener('drop', (event) => {
      if (hasDraggedFiles(event) && !getDropZone(event.target)) {
        event.preventDefault();
      }
    });

    root.addEventListener('dragenter', (event) => {
      const zone = getDropZone(event.target);
      if (zone && hasDraggedFiles(event)) {
        event.preventDefault();
        zone.classList.add('is-dragover');
      }
    });

    root.addEventListener('dragover', (event) => {
      const zone = getDropZone(event.target);
      if (zone && hasDraggedFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        zone.classList.add('is-dragover');
      }
    });

    root.addEventListener('dragleave', (event) => {
      const zone = getDropZone(event.target);
      if (zone && !zone.contains(event.relatedTarget)) {
        zone.classList.remove('is-dragover');
      }
    });

    root.addEventListener('drop', (event) => {
      const modsZone = event.target.closest('#mods-dropzone');
      const rpacksZone = event.target.closest('#rpacks-dropzone');
      const zone = modsZone || rpacksZone;
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('is-dragover');
      const files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) {
        if (rpacksZone) handleResourcePackFiles(files);
        else handleCustomModFiles(files);
      }
    });

    root.addEventListener('input', (event) => {
      const target = event.target;
      if (target.id === 'version-search') {
        state().ui.search = target.value;
        scheduleSearchRefresh('versions');
      } else if (target.id === 'new-install-name') {
        state().newInstall.name = target.value;
        updateNewInstallSubmitState();
      } else if (target.id === 'new-install-search') {
        state().newInstall.search = target.value;
        scheduleSearchRefresh('newInstall');
      } else if (target.id === 'new-install-ram') {
        state().newInstall.ramMb = Number(target.value);
        updateNewInstallSubmitState();
      } else if (target.id === 'new-install-min-ram') {
        state().newInstall.minRamMb = Number(target.value);
        updateNewInstallSubmitState();
      } else if (target.id === 'ram-range') {
        const label = document.getElementById('ram-value');
        if (label) label.textContent = formatRam(Number(target.value));
      } else if (target.id === 'perf-render-distance') {
        const label = document.getElementById('perf-render-val');
        if (label) label.textContent = t('perf.chunksUnit', { n: target.value });
      } else if (target.id === 'perf-simulation-distance') {
        const label = document.getElementById('perf-sim-val');
        if (label) label.textContent = t('perf.chunksUnit', { n: target.value });
      } else if (target.id === 'perf-max-fps') {
        const val = Number(target.value);
        const label = document.getElementById('perf-fps-val');
        if (label) label.textContent = val >= 260 ? t('perf.unlimited') : `${val} FPS`;
      } else if (target.id === 'perf-ram-mb') {
        const mb = Number(target.value);
        const label = document.getElementById('perf-ram-val');
        if (label) label.textContent = `${Math.round((mb / 1024) * 10) / 10} GB (${mb} MB)`;
      }
    });

    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.id === 'ram-range') {
        const ramMb = Number(target.value);
        if (Number.isInteger(ramMb) && ramMb >= 1024 && ramMb <= 16384) {
          applyConfig({ launch: { ramMb } });
        }
      } else if (target.id === 'language-select') {
        const language = target.value;
        if (language === 'es' || language === 'en') {
          if (Nexus.i18n) Nexus.i18n.setLang(language, { syncConfig: false });
          applyConfig({ general: { language } }, t('msg.langSaved'));
        }
      } else if (target.id === 'close-behavior-select') {
        const closeBehavior = target.value;
        if (closeBehavior === 'quit' || closeBehavior === 'minimize' || closeBehavior === 'keep') {
          applyConfig({ general: { closeBehavior } }, t(`close.${closeBehavior}.toast`));
        }
      } else if (target.id === 'low-end-toggle') {
        applyConfig({ general: { lowEndMode: target.checked } },
          target.checked ? t('msg.lowEndOn') : t('msg.lowEndOff'));
      } else if (target.id === 'perf-hardware-tier') {
        applyConfig({ performance: { hardwareTier: target.value } });
      } else if (target.id === 'perf-export-loader') {
        applyConfig({ performance: { exportLoader: target.value } });
      } else if (target.id === 'perf-render-distance') {
        applyConfig({ performance: { renderDistance: Number(target.value) } });
      } else if (target.id === 'perf-simulation-distance') {
        applyConfig({ performance: { simulationDistance: Number(target.value) } });
      } else if (target.id === 'perf-max-fps') {
        applyConfig({ performance: { maxFps: Number(target.value) } });
      } else if (target.id === 'perf-graphics-mode') {
        applyConfig({ performance: { graphicsMode: target.value } });
      } else if (target.id === 'perf-particles') {
        applyConfig({ performance: { particles: target.value } });
      } else if (target.id === 'perf-clouds') {
        applyConfig({ performance: { clouds: target.value } });
      } else if (target.id === 'perf-ram-mb') {
        const ramMb = Number(target.value);
        if (Number.isInteger(ramMb) && ramMb >= 1024 && ramMb <= 16384) {
          applyConfig({ launch: { ramMb } });
        }
      } else if (target.classList && target.classList.contains('perf-flag-input')) {
        const flag = target.getAttribute('data-flag');
        if (flag) {
          const invert = target.getAttribute('data-invert') === 'true';
          const value = invert ? !target.checked : target.checked;
          applyConfig({ performance: { [flag]: value } });
        }
      } else if (target.classList && target.classList.contains('perf-mod-checkbox')) {
        const modId = target.getAttribute('data-mod-id');
        if (modId && Nexus.perfEngine) {
          const currentPerf = Nexus.perfEngine.normalizePerfState(state().config);
          const nextSet = new Set(currentPerf.enabledIds);
          if (target.checked) nextSet.add(modId);
          else nextSet.delete(modId);
          applyConfig({ performance: { modIds: [...nextSet] } });
        }
      } else if (target.id === 'loader-base') {
        const loader = target.getAttribute('data-loader') || loaderForView(Nexus.router.current);
        state().loaders.base = target.value;
        ensureLoaderVersions(loader, true).catch((error) => toast(error.message, 'error'));
      } else if (target.id === 'loader-version') {
        state().loaders.selected = target.value;
      } else if (target.id === 'new-install-java') {
        state().newInstall.javaPath = target.value;
      } else if (target.id === 'new-install-loader-version') {
        state().newInstall.loaderVersion = target.value;
        updateNewInstallSubmitState();
      } else if (target.id === 'folders-installation') {
        state().folders.installationId = target.value;
        refreshFolders().catch((error) => toast(error.message, 'error'));
      } else if (target.id === 'home-loader-version') {
        applyConfig({ launch: { loaderVersion: target.value || null } })
          .then(() => warnCompatibilityOnTargetChange(state()))
          .catch(() => {});
      } else if (target.id === 'skin-import-model') {
        state().skins.importModel = target.value;
      } else if (target.id === 'mods-file-input') {
        const files = target.files ? Array.from(target.files) : [];
        target.value = '';
        if (files.length) handleCustomModFiles(files);
      } else if (target.classList && target.classList.contains('custom-mod-toggle')) {
        const id = target.getAttribute('data-id');
        if (id && Nexus.api.mods) {
          Nexus.api.mods.toggle(id, target.checked)
            .then((items) => {
              state().customMods.items = items;
              refresh();
            })
            .catch((error) => toast(publicErrorMessage(error), 'error'));
        }
      } else if (target.id === 'rpacks-file-input') {
        const files = target.files ? Array.from(target.files) : [];
        target.value = '';
        if (files.length) handleResourcePackFiles(files);
      } else if (target.classList && target.classList.contains('rpack-toggle')) {
        const id = target.getAttribute('data-id');
        if (id && Nexus.api.resourcePacks) {
          Nexus.api.resourcePacks.toggle(id, target.checked)
            .then((items) => {
              state().resourcePacks.items = items;
              refresh();
            })
            .catch((error) => toast(publicErrorMessage(error), 'error'));
        }
      }
    });
  }

  function applyVersionCatalog(result) {
    const current = state();
    if (!current) return;
    const info = result && !Array.isArray(result) ? result : {
      items: Array.isArray(result) ? result : [],
      stale: false,
      warning: null,
      fetchedAt: null,
      source: 'official'
    };
    current.versions = Array.isArray(info.items) ? info.items : [];
    current.versionsWarning = info.warning || null;
    current.versionsStale = Boolean(info.stale);
    current.versionsFetchedAt = info.fetchedAt || null;
    current.versionsSource = info.source || (info.stale ? 'cache' : 'official');
    current.versionsLoading = false;
    if (!current.versions.some((version) => version.id === current.config.launch.versionId)) {
      const fallback = (current.versions.find((version) => version.type === 'release') || current.versions[0] || {}).id;
      if (fallback && current.newInstall.gameVersion === current.config.launch.versionId) {
        current.newInstall.gameVersion = fallback;
      }
    }
    refresh();
  }

  function maybeAutoStartTour() {
    if (Nexus.tour && typeof Nexus.tour.shouldAutoStart === 'function' && Nexus.tour.shouldAutoStart()) {
      window.setTimeout(() => {
        if (Nexus.tour && !Nexus.tour.isActive()) {
          Nexus.tour.start(0);
        }
      }, 280);
    }
  }

  async function boot() {
    root = document.getElementById('view-root');

    try {
      const [
        info, config, auth, sessionStatus, installStatus, launchStatus, loaderStatus,
        installationStatus, logoInfo, customModList, resourcePackList
      ] = await Promise.all([
        Nexus.api.getInfo(),
        Nexus.api.getConfig(),
        Nexus.api.auth.status(),
        Nexus.api.session.status(),
        Nexus.api.install.status(),
        Nexus.api.launch.status(),
        Nexus.api.loaders.status(),
        Nexus.api.installations.status(),
        Nexus.api.logo.get(),
        Nexus.api.mods.list().catch(() => []),
        Nexus.api.resourcePacks ? Nexus.api.resourcePacks.list().catch(() => []) : Promise.resolve([])
      ]);

      if (Nexus.i18n && Nexus.i18n.hasChosenLang() && config && config.general) {
        const chosen = Nexus.i18n.getLang();
        if (config.general.language !== chosen) {
          config.general.language = chosen;
          Nexus.api.updateConfig({ general: { language: chosen } }).catch(() => {});
        }
      }

      const installationList = Array.isArray(installationStatus.installations)
        ? installationStatus.installations
        : [];
      const defaultGameVersion = config.launch.versionId || '';
      const defaultFolderId = config.launch.activeInstallationId
        || (installationList[0] && installationList[0].id)
        || null;

      Nexus.state = {
        info,
        performance: info && info.performance ? info.performance : null,
        logo: logoInfo || null,
        config,
        versions: [],
        versionsWarning: null,
        versionsStale: false,
        versionsFetchedAt: null,
        versionsSource: 'official',
        versionsLoading: true,
        auth: auth || null,
        session: sessionStatus || { mode: 'online', profile: null, locals: [] },
        installed: Array.isArray(installStatus.installed) ? installStatus.installed : [],
        install: {
          active: installStatus.active || null,
          progress: progressFromStatus(installStatus)
        },
        launch: {
          status: launchStatus || null,
          preflight: { ready: false, reasons: [{ code: 'loading', message: t('launch.checkingReqs') }] },
          javaStatus: null,
          lines: Array.isArray(launchStatus && launchStatus.lines) ? launchStatus.lines.slice(-40) : [],
          starting: false
        },
        loaders: {
          status: loaderStatus || { active: null, installed: [], lastResult: null },
          versions: [],
          versionState: 'idle',
          versionError: '',
          versionFetchedAt: null,
          versionSource: null,
          versionStale: false,
          versionLoader: null,
          versionBase: null,
          base: '',
          selected: '',
          loader: 'fabric',
          versionLimit: lowEndPageSize('loaders'),
          progress: null
        },
        installations: {
          list: installationList,
          status: installationStatus || { active: null, lastResult: null },
          progress: installationProgressFromStatus(installationStatus)
        },
        newInstall: {
          name: '',
          gameVersion: defaultGameVersion,
          loader: 'vanilla',
          loaderVersion: null,
          submitting: false,
          javaPath: '',
          ramMb: config.launch.ramMb,
          minRamMb: config.launch.minRamMb,
          javaOptions: [],
          search: '',
          category: 'all',
          limit: lowEndPageSize('newVersions'),
          catalog: [],
          catalogLimit: lowEndPageSize('loaders'),
          catalogState: 'idle',
          catalogError: '',
          catalogWarning: '',
          catalogFetchedAt: null,
          catalogSource: null,
          catalogStale: false,
          catalogLoader: null,
          catalogGameVersion: null
        },
        folders: {
          installationId: defaultFolderId,
          items: [],
          error: null
        },
        skins: {
          items: [],
          loaded: false,
          importModel: 'classic'
        },
        customMods: {
          items: Array.isArray(customModList) ? customModList : [],
          uploading: false
        },
        resourcePacks: {
          items: Array.isArray(resourcePackList) ? resourcePackList : [],
          uploading: false
        },
        directLoader: {
          loader: null,
          gameVersion: null,
          state: 'idle',
          items: [],
          error: '',
          stale: false
        },
        ui: { search: '', filter: 'all', sort: 'newest', limit: lowEndPageSize('versions') }
      };

      const loaderIds = new Set((loaderStatus && loaderStatus.installed || []).map((item) => item.id));
      const vanillaIds = (installStatus.installed || []).filter((id) => !loaderIds.has(id));
      Nexus.state.loaders.base = vanillaIds.includes(config.launch.versionId)
        ? config.launch.versionId
        : vanillaIds[0] || '';
      Nexus.state.loaders.progress = loaderProgressFromStatus(loaderStatus);

      applyLowEndMode(config);
      applyLogo(logoInfo);
      if (Nexus.i18n && typeof Nexus.i18n.hydrateShell === 'function') {
        Nexus.i18n.hydrateShell();
      }
      Nexus.router.init();
      wireEvents();
      wireInstallProgress();
      wireInstallationProgress();
      wireLaunchEvents();
      wireLoaderProgress();
      const onViewChange = () => {
        const view = Nexus.router.current;
        const loader = loaderForView(view);
        cancelPendingSearch();
        if (loader) ensureLoaderVersions(loader, false).catch(() => {});
        if (view === 'newInstall') {
          ensureJavaOptions(false).catch(() => {});
          ensureNewInstallCatalog(false).catch(() => {});
        }
        if (view === 'folders') refreshFolders().catch(() => {});
        if (view === 'mods') refreshCustomMods().catch(() => {});
        if (view === 'resourcepacks') refreshResourcePacks().catch(() => {});
        if (view === 'installations') refreshInstallationStatus().catch(() => {});
        if (view === 'skins') ensureSkins(false).catch(() => {});
      };
      window.addEventListener('hashchange', onViewChange);
      unsubscribers.push(() => window.removeEventListener('hashchange', onViewChange));
      const initialLoader = loaderForView(Nexus.router.current);
      if (initialLoader) ensureLoaderVersions(initialLoader, false).catch(() => {});
      if (Nexus.router.current === 'newInstall') {
        ensureJavaOptions(false).catch(() => {});
        ensureNewInstallCatalog(false).catch(() => {});
      }
      if (Nexus.router.current === 'folders') refreshFolders().catch(() => {});
      if (Nexus.router.current === 'resourcepacks') refreshResourcePacks().catch(() => {});
      if (Nexus.router.current === 'skins') ensureSkins(false).catch(() => {});
      window.addEventListener('pagehide', () => {
        cancelPendingSearch();
        for (const dispose of unsubscribers.splice(0)) {
          try { dispose(); } catch { /* La ventana ya se está cerrando. */ }
        }
      }, { once: true });
      refreshLaunchPreflight().catch(() => {});
      ensureDirectLoaderCatalog(false).catch(() => {});
      updateShell();
      hydrateIcons(document.querySelector('.app-shell'));
      if (Nexus.i18n && typeof Nexus.i18n.hasChosenLang === 'function' && !Nexus.i18n.hasChosenLang()) {
        Nexus.i18n.showLanguageModal(() => {
          updateShell();
          refreshLaunchPreflight().catch(() => {});
          maybeAutoStartTour();
        });
      } else {
        maybeAutoStartTour();
      }
      Nexus.api.listVersions().then(applyVersionCatalog).catch((error) => {
        const current = state();
        if (!current) return;
        current.versions = [];
        current.versionsWarning = publicErrorMessage(error);
        current.versionsStale = true;
        current.versionsLoading = false;
        refresh();
      });
    } catch (error) {
      if (root) {
        root.innerHTML = `<div class="error-state"><h2>${escapeHtml(t('shell.bootError'))}</h2><p>${escapeHtml(error.message)}</p></div>`;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
