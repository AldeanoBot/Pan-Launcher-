(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, requiredJavaForVersion } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.installationProgress = function (state) {
    const progress = state.installations && state.installations.progress;
    if (!progress) return '';
    const active = Boolean(state.installations && state.installations.status && state.installations.status.active);
    const isError = progress.phase === 'error';
    const pct = Math.max(0, Math.min(100, Number(progress.percent) || 0));

    return `
      <section class="install-progress install-progress-panel${isError ? ' is-error' : ''}">
        <div class="install-progress-head">
          <div>
            <strong>${escapeHtml(progress.installationId || progress.versionId || 'Instalación')}</strong>
            <span class="install-phase">${escapeHtml(progress.phaseLabel || 'Procesando')}</span>
          </div>
          ${active
            ? `<button type="button" class="btn btn-xs btn-danger" data-action="installation-cancel" data-id="${escapeHtml(progress.installationId)}">Cancelar</button>`
            : `<span class="badge ${isError ? 'badge-error' : 'badge-installed'}">${escapeHtml(String(pct))}%</span>`}
        </div>
        <progress class="progress-track" max="100" value="${pct}"></progress>
        <div class="install-progress-stats">
          <span>Progreso: ${escapeHtml(String(pct))}%</span>
          ${progress.filesTotal ? `<span>Archivos: ${escapeHtml(String(progress.filesDone || 0))} / ${escapeHtml(String(progress.filesTotal))}</span>` : ''}
        </div>
        ${progress.message ? `<p class="install-message">${escapeHtml(progress.message)}</p>` : ''}
      </section>`;
  };

  Nexus.views.installationGrid = function (state) {
    const list = (state.installations && state.installations.list) || [];
    const activeId = state.config && state.config.launch ? state.config.launch.activeInstallationId : null;
    const activeJob = state.installations && state.installations.status && state.installations.status.active;
    const presetStatuses = (state.performance && state.performance.optionsPresets) || [];

    if (!list.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="layers"></span>
          <h3>Todavía no tienes instalaciones aisladas</h3>
          <p>Crea una instalación para separar mods, mundos, Java y configuración entre versiones (ej. 26.3 y 1.21.4).</p>
          <button type="button" class="btn btn-primary" data-action="navigate" data-view="newInstall">
            <span data-icon="plus"></span> Crear primera instalación
          </button>
        </div>`;
    }

    return `
      <div class="installation-list">
        ${list.map((inst) => {
          const isActive = inst.id === activeId;
          const isInstalling = Boolean(activeJob && activeJob.installationId === inst.id);
          const isReady = inst.installStatus === 'ready';
          const reqJava = requiredJavaForVersion(inst.gameVersion);
          const presetStatus = presetStatuses.find((p) => p.installationId === inst.id);

          return `
            <article class="installation-card${isActive ? ' active' : ''}">
              <div class="installation-card-head">
                <div>
                  <h3>${escapeHtml(inst.name)}</h3>
                  <p class="installation-id">${escapeHtml(inst.versionId)} · Java ${reqJava}+</p>
                </div>
                <div class="installation-badges">
                  <span class="badge badge-release">${escapeHtml(inst.loader || 'vanilla')}</span>
                  <span class="badge ${isReady ? 'badge-installed' : 'badge-snapshot'}">${isReady ? 'Lista' : escapeHtml(inst.installStatus || 'pendiente')}</span>
                  ${isActive ? '<span class="badge badge-latest">Activa</span>' : ''}
                </div>
              </div>

              <div class="installation-meta tabular">
                <span><strong>Juego:</strong> ${escapeHtml(inst.gameVersion)}</span>
                <span><strong>RAM:</strong> ${escapeHtml(formatRam(inst.minRamMb))} – ${escapeHtml(formatRam(inst.ramMb))}</span>
                <span><strong>Java:</strong> ${inst.javaPath ? escapeHtml(inst.javaPath) : `Auto (Java ${reqJava})`}</span>
                <span class="installation-path"><strong>Directorio:</strong> ${escapeHtml(inst.gameDir || '—')}</span>
              </div>

              <div class="installation-edit-grid">
                <div class="field">
                  <label>Nombre</label>
                  <input type="text" maxlength="40" data-install-field="name" data-id="${escapeHtml(inst.id)}" value="${escapeHtml(inst.name)}">
                </div>
                <div class="field">
                  <label>RAM máx. (MB)</label>
                  <input type="number" min="1024" max="16384" step="512" data-install-field="ramMb" data-id="${escapeHtml(inst.id)}" value="${escapeHtml(String(inst.ramMb))}">
                </div>
                <div class="field">
                  <label>RAM inicial (MB)</label>
                  <input type="number" min="256" max="8192" step="256" data-install-field="minRamMb" data-id="${escapeHtml(inst.id)}" value="${escapeHtml(String(inst.minRamMb))}">
                </div>
                <div class="field">
                  <label>Ruta de Java (opcional)</label>
                  <input type="text" data-install-field="javaPath" data-id="${escapeHtml(inst.id)}" placeholder="Auto (Java ${reqJava})" value="${escapeHtml(inst.javaPath || '')}">
                </div>
              </div>

              <div class="installation-actions">
                ${isReady
                  ? `<button type="button" class="btn btn-primary btn-sm" data-action="installation-play" data-id="${escapeHtml(inst.id)}">
                       <span data-icon="play"></span> Jugar ahora
                     </button>`
                  : isInstalling
                    ? `<button type="button" class="btn btn-danger btn-sm" data-action="installation-cancel" data-id="${escapeHtml(inst.id)}">Cancelar</button>`
                    : `<button type="button" class="btn btn-primary btn-sm" data-action="installation-start" data-id="${escapeHtml(inst.id)}" ${activeJob ? 'disabled' : ''}>
                         <span data-icon="download"></span> Instalar archivos
                       </button>`}
                <button type="button" class="btn btn-sm" data-action="installation-select" data-id="${escapeHtml(inst.id)}" ${isActive ? 'disabled' : ''}>
                  ${isActive ? 'Activa en Inicio' : 'Seleccionar'}
                </button>
                <button type="button" class="btn btn-sm" data-action="installation-folders" data-id="${escapeHtml(inst.id)}">
                  <span data-icon="folder"></span> Carpetas
                </button>
                <button type="button" class="btn btn-sm" data-action="installation-save" data-id="${escapeHtml(inst.id)}">Guardar cambios</button>
                ${isReady ? `
                  <button type="button" class="btn btn-sm" data-action="options-preset-apply" data-id="${escapeHtml(inst.id)}">
                    ${presetStatus && presetStatus.applied ? 'Reaplicar FPS options.txt' : 'Aplicar FPS options.txt'}
                  </button>` : ''}
                ${presetStatus && presetStatus.restorable ? `
                  <button type="button" class="btn btn-sm" data-action="options-preset-restore" data-id="${escapeHtml(inst.id)}">Restaurar options.txt</button>` : ''}
                <button type="button" class="btn btn-sm btn-danger" data-action="installation-remove" data-id="${escapeHtml(inst.id)}">
                  <span data-icon="trash"></span> Eliminar
                </button>
              </div>
            </article>`;
        }).join('')}
      </div>`;
  };

  Nexus.views.installations = function (state) {
    const activeLegacy = !(state.config && state.config.launch && state.config.launch.activeInstallationId);

    return `
      <div class="page">
        ${pageHead(
          'PERFILES AISLADOS',
          'Mis instalaciones',
          'Cada instalación usa su propia carpeta .minecraft para evitar conflictos de mods, configuraciones o versiones de Java.',
          `<div class="header-actions">
             <button type="button" class="btn btn-primary btn-sm" data-action="navigate" data-view="newInstall">
               <span data-icon="plus"></span> Nueva instalación
             </button>
             <button type="button" class="btn btn-sm" data-action="installation-legacy" ${activeLegacy ? 'disabled' : ''}>
               Usar modo directo (${escapeHtml(state.config && state.config.launch ? state.config.launch.versionId : '—')})
             </button>
             <button type="button" class="btn btn-sm" data-action="installation-refresh">
               <span data-icon="refresh"></span> Actualizar
             </button>
           </div>`
        )}

        <div id="installation-progress-panel">${Nexus.views.installationProgress(state)}</div>
        <div id="installation-grid">${Nexus.views.installationGrid(state)}</div>

        ${note('Las instalaciones aisladas mantienen cada mundo y paquete de mods separado, al estilo de los launchers modernos.')}
      </div>`;
  };
})();
