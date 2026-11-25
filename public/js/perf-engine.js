(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});

  const HARDWARE_BASELINE_FPS = Object.freeze({
    low: 42,
    mid: 102,
    high: 195
  });

  let cachedDeviceProbe = null;

  function detectDeviceHardware() {
    if (cachedDeviceProbe) return cachedDeviceProbe;

    const cores = Math.max(1, Number(navigator.hardwareConcurrency) || 4);
    const navMem = Number(navigator.deviceMemory) || null;
    const osInfo = Nexus.state && Nexus.state.performance ? Nexus.state.performance : null;
    const totalRamGb = osInfo && osInfo.totalRamMb
      ? Math.round((osInfo.totalRamMb / 1024) * 10) / 10
      : navMem;

    let gpuName = 'GPU no expuesta por navegador';
    let gpuVendor = '';
    let isSoftwareRenderer = false;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const rawRenderer = dbg
          ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER);
        const rawVendor = dbg
          ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR);
        if (rawRenderer) {
          gpuName = String(rawRenderer)
            .replace(/^ANGLE \((?:[^,]+,\s*)?/, '')
            .replace(/Direct3D.*$/, '')
            .replace(/\)$/, '')
            .trim();
        }
        if (rawVendor) gpuVendor = String(rawVendor);
      }
    } catch {
      // Ignora si WebGL está restringido
    }

    const gpuLower = `${gpuName} ${gpuVendor}`.toLowerCase();
    isSoftwareRenderer = /swiftshader|llvmpipe|software|microsoft basic render/.test(gpuLower);
    const isNvidia = /nvidia|geforce|rtx|gtx/.test(gpuLower);
    const isAppleSilicon = /apple m[1-9]|apple gpu/.test(gpuLower);

    const isHighGpu = /rtx\s*(30[789]0|40[6789]0|50[6789]0)|rx\s*(6[789]00|7[789]00|9070)|apple m[234]\s*(pro|max|ultra)|radeon pro/i.test(gpuLower);
    const isMidGpu = /rtx\s*(20\d0|30[56]0|4050)|gtx\s*(10[678]0|16[56]0)|rx\s*(5[789]0|5[567]00|6[56]00|7600)|arc\s*a[57]|apple m[1234]\b|iris xe/i.test(gpuLower);
    const isLowGpu = isSoftwareRenderer || /intel.*(hd|uhd|celeron|pentium)|mali|adreno|powervr|vega\s*[368]\b|geforce\s*(gt|mx|[6789]\d0m)/i.test(gpuLower);

    let score = 0;
    if (isHighGpu) score += 4;
    else if (isMidGpu) score += 2;
    else if (isLowGpu) score += 0;
    else score += 1;

    if (cores >= 12) score += 2;
    else if (cores >= 6) score += 1;

    if (totalRamGb !== null) {
      if (totalRamGb >= 16) score += 2;
      else if (totalRamGb >= 8) score += 1;
    }

    let detectedTier = 'mid';
    if (isLowGpu || (totalRamGb !== null && totalRamGb <= 4) || cores <= 2) {
      detectedTier = 'low';
    } else if (isHighGpu && cores >= 8 && (totalRamGb === null || totalRamGb >= 8)) {
      detectedTier = 'high';
    } else if (score >= 5) {
      detectedTier = 'high';
    } else if (score <= 1) {
      detectedTier = 'low';
    }

    const dpr = Number(window.devicePixelRatio) || 1;
    const widthPx = Math.round((window.screen && window.screen.width ? window.screen.width : 1920) * dpr);
    const heightPx = Math.round((window.screen && window.screen.height ? window.screen.height : 1080) * dpr);

    cachedDeviceProbe = {
      detectedTier,
      cores,
      ramGb: totalRamGb,
      ramCappedByBrowser: !osInfo && navMem === 8,
      gpuName,
      isNvidia,
      isAppleSilicon,
      isSoftwareRenderer,
      screenRes: `${widthPx}×${heightPx}`,
      pixelFactor: widthPx * heightPx > 3200000 ? 0.86 : widthPx * heightPx <= 1200000 ? 1.08 : 1.0
    };
    return cachedDeviceProbe;
  }

  const PERF_PRESETS = Object.freeze({
    pvp: Object.freeze({
      id: 'pvp',
      name: 'PvP Competitivo',
      badge: 'Recomendado PvP',
      description: 'Máxima respuesta en BedWars/Duels: 5 chunks, biome blend 0, entidades 60%, iluminación plana, Fullbright y ZGC.',
      video: Object.freeze({
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
        disableVisualEffects: false
      }),
      gc: 'ZGC',
      alwaysPreTouch: false,
      stringDeduplication: false,
      disableTelemetry: true,
      modIds: ['sodium', 'lithium', 'ferritecore', 'entityculling', 'modernfix', 'krypton']
    }),
    potato: Object.freeze({
      id: 'potato',
      name: 'Ultra FPS (Máximo Extremo)',
      badge: 'Sin límite · 0% efectos',
      description: 'Exprimido al 100%: 2 chunks, cero balanceo de mano, mipmap 0, sin blur/brillos/FOV, entidades al 50% y G1GC ligero.',
      video: Object.freeze({
        renderDistance: 2,
        simulationDistance: 5,
        maxFps: 260,
        graphicsMode: 'fast',
        smoothLighting: false,
        entityShadows: false,
        particles: 'minimal',
        clouds: 'off',
        vsync: false,
        biomeBlend: 0,
        entityDistanceScaling: 50,
        guiScale: 2,
        fullbright: true,
        rawMouseInput: true,
        lowFireOverlay: true,
        viewBobbing: false,
        mipmapZero: true,
        disableVisualEffects: true
      }),
      gc: 'G1GC',
      alwaysPreTouch: true,
      stringDeduplication: true,
      disableTelemetry: true,
      modIds: ['sodium', 'lithium', 'ferritecore', 'entityculling', 'modernfix', 'krypton']
    }),
    survival: Object.freeze({
      id: 'survival',
      name: 'Balanceado / Survival',
      badge: 'Fluido + Visual',
      description: 'Equilibrio entre estética y fluidez para mundos survival y SMP: 14 chunks, nubes rápidas y luz suave sin tirones.',
      video: Object.freeze({
        renderDistance: 14,
        simulationDistance: 10,
        maxFps: 260,
        graphicsMode: 'fancy',
        smoothLighting: true,
        entityShadows: false,
        particles: 'decreased',
        clouds: 'fast',
        vsync: false,
        biomeBlend: 3,
        entityDistanceScaling: 100,
        guiScale: 2,
        fullbright: false,
        rawMouseInput: true,
        lowFireOverlay: false,
        viewBobbing: true,
        mipmapZero: false,
        disableVisualEffects: false
      }),
      gc: 'ZGC',
      alwaysPreTouch: false,
      stringDeduplication: false,
      disableTelemetry: true,
      modIds: ['sodium', 'lithium', 'ferritecore', 'entityculling', 'modernfix', 'krypton']
    }),
    vanilla: Object.freeze({
      id: 'vanilla',
      name: 'Estándar / Vanilla Puro',
      badge: 'Sin mods FPS',
      description: 'Parámetros clásicos de Mojang sin mods de optimización ni ajustes agresivos.',
      video: Object.freeze({
        renderDistance: 12,
        simulationDistance: 8,
        maxFps: 120,
        graphicsMode: 'fancy',
        smoothLighting: true,
        entityShadows: true,
        particles: 'all',
        clouds: 'fancy',
        vsync: false,
        biomeBlend: 5,
        entityDistanceScaling: 100,
        guiScale: 2,
        fullbright: false,
        rawMouseInput: true,
        lowFireOverlay: false,
        viewBobbing: true,
        mipmapZero: false,
        disableVisualEffects: false
      }),
      gc: 'G1GC',
      alwaysPreTouch: false,
      stringDeduplication: true,
      disableTelemetry: false,
      modIds: []
    })
  });

  const PERF_MODS = Object.freeze([
    {
      id: 'sodium',
      name: 'Sodium',
      version: '0.6.5',
      category: 'render',
      fpsBoostPercent: 145,
      ramSavedMb: 190,
      conflictsWith: ['optifine', 'vulkanmod'],
      description: 'Motor OpenGL multi-draw moderno y mallado paralelo de chunks.',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'lithium',
      name: 'Lithium',
      version: '0.14.3',
      category: 'cpu',
      fpsBoostPercent: 34,
      ramSavedMb: 85,
      conflictsWith: [],
      description: 'Optimiza físicas de entidades, IA y ticks del juego sin alterar mecánicas.',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'immediatelyfast',
      name: 'ImmediatelyFast',
      version: '1.3.4',
      category: 'render',
      fpsBoostPercent: 28,
      ramSavedMb: 40,
      conflictsWith: ['optifine'],
      description: 'Acelera renderizado de HUD y texto en GPU (opcional; desactivado por defecto para evitar cierres al reaparecer).',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'ferritecore',
      name: 'FerriteCore',
      version: '7.0.2',
      category: 'memory',
      fpsBoostPercent: 12,
      ramSavedMb: 640,
      conflictsWith: [],
      description: 'Reduce hasta un 45% el uso de memoria RAM compactando estados de bloque.',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'entityculling',
      name: 'EntityCulling',
      version: '1.7.2',
      category: 'render',
      fpsBoostPercent: 30,
      ramSavedMb: 35,
      conflictsWith: [],
      description: 'No dibuja jugadores ni bloques ocultos tras paredes mediante trazado asíncrono.',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'modernfix',
      name: 'ModernFix',
      version: '5.19.5',
      category: 'memory',
      fpsBoostPercent: 16,
      ramSavedMb: 320,
      conflictsWith: [],
      description: 'Acelera el arranque del cliente y suaviza picos del recolector de basura.',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'moreculling',
      name: 'MoreCulling',
      version: '1.0.6',
      category: 'render',
      fpsBoostPercent: 20,
      ramSavedMb: 25,
      conflictsWith: [],
      description: 'Descarta caras ocultas en hojas, marcos e ítems (opcional; desactivado por defecto para evitar cierres con resource packs de servidor).',
      loaders: ['Fabric']
    },
    {
      id: 'krypton',
      name: 'Krypton',
      version: '0.2.8',
      category: 'network',
      fpsBoostPercent: 8,
      ramSavedMb: 55,
      conflictsWith: [],
      description: 'Optimiza la pila Netty nativa para reducir micro-tirones de red en PvP.',
      loaders: ['Fabric']
    },
    {
      id: 'c2me',
      name: 'C2ME',
      version: '0.3.0',
      category: 'cpu',
      fpsBoostPercent: 24,
      ramSavedMb: 40,
      conflictsWith: [],
      description: 'Carga de chunks multihilo en CPUs de 6+ núcleos.',
      loaders: ['Fabric', 'NeoForge']
    },
    {
      id: 'nvidium',
      name: 'Nvidium',
      version: '0.3.1',
      category: 'render',
      fpsBoostPercent: 68,
      ramSavedMb: 120,
      conflictsWith: ['vulkanmod', 'optifine'],
      description: 'Mesh Shaders exclusivo para GPUs NVIDIA GTX 16xx / RTX.',
      loaders: ['Fabric']
    },
    {
      id: 'vulkanmod',
      name: 'VulkanMod',
      version: '0.4.2',
      category: 'render',
      fpsBoostPercent: 155,
      ramSavedMb: 210,
      conflictsWith: ['sodium', 'nvidium', 'optifine'],
      description: 'Renderizado Vulkan de bajo nivel en lugar de OpenGL.',
      loaders: ['Fabric']
    },
    {
      id: 'optifine',
      name: 'OptiFine Legacy',
      version: 'HD_U_J2',
      category: 'render',
      fpsBoostPercent: 35,
      ramSavedMb: 20,
      conflictsWith: ['sodium', 'immediatelyfast', 'nvidium', 'vulkanmod'],
      description: 'Alternativa clásica solo para 1.8.9 / 1.12.2 (incompatible con Sodium).',
      loaders: ['Vanilla+']
    }
  ]);

  function normalizePerfState(config) {
    const perf = (config && config.performance) || {};
    const preset = PERF_PRESETS[perf.presetId] || PERF_PRESETS.pvp;
    const enabledIds = Array.isArray(perf.modIds) ? perf.modIds : preset.modIds;
    const ramMb = Number(config && config.launch && config.launch.ramMb) || 4096;
    const video = {
      ...preset.video,
      renderDistance: Number.isFinite(Number(perf.renderDistance)) ? Number(perf.renderDistance) : preset.video.renderDistance,
      simulationDistance: Number.isFinite(Number(perf.simulationDistance)) ? Number(perf.simulationDistance) : preset.video.simulationDistance,
      maxFps: Number.isFinite(Number(perf.maxFps)) ? Number(perf.maxFps) : preset.video.maxFps,
      graphicsMode: perf.graphicsMode || preset.video.graphicsMode,
      smoothLighting: typeof perf.smoothLighting === 'boolean' ? perf.smoothLighting : preset.video.smoothLighting,
      entityShadows: typeof perf.entityShadows === 'boolean' ? perf.entityShadows : preset.video.entityShadows,
      particles: perf.particles || preset.video.particles,
      clouds: perf.clouds || preset.video.clouds,
      vsync: typeof perf.vsync === 'boolean' ? perf.vsync : preset.video.vsync,
      biomeBlend: Number.isFinite(Number(perf.biomeBlend)) ? Number(perf.biomeBlend) : preset.video.biomeBlend,
      entityDistanceScaling: Number.isFinite(Number(perf.entityDistanceScaling)) ? Number(perf.entityDistanceScaling) : preset.video.entityDistanceScaling,
      guiScale: Number.isFinite(Number(perf.guiScale)) ? Number(perf.guiScale) : preset.video.guiScale,
      fullbright: typeof perf.fullbright === 'boolean' ? perf.fullbright : preset.video.fullbright,
      rawMouseInput: typeof perf.rawMouseInput === 'boolean' ? perf.rawMouseInput : preset.video.rawMouseInput,
      lowFireOverlay: typeof perf.lowFireOverlay === 'boolean' ? perf.lowFireOverlay : preset.video.lowFireOverlay,
      viewBobbing: typeof perf.viewBobbing === 'boolean' ? perf.viewBobbing : preset.video.viewBobbing !== false,
      mipmapZero: typeof perf.mipmapZero === 'boolean' ? perf.mipmapZero : Boolean(preset.video.mipmapZero),
      disableVisualEffects: typeof perf.disableVisualEffects === 'boolean' ? perf.disableVisualEffects : Boolean(preset.video.disableVisualEffects)
    };
    const jvm = {
      ramGb: Math.max(1, Math.round((ramMb / 1024) * 10) / 10),
      gc: perf.gc || preset.gc,
      alwaysPreTouch: typeof perf.alwaysPreTouch === 'boolean' ? perf.alwaysPreTouch : preset.alwaysPreTouch,
      stringDeduplication: typeof perf.stringDeduplication === 'boolean' ? perf.stringDeduplication : preset.stringDeduplication,
      parallelThreads: Number(perf.parallelThreads) || 4,
      customArgs: String(perf.customArgs || '')
    };
    const network = {
      disableTelemetry: typeof perf.disableTelemetry === 'boolean' ? perf.disableTelemetry : preset.disableTelemetry
    };
    const hardwareMode = perf.hardwareTier === 'low' || perf.hardwareTier === 'mid' || perf.hardwareTier === 'high'
      ? perf.hardwareTier
      : 'auto';
    const device = detectDeviceHardware();
    const hardwareTier = hardwareMode === 'auto' ? device.detectedTier : hardwareMode;
    const exportLoader = perf.exportLoader === 'NeoForge' ? 'NeoForge' : 'Fabric';
    const mods = PERF_MODS.map((m) => ({
      ...m,
      enabled: enabledIds.includes(m.id)
    }));
    return {
      presetId: preset.id,
      presetName: preset.name,
      hardwareMode,
      hardwareTier,
      exportLoader,
      device,
      video,
      jvm,
      network,
      mods,
      enabledIds
    };
  }

  function detectModConflicts(mods) {
    const enabled = mods.filter((m) => m.enabled);
    const byId = new Map(enabled.map((m) => [m.id, m]));
    const seen = new Set();
    const conflicts = [];
    for (const mod of enabled) {
      for (const targetId of mod.conflictsWith) {
        const other = byId.get(targetId);
        if (other) {
          const key = [mod.id, other.id].sort().join('::');
          if (!seen.has(key)) {
            seen.add(key);
            conflicts.push({
              modA: mod.id,
              modB: other.id,
              label: `${mod.name} es incompatible con ${other.name}`
            });
          }
        }
      }
    }
    return conflicts;
  }

  function estimatePerformance(mods, video, jvm, hardwareTier, pixelFactor) {
    const baseHardwareFps = HARDWARE_BASELINE_FPS[hardwareTier] || HARDWARE_BASELINE_FPS.mid;
    const resFactor = Number.isFinite(pixelFactor) ? pixelFactor : 1.0;
    const chunkFactor = Math.max(0.45, Math.min(2.1, 12 / Math.max(2, video.renderDistance)));
    const graphicsMultiplier = video.graphicsMode === 'fast' ? 1.14 : video.graphicsMode === 'fancy' ? 1.0 : 0.74;
    const smoothLightingMultiplier = video.smoothLighting ? 0.95 : 1.04;
    const shadowMultiplier = video.entityShadows ? 0.94 : 1.03;
    const particleMultiplier = video.particles === 'minimal' ? 1.06 : video.particles === 'decreased' ? 1.02 : 0.95;
    const cloudsMultiplier = video.clouds === 'off' ? 1.03 : video.clouds === 'fast' ? 1.0 : 0.94;
    const biomeMultiplier = video.biomeBlend <= 0 ? 1.05 : video.biomeBlend <= 1 ? 1.03 : Math.max(0.88, 1 - video.biomeBlend * 0.015);
    const entityDistMultiplier = Math.max(0.84, Math.min(1.16, 100 / Math.max(50, video.entityDistanceScaling)));
    const extraEffectsMultiplier = (video.mipmapZero ? 1.06 : 1.0)
      * (video.disableVisualEffects ? 1.05 : 1.0)
      * (video.viewBobbing === false ? 1.01 : 1.0);

    const rawVideoMultiplier = chunkFactor * graphicsMultiplier * smoothLightingMultiplier
      * shadowMultiplier * particleMultiplier * cloudsMultiplier * biomeMultiplier * entityDistMultiplier
      * extraEffectsMultiplier;
    const videoMultiplier = Math.pow(rawVideoMultiplier, 0.58) * resFactor;

    const vanillaFps = Math.max(
      18,
      Math.round(baseHardwareFps * resFactor * Math.min(1.15, Math.max(0.55, chunkFactor * (video.graphicsMode === 'fab' ? 0.75 : 1))))
    );

    const enabledMods = mods.filter((m) => m.enabled);
    const conflicts = detectModConflicts(mods);

    let rawModBoostSum = 0;
    let ramSavedMb = 0;
    for (const mod of enabledMods) {
      rawModBoostSum += mod.fpsBoostPercent / 100;
      ramSavedMb += mod.ramSavedMb;
    }
    const modMultiplier = 1 + rawModBoostSum / (1 + rawModBoostSum * 0.28);

    const gcBonus = jvm.gc === 'ZGC' ? 1.06 : jvm.gc === 'Shenandoah' ? 1.04 : 1.02;
    const ramBonus = jvm.ramGb >= 4 && jvm.ramGb <= 10 ? 1.03 : jvm.ramGb > 12 ? 0.98 : 0.95;
    const preTouchBonus = jvm.alwaysPreTouch ? 1.02 : 1.0;
    const conflictPenalty = conflicts.length > 0 ? Math.max(0.4, 1 - conflicts.length * 0.25) : 1.0;

    let rawFps = Math.round(
      baseHardwareFps * videoMultiplier * modMultiplier * gcBonus * ramBonus * preTouchBonus * conflictPenalty
    );
    if (video.vsync) rawFps = Math.min(rawFps, 60);
    else if (video.maxFps < 260) rawFps = Math.min(rawFps, video.maxFps);

    const estimatedFps = Math.max(15, rawFps);
    const fpsGainPercent = Math.round(((estimatedFps - vanillaFps) / Math.max(1, vanillaFps)) * 100);
    const vanillaFrameTimeMs = Number((1000 / Math.max(1, vanillaFps)).toFixed(1));
    const frameTimeMs = Number((1000 / Math.max(1, estimatedFps)).toFixed(1));

    return {
      vanillaFps,
      estimatedFps,
      fpsGainPercent,
      vanillaFrameTimeMs,
      frameTimeMs,
      ramSavedMb,
      activeModsCount: enabledMods.length,
      conflicts
    };
  }

  function resolveJavaMajorFromVersion(versionOrMajor) {
    if (typeof versionOrMajor === 'number' && Number.isFinite(versionOrMajor)) {
      return Math.round(versionOrMajor);
    }
    const id = String(versionOrMajor || '').trim();
    if (!id) return null;
    if (Nexus.utils && typeof Nexus.utils.requiredJavaForVersion === 'function') {
      return Nexus.utils.requiredJavaForVersion(id);
    }
    const calver = id.match(/^(\d{2,})\.(\d+)/);
    if (calver && Number(calver[1]) >= 26) return 25;
    const snap = id.match(/^(\d{2})w(\d{2})/);
    if (snap) {
      const yr = Number(snap[1]);
      const wk = Number(snap[2]);
      if (yr >= 26) return 25;
      if (yr > 24 || (yr === 24 && wk >= 14)) return 21;
      return yr >= 21 ? 17 : 8;
    }
    const sem = id.match(/1\.(\d+)(?:\.(\d+))?/);
    if (sem) {
      const minor = Number(sem[1]);
      const patch = Number(sem[2] || 0);
      if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
      return minor >= 17 ? 17 : 8;
    }
    return 21;
  }

  function generateJvmArgs(jvm, versionOrJavaMajor) {
    const ramMb = Math.max(1024, Math.round(jvm.ramGb * 1024));
    const args = [`-Xms${ramMb}M`, `-Xmx${ramMb}M`];
    const javaMajor = resolveJavaMajorFromVersion(versionOrJavaMajor);
    const useSafeG1 = javaMajor !== null && javaMajor < 21 && jvm.gc === 'ZGC';

    if (jvm.gc === 'ZGC' && !useSafeG1) {
      args.push('-XX:+UseZGC');
      if (javaMajor === null || javaMajor < 24) {
        args.push('-XX:+ZGenerational');
      }
    } else if (jvm.gc === 'Shenandoah' && (javaMajor === null || javaMajor >= 17)) {
      args.push('-XX:+UseShenandoahGC', '-XX:ShenandoahGCHeuristics=compact');
    } else {
      args.push(
        '-XX:+UseG1GC',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:G1NewSizePercent=20',
        '-XX:G1ReservePercent=20',
        '-XX:MaxGCPauseMillis=35',
        '-XX:G1HeapRegionSize=32M'
      );
    }
    if (jvm.alwaysPreTouch && (jvm.gc !== 'ZGC' || useSafeG1)) args.push('-XX:+AlwaysPreTouch');
    if (jvm.stringDeduplication && (jvm.gc !== 'ZGC' || useSafeG1)) args.push('-XX:+UseStringDeduplication');
    args.push(
      `-XX:ConcGCThreads=${Math.max(1, Math.min(8, jvm.parallelThreads))}`,
      '-XX:+ExplicitGCInvokesConcurrent',
      '-XX:+PerfDisableSharedMem',
      '-Djdk.nio.maxCachedBufferSize=262144',
      '-Dfml.readTimeout=90'
    );
    if (jvm.customArgs && jvm.customArgs.trim()) {
      args.push(...jvm.customArgs.trim().split(/\s+/).filter(Boolean));
    }
    return args;
  }

  function generateOptionsTxt(video, network) {
    const graphicsNum = video.graphicsMode === 'fast' ? 0 : video.graphicsMode === 'fancy' ? 1 : 2;
    const particlesNum = video.particles === 'all' ? 0 : video.particles === 'decreased' ? 1 : 2;
    const cloudsStr = video.clouds === 'off' ? 'false' : video.clouds === 'fast' ? '"fast"' : '"true"';
    return [
      '# Pan Launcher - options.txt generado automaticamente',
      `renderDistance:${video.renderDistance}`,
      `simulationDistance:${Math.max(5, Number(video.simulationDistance) || 5)}`,
      `maxFps:${video.maxFps >= 260 ? 260 : video.maxFps}`,
      `graphicsMode:${graphicsNum}`,
      `ao:${video.smoothLighting ? 'true' : 'false'}`,
      `entityShadows:${video.entityShadows ? 'true' : 'false'}`,
      `particles:${particlesNum}`,
      `renderClouds:${cloudsStr}`,
      `enableVsync:${video.vsync ? 'true' : 'false'}`,
      `biomeBlendRadius:${video.biomeBlend}`,
      `entityDistanceScaling:${(video.entityDistanceScaling / 100).toFixed(2)}`,
      `guiScale:${video.guiScale}`,
      `gamma:${video.fullbright ? '10.0' : '1.0'}`,
      `bobView:${video.viewBobbing === false ? 'false' : 'true'}`,
      `mipmapLevels:${video.mipmapZero ? 0 : 4}`,
      ...(video.disableVisualEffects
        ? [
            'menuBackgroundBlurriness:0',
            'glintSpeed:0.0',
            'glintStrength:0.0',
            'screenEffectScale:0.0',
            'fovEffectScale:0.0',
            'darknessEffectScale:0.0',
            'damageTiltStrength:0.0'
          ]
        : []),
      `rawMouseInput:${video.rawMouseInput !== false ? 'true' : 'false'}`,
      `skipMultiplayerWarning:true`,
      `snooperEnabled:${network && network.disableTelemetry ? 'false' : 'true'}`
    ].join('\n');
  }

  function buildWarnings(normalized, config) {
    const warnings = [];
    const enabledIds = new Set(normalized.enabledIds);
    const versionId = String((config && config.launch && config.launch.versionId) || '1.21.4');
    const reqJava = resolveJavaMajorFromVersion(versionId);

    if (enabledIds.has('optifine')) {
      warnings.push('OptiFine Legacy no se distribuye en Modrinth; no se descargará dentro del .mrpack automático.');
    }
    if (enabledIds.has('immediatelyfast')) {
      warnings.push('ImmediatelyFast está activado: en algunas versiones de Sodium/1.21+ puede provocar cierres al reaparecer tras morir.');
    }
    if (enabledIds.has('moreculling')) {
      warnings.push('MoreCulling está activado: puede provocar cierres en servidores que descargan paquetes de recursos propios.');
    }
    if (enabledIds.has('nvidium') && normalized.device && !normalized.device.isSoftwareRenderer && !normalized.device.isNvidia && !/no expuesta/i.test(normalized.device.gpuName)) {
      warnings.push(`Nvidium requiere GPU NVIDIA GTX 16xx/RTX (tu navegador reporta: ${normalized.device.gpuName}).`);
    }
    if (normalized.jvm.gc === 'ZGC' && reqJava !== null && reqJava < 21) {
      warnings.push(`Minecraft ${versionId} usa Java ${reqJava} donde ZGC Generacional no está disponible; se aplicará G1GC seguro o cambia a G1GC.`);
    }
    if (enabledIds.has('c2me') && normalized.device && normalized.device.cores < 4) {
      warnings.push(`C2ME aprovecha 6+ hilos de CPU; este dispositivo reporta ${normalized.device.cores} hilos.`);
    }
    if (normalized.exportLoader === 'NeoForge') {
      const fabricOnly = ['krypton', 'nvidium', 'vulkanmod', 'moreculling'].filter((id) => enabledIds.has(id));
      if (fabricOnly.length) {
        warnings.push(`Para .mrpack en NeoForge se omitirán mods exclusivos de Fabric (${fabricOnly.join(', ')}).`);
      }
    }
    return warnings;
  }

  function evaluateFromConfig(config) {
    const normalized = normalizePerfState(config);
    const activeVersionId = (config && config.launch && config.launch.versionId) || '1.21.4';
    const useDeviceFactor = normalized.hardwareMode === 'auto' && normalized.device ? normalized.device.pixelFactor : 1.0;
    const estimate = estimatePerformance(
      normalized.mods,
      normalized.video,
      normalized.jvm,
      normalized.hardwareTier,
      useDeviceFactor
    );
    const warnings = buildWarnings(normalized, config);
    return {
      ...normalized,
      estimate,
      warnings,
      jvmArgs: generateJvmArgs(normalized.jvm, activeVersionId),
      optionsTxt: generateOptionsTxt(normalized.video, normalized.network)
    };
  }

  Nexus.perfEngine = Object.freeze({
    PRESETS: PERF_PRESETS,
    MODS: PERF_MODS,
    detectDeviceHardware,
    normalizePerfState,
    detectModConflicts,
    estimatePerformance,
    generateJvmArgs,
    generateOptionsTxt,
    evaluateFromConfig
  });
})();
