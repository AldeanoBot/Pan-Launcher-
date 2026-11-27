(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  const PROFILE_LABELS = Object.freeze({
    legacy: 'Minecraft antiguo / Java 8',
    modernVanilla: 'Vanilla moderno',
    fabric: 'Fabric',
    forge: 'Forge',
    neoforge: 'NeoForge'
  });

  function hardwarePanel(state) {
    const performance = (state && state.performance) || {};
    const hw = performance.hardware || {};
    const profiles = performance.profiles || {};
    const rows = Object.entries(PROFILE_LABELS).map(([key, label]) => {
      const advice = profiles[key];
      if (!advice) return '';
      return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(formatRam(advice.recommendedMaxMb))} máx. · ${escapeHtml(formatRam(advice.recommendedMinMb))} inicial · ${escapeHtml(advice.generation === 'legacy' ? 'legacy' : 'moderno')}</li>`;
    }).join('');

    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Hardware detectado</h3>
            <p>Datos leídos localmente con Node.js. No se envían a ningún servidor.</p>
          </div>
          <span class="badge badge-release">Local</span>
        </div>
        <div class="hardware-grid">
          <span><strong>CPU</strong> ${escapeHtml(hw.cpuModel || 'No disponible')}</span>
          <span><strong>Núcleos lógicos</strong> ${escapeHtml(String(hw.logicalCores || '—'))}</span>
          <span><strong>RAM total</strong> ${escapeHtml(hw.totalRamMb ? formatRam(hw.totalRamMb) : 'No disponible')}</span>
          <span><strong>RAM disponible</strong> ${escapeHtml(hw.availableRamMb ? formatRam(hw.availableRamMb) : 'No disponible')}</span>
          <span><strong>Sistema</strong> ${escapeHtml(hw.platform || '—')} ${escapeHtml(hw.arch || '')} ${escapeHtml(hw.osRelease || '')}</span>
          <span><strong>Perfil detectado</strong> ${escapeHtml(hw.tier || 'desconocido')}</span>
        </div>
        <p class="field-hint">El navegador no puede leer estos datos directamente: Pan Launcher los obtiene en el proceso principal sin sondeos en segundo plano.</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Recomendaciones conservadoras de RAM</h3>
            <p>Valores orientativos calculados para este equipo; no sobrescriben la memoria configurada.</p>
          </div>
        </div>
        <ul class="feature-list">${rows}</ul>
      </section>`;
  }

  function installerDownloadPanel() {
    return `
      <section class="panel" id="descargar-pc">
        <div class="panel-head">
          <div>
            <h3>Descargar Pan Launcher para PC (Windows y Linux)</h3>
            <p>Descarga los instaladores autónomos para usar el launcher o subirlos directamente a tu página web.</p>
          </div>
          <span class="badge badge-release">Windows + Linux</span>
        </div>
        <div class="download-grid">
          <article class="download-card download-card-primary">
            <div>
              <div class="download-card-head">
                <strong>Windows Instalador (.exe)</strong>
                <span class="badge badge-release">Principal</span>
              </div>
              <p>Instalador directo <code>Pan-launcher-Setup.exe</code> listo para publicar en tu web.</p>
            </div>
            <a class="btn btn-primary btn-sm"
               href="/api/pc/download-app?os=windows&format=exe"
               download="Pan-launcher-Setup.exe">
              <span data-icon="download"></span> Descargar Windows (.exe)
            </a>
          </article>

          <article class="download-card">
            <div>
              <div class="download-card-head">
                <strong>Windows Paquete (.zip)</strong>
                <span class="badge">Sin bloqueos</span>
              </div>
              <p>Incluye el <code>.exe</code> y <code>Instalar-Guiado.cmd</code> con soporte completo de Java 25 (26.3).</p>
            </div>
            <a class="btn btn-outline-accent btn-sm"
               href="/api/pc/download-app?os=windows&format=zip"
               download="Pan-launcher-Windows.zip">
              <span data-icon="download"></span> Descargar Windows (.zip)
            </a>
          </article>

          <article class="download-card">
            <div>
              <div class="download-card-head">
                <strong>Linux Lanzador (.sh)</strong>
                <span class="badge badge-release">Ubuntu / Arch / Fedora</span>
              </div>
              <p>Script autónomo con motor local en Python 3, descarga automática de Java 8/17/21/25, Fabric y mods FPS.</p>
            </div>
            <a class="btn btn-outline-accent btn-sm"
               href="/api/pc/download-app?os=unix"
               download="Pan-launcher.sh">
              <span data-icon="download"></span> Descargar Linux (.sh)
            </a>
          </article>

          <article class="download-card">
            <div>
              <div class="download-card-head">
                <strong>Linux / macOS (.zip)</strong>
                <span class="badge">Comprimido</span>
              </div>
              <p>Archivo ZIP con permisos de ejecución <code>Pan-launcher-MacLinux.zip</code> listo para compartir.</p>
            </div>
            <a class="btn btn-sm"
               href="/api/pc/download-app?os=unix&format=zip"
               download="Pan-launcher-MacLinux.zip">
              <span data-icon="download"></span> Descargar Linux (.zip)
            </a>
          </article>
        </div>

        <div class="guide-steps">
          <div><strong>Cómo usar en Windows:</strong> descarga <code>Pan-launcher-Setup.exe</code> (si SmartScreen avisa: «Más información» → «Ejecutar de todas formas») o extrae <code>Pan-launcher-Windows.zip</code> y abre <code>Instalar-Guiado.cmd</code>.</div>
          <div><strong>Cómo usar en Linux:</strong> abre la terminal en Descargas y ejecuta <code>chmod +x Pan-launcher.sh && ./Pan-launcher.sh</code> (crea acceso directo en tu menú de aplicaciones).</div>
          <div><strong>Cómo publicarlo en tu página web:</strong> descarga estos archivos aquí y súbelos a tu hosting o a <strong>GitHub Releases</strong> (carpeta <code>/descargas/</code> o URL del release) enlazándolos con <code>&lt;a href="Pan-launcher-Setup.exe" download&gt;</code>.</div>
        </div>
      </section>`;
  }

  Nexus.views.settings = function (state) {
    const language = state.config.general.language;
    const closeBehavior = state.config.general.closeBehavior || 'quit';

    return `
      <div class="page">
        ${settingsTabs('settings')}
        ${pageHead('AJUSTES', 'Configuración general y descargas',
          'Descarga Pan Launcher para tu PC, repite la presentación guiada o ajusta tus preferencias.')}

        <section class="panel tour-replay-panel">
          <div class="panel-head" style="margin-bottom:0;">
            <div>
              <h3>Presentación guiada del launcher</h3>
              <p>Vuelve a ver el tutorial interactivo que señala cada botón de Pan Launcher y explica cómo usar todo paso a paso.</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-action="start-tour">
              <span data-icon="help"></span> Ver presentación
            </button>
          </div>
        </section>

        ${installerDownloadPanel()}

        <section class="panel">
          <div class="settings-row">
            <div>
              <h4>Tema</h4>
              <p>Tema oscuro Pan Dorado con acentos cálidos en ámbar y tipografía Outfit.</p>
            </div>
            <span class="badge badge-release">Activo</span>
          </div>
          <div class="settings-row">
            <div>
              <h4>Idioma</h4>
              <p>Idioma de la interfaz.</p>
            </div>
            <div class="field">
              <label class="sr-only" for="language-select">Idioma</label>
              <select id="language-select">
                <option value="es"${language === 'es' ? ' selected' : ''}>Español</option>
                <option value="en"${language === 'en' ? ' selected' : ''}>English</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <h4>Al iniciar Minecraft (estilo SKLauncher)</h4>
              <p>Cerrar la ventana del launcher al jugar libera toda la RAM del navegador y vuelve a abrirse automáticamente al cerrar Minecraft.</p>
            </div>
            <div class="field">
              <label class="sr-only" for="close-behavior-select">Comportamiento al iniciar Minecraft</label>
              <select id="close-behavior-select">
                <option value="quit"${closeBehavior === 'quit' ? ' selected' : ''}>Cerrar al jugar y reabrir al salir</option>
                <option value="minimize"${closeBehavior === 'minimize' ? ' selected' : ''}>Minimizar al jugar</option>
                <option value="keep"${closeBehavior === 'keep' ? ' selected' : ''}>Mantener abierto</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <h4>Modo PC de baja gama</h4>
              <p>Reduce animaciones, brillos y el número inicial de elementos renderizados. No desactiva funciones ni seguridad; la paginación sigue permitiendo acceder a todo el catálogo.</p>
            </div>
            <label class="low-end-toggle">
              <input type="checkbox" id="low-end-toggle"${state.config.general.lowEndMode ? ' checked' : ''}>
              <span>Activado</span>
            </label>
          </div>
        </section>

        <details class="panel simple-details">
          <summary>Detalles técnicos del equipo y memoria recomendada (opcional)</summary>
          <div class="simple-details-body">
            ${hardwarePanel(state)}
          </div>
        </details>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Datos locales</h3>
              <p>Restaura los ajustes a sus valores iniciales.</p>
            </div>
          </div>
          <button type="button" class="btn" data-action="reset-config">Restablecer configuración</button>
        </section>

        ${note('La configuración se valida en el proceso principal: las claves desconocidas o los valores incorrectos se rechazan.')}
      </div>`;
  };
})();
