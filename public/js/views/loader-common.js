(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatBytes, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

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
            <span class="install-phase">${escapeHtml(progress.phaseLabel || 'Procesando')}</span>
          </div>
          ${active
            ? '<button type="button" class="btn btn-xs btn-danger" data-action="loader-cancel">Cancelar</button>'
            : `<span class="badge ${isError ? 'badge-error' : 'badge-installed'}">${escapeHtml(String(pct))}%</span>`}
        </div>
        <progress class="progress-track" max="100" value="${pct}"></progress>
        <div class="install-progress-stats">
          <span>Progreso: ${escapeHtml(String(pct))}%</span>
          ${progress.filesTotal ? `<span>Archivos: ${escapeHtml(String(progress.filesDone || 0))} / ${escapeHtml(String(progress.filesTotal))}</span>` : ''}
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
      return p.loader === 'forge' || p.loader === 'neoforge';
    });
    const activeVersionId = state.config && state.config.launch ? state.config.launch.versionId : '';

    const titleMap = {
      fabric: 'Instalación de Fabric',
      forge: 'Forge y NeoForge',
      neoforge: 'Forge y NeoForge'
    };

    return `
      <div class="page">
        ${settingsTabs(activeView)}
        ${pageHead(
          'CARGADORES',
          titleMap[kind] || 'Cargador de mods',
          kind === 'fabric'
            ? 'Instala Fabric Loader oficial para ejecutar Sodium, Lithium y paquetes FPS.'
            : 'Alterna entre Forge y NeoForge usando los metadatos oficiales de Maven.',
          kind !== 'fabric'
            ? `<div class="loader-switch">
                 <button type="button" class="btn btn-sm ${loaders.loader !== 'neoforge' ? 'btn-primary' : ''}"
                         data-action="loader-switch" data-loader="forge">Forge</button>
                 <button type="button" class="btn btn-sm ${loaders.loader === 'neoforge' ? 'btn-primary' : ''}"
                         data-action="loader-switch" data-loader="neoforge">NeoForge</button>
               </div>`
            : ''
        )}

        <div id="loader-progress-panel">${Nexus.views.loaderProgress(state)}</div>

        ${loaders.versionError ? `<div class="catalog-warning">${escapeHtml(loaders.versionError)}</div>` : ''}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Instalar ${escapeHtml(kind === 'fabric' ? 'Fabric' : (loaders.loader === 'neoforge' ? 'NeoForge' : 'Forge'))}</h3>
              <p>Selecciona la versión de Minecraft y la build del cargador.</p>
            </div>
            <button type="button" class="btn btn-xs" data-action="loader-refresh" data-loader="${escapeHtml(kind)}">
              <span data-icon="refresh"></span> Refrescar catálogo
            </button>
          </div>

          <div class="loader-form-grid">
            <div class="field">
              <label for="loader-base">Versión base de Minecraft</label>
              <select id="loader-base" data-loader="${escapeHtml(kind)}">
                ${baseOptions.length
                  ? baseOptions.map((ver) => `<option value="${escapeHtml(ver)}"${loaders.base === ver ? ' selected' : ''}>${escapeHtml(ver)}</option>`).join('')
                  : '<option value="">Instala primero una versión vanilla</option>'}
              </select>
            </div>

            <div class="field">
              <label for="loader-version">Versión del cargador (${escapeHtml(String(visibleCatalog.length))} / ${escapeHtml(String(catalog.length))})</label>
              <select id="loader-version" ${loaders.versionState === 'loading' || !visibleCatalog.length ? 'disabled' : ''}>
                ${loaders.versionState === 'loading'
                  ? '<option value="">Cargando catálogo oficial…</option>'
                  : visibleCatalog.length
                    ? visibleCatalog.map((item) => `<option value="${escapeHtml(item.id)}"${loaders.selected === item.id ? ' selected' : ''}>${escapeHtml(item.label)}${item.stable ? ' (Estable)' : ''}</option>`).join('')
                    : '<option value="">Sin builds compatibles</option>'}
              </select>
            </div>

            <div class="loader-form-actions">
              <button type="button" class="btn btn-primary" data-action="loader-install" data-loader="${escapeHtml(kind)}"
                      ${!loaders.base || !loaders.selected || (loaders.status && loaders.status.active) ? 'disabled' : ''}>
                Instalar perfil
              </button>
              ${catalog.length > visibleCatalog.length
                ? `<button type="button" class="btn btn-sm" data-action="loader-show-more">Ver más builds</button>`
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
                        ${isActive ? 'Activo' : 'Usar perfil'}
                      </button>
                    </div>`;
                }).join('')
              : '<p class="muted">Todavía no hay perfiles instalados para este cargador.</p>'}
          </div>
        </section>

        ${note('Consejo: usar Instalaciones independientes permite aislar mods y mundos por versión.')}
      </div>`;
  };
})();
