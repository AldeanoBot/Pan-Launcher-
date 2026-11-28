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

  Nexus.views.skinGrid = function (state) {
    const items = (state.skins && state.skins.items) || [];
    if (!items.length) {
      return `
        <div class="empty-state">
          <span class="empty-icon" data-icon="palette"></span>
          <h3>${escapeHtml(t('skins.loadingTitle'))}</h3>
          <p>${escapeHtml(t('skins.loadingSub'))}</p>
        </div>`;
    }

    return `
      <div class="skin-grid">
        ${items.map((skin) => `
          <article class="skin-card${skin.active ? ' active' : ''}">
            <div class="skin-preview"
                 data-skin-id="${escapeHtml(skin.id)}"
                 data-skin-url="${escapeHtml(skin.dataUrl || '')}"
                 data-skin-model="${escapeHtml(skin.model || 'classic')}">
            </div>
            <div class="skin-card-body">
              <div class="skin-card-head">
                <h3>${escapeHtml(skin.name)}</h3>
                <div class="skin-badges">
                  ${skin.active ? `<span class="badge badge-installed">${escapeHtml(t('skins.activeBadge'))}</span>` : ''}
                  <span class="badge">${escapeHtml(skin.model === 'slim' ? t('skins.slim') : t('skins.classic'))}</span>
                </div>
              </div>
              <p class="skin-meta">${escapeHtml(String(skin.width || 64))}×${escapeHtml(String(skin.height || 64))} · ${escapeHtml(skin.source === 'official' ? t('skins.builtIn') : t('skins.local'))}</p>
              <div class="model-switch">
                <button type="button" class="btn btn-xs ${skin.model !== 'slim' ? 'btn-primary' : ''}"
                        data-action="skin-model" data-id="${escapeHtml(skin.id)}" data-model="classic">${escapeHtml(t('skins.classic'))}</button>
                <button type="button" class="btn btn-xs ${skin.model === 'slim' ? 'btn-primary' : ''}"
                        data-action="skin-model" data-id="${escapeHtml(skin.id)}" data-model="slim">${escapeHtml(t('skins.slim'))}</button>
              </div>
              <div class="skin-actions">
                <button type="button" class="btn btn-sm ${skin.active ? '' : 'btn-primary'}"
                        data-action="skin-select" data-id="${escapeHtml(skin.id)}" ${skin.active ? 'disabled' : ''}>
                  ${escapeHtml(skin.active ? t('skins.selectedBtn') : t('skins.activateBtn'))}
                </button>
                ${skin.source !== 'official'
                  ? `<button type="button" class="btn btn-sm btn-danger" data-action="skin-remove" data-id="${escapeHtml(skin.id)}" aria-label="${escapeHtml(t('confirm.confirm'))}">
                       <span data-icon="trash"></span>
                     </button>`
                  : ''}
              </div>
            </div>
          </article>`).join('')}
      </div>`;
  };

  Nexus.views.skins = function (state) {
    const model = (state.skins && state.skins.importModel) || 'classic';

    return `
      <div class="page">
        ${pageHead(
          t('skins.eyebrow'),
          t('skins.title'),
          t('skins.sub'),
          `<button type="button" class="btn btn-sm" data-action="skin-refresh">
             <span data-icon="refresh"></span> ${escapeHtml(t('skins.refreshBtn'))}
           </button>`
        )}

        <section class="panel skin-import-panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('skins.importTitle'))}</h3>
              <p>${escapeHtml(t('skins.importSub'))}</p>
            </div>
          </div>
          <div class="loader-form-grid">
            <div class="field">
              <label for="skin-import-model">${escapeHtml(t('skins.modelLabel'))}</label>
              <select id="skin-import-model">
                <option value="classic"${model === 'classic' ? ' selected' : ''}>${escapeHtml(t('skins.modelClassicOpt'))}</option>
                <option value="slim"${model === 'slim' ? ' selected' : ''}>${escapeHtml(t('skins.modelSlimOpt'))}</option>
              </select>
            </div>
            <div>
              <button type="button" class="btn btn-primary" data-action="skin-import">
                <span data-icon="upload"></span> ${escapeHtml(t('skins.importBtn'))}
              </button>
            </div>
          </div>
        </section>

        <section class="skin-section">
          <h3 class="skin-section-title">${escapeHtml(t('skins.libraryTitle'))}</h3>
          <div id="skin-grid">${Nexus.views.skinGrid(state)}</div>
        </section>

        ${note(t('skins.note'))}
      </div>`;
  };
})();
