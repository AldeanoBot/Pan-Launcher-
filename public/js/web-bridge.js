(function () {
  'use strict';

  // Si se ejecuta dentro de Electron con preload real, respeta el bridge nativo.
  if (window.nexus) return;

  const STORAGE_KEY = 'pan_launcher_web_state_v1';

  const DEFAULT_CONFIG = Object.freeze({
    general: {
      theme: 'dark',
      language: 'es',
      closeBehavior: 'quit',
      lowEndMode: false
    },
    launch: {
      ramMb: 4096,
      minRamMb: 512,
      javaPath: '',
      versionId: '1.21.4',
      loader: 'vanilla',
      loaderVersion: null,
      activeInstallationId: null
    },
    account: {
      activeId: null
    },
    session: {
      mode: 'online',
      localId: null
    },
    skins: {
      activeId: null
    },
    microsoft: {
      clientId: ''
    },
    performance: {
      presetId: 'pvp',
      hardwareTier: 'auto',
      exportLoader: 'Fabric',
      gc: 'ZGC',
      alwaysPreTouch: false,
      stringDeduplication: false,
      parallelThreads: 4,
      renderDistance: 5,
      simulationDistance: 5,
      maxFps: 260,
      graphicsMode: 'fast',
      smoothLighting: false,
      entityShadows: false,
      particles: 'minimal',
      clouds: 'off',
      vsync: false,
      biomeBlend: 0,
      entityDistanceScaling: 60,
      guiScale: 2,
      fullbright: true,
      rawMouseInput: true,
      lowFireOverlay: true,
      viewBobbing: true,
      mipmapZero: false,
      disableVisualEffects: false,
      disableTelemetry: true,
      modIds: [
        'sodium',
        'lithium',
        'ferritecore',
        'entityculling',
        'modernfix',
        'krypton'
      ]
    }
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function randomId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix ? `${prefix}-${window.crypto.randomUUID().slice(0, 8)}` : window.crypto.randomUUID();
    }
    const rand = Math.random().toString(16).slice(2, 10);
    return prefix ? `${prefix}-${rand}` : rand;
  }

  function deterministicUuid(name) {
    const raw = `OfflinePlayer:${name}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    let h3 = 0x85ebca6b;
    let h4 = 0xc2b2ae35;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
      h3 = Math.imul(h3 ^ (ch * 31), 0xc2b2ae35) >>> 0;
      h4 = Math.imul(h4 ^ (ch + 7), 0x27d4eb2f) >>> 0;
    }
    const hex = [h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-3${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  function tr(key, vars, fallback) {
    const i18n = window.Nexus && window.Nexus.i18n;
    if (i18n && typeof i18n.t === 'function') {
      const translated = i18n.t(key, vars);
      if (translated !== key || !fallback) return translated;
    }
    if (!fallback) return key;
    if (!vars) return fallback;
    return String(fallback).replace(/\{([A-Za-z0-9_]+)\}/g, (full, k) => (
      Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : full
    ));
  }

  function defaultStore() {
    return {
      config: clone(DEFAULT_CONFIG),
      installed: [],
      installations: [],
      loadersInstalled: [],
      locals: [],
      skinsLocal: [],
      customMods: [],
      resourcePacks: [],
      skinOverrides: {},
      optionsPresets: {},
      lastInstallResult: null,
      lastLoaderResult: null,
      lastInstallationResult: null
    };
  }

  function mergeConfig(base, patch) {
    const next = clone(base);
    if (!patch || typeof patch !== 'object') return next;
    for (const section of Object.keys(DEFAULT_CONFIG)) {
      if (patch[section] && typeof patch[section] === 'object' && !Array.isArray(patch[section])) {
        next[section] = { ...next[section], ...patch[section] };
      }
    }
    return next;
  }

  function loadStore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = defaultStore();
        fresh.perfSafetyMigratedV2 = true;
        fresh.perfPresetRebalancedV3 = true;
        return fresh;
      }
      const parsed = JSON.parse(raw);
      const base = defaultStore();
      const loaded = {
        ...base,
        ...parsed,
        config: mergeConfig(base.config, parsed && parsed.config),
        installed: Array.isArray(parsed && parsed.installed) ? parsed.installed : [],
        installations: Array.isArray(parsed && parsed.installations) ? parsed.installations : [],
        loadersInstalled: Array.isArray(parsed && parsed.loadersInstalled) ? parsed.loadersInstalled : [],
        locals: Array.isArray(parsed && parsed.locals) ? parsed.locals : [],
        skinsLocal: Array.isArray(parsed && parsed.skinsLocal) ? parsed.skinsLocal : [],
        customMods: Array.isArray(parsed && parsed.customMods) ? parsed.customMods : [],
        resourcePacks: Array.isArray(parsed && parsed.resourcePacks) ? parsed.resourcePacks : [],
        skinOverrides: (parsed && parsed.skinOverrides) || {},
        optionsPresets: (parsed && parsed.optionsPresets) || {}
      };
      if (!parsed || !parsed.perfSafetyMigratedV2) {
        if (loaded.config && loaded.config.performance && Array.isArray(loaded.config.performance.modIds)) {
          loaded.config.performance.modIds = loaded.config.performance.modIds.filter(
            (id) => id !== 'immediatelyfast' && id !== 'moreculling'
          );
        }
        if (loaded.config && loaded.config.performance && loaded.config.performance.gc === 'ZGC') {
          loaded.config.performance.alwaysPreTouch = false;
        }
        loaded.perfSafetyMigratedV2 = true;
      }
      if (!parsed || !parsed.perfPresetRebalancedV3) {
        const perfCfg = loaded.config && loaded.config.performance;
        if (perfCfg && perfCfg.presetId === 'pvp') {
          Object.assign(perfCfg, {
            renderDistance: 5,
            simulationDistance: 5,
            biomeBlend: 0,
            entityDistanceScaling: 60
          });
        } else if (perfCfg && perfCfg.presetId === 'potato') {
          Object.assign(perfCfg, {
            renderDistance: 2,
            simulationDistance: 5,
            biomeBlend: 0,
            entityDistanceScaling: 50,
            viewBobbing: false,
            mipmapZero: true,
            disableVisualEffects: true
          });
        }
        loaded.perfPresetRebalancedV3 = true;
      }
      return loaded;
    } catch {
      const fresh = defaultStore();
      fresh.perfSafetyMigratedV2 = true;
      fresh.perfPresetRebalancedV3 = true;
      return fresh;
    }
  }

  let store = loadStore();

  function saveStore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignora límite de almacenamiento si falla
    }
  }
  saveStore();

  // IndexedDB binary store para resource packs (.zip) en modo web
  const RPACK_DB_NAME = 'pan_launcher_rpacks_db';
  const RPACK_STORE_NAME = 'packs';

  function openRpackDb() {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        resolve(null);
        return;
      }
      const req = window.indexedDB.open(RPACK_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RPACK_STORE_NAME)) {
          db.createObjectStore(RPACK_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB error'));
    });
  }

  async function rpackStorePut(id, buffer) {
    try {
      const db = await openRpackDb();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(RPACK_STORE_NAME, 'readwrite');
        tx.objectStore(RPACK_STORE_NAME).put(buffer, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // Ignore IndexedDB quota errors gracefully
    }
  }

  async function rpackStoreDelete(id) {
    try {
      const db = await openRpackDb();
      if (!db) return;
      await new Promise((resolve) => {
        const tx = db.transaction(RPACK_STORE_NAME, 'readwrite');
        tx.objectStore(RPACK_STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    } catch {
      // Ignore
    }
  }

  // Bus de eventos simple
  const listeners = {
    installProgress: new Set(),
    installationProgress: new Set(),
    loaderProgress: new Set(),
    launchStatus: new Set(),
    launchConsole: new Set()
  };

  function subscribe(set, fn) {
    if (typeof fn !== 'function') return () => {};
    set.add(fn);
    return () => set.delete(fn);
  }

  function emit(set, payload) {
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch {
        // Ignora errores de oyentes
      }
    }
  }

  // Hardware & performance overview matching src/main/services/performance.js
  function detectedHardware() {
    const devMemGb = Number(navigator.deviceMemory) || 8;
    const totalRamMb = Math.round(devMemGb * 1024);
    let tier = 'desconocida';
    if (totalRamMb <= 4096) tier = 'baja';
    else if (totalRamMb <= 6144) tier = 'media-baja';
    else if (totalRamMb <= 8192) tier = 'media';
    else if (totalRamMb <= 16384) tier = 'alta';
    return {
      cpuModel: (navigator.platform || 'PC') + ' · Navegador Web',
      logicalCores: Number(navigator.hardwareConcurrency) || 4,
      totalRamMb,
      availableRamMb: Math.round(totalRamMb * 0.55),
      platform: navigator.platform || 'web',
      arch: 'x64',
      osRelease: '',
      tier
    };
  }

  function recommendRam(input) {
    const hw = detectedHardware();
    const versionId = String((input && input.versionId) || '');
    const loader = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(input && input.loader)
      ? input.loader
      : 'vanilla';
    const calver = versionId.match(/^(\d{2,})\.(\d+)/);
    const snap = versionId.match(/^(\d{2})w/);
    const match = versionId.match(/^1\.(\d+)/);
    const legacy = calver || (snap && Number(snap[1]) >= 18)
      ? false
      : match
        ? Number(match[1]) <= 12
        : /^(?:[ab]|1\.\d+-)/i.test(versionId);
    const totalMb = hw.totalRamMb;
    const modded = loader !== 'vanilla';
    let baseMax = 4096;
    if (legacy) {
      baseMax = totalMb <= 4096 ? 1024 : totalMb <= 6144 ? 1280 : totalMb <= 8192 ? 1536 : 2048;
    } else if (totalMb <= 4096) {
      baseMax = modded ? 1792 : 1536;
    } else if (totalMb <= 6144) {
      baseMax = modded ? 2560 : 2048;
    } else if (totalMb <= 8192) {
      baseMax = modded ? 3072 : 2560;
    } else {
      baseMax = modded ? 4096 : 3072;
    }
    const capMb = Math.floor((totalMb * 0.42) / 256) * 256;
    const recommendedMaxMb = Math.min(16384, Math.max(1024, Math.min(baseMax, capMb || baseMax)));
    const recommendedMinMb = 512;
    const currentMax = Number(input && input.ramMb);
    const tooDemanding = Boolean(
      Number.isInteger(currentMax) &&
      currentMax > 0 &&
      (currentMax > totalMb * 0.5 || currentMax > recommendedMaxMb * 1.5 || (legacy && currentMax > 2048))
    );
    const reasons = [
      legacy
        ? 'Las versiones antiguas suelen rendir mejor con heap pequeño y Java 8.'
        : loader === 'vanilla'
          ? 'Vanilla no necesita un heap grande; conviene dejar memoria al sistema y a los gráficos integrados.'
          : `Los perfiles de ${loader} pueden necesitar más heap que Vanilla, sin superar la memoria disponible.`,
      `Equipo detectado: ${totalMb} MB estimados, reserva aproximada del 58% para sistema/launcher/gráficos.`
    ];
    if (tooDemanding) {
      reasons.push('La configuración actual puede ser excesiva para este equipo; reduce la memoria máxima si aparecen pausas.');
    }
    return {
      tier: hw.tier,
      generation: legacy ? 'legacy' : 'modern',
      loader,
      totalRamMb: totalMb,
      availableRamMb: hw.availableRamMb,
      recommendedMaxMb,
      recommendedMinMb,
      tooDemanding,
      severity: tooDemanding ? 'warning' : 'info',
      reasons
    };
  }

  function presetStatusFor(installationId) {
    const inst = store.installations.find((item) => item.id === installationId);
    const saved = store.optionsPresets[installationId] || { applied: false, restorable: false };
    const available = Boolean(inst && inst.installStatus === 'ready');
    return {
      installationId,
      available,
      applied: Boolean(available && saved.applied),
      restorable: Boolean(available && saved.restorable),
      recognizedKeys: ['particles', 'renderDistance', 'graphicsMode', 'enableVsync'],
      changedKeys: saved.applied ? ['particles', 'renderDistance', 'graphicsMode', 'enableVsync'] : []
    };
  }

  function computePerformanceOverview() {
    const activeInst = store.installations.find((item) => item.id === store.config.launch.activeInstallationId) || null;
    return {
      hardware: detectedHardware(),
      profiles: {
        legacy: recommendRam({ versionId: '1.12.2', loader: 'vanilla' }),
        modernVanilla: recommendRam({ versionId: '1.21.4', loader: 'vanilla' }),
        fabric: recommendRam({ versionId: '1.21.4', loader: 'fabric' }),
        forge: recommendRam({ versionId: '1.21.4', loader: 'forge' }),
        neoforge: recommendRam({ versionId: '1.21.4', loader: 'neoforge' }),
        quilt: recommendRam({ versionId: '1.21.4', loader: 'quilt' })
      },
      active: recommendRam({
        versionId: activeInst ? activeInst.versionId : store.config.launch.versionId,
        loader: activeInst ? activeInst.loader : (store.config.launch.loader || 'vanilla'),
        ramMb: activeInst ? activeInst.ramMb : store.config.launch.ramMb,
        minRamMb: activeInst ? activeInst.minRamMb : store.config.launch.minRamMb
      }),
      installations: store.installations.map((item) => ({
        installationId: item.id,
        recommendation: recommendRam({
          versionId: item.versionId,
          loader: item.loader,
          ramMb: item.ramMb,
          minRamMb: item.minRamMb
        })
      })),
      optionsPresets: store.installations.map((item) => presetStatusFor(item.id))
    };
  }

  const FALLBACK_MC_VERSIONS = [
    { id: '26.3', type: 'release', releaseTime: '2026-04-01T12:00:00Z' },
    { id: '26.2', type: 'release', releaseTime: '2026-03-01T12:00:00Z' },
    { id: '1.21.11', type: 'release', releaseTime: '2026-01-15T12:00:00Z' },
    { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T12:00:00Z' },
    { id: '1.21.3', type: 'release', releaseTime: '2024-10-23T12:00:00Z' },
    { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T12:00:00Z' },
    { id: '1.20.4', type: 'release', releaseTime: '2023-12-07T12:00:00Z' },
    { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T12:00:00Z' },
    { id: '1.19.4', type: 'release', releaseTime: '2023-03-14T12:00:00Z' },
    { id: '1.18.2', type: 'release', releaseTime: '2022-02-28T12:00:00Z' },
    { id: '1.16.5', type: 'release', releaseTime: '2021-01-15T12:00:00Z' },
    { id: '1.12.2', type: 'release', releaseTime: '2017-09-18T12:00:00Z' },
    { id: '1.8.9', type: 'release', releaseTime: '2015-12-09T12:00:00Z' }
  ];

  let localHostHealthCache = null;

  async function checkLocalHostHealth() {
    if (localHostHealthCache) return localHostHealthCache;
    try {
      const resp = await fetch('/api/health', { cache: 'no-store' });
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && ct.includes('application/json')) {
        const data = await resp.json();
        if (data && data.ok) {
          localHostHealthCache = {
            canLaunchJava: Boolean(data.canLaunchJava),
            service: data.service || 'local'
          };
          return localHostHealthCache;
        }
      }
    } catch {
      // Ignore network errors
    }
    return { canLaunchJava: false, service: 'web' };
  }

  async function apiFetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Endpoint no JSON (${response.status})`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data && data.error) || `Error HTTP ${response.status}`);
    }
    return data;
  }

  function makeBuiltinSkinDataUrl(primary, secondary, accent) {
    try {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = secondary;
      ctx.fillRect(8, 8, 8, 8);
      ctx.fillRect(20, 20, 8, 12);
      ctx.fillStyle = accent;
      ctx.fillRect(9, 11, 2, 2);
      ctx.fillRect(13, 11, 2, 2);
      return c.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  // Estado activo de descargas e instalaciones
  let activeInstall = null;
  let activeInstallCancelled = false;
  let activeInstallationJob = null;
  let activeInstallationCancelled = false;
  let activeLoaderJob = null;
  let activeLoaderCancelled = false;

  const launchState = {
    status: 'idle',
    active: null,
    error: null,
    exitCode: null,
    signal: null,
    diagnostic: null,
    versionId: null,
    lines: []
  };

  function addLaunchLine(level, text) {
    const line = { level, text, at: new Date().toISOString() };
    launchState.lines.push(line);
    if (launchState.lines.length > 40) launchState.lines.shift();
    emit(listeners.launchConsole, line);
  }

  function runPhasedJob(options) {
    const { phases, onTick, isCancelled, onDone, onCancelled } = options;
    let step = 0;
    const advance = () => {
      if (isCancelled()) {
        onCancelled();
        return;
      }
      if (step >= phases.length) {
        onDone();
        return;
      }
      onTick(phases[step]);
      step += 1;
      window.setTimeout(advance, 190);
    };
    window.setTimeout(advance, 80);
  }

  function inferJavaMajorFromPath(pathText) {
    const m = String(pathText || '').match(/(?:jdk-|jre-?|java[-_]?|1\.)?(25|24|21|17|8)\b/i);
    return m ? Number(m[1]) : 25;
  }

  function defaultJavaInstallations() {
    const custom = store.config.launch.javaPath && store.config.launch.javaPath.trim();
    const list = [
      { major: 25, version: '25.0.1', path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-25.0.1\\bin\\java.exe', source: 'Auto-detectado' },
      { major: 21, version: '21.0.5', path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5\\bin\\java.exe', source: 'Auto-detectado' },
      { major: 17, version: '17.0.13', path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.13\\bin\\java.exe', source: 'Auto-detectado' },
      { major: 8, version: '1.8.0_432', path: 'C:\\Program Files\\Java\\jre1.8.0_432\\bin\\java.exe', source: 'Auto-detectado' }
    ];
    if (custom) {
      list.unshift({ major: inferJavaMajorFromPath(custom), version: 'Personalizado', path: custom, source: 'Configuración' });
    }
    return list;
  }

  function requiredJavaFor(versionId) {
    const id = String(versionId || '').trim();
    if (!id) return 21;
    const calver = id.match(/^(\d{2,})\.(\d+)(?:\.(\d+))?/);
    if (calver && Number(calver[1]) >= 26) return 25;
    const snap = id.match(/^(\d{2})w(\d{2})/);
    if (snap) {
      const yr = Number(snap[1]);
      const wk = Number(snap[2]);
      if (yr >= 26) return 25;
      if (yr > 24 || (yr === 24 && wk >= 14)) return 21;
      if (yr >= 21) return 17;
      return 8;
    }
    const m = id.match(/^1\.(\d+)(?:\.(\d+))?/);
    if (m) {
      const minor = Number(m[1]);
      const patch = Number(m[2] || 0);
      if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
      if (minor >= 17) return 17;
      return 8;
    }
    return 21;
  }

  function resolveJavaStatus(versionId) {
    const req = requiredJavaFor(versionId);
    const list = defaultJavaInstallations();
    const selected = list.find((j) => j.major === req) || list.find((j) => j.major >= req) || list[0];
    return {
      requiredMajor: req,
      installations: list,
      selected,
      error: null
    };
  }

  function activeSessionProfile() {
    if (store.config.session.mode === 'offline') {
      return store.locals.find((p) => p.id === store.config.session.localId) || null;
    }
    return null;
  }

  function readSkinFromPicker(model) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.png,image/png';
      input.style.display = 'none';
      document.body.appendChild(input);

      let settled = false;
      const cleanup = () => {
        window.removeEventListener('focus', onFocus);
        input.remove();
      };

      const onFocus = () => {
        window.setTimeout(() => {
          if (!settled && (!input.files || input.files.length === 0)) {
            settled = true;
            cleanup();
            resolve({ cancelled: true });
          }
        }, 400);
      };

      window.addEventListener('focus', onFocus, { once: true });

      input.addEventListener('change', async () => {
        if (settled) return;
        settled = true;
        try {
          const file = input.files && input.files[0];
          cleanup();
          if (!file) {
            resolve({ cancelled: true });
            return;
          }
          if (file.size > 2 * 1024 * 1024) {
            throw new Error('La skin supera el límite de 2 MB.');
          }
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
          for (let i = 0; i < pngSig.length; i++) {
            if (bytes[i] !== pngSig[i]) {
              throw new Error('El archivo no es un PNG válido.');
            }
          }
          if (bytes.length < 24) {
            throw new Error('Cabecera PNG incompleta.');
          }
          const view = new DataView(buffer);
          const width = view.getUint32(16, false);
          const height = view.getUint32(20, false);
          if (!(width === 64 && (height === 64 || height === 32))) {
            throw new Error(`Dimensiones no válidas (${width}×${height}). Se requiere 64×64 o 64×32.`);
          }
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const dataUrl = `data:image/png;base64,${window.btoa(bin)}`;
          const skin = {
            id: randomId('skin'),
            name: file.name.replace(/\.png$/i, '').slice(0, 40) || 'Skin local',
            model: model === 'slim' ? 'slim' : 'classic',
            width,
            height,
            size: bytes.length,
            source: 'local',
            dataUrl
          };
          store.skinsLocal.unshift(skin);
          store.config.skins.activeId = skin.id;
          saveStore();
          resolve({ cancelled: false, skin: { ...skin, active: true } });
        } catch (err) {
          reject(err instanceof Error ? err : new Error('No se pudo importar la skin.'));
        }
      });

      input.click();
    });
  }

  let defaultSkinsCache = null;

  async function listAllSkins() {
    if (!defaultSkinsCache) {
      try {
        const res = await apiFetchJson('/api/pan/default-skins');
        defaultSkinsCache = Array.isArray(res.items) ? res.items : [];
      } catch {
        defaultSkinsCache = [
          {
            id: 'official:steve',
            name: 'Steve Clásico',
            model: 'classic',
            width: 64,
            height: 64,
            source: 'official',
            dataUrl: makeBuiltinSkinDataUrl('#2d7d9a', '#c9936d', '#3e2d8f')
          },
          {
            id: 'official:alex',
            name: 'Alex Slim',
            model: 'slim',
            width: 64,
            height: 64,
            source: 'official',
            dataUrl: makeBuiltinSkinDataUrl('#4b7f36', '#e0b08a', '#2c6b31')
          }
        ];
      }
    }
    const merged = [...defaultSkinsCache, ...store.skinsLocal];
    if (!store.config.skins.activeId && merged.length) {
      store.config.skins.activeId = merged[0].id;
      saveStore();
    }
    return merged.map((skin) => {
      const override = store.skinOverrides[skin.id] || {};
      const model = override.model || skin.model;
      return {
        ...skin,
        model,
        active: skin.id === store.config.skins.activeId
      };
    });
  }

  const microsoftDesktopError = () =>
    new Error(tr('bridge.msDesktopOnly', null, 'El inicio de sesión OAuth de Microsoft requiere la aplicación de escritorio. Para probar aquí, cambia a Modo Offline en Jugadores.'));

  window.nexus = Object.freeze({
    info: Object.freeze({
      get: async () => ({
        name: 'Pan Launcher',
        appId: 'com.panlauncher.app',
        version: '0.1.0',
        platform: navigator.platform || 'web',
        electron: 'web',
        node: 'web',
        performance: computePerformanceOverview()
      })
    }),
    logo: Object.freeze({
      get: async () => ({
        path: 'assets/pan-logo.png',
        available: true,
        width: 512,
        height: 512,
        dataUrl: '/assets/pan-logo.png'
      })
    }),
    config: Object.freeze({
      get: async () => clone(store.config),
      update: async (patch) => {
        store.config = mergeConfig(store.config, patch);
        saveStore();
        return clone(store.config);
      },
      reset: async () => {
        store.config = clone(DEFAULT_CONFIG);
        saveStore();
        return clone(store.config);
      }
    }),
    versions: Object.freeze({
      list: async (options) => {
        const force = Boolean(options && options.force);
        try {
          return await apiFetchJson(`/api/pan/versions${force ? '?force=true' : ''}`);
        } catch {
          try {
            const mc = await apiFetchJson('/api/mc/versions');
            if (mc && Array.isArray(mc.versions) && mc.versions.length) {
              return { items: mc.versions, stale: false, source: 'local-host' };
            }
          } catch {
            // Fall through to Mojang direct
          }
          try {
            const resp = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            if (resp.ok) {
              const m = await resp.json();
              return { items: Array.isArray(m.versions) ? m.versions : FALLBACK_MC_VERSIONS, stale: false, source: 'mojang' };
            }
          } catch {
            // Fall through to curated list
          }
          return { items: FALLBACK_MC_VERSIONS, stale: true, warning: 'Catálogo local sin conexión.', source: 'cache' };
        }
      }
    }),
    catalogs: Object.freeze({
      get: async (kind, gameVersion, options) => {
        const force = Boolean(options && options.force);
        const gv = gameVersion || '1.21.4';
        try {
          return await apiFetchJson(
            `/api/pan/catalog/${encodeURIComponent(kind)}/${encodeURIComponent(gv)}${force ? '?force=true' : ''}`
          );
        } catch {
          return { items: [], loader: kind, gameVersion: gv, stale: true, warning: '', source: 'cache' };
        }
      }
    }),
    install: Object.freeze({
      status: async () => ({
        active: activeInstall,
        installed: [...store.installed],
        lastResult: store.lastInstallResult
      }),
      start: async (versionId) => {
        if (activeInstall) throw new Error('Ya hay una instalación en curso.');
        activeInstallCancelled = false;
        activeInstall = { versionId, phase: 'metadata', percent: 0 };
        runPhasedJob({
          isCancelled: () => activeInstallCancelled,
          phases: [
            {
              versionId,
              phase: 'metadata',
              phaseLabel: 'Descargando metadatos oficiales',
              file: `${versionId}.json`,
              downloaded: 12000,
              total: 14000000,
              percent: 15,
              speed: 3500000,
              eta: 2,
              filesDone: 1,
              filesTotal: 42,
              message: `Verificando SHA1 de ${versionId}.json…`
            },
            {
              versionId,
              phase: 'libraries',
              phaseLabel: 'Descargando librerías y cliente',
              file: `${versionId}.jar`,
              downloaded: 8200000,
              total: 14000000,
              percent: 58,
              speed: 6200000,
              eta: 1,
              filesDone: 24,
              filesTotal: 42,
              message: `Verificando librerías oficiales de ${versionId}…`
            },
            {
              versionId,
              phase: 'assets',
              phaseLabel: 'Verificando recursos',
              file: 'indexes/asset-index.json',
              downloaded: 13200000,
              total: 14000000,
              percent: 92,
              speed: 7100000,
              eta: 1,
              filesDone: 39,
              filesTotal: 42,
              message: 'Validando hashes SHA1…'
            }
          ],
          onTick: (p) => {
            activeInstall = { versionId, phase: p.phase, percent: p.percent };
            emit(listeners.installProgress, p);
          },
          onCancelled: () => {
            activeInstall = null;
            store.lastInstallResult = { versionId, ok: false, cancelled: true };
            saveStore();
            emit(listeners.installProgress, {
              versionId,
              phase: 'cancelled',
              phaseLabel: 'Instalación cancelada',
              file: '',
              downloaded: 0,
              total: 0,
              percent: 0,
              speed: 0,
              eta: 0,
              filesDone: 0,
              filesTotal: 0,
              message: 'Instalación cancelada por el usuario.'
            });
          },
          onDone: () => {
            activeInstall = null;
            if (!store.installed.includes(versionId)) store.installed.push(versionId);
            store.lastInstallResult = { versionId, ok: true, fileCount: 42 };
            saveStore();
            emit(listeners.installProgress, {
              versionId,
              phase: 'done',
              phaseLabel: 'Instalación completada',
              file: '',
              downloaded: 14000000,
              total: 14000000,
              percent: 100,
              speed: 0,
              eta: 0,
              filesDone: 42,
              filesTotal: 42,
              message: 'Versión instalada y verificada.'
            });
          }
        });
        return { versionId, started: true };
      },
      cancel: async () => {
        if (!activeInstall) return { ok: false };
        activeInstallCancelled = true;
        return { ok: true };
      },
      onProgress: (listener) => subscribe(listeners.installProgress, listener)
    }),
    installations: Object.freeze({
      list: async () => clone(store.installations),
      get: async (id) => clone(store.installations.find((item) => item.id === id) || null),
      create: async (request) => {
        const name = String((request && request.name) || '').trim();
        const gameVersion = String((request && request.gameVersion) || '').trim();
        const loader = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(request && request.loader)
          ? request.loader
          : 'vanilla';
        const loaderVersion = loader === 'vanilla' ? null : String((request && request.loaderVersion) || '');
        if (!name || name.length > 40) throw new Error('Nombre de instalación no válido.');
        if (!gameVersion) throw new Error('Selecciona una versión de Minecraft.');
        if (loader !== 'vanilla' && !loaderVersion) throw new Error('Selecciona una versión del cargador.');

        const id = randomId('inst');
        const versionId = loader === 'vanilla'
          ? gameVersion
          : `${loader}-${loaderVersion}-${gameVersion}`;
        const now = new Date().toISOString();
        const installation = {
          id,
          name,
          gameVersion,
          loader,
          loaderVersion,
          versionId,
          clientToken: randomId('client'),
          javaPath: String((request && request.javaPath) || '').trim(),
          ramMb: Number(request && request.ramMb) || 4096,
          minRamMb: Number(request && request.minRamMb) || 512,
          gameDir: `userData/installations/${id}/.minecraft`,
          installationDir: `userData/installations/${id}`,
          installStatus: 'pending',
          installError: null,
          createdAt: now,
          updatedAt: now,
          installedAt: null
        };
        store.installations.unshift(installation);
        saveStore();
        return clone(installation);
      },
      update: async (id, patch) => {
        const idx = store.installations.findIndex((item) => item.id === id);
        if (idx < 0) throw new Error('Instalación no encontrada.');
        const cur = store.installations[idx];
        const nextName = patch && patch.name !== undefined ? String(patch.name).trim() : cur.name;
        if (!nextName || nextName.length > 40) throw new Error('El nombre debe tener entre 1 y 40 caracteres.');
        const ramMb = patch && patch.ramMb !== undefined ? Number(patch.ramMb) : cur.ramMb;
        const minRamMb = patch && patch.minRamMb !== undefined ? Number(patch.minRamMb) : cur.minRamMb;
        if (!Number.isInteger(ramMb) || ramMb < 1024 || ramMb > 16384) {
          throw new Error('La RAM máxima debe estar entre 1024 MB y 16384 MB.');
        }
        if (!Number.isInteger(minRamMb) || minRamMb < 256 || minRamMb >= ramMb) {
          throw new Error('La RAM inicial debe ser menor que la máxima y al menos 256 MB.');
        }
        store.installations[idx] = {
          ...cur,
          name: nextName,
          javaPath: patch && patch.javaPath !== undefined ? String(patch.javaPath).trim() : cur.javaPath,
          ramMb,
          minRamMb,
          updatedAt: new Date().toISOString()
        };
        saveStore();
        return clone(store.installations[idx]);
      },
      remove: async (id) => {
        store.installations = store.installations.filter((item) => item.id !== id);
        if (store.config.launch.activeInstallationId === id) {
          store.config.launch.activeInstallationId = null;
        }
        delete store.optionsPresets[id];
        saveStore();
        return { ok: true };
      },
      select: async (id) => {
        const inst = store.installations.find((item) => item.id === id);
        if (!inst) throw new Error('Instalación no encontrada.');
        store.config.launch.activeInstallationId = inst.id;
        store.config.launch.versionId = inst.versionId;
        saveStore();
        return clone(store.config);
      },
      selectLegacy: async () => {
        store.config.launch.activeInstallationId = null;
        saveStore();
        return clone(store.config);
      },
      javaOptions: async () => ({
        installations: defaultJavaInstallations()
      }),
      status: async () => ({
        active: activeInstallationJob,
        lastResult: store.lastInstallationResult,
        installations: clone(store.installations)
      }),
      start: async (id) => {
        const inst = store.installations.find((item) => item.id === id);
        if (!inst) throw new Error('Instalación no encontrada.');
        if (activeInstallationJob) throw new Error('Ya hay una instalación en curso.');
        activeInstallationCancelled = false;
        inst.installStatus = 'installing';
        inst.installError = null;
        saveStore();
        activeInstallationJob = {
          installationId: inst.id,
          versionId: inst.versionId,
          phase: 'metadata'
        };
        runPhasedJob({
          isCancelled: () => activeInstallationCancelled,
          phases: [
            {
              installationId: inst.id,
              versionId: inst.versionId,
              phase: 'metadata',
              phaseLabel: `Resolviendo ${inst.gameVersion} (${inst.loader})`,
              percent: 22,
              filesDone: 4,
              filesTotal: 28,
              message: `Descargando manifiestos de ${inst.gameVersion}…`
            },
            {
              installationId: inst.id,
              versionId: inst.versionId,
              phase: 'libraries',
              phaseLabel: 'Instalando dependencias y librerías',
              percent: 68,
              filesDone: 19,
              filesTotal: 28,
              message: `Verificando artefactos para ${inst.name}…`
            },
            {
              installationId: inst.id,
              versionId: inst.versionId,
              phase: 'assets',
              phaseLabel: 'Finalizando directorio aislado',
              percent: 94,
              filesDone: 27,
              filesTotal: 28,
              message: `Preparando ${inst.gameDir}…`
            }
          ],
          onTick: (p) => {
            activeInstallationJob = {
              installationId: inst.id,
              versionId: inst.versionId,
              phase: p.phase
            };
            emit(listeners.installationProgress, p);
          },
          onCancelled: () => {
            activeInstallationJob = null;
            inst.installStatus = 'pending';
            store.lastInstallationResult = {
              installationId: inst.id,
              versionId: inst.versionId,
              ok: false,
              cancelled: true
            };
            saveStore();
            emit(listeners.installationProgress, {
              installationId: inst.id,
              versionId: inst.versionId,
              phase: 'cancelled',
              phaseLabel: 'Instalación cancelada',
              percent: 0,
              filesDone: 0,
              filesTotal: 0,
              message: 'Instalación cancelada.'
            });
          },
          onDone: () => {
            activeInstallationJob = null;
            inst.installStatus = 'ready';
            inst.installedAt = new Date().toISOString();
            if (!store.installed.includes(inst.gameVersion)) {
              store.installed.push(inst.gameVersion);
            }
            store.config.launch.activeInstallationId = inst.id;
            store.lastInstallationResult = {
              installationId: inst.id,
              versionId: inst.versionId,
              ok: true
            };
            saveStore();
            emit(listeners.installationProgress, {
              installationId: inst.id,
              versionId: inst.versionId,
              phase: 'done',
              phaseLabel: 'Instalación completada',
              percent: 100,
              filesDone: 28,
              filesTotal: 28,
              message: 'Instalación lista y verificada.'
            });
          }
        });
        return { installationId: inst.id, versionId: inst.versionId, started: true };
      },
      cancel: async () => {
        if (!activeInstallationJob) return { ok: false };
        activeInstallationCancelled = true;
        return { ok: true };
      },
      onProgress: (listener) => subscribe(listeners.installationProgress, listener)
    }),
    options: Object.freeze({
      presetStatus: async (installationId) => presetStatusFor(installationId),
      presetApply: async (installationId) => {
        const inst = store.installations.find((item) => item.id === installationId);
        if (!inst) throw new Error('Instalación no encontrada.');
        store.optionsPresets[installationId] = { applied: true, restorable: true };
        saveStore();
        return {
          message: `Perfil gráfico ligero aplicado en "${inst.name}" (options.txt).`,
          status: presetStatusFor(installationId)
        };
      },
      presetRestore: async (installationId) => {
        const inst = store.installations.find((item) => item.id === installationId);
        if (!inst) throw new Error('Instalación no encontrada.');
        store.optionsPresets[installationId] = { applied: false, restorable: false };
        saveStore();
        return {
          message: `Opciones restauradas desde la copia de seguridad de "${inst.name}".`,
          status: presetStatusFor(installationId)
        };
      }
    }),
    folders: Object.freeze({
      list: async (installationId) => {
        const inst = store.installations.find((item) => item.id === installationId);
        if (!inst) return [];
        const base = inst.gameDir || `userData/installations/${inst.id}/.minecraft`;
        const isReady = inst.installStatus === 'ready';
        return [
          { key: 'root', label: 'Directorio raíz (.minecraft)', path: base, exists: true, isDirectory: true, description: 'Carpeta aislada del perfil.' },
          { key: 'mods', label: 'Mods', path: `${base}/mods`, exists: isReady, isDirectory: isReady, description: 'Mods (.jar) del perfil.' },
          { key: 'resourcepacks', label: 'Paquetes de recursos', path: `${base}/resourcepacks`, exists: isReady, isDirectory: isReady, description: 'Texturas y audio.' },
          { key: 'shaderpacks', label: 'Shaders', path: `${base}/shaderpacks`, exists: false, isDirectory: false, reason: 'Todavía no creada por el juego.' },
          { key: 'saves', label: 'Mundos (saves)', path: `${base}/saves`, exists: false, isDirectory: false, reason: 'Se crea al abrir un mundo.' },
          { key: 'config', label: 'Configuración (config)', path: `${base}/config`, exists: isReady, isDirectory: isReady, description: 'Ajustes de mods.' },
          { key: 'logs', label: 'Registros (logs)', path: `${base}/logs`, exists: isReady, isDirectory: isReady, description: 'latest.log del último inicio.' },
          { key: 'screenshots', label: 'Capturas', path: `${base}/screenshots`, exists: false, isDirectory: false, reason: 'Se crea con la primera captura (F2).' }
        ];
      },
      open: async () => ({
        ok: false,
        error: 'Desde la vista previa web no es posible abrir el explorador local de carpetas; usa «Copiar ruta».'
      }),
      copy: async (installationId, key) => {
        const list = await window.nexus.folders.list(installationId);
        const found = list.find((item) => item.key === key);
        if (!found) throw new Error('Carpeta no encontrada.');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(found.path).catch(() => {});
        }
        return { ok: true, path: found.path };
      }
    }),
    skins: Object.freeze({
      list: listAllSkins,
      pickImport: (model) => readSkinFromPicker(model),
      setModel: async (id, model) => {
        const nextModel = model === 'slim' ? 'slim' : 'classic';
        const localIdx = store.skinsLocal.findIndex((s) => s.id === id);
        if (localIdx >= 0) {
          store.skinsLocal[localIdx].model = nextModel;
        } else {
          store.skinOverrides[id] = { ...(store.skinOverrides[id] || {}), model: nextModel };
        }
        saveStore();
        return { ok: true };
      },
      select: async (id) => {
        store.config.skins.activeId = id;
        saveStore();
        return { ok: true };
      },
      remove: async (id) => {
        if (String(id).startsWith('official:')) {
          throw new Error('Las skins oficiales integradas no se pueden eliminar.');
        }
        store.skinsLocal = store.skinsLocal.filter((s) => s.id !== id);
        if (store.config.skins.activeId === id) {
          store.config.skins.activeId = 'official:steve';
        }
        saveStore();
        return { ok: true };
      }
    }),
    auth: Object.freeze({
      status: async () => ({
        profile: null,
        canRestore: false,
        encryptionAvailable: true,
        storageBackend: 'web-local',
        redirectUri: `${window.location.origin}/callback`
      }),
      signIn: async () => {
        throw microsoftDesktopError();
      },
      restore: async () => {
        throw microsoftDesktopError();
      },
      signOut: async () => ({ ok: true })
    }),
    session: Object.freeze({
      status: async () => ({
        mode: store.config.session.mode,
        profile: activeSessionProfile(),
        locals: clone(store.locals),
        activeLocalId: store.config.session.localId,
        onlineAvailable: false
      }),
      setMode: async (mode) => {
        if (mode !== 'online' && mode !== 'offline') throw new Error('Modo no válido.');
        store.config.session.mode = mode;
        if (mode === 'offline' && !store.config.session.localId && store.locals.length) {
          store.config.session.localId = store.locals[0].id;
        }
        saveStore();
        return { ok: true, mode };
      }
    }),
    players: Object.freeze({
      create: async (name) => {
        const clean = String(name || '').trim();
        if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) {
          throw new Error('El nombre debe tener entre 1 y 16 letras, números o guion bajo.');
        }
        if (store.locals.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
          throw new Error(`Ya existe un perfil llamado "${clean}".`);
        }
        const player = { id: deterministicUuid(clean), name: clean, createdAt: new Date().toISOString() };
        store.locals.push(player);
        store.config.session.localId = player.id;
        saveStore();
        return clone(player);
      },
      update: async (id, name) => {
        const clean = String(name || '').trim();
        if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) {
          throw new Error('Nombre no válido.');
        }
        const target = store.locals.find((p) => p.id === id);
        if (!target) throw new Error('Perfil no encontrado.');
        target.name = clean;
        saveStore();
        return clone(target);
      },
      remove: async (id) => {
        store.locals = store.locals.filter((p) => p.id !== id);
        if (store.config.session.localId === id) {
          store.config.session.localId = store.locals[0] ? store.locals[0].id : null;
        }
        saveStore();
        return { ok: true };
      },
      select: async (id) => {
        if (!store.locals.some((p) => p.id === id)) throw new Error('Perfil no encontrado.');
        store.config.session.localId = id;
        saveStore();
        return { ok: true };
      }
    }),
    loaders: Object.freeze({
      status: async () => ({
        active: activeLoaderJob,
        installed: clone(store.loadersInstalled),
        lastResult: store.lastLoaderResult
      }),
      versions: async (loader, gameVersion, options) => {
        const force = Boolean(options && options.force);
        try {
          return await apiFetchJson(
            `/api/pan/loaders/${encodeURIComponent(loader)}/${encodeURIComponent(gameVersion)}${force ? '?force=true' : ''}`
          );
        } catch {
          if (loader === 'fabric') {
            try {
              const resp = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`);
              if (resp.ok) {
                const list = await resp.json();
                return {
                  items: (Array.isArray(list) ? list : []).map((row) => ({
                    id: row.loader && row.loader.version,
                    stable: Boolean(row.loader && row.loader.stable)
                  })).filter((x) => x.id),
                  loader,
                  gameVersion,
                  stale: false,
                  source: 'fabric-meta'
                };
              }
            } catch {
              // ignore
            }
          } else if (loader === 'quilt') {
            try {
              const resp = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(gameVersion)}`);
              if (resp.ok) {
                const list = await resp.json();
                return {
                  items: (Array.isArray(list) ? list : []).map((row) => ({
                    id: row.loader && row.loader.version,
                    label: row.loader && row.loader.version,
                    stable: Boolean(row.loader && row.loader.version && !/-(beta|alpha)/i.test(row.loader.version))
                  })).filter((x) => x.id),
                  loader,
                  gameVersion,
                  stale: false,
                  source: 'quilt-meta'
                };
              }
            } catch {
              // ignore
            }
          }
          return { items: [], loader, gameVersion, stale: true, source: 'cache' };
        }
      },
      install: async (request) => {
        const loader = String((request && request.loader) || '');
        const gameVersion = String((request && request.gameVersion) || '');
        const loaderVersion = String((request && request.loaderVersion) || '');
        if (!loader || !gameVersion || !loaderVersion) {
          throw new Error('Faltan parámetros del cargador.');
        }
        if (activeLoaderJob) throw new Error('Ya hay una instalación de loader en curso.');
        const profileId = `${loader}-${loaderVersion}-${gameVersion}`;
        activeLoaderCancelled = false;
        activeLoaderJob = { versionId: profileId, phase: 'metadata' };
        runPhasedJob({
          isCancelled: () => activeLoaderCancelled,
          phases: [
            {
              versionId: profileId,
              phase: 'metadata',
              phaseLabel: `Consultando ${loader}`,
              file: `${profileId}.json`,
              downloaded: 250000,
              total: 4200000,
              percent: 25,
              filesDone: 2,
              filesTotal: 14,
              message: `Verificando metadatos de ${loader} ${loaderVersion}…`
            },
            {
              versionId: profileId,
              phase: 'libraries',
              phaseLabel: 'Descargando librerías del cargador',
              file: `${loader}-loader-${loaderVersion}.jar`,
              downloaded: 3100000,
              total: 4200000,
              percent: 76,
              filesDone: 10,
              filesTotal: 14,
              message: `Comprobando SHA1 de dependencias…`
            }
          ],
          onTick: (p) => {
            activeLoaderJob = { versionId: profileId, phase: p.phase };
            emit(listeners.loaderProgress, p);
          },
          onCancelled: () => {
            activeLoaderJob = null;
            store.lastLoaderResult = { versionId: profileId, ok: false, cancelled: true };
            saveStore();
            emit(listeners.loaderProgress, {
              versionId: profileId,
              phase: 'cancelled',
              phaseLabel: 'Instalación cancelada',
              file: '',
              downloaded: 0,
              total: 0,
              percent: 0,
              filesDone: 0,
              filesTotal: 0,
              message: 'Instalación cancelada.'
            });
          },
          onDone: () => {
            activeLoaderJob = null;
            if (!store.loadersInstalled.some((x) => x.id === profileId)) {
              store.loadersInstalled.unshift({ id: profileId, loader, gameVersion, loaderVersion });
            }
            if (!store.installed.includes(profileId)) store.installed.push(profileId);
            store.lastLoaderResult = { versionId: profileId, ok: true };
            saveStore();
            emit(listeners.loaderProgress, {
              versionId: profileId,
              phase: 'done',
              phaseLabel: 'Perfil instalado y verificado',
              file: '',
              downloaded: 4200000,
              total: 4200000,
              percent: 100,
              filesDone: 14,
              filesTotal: 14,
              message: 'Perfil listo para lanzar.'
            });
          }
        });
        return { versionId: profileId, started: true };
      },
      cancel: async () => {
        if (!activeLoaderJob) return { ok: false };
        activeLoaderCancelled = true;
        return { ok: true };
      },
      onProgress: (listener) => subscribe(listeners.loaderProgress, listener)
    }),
      launch: Object.freeze({
      preflight: async () => {
        const activeInst = store.installations.find((item) => item.id === store.config.launch.activeInstallationId) || null;
        const versionId = activeInst ? activeInst.versionId : store.config.launch.versionId;
        const installed = activeInst
          ? activeInst.installStatus === 'ready'
          : store.installed.includes(versionId);
        const profile = activeSessionProfile();
        const mode = store.config.session.mode;
        const authenticated = Boolean(profile);
        const reasons = [];

        if (!installed) {
          reasons.push({
            code: 'not-installed',
            message: activeInst
              ? tr('bridge.reqNotInstalledInst', { name: activeInst.name, status: activeInst.installStatus }, `La instalación "${activeInst.name}" aún no está instalada (estado: ${activeInst.installStatus}).`)
              : tr('bridge.reqNotInstalledVer', { ver: versionId }, `Instala la versión ${versionId} desde Versiones antes de jugar.`)
          });
        }
        if (!authenticated) {
          reasons.push({
            code: 'auth',
            message: mode === 'offline'
              ? tr('bridge.reqAuthOffline', null, 'Crea o selecciona un perfil local en Jugadores para poder iniciar.')
              : tr('bridge.reqAuthOnline', null, 'Inicia sesión con Microsoft en Cuentas o activa el Modo Offline en Jugadores.')
          });
        }
        const ramMb = activeInst ? activeInst.ramMb : store.config.launch.ramMb;
        const minRamMb = activeInst ? activeInst.minRamMb : store.config.launch.minRamMb;
        if (!(minRamMb > 0 && ramMb >= 1024 && minRamMb < ramMb)) {
          reasons.push({ code: 'ram', message: tr('bridge.reqRamInvalid', null, 'La memoria inicial debe ser menor que la RAM máxima configurada.') });
        }

        return {
          ready: reasons.length === 0,
          versionId,
          installationId: activeInst ? activeInst.id : null,
          installationName: activeInst ? activeInst.name : null,
          gameDir: activeInst ? activeInst.gameDir : '.minecraft',
          reasons,
          warnings: [],
          installed,
          authenticated,
          mode,
          profile
        };
      },
      java: async (versionId) => resolveJavaStatus(versionId || store.config.launch.versionId),
      start: async () => {
        const preflight = await window.nexus.launch.preflight();
        if (!preflight.ready) {
          throw new Error((preflight.reasons[0] && preflight.reasons[0].message) || tr('msg.reqsMissing', null, 'Faltan requisitos para iniciar.'));
        }

        const health = await checkLocalHostHealth();
        if (!health.canLaunchJava) {
          launchState.versionId = preflight.versionId;
          launchState.status = 'error';
          launchState.active = null;
          launchState.error = tr('bridge.webLaunchNeedsApp', null, 'Para abrir Minecraft Java real descarga e inicia Pan Launcher (.exe/.zip en Windows o .sh en Linux) desde Ajustes.');
          addLaunchLine('info', `[Pan] Preflight OK: ${preflight.versionId} (${preflight.mode === 'offline' ? 'Offline' : 'Online'} · ${preflight.profile.name})`);
          addLaunchLine('stderr', '[Pan] Web preview mode: download the desktop app in Settings to start local Java.');
          emit(listeners.launchStatus, clone(launchState));
          throw new Error(launchState.error);
        }

        const LOADER_CAPS = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
        const activeInst = store.installations.find((item) => item.id === store.config.launch.activeInstallationId) || null;
        let mcVersion = activeInst ? activeInst.gameVersion : (preflight.versionId || '1.21.4');
        let rawLoader = activeInst ? activeInst.loader : ((store.config.launch && store.config.launch.loader) || 'vanilla');
        let loaderVersion = activeInst ? (activeInst.loaderVersion || null) : ((store.config.launch && store.config.launch.loaderVersion) || null);
        if (!activeInst && typeof mcVersion === 'string') {
          const profMatch = mcVersion.match(/^(fabric|forge|neoforge|quilt)-(.+)-([^-]+)$/i);
          if (profMatch) {
            rawLoader = profMatch[1].toLowerCase();
            loaderVersion = profMatch[2];
            mcVersion = profMatch[3];
          }
        }
        const loader = LOADER_CAPS[String(rawLoader || 'vanilla').toLowerCase()] || 'Vanilla';
        const ramMb = activeInst ? activeInst.ramMb : (store.config.launch.ramMb || 4096);
        const perfEval = window.Nexus && window.Nexus.perfEngine
          ? window.Nexus.perfEngine.evaluateFromConfig(store.config)
          : null;
        const perfCfg = store.config.performance || {};
        const enabledModIds = loader === 'Vanilla'
          ? []
          : (perfEval
              ? perfEval.mods.filter((m) => m.enabled && m.id !== 'optifine').map((m) => m.id)
              : (Array.isArray(perfCfg.modIds) ? perfCfg.modIds : []));

        const closeBehavior = (store.config.general && store.config.general.closeBehavior) || 'quit';
        const customModFiles = loader === 'Vanilla'
          ? []
          : (store.customMods || [])
              .filter((m) => m && m.enabled && m.filename)
              .map((m) => String(m.filename));
        const enabledResourcePacks = (store.resourcePacks || [])
          .filter((p) => p && p.enabled && p.filename)
          .map((p) => String(p.filename));
        const rpackInspector = window.Nexus && window.Nexus.resourcePackInspector;
        const baseOptionsTxt = perfEval ? perfEval.optionsTxt : '';
        const mergedOptionsTxt = rpackInspector && typeof rpackInspector.applyResourcePacksToOptionsTxt === 'function'
          ? rpackInspector.applyResourcePacksToOptionsTxt(baseOptionsTxt, enabledResourcePacks, mcVersion)
          : baseOptionsTxt;

        const payload = {
          profileId: (activeInst && activeInst.id) || (perfEval && perfEval.presetId) || 'default',
          profileName: (activeInst && activeInst.name) || (perfEval && perfEval.presetName) || 'Pan Launcher',
          mcVersion,
          loader,
          loaderVersion,
          closeBehavior,
          ramGb: Math.max(1, Number((ramMb / 1024).toFixed(2))),
          gc: (perfEval && perfEval.jvm && perfEval.jvm.gc) || perfCfg.gc || 'ZGC',
          alwaysPreTouch: perfCfg.alwaysPreTouch !== undefined ? Boolean(perfCfg.alwaysPreTouch) : false,
          stringDeduplication: Boolean(perfCfg.stringDeduplication),
          parallelThreads: Number(perfCfg.parallelThreads) || 4,
          customJavaPath: (activeInst && activeInst.javaPath) || store.config.launch.javaPath || '',
          username: preflight.profile.name,
          uuid: preflight.profile.id,
          accountType: preflight.mode === 'offline' ? 'offline' : 'msa',
          enabledModIds,
          customModFiles,
          enabledResourcePacks,
          optionsTxt: mergedOptionsTxt
        };

        const launchResp = await fetch('/api/local/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const launchResData = await launchResp.json().catch(() => ({}));
        if (!launchResp.ok || !launchResData.ok) {
          throw new Error(launchResData.error || 'El motor local rechazó el inicio de Minecraft.');
        }

        const reqJavaMajor = requiredJavaFor(mcVersion);
        launchState.versionId = preflight.versionId;
        launchState.status = 'preparing';
        launchState.error = null;
        launchState.active = {
          versionId: preflight.versionId,
          mode: preflight.mode,
          ramMb,
          javaMajor: reqJavaMajor,
          pid: null
        };
        emit(listeners.launchStatus, clone(launchState));

        let hideTriggered = false;
        const pollTimer = window.setInterval(async () => {
          try {
            const stResp = await fetch('/api/local/status', { cache: 'no-store' });
            if (!stResp.ok) return;
            const st = await stResp.json();
            if (Array.isArray(st.logs)) {
              launchState.lines = st.logs.slice(-40).map((text) => ({ level: 'info', text, at: new Date().toISOString() }));
            }
            if (st.state === 'error') {
              window.clearInterval(pollTimer);
              launchState.status = 'error';
              launchState.active = null;
              launchState.error = st.error || st.step || 'Error al iniciar Minecraft Java.';
              emit(listeners.launchStatus, clone(launchState));
              return;
            }
            if (st.state === 'finished') {
              window.clearInterval(pollTimer);
              launchState.status = 'idle';
              launchState.active = null;
              launchState.error = null;
              emit(listeners.launchStatus, clone(launchState));
              return;
            }
            if (st.state === 'running') {
              launchState.status = 'playing';
              launchState.active = {
                versionId: preflight.versionId,
                mode: preflight.mode,
                ramMb,
                javaMajor: reqJavaMajor,
                pid: st.pid || null
              };
              emit(listeners.launchStatus, clone(launchState));
              if (!hideTriggered && closeBehavior === 'quit') {
                hideTriggered = true;
                window.setTimeout(async () => {
                  window.clearInterval(pollTimer);
                  try {
                    await fetch('/api/local/hide-ui', { method: 'POST' });
                  } catch {
                    /* ignore */
                  }
                  try { window.close(); } catch { /* ignore */ }
                }, 900);
              }
              return;
            }
            launchState.status = st.state === 'launching' ? 'starting' : 'preparing';
            emit(listeners.launchStatus, clone(launchState));
          } catch {
            // Keep polling while local host runs
          }
        }, 750);

        return clone(launchState);
      },
      stop: async () => {
        try {
          await fetch('/api/local/stop', { method: 'POST' });
        } catch {
          // Ignore network stop errors in web preview
        }
        launchState.active = null;
        launchState.status = 'idle';
        emit(listeners.launchStatus, clone(launchState));
        return clone(launchState);
      },
      status: async () => clone(launchState),
      onStatus: (listener) => subscribe(listeners.launchStatus, listener),
      onConsole: (listener) => subscribe(listeners.launchConsole, listener),
      clearConsole: async () => {
        launchState.lines = [];
        emit(listeners.launchConsole, { cleared: true });
        return { ok: true };
      }
    }),
    performance: Object.freeze({
      evaluate: async (payload) => {
        try {
          const resp = await fetch('/api/pan/performance-eval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
          });
          const ct = resp.headers.get('content-type') || '';
          if (resp.ok && ct.includes('application/json')) {
            return resp.json();
          }
        } catch {
          // Local host fallback
        }
        if (window.Nexus && window.Nexus.perfEngine) {
          return window.Nexus.perfEngine.evaluateFromConfig(store.config);
        }
        throw new Error('Motor de rendimiento no disponible.');
      },
      exportMrpack: async (payload) => {
        const resp = await fetch('/api/mc/export-mrpack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {})
        });
        if (!resp.ok) {
          throw new Error(`No se pudo generar el modpack .mrpack (HTTP ${resp.status}).`);
        }
        return resp.blob();
      }
    }),
    mods: Object.freeze({
      list: async () => {
        const health = await checkLocalHostHealth();
        if (health.canLaunchJava) {
          try {
            const resp = await apiFetchJson('/api/local/mods');
            const diskFiles = Array.isArray(resp.files) ? resp.files : [];
            const diskMap = new Map(diskFiles.map((f) => [String(f.filename), Number(f.size) || 0]));
            let changed = false;

            const filtered = store.customMods.filter((m) => {
              const keep = diskMap.has(String(m.filename));
              if (!keep) changed = true;
              return keep;
            });
            store.customMods = filtered;

            const knownNames = new Set(store.customMods.map((m) => String(m.filename)));
            const inspector = window.Nexus && window.Nexus.modInspector;
            for (const f of diskFiles) {
              const fname = String(f.filename || '');
              if (!fname || knownNames.has(fname)) continue;
              let meta = {
                modId: fname.replace(/\.jar$/i, '').toLowerCase(),
                name: fname.replace(/\.jar$/i, ''),
                version: '—',
                description: '',
                loaders: [],
                mcVersionSpec: null,
                source: 'filename'
              };
              try {
                const fileResp = await fetch(`/api/local/mods/file?filename=${encodeURIComponent(fname)}`, { cache: 'no-store' });
                if (fileResp.ok && inspector) {
                  const buf = await fileResp.arrayBuffer();
                  meta = await inspector.inspectJarBuffer(buf, fname);
                }
              } catch {
                if (inspector) meta = inspector.extractModMetadataFromEntries({ filename: fname });
              }
              store.customMods.unshift({
                id: randomId('mod'),
                filename: fname,
                modId: meta.modId,
                name: meta.name,
                version: meta.version,
                description: meta.description,
                loaders: meta.loaders,
                mcVersionSpec: meta.mcVersionSpec,
                source: meta.source,
                size: Number(f.size) || 0,
                enabled: true,
                addedAt: new Date().toISOString()
              });
              changed = true;
            }
            if (changed) saveStore();
          } catch {
            // Keep locally known metadata if host query failed transiently
          }
        }
        return clone(store.customMods);
      },
      addFiles: async (fileList) => {
        const files = Array.from(fileList || []);
        const inspector = window.Nexus && window.Nexus.modInspector;
        const health = await checkLocalHostHealth();
        let added = 0;
        let skipped = 0;
        const errors = [];

        for (const file of files) {
          const rawName = String((file && file.name) || '');
          if (!rawName.toLowerCase().endsWith('.jar')) {
            skipped += 1;
            errors.push(`"${rawName || 'archivo'}" no es un archivo .jar válido.`);
            continue;
          }
          if (file.size > 64 * 1024 * 1024) {
            skipped += 1;
            errors.push(`"${rawName}" supera el límite de 64 MB.`);
            continue;
          }
          const filename = inspector ? inspector.sanitizeJarFilename(rawName) : rawName.replace(/[^A-Za-z0-9._+-]/g, '_');
          const buf = await file.arrayBuffer();
          const meta = inspector
            ? await inspector.inspectJarBuffer(buf, filename)
            : {
                modId: filename.replace(/\.jar$/i, '').toLowerCase(),
                name: filename.replace(/\.jar$/i, ''),
                version: '—',
                description: '',
                loaders: [],
                mcVersionSpec: null,
                source: 'filename'
              };

          let savedFilename = filename;
          if (health.canLaunchJava) {
            const upResp = await fetch(`/api/local/mods/upload?filename=${encodeURIComponent(filename)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: buf
            });
            const upJson = await upResp.json().catch(() => ({}));
            if (!upResp.ok || !upJson.ok) {
              throw new Error(upJson.error || `No se pudo guardar ${filename} en la carpeta local.`);
            }
            if (upJson.filename) savedFilename = String(upJson.filename);
          }

          const existingIdx = store.customMods.findIndex((m) => m.filename === savedFilename);
          const entry = {
            id: existingIdx >= 0 ? store.customMods[existingIdx].id : randomId('mod'),
            filename: savedFilename,
            modId: meta.modId,
            name: meta.name,
            version: meta.version,
            description: meta.description,
            loaders: meta.loaders,
            mcVersionSpec: meta.mcVersionSpec,
            source: meta.source,
            size: file.size || buf.byteLength,
            enabled: true,
            addedAt: new Date().toISOString()
          };
          if (existingIdx >= 0) {
            store.customMods.splice(existingIdx, 1);
          }
          store.customMods.unshift(entry);
          added += 1;
        }
        saveStore();
        return { added, skipped, errors, items: clone(store.customMods) };
      },
      toggle: async (id, enabled) => {
        const target = store.customMods.find((m) => m.id === id);
        if (!target) throw new Error('Mod no encontrado.');
        target.enabled = Boolean(enabled);
        saveStore();
        return clone(store.customMods);
      },
      remove: async (id) => {
        const idx = store.customMods.findIndex((m) => m.id === id);
        if (idx < 0) return clone(store.customMods);
        const [removed] = store.customMods.splice(idx, 1);
        saveStore();
        const health = await checkLocalHostHealth();
        if (health.canLaunchJava && removed && removed.filename) {
          try {
            await fetch('/api/local/mods/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: removed.filename })
            });
          } catch {
            // Ignore unlink error
          }
        }
        return clone(store.customMods);
      },
      disableIncompatible: async (mcVersion, loader) => {
        const inspector = window.Nexus && window.Nexus.modInspector;
        let disabledCount = 0;
        if (inspector) {
          for (const mod of store.customMods) {
            if (!mod || !mod.enabled) continue;
            const res = inspector.evaluateCustomModCompatibility(mod, mcVersion, loader);
            if (!res.compatible) {
              mod.enabled = false;
              disabledCount += 1;
            }
          }
          if (disabledCount > 0) saveStore();
        }
        return { disabledCount, items: clone(store.customMods) };
      },
      openFolder: async () => {
        const health = await checkLocalHostHealth();
        if (!health.canLaunchJava) {
          return {
            ok: false,
            error: tr('bridge.modsOpenWebErr', null, 'En la vista previa web no existe carpeta local; arrastra tus .jar directamente a esta pantalla.')
          };
        }
        const resp = await fetch('/api/local/mods/open-folder', { method: 'POST' });
        return resp.json().catch(() => ({ ok: true }));
      }
    }),
    resourcePacks: Object.freeze({
      list: async () => {
        const health = await checkLocalHostHealth();
        if (health.canLaunchJava) {
          try {
            const resp = await apiFetchJson('/api/local/resourcepacks');
            const diskFiles = Array.isArray(resp.files) ? resp.files : [];
            const diskMap = new Map(diskFiles.map((f) => [String(f.filename), Number(f.size) || 0]));
            let changed = false;

            const filtered = store.resourcePacks.filter((p) => {
              const keep = diskMap.has(String(p.filename));
              if (!keep) changed = true;
              return keep;
            });
            store.resourcePacks = filtered;

            const knownNames = new Set(store.resourcePacks.map((p) => String(p.filename)));
            const inspector = window.Nexus && window.Nexus.resourcePackInspector;
            for (const f of diskFiles) {
              const fname = String(f.filename || '');
              if (!fname || knownNames.has(fname)) continue;
              let meta = {
                name: fname.replace(/\.zip$/i, ''),
                description: '',
                packFormat: null,
                hasMcmeta: false,
                iconDataUrl: ''
              };
              try {
                const fileResp = await fetch(`/api/local/resourcepacks/file?filename=${encodeURIComponent(fname)}`, { cache: 'no-store' });
                if (fileResp.ok && inspector) {
                  const buf = await fileResp.arrayBuffer();
                  meta = await inspector.inspectResourcePackBuffer(buf, fname);
                }
              } catch {
                // fallback to filename metadata
              }
              store.resourcePacks.unshift({
                id: randomId('rpack'),
                filename: fname,
                name: meta.name || fname.replace(/\.zip$/i, ''),
                description: meta.description || '',
                packFormat: meta.packFormat !== undefined ? meta.packFormat : null,
                minFormat: meta.minFormat !== undefined ? meta.minFormat : (meta.packFormat !== undefined ? meta.packFormat : null),
                maxFormat: meta.maxFormat !== undefined ? meta.maxFormat : (meta.packFormat !== undefined ? meta.packFormat : null),
                mcVersionRangeLabel: meta.mcVersionRangeLabel || '—',
                hasMcmeta: Boolean(meta.hasMcmeta),
                iconDataUrl: meta.iconDataUrl || '',
                size: Number(f.size) || 0,
                enabled: true,
                addedAt: new Date().toISOString()
              });
              changed = true;
            }
            if (changed) saveStore();
          } catch {
            // Keep cached metadata if local host query failed transiently
          }
        }
        return clone(store.resourcePacks);
      },
      addFiles: async (fileList) => {
        const files = Array.from(fileList || []);
        const inspector = window.Nexus && window.Nexus.resourcePackInspector;
        const health = await checkLocalHostHealth();
        let added = 0;
        let skipped = 0;
        const errors = [];

        for (const file of files) {
          const rawName = String((file && file.name) || '');
          if (!rawName.toLowerCase().endsWith('.zip')) {
            skipped += 1;
            errors.push(tr('rpack.err.notZip', { name: rawName || 'file' }, `"${rawName || 'archivo'}" no es un archivo .zip válido.`));
            continue;
          }
          if (file.size > 64 * 1024 * 1024) {
            skipped += 1;
            errors.push(tr('rpack.err.tooLarge', { name: rawName }, `"${rawName}" supera el límite de 64 MB.`));
            continue;
          }
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
            skipped += 1;
            errors.push(tr('rpack.err.invalidZip', { name: rawName }, `"${rawName}" no tiene una cabecera ZIP válida.`));
            continue;
          }

          const filename = inspector ? inspector.sanitizeResourcePackFilename(rawName) : rawName.replace(/[^A-Za-z0-9._+-]/g, '_');
          const meta = inspector
            ? await inspector.inspectResourcePackBuffer(buf, filename)
            : { name: filename.replace(/\.zip$/i, ''), description: '', packFormat: null, minFormat: null, maxFormat: null, mcVersionRangeLabel: '—', hasMcmeta: false, iconDataUrl: '' };

          let savedFilename = filename;
          if (health.canLaunchJava) {
            const upResp = await fetch(`/api/local/resourcepacks/upload?filename=${encodeURIComponent(filename)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: buf
            });
            const upJson = await upResp.json().catch(() => ({}));
            if (!upResp.ok || !upJson.ok) {
              throw new Error(upJson.error || tr('rpack.err.saveFailed', { name: filename }, `No se pudo guardar ${filename} en la carpeta local.`));
            }
            if (upJson.filename) savedFilename = String(upJson.filename);
          }

          const existingIdx = store.resourcePacks.findIndex((p) => p.filename === savedFilename);
          const id = existingIdx >= 0 ? store.resourcePacks[existingIdx].id : randomId('rpack');
          await rpackStorePut(id, buf);

          const entry = {
            id,
            filename: savedFilename,
            name: meta.name || savedFilename.replace(/\.zip$/i, ''),
            description: meta.description || '',
            packFormat: meta.packFormat !== undefined ? meta.packFormat : null,
            minFormat: meta.minFormat !== undefined ? meta.minFormat : (meta.packFormat !== undefined ? meta.packFormat : null),
            maxFormat: meta.maxFormat !== undefined ? meta.maxFormat : (meta.packFormat !== undefined ? meta.packFormat : null),
            mcVersionRangeLabel: meta.mcVersionRangeLabel || '—',
            hasMcmeta: Boolean(meta.hasMcmeta),
            iconDataUrl: meta.iconDataUrl || '',
            size: file.size || buf.byteLength,
            enabled: true,
            addedAt: new Date().toISOString()
          };
          if (existingIdx >= 0) {
            store.resourcePacks.splice(existingIdx, 1);
          }
          store.resourcePacks.unshift(entry);
          added += 1;
        }
        saveStore();
        return { added, skipped, errors, items: clone(store.resourcePacks) };
      },
      toggle: async (id, enabled) => {
        const target = store.resourcePacks.find((p) => p.id === id);
        if (!target) throw new Error(tr('rpack.err.notFound', null, 'Resource pack no encontrado.'));
        target.enabled = Boolean(enabled);
        saveStore();
        return clone(store.resourcePacks);
      },
      remove: async (id) => {
        const idx = store.resourcePacks.findIndex((p) => p.id === id);
        if (idx < 0) return clone(store.resourcePacks);
        const [removed] = store.resourcePacks.splice(idx, 1);
        saveStore();
        await rpackStoreDelete(id);
        const health = await checkLocalHostHealth();
        if (health.canLaunchJava && removed && removed.filename) {
          try {
            await fetch('/api/local/resourcepacks/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: removed.filename })
            });
          } catch {
            // Ignore unlink error
          }
        }
        return clone(store.resourcePacks);
      },
      disableIncompatible: async (mcVersion) => {
        const inspector = window.Nexus && window.Nexus.resourcePackInspector;
        let disabledCount = 0;
        if (inspector) {
          for (const pack of store.resourcePacks) {
            if (!pack || !pack.enabled) continue;
            const res = inspector.evaluateResourcePackCompatibility(pack, mcVersion);
            if (!res.compatible) {
              pack.enabled = false;
              disabledCount += 1;
            }
          }
          if (disabledCount > 0) saveStore();
        }
        return { disabledCount, items: clone(store.resourcePacks) };
      },
      openFolder: async () => {
        const health = await checkLocalHostHealth();
        if (!health.canLaunchJava) {
          return {
            ok: false,
            error: tr('rpack.err.openFolderWeb', null, 'En la vista previa web no existe carpeta local; arrastra tus .zip directamente a esta pantalla.')
          };
        }
        const resp = await fetch('/api/local/resourcepacks/open-folder', { method: 'POST' });
        return resp.json().catch(() => ({ ok: true }));
      }
    })
  });

  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && window.Nexus && window.Nexus.utils && typeof window.Nexus.utils.hydrateIcons === 'function') {
      window.Nexus.utils.hydrateIcons(sidebar);
    }
  });
})();
