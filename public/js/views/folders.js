(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  Nexus.views.folderGrid = function (state) {
    const folders = state.folders || {};
    if (folders.error) {
      return `<div class="catalog-warning">${escapeHtml(folders.error)}</div>`;
    }
    const items = folders.items || [];
    if (!items.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="folder"></span>
          <h3>${escapeHtml(t('folders.emptyTitle'))}</h3>
          <p>${escapeHtml(t('folders.emptySub'))}</p>
          <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">${escapeHtml(t('folders.goInst'))}</button>
        </div>`;
    }

    return `
      <div class="folder-list">
        ${items.map((item) => `
          <div class="folder-row${item.exists ? '' : ' folder-missing'}">
            <div class="folder-icon"><span data-icon="folder"></span></div>
            <div class="folder-info">
              <strong>${escapeHtml(item.label)}</strong>
              <span class="folder-path">${escapeHtml(item.path)}</span>
              <small>${escapeHtml(item.description || item.reason || '')}</small>
            </div>
            <div class="folder-actions" style="margin-top:0;">
              <button type="button" class="btn btn-xs" data-action="folders-copy" data-key="${escapeHtml(item.key)}">
                <span data-icon="copy"></span> ${escapeHtml(t('folders.copyPath'))}
              </button>
              <button type="button" class="btn btn-xs" data-action="folders-open" data-key="${escapeHtml(item.key)}">${escapeHtml(t('folders.openBtn'))}</button>
            </div>
          </div>`).join('')}
      </div>`;
  };

  Nexus.views.folders = function (state) {
    const list = (state.installations && state.installations.list) || [];
    const selectedId = state.folders && state.folders.installationId;

    return `
      <div class="page">
        ${pageHead(
          t('folders.eyebrow'),
          t('folders.title'),
          t('folders.sub'),
          `<div class="header-actions">
             <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">${escapeHtml(t('folders.back'))}</button>
             <button type="button" class="btn btn-sm" data-action="folders-refresh">
               <span data-icon="refresh"></span> ${escapeHtml(t('folders.refresh'))}
             </button>
           </div>`
        )}

        <section class="panel">
          <div class="field" style="max-width:420px;margin-bottom:16px;">
            <label for="folders-installation">${escapeHtml(t('folders.selectedInst'))}</label>
            <select id="folders-installation" ${!list.length ? 'disabled' : ''}>
              ${list.length
                ? list.map((inst) => `<option value="${escapeHtml(inst.id)}"${inst.id === selectedId ? ' selected' : ''}>${escapeHtml(inst.name)} (${escapeHtml(inst.versionId)})</option>`).join('')
                : `<option value="">${escapeHtml(t('folders.noInsts'))}</option>`}
            </select>
          </div>
          <div id="folder-grid">${Nexus.views.folderGrid(state)}</div>
        </section>
      </div>`;
  };
})();
