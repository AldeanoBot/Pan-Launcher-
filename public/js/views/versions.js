(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, formatDate, pageHead, requiredJavaForVersion } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  function typeLabel(type) {
    const known = ['release', 'snapshot', 'old_beta', 'old_alpha'];
    if (known.includes(type)) return t(`versions.type.${type}`);
    return type;
  }

  function typeBadgeClass(type) {
    if (type === 'release') return 'badge-release';
    if (type === 'snapshot') return 'badge-snapshot';
    if (type === 'old_beta') return 'badge-beta';
    if (type === 'old_alpha') return 'badge-alpha';
    return 'badge-historical';
  }

  Nexus.views.installProgress = function (state) {
    const progress = state.install && state.install.progress;
    if (!progress) return '';
    const active = Boolean(state.install && state.install.active);
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
            ? `<button type="button" class="btn btn-xs btn-danger" data-action="cancel-install" data-version-id="${escapeHtml(progress.versionId)}">${escapeHtml(t('versions.cancel'))}</button>`
            : `<span class="badge ${isError ? 'badge-error' : 'badge-installed'}">${escapeHtml(pct)}%</span>`}
        </div>
        <progress class="progress-track" max="100" value="${pct}"></progress>
        <div class="install-progress-stats">
          <span>${escapeHtml(t('versions.progressPct', { pct }))}</span>
          ${progress.filesTotal ? `<span>${escapeHtml(t('versions.progressFiles', { done: progress.filesDone || 0, total: progress.filesTotal }))}</span>` : ''}
          ${progress.total ? `<span>${escapeHtml(t('versions.progressDownload', { down: formatBytes(progress.downloaded), total: formatBytes(progress.total) }))}</span>` : ''}
          ${progress.speed ? `<span>${escapeHtml(t('versions.progressSpeed', { speed: formatBytes(progress.speed) }))}</span>` : ''}
        </div>
        ${progress.message ? `<p class="install-message">${escapeHtml(progress.message)}</p>` : ''}
      </section>`;
  };

  function filteredVersions(state) {
    const ui = state.ui || { search: '', filter: 'all', sort: 'newest', limit: 48 };
    const installedSet = new Set(state.installed || []);
    const q = String(ui.search || '').trim().toLowerCase();

    const list = (state.versions || []).filter((ver) => {
      if (q && !ver.id.toLowerCase().includes(q)) return false;
      if (ui.filter === 'installed') return installedSet.has(ver.id);
      if (ui.filter === 'release') return ver.type === 'release';
      if (ui.filter === 'snapshot') return ver.type === 'snapshot';
      if (ui.filter === 'beta') return ver.type === 'old_beta';
      if (ui.filter === 'alpha') return ver.type === 'old_alpha';
      return true;
    });

    list.sort((a, b) => (ui.sort === 'oldest' ? b.order - a.order : a.order - b.order));
    return list;
  }

  Nexus.views.versionGrid = function (state) {
    const ui = state.ui || { limit: 48 };
    const installedSet = new Set(state.installed || []);
    const selectedId = state.config && state.config.launch ? state.config.launch.versionId : '';
    const activeInstall = state.install && state.install.active;
    const all = filteredVersions(state);
    const limit = ui.limit || 48;
    const visible = all.slice(0, limit);

    if (state.versionsLoading && !(state.versions || []).length) {
      return `<div class="empty-state"><span class="empty-icon" data-icon="refresh"></span><h3>${escapeHtml(t('versions.loadingTitle'))}</h3><p>${escapeHtml(t('versions.loadingSub'))}</p></div>`;
    }

    if (!visible.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="search"></span>
          <h3>${escapeHtml(t('versions.emptyTitle'))}</h3>
          <p>${escapeHtml(t('versions.emptySub'))}</p>
          <button type="button" class="btn btn-sm" data-action="reset-filters">${escapeHtml(t('versions.resetFilters'))}</button>
        </div>`;
    }

    const cards = visible.map((ver) => {
      const isSelected = ver.id === selectedId;
      const isInstalled = installedSet.has(ver.id);
      const isInstalling = Boolean(activeInstall && activeInstall.versionId === ver.id);
      const reqJava = requiredJavaForVersion(ver.id);

      return `
        <article class="version-card${isSelected ? ' selected' : ''}${isInstalling ? ' installing' : ''}">
          <div class="version-card-top">
            <span class="badge ${typeBadgeClass(ver.type)}">${escapeHtml(typeLabel(ver.type))}</span>
            ${isInstalled
              ? `<span class="badge badge-installed">${escapeHtml(t('versions.badgeInstalled'))}</span>`
              : ver.latestRelease
                ? `<span class="badge badge-latest">${escapeHtml(t('versions.badgeLatest'))}</span>`
                : `<span class="badge">Java ${reqJava}</span>`}
          </div>
          <div class="version-card-title tabular">${escapeHtml(ver.id)}</div>
          <div class="version-card-meta">
            <span>${escapeHtml(formatDate(ver.released))}</span>
            <span>Java ${reqJava}+</span>
          </div>
          <div class="version-actions">
            <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}"
                    data-action="select-version" data-version-id="${escapeHtml(ver.id)}">
              ${escapeHtml(isSelected ? t('versions.active') : t('versions.choose'))}
            </button>
            ${isInstalling
              ? `<button type="button" class="btn btn-sm btn-danger" data-action="cancel-install" data-version-id="${escapeHtml(ver.id)}">${escapeHtml(t('versions.cancel'))}</button>`
              : `<button type="button" class="btn btn-sm" data-action="install-version" data-version-id="${escapeHtml(ver.id)}" ${activeInstall ? 'disabled' : ''}>
                  ${escapeHtml(isInstalled ? t('versions.verify') : t('versions.install'))}
                </button>`}
          </div>
        </article>`;
    }).join('');

    return `
      <div class="version-grid">${cards}</div>
      ${all.length > visible.length ? `
        <div class="load-more">
          <button type="button" class="btn btn-sm" data-action="show-more-versions">
            ${escapeHtml(t('versions.showMore', { visible: visible.length, total: all.length }))}
          </button>
        </div>` : ''}`;
  };

  Nexus.views.versions = function (state) {
    const ui = state.ui || { search: '', filter: 'all', sort: 'newest' };
    const filters = [
      { id: 'all', label: t('versions.filter.all') },
      { id: 'release', label: t('versions.filter.release') },
      { id: 'snapshot', label: t('versions.filter.snapshot') },
      { id: 'beta', label: t('versions.filter.beta') },
      { id: 'alpha', label: t('versions.filter.alpha') },
      { id: 'installed', label: t('versions.filter.installed') }
    ];

    return `
      <div class="page">
        ${pageHead(
          t('versions.eyebrow'),
          t('versions.title'),
          t('versions.sub'),
          `<button type="button" class="btn btn-sm" data-action="versions-refresh" ${state.versionsLoading ? 'disabled' : ''}>
             <span data-icon="refresh"></span> ${escapeHtml(state.versionsLoading ? t('versions.updating') : t('versions.refreshBtn'))}
           </button>`
        )}

        <div id="install-progress-panel">${Nexus.views.installProgress(state)}</div>

        ${state.versionsWarning ? `<div class="catalog-warning">${escapeHtml(state.versionsWarning)}</div>` : ''}

        ${Nexus.views.loaderSwitcherBar ? Nexus.views.loaderSwitcherBar(state, true) : ''}

        <div class="toolbar">
          <div class="search-box">
            <span data-icon="search"></span>
            <label class="sr-only" for="version-search">${escapeHtml(t('versions.searchAria'))}</label>
            <input type="text" id="version-search" placeholder="${escapeHtml(t('versions.searchPh'))}" value="${escapeHtml(ui.search)}">
          </div>
          <div class="filter-group" role="group" aria-label="${escapeHtml(t('versions.filtersAria'))}">
            ${filters.map((f) => `
              <button type="button" class="filter-chip${ui.filter === f.id ? ' active' : ''}"
                      data-action="filter" data-filter="${f.id}">${escapeHtml(f.label)}</button>`).join('')}
          </div>
          <div class="filter-group">
            <button type="button" class="filter-chip${ui.sort === 'newest' ? ' active' : ''}" data-action="sort" data-sort="newest">${escapeHtml(t('versions.sort.newest'))}</button>
            <button type="button" class="filter-chip${ui.sort === 'oldest' ? ' active' : ''}" data-action="sort" data-sort="oldest">${escapeHtml(t('versions.sort.oldest'))}</button>
          </div>
        </div>

        <div class="catalog-status">
          <span><strong>${escapeHtml(t('versions.total'))}</strong> ${escapeHtml(t('versions.totalCount', { count: (state.versions || []).length }))}</span>
          <span><strong>${escapeHtml(t('versions.installedLabel'))}</strong> ${escapeHtml(String((state.installed || []).length))}</span>
          <span><strong>${escapeHtml(t('versions.sourceLabel'))}</strong> ${escapeHtml(state.versionsStale ? t('versions.sourceCache') : t('versions.sourceOfficial'))}</span>
        </div>

        <div id="version-grid">${Nexus.views.versionGrid(state)}</div>
      </div>`;
  };
})();
