(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, pageHead, requiredJavaForVersion } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.newInstallVersionList = function (state) {
    const form = state.newInstall || {};
    const q = String(form.search || '').trim().toLowerCase();
    const cat = form.category || 'all';

    const categories = [
      { id: 'all', label: 'Todas' },
      { id: 'release', label: 'Oficiales' },
      { id: 'snapshot', label: 'Snapshots' },
      { id: 'beta', label: 'Beta' },
      { id: 'alpha', label: 'Alpha' }
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

      <div class="version-picker" role="listbox" aria-label="Versiones disponibles">
        ${visible.length
          ? visible.map((ver) => {
              const selected = ver.id === form.gameVersion;
              const reqJava = requiredJavaForVersion(ver.id);
              return `
                <button type="button" class="version-pick${selected ? ' selected' : ''}"
                        data-action="new-install-pick-version" data-version-id="${escapeHtml(ver.id)}">
                  <strong>${escapeHtml(ver.id)}</strong>
                  <span class="version-pick-meta">
                    <span>${escapeHtml(ver.type === 'release' ? 'Release' : ver.type)}</span>
                    <span>J${reqJava}</span>
                  </span>
                </button>`;
            }).join('')
          : '<p class="muted" style="padding:12px;">Sin versiones que coincidan.</p>'}
      </div>

      ${filtered.length > visible.length ? `
        <div class="load-more">
          <button type="button" class="btn btn-xs" data-action="new-install-show-more">
            Ver más (${escapeHtml(String(visible.length))} / ${escapeHtml(String(filtered.length))})
          </button>
        </div>` : ''}`;
  };

  Nexus.views.newInstallPanel = function (state) {
    const form = state.newInstall || {};
    const loaders = [
      { id: 'vanilla', label: 'Vanilla' },
      { id: 'fabric', label: 'Fabric' },
      { id: 'forge', label: 'Forge' },
      { id: 'neoforge', label: 'NeoForge' }
    ];
    const catalog = form.catalog || [];
    const catalogLimit = form.catalogLimit || 48;
    const visibleCatalog = catalog.slice(0, catalogLimit);
    const javaList = form.javaOptions || [];
    const reqJava = requiredJavaForVersion(form.gameVersion || '1.21.4');

    return `
      <div class="form-stack">
        <div class="field">
          <label>Cargador de mods (para ${escapeHtml(form.gameVersion || '—')} · requiere Java ${reqJava})</label>
          <div class="filter-group">
            ${loaders.map((l) => `
              <button type="button" class="filter-chip${form.loader === l.id ? ' active' : ''}"
                      data-action="new-install-set-loader" data-loader="${l.id}">${escapeHtml(l.label)}</button>`).join('')}
          </div>
        </div>

        ${form.loader !== 'vanilla' ? `
          <div class="field">
            <div class="panel-head" style="margin-bottom:4px;">
              <label for="new-install-loader-version">Versión de ${escapeHtml(form.loader)}</label>
              <button type="button" class="btn btn-xs" data-action="new-install-refresh-catalog">
                <span data-icon="refresh"></span> Refrescar
              </button>
            </div>
            ${form.catalogError ? `<p class="field-error">${escapeHtml(form.catalogError)}</p>` : ''}
            ${form.catalogWarning ? `<p class="field-hint">${escapeHtml(form.catalogWarning)}</p>` : ''}
            <select id="new-install-loader-version" ${form.catalogState === 'loading' || !visibleCatalog.length ? 'disabled' : ''}>
              ${form.catalogState === 'loading'
                ? '<option value="">Cargando catálogo…</option>'
                : visibleCatalog.length
                  ? visibleCatalog.map((item) => `<option value="${escapeHtml(item.id)}"${form.loaderVersion === item.id ? ' selected' : ''}>${escapeHtml(item.label)}${item.stable ? ' (Estable)' : ''}</option>`).join('')
                  : '<option value="">No disponible para esta versión</option>'}
            </select>
            ${catalog.length > visibleCatalog.length ? `
              <button type="button" class="btn btn-xs" data-action="new-install-show-more-loaders">Ver más versiones de cargador</button>` : ''}
          </div>` : ''}

        <div class="loader-form-grid">
          <div class="field">
            <label for="new-install-ram">RAM máxima (MB)</label>
            <input type="number" id="new-install-ram" min="1024" max="16384" step="512" value="${escapeHtml(String(form.ramMb || 4096))}">
          </div>
          <div class="field">
            <label for="new-install-min-ram">RAM inicial (MB)</label>
            <input type="number" id="new-install-min-ram" min="256" max="8192" step="256" value="${escapeHtml(String(form.minRamMb || 512))}">
          </div>
        </div>

        <div class="field">
          <label for="new-install-java">Runtime Java (opcional)</label>
          <select id="new-install-java">
            <option value="">Automático (Java ${reqJava} recomendado para ${escapeHtml(form.gameVersion || 'esta versión')})</option>
            ${javaList.map((j) => `<option value="${escapeHtml(j.path)}"${form.javaPath === j.path ? ' selected' : ''}>Java ${escapeHtml(String(j.major))} (${escapeHtml(j.version)}) — ${escapeHtml(j.path)}</option>`).join('')}
          </select>
        </div>

        <div class="wizard-actions">
          <button type="button" class="btn btn-sm" data-action="navigate" data-view="installations">Cancelar</button>
          <button type="button" class="btn btn-primary" data-action="new-install-create">Crear e instalar</button>
        </div>
      </div>`;
  };

  Nexus.views.newInstall = function (state) {
    const form = state.newInstall || {};
    return `
      <div class="page">
        ${pageHead(
          'INSTALACIONES AISLADAS',
          'Nueva instalación',
          'Crea un perfil independiente con su propia carpeta .minecraft, mods, loader, RAM y runtime Java.'
        )}

        <div class="new-install-layout">
          <section class="panel">
            <div class="field">
              <label for="new-install-name">Nombre de la instalación</label>
              <input type="text" id="new-install-name" maxlength="40" placeholder="Ej. PanSMP 26.3 PvP" value="${escapeHtml(form.name || '')}">
            </div>

            <div class="field new-install-field">
              <label for="new-install-search">Versión de Minecraft</label>
              <div class="search-box" style="max-width:none;">
                <span data-icon="search"></span>
                <input type="text" id="new-install-search" placeholder="Filtrar versión (ej. 26.3, 1.21.4)..." value="${escapeHtml(form.search || '')}">
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
