(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});

  function tr(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const translated = Nexus.i18n.t(key, vars);
      if (translated !== key || !fallback) return translated;
    }
    return String(fallback || key);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRam(mb) {
    const n = Number(mb);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1024) {
      const gb = n / 1024;
      return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
    }
    return `${Math.round(n)} MB`;
  }

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let val = n;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx += 1;
    }
    return `${idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const locale = Nexus.i18n && typeof Nexus.i18n.getLang === 'function' && Nexus.i18n.getLang() === 'en'
      ? 'en-US'
      : 'es-ES';
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function requiredJavaForVersion(versionId) {
    const id = String(versionId || '').trim();
    if (!id) return 21;
    // Mojang 2026+ CalVer (26.1, 26.2, 26.3, 27.x, etc.) requires Java 25+
    const calver = id.match(/^(\d{2,})\.(\d+)(?:\.(\d+))?/);
    if (calver && Number(calver[1]) >= 26) return 25;
    // Weekly snapshots from 26w... use Java 25; 24w14a+/25w... use Java 21
    const snap = id.match(/^(\d{2})w(\d{2})/);
    if (snap) {
      const yr = Number(snap[1]);
      const wk = Number(snap[2]);
      if (yr >= 26) return 25;
      if (yr > 24 || (yr === 24 && wk >= 14)) return 21;
      if (yr >= 21) return 17;
      return 8;
    }
    const sem = id.match(/1\.(\d+)(?:\.(\d+))?/);
    if (sem) {
      const minor = Number(sem[1]);
      const patch = Number(sem[2] || 0);
      if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
      if (minor >= 17) return 17;
      return 8;
    }
    return 21;
  }

  function note(text) {
    return `<div class="note"><span data-icon="shield"></span><span>${text}</span></div>`;
  }

  function pageHead(eyebrow, title, subtitle, extraHtml) {
    return `
      <header class="page-head">
        <div>
          <span class="eyebrow">${escapeHtml(eyebrow)}</span>
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${extraHtml || ''}
      </header>`;
  }

  const SETTINGS_TABS = Object.freeze([
    { view: 'settings', labelKey: 'tabs.settings', fallback: 'General', icon: 'gear' },
    { view: 'ram', labelKey: 'tabs.ram', fallback: 'Memoria RAM', icon: 'ram' },
    { view: 'java', labelKey: 'tabs.java', fallback: 'Java', icon: 'java' },
    { view: 'accounts', labelKey: 'tabs.accounts', fallback: 'Microsoft', icon: 'user' },
    { view: 'fabric', labelKey: 'tabs.fabric', fallback: 'Fabric', icon: 'puzzle' },
    { view: 'forge', labelKey: 'tabs.forge', fallback: 'Forge / NeoForge', icon: 'hammer' }
  ]);

  function settingsTabs(activeView) {
    return `
      <div class="settings-tabs" role="tablist" aria-label="${escapeHtml(tr('tabs.aria', null, 'Subsecciones de configuración'))}">
        ${SETTINGS_TABS.map((tab) => {
          const isActive = tab.view === activeView;
          const label = tr(tab.labelKey, null, tab.fallback);
          return `
            <button type="button" class="settings-tab${isActive ? ' active' : ''}"
                    role="tab" aria-selected="${isActive}"
                    data-action="navigate" data-view="${tab.view}">
              <span class="nav-icon" data-icon="${tab.icon}"></span>
              <span>${escapeHtml(label)}</span>
            </button>`;
        }).join('')}
      </div>`;
  }

  function hydrateIcons(container) {
    if (!container || !Nexus.icons) return;
    const nodes = container.querySelectorAll('[data-icon]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const name = el.getAttribute('data-icon');
      const markup = Nexus.icons[name];
      if (markup && el.innerHTML !== markup) {
        el.innerHTML = markup;
      }
    }
  }

  function toast(message, type) {
    const root = document.getElementById('toast-root');
    if (!root || !message) return;
    while (root.children.length >= 4) {
      root.removeChild(root.firstChild);
    }
    const kind = type === 'error' ? 'error' : 'info';
    const iconName = kind === 'error' ? 'alert' : 'check';
    const item = document.createElement('div');
    item.className = `toast toast-${kind}`;
    item.innerHTML = `<span data-icon="${iconName}"></span><span>${escapeHtml(message)}</span>`;
    hydrateIcons(item);
    root.appendChild(item);
    window.setTimeout(() => {
      item.remove();
    }, 3600);
  }

  function confirmModal(options) {
    const opts = options || {};
    if (typeof document === 'undefined' || !document.body) {
      return Promise.resolve(false);
    }
    const existing = document.getElementById('pan-confirm-modal');
    if (existing) existing.remove();

    const title = opts.title || tr('confirm.title', null, 'Confirmar acción');
    const message = opts.message || '';
    const cancelLabel = opts.cancelLabel || tr('confirm.cancel', null, 'Cancelar');
    const confirmLabel = opts.confirmLabel || tr('confirm.confirm', null, 'Eliminar');
    const confirmClass = opts.danger === false ? 'btn btn-primary btn-sm' : 'btn btn-danger btn-sm';

    return new Promise((resolve) => {
      let settled = false;
      const overlay = document.createElement('div');
      overlay.id = 'pan-confirm-modal';
      overlay.className = 'pan-modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'pan-confirm-title');

      overlay.innerHTML = `
        <div class="pan-modal pan-confirm-modal">
          <div class="pan-modal-head">
            <h3 id="pan-confirm-title">${escapeHtml(title)}</h3>
            <button type="button" class="btn btn-xs" data-confirm-choice="cancel" aria-label="${escapeHtml(cancelLabel)}">✕</button>
          </div>
          <p class="pan-modal-subtitle">${escapeHtml(message)}</p>
          <div class="pan-modal-actions">
            <button type="button" class="${confirmClass}" data-confirm-choice="confirm">${escapeHtml(confirmLabel)}</button>
            <button type="button" class="btn btn-sm" data-confirm-choice="cancel">${escapeHtml(cancelLabel)}</button>
          </div>
        </div>`;

      const cleanup = (accepted) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(Boolean(accepted));
      };

      const onKeyDown = (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          cleanup(false);
        }
      };

      document.addEventListener('keydown', onKeyDown);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          cleanup(false);
          return;
        }
        const btn = ev.target.closest('[data-confirm-choice]');
        if (!btn) return;
        cleanup(btn.getAttribute('data-confirm-choice') === 'confirm');
      });

      document.body.appendChild(overlay);
      const cancelBtn = overlay.querySelector('[data-confirm-choice="cancel"]');
      if (cancelBtn && typeof cancelBtn.focus === 'function') cancelBtn.focus();
    });
  }

  Nexus.utils = Object.freeze({
    escapeHtml,
    formatRam,
    formatBytes,
    formatDate,
    requiredJavaForVersion,
    note,
    pageHead,
    settingsTabs,
    hydrateIcons,
    toast,
    confirmModal
  });
})();
