'use strict';

(function () {
  const bridge = window.nexus;
  const unavailable = () => Promise.reject(new Error('La API de Pan Launcher no está disponible.'));
  const normalizeVersionList = (result) => {
    if (Array.isArray(result)) {
      return { items: result, stale: false, warning: null, fetchedAt: null, source: 'official' };
    }
    return {
      items: Array.isArray(result && result.items) ? result.items : [],
      stale: Boolean(result && result.stale),
      warning: (result && result.warning) || null,
      fetchedAt: Number(result && result.fetchedAt) || null,
      source: (result && result.source) || (result && result.stale ? 'cache' : 'official')
    };
  };

  const normalizeLoaderCatalog = (result) => {
    if (Array.isArray(result)) {
      return { items: result, stale: false, warning: null, fetchedAt: null, source: 'official' };
    }
    return {
      items: Array.isArray(result && result.items) ? result.items : [],
      loader: (result && result.loader) || null,
      gameVersion: (result && result.gameVersion) || null,
      stale: Boolean(result && result.stale),
      warning: (result && result.warning) || null,
      fetchedAt: Number(result && result.fetchedAt) || null,
      source: (result && result.source) || (result && result.stale ? 'cache' : 'official')
    };
  };

  window.Nexus = window.Nexus || {};
  window.Nexus.api = Object.freeze({
    getInfo: () => (bridge ? bridge.info.get() : unavailable()),
    getConfig: () => (bridge ? bridge.config.get() : unavailable()),
    updateConfig: (patch) => (bridge ? bridge.config.update(patch) : unavailable()),
    resetConfig: () => (bridge ? bridge.config.reset() : unavailable()),
    listVersions: (options) => (bridge ? bridge.versions.list(options).then(normalizeVersionList) : unavailable()),
    info: Object.freeze({
      get: () => (bridge ? bridge.info.get() : unavailable())
    }),
    logo: Object.freeze({
      get: () => (bridge ? bridge.logo.get() : unavailable())
    }),
    config: Object.freeze({
      get: () => (bridge ? bridge.config.get() : unavailable()),
      update: (patch) => (bridge ? bridge.config.update(patch) : unavailable()),
      reset: () => (bridge ? bridge.config.reset() : unavailable())
    }),
    versions: Object.freeze({
      list: (options) => (bridge ? bridge.versions.list(options).then(normalizeVersionList) : unavailable())
    }),
    catalogs: Object.freeze({
      get: (kind, gameVersion, options) => (bridge
        ? bridge.catalogs.get(kind, gameVersion, options).then(normalizeLoaderCatalog)
        : unavailable())
    }),
    install: Object.freeze({
      status: () => (bridge ? bridge.install.status() : unavailable()),
      start: (versionId) => (bridge ? bridge.install.start(versionId) : unavailable()),
      cancel: (versionId) => (bridge ? bridge.install.cancel(versionId) : unavailable()),
      onProgress: (listener) => bridge && bridge.install.onProgress(listener)
    }),
    installations: Object.freeze({
      list: () => (bridge ? bridge.installations.list() : unavailable()),
      get: (id) => (bridge ? bridge.installations.get(id) : unavailable()),
      create: (request) => (bridge ? bridge.installations.create(request) : unavailable()),
      update: (id, patch) => (bridge ? bridge.installations.update(id, patch) : unavailable()),
      remove: (id) => (bridge ? bridge.installations.remove(id) : unavailable()),
      select: (id) => (bridge ? bridge.installations.select(id) : unavailable()),
      selectLegacy: () => (bridge ? bridge.installations.selectLegacy() : unavailable()),
      javaOptions: () => (bridge ? bridge.installations.javaOptions() : unavailable()),
      status: () => (bridge ? bridge.installations.status() : unavailable()),
      start: (id) => (bridge ? bridge.installations.start(id) : unavailable()),
      cancel: (id) => (bridge ? bridge.installations.cancel(id) : unavailable()),
      onProgress: (listener) => bridge && bridge.installations.onProgress(listener)
    }),
    options: Object.freeze({
      presetStatus: (installationId) => (bridge
        ? bridge.options.presetStatus(installationId) : unavailable()),
      presetApply: (installationId) => (bridge
        ? bridge.options.presetApply(installationId) : unavailable()),
      presetRestore: (installationId) => (bridge
        ? bridge.options.presetRestore(installationId) : unavailable())
    }),
    folders: Object.freeze({
      list: (installationId) => (bridge ? bridge.folders.list(installationId) : unavailable()),
      open: (installationId, key) => (bridge ? bridge.folders.open(installationId, key) : unavailable()),
      copy: (installationId, key) => (bridge ? bridge.folders.copy(installationId, key) : unavailable())
    }),
    skins: Object.freeze({
      list: () => (bridge ? bridge.skins.list() : unavailable()),
      pickImport: (model) => (bridge ? bridge.skins.pickImport(model) : unavailable()),
      setModel: (id, model) => (bridge ? bridge.skins.setModel(id, model) : unavailable()),
      select: (id) => (bridge ? bridge.skins.select(id) : unavailable()),
      remove: (id) => (bridge ? bridge.skins.remove(id) : unavailable())
    }),
    auth: Object.freeze({
      status: () => (bridge ? bridge.auth.status() : unavailable()),
      signIn: () => (bridge ? bridge.auth.signIn() : unavailable()),
      restore: () => (bridge ? bridge.auth.restore() : unavailable()),
      signOut: () => (bridge ? bridge.auth.signOut() : unavailable())
    }),
    session: Object.freeze({
      status: () => (bridge ? bridge.session.status() : unavailable()),
      setMode: (mode) => (bridge ? bridge.session.setMode(mode) : unavailable())
    }),
    players: Object.freeze({
      create: (name) => (bridge ? bridge.players.create(name) : unavailable()),
      update: (id, name) => (bridge ? bridge.players.update(id, name) : unavailable()),
      remove: (id) => (bridge ? bridge.players.remove(id) : unavailable()),
      select: (id) => (bridge ? bridge.players.select(id) : unavailable())
    }),
    loaders: Object.freeze({
      status: () => (bridge ? bridge.loaders.status() : unavailable()),
      versions: (loader, gameVersion, options) => (bridge
        ? bridge.loaders.versions(loader, gameVersion, options).then(normalizeLoaderCatalog)
        : unavailable()),
      install: (request) => (bridge ? bridge.loaders.install(request) : unavailable()),
      cancel: () => (bridge ? bridge.loaders.cancel() : unavailable()),
      onProgress: (listener) => bridge && bridge.loaders.onProgress(listener)
    }),
    launch: Object.freeze({
      preflight: () => (bridge ? bridge.launch.preflight() : unavailable()),
      java: (versionId) => (bridge ? bridge.launch.java(versionId) : unavailable()),
      javaStatus: (versionId) => (bridge ? bridge.launch.java(versionId) : unavailable()),
      start: () => (bridge ? bridge.launch.start() : unavailable()),
      stop: () => (bridge ? bridge.launch.stop() : unavailable()),
      status: () => (bridge ? bridge.launch.status() : unavailable()),
      onStatus: (listener) => bridge && bridge.launch.onStatus(listener),
      onConsole: (listener) => bridge && bridge.launch.onConsole(listener),
      clearConsole: () => (bridge ? bridge.launch.clearConsole() : unavailable())
    }),
    performance: Object.freeze({
      evaluate: (payload) => (bridge && bridge.performance ? bridge.performance.evaluate(payload) : unavailable()),
      exportMrpack: (payload) => (bridge && bridge.performance ? bridge.performance.exportMrpack(payload) : unavailable())
    })
  });
})();
