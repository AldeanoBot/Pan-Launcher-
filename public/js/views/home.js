(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  const STATUS_LABELS = Object.freeze({
    idle: 'Listo',
    preparing: 'Preparando',
    starting: 'Iniciando',
    playing: 'Jugando',
    stopping: 'Cerrando',
    error: 'Error'
  });

  function statusLabel(value) {
    return STATUS_LABELS[value] || 'Listo';
  }

  Nexus.views.canPlay = function (state) {
    const launch = state.launch || {};
    const preflight = launch.preflight || {};
    return Boolean(preflight.ready) &&
      !(launch.status && launch.status.active) &&
      !launch.starting &&
      !(state.install && state.install.active);
  };

  function diagnosticPanel(status) {
    const diagnostic = status && status.diagnostic;
    if (!diagnostic || !diagnostic.probableCause) return '';
    const cause = diagnostic.probableCause;
    const java = diagnostic.java || {};
    const ram = diagnostic.ram || {};
    const latest = diagnostic.latestLog || {};
    const reports = Array.isArray(diagnostic.crashReports) ? diagnostic.crashReports : [];
    const consoleTail = Array.isArray(diagnostic.consoleTail) ? diagnostic.consoleTail : [];
    const head = [
      diagnostic.versionId ? `Versión ${diagnostic.versionId}` : null,
      diagnostic.loader && diagnostic.loader !== 'vanilla'
        ? `${diagnostic.loader}${diagnostic.loaderVersion ? ` ${diagnostic.loaderVersion}` : ''}` : null,
      java.major ? `Java ${java.major}${java.requiredMajor ? ` (requerido ${java.requiredMajor})` : ''}` : null,
      diagnostic.exitCode !== null && diagnostic.exitCode !== undefined
        ? `Código ${diagnostic.exitCode}${diagnostic.signal ? ` · señal ${diagnostic.signal}` : ''}` : null
    ].filter(Boolean);

    return `
      <details class="diagnostic-panel" id="launch-diagnostic">
        <summary>
          <span class="badge badge-error">${escapeHtml(cause.category || 'diagnóstico')}</span>
          ${escapeHtml(cause.message || 'Diagnóstico del último lanzamiento')}
        </summary>
        <div class="diagnostic-body">
          <p class="diagnostic-hint">${escapeHtml(cause.hint || '')}</p>
          ${head.length ? `<p class="diagnostic-meta">${head.map(escapeHtml).join(' · ')}</p>` : ''}
          ${ram.maxMb ? `<p class="diagnostic-meta">RAM: ${formatRam(ram.minMb)} – ${formatRam(ram.maxMb)}</p>` : ''}
          ${latest.path ? `<p class="diagnostic-path">Último registro: <code>${escapeHtml(latest.path)}</code></p>` : ''}
          ${consoleTail.length ? `
            <details class="diagnostic-details">
              <summary>Consola del lanzamiento (${consoleTail.length} líneas)</summary>
              <pre>${escapeHtml(consoleTail.map((line) => line && line.text).filter(Boolean).join('\n'))}</pre>
            </details>` : ''}
          ${latest.tail ? `
            <details class="diagnostic-details">
              <summary>Cola de latest.log</summary>
              <pre>${escapeHtml(latest.tail)}</pre>
            </details>` : ''}
          ${reports.map((report) => `
            <details class="diagnostic-details">
              <summary>Informe: ${escapeHtml(String(report.path).split(/[\\/]/).pop())}</summary>
              <pre>${escapeHtml(report.tail || '')}</pre>
            </details>`).join('')}
        </div>
      </details>`;
  }

  const CLOSE_BEHAVIOR_META = Object.freeze({
    quit: { label: 'Cerrar launcher al jugar (vuelve al salir)', short: 'Cerrar y volver al salir', icon: 'power' },
    minimize: { label: 'Minimizar al jugar', short: 'Minimizar al iniciar', icon: 'layers' },
    keep: { label: 'Mantener abierto al jugar', short: 'Mantener abierto', icon: 'shield' }
  });

  function closeBehaviorMeta(value) {
    return CLOSE_BEHAVIOR_META[value] || CLOSE_BEHAVIOR_META.quit;
  }

  const LOADER_OPTIONS = Object.freeze([
    { id: 'vanilla', label: 'Vanilla' },
    { id: 'fabric', label: 'Fabric' },
    { id: 'forge', label: 'Forge' },
    { id: 'neoforge', label: 'NeoForge' },
    { id: 'quilt', label: 'Quilt' }
  ]);

  function loaderLabelFor(id) {
    const found = LOADER_OPTIONS.find((item) => item.id === String(id || 'vanilla').toLowerCase());
    return found ? found.label : 'Vanilla';
  }

  function resolveActiveLaunchProfile(state) {
    const config = state.config || {};
    const launchCfg = config.launch || {};
    const list = (state.installations && state.installations.list) || [];
    const activeInst = list.find((item) => item.id === launchCfg.activeInstallationId) || null;
    if (activeInst) {
      return {
        isInstallation: true,
        installationName: activeInst.name,
        gameVersion: activeInst.gameVersion || activeInst.versionId,
        loader: String(activeInst.loader || 'vanilla').toLowerCase(),
        loaderVersion: activeInst.loaderVersion || null
      };
    }
    const rawVer = String(launchCfg.versionId || '1.21.4');
    const match = rawVer.match(/^(fabric|forge|neoforge|quilt)-(.+)-([^-]+)$/i);
    if (match) {
      return {
        isInstallation: false,
        installationName: null,
        gameVersion: match[3],
        loader: match[1].toLowerCase(),
        loaderVersion: match[2]
      };
    }
    return {
      isInstallation: false,
      installationName: null,
      gameVersion: rawVer,
      loader: String(launchCfg.loader || 'vanilla').toLowerCase(),
      loaderVersion: launchCfg.loaderVersion || null
    };
  }

  Nexus.views.loaderSwitcherBar = function (state, compact) {
    const profile = resolveActiveLaunchProfile(state);
    const dl = state.directLoader || { state: 'idle', items: [], error: '' };
    const selectedBuild = (state.config && state.config.launch && state.config.launch.loaderVersion) || '';
    const items = Array.isArray(dl.items) ? dl.items.slice(0, 40) : [];

    return `
      <section class="panel loader-switcher-bar${compact ? ' is-compact' : ''}" data-tour="home-loader" aria-label="Selector de cargador de mods">
        <div class="loader-switcher-main">
          <div class="loader-switcher-copy">
            <strong>¿Juegas normal o con mods?</strong>
            <span>${profile.isInstallation
              ? `Perfil aislado "${escapeHtml(profile.installationName)}" (${escapeHtml(loaderLabelFor(profile.loader))})`
              : `Vanilla = Minecraft normal · Fabric / Forge / NeoForge / Quilt = usar mods .jar`}</span>
          </div>
          <div class="loader-segmented" role="group" aria-label="Elegir cargador">
            ${LOADER_OPTIONS.map((item) => {
              const isActive = profile.loader === item.id;
              return `
                <button type="button"
                        class="loader-seg-btn${isActive ? ' active' : ''}"
                        data-action="set-launch-loader"
                        data-loader="${escapeHtml(item.id)}"
                        aria-pressed="${isActive}">
                  ${escapeHtml(item.label)}
                </button>`;
            }).join('')}
          </div>
        </div>
        ${!profile.isInstallation && profile.loader !== 'vanilla' ? `
          <div class="loader-switcher-build">
            <label for="home-loader-version">Versión de ${escapeHtml(loaderLabelFor(profile.loader))}:</label>
            <div class="loader-build-controls">
              <select id="home-loader-version" class="loader-version-select" ${dl.state === 'loading' ? 'disabled' : ''}>
                ${dl.state === 'loading'
                  ? '<option value="">Cargando builds oficiales…</option>'
                  : `<option value="">Automática (recomendada)</option>${items.map((b) => `
                      <option value="${escapeHtml(b.id)}"${selectedBuild === b.id ? ' selected' : ''}>${escapeHtml(b.label || b.id)}${b.stable ? ' (Estable)' : ''}</option>`).join('')}`}
              </select>
              <button type="button" class="btn btn-xs" data-action="refresh-direct-loader-catalog" aria-label="Actualizar builds compatibles" title="Actualizar builds compatibles">
                <span data-icon="refresh"></span>
              </button>
            </div>
            ${dl.error && dl.state !== 'loading' ? `<small class="loader-build-note">${escapeHtml(dl.error)}</small>` : ''}
          </div>` : ''}
      </section>`;
  };

  function requirementQuickActions(code) {
    if (code === 'not-installed' || code === 'version') {
      return `
        <button type="button" class="btn btn-xs btn-outline-accent" data-action="navigate" data-view="versions">
          Ir a Versiones <span data-icon="arrow"></span>
        </button>`;
    }
    if (code === 'auth') {
      return `
        <div class="launch-req-btns">
          <button type="button" class="btn btn-xs btn-primary" data-action="navigate" data-view="players">
            Usar Modo Offline (Gratis)
          </button>
          <button type="button" class="btn btn-xs" data-action="navigate" data-view="accounts">
            Entrar con Microsoft
          </button>
        </div>`;
    }
    if (code === 'ram') {
      return `
        <button type="button" class="btn btn-xs" data-action="navigate" data-view="ram">
          Ajustar RAM <span data-icon="arrow"></span>
        </button>`;
    }
    if (code === 'java') {
      return `
        <button type="button" class="btn btn-xs" data-action="navigate" data-view="java">
          Configurar Java <span data-icon="arrow"></span>
        </button>`;
    }
    return '';
  }

  Nexus.views.launchPanel = function (state) {
    const launch = state.launch || {};
    const status = launch.status || {};
    const preflight = launch.preflight || {};
    const active = status.active || null;
    const phase = status.status || 'idle';
    const reasons = Array.isArray(preflight.reasons) ? preflight.reasons : [];
    const versionId = active ? active.versionId : (status.versionId || state.config.launch.versionId);
    const activeProfile = resolveActiveLaunchProfile(state);
    const loaderDisplay = loaderLabelFor(activeProfile.loader) + (activeProfile.loaderVersion ? ` ${activeProfile.loaderVersion}` : '');
    const perfEval = Nexus.perfEngine ? Nexus.perfEngine.evaluateFromConfig(state.config) : null;
    const closeMeta = closeBehaviorMeta(state.config && state.config.general && state.config.general.closeBehavior);

    const diagnostic = status.diagnostic || null;
    let summary;
    if (phase === 'error') {
      summary = diagnostic && diagnostic.probableCause
        ? escapeHtml(diagnostic.probableCause.message)
        : escapeHtml(status.error || 'Error desconocido al lanzar Minecraft.');
    } else if (phase === 'playing' && active) {
      summary = `Minecraft ${escapeHtml(active.versionId)} está abierto.`;
    } else if (active) {
      summary = `${statusLabel(phase)} ${escapeHtml(versionId)}…`;
    } else if (reasons.length) {
      summary = 'Completa estos pasos rápidos para activar el botón JUGAR de arriba:';
    } else {
      summary = '¡Todo listo! Pulsa JUGAR arriba para abrir Minecraft.';
    }

    return `
      <section class="panel launch-panel" id="launch-panel-inner" data-phase="${escapeHtml(phase)}">
        <div class="panel-head">
          <div>
            <h3>${reasons.length && phase === 'idle' ? '¿Qué falta para jugar?' : 'Estado de la sesión'}</h3>
            <p>${summary}</p>
          </div>
          <span class="badge badge-launch badge-${escapeHtml(phase)}">${escapeHtml(statusLabel(phase))}</span>
        </div>

        <div class="launch-meta tabular">
          <span><strong>Versión:</strong> ${escapeHtml(versionId)}</span>
          <span><strong>Modo:</strong> ${escapeHtml(loaderDisplay)}</span>
          <span><strong>Cuenta:</strong> ${active && active.mode ? escapeHtml(active.mode === 'offline' ? 'Offline' : 'Online') : escapeHtml(state.session && state.session.mode === 'offline' ? 'Offline' : 'Online')}</span>
          ${perfEval ? `<span><strong>Rendimiento:</strong> ${escapeHtml(perfEval.presetName)}</span>` : ''}
          <span><strong>Al jugar:</strong> ${escapeHtml(closeMeta.short)}</span>
          ${active ? `<span><strong>Java:</strong> ${escapeHtml(String(active.javaMajor || '—'))}</span>
          <span><strong>RAM:</strong> ${escapeHtml(formatRam(active.ramMb || state.config.launch.ramMb))}</span>` : ''}
        </div>

        ${reasons.length && phase === 'idle' ? `
          <ul class="launch-requirements">
            ${reasons.map((reason) => `
              <li class="launch-req-row" data-reason="${escapeHtml(reason.code)}">
                <span>${escapeHtml(reason.message)}</span>
                ${requirementQuickActions(reason.code)}
              </li>`).join('')}
          </ul>` : ''}

        ${active || reasons.length || phase === 'error' ? `
          <div class="launch-actions">
            ${active ? `<button type="button" class="btn btn-danger btn-sm" data-action="stop-game">
              <span data-icon="stop"></span> Cerrar Minecraft
            </button>` : ''}
            <button type="button" class="btn btn-sm" data-action="refresh-preflight">Comprobar de nuevo</button>
          </div>` : ''}

        ${!active ? diagnosticPanel(status) : ''}
      </section>`;
  };

  Nexus.views.home = function (state) {
    const config = state.config;
    const selected = state.versions.find((item) => item.id === config.launch.versionId) || state.versions[0];
    const version = selected ? selected.id : (config.launch.versionId || '—');
    const activeProfile = resolveActiveLaunchProfile(state);
    const loaderTag = loaderLabelFor(activeProfile.loader);
    const ram = formatRam(config.launch.ramMb);
    const auth = state.auth || {};
    const sessionState = state.session || { mode: 'online', profile: null };
    const mode = sessionState.mode === 'offline' ? 'Offline' : 'Online';
    const profile = sessionState.profile || auth.profile;
    const account = profile
      ? `${profile.name} · ${mode}`
      : auth.canRestore ? `Sesión guardada · ${mode}` : `Sin jugador · ${mode}`;
    const installed = (state.installed || []).includes(version);
    const versionLabel = installed ? 'Versión lista' : 'Versión elegida';
    const launch = state.launch || {};
    const preflight = launch.preflight || {};
    const logo = state.logo || null;
    const logoUrl = (logo && logo.available && logo.dataUrl) || '/assets/pan-logo.png';
    const perfEval = Nexus.perfEngine ? Nexus.perfEngine.evaluateFromConfig(config) : null;
    const presets = Nexus.perfEngine ? Object.values(Nexus.perfEngine.PRESETS) : [];
    const closeBehavior = (config.general && config.general.closeBehavior) || 'quit';
    const closeMeta = closeBehaviorMeta(closeBehavior);

    return `
      <div class="page">
        <section class="hero">
          <div class="hero-copy">
            <span class="pill"><span class="pill-dot"></span> MINECRAFT JAVA · FÁCIL Y OPTIMIZADO</span>
            <h2>Tu mundo empieza aquí.</h2>
            <p class="muted">Elige tu versión, entra con tu nombre o cuenta Microsoft y juega con el máximo rendimiento desde el primer clic.</p>
            <div class="hero-actions">
              <button type="button" class="btn btn-primary btn-lg" data-action="play"
                      ${Nexus.views.canPlay(state) ? '' : 'disabled'}>
                <span data-icon="play"></span> JUGAR
              </button>
              <button type="button" class="btn btn-ghost btn-lg" data-action="navigate" data-view="versions">
                Elegir versión <span data-icon="arrow"></span>
              </button>
              <button type="button"
                      class="btn btn-sm hero-close-toggle${closeBehavior === 'quit' ? ' active' : ''}"
                      data-action="cycle-close-behavior"
                      aria-pressed="${closeBehavior === 'quit'}"
                      title="Alterna si Pan Launcher se cierra, minimiza o permanece abierto al iniciar Minecraft">
                <span data-icon="${escapeHtml(closeMeta.icon)}"></span>
                <span>${escapeHtml(closeMeta.label)}</span>
              </button>
            </div>
            <p class="field-hint">${installed ? 'Versión instalada y lista. ' : 'Paso 1: instala una versión en Versiones. '}${preflight.ready ? 'Todo comprobado para jugar.' : 'Sigue los pasos de abajo para activar JUGAR.'}</p>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="orb orb-one"></div>
            <div class="orb orb-two"></div>
            <div class="hero-sparks"></div>
            <img class="art-logo" src="${escapeHtml(logoUrl)}" alt="">
          </div>
        </section>

        <section class="stats-grid" aria-label="Resumen rápido">
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="cube"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(versionLabel)}</div>
              <div class="stat-value tabular">${escapeHtml(version)} · ${escapeHtml(loaderTag)}</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="bolt"></span></div>
            <div>
              <div class="stat-label">Rendimiento</div>
              <div class="stat-value tabular">${perfEval ? `${escapeHtml(perfEval.presetName)} · ~${escapeHtml(String(perfEval.estimate.estimatedFps))} FPS` : 'Estándar'}</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="ram"></span></div>
            <div>
              <div class="stat-label">Memoria RAM</div>
              <div class="stat-value tabular">${escapeHtml(ram)}</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="user"></span></div>
            <div>
              <div class="stat-label">Jugador</div>
              <div class="stat-value">${escapeHtml(account)}</div>
            </div>
          </article>
        </section>

        <div id="launch-panel">${Nexus.views.launchPanel(state)}</div>

        ${Nexus.views.loaderSwitcherBar(state, false)}

        <section class="two-columns">
          <div class="panel" data-tour="home-perf">
            <div class="panel-head">
              <div>
                <h3>¿Cómo quieres que vaya el juego?</h3>
                <p>Elige un modo automático en 1 clic según tu PC o estilo de juego.</p>
              </div>
              <button type="button" class="btn btn-xs" data-action="navigate" data-view="performance">
                Personalizar <span data-icon="arrow"></span>
              </button>
            </div>
            <div class="preset-row">
              ${presets.map((preset) => {
                const active = perfEval && perfEval.presetId === preset.id;
                return `
                  <button type="button" class="btn btn-sm ${active ? 'btn-primary' : ''}"
                          data-action="perf-apply-preset" data-preset="${escapeHtml(preset.id)}">
                    ${escapeHtml(preset.name)}
                  </button>`;
              }).join('')}
            </div>
          </div>

          <div class="panel" data-tour="home-shortcuts">
            <div class="panel-head">
              <div>
                <h3>Accesos rápidos</h3>
                <p>Entra directo a lo que necesites configurar o ver.</p>
              </div>
            </div>
            <div class="preset-row">
              <button type="button" class="btn btn-sm btn-outline-accent" data-action="navigate" data-view="mods">
                <span data-icon="puzzle"></span> Añadir Mods (.jar)
              </button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="players">Cuenta / Offline</button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="skins">Skins 3D</button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="ram">Memoria RAM</button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="settings">Descargar .exe / Linux</button>
              <button type="button" class="btn btn-sm btn-ghost" data-action="start-tour">
                <span data-icon="help"></span> Ver tutorial
              </button>
            </div>
          </div>
        </section>

        ${note(`Modo ${mode}: ${profile ? escapeHtml(profile.name) : 'sin jugador activo'}. Tus servidores, idioma y opciones se conservan aunque cambies de versión o modo.`)}
      </div>`;
  };
})();
