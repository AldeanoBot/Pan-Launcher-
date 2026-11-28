(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  Nexus.views.loaderProgress = function (state) {
    const progress = state.loaders && state.loaders.progress;
    if (!progress) return '';
    const active = Boolean(state.loaders && state.loaders.status && state.loaders.status.active);
    const isError = progress.phase === 'error';
    const pct = Math.max(0, Math.min(100, Number(progress.percent) || 0));

    return `
      <section class="install-progress${isError ? ' is-error' : ''}">
        <div class="install-progress-head">
          <div>
            <strong>${escapeHtml(progress.versionId)}</strong>
            <span class="install-phase">${escapeHtml(progress.phaseLabel || t('versions.progressProcessing'))}</span>
          </div>
          ${active
            ? `<button type="button" class="btn btn-xs btn-danger" data-action="loader-cancel">${escapeHtml(t('versions.cancel'))}</button>`
            : `<span class="badge ${isError ? 'badge-error' : 'badge-installed'}">${escapeHtml(String(pct))}%</span>`}
        </div>
        <progress class="progress-track" max="100" value="${pct}"></progress>
        <div class="install-progress-stats">
          <span>${escapeHtml(t('versions.progressPct', { pct }))}</span>
          ${progress.filesTotal ? `<span>${escapeHtml(t('versions.progressFiles', { done: progress.filesDone || 0, total: progress.filesTotal }))}</span>` : ''}
          ${progress.total ? `<span>${escapeHtml(formatBytes(progress.downloaded))} / ${escapeHtml(formatBytes(progress.total))}</span>` : ''}
        </div>
        ${progress.message ? `<p class="install-message">${escapeHtml(progress.message)}</p>` : ''}
      </section>`;
  };

  Nexus.views.renderLoaderPage = function (state, activeView, kind) {
    const loaders = state.loaders || {};
    const installedBase = (state.installed || []).filter((id) => {
      return !(loaders.status && loaders.status.installed || []).some((p) => p.id === id);
    });
    const baseOptions = installedBase.length
      ? installedBase
      : (state.versions || []).filter((v) => v.type === 'release').slice(0, 12).map((v) => v.id);
    if (!loaders.base && baseOptions.length) {
      loaders.base = baseOptions[0];
    }

    const catalog = loaders.versions || [];
    const limit = loaders.versionLimit || 48;
    const visibleCatalog = catalog.slice(0, limit);
    const installedProfiles = (loaders.status && loaders.status.installed || []).filter((p) => {
      if (kind === 'fabric') return p.loader === 'fabric';
      return p.loader === 'forge' || p.loader === 'neoforge' || p.loader === 'quilt';
    });
    const activeVersionId = state.config && state.config.launch ? state.config.launch.versionId : '';

    const activeModLoader = kind === 'fabric'
      ? 'Fabric'
      : (loaders.loader === 'neoforge' ? 'NeoForge' : loaders.loader === 'quilt' ? 'Quilt' : 'Forge');

    return `
      <div class="page">
        ${settingsTabs(activeView)}
        ${pageHead(
          t('loaders.eyebrow'),
          kind === 'fabric' ? t('loaders.fabricTitle') : t('loaders.forgeTitle'),
          kind === 'fabric' ? t('loaders.fabricSub') : t('loaders.forgeSub'),
          kind !== 'fabric'
            ? `<div class="loader-switch">
                 <button type="button" class="btn btn-sm ${loaders.loader !== 'neoforge' && loaders.loader !== 'quilt' ? 'btn-primary' : ''}"
                         data-action="loader-switch" data-loader="forge">Forge</button>
                 <button type="button" class="btn btn-sm ${loaders.loader === 'neoforge' ? 'btn-primary' : ''}"
                         data-action="loader-switch" data-loader="neoforge">NeoForge</button>
                 <button type="button" class="btn btn-sm ${loaders.loader === 'quilt' ? 'btn-primary' : ''}"
                         data-action="loader-switch" data-loader="quilt">Quilt</button>
               </div>`
            : ''
        )}

        <div id="loader-progress-panel">${Nexus.views.loaderProgress(state)}</div>

        ${loaders.versionError ? `<div class="catalog-warning">${escapeHtml(loaders.versionError)}</div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('loaders.installTitle', { loader: activeModLoader }))}</h3>
              <p>${escapeHtml(t('loaders.installSub'))}</p>
            </div>
            <button type="button" class="btn btn-xs" data-action="loader-refresh" data-loader="${escapeHtml(kind)}">
              <span data-icon="refresh"></span> ${escapeHtml(t('loaders.refresh'))}
            </button>
          </div>

          <div class="loader-form-grid">
            <div class="field">
              <label for="loader-base">${escapeHtml(t('loaders.baseLabel'))}</label>
              <select id="loader-base" data-loader="${escapeHtml(kind)}">
                ${baseOptions.length
                  ? baseOptions.map((ver) => `<option value="${escapeHtml(ver)}"${loaders.base === ver ? ' selected' : ''}>${escapeHtml(ver)}</option>`).join('')
                  : `<option value="">${escapeHtml(t('loaders.noVanilla'))}</option>`}
              </select>
            </div>

            <div class="field">
              <label for="loader-version">${escapeHtml(t('loaders.verLabel', { vis: visibleCatalog.length, total: catalog.length }))}</label>
              <select id="loader-version" ${loaders.versionState === 'loading' || !visibleCatalog.length ? 'disabled' : ''}>
                ${loaders.versionState === 'loading'
                  ? `<option value="">${escapeHtml(t('loaders.loading'))}</option>`
                  : visibleCatalog.length
                    ? visibleCatalog.map((item) => `<option value="${escapeHtml(item.id)}"${loaders.selected === item.id ? ' selected' : ''}>${escapeHtml(item.label)}${item.stable ? ` (${escapeHtml(t('loaderBar.stable'))})` : ''}</option>`).join('')
                    : `<option value="">${escapeHtml(t('loaders.noneCompat'))}</option>`}
              </select>
            </div>

            <div class="loader-form-actions">
              <button type="button" class="btn btn-primary" data-action="loader-install" data-loader="${escapeHtml(kind)}"
                      ${!loaders.base || !loaders.selected || (loaders.status && loaders.status.active) ? 'disabled' : ''}>
                ${escapeHtml(t('loaders.installBtn'))}
              </button>
              ${catalog.length > visibleCatalog.length
                ? `<button type="button" class="btn btn-sm" data-action="loader-show-more">${escapeHtml(t('loaders.showMore'))}</button>`
                : ''}
            </div>
          </div>

          <div class="loader-profile-list">
            ${installedProfiles.length
              ? installedProfiles.map((prof) => {
                  const isActive = prof.id === activeVersionId;
                  return `
                    <div class="loader-profile-row${isActive ? ' active' : ''}">
                      <div>
                        <strong>${escapeHtml(prof.id)}</strong>
                        <small>${escapeHtml(prof.loader)} ${escapeHtml(prof.loaderVersion || '')} · Minecraft ${escapeHtml(prof.gameVersion || '')}</small>
                      </div>
                      <button type="button" class="btn btn-sm ${isActive ? 'btn-primary' : ''}"
                              data-action="loader-select-profile" data-version-id="${escapeHtml(prof.id)}">
                        ${escapeHtml(isActive ? t('versions.active') : t('loaders.useProfile'))}
                      </button>
                    </div>`;
                }).join('')
              : `<p class="muted">${escapeHtml(t('loaders.noneInstalled'))}</p>`}
          </div>
        </section>

        ${note(t('loaders.note'))}
      </div>`;
  };
})();
