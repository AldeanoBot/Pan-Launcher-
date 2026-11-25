(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, formatDate, pageHead, requiredJavaForVersion } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  const TYPE_LABELS = Object.freeze({
    release: 'Oficial',
    snapshot: 'Snapshot',
    old_beta: 'Beta',
    old_alpha: 'Alpha'
  });

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
            <span class="install-phase">${escapeHtml(progress.phaseLabel || 'Procesando')}</span>
          </div>
          ${active
            ? `<button type="button" class="btn btn-xs btn-danger" data-action="cancel-install" data-version-id="${escapeHtml(progress.versionId)}">Cancelar</button>`
            : `<span class="badge ${isError ? 'badge-error' : 'badge-installed'}">${escapeHtml(pct)}%</span>`}
        </div>
        <progress class="progress-track" max="100" value="${pct}"></progress>
        <div class="install-progress-stats">
          <span>Progreso: ${escapeHtml(String(pct))}%</span>
          ${progress.filesTotal ? `<span>Archivos: ${escapeHtml(String(progress.filesDone || 0))} / ${escapeHtml(String(progress.filesTotal))}</span>` : ''}
          ${progress.total ? `<span>Descarga: ${escapeHtml(formatBytes(progress.downloaded))} / ${escapeHtml(formatBytes(progress.total))}</span>` : ''}
          ${progress.speed ? `<span>Velocidad: ${escapeHtml(formatBytes(progress.speed))}/s</span>` : ''}
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
      return '<div class="empty-state"><span class="empty-icon" data-icon="refresh"></span><h3>Cargando catálogo oficial…</h3><p>Consultando Mojang Piston Meta v2.</p></div>';
    }

    if (!visible.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="search"></span>
          <h3>Sin resultados</h3>
          <p>Ninguna versión coincide con el filtro actual.</p>
          <button type="button" class="btn btn-sm" data-action="reset-filters">Restablecer filtros</button>
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
            <span class="badge ${typeBadgeClass(ver.type)}">${escapeHtml(TYPE_LABELS[ver.type] || ver.type)}</span>
            ${isInstalled
              ? '<span class="badge badge-installed">Instalada</span>'
              : ver.latestRelease
                ? '<span class="badge badge-latest">Última</span>'
                : `<span class="badge">Java ${reqJava}</span>`}
          </div>
          <div class="version-card-title tabular">${escapeHtml(ver.id)}</div>
          <div class="version-card-meta">
            <span>${escapeHtml(formatDate(ver.released))}</span>
            <span>Java ${reqJava}+</span>
          </div>
          <div class="version-actions" style="display:flex;">
            <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}"
                    data-action="select-version" data-version-id="${escapeHtml(ver.id)}">
              ${isSelected ? 'Activa' : 'Elegir'}
            </button>
            ${isInstalling
              ? `<button type="button" class="btn btn-sm btn-danger" data-action="cancel-install" data-version-id="${escapeHtml(ver.id)}">Cancelar</button>`
              : `<button type="button" class="btn btn-sm" data-action="install-version" data-version-id="${escapeHtml(ver.id)}" ${activeInstall ? 'disabled' : ''}>
                  ${isInstalled ? 'Verificar' : 'Instalar'}
                </button>`}
          </div>
        </article>`;
    }).join('');

    return `
      <div class="version-grid">${cards}</div>
      ${all.length > visible.length ? `
        <div class="load-more">
          <button type="button" class="btn btn-sm" data-action="show-more-versions">
            Mostrar más (${escapeHtml(String(visible.length))} / ${escapeHtml(String(all.length))})
          </button>
        </div>` : ''}`;
  };

  Nexus.views.versions = function (state) {
    const ui = state.ui || { search: '', filter: 'all', sort: 'newest' };
    const filters = [
      { id: 'all', label: 'Todas' },
      { id: 'release', label: 'Oficiales' },
      { id: 'snapshot', label: 'Snapshots' },
      { id: 'beta', label: 'Beta' },
      { id: 'alpha', label: 'Alpha' },
      { id: 'installed', label: 'Instaladas' }
    ];

    return `
      <div class="page">
        ${pageHead(
          'CATÁLOGO MOJANG',
          'Versiones de Minecraft',
          'Descarga versiones oficiales desde Piston Meta v2, incluidas las ediciones 26.x con Java 25 y clásicos 1.8.9–1.21.x.',
          `<button type="button" class="btn btn-sm" data-action="versions-refresh" ${state.versionsLoading ? 'disabled' : ''}>
             <span data-icon="refresh"></span> ${state.versionsLoading ? 'Actualizando…' : 'Actualizar lista'}
           </button>`
        )}

        <div id="install-progress-panel">${Nexus.views.installProgress(state)}</div>

        ${state.versionsWarning ? `<div class="catalog-warning">${escapeHtml(state.versionsWarning)}</div>` : ''}

        ${Nexus.views.loaderSwitcherBar ? Nexus.views.loaderSwitcherBar(state, true) : ''}

        <div class="toolbar">
          <div class="search-box">
            <span data-icon="search"></span>
            <label class="sr-only" for="version-search">Buscar versión</label>
            <input type="text" id="version-search" placeholder="Buscar versión (ej. 26.3, 1.21.4, 1.8.9)..." value="${escapeHtml(ui.search)}">
          </div>
          <div class="filter-group" role="group" aria-label="Filtros de versión">
            ${filters.map((f) => `
              <button type="button" class="filter-chip${ui.filter === f.id ? ' active' : ''}"
                      data-action="filter" data-filter="${f.id}">${escapeHtml(f.label)}</button>`).join('')}
          </div>
          <div class="filter-group">
            <button type="button" class="filter-chip${ui.sort === 'newest' ? ' active' : ''}" data-action="sort" data-sort="newest">Recientes</button>
            <button type="button" class="filter-chip${ui.sort === 'oldest' ? ' active' : ''}" data-action="sort" data-sort="oldest">Antiguas</button>
          </div>
        </div>

        <div class="catalog-status">
          <span><strong>Total:</strong> ${escapeHtml(String((state.versions || []).length))} versiones</span>
          <span><strong>Instaladas:</strong> ${escapeHtml(String((state.installed || []).length))}</span>
          <span><strong>Fuente:</strong> ${state.versionsStale ? 'Caché local' : 'Mojang Oficial'}</span>
        </div>

        <div id="version-grid">${Nexus.views.versionGrid(state)}</div>
      </div>`;
  };
})();
