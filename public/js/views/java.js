(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, note, pageHead, requiredJavaForVersion, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

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
          t('java.eyebrow'),
          t('java.title'),
          t('java.sub'),
          `<button type="button" class="btn btn-sm" data-action="detect-java">
             <span data-icon="refresh"></span> ${escapeHtml(t('java.detectBtn'))}
           </button>`
        )}

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('java.activeVer', { ver: versionId }))}</h3>
              <p>${t('java.requires', { major: escapeHtml(String(reqMajor)) })}</p>
            </div>
            <span class="badge badge-release">Java ${escapeHtml(String(reqMajor))}+</span>
          </div>

          ${selected ? `
            <p class="java-selected">
              ${t('java.selectedRuntime', {
                major: escapeHtml(String(selected.major)),
                ver: escapeHtml(selected.version),
                path: escapeHtml(selected.path)
              })}
            </p>` : `<p class="java-warning">${escapeHtml(t('java.missingRuntime'))}</p>`}

          ${jStatus.error ? `<p class="java-error" style="margin-top:8px;">${escapeHtml(jStatus.error)}</p>` : ''}
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('java.manualTitle'))}</h3>
              <p>${escapeHtml(t('java.manualSub'))}</p>
            </div>
          </div>
          <div class="form-stack" style="max-width:640px;">
            <div class="field">
              <label for="java-path">${escapeHtml(t('java.pathLabel'))}</label>
              <input type="text" id="java-path" placeholder="C:\\Program Files\\Eclipse Adoptium\\jdk-25\\bin\\javaw.exe" value="${escapeHtml(launch.javaPath || '')}">
            </div>
            <div class="preset-row">
              <button type="button" class="btn btn-primary btn-sm" data-action="save-java">${escapeHtml(t('java.savePath'))}</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('java.detectedTitle', { count: installations.length }))}</h3>
              <p>${escapeHtml(t('java.detectedSub'))}</p>
            </div>
          </div>
          ${installations.length
            ? `<ul class="feature-list">
                 ${installations.map((inst) => `
                   <li>
                     <strong>Java ${escapeHtml(String(inst.major))}</strong> (${escapeHtml(inst.version || '—')}) —
                     <code>${escapeHtml(inst.path)}</code>
                     <span class="badge">${escapeHtml(inst.source || t('java.systemSource'))}</span>
                   </li>`).join('')}
               </ul>`
            : `<p class="muted">${escapeHtml(t('java.emptyDetected'))}</p>`}
        </section>

        ${note(t('java.note'))}
      </div>`;
  };
})();
