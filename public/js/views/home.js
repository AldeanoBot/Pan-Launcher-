(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  function statusLabel(value) {
    const allowed = new Set(['idle', 'preparing', 'starting', 'playing', 'stopping', 'error']);
    const k = allowed.has(value) ? value : 'idle';
    return t(`status.${k}`);
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
      diagnostic.versionId ? t('launch.diagVer', { ver: diagnostic.versionId }) : null,
      diagnostic.loader && diagnostic.loader !== 'vanilla'
        ? `${diagnostic.loader}${diagnostic.loaderVersion ? ` ${diagnostic.loaderVersion}` : ''}` : null,
      java.major ? `Java ${java.major}${java.requiredMajor ? t('launch.diagReqJava', { req: java.requiredMajor }) : ''}` : null,
      diagnostic.exitCode !== null && diagnostic.exitCode !== undefined
        ? `${t('launch.diagCode', { code: diagnostic.exitCode })}${diagnostic.signal ? t('launch.diagSignal', { signal: diagnostic.signal }) : ''}` : null
    ].filter(Boolean);

    return `
      <details class="diagnostic-panel" id="launch-diagnostic">
        <summary>
          <span class="badge badge-error">${escapeHtml(cause.category || t('launch.diagCatFallback'))}</span>
          ${escapeHtml(cause.message || t('launch.diagTitleFallback'))}
        </summary>
        <div class="diagnostic-body">
          <p class="diagnostic-hint">${escapeHtml(cause.hint || '')}</p>
          ${head.length ? `<p class="diagnostic-meta">${head.map(escapeHtml).join(' · ')}</p>` : ''}
          ${ram.maxMb ? `<p class="diagnostic-meta">${escapeHtml(t('home.ramRangeMeta', { min: formatRam(ram.minMb), max: formatRam(ram.maxMb) }))}</p>` : ''}
          ${latest.path ? `<p class="diagnostic-path">${escapeHtml(t('launch.diagLastLog'))} <code>${escapeHtml(latest.path)}</code></p>` : ''}
          ${consoleTail.length ? `
            <details class="diagnostic-details">
              <summary>${escapeHtml(t('launch.diagConsoleTail', { count: consoleTail.length }))}</summary>
              <pre>${escapeHtml(consoleTail.map((line) => line && line.text).filter(Boolean).join('\n'))}</pre>
            </details>` : ''}
          ${latest.tail ? `
            <details class="diagnostic-details">
              <summary>${escapeHtml(t('launch.diagLatestLogTail'))}</summary>
              <pre>${escapeHtml(latest.tail)}</pre>
            </details>` : ''}
          ${reports.map((report) => `
            <details class="diagnostic-details">
              <summary>${escapeHtml(t('launch.diagReport', { name: String(report.path).split(/[\\/]/).pop() }))}</summary>
              <pre>${escapeHtml(report.tail || '')}</pre>
            </details>`).join('')}
        </div>
      </details>`;
  }

  function closeBehaviorMeta(value) {
    const mode = value === 'minimize' || value === 'keep' ? value : 'quit';
    const icon = mode === 'minimize' ? 'layers' : mode === 'keep' ? 'shield' : 'power';
    return {
      label: t(`close.${mode}.label`),
      short: t(`close.${mode}.short`),
      icon
    };
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
    const loaderName = loaderLabelFor(profile.loader);

    return `
      <section class="panel loader-switcher-bar${compact ? ' is-compact' : ''}" data-tour="home-loader" aria-label="${escapeHtml(t('loaderBar.aria'))}">
        <div class="loader-switcher-main">
          <div class="loader-switcher-copy">
            <strong>${escapeHtml(t('loaderBar.question'))}</strong>
            <span>${profile.isInstallation
              ? escapeHtml(t('loaderBar.isolatedDesc', { name: profile.installationName, loader: loaderName }))
              : escapeHtml(t('loaderBar.directDesc'))}</span>
          </div>
          <div class="loader-segmented" role="group" aria-label="${escapeHtml(t('loaderBar.chooseAria'))}">
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
            <label for="home-loader-version">${escapeHtml(t('loaderBar.versionOf', { loader: loaderName }))}</label>
            <div class="loader-build-controls">
              <select id="home-loader-version" class="loader-version-select" ${dl.state === 'loading' ? 'disabled' : ''}>
                ${dl.state === 'loading'
                  ? `<option value="">${escapeHtml(t('loaderBar.loadingBuilds'))}</option>`
                  : `<option value="">${escapeHtml(t('loaderBar.autoBuild'))}</option>${items.map((b) => `
                      <option value="${escapeHtml(b.id)}"${selectedBuild === b.id ? ' selected' : ''}>${escapeHtml(b.label || b.id)}${b.stable ? ` (${escapeHtml(t('loaderBar.stable'))})` : ''}</option>`).join('')}`}
              </select>
              <button type="button" class="btn btn-xs" data-action="refresh-direct-loader-catalog" aria-label="${escapeHtml(t('loaderBar.refreshTitle'))}" title="${escapeHtml(t('loaderBar.refreshTitle'))}">
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
          ${escapeHtml(t('launch.reqGoVersions'))} <span data-icon="arrow"></span>
        </button>`;
    }
    if (code === 'auth') {
      return `
        <div class="launch-req-btns">
          <button type="button" class="btn btn-xs btn-primary" data-action="navigate" data-view="players">
            ${escapeHtml(t('launch.reqUseOffline'))}
          </button>
          <button type="button" class="btn btn-xs" data-action="navigate" data-view="accounts">
            ${escapeHtml(t('launch.reqSignMicrosoft'))}
          </button>
        </div>`;
    }
    if (code === 'ram') {
      return `
        <button type="button" class="btn btn-xs" data-action="navigate" data-view="ram">
          ${escapeHtml(t('launch.reqAdjustRam'))} <span data-icon="arrow"></span>
        </button>`;
    }
    if (code === 'java') {
      return `
        <button type="button" class="btn btn-xs" data-action="navigate" data-view="java">
          ${escapeHtml(t('launch.reqConfigJava'))} <span data-icon="arrow"></span>
        </button>`;
    }
    return '';
  }

  function buildCompatAlertHtml(state, activeProfile) {
    const modList = (state.customMods && state.customMods.items) || [];
    const rpList = (state.resourcePacks && state.resourcePacks.items) || [];
    const incompatMods = Nexus.modInspector
      ? Nexus.modInspector.findIncompatibleEnabledMods(modList, activeProfile.gameVersion, activeProfile.loader)
      : [];
    const incompatPacks = Nexus.resourcePackInspector
      ? Nexus.resourcePackInspector.findIncompatibleEnabledPacks(rpList, activeProfile.gameVersion)
      : [];
    if (!incompatMods.length && !incompatPacks.length) return '';

    const modNames = incompatMods.slice(0, 3).map((e) => e.mod.name || e.mod.filename).join(', ')
      + (incompatMods.length > 3 ? ` (+${incompatMods.length - 3})` : '');
    const packNames = incompatPacks.slice(0, 3).map((e) => e.pack.name || e.pack.filename).join(', ')
      + (incompatPacks.length > 3 ? ` (+${incompatPacks.length - 3})` : '');
    const loaderLabel = loaderLabelFor(activeProfile.loader);

    return `
      <div class="home-compat-alert" id="home-compat-alert" role="alert">
        <div class="home-compat-head">
          <span class="badge badge-error">${escapeHtml(t('modModal.badge', null, 'Compatibilidad'))}</span>
          <strong>${escapeHtml(t('home.compatTitle', { mc: activeProfile.gameVersion, loader: loaderLabel }))}</strong>
        </div>
        <ul class="home-compat-list">
          ${incompatMods.length ? `<li>${escapeHtml(t('home.compatModsRow', { count: incompatMods.length, names: modNames }))}</li>` : ''}
          ${incompatPacks.length ? `<li>${escapeHtml(t('home.compatPacksRow', { count: incompatPacks.length, names: packNames }))}</li>` : ''}
        </ul>
        <div class="home-compat-actions">
          <button type="button" class="btn btn-xs btn-danger-ghost" data-action="disable-all-incompatible">
            ${escapeHtml(t('home.compatDisableBtn'))}
          </button>
          ${incompatMods.length ? `
            <button type="button" class="btn btn-xs" data-action="navigate" data-view="mods">
              ${escapeHtml(t('home.compatReviewMods'))} <span data-icon="arrow"></span>
            </button>` : ''}
          ${incompatPacks.length ? `
            <button type="button" class="btn btn-xs" data-action="navigate" data-view="resourcepacks">
              ${escapeHtml(t('home.compatReviewPacks'))} <span data-icon="arrow"></span>
            </button>` : ''}
        </div>
      </div>`;
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
    const sessionMode = active && active.mode
      ? (active.mode === 'offline' ? t('home.offlineLabel') : t('home.onlineLabel'))
      : (state.session && state.session.mode === 'offline' ? t('home.offlineLabel') : t('home.onlineLabel'));

    const diagnostic = status.diagnostic || null;
    let summary;
    if (phase === 'error') {
      summary = diagnostic && diagnostic.probableCause
        ? escapeHtml(diagnostic.probableCause.message)
        : escapeHtml(status.error || t('launch.unknownLaunchErr'));
    } else if (phase === 'playing' && active) {
      summary = escapeHtml(t('launch.runningMsg', { ver: active.versionId }));
    } else if (active) {
      summary = escapeHtml(t('home.statusWithVer', { status: statusLabel(phase), ver: versionId }));
    } else if (reasons.length) {
      summary = escapeHtml(t('launch.pendingSteps'));
    } else {
      summary = escapeHtml(t('launch.allReady'));
    }

    const compatAlertHtml = buildCompatAlertHtml(state, activeProfile);

    return `
      <section class="panel launch-panel" id="launch-panel-inner" data-phase="${escapeHtml(phase)}">
        <div class="panel-head">
          <div>
            <h3>${escapeHtml(reasons.length && phase === 'idle' ? t('launch.missingTitle') : t('launch.sessionTitle'))}</h3>
            <p>${summary}</p>
          </div>
          <span class="badge badge-launch badge-${escapeHtml(phase)}">${escapeHtml(statusLabel(phase))}</span>
        </div>

        <div class="launch-meta tabular">
          <span><strong>${escapeHtml(t('launch.metaVersion'))}</strong> ${escapeHtml(versionId)}</span>
          <span><strong>${escapeHtml(t('launch.metaMode'))}</strong> ${escapeHtml(loaderDisplay)}</span>
          <span><strong>${escapeHtml(t('launch.metaAccount'))}</strong> ${escapeHtml(sessionMode)}</span>
          ${perfEval ? `<span><strong>${escapeHtml(t('launch.metaPerf'))}</strong> ${escapeHtml(perfEval.presetName)}</span>` : ''}
          <span><strong>${escapeHtml(t('launch.metaOnPlay'))}</strong> ${escapeHtml(closeMeta.short)}</span>
          ${active ? `<span><strong>${escapeHtml(t('launch.metaJava'))}</strong> ${escapeHtml(String(active.javaMajor || '—'))}</span>
          <span><strong>${escapeHtml(t('launch.metaRam'))}</strong> ${escapeHtml(formatRam(active.ramMb || state.config.launch.ramMb))}</span>` : ''}
        </div>

        ${compatAlertHtml}

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
              <span data-icon="stop"></span> ${escapeHtml(t('launch.stopBtn'))}
            </button>` : ''}
            <button type="button" class="btn btn-sm" data-action="refresh-preflight">${escapeHtml(t('launch.recheckBtn'))}</button>
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
    const mode = sessionState.mode === 'offline' ? t('home.offlineLabel') : t('home.onlineLabel');
    const profile = sessionState.profile || auth.profile;
    const account = profile
      ? `${profile.name} · ${mode}`
      : auth.canRestore ? `${t('shell.savedSession')} · ${mode}` : `${t('home.noPlayer')} · ${mode}`;
    const installed = (state.installed || []).includes(version);
    const versionLabel = installed ? t('home.statVersionReady') : t('home.statVersionSelected');
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
            <span class="pill"><span class="pill-dot"></span> ${escapeHtml(t('home.pill'))}</span>
            <h2>${escapeHtml(t('home.heroTitle'))}</h2>
            <p class="muted">${escapeHtml(t('home.heroSubtitle'))}</p>
            <div class="hero-actions">
              <button type="button" class="btn btn-primary btn-lg" data-action="play"
                      ${Nexus.views.canPlay(state) ? '' : 'disabled'}>
                <span data-icon="play"></span> ${escapeHtml(t('home.playBtn'))}
              </button>
              <button type="button" class="btn btn-ghost btn-lg" data-action="navigate" data-view="versions">
                ${escapeHtml(t('home.chooseVersion'))} <span data-icon="arrow"></span>
              </button>
              <button type="button"
                      class="btn btn-sm hero-close-toggle${closeBehavior === 'quit' ? ' active' : ''}"
                      data-action="cycle-close-behavior"
                      aria-pressed="${closeBehavior === 'quit'}"
                      title="${escapeHtml(t('home.closeToggleTitle'))}">
                <span data-icon="${escapeHtml(closeMeta.icon)}"></span>
                <span>${escapeHtml(closeMeta.label)}</span>
              </button>
            </div>
            <p class="field-hint">${escapeHtml(installed ? t('home.hintInstalled') : t('home.hintNotInstalled'))}${escapeHtml(preflight.ready ? t('home.hintReady') : t('home.hintPending'))}</p>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="orb orb-one"></div>
            <div class="orb orb-two"></div>
            <div class="hero-sparks"></div>
            <img class="art-logo" src="${escapeHtml(logoUrl)}" alt="">
          </div>
        </section>

        <section class="stats-grid" aria-label="${escapeHtml(t('home.statsAria'))}">
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
              <div class="stat-label">${escapeHtml(t('home.statPerf'))}</div>
              <div class="stat-value tabular">${perfEval ? escapeHtml(t('home.perfSummary', { preset: perfEval.presetName, fps: perfEval.estimate.estimatedFps })) : escapeHtml(t('home.statPerfDefault'))}</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="ram"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(t('home.statRam'))}</div>
              <div class="stat-value tabular">${escapeHtml(ram)}</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="user"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(t('home.statPlayer'))}</div>
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
                <h3>${escapeHtml(t('home.perfQuestion'))}</h3>
                <p>${escapeHtml(t('home.perfSub'))}</p>
              </div>
              <button type="button" class="btn btn-xs" data-action="navigate" data-view="performance">
                ${escapeHtml(t('home.customize'))} <span data-icon="arrow"></span>
              </button>
            </div>
            <div class="preset-row">
              ${presets.map((preset) => {
                const active = perfEval && perfEval.presetId === preset.id;
                const label = t(`perf.preset.${preset.id}.name`, null, preset.name);
                return `
                  <button type="button" class="btn btn-sm ${active ? 'btn-primary' : ''}"
                          data-action="perf-apply-preset" data-preset="${escapeHtml(preset.id)}">
                    ${escapeHtml(label)}
                  </button>`;
              }).join('')}
            </div>
          </div>

          <div class="panel" data-tour="home-shortcuts">
            <div class="panel-head">
              <div>
                <h3>${escapeHtml(t('home.shortcutsTitle'))}</h3>
                <p>${escapeHtml(t('home.shortcutsSub'))}</p>
              </div>
            </div>
            <div class="preset-row">
              <button type="button" class="btn btn-sm btn-outline-accent" data-action="navigate" data-view="mods">
                <span data-icon="puzzle"></span> ${escapeHtml(t('home.shortcutMods'))}
              </button>
              <button type="button" class="btn btn-sm btn-outline-accent" data-action="navigate" data-view="resourcepacks">
                <span data-icon="pack"></span> ${escapeHtml(t('home.shortcutRpacks'))}
              </button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="players">${escapeHtml(t('home.shortcutPlayers'))}</button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="skins">${escapeHtml(t('home.shortcutSkins'))}</button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="ram">${escapeHtml(t('home.shortcutRam'))}</button>
              <button type="button" class="btn btn-sm" data-action="navigate" data-view="settings">${escapeHtml(t('home.shortcutDownload'))}</button>
              <button type="button" class="btn btn-sm btn-ghost" data-action="start-tour">
                <span data-icon="help"></span> ${escapeHtml(t('home.shortcutTour'))}
              </button>
            </div>
          </div>
        </section>

        ${note(t('home.note', { mode, player: profile ? profile.name : t('home.noActivePlayer') }))}
      </div>`;
  };
})();
