(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const { escapeHtml, formatRam, note, pageHead, settingsTabs } = Nexus.utils;

  Nexus.views = Nexus.views || {};

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const val = Nexus.i18n.t(key, vars);
      if (val !== key || fallback === undefined) return val;
    }
    return fallback !== undefined ? fallback : key;
  }

  function hardwarePanel(state) {
    const performance = (state && state.performance) || {};
    const hw = performance.hardware || {};
    const profiles = performance.profiles || {};
    const profileLabels = {
      legacy: t('settings.profileLegacy'),
      modernVanilla: t('settings.profileVanilla'),
      fabric: 'Fabric',
      forge: 'Forge',
      neoforge: 'NeoForge'
    };

    const rows = Object.entries(profileLabels).map(([key, label]) => {
      const advice = profiles[key];
      if (!advice) return '';
      const gen = advice.generation === 'legacy' ? 'legacy' : (Nexus.i18n && Nexus.i18n.getLang() === 'en' ? 'modern' : 'moderno');
      return `<li>${t('settings.ramAdviceRow', {
        label: escapeHtml(label),
        max: escapeHtml(formatRam(advice.recommendedMaxMb)),
        min: escapeHtml(formatRam(advice.recommendedMinMb)),
        gen: escapeHtml(gen)
      })}</li>`;
    }).join('');

    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>${escapeHtml(t('settings.hwTitle'))}</h3>
            <p>${escapeHtml(t('settings.hwSub'))}</p>
          </div>
          <span class="badge badge-release">${escapeHtml(t('settings.hwLocal'))}</span>
        </div>
        <div class="hardware-grid">
          <span><strong>${escapeHtml(t('settings.hwCpu'))}</strong> ${escapeHtml(hw.cpuModel || t('settings.hwUnknown'))}</span>
          <span><strong>${escapeHtml(t('settings.hwCores'))}</strong> ${escapeHtml(String(hw.logicalCores || '—'))}</span>
          <span><strong>${escapeHtml(t('settings.hwTotalRam'))}</strong> ${escapeHtml(hw.totalRamMb ? formatRam(hw.totalRamMb) : t('settings.hwUnknown'))}</span>
          <span><strong>${escapeHtml(t('settings.hwAvailRam'))}</strong> ${escapeHtml(hw.availableRamMb ? formatRam(hw.availableRamMb) : t('settings.hwUnknown'))}</span>
          <span><strong>${escapeHtml(t('settings.hwOs'))}</strong> ${escapeHtml(hw.platform || '—')} ${escapeHtml(hw.arch || '')} ${escapeHtml(hw.osRelease || '')}</span>
          <span><strong>${escapeHtml(t('settings.hwTier'))}</strong> ${escapeHtml(hw.tier || t('settings.hwUnknown'))}</span>
        </div>
        <p class="field-hint">${escapeHtml(t('settings.hwHint'))}</p>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>${escapeHtml(t('settings.ramAdviceTitle'))}</h3>
            <p>${escapeHtml(t('settings.ramAdviceSub'))}</p>
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
            <h3>${escapeHtml(t('settings.dlTitle'))}</h3>
            <p>${escapeHtml(t('settings.dlSub'))}</p>
          </div>
          <span class="badge badge-release">Windows + Linux</span>
        </div>
        <div class="download-grid">
          <article class="download-card download-card-primary">
            <div>
              <div class="download-card-head">
                <strong>${escapeHtml(t('settings.dlWinExeTitle'))}</strong>
                <span class="badge badge-release">${escapeHtml(t('settings.dlMainBadge'))}</span>
              </div>
              <p>${t('settings.dlWinExeDesc')}</p>
            </div>
            <a class="btn btn-primary btn-sm"
               href="/api/pc/download-app?os=windows&format=exe"
               download="Pan-launcher-Setup.exe">
              <span data-icon="download"></span> ${escapeHtml(t('settings.dlWinExeBtn'))}
            </a>
          </article>

          <article class="download-card">
            <div>
              <div class="download-card-head">
                <strong>${escapeHtml(t('settings.dlWinZipTitle'))}</strong>
                <span class="badge">${escapeHtml(t('settings.dlNoBlockBadge'))}</span>
              </div>
              <p>${t('settings.dlWinZipDesc')}</p>
            </div>
            <a class="btn btn-outline-accent btn-sm"
               href="/api/pc/download-app?os=windows&format=zip"
               download="Pan-launcher-Windows.zip">
              <span data-icon="download"></span> ${escapeHtml(t('settings.dlWinZipBtn'))}
            </a>
          </article>

          <article class="download-card">
            <div>
              <div class="download-card-head">
                <strong>${escapeHtml(t('settings.dlLinuxShTitle'))}</strong>
                <span class="badge badge-release">Ubuntu / Arch / Fedora</span>
              </div>
              <p>${escapeHtml(t('settings.dlLinuxShDesc'))}</p>
            </div>
            <a class="btn btn-outline-accent btn-sm"
               href="/api/pc/download-app?os=unix"
               download="Pan-launcher.sh">
              <span data-icon="download"></span> ${escapeHtml(t('settings.dlLinuxShBtn'))}
            </a>
          </article>

          <article class="download-card">
            <div>
              <div class="download-card-head">
                <strong>${escapeHtml(t('settings.dlLinuxZipTitle'))}</strong>
                <span class="badge">${escapeHtml(t('settings.dlZipBadge'))}</span>
              </div>
              <p>${t('settings.dlLinuxZipDesc')}</p>
            </div>
            <a class="btn btn-sm"
               href="/api/pc/download-app?os=unix&format=zip"
               download="Pan-launcher-MacLinux.zip">
              <span data-icon="download"></span> ${escapeHtml(t('settings.dlLinuxZipBtn'))}
            </a>
          </article>
        </div>

        <div class="guide-steps">
          <div>${t('settings.guideWin')}</div>
          <div>${t('settings.guideLinux')}</div>
          <div>${t('settings.guideWeb')}</div>
        </div>
      </section>`;
  }

  Nexus.views.settings = function (state) {
    const language = (Nexus.i18n && Nexus.i18n.getLang()) || state.config.general.language || 'es';
    const closeBehavior = state.config.general.closeBehavior || 'quit';

    return `
      <div class="page">
        ${settingsTabs('settings')}
        ${pageHead(t('settings.eyebrow'), t('settings.title'), t('settings.sub'))}

        <section class="panel tour-replay-panel">
          <div class="panel-head" style="margin-bottom:0;">
            <div>
              <h3>${escapeHtml(t('settings.tourTitle'))}</h3>
              <p>${escapeHtml(t('settings.tourSub'))}</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-action="start-tour">
              <span data-icon="help"></span> ${escapeHtml(t('settings.tourBtn'))}
            </button>
          </div>
        </section>

        ${installerDownloadPanel()}

        <section class="panel">
          <div class="settings-row">
            <div>
              <h4>${escapeHtml(t('settings.themeTitle'))}</h4>
              <p>${escapeHtml(t('settings.themeSub'))}</p>
            </div>
            <span class="badge badge-release">${escapeHtml(t('settings.activeBadge'))}</span>
          </div>
          <div class="settings-row">
            <div>
              <h4>${escapeHtml(t('settings.langTitle'))}</h4>
              <p>${escapeHtml(t('settings.langSub'))}</p>
            </div>
            <div class="field">
              <label class="sr-only" for="language-select">${escapeHtml(t('settings.langTitle'))}</label>
              <select id="language-select">
                <option value="es"${language === 'es' ? ' selected' : ''}>Español</option>
                <option value="en"${language === 'en' ? ' selected' : ''}>English</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <h4>${escapeHtml(t('settings.onLaunchTitle'))}</h4>
              <p>${escapeHtml(t('settings.onLaunchSub'))}</p>
            </div>
            <div class="field">
              <label class="sr-only" for="close-behavior-select">${escapeHtml(t('settings.onLaunchAria'))}</label>
              <select id="close-behavior-select">
                <option value="quit"${closeBehavior === 'quit' ? ' selected' : ''}>${escapeHtml(t('close.quit.select'))}</option>
                <option value="minimize"${closeBehavior === 'minimize' ? ' selected' : ''}>${escapeHtml(t('close.minimize.select'))}</option>
                <option value="keep"${closeBehavior === 'keep' ? ' selected' : ''}>${escapeHtml(t('close.keep.select'))}</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <h4>${escapeHtml(t('settings.lowEndTitle'))}</h4>
              <p>${escapeHtml(t('settings.lowEndSub'))}</p>
            </div>
            <label class="low-end-toggle">
              <input type="checkbox" id="low-end-toggle"${state.config.general.lowEndMode ? ' checked' : ''}>
              <span>${escapeHtml(t('settings.enabled'))}</span>
            </label>
          </div>
        </section>

        <details class="panel simple-details">
          <summary>${escapeHtml(t('settings.hwSummary'))}</summary>
          <div class="simple-details-body">
            ${hardwarePanel(state)}
          </div>
        </details>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(t('settings.localDataTitle'))}</h3>
              <p>${escapeHtml(t('settings.localDataSub'))}</p>
            </div>
          </div>
          <button type="button" class="btn" data-action="reset-config">${escapeHtml(t('settings.resetBtn'))}</button>
        </section>

        ${note(t('settings.note'))}
      </div>`;
  };
})();
