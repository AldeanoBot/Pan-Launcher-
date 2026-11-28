(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, requiredJavaForVersion } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

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
            <strong>${escapeHtml(progress.installationId || progress.versionId || t('inst.title'))}</strong>
            <span class="install-phase">${escapeHtml(progress.phaseLabel || t('versions.progressProcessing'))}</span>
          </div>
          ${active
            ? `<button type="button" class="btn btn-xs btn-danger" data-action="installation-cancel" data-id="${escapeHtml(progress.installationId)}">${escapeHtml(t('versions.cancel'))}</button>`
            : `<span class="badge ${isError ? 'badge-error' : 'badge-installed'}">${escapeHtml(String(pct))}%</span>`}
        </div>
        <progress class="progress-track" max="100" value="${pct}"></progress>
        <div class="install-progress-stats">
          <span>${escapeHtml(t('versions.progressPct', { pct }))}</span>
          ${progress.filesTotal ? `<span>${escapeHtml(t('versions.progressFiles', { done: progress.filesDone || 0, total: progress.filesTotal }))}</span>` : ''}
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
          <h3>${escapeHtml(t('inst.emptyTitle'))}</h3>
          <p>${escapeHtml(t('inst.emptySub'))}</p>
          <button type="button" class="btn btn-primary" data-action="navigate" data-view="newInstall">
            <span data-icon="plus"></span> ${escapeHtml(t('inst.createFirstBtn'))}
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
                  <span class="badge ${isReady ? 'badge-installed' : 'badge-snapshot'}">${escapeHtml(isReady ? t('inst.ready') : (inst.installStatus || t('inst.pending')))}</span>
                  ${isActive ? `<span class="badge badge-latest">${escapeHtml(t('inst.activeBadge'))}</span>` : ''}
                </div>
              </div>

              <div class="installation-meta tabular">
                <span><strong>${escapeHtml(t('inst.metaGame'))}</strong> ${escapeHtml(inst.gameVersion)}</span>
                <span><strong>${escapeHtml(t('inst.metaRam'))}</strong> ${escapeHtml(formatRam(inst.minRamMb))} – ${escapeHtml(formatRam(inst.ramMb))}</span>
                <span><strong>${escapeHtml(t('inst.metaJava'))}</strong> ${inst.javaPath ? escapeHtml(inst.javaPath) : escapeHtml(t('inst.javaAuto', { major: reqJava }))}</span>
                <span class="installation-path"><strong>${escapeHtml(t('inst.metaDir'))}</strong> ${escapeHtml(inst.gameDir || '—')}</span>
              </div>

              <div class="installation-edit-grid">
                <div class="field">
                  <label>${escapeHtml(t('inst.fieldName'))}</label>
                  <input type="text" maxlength="40" data-install-field="name" data-id="${escapeHtml(inst.id)}" value="${escapeHtml(inst.name)}">
                </div>
                <div class="field">
                  <label>${escapeHtml(t('inst.fieldMaxRam'))}</label>
                  <input type="number" min="1024" max="16384" step="512" data-install-field="ramMb" data-id="${escapeHtml(inst.id)}" value="${escapeHtml(String(inst.ramMb))}">
                </div>
                <div class="field">
                  <label>${escapeHtml(t('inst.fieldMinRam'))}</label>
                  <input type="number" min="256" max="8192" step="256" data-install-field="minRamMb" data-id="${escapeHtml(inst.id)}" value="${escapeHtml(String(inst.minRamMb))}">
                </div>
                <div class="field">
                  <label>${escapeHtml(t('inst.fieldJava'))}</label>
                  <input type="text" data-install-field="javaPath" data-id="${escapeHtml(inst.id)}" placeholder="${escapeHtml(t('inst.javaAuto', { major: reqJava }))}" value="${escapeHtml(inst.javaPath || '')}">
                </div>
              </div>

              <div class="installation-actions">
                ${isReady
                  ? `<button type="button" class="btn btn-primary btn-sm" data-action="installation-play" data-id="${escapeHtml(inst.id)}">
                       <span data-icon="play"></span> ${escapeHtml(t('inst.playNow'))}
                     </button>`
                  : isInstalling
                    ? `<button type="button" class="btn btn-danger btn-sm" data-action="installation-cancel" data-id="${escapeHtml(inst.id)}">${escapeHtml(t('versions.cancel'))}</button>`
                    : `<button type="button" class="btn btn-primary btn-sm" data-action="installation-start" data-id="${escapeHtml(inst.id)}" ${activeJob ? 'disabled' : ''}>
                         <span data-icon="download"></span> ${escapeHtml(t('inst.installFiles'))}
                       </button>`}
                <button type="button" class="btn btn-sm" data-action="installation-select" data-id="${escapeHtml(inst.id)}" ${isActive ? 'disabled' : ''}>
                  ${escapeHtml(isActive ? t('inst.activeInHome') : t('inst.select'))}
                </button>
                <button type="button" class="btn btn-sm" data-action="installation-folders" data-id="${escapeHtml(inst.id)}">
                  <span data-icon="folder"></span> ${escapeHtml(t('inst.foldersBtn'))}
                </button>
                <button type="button" class="btn btn-sm" data-action="installation-save" data-id="${escapeHtml(inst.id)}">${escapeHtml(t('inst.saveBtn'))}</button>
                ${isReady ? `
                  <button type="button" class="btn btn-sm" data-action="options-preset-apply" data-id="${escapeHtml(inst.id)}">
                    ${escapeHtml(presetStatus && presetStatus.applied ? t('inst.reapplyOpts') : t('inst.applyOpts'))}
                  </button>` : ''}
                ${presetStatus && presetStatus.restorable ? `
                  <button type="button" class="btn btn-sm" data-action="options-preset-restore" data-id="${escapeHtml(inst.id)}">${escapeHtml(t('inst.restoreOpts'))}</button>` : ''}
                <button type="button" class="btn btn-sm btn-danger" data-action="installation-remove" data-id="${escapeHtml(inst.id)}">
                  <span data-icon="trash"></span> ${escapeHtml(t('inst.removeBtn'))}
                </button>
              </div>
            </article>`;
        }).join('')}
      </div>`;
  };

  Nexus.views.installations = function (state) {
    const activeLegacy = !(state.config && state.config.launch && state.config.launch.activeInstallationId);
    const ver = state.config && state.config.launch ? state.config.launch.versionId : '—';

    return `
      <div class="page">
        ${pageHead(
          t('inst.eyebrow'),
          t('inst.title'),
          t('inst.sub'),
          `<div class="header-actions">
             <button type="button" class="btn btn-primary btn-sm" data-action="navigate" data-view="newInstall">
               <span data-icon="plus"></span> ${escapeHtml(t('inst.newBtn'))}
             </button>
             <button type="button" class="btn btn-sm" data-action="installation-legacy" ${activeLegacy ? 'disabled' : ''}>
               ${escapeHtml(t('inst.directModeBtn', { ver }))}
             </button>
             <button type="button" class="btn btn-sm" data-action="installation-refresh">
               <span data-icon="refresh"></span> ${escapeHtml(t('inst.refreshBtn'))}
             </button>
           </div>`
        )}

        <div id="installation-progress-panel">${Nexus.views.installationProgress(state)}</div>
        <div id="installation-grid">${Nexus.views.installationGrid(state)}</div>

        ${note(t('inst.note'))}
      </div>`;
  };
})();
