(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const out = Nexus.i18n.t(key, vars);
      if (out && out !== key) return out;
    }
    return fallback || key;
  }

  function resolveTargetMcVersion(state) {
    const config = (state && state.config) || {};
    const launchCfg = config.launch || {};
    const list = (state && state.installations && state.installations.list) || [];
    const activeInst = list.find((item) => item.id === launchCfg.activeInstallationId) || null;
    if (activeInst) {
      return activeInst.gameVersion || activeInst.versionId || '1.21.4';
    }
    const rawVer = String(launchCfg.versionId || '1.21.4');
    const profMatch = rawVer.match(/^(?:fabric|forge|neoforge|quilt)-.+?-([^-]+)$/i);
    if (profMatch) return profMatch[1];
    return rawVer;
  }

  function renderPackCard(pack, mcVersion, inspector) {
    const compat = inspector
      ? inspector.evaluateResourcePackCompatibility(pack, mcVersion)
      : { compatible: true, status: 'compatible', reason: '' };

    let badgeClass = 'badge-neutral';
    let badgeLabel = t('rpack.badgeOff', null, 'Desactivado');
    let cardStateClass = 'is-disabled';

    if (pack.enabled) {
      if (compat.status === 'compatible') {
        badgeClass = 'badge-ok';
        badgeLabel = t('rpack.badgeCompat', null, 'Compatible');
        cardStateClass = 'is-compatible';
      } else if (compat.status === 'incompatible') {
        badgeClass = 'badge-error';
        badgeLabel = t('rpack.badgeIncompat', null, 'Otra versión');
        cardStateClass = 'is-incompatible';
      } else {
        badgeClass = 'badge-snapshot';
        badgeLabel = t('rpack.badgeUnknown', null, 'Revisar');
        cardStateClass = 'is-compatible';
      }
    }

    const fmtLabel = pack.packFormat !== null && pack.packFormat !== undefined
      ? t('rpack.formatLabel', { fmt: pack.packFormat }, `Formato ${pack.packFormat}`)
      : t('rpack.noFormat', null, 'Sin pack.mcmeta');
    const rangeLabel = pack.mcVersionRangeLabel && pack.mcVersionRangeLabel !== '—'
      ? `MC ${pack.mcVersionRangeLabel}`
      : null;

    return `
      <article class="rpack-card ${cardStateClass}" data-rpack-id="${escapeHtml(pack.id)}">
        <div class="rpack-leading">
          ${pack.iconDataUrl
            ? `<img class="rpack-thumb" src="${escapeHtml(pack.iconDataUrl)}" alt="">`
            : `<div class="rpack-thumb-placeholder" aria-hidden="true"><span data-icon="pack"></span></div>`}
          <div class="custom-mod-main">
            <div class="custom-mod-title-row">
              <strong>${escapeHtml(pack.name || pack.filename)}</strong>
              <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
            </div>
            <div class="custom-mod-meta">
              <span><code>${escapeHtml(pack.filename)}</code></span>
              <span>${escapeHtml(formatBytes(pack.size || 0))}</span>
              <span>${escapeHtml(fmtLabel)}</span>
              ${rangeLabel ? `<span>${escapeHtml(rangeLabel)}</span>` : ''}
            </div>
            ${pack.description ? `<p class="rpack-desc">${escapeHtml(pack.description)}</p>` : ''}
            ${compat.reason ? `
              <p class="custom-mod-reason ${pack.enabled && !compat.compatible ? 'is-error' : ''}">
                ${escapeHtml(compat.reason)}
              </p>` : ''}
          </div>
        </div>
        <div class="custom-mod-actions">
          <label class="custom-mod-switch" title="${escapeHtml(pack.enabled ? t('rpack.toggleDisableTitle') : t('rpack.toggleEnableTitle'))}">
            <input type="checkbox"
                   class="rpack-toggle"
                   data-id="${escapeHtml(pack.id)}"
                   ${pack.enabled ? 'checked' : ''}
                   aria-label="${escapeHtml((pack.enabled ? t('rpack.toggleDisableTitle') : t('rpack.toggleEnableTitle')) + ' ' + (pack.name || pack.filename))}">
            <span>${escapeHtml(pack.enabled ? t('rpack.stateOn') : t('rpack.stateOff'))}</span>
          </label>
          <button type="button"
                  class="btn btn-xs btn-danger-ghost"
                  data-action="rpack-remove"
                  data-id="${escapeHtml(pack.id)}"
                  aria-label="${escapeHtml(t('rpack.removeTitle') + ' ' + (pack.name || pack.filename))}"
                  title="${escapeHtml(t('rpack.removeTitle'))}">
            <span data-icon="trash"></span>
          </button>
        </div>
      </article>`;
  }

  Nexus.views.resourcepacks = function (state) {
    const mcVersion = resolveTargetMcVersion(state);
    const inspector = Nexus.resourcePackInspector || null;
    const targetFmt = inspector ? inspector.resourcePackFormatForMcVersion(mcVersion) : null;
    const rpState = state.resourcePacks || { items: [], uploading: false };
    const packs = Array.isArray(rpState.items) ? rpState.items : [];
    const enabledCount = packs.filter((p) => p && p.enabled).length;
    const incompatibleEnabled = inspector
      ? packs.filter((p) => {
          if (!p || !p.enabled) return false;
          const res = inspector.evaluateResourcePackCompatibility(p, mcVersion);
          return res.status === 'incompatible';
        })
      : [];

    const incompatLabel = incompatibleEnabled.length === 1
      ? t('rpack.incompatOne', null, 'resource pack activo')
      : t('rpack.incompatMany', null, 'resource packs activos');
    const targetFmtStr = targetFmt ? t('rpack.targetFmt', { fmt: targetFmt }, ` · formato requerido ${targetFmt}`) : '';

    return `
      <div class="page">
        ${pageHead(
          t('rpack.eyebrow', null, 'PAQUETES DE RECURSOS'),
          t('rpack.title', null, 'Resource Packs (.zip)'),
          t('rpack.sub', null, 'Arrastra tus paquetes de texturas y sonido (.zip). Se guardan para todas tus versiones y se activan solos en options.txt al pulsar JUGAR.'),
          `<div class="header-actions">
             <button type="button" class="btn btn-primary btn-sm" data-action="rpacks-pick">
               <span data-icon="upload"></span> ${escapeHtml(t('rpack.addBtn', null, 'Añadir packs (.zip)'))}
             </button>
             <button type="button" class="btn btn-sm" data-action="rpacks-open-folder">
               <span data-icon="folder"></span> ${escapeHtml(t('rpack.openFolder', null, 'Abrir carpeta'))}
             </button>
           </div>`
        )}

        <section id="rpacks-dropzone" class="panel mods-dropzone rpacks-dropzone${rpState.uploading ? ' is-uploading' : ''}" tabindex="0" aria-label="${escapeHtml(t('rpack.dropAria', null, 'Zona para arrastrar resource packs .zip'))}">
          <input id="rpacks-file-input" type="file" accept=".zip,application/zip,application/x-zip-compressed" multiple hidden>
          <div class="mods-dropzone-icon">
            <span data-icon="pack"></span>
          </div>
          <div class="mods-dropzone-copy">
            <strong>${escapeHtml(rpState.uploading ? t('rpack.uploading', null, 'Analizando y guardando resource packs…') : t('rpack.dropTitle', null, 'Arrastra y suelta aquí tus archivos .zip'))}</strong>
            <span>${escapeHtml(t('rpack.dropSub', null, 'Funcionan tanto en Vanilla como en Fabric, Forge, NeoForge y Quilt. Los packs activos se cargan automáticamente al iniciar el juego.'))}</span>
          </div>
          <button type="button" class="btn btn-outline-accent btn-sm" data-action="rpacks-pick">
            <span data-icon="plus"></span> ${escapeHtml(t('rpack.pickFiles', null, 'Seleccionar archivos .zip'))}
          </button>
        </section>

        ${incompatibleEnabled.length ? `
          <div class="catalog-warning mods-compat-banner" role="alert">
            <div class="mods-compat-banner-text">
              <strong>${escapeHtml(t('rpack.incompatBannerTitle', { count: incompatibleEnabled.length, label: incompatLabel, mc: mcVersion }))}</strong>
              <span>${escapeHtml(t('rpack.incompatBannerSub'))}</span>
            </div>
            <button type="button" class="btn btn-sm btn-danger" data-action="rpacks-disable-incompatible">
              ${escapeHtml(t('rpack.disableIncompatBtn', null, 'Desactivar incompatibles'))}
            </button>
          </div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('rpack.listTitle', { enabled: enabledCount, total: packs.length }))}</h3>
              <p>${t('rpack.targetLine', { mc: escapeHtml(mcVersion), fmt: escapeHtml(targetFmtStr) })}</p>
            </div>
            ${packs.length ? `
              <button type="button" class="btn btn-xs" data-action="rpacks-refresh">
                <span data-icon="refresh"></span> ${escapeHtml(t('rpack.syncBtn', null, 'Sincronizar'))}
              </button>` : ''}
          </div>
          ${packs.length
            ? `<div class="rpacks-list">
                ${packs.map((pack) => renderPackCard(pack, mcVersion, inspector)).join('')}
               </div>`
            : `<div class="mods-empty-state">
                <p>${escapeHtml(t('rpack.emptyTitle', null, 'Todavía no has añadido ningún Resource Pack.'))}</p>
                <small class="muted">${t('rpack.emptySub', null, 'Arrastra archivos <code>.zip</code> arriba o pulsa «Añadir packs (.zip)».')}</small>
               </div>`}
        </section>

        ${note(t('rpack.note', null, 'Los resource packs activos se copian en la carpeta compartida shared/resourcepacks y se registran automáticamente en options.txt antes de abrir Minecraft.'))}
      </div>`;
  };
})();
