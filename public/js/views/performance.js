(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  const TIER_LABELS = Object.freeze({
    auto: 'Automático (Mi dispositivo detectado)',
    low: 'Simular: PC Modesto (4 GB / Integrados)',
    mid: 'Simular: Equipo Medio (8–16 GB / Dedicada)',
    high: 'Simular: Alta Gama (RTX / Ryzen / i7+)'
  });

  const TIER_NAMES = Object.freeze({
    low: 'PC Modesto',
    mid: 'Equipo Medio',
    high: 'Alta Gama'
  });

  const GC_OPTIONS = Object.freeze([
    { id: 'ZGC', label: 'ZGC Generacional', hint: 'Mínimas micropausas en PvP (Java 21+)' },
    { id: 'G1GC', label: 'G1GC Estándar', hint: 'Equilibrado y compatible desde Java 8+' },
    { id: 'Shenandoah', label: 'Shenandoah GC', hint: 'Baja latencia constante en mundos cargados' }
  ]);

  const CATEGORY_LABELS = Object.freeze({
    render: 'Render',
    cpu: 'CPU / Ticks',
    memory: 'Memoria',
    network: 'Red PvP'
  });

  Nexus.views.performance = function (state) {
    const engine = Nexus.perfEngine;
    if (!engine) {
      return '<div class="error-state"><h2>Motor de rendimiento no cargado</h2></div>';
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
      ? `${device.ramGb} GB${device.ramCappedByBrowser ? ' (tope web)' : ''}`
      : 'No expuesta por navegador';

    return `
      <div class="page">
        ${pageHead(
          'OPTIMIZACIÓN Y MODO PVP',
          'Rendimiento y Modo PvP',
          'Configura el perfil de combate, parámetros PvP en options.txt, recolector JVM y pila de mods FPS adaptados a tu equipo.',
          `<div class="header-actions perf-export-controls">
             <label class="sr-only" for="perf-export-loader">Loader para .mrpack</label>
             <select id="perf-export-loader" class="perf-loader-select" aria-label="Loader para .mrpack">
               <option value="Fabric"${exportLoader === 'Fabric' ? ' selected' : ''}>Fabric</option>
               <option value="NeoForge"${exportLoader === 'NeoForge' ? ' selected' : ''}>NeoForge</option>
             </select>
             <button type="button" class="btn btn-outline-accent btn-sm" data-action="perf-export-mrpack">
               <span data-icon="download"></span> Exportar .mrpack (${escapeHtml(activeVersion)})
             </button>
           </div>`
        )}

        <section class="stats-grid fps-kpi-grid" aria-label="Estimación de rendimiento">
          <article class="stat-card stat-card-accent">
            <div class="stat-icon"><span data-icon="gauge"></span></div>
            <div>
              <div class="stat-label">FPS Estimados (${escapeHtml(TIER_NAMES[hardwareTier] || 'Medio')})</div>
              <div class="stat-value tabular">${escapeHtml(String(estimate.estimatedFps))} FPS</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="bolt"></span></div>
            <div>
              <div class="stat-label">Ganancia vs Vanilla</div>
              <div class="stat-value tabular">${gainSign}${escapeHtml(String(estimate.fpsGainPercent))}% <small class="muted">(${escapeHtml(String(estimate.vanillaFps))} base)</small></div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="clock"></span></div>
            <div>
              <div class="stat-label">Frametime</div>
              <div class="stat-value tabular">${escapeHtml(String(estimate.frameTimeMs))} ms <small class="muted">(antes ${escapeHtml(String(estimate.vanillaFrameTimeMs))} ms)</small></div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-icon"><span data-icon="ram"></span></div>
            <div>
              <div class="stat-label">RAM Ahorrada</div>
              <div class="stat-value tabular">~${escapeHtml(String(estimate.ramSavedMb))} MB</div>
            </div>
          </article>
        </section>

        ${estimate.conflicts.length ? `
          <div class="catalog-warning perf-conflict-alert" role="alert">
            <strong>Conflicto de mods detectado:</strong>
            <span>${estimate.conflicts.map((c) => escapeHtml(c.label)).join(' · ')}. Desactiva uno para evitar cierres al iniciar.</span>
          </div>` : ''}

        ${warnings && warnings.length ? `
          <div class="catalog-warning perf-warning-alert" role="status">
            <strong>Avisos de compatibilidad:</strong>
            <span>${warnings.map((w) => escapeHtml(w)).join(' · ')}</span>
          </div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Perfil de juego rápido</h3>
              <p>Cambia al instante entre Modo PvP Competitivo, Ultra FPS para PC modesto, Survival o Vanilla.</p>
            </div>
            <div class="field tier-select-wrap">
              <label class="sr-only" for="perf-hardware-tier">Gama de hardware para estimación</label>
              <select id="perf-hardware-tier">
                ${Object.entries(TIER_LABELS).map(([id, label]) => `
                  <option value="${id}"${hardwareMode === id ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
              </select>
            </div>
          </div>

          ${device ? `
            <div class="device-probe-bar">
              <span><strong>Dispositivo detectado:</strong> ${escapeHtml(device.gpuName)}</span>
              <span><strong>CPU:</strong> ${escapeHtml(String(device.cores))} hilos</span>
              <span><strong>RAM:</strong> ${escapeHtml(ramText)}</span>
              <span><strong>Pantalla:</strong> ${escapeHtml(device.screenRes)}</span>
              <span><strong>Gama usada:</strong> ${escapeHtml(TIER_NAMES[hardwareTier] || hardwareTier)}${hardwareMode === 'auto' ? ' (Auto)' : ' (Manual)'}</span>
            </div>` : ''}

          <div class="preset-grid">
            ${presets.map((preset) => {
              const isActive = preset.id === presetId;
              const icon = preset.id === 'pvp' ? 'swords' : preset.id === 'potato' ? 'bolt' : preset.id === 'survival' ? 'shield' : 'cube';
              return `
                <button type="button" class="preset-card${isActive ? ' active' : ''}"
                        data-action="perf-apply-preset" data-preset="${escapeHtml(preset.id)}"
                        aria-pressed="${isActive}">
                  <div class="preset-card-top">
                    <span class="preset-icon" data-icon="${icon}"></span>
                    <span class="badge ${isActive ? 'badge-release' : ''}">${isActive ? 'Activo' : escapeHtml(preset.badge)}</span>
                  </div>
                  <strong>${escapeHtml(preset.name)}</strong>
                  <small>${escapeHtml(preset.description)}</small>
                </button>`;
            }).join('')}
          </div>
        </section>

        <section class="two-columns">
          <div class="panel">
            <div class="panel-head">
              <div>
                <h3>Opciones PvP y vídeo (options.txt)</h3>
                <p>Ajustes orientados a claridad visual, menor latencia de entrada y fluidez.</p>
              </div>
            </div>
            <div class="form-stack">
              <div class="perf-slider-group">
                <div class="perf-slider-head">
                  <label for="perf-render-distance">Distancia de renderizado</label>
                  <strong class="tabular" id="perf-render-val">${escapeHtml(String(video.renderDistance))} chunks</strong>
                </div>
                <input type="range" id="perf-render-distance" min="2" max="24" step="1" value="${video.renderDistance}">
              </div>

              <div class="perf-slider-group">
                <div class="perf-slider-head">
                  <label for="perf-simulation-distance">Distancia de simulación</label>
                  <strong class="tabular" id="perf-sim-val">${escapeHtml(String(video.simulationDistance))} chunks</strong>
                </div>
                <input type="range" id="perf-simulation-distance" min="4" max="16" step="1" value="${video.simulationDistance}">
              </div>

              <div class="perf-slider-group">
                <div class="perf-slider-head">
                  <label for="perf-max-fps">Límite máximo de FPS</label>
                  <strong class="tabular" id="perf-fps-val">${video.maxFps >= 260 ? 'Ilimitado' : `${escapeHtml(String(video.maxFps))} FPS`}</strong>
                </div>
                <input type="range" id="perf-max-fps" min="60" max="260" step="10" value="${video.maxFps}">
              </div>

              <div class="loader-form-grid">
                <div class="field">
                  <label for="perf-graphics-mode">Gráficos</label>
                  <select id="perf-graphics-mode">
                    <option value="fast"${video.graphicsMode === 'fast' ? ' selected' : ''}>Rápidos (Fast — PvP)</option>
                    <option value="fancy"${video.graphicsMode === 'fancy' ? ' selected' : ''}>Detallados (Fancy)</option>
                    <option value="fab"${video.graphicsMode === 'fab' ? ' selected' : ''}>Fabulosos (Fabulous)</option>
                  </select>
                </div>
                <div class="field">
                  <label for="perf-particles">Partículas</label>
                  <select id="perf-particles">
                    <option value="minimal"${video.particles === 'minimal' ? ' selected' : ''}>Mínimas (PvP limpio)</option>
                    <option value="decreased"${video.particles === 'decreased' ? ' selected' : ''}>Reducidas</option>
                    <option value="all"${video.particles === 'all' ? ' selected' : ''}>Todas</option>
                  </select>
                </div>
              </div>

              <div class="field">
                <label for="perf-clouds">Nubes del cielo</label>
                <select id="perf-clouds">
                  <option value="off"${video.clouds === 'off' ? ' selected' : ''}>Desactivadas (Máximo PvP / FPS)</option>
                  <option value="fast"${video.clouds === 'fast' ? ' selected' : ''}>Planas (Fast)</option>
                  <option value="fancy"${video.clouds === 'fancy' ? ' selected' : ''}>Volumétricas (Fancy)</option>
                </select>
              </div>

              <div class="perf-toggles">
                <label class="perf-toggle-row">
                  <div>
                    <strong>Fullbright competitivo (Gamma 10.0)</strong>
                    <small>Visibilidad total en cuevas y mapas oscuros de PvP sin antorchas.</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="fullbright"${video.fullbright ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>Entrada directa de ratón (Raw Input)</strong>
                    <small>Elimina aceleración del sistema operativo para puntería 1:1 en combates.</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="rawMouseInput"${video.rawMouseInput !== false ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>Desactivar sombras de entidades</strong>
                    <small>Ahorra llamadas de renderizado en zonas con muchos jugadores.</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="entityShadows" data-invert="true"${!video.entityShadows ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>Desactivar iluminación suave (AO OFF)</strong>
                    <small>Gana hasta +10% de FPS y mejora el contraste de bloques en PvP.</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="smoothLighting" data-invert="true"${!video.smoothLighting ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>Desactivar VSync</strong>
                    <small>Evita tope a 60 Hz y reduce el retraso entre clic y pantalla.</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="vsync" data-invert="true"${!video.vsync ? ' checked' : ''}>
                </label>

                <label class="perf-toggle-row">
                  <div>
                    <strong>Bloquear telemetría Snooper</strong>
                    <small>Evita envío en segundo plano de estadísticas durante partidas.</small>
                  </div>
                  <input type="checkbox" class="perf-flag-input" data-flag="disableTelemetry"${network.disableTelemetry ? ' checked' : ''}>
                </label>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div>
                <h3>Recolector de memoria y flags JVM</h3>
                <p>Controla la RAM y los argumentos reales que recibe Java al arrancar el perfil.</p>
              </div>
              <button type="button" class="btn btn-xs" data-action="perf-copy-jvm">
                <span data-icon="copy"></span> Copiar JVM
              </button>
            </div>

            <div class="perf-slider-group perf-ram-slider">
              <div class="perf-slider-head">
                <label for="perf-ram-mb">Memoria RAM dedicada (-Xmx / -Xms)</label>
                <strong class="tabular" id="perf-ram-val">${escapeHtml(String(Math.round((ramMb / 1024) * 10) / 10))} GB (${escapeHtml(String(ramMb))} MB)</strong>
              </div>
              <input type="range" id="perf-ram-mb" min="2048" max="12288" step="512" value="${Math.min(12288, Math.max(2048, ramMb))}">
            </div>

            <div class="gc-grid">
              ${GC_OPTIONS.map((opt) => `
                <button type="button" class="gc-card${jvm.gc === opt.id ? ' active' : ''}"
                        data-action="perf-set-gc" data-gc="${opt.id}">
                  <strong>${escapeHtml(opt.label)}</strong>
                  <small>${escapeHtml(opt.hint)}</small>
                </button>`).join('')}
            </div>

            <div class="perf-toggles perf-toggles-compact">
              <label class="perf-toggle-row">
                <div>
                  <strong>Pre-asignar RAM al arranque (-XX:+AlwaysPreTouch)</strong>
                  <small>Evita micro-cortes durante los primeros minutos de PvP.</small>
                </div>
                <input type="checkbox" class="perf-flag-input" data-flag="alwaysPreTouch"${jvm.alwaysPreTouch ? ' checked' : ''}>
              </label>
            </div>

            <div class="code-box">
              <div class="code-box-head">
                <span>Argumentos JVM activos</span>
                <span class="tabular muted">${escapeHtml(String(jvm.ramGb))} GB Heap</span>
              </div>
              <pre>${escapeHtml(jvmArgs.join(' '))}</pre>
            </div>

            <div class="code-box">
              <div class="code-box-head">
                <span>Vista previa de options.txt</span>
                <button type="button" class="btn btn-xs" data-action="perf-copy-options">
                  <span data-icon="copy"></span> Copiar
                </button>
              </div>
              <pre>${escapeHtml(optionsTxt)}</pre>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Pila de mods FPS y PvP (${escapeHtml(String(estimate.activeModsCount))} activos)</h3>
              <p>Selecciona qué optimizaciones incluir al exportar un paquete .mrpack verificado de Modrinth.</p>
            </div>
          </div>
          <div class="mod-toggle-grid">
            ${mods.map((mod) => `
              <label class="mod-toggle-card${mod.enabled ? ' active' : ''}">
                <div class="mod-toggle-head">
                  <div>
                    <strong>${escapeHtml(mod.name)}</strong>
                    <span class="badge badge-historical">${escapeHtml(CATEGORY_LABELS[mod.category] || mod.category)}</span>
                  </div>
                  <input type="checkbox" class="perf-mod-checkbox" data-mod-id="${escapeHtml(mod.id)}"${mod.enabled ? ' checked' : ''}>
                </div>
                <p>${escapeHtml(mod.description)}</p>
                <div class="mod-toggle-meta tabular">
                  <span>+${escapeHtml(String(mod.fpsBoostPercent))}% potencia</span>
                  <span>-${escapeHtml(String(mod.ramSavedMb))} MB RAM</span>
                </div>
              </label>`).join('')}
          </div>
        </section>

        ${note('En el navegador las cifras de FPS son una estimación calibrada según tu GPU/CPU/RAM detectadas (los navegadores limitan ciertos datos exactos por privacidad). Para aplicar los mods reales en tu PC usa «Exportar .mrpack» e impórtalo con Modrinth / Prism / Fabric.')}
      </div>`;
  };
})();
