(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  function resolveLaunchTarget(state) {
    const config = state.config || {};
    const launchCfg = config.launch || {};
    const list = (state.installations && state.installations.list) || [];
    const activeInst = list.find((item) => item.id === launchCfg.activeInstallationId) || null;
    if (activeInst) {
      return {
        gameVersion: activeInst.gameVersion || activeInst.versionId || '1.21.4',
        loader: String(activeInst.loader || 'vanilla').toLowerCase()
      };
    }
    const rawVer = String(launchCfg.versionId || '1.21.4');
    const profMatch = rawVer.match(/^(fabric|forge|neoforge|quilt)-(.+)-([^-]+)$/i);
    if (profMatch) {
      return {
        gameVersion: profMatch[3],
        loader: profMatch[1].toLowerCase()
      };
    }
    return {
      gameVersion: rawVer,
      loader: String(launchCfg.loader || 'vanilla').toLowerCase()
    };
  }

  function loaderName(id) {
    const map = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
    return map[String(id || 'vanilla').toLowerCase()] || 'Vanilla';
  }

  function renderModCard(mod, target, inspector) {
    const compat = inspector
      ? inspector.evaluateCustomModCompatibility(mod, target.gameVersion, target.loader)
      : { compatible: true, status: 'compatible', reason: t('status.idle') };
    const loaders = Array.isArray(mod.loaders) && mod.loaders.length
      ? mod.loaders.map(loaderName).join(' · ')
      : t('mods.openLoader');
    const mcSpec = mod.mcVersionSpec ? `MC ${mod.mcVersionSpec}` : t('mods.openMc');
    const badgeClass = !mod.enabled
      ? 'badge-neutral'
      : compat.compatible
        ? 'badge-ok'
        : 'badge-error';
    const badgeLabel = !mod.enabled
      ? t('mods.disabled')
      : compat.compatible
        ? t('mods.compatible')
        : t('mods.incompatible');
    const cardStateClass = !mod.enabled
      ? 'is-disabled'
      : compat.compatible
        ? 'is-compatible'
        : 'is-incompatible';
    const modName = mod.name || mod.filename;
    const toggleLabel = mod.enabled ? t('mods.toggleDisableTitle') : t('mods.toggleEnableTitle');

    return `
      <article class="custom-mod-card ${cardStateClass}" data-mod-id="${escapeHtml(mod.id)}">
        <div class="custom-mod-main">
          <div class="custom-mod-title-row">
            <strong>${escapeHtml(modName)}</strong>
            ${mod.version && mod.version !== '—' ? `<span class="custom-mod-ver">v${escapeHtml(mod.version)}</span>` : ''}
            <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
          </div>
          <div class="custom-mod-meta">
            <span><code>${escapeHtml(mod.filename)}</code></span>
            <span>${escapeHtml(formatBytes(mod.size || 0))}</span>
            <span>${escapeHtml(loaders)}</span>
            <span>${escapeHtml(mcSpec)}</span>
          </div>
          <p class="custom-mod-reason ${mod.enabled && !compat.compatible ? 'is-error' : ''}">
            ${escapeHtml(compat.reason)}
          </p>
        </div>
        <div class="custom-mod-actions">
          <label class="custom-mod-switch" title="${escapeHtml(toggleLabel)}">
            <input type="checkbox"
                   class="custom-mod-toggle"
                   data-id="${escapeHtml(mod.id)}"
                   ${mod.enabled ? 'checked' : ''}
                   aria-label="${escapeHtml(`${toggleLabel}: ${modName}`)}">
            <span>${escapeHtml(mod.enabled ? t('mods.stateOn') : t('mods.stateOff'))}</span>
          </label>
          <button type="button"
                  class="btn btn-xs btn-danger-ghost"
                  data-action="custom-mod-remove"
                  data-id="${escapeHtml(mod.id)}"
                  aria-label="${escapeHtml(`${t('mods.removeTitle')}: ${modName}`)}"
                  title="${escapeHtml(t('mods.removeTitle'))}">
            <span data-icon="trash"></span>
          </button>
        </div>
      </article>`;
  }

  Nexus.views.mods = function (state) {
    const target = resolveLaunchTarget(state);
    const inspector = Nexus.modInspector || null;
    const customState = state.customMods || { items: [], uploading: false };
    const customMods = Array.isArray(customState.items) ? customState.items : [];
    const incompatibleEnabled = inspector
      ? inspector.findIncompatibleEnabledMods(customMods, target.gameVersion, target.loader)
      : [];
    const enabledCount = customMods.filter((m) => m && m.enabled).length;
    const evaluated = Nexus.perfEngine ? Nexus.perfEngine.evaluateFromConfig(state.config) : null;
    const activePerfMods = evaluated && target.loader !== 'vanilla'
      ? evaluated.mods.filter((m) => m.enabled && m.id !== 'optifine')
      : [];

    return `
      <div class="page">
        ${pageHead(
          t('mods.eyebrow'),
          t('mods.title'),
          t('mods.sub'),
          `<div class="header-actions">
             <button type="button" class="btn btn-primary btn-sm" data-action="custom-mods-pick">
               <span data-icon="upload"></span> ${escapeHtml(t('mods.addBtn'))}
             </button>
             <button type="button" class="btn btn-sm" data-action="custom-mods-open-folder">
               <span data-icon="folder"></span> ${escapeHtml(t('mods.openFolder'))}
             </button>
           </div>`
        )}

        ${Nexus.views.loaderSwitcherBar ? Nexus.views.loaderSwitcherBar(state, true) : ''}

        <section id="mods-dropzone" class="panel mods-dropzone${customState.uploading ? ' is-uploading' : ''}" tabindex="0" aria-label="${escapeHtml(t('mods.dropAria'))}">
          <input id="mods-file-input" type="file" accept=".jar,application/java-archive,application/x-java-archive" multiple hidden>
          <div class="mods-dropzone-icon">
            <span data-icon="puzzle"></span>
          </div>
          <div class="mods-dropzone-copy">
            <strong>${escapeHtml(customState.uploading ? t('mods.uploading') : t('mods.dropTitle'))}</strong>
            <span>${escapeHtml(t('mods.dropSub'))}</span>
          </div>
          <button type="button" class="btn btn-outline-accent btn-sm" data-action="custom-mods-pick">
            <span data-icon="plus"></span> ${escapeHtml(t('mods.pickFiles'))}
          </button>
        </section>

        ${incompatibleEnabled.length ? `
          <div class="catalog-warning mods-compat-banner" role="alert">
            <div class="mods-compat-banner-text">
              <strong>${escapeHtml(t('mods.incompatBannerTitle', {
                count: incompatibleEnabled.length,
                label: incompatibleEnabled.length === 1 ? t('mods.incompatOne') : t('mods.incompatMany'),
                mc: target.gameVersion,
                loader: loaderName(target.loader)
              }))}</strong>
              <span>${escapeHtml(t('mods.incompatBannerSub'))}</span>
            </div>
            <button type="button" class="btn btn-sm btn-danger" data-action="custom-mods-disable-incompatible">
              ${escapeHtml(t('mods.disableIncompatBtn'))}
            </button>
          </div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('mods.listTitle', { enabled: enabledCount, total: customMods.length }))}</h3>
              <p>${t('mods.targetLine', { mc: escapeHtml(target.gameVersion), loader: escapeHtml(loaderName(target.loader)) })}</p>
            </div>
            ${customMods.length ? `
              <button type="button" class="btn btn-xs" data-action="custom-mods-refresh">
                <span data-icon="refresh"></span> ${escapeHtml(t('mods.syncBtn'))}
              </button>` : ''}
          </div>
          ${customMods.length
            ? `<div class="custom-mods-list">
                ${customMods.map((mod) => renderModCard(mod, target, inspector)).join('')}
               </div>`
            : `<div class="mods-empty-state">
                <p>${escapeHtml(t('mods.emptyTitle'))}</p>
                <small class="muted">${t('mods.emptySub')}</small>
               </div>`}
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('mods.perfModsTitle', { count: activePerfMods.length }))}</h3>
              <p>${escapeHtml(t('mods.perfModsSub'))}</p>
            </div>
            <button type="button" class="btn btn-xs" data-action="navigate" data-view="performance">
              <span data-icon="bolt"></span> ${escapeHtml(t('mods.perfModsConfigBtn'))}
            </button>
          </div>
          ${target.loader === 'vanilla'
            ? `<p class="muted">${escapeHtml(t('mods.perfModsVanilla'))}</p>`
            : activePerfMods.length
              ? `<ul class="feature-list">
                  ${activePerfMods.map((mod) => `<li><strong>${escapeHtml(mod.name)}</strong> — ${escapeHtml(mod.description)}</li>`).join('')}
                 </ul>`
              : `<p class="muted">${escapeHtml(t('mods.perfModsNone'))}</p>`}
        </section>

        ${note(t('mods.note'))}
      </div>`;
  };
})();
