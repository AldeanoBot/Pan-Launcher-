(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead, requiredJavaForVersion, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  Nexus.views.java = function (state) {
    const launch = state.config.launch || {};
    const activeInst = ((state.installations && state.installations.list) || [])
      .find((item) => item.id === launch.activeInstallationId);
    const versionId = activeInst ? activeInst.versionId : (launch.versionId || '1.21.4');
    const jStatus = (state.launch && state.launch.javaStatus) || {};
    const reqMajor = jStatus.requiredMajor || requiredJavaForVersion(versionId);
    const installations = Array.isArray(jStatus.installations) ? jStatus.installations : [];
    const selected = jStatus.selected || null;

    return `
      <div class="page">
        ${settingsTabs('java')}
        ${pageHead(
          'ENTORNO DE EJECUCIÓN',
          'Configuración de Java',
          'Pan Launcher selecciona automáticamente Java 25 para Minecraft 26.x, Java 21 para 1.20.5–1.21.x, Java 17 para 1.17–1.20.4 y Java 8 para 1.16.5 o inferior.',
          `<button type="button" class="btn btn-sm" data-action="detect-java">
             <span data-icon="refresh"></span> Detectar Java en el sistema
           </button>`
        )}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Versión activa: ${escapeHtml(versionId)}</h3>
              <p>Requiere <strong>Java ${escapeHtml(String(reqMajor))}+</strong> para iniciarse correctamente.</p>
            </div>
            <span class="badge badge-release">Java ${escapeHtml(String(reqMajor))}+</span>
          </div>

          ${selected ? `
            <p class="java-selected">
              <strong>Runtime seleccionado:</strong> Java ${escapeHtml(String(selected.major))} (${escapeHtml(selected.version)}) — <code>${escapeHtml(selected.path)}</code>
            </p>` : '<p class="java-warning">No se encontró un runtime compatible automático; indica la ruta manual a java.exe o javaw.exe abajo.</p>'}

          ${jStatus.error ? `<p class="java-error" style="margin-top:8px;">${escapeHtml(jStatus.error)}</p>` : ''}
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Ruta manual de Java (opcional)</h3>
              <p>Si ya tienes Java 25 instalado (Temurin / Oracle / Zulu / GraalVM) y quieres forzar su ejecutable, indícalo aquí.</p>
            </div>
          </div>
          <div class="form-stack" style="max-width:640px;">
            <div class="field">
              <label for="java-path">Ruta a java.exe / javaw.exe (deja vacío para auto-selección)</label>
              <input type="text" id="java-path" placeholder="Ej. C:\\Program Files\\Eclipse Adoptium\\jdk-25\\bin\\javaw.exe" value="${escapeHtml(launch.javaPath || '')}">
            </div>
            <div class="preset-row">
              <button type="button" class="btn btn-primary btn-sm" data-action="save-java">Guardar ruta Java</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Runtimes detectados (${escapeHtml(String(installations.length))})</h3>
              <p>Java 25+ usa ZGC generacional nativo automáticamente (sin el flag obsoleto -XX:+ZGenerational).</p>
            </div>
          </div>
          ${installations.length
            ? `<ul class="feature-list">
                 ${installations.map((inst) => `
                   <li>
                     <strong>Java ${escapeHtml(String(inst.major))}</strong> (${escapeHtml(inst.version || '—')}) —
                     <code>${escapeHtml(inst.path)}</code>
                     <span class="badge">${escapeHtml(inst.source || 'Sistema')}</span>
                   </li>`).join('')}
               </ul>`
            : '<p class="muted">Pulsa «Detectar Java en el sistema» para volver a escanear.</p>'}
        </section>

        ${note('Las versiones 26.1 / 26.2 / 26.3 de Minecraft exigen Java 25 en su manifiesto oficial. Pan Launcher no bloquea rutas manuales y adapta automáticamente los flags JVM para Java 25.')}
      </div>`;
  };
})();
