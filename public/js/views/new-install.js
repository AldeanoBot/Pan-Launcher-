(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, pageHead, requiredJavaForVersion } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  Nexus.views.newInstallVersionList = function (state) {
    const form = state.newInstall || {};
    const q = String(form.search || '').trim().toLowerCase();
    const cat = form.category || 'all';

    const categories = [
      { id: 'all', label: t('newInstall.cat.all') },
      { id: 'release', label: t('newInstall.cat.release') },
      { id: 'snapshot', label: t('newInstall.cat.snapshot') },
      { id: 'beta', label: t('newInstall.cat.beta') },
      { id: 'alpha', label: t('newInstall.cat.alpha') }
    ];

    const filtered = (state.versions || []).filter((ver) => {
      if (q && !ver.id.toLowerCase().includes(q)) return false;
      if (cat === 'release') return ver.type === 'release';
      if (cat === 'snapshot') return ver.type === 'snapshot';
      if (cat === 'beta') return ver.type === 'old_beta';
      if (cat === 'alpha') return ver.type === 'old_alpha';
      return true;
    });

    const limit = form.limit || 36;
    const visible = filtered.slice(0, limit);

    return `
      <div class="new-install-categories filter-group">
        ${categories.map((c) => `
          <button type="button" class="filter-chip${cat === c.id ? ' active' : ''}"
                  data-action="new-install-category" data-category="${c.id}">${escapeHtml(c.label)}</button>`).join('')}
      </div>

      <div class="version-picker" role="listbox" aria-label="${escapeHtml(t('newInstall.availableAria'))}">
        ${visible.length
          ? visible.map((ver) => {
              const selected = ver.id === form.gameVersion;
              const reqJava = requiredJavaForVersion(ver.id);
              const verTypeLabel = ver.type === 'release'
                ? t('versions.type.release')
                : ver.type === 'snapshot'
                  ? t('versions.type.snapshot')
                  : ver.type === 'old_beta'
                    ? t('versions.type.old_beta')
                    : ver.type === 'old_alpha'
                      ? t('versions.type.old_alpha')
                      : ver.type;
              return `
                <button type="button" class="version-pick${selected ? ' selected' : ''}"
                        data-action="new-install-pick-version" data-version-id="${escapeHtml(ver.id)}">
                  <strong>${escapeHtml(ver.id)}</strong>
                  <span class="version-pick-meta">
                    <span>${escapeHtml(verTypeLabel)}</span>
                    <span>J${reqJava}</span>
                  </span>
                </button>`;
            }).join('')
          : `<p class="muted" style="padding:12px;">${escapeHtml(t('newInstall.noMatch'))}</p>`}
      </div>

      ${filtered.length > visible.length ? `
        <div class="load-more">
          <button type="button" class="btn btn-xs" data-action="new-install-show-more">
            ${escapeHtml(t('newInstall.showMore', { vis: visible.length, total: filtered.length }))}
          </button>
        </div>` : ''}`;
  };

  Nexus.views.newInstallPanel = function (state) {
    const form = state.newInstall || {};
    const loaders = [
      { id: 'vanilla', label: 'Vanilla' },
      { id: 'fabric', label: 'Fabric' },
      { id: 'forge', label: 'Forge' },
      { id: 'neoforge', label: 'NeoForge' },
      { id: 'quilt', label: 'Quilt' }
    ];
    const catalog = form.catalog || [];
    const catalogLimit = form.catalogLimit || 48;
    const visibleCatalog = catalog.slice(0, catalogLimit);
    const javaList = form.javaOptions || [];
    const reqJava = requiredJavaForVersion(form.gameVersion || '1.21.4');

    return `
      <div class="form-stack">
        <div class="field">
          <label>${escapeHtml(t('newInstall.loaderLabel', { ver: form.gameVersion || '—', java: reqJava }))}</label>
          <div class="filter-group">
            ${loaders.map((l) => `
              <button type="button" class="filter-chip${form.loader === l.id ? ' active' : ''}"
                      data-action="new-install-set-loader" data-loader="${l.id}">${escapeHtml(l.label)}</button>`).join('')}
          </div>
        </div>

        ${form.loader !== 'vanilla' ? `
          <div class="field">
            <div class="panel-head" style="margin-bottom:4px;">
              <label for="new-install-loader-version">${escapeHtml(t('newInstall.loaderVerLabel', { loader: form.loader }))}</label>
              <button type="button" class="btn btn-xs" data-action="new-install-refresh-catalog">
                <span data-icon="refresh"></span> ${escapeHtml(t('folders.refresh'))}
              </button>
            </div>
            ${form.catalogError ? `<p class="field-error">${escapeHtml(form.catalogError)}</p>` : ''}
            ${form.catalogWarning ? `<p class="field-hint">${escapeHtml(form.catalogWarning)}</p>` : ''}
            <select id="new-install-loader-version" ${form.catalogState === 'loading' || !visibleCatalog.length ? 'disabled' : ''}>
              ${form.catalogState === 'loading'
                ? `<option value="">${escapeHtml(t('newInstall.loadingCatalog'))}</option>`
                : visibleCatalog.length
                  ? visibleCatalog.map((item) => `<option value="${escapeHtml(item.id)}"${form.loaderVersion === item.id ? ' selected' : ''}>${escapeHtml(item.label)}${item.stable ? ` (${escapeHtml(t('loaderBar.stable'))})` : ''}</option>`).join('')
                  : `<option value="">${escapeHtml(t('newInstall.unavailable'))}</option>`}
            </select>
            ${catalog.length > visibleCatalog.length ? `
              <button type="button" class="btn btn-xs" data-action="new-install-show-more-loaders">${escapeHtml(t('newInstall.showMoreLoaders'))}</button>` : ''}
          </div>` : ''}

        <div class="loader-form-grid">
          <div class="field">
            <label for="new-install-ram">${escapeHtml(t('newInstall.ramMaxLabel'))}</label>
            <input type="number" id="new-install-ram" min="1024" max="16384" step="512" value="${escapeHtml(String(form.ramMb || 4096))}">
          </div>
          <div class="field">
            <label for="new-install-min-ram">${escapeHtml(t('newInstall.ramMinLabel'))}</label>
            <input type="number" id="new-install-min-ram" min="256" max="8192" step="256" value="${escapeHtml(String(form.minRamMb || 512))}">
          </div>
        </div>

        <div class="field">
          <label for="new-install-java">${escapeHtml(t('newInstall.javaLabel'))}</label>
          <select id="new-install-java">
            <option value="">${escapeHtml(t('newInstall.javaAutoOpt', { java: reqJava, ver: form.gameVersion || t('newInstall.javaFallbackVer') }))}</option>
            ${javaList.map((j) => `<option value="${escapeHtml(j.path)}"${form.javaPath === j.path ? ' selected' : ''}>Java ${escapeHtml(String(j.major))} (${escapeHtml(j.version)}) — ${escapeHtml(j.path)}</option>`).join('')}
          </select>
        </div>

        <div class="wizard-actions">
          <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">${escapeHtml(t('newInstall.cancelBtn'))}</button>
          <button type="button" class="btn btn-primary" data-action="new-install-create">${escapeHtml(t('newInstall.createBtn'))}</button>
        </div>
      </div>`;
  };

  Nexus.views.newInstall = function (state) {
    const form = state.newInstall || {};
    return `
      <div class="page">
        ${pageHead(
          t('newInstall.eyebrow'),
          t('newInstall.title'),
          t('newInstall.sub')
        )}

        <div class="new-install-layout">
          <section class="panel">
            <div class="field">
              <label for="new-install-name">${escapeHtml(t('newInstall.nameLabel'))}</label>
              <input type="text" id="new-install-name" maxlength="40" placeholder="${escapeHtml(t('newInstall.namePh'))}" value="${escapeHtml(form.name || '')}">
            </div>

            <div class="field new-install-field">
              <label for="new-install-search">${escapeHtml(t('newInstall.mcVerLabel'))}</label>
              <div class="search-box" style="max-width:none;">
                <span data-icon="search"></span>
                <input type="text" id="new-install-search" placeholder="${escapeHtml(t('newInstall.searchPh'))}" value="${escapeHtml(form.search || '')}">
              </div>
              <div id="new-install-version-list">${Nexus.views.newInstallVersionList(state)}</div>
            </div>
          </section>

          <section class="panel">
            <div id="new-install-panel">${Nexus.views.newInstallPanel(state)}</div>
          </section>
        </div>
      </div>`;
  };
})();
