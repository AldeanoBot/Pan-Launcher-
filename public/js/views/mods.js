(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, note, pageHead } = Nexus.utils;

  Nexus.views = Nexus.views || {};

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
      : { compatible: true, status: 'compatible', reason: 'Listo' };
    const loaders = Array.isArray(mod.loaders) && mod.loaders.length
      ? mod.loaders.map(loaderName).join(' · ')
      : 'Loader abierto';
    const mcSpec = mod.mcVersionSpec ? `MC ${mod.mcVersionSpec}` : 'MC abierta';
    const badgeClass = !mod.enabled
      ? 'badge-neutral'
      : compat.compatible
        ? 'badge-ok'
        : 'badge-error';
    const badgeLabel = !mod.enabled
      ? 'Desactivado'
      : compat.compatible
        ? 'Compatible'
        : 'Incompatible';
    const cardStateClass = !mod.enabled
      ? 'is-disabled'
      : compat.compatible
        ? 'is-compatible'
        : 'is-incompatible';

    return `
      <article class="custom-mod-card ${cardStateClass}" data-mod-id="${escapeHtml(mod.id)}">
        <div class="custom-mod-main">
          <div class="custom-mod-title-row">
            <strong>${escapeHtml(mod.name || mod.filename)}</strong>
            ${mod.version && mod.version !== '—' ? `<span class="custom-mod-ver">v${escapeHtml(mod.version)}</span>` : ''}
            <span class="badge ${badgeClass}">${badgeLabel}</span>
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
          <label class="custom-mod-switch" title="${mod.enabled ? 'Desactivar mod' : 'Activar mod'}">
            <input type="checkbox"
                   class="custom-mod-toggle"
                   data-id="${escapeHtml(mod.id)}"
                   ${mod.enabled ? 'checked' : ''}
                   aria-label="Activar ${escapeHtml(mod.name || mod.filename)}">
            <span>${mod.enabled ? 'Activo' : 'Off'}</span>
          </label>
          <button type="button"
                  class="btn btn-xs btn-danger-ghost"
                  data-action="custom-mod-remove"
                  data-id="${escapeHtml(mod.id)}"
                  aria-label="Eliminar ${escapeHtml(mod.name || mod.filename)}"
                  title="Eliminar mod">
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
          'MODS PERSONALIZADOS',
          'Mods (.jar)',
          'Arrastra tus archivos .jar aquí para aplicarlos automáticamente al jugar. Pan Launcher comprueba la versión y el cargador antes de iniciar Minecraft.',
          `<div class="header-actions">
             <button type="button" class="btn btn-primary btn-sm" data-action="custom-mods-pick">
               <span data-icon="upload"></span> Añadir mods (.jar)
             </button>
             <button type="button" class="btn btn-sm" data-action="custom-mods-open-folder">
               <span data-icon="folder"></span> Abrir carpeta
             </button>
           </div>`
        )}

        ${Nexus.views.loaderSwitcherBar ? Nexus.views.loaderSwitcherBar(state, true) : ''}

        <section id="mods-dropzone" class="panel mods-dropzone${customState.uploading ? ' is-uploading' : ''}" tabindex="0" aria-label="Zona para arrastrar mods .jar">
          <input id="mods-file-input" type="file" accept=".jar,application/java-archive,application/x-java-archive" multiple hidden>
          <div class="mods-dropzone-icon">
            <span data-icon="puzzle"></span>
          </div>
          <div class="mods-dropzone-copy">
            <strong>${customState.uploading ? 'Analizando y guardando mods…' : 'Arrastra y suelta aquí tus archivos .jar'}</strong>
            <span>Se copiarán automáticamente a tu instancia al pulsar JUGAR si usas Fabric, Forge, NeoForge o Quilt.</span>
          </div>
          <button type="button" class="btn btn-outline-accent btn-sm" data-action="custom-mods-pick">
            <span data-icon="plus"></span> Seleccionar archivos .jar
          </button>
        </section>

        ${incompatibleEnabled.length ? `
          <div class="catalog-warning mods-compat-banner" role="alert">
            <div class="mods-compat-banner-text">
              <strong>${incompatibleEnabled.length} ${incompatibleEnabled.length === 1 ? 'mod activo incompatible' : 'mods activos incompatibles'} con Minecraft ${escapeHtml(target.gameVersion)} (${escapeHtml(loaderName(target.loader))}):</strong>
              <span>Si inicias el juego ahora te avisaremos para desactivarlos o elegir otro cargador.</span>
            </div>
            <button type="button" class="btn btn-sm btn-danger" data-action="custom-mods-disable-incompatible">
              Desactivar incompatibles
            </button>
          </div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Tus mods añadidos (${escapeHtml(String(enabledCount))} activos / ${escapeHtml(String(customMods.length))} total)</h3>
              <p>Objetivo actual: Minecraft <strong>${escapeHtml(target.gameVersion)}</strong> · <strong>${escapeHtml(loaderName(target.loader))}</strong></p>
            </div>
            ${customMods.length ? `
              <button type="button" class="btn btn-xs" data-action="custom-mods-refresh">
                <span data-icon="refresh"></span> Sincronizar
              </button>` : ''}
          </div>
          ${customMods.length
            ? `<div class="custom-mods-list">
                ${customMods.map((mod) => renderModCard(mod, target, inspector)).join('')}
               </div>`
            : `<div class="mods-empty-state">
                <p>Todavía no has añadido ningún mod personalizado.</p>
                <small class="muted">Arrastra archivos <code>.jar</code> arriba o pulsa «Añadir mods (.jar)».</small>
               </div>`}
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Mods FPS integrados (${escapeHtml(String(activePerfMods.length))})</h3>
              <p>Se descargan automáticamente desde Modrinth según tu perfil de Rendimiento y PvP.</p>
            </div>
            <button type="button" class="btn btn-xs" data-action="navigate" data-view="performance">
              <span data-icon="bolt"></span> Ajustar FPS y PvP
            </button>
          </div>
          ${target.loader === 'vanilla'
            ? '<p class="muted">Cargador en Vanilla: ni los mods propios ni los de FPS se cargarán hasta elegir Fabric, Forge, NeoForge o Quilt.</p>'
            : activePerfMods.length
              ? `<ul class="feature-list">
                  ${activePerfMods.map((mod) => `<li><strong>${escapeHtml(mod.name)}</strong> — ${escapeHtml(mod.description)}</li>`).join('')}
                 </ul>`
              : '<p class="muted">No hay mods FPS extra seleccionados en Rendimiento y PvP.</p>'}
        </section>

        ${note('Al iniciar Minecraft, tus mods activos se aplican automáticamente a la carpeta de la versión elegida sin mezclarse entre cargadores.')}
      </div>`;
  };
})();
