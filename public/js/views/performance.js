(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  function tierLabel(tier) {
    if (tier === 'low' || tier === 'mid' || tier === 'high') {
      return t(`perf.tier.${tier}`);
    }
    return t('perf.tier.mid');
  }

  Nexus.views.performance = function (state) {
    const engine = Nexus.perfEngine;
    if (!engine) {
      return `<div class="error-state"><h2>${escapeHtml(t('perf.notLoaded'))}</h2></div>`;
    }

    const evaluated = engine.evaluateFromConfig(state.config);
    const {
      presetId,
      hardwareMode,
      hardwareTier,
      exportLoader,
      device,
      video,
      jvm,
      network,
      mods,
      estimate,
      warnings,
      jvmArgs,
      optionsTxt
    } = evaluated;
    const presets = Object.values(engine.PRESETS);
    const activeVersion = (state.config && state.config.launch && state.config.launch.versionId) || '1.21.4';
    const ramMb = Number(state.config && state.config.launch && state.config.launch.ramMb) || 4096;
    const gainSign = estimate.fpsGainPercent >= 0 ? '+' : '';
    const ramText = device && device.ramGb !== null
      ? `${device.ramGb} GB${device.ramCappedByBrowser ? t('perf.devRamCap') : ''}`
      : t('perf.devNotExposed');

    const tierModes = ['auto', 'low', 'mid', 'high'];
    const gcIds = ['ZGC', 'G1GC', 'Shenandoah'];

    return `
      <div class="page">
        ${pageHead(
          t('perf.eyebrow'),
          t('perf.title'),
          t('perf.sub'),
          `<div class="header-actions perf-export-controls">
             <label class="sr-only" for="perf-export-loader">${escapeHtml(t('perf.exportLabel'))}</label>
             <select id="perf-export-loader" class="perf-loader-select" aria-label="${escapeHtml(t('perf.exportLabel'))}">
               <option value="Fabric"${exportLoader === 'Fabric' ? ' selected' : ''}>Fabric</option>
               <option value="NeoForge"${exportLoader === 'NeoForge' ? ' selected' : ''}>NeoForge</option>
               <option value="Forge"${exportLoader === 'Forge' ? ' selected' : ''}>Forge</option>
               <option value="Quilt"${exportLoader === 'Quilt' ? ' selected' : ''}>Quilt</option>
             </select>
             <button type="button" class="btn btn-outline-accent btn-sm" data-action="perf-export-mrpack">
               <span data-icon="download"></span> ${escapeHtml(t('perf.exportBtn', { ver: activeVersion }))}
             </button>
           </div>`
        )}

        <section class="stats-grid fps-kpi-grid" aria-label="${escapeHtml(t('perf.fpsEstimateAria'))}">
          <article class="stat-card stat-card-accent">
            <div class="stat-icon"><span data-icon="gauge"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(t('perf.kpiFps', { tier: tierLabel(hardwareTier) }))}</div>
              <div class="stat-value tabular">${escapeHtml(String(estimate.estimatedFps))} FPS</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="bolt"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(t('perf.kpiGain'))}</div>
              <div class="stat-value tabular">${gainSign}${escapeHtml(String(estimate.fpsGainPercent))}% <small class="muted">${escapeHtml(t('perf.kpiBase', { fps: estimate.vanillaFps }))}</small></div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="clock"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(t('perf.kpiFrametime'))}</div>
              <div class="stat-value tabular">${escapeHtml(String(estimate.frameTimeMs))} ms <small class="muted">${escapeHtml(t('perf.kpiBefore', { ms: estimate.vanillaFrameTimeMs }))}</small></div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="ram"></span></div>
            <div>
              <div class="stat-label">${escapeHtml(t('perf.kpiRamSaved'))}</div>
              <div class="stat-value tabular">~${escapeHtml(String(estimate.ramSavedMb))} MB</div>
            </div>
          </article>
        </section>

        ${estimate.conflicts.length ? `
          <div class="catalog-warning perf-conflict-alert" role="alert">
            <strong>${escapeHtml(t('perf.conflictTitle'))}</strong>
            <span>${estimate.conflicts.map((c) => escapeHtml(c.label)).join(' · ')}. ${escapeHtml(t('perf.conflictHint'))}</span>
          </div>` : ''}

        ${warnings && warnings.length ? `
          <div class="catalog-warning perf-warning-alert" role="status">
            <strong>${escapeHtml(t('perf.warningTitle'))}</strong>
            <span>${warnings.map((w) => escapeHtml(w)).join(' · ')}</span>
          </div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('perf.profileTitle'))}</h3>
              <p>${escapeHtml(t('perf.profileSub'))}</p>
            </div>
            <div class="field tier-select-wrap">
              <label class="sr-only" for="perf-hardware-tier">${escapeHtml(t('perf.tierAria'))}</label>
              <select id="perf-hardware-tier">
                ${tierModes.map((id) => `
                  <option value="${id}"${hardwareMode === id ? ' selected' : ''}>${escapeHtml(t(`perf.tierOpt.${id}`))}</option>`).join('')}
              </select>
            </div>
          </div>

          ${device ? `
            <div class="device-probe-bar">
              <span><strong>${escapeHtml(t('perf.devDetected'))}</strong> ${escapeHtml(device.gpuName)}</span>
              <span><strong>${escapeHtml(t('perf.devCpu'))}</strong> ${escapeHtml(t('perf.devThreads', { count: device.cores }))}</span>
              <span><strong>${escapeHtml(t('perf.devRam'))}</strong> ${escapeHtml(ramText)}</span>
              <span><strong>${escapeHtml(t('perf.devScreen'))}</strong> ${escapeHtml(device.screenRes)}</span>
              <span><strong>${escapeHtml(t('perf.devTierUsed'))}</strong> ${escapeHtml(tierLabel(hardwareTier))}${escapeHtml(hardwareMode === 'auto' ? t('perf.devAuto') : t('perf.devManual'))}</span>
            </div>` : ''}

          <div class="preset-grid">
            ${presets.map((preset) => {
              const isActive = preset.id === presetId;
              const icon = preset.id === 'pvp' ? 'swords' : preset.id === 'potato' ? 'bolt' : preset.id === 'survival' ? 'shield' : 'cube';
              const presetName = t(`perf.preset.${preset.id}.name`, null, preset.name);
              const presetBadge = t(`perf.preset.${preset.id}.badge`, null, preset.badge);
              const presetDesc = t(`perf.preset.${preset.id}.desc`, null, preset.description);
              return `
                <button type="button" class="preset-card${isActive ? ' active' : ''}"
                        data-action="perf-apply-preset" data-preset="${escapeHtml(preset.id)}"
                        aria-pressed="${isActive}">
                  <div class="preset-card-top">
                    <span class="preset-icon" data-icon="${icon}"></span>
                    <span class="badge ${isActive ? 'badge-release' : ''}">${escapeHtml(isActive ? t('perf.presetActive') : presetBadge)}</span>
                  </div>
                  <strong>${escapeHtml(presetName)}</strong>
                  <small>${escapeHtml(presetDesc)}</small>
                </button>`;
            }).join('')}
          </div>
        </section>

        <section class="two-columns">
          <div class="panel">
            <div class="panel-head">
              <div>
                <h3>${escapeHtml(t('perf.videoTitle'))}</h3>
                <p>${escapeHtml(t('perf.videoSub'))}</p>
              </div>
            </div>
            <div class="form-stack">
              <div class="perf-slider-group">
                <div class="perf-slider-head">
                  <label for="perf-render-distance">${escapeHtml(t('perf.renderDist'))}</label>
                  <strong class="tabular" id="perf-render-val">${escapeHtml(t('perf.chunksUnit', { n: video.renderDistance }))}</strong>
                </div>
                <input type="range" id="perf-render-distance" min="2" max="24" step="1" value="${video.renderDistance}">
              </div>

              <div class="perf-slider-group">
                <div class="perf-slider-head">
                  <label for="perf-simulation-distance">${escapeHtml(t('perf.simDist'))}</label>
                  <strong class="tabular" id="perf-sim-val">${escapeHtml(t('perf.chunksUnit', { n: video.simulationDistance }))}</strong>
                </div>
                <input type="range" id="perf-simulation-distance" min="5" max="16" step="1" value="${Math.max(5, Number(video.simulationDistance) || 5)}">
              </div>

              <div class="perf-slider-group">
                <div class="perf-slider-head">
                  <label for="perf-max-fps">${escapeHtml(t('perf.maxFps'))}</label>
                  <strong class="tabular" id="perf-fps-val">${video.maxFps >= 260 ? escapeHtml(t('perf.unlimited')) : `${escapeHtml(String(video.maxFps))} FPS`}</strong>
                </div>
                <input type="range" id="perf-max-fps" min="60" max="260" step="10" value="${video.maxFps}">
              </div>

              <div class="loader-form-grid">
                <div class="field">
                  <label for="perf-graphics-mode">${escapeHtml(t('perf.graphics'))}</label>
                  <select id="perf-graphics-mode">
                    <option value="fast"${video.graphicsMode === 'fast' ? ' selected' : ''}>${escapeHtml(t('perf.gfxFast'))}</option>
                    <option value="fancy"${video.graphicsMode === 'fancy' ? ' selected' : ''}>${escapeHtml(t('perf.gfxFancy'))}</option>
                    <option value="fab"${video.graphicsMode === 'fab' ? ' selected' : ''}>${escapeHtml(t('perf.gfxFab'))}</option>
                  </select>
                </div>
                <div class="field">
                  <label for="perf-particles">${escapeHtml(t('perf.particles'))}</label>
                  <select id="perf-particles">
                    <option value="minimal"${video.particles === 'minimal' ? ' selected' : ''}>${escapeHtml(t('perf.partMinimal'))}</option>
                    <option value="decreased"${video.particles === 'decreased' ? ' selected' : ''}>${escapeHtml(t('perf.partDecreased'))}</option>
                    <option value="all"${video.particles === 'all' ? ' selected' : ''}>${escapeHtml(t('perf.partAll'))}</option>
                  </select>
                </div>
              </div>

              <div class="field">
                <label for="perf-clouds">${escapeHtml(t('perf.clouds'))}</label>
                <select id="perf-clouds">
                  <option value="off"${video.clouds === 'off' ? ' selected' : ''}>${escapeHtml(t('perf.cloudsOff'))}</option>
                  <option value="fast"${video.clouds === 'fast' ? ' selected' : ''}>${escapeHtml(t('perf.cloudsFast'))}</option>
                  <option value="fancy"${video.clouds === 'fancy' ? ' selected' : ''}>${escapeHtml(t('perf.cloudsFancy'))}</option>
                </select>
              </div>

              <div class="perf-toggles">
                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.fullbright'))}</strong>
                    <small>${escapeHtml(t('perf.flag.fullbrightSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="fullbright"${video.fullbright ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.rawMouse'))}</strong>
                    <small>${escapeHtml(t('perf.flag.rawMouseSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="rawMouseInput"${video.rawMouseInput !== false ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.noShadows'))}</strong>
                    <small>${escapeHtml(t('perf.flag.noShadowsSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="entityShadows" data-invert="true"${!video.entityShadows ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.noSmooth'))}</strong>
                    <small>${escapeHtml(t('perf.flag.noSmoothSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="smoothLighting" data-invert="true"${!video.smoothLighting ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.noVsync'))}</strong>
                    <small>${escapeHtml(t('perf.flag.noVsyncSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="vsync" data-invert="true"${!video.vsync ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.noBobbing'))}</strong>
                    <small>${escapeHtml(t('perf.flag.noBobbingSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="viewBobbing" data-invert="true"${video.viewBobbing === false ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.mipmapZero'))}</strong>
                    <small>${escapeHtml(t('perf.flag.mipmapZeroSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="mipmapZero"${video.mipmapZero ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.noEffects'))}</strong>
                    <small>${escapeHtml(t('perf.flag.noEffectsSub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="disableVisualEffects"${video.disableVisualEffects ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>${escapeHtml(t('perf.flag.noTelemetry'))}</strong>
                    <small>${escapeHtml(t('perf.flag.noTelemetrySub'))}</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="disableTelemetry"${network.disableTelemetry ? ' checked' : ''}>
                </label>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div>
                <h3>${escapeHtml(t('perf.jvmTitle'))}</h3>
                <p>${escapeHtml(t('perf.jvmSub'))}</p>
              </div>
              <button type="button" class="btn btn-xs" data-action="perf-copy-jvm">
                <span data-icon="copy"></span> ${escapeHtml(t('perf.copyJvm'))}
              </button>
            </div>

            <div class="perf-slider-group perf-ram-slider">
              <div class="perf-slider-head">
                <label for="perf-ram-mb">${escapeHtml(t('perf.ramSlider'))}</label>
                <strong class="tabular" id="perf-ram-val">${escapeHtml(String(Math.round((ramMb / 1024) * 10) / 10))} GB (${escapeHtml(String(ramMb))} MB)</strong>
              </div>
              <input type="range" id="perf-ram-mb" min="2048" max="12288" step="512" value="${Math.min(12288, Math.max(2048, ramMb))}">
            </div>

            <div class="gc-grid">
              ${gcIds.map((gcId) => `
                <button type="button" class="gc-card${jvm.gc === gcId ? ' active' : ''}"
                        data-action="perf-set-gc" data-gc="${gcId}">
                  <strong>${escapeHtml(t(`perf.gc.${gcId}.label`))}</strong>
                  <small>${escapeHtml(t(`perf.gc.${gcId}.hint`))}</small>
                </button>`).join('')}
            </div>

            <div class="perf-toggles perf-toggles-compact">
              <label class="perf-toggle-row">
                <div>
                  <strong>${escapeHtml(t('perf.flag.preTouch'))}</strong>
                  <small>${escapeHtml(t('perf.flag.preTouchSub'))}</small>
                </div>
                <input type="checkbox" class="perf-flag-input" data-flag="alwaysPreTouch"${jvm.alwaysPreTouch ? ' checked' : ''}>
              </label>
            </div>

            <div class="code-box">
              <div class="code-box-head">
                <span>${escapeHtml(t('perf.jvmActiveArgs'))}</span>
                <span class="tabular muted">${escapeHtml(String(jvm.ramGb))} GB Heap</span>
              </div>
              <pre>${escapeHtml(jvmArgs.join(' '))}</pre>
            </div>

            <div class="code-box">
              <div class="code-box-head">
                <span>${escapeHtml(t('perf.optionsPreview'))}</span>
                <button type="button" class="btn btn-xs" data-action="perf-copy-options">
                  <span data-icon="copy"></span> ${escapeHtml(t('perf.copyBtn'))}
                </button>
              </div>
              <pre>${escapeHtml(optionsTxt)}</pre>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('perf.modStackTitle', { count: estimate.activeModsCount }))}</h3>
              <p>${escapeHtml(t('perf.modStackSub'))}</p>
            </div>
          </div>
          <div class="mod-toggle-grid">
            ${mods.map((mod) => `
              <label class="mod-toggle-card${mod.enabled ? ' active' : ''}">
                <div class="mod-toggle-head">
                  <div>
                    <strong>${escapeHtml(mod.name)}</strong>
                    <span class="badge badge-historical">${escapeHtml(t(`perf.cat.${mod.category}`, null, mod.category))}</span>
                  </div>
                  <input type="checkbox" class="perf-mod-checkbox" data-mod-id="${escapeHtml(mod.id)}"${mod.enabled ? ' checked' : ''}>
                </div>
                <p>${escapeHtml(mod.description)}</p>
                <div class="mod-toggle-meta tabular">
                  <span>${escapeHtml(t('perf.boostPower', { pct: mod.fpsBoostPercent }))}</span>
                  <span>${escapeHtml(t('perf.savedRam', { mb: mod.ramSavedMb }))}</span>
                </div>
              </label>`).join('')}
          </div>
        </section>

        ${note(t('perf.note'))}
      </div>`;
  };
})();
