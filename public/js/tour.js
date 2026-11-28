(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const STORAGE_KEY = 'pan_launcher_tour_v1';

  function tr(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      return Nexus.i18n.t(key, vars);
    }
    return String(fallback || key);
  }

  const STEPS = Object.freeze([
    {
      id: 'play',
      selector: '[data-action="play"]',
      titleKey: 'tour.step.play.title',
      descKey: 'tour.step.play.desc',
      tipKey: 'tour.step.play.tip',
      title: '1. Botón JUGAR',
      description: 'Es el botón principal para abrir Minecraft. Cuando tengas tu versión instalada y un jugador elegido, se activará en dorado.',
      tip: 'Si algo falta antes de jugar, justo debajo verás botones directos para solucionarlo en un clic.',
      placement: 'bottom',
      view: 'home'
    },
    {
      id: 'versions',
      selector: '.nav-item[data-view="versions"]',
      titleKey: 'tour.step.versions.title',
      descKey: 'tour.step.versions.desc',
      tipKey: 'tour.step.versions.tip',
      title: '2. Versiones oficiales',
      description: 'Aquí descargas cualquier versión de Minecraft Java (como 1.21.4, 1.20.1 o 26.3) directamente desde Mojang.',
      tip: 'Pulsa «Instalar» en la versión que quieras y luego «Elegir» para usarla al jugar.',
      placement: 'right',
      view: 'home'
    },
    {
      id: 'loader',
      selector: '[data-tour="home-loader"]',
      titleKey: 'tour.step.loader.title',
      descKey: 'tour.step.loader.desc',
      tipKey: 'tour.step.loader.tip',
      title: '3. Cargador (Vanilla o con Mods)',
      description: 'Deja «Vanilla» para jugar normal sin mods. Si quieres usar mods .jar, elige Fabric, Forge, NeoForge o Quilt.',
      tip: 'Tu configuración, idioma, resource packs y servidores se guardan aunque cambies de versión o cargador.',
      placement: 'top',
      view: 'home'
    },
    {
      id: 'mods',
      selector: '.nav-item[data-view="mods"]',
      titleKey: 'tour.step.mods.title',
      descKey: 'tour.step.mods.desc',
      tipKey: 'tour.step.mods.tip',
      title: '4. Arrastrar tus Mods (.jar)',
      description: 'Entra aquí y arrastra tus archivos .jar. Se aplican solos al iniciar y te avisan antes de jugar si alguno no es compatible.',
      tip: 'Si un mod da conflicto con tu versión, podrás desactivarlo al instante desde el aviso.',
      placement: 'right',
      view: 'home'
    },
    {
      id: 'resourcepacks',
      selector: '.nav-item[data-view="resourcepacks"]',
      titleKey: 'tour.step.resourcepacks.title',
      descKey: 'tour.step.resourcepacks.desc',
      tipKey: 'tour.step.resourcepacks.tip',
      title: '5. Resource Packs (.zip)',
      description: 'Justo debajo de Mods puedes arrastrar tus packs de texturas (.zip) y activarlos con un clic. Se aplican solos al juego.',
      tip: 'El launcher revisa si el pack coincide con tu versión de Minecraft y lo añade a options.txt al abrir.',
      placement: 'right',
      view: 'home'
    },
    {
      id: 'players',
      selector: '.nav-item[data-view="players"]',
      titleKey: 'tour.step.players.title',
      descKey: 'tour.step.players.desc',
      tipKey: 'tour.step.players.tip',
      title: '6. Cuenta Microsoft o Modo Offline',
      description: 'Inicia sesión con tu cuenta oficial de Microsoft (Online) o crea un nombre gratis sin cuenta (Modo Offline) en segundos.',
      tip: 'El modo Offline funciona al instante para servidores no-premium o mundos locales.',
      placement: 'right',
      view: 'home'
    },
    {
      id: 'performance',
      selector: '[data-tour="home-perf"]',
      titleKey: 'tour.step.performance.title',
      descKey: 'tour.step.performance.desc',
      tipKey: 'tour.step.performance.tip',
      title: '7. Modo PvP y Ultra FPS',
      description: 'Elige con un clic cómo quieres que rinda el juego: PvP Competitivo, Ultra FPS (máximo rendimiento), Survival o Normal.',
      tip: 'Puedes ajustar más opciones o exportar tu pack en «Rendimiento y PvP».',
      placement: 'top',
      view: 'home'
    },
    {
      id: 'skins',
      selector: '.nav-item[data-view="skins"]',
      titleKey: 'tour.step.skins.title',
      descKey: 'tour.step.skins.desc',
      tipKey: 'tour.step.skins.tip',
      title: '8. Skins 3D',
      description: 'Elige o importa cualquier archivo .png para cambiar tu personaje y previsualizarlo en 3D antes de entrar a jugar.',
      tip: 'Compatible tanto con cuentas Microsoft como con perfiles Offline.',
      placement: 'right',
      view: 'home'
    },
    {
      id: 'close-and-settings',
      selector: '[data-action="cycle-close-behavior"]',
      titleKey: 'tour.step.close.title',
      descKey: 'tour.step.close.desc',
      tipKey: 'tour.step.close.tip',
      title: '9. Cerrar al jugar, Tutorial e Idioma',
      description: 'Cierra Pan Launcher mientras juegas para ahorrar memoria RAM; al salir de Minecraft, volverá a aparecer solo.',
      tip: 'Arriba siempre tienes los botones de Idioma (ES/EN) y «? Tutorial» por si quieres cambiar idioma o repetir la guía.',
      placement: 'bottom',
      view: 'home'
    }
  ]);

  function clampStepIndex(index, total) {
    if (!Number.isFinite(total) || total <= 0) return 0;
    const n = Math.trunc(Number.isFinite(index) ? index : 0);
    if (n < 0) return 0;
    if (n >= total) return total - 1;
    return n;
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, val) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, val);
    } catch {
      // Ignora error de cuota o modo privado
    }
  }

  function shouldAutoStart(search) {
    const q = String(search !== undefined ? search : (window.location && window.location.search) || '');
    if (/[?&]notour=1(?:&|$)/i.test(q)) return false;
    if (/[?&]tour=1(?:&|$)/i.test(q)) return true;
    return !safeStorageGet(STORAGE_KEY);
  }

  function computePopoverPosition(targetRect, popoverSize, viewport, preferredPlacement) {
    const pref = preferredPlacement || 'bottom';
    const pad = 14;
    const gap = 16;
    const maxLeft = Math.max(pad, viewport.width - popoverSize.width - pad);
    const maxTop = Math.max(pad, viewport.height - popoverSize.height - pad);

    const cx = targetRect.left + targetRect.width / 2;
    const cy = targetRect.top + targetRect.height / 2;

    const fits = {
      right: targetRect.left + targetRect.width + gap + popoverSize.width + pad <= viewport.width,
      left: targetRect.left - gap - popoverSize.width - pad >= 0,
      bottom: targetRect.top + targetRect.height + gap + popoverSize.height + pad <= viewport.height,
      top: targetRect.top - gap - popoverSize.height - pad >= 0
    };

    let placement = pref;
    if (!fits[placement]) {
      const order =
        pref === 'right'
          ? ['right', 'bottom', 'top', 'left']
          : pref === 'left'
            ? ['left', 'bottom', 'top', 'right']
            : pref === 'top'
              ? ['top', 'bottom', 'right', 'left']
              : ['bottom', 'top', 'right', 'left'];
      placement = order.find((p) => fits[p])
        || (viewport.height - (targetRect.top + targetRect.height) >= targetRect.top ? 'bottom' : 'top');
    }

    let rawLeft = cx - popoverSize.width / 2;
    let rawTop = targetRect.top + targetRect.height + gap;

    if (placement === 'right') {
      rawLeft = targetRect.left + targetRect.width + gap;
      rawTop = cy - popoverSize.height / 2;
    } else if (placement === 'left') {
      rawLeft = targetRect.left - popoverSize.width - gap;
      rawTop = cy - popoverSize.height / 2;
    } else if (placement === 'top') {
      rawLeft = cx - popoverSize.width / 2;
      rawTop = targetRect.top - popoverSize.height - gap;
    } else {
      rawLeft = cx - popoverSize.width / 2;
      rawTop = targetRect.top + targetRect.height + gap;
    }

    const left = Math.min(maxLeft, Math.max(pad, Math.round(rawLeft)));
    const top = Math.min(maxTop, Math.max(pad, Math.round(rawTop)));
    const arrowX = Math.max(20, Math.min(popoverSize.width - 20, Math.round(cx - left)));
    const arrowY = Math.max(20, Math.min(popoverSize.height - 20, Math.round(cy - top)));

    return { left, top, placement, arrowX, arrowY };
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let activeIndex = 0;
  let layerEl = null;
  let cleanupListeners = null;

  function stop(markSeen) {
    if (markSeen !== false) {
      safeStorageSet(STORAGE_KEY, 'done');
    }
    if (cleanupListeners) {
      cleanupListeners();
      cleanupListeners = null;
    }
    if (layerEl) {
      layerEl.remove();
      layerEl = null;
    }
  }

  function getTargetElement(step) {
    if (!step || !step.selector) return null;
    const node = document.querySelector(step.selector);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return node;
  }

  function positionStep(shouldScroll) {
    if (!layerEl) return;
    const step = STEPS[activeIndex];
    if (!step) return;

    const target = getTargetElement(step);
    const spotlight = layerEl.querySelector('.pan-tour-spotlight');
    const popover = layerEl.querySelector('.pan-tour-popover');
    if (!spotlight || !popover) return;

    if (target && shouldScroll) {
      try {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      } catch {
        // Ignora en navegadores sin opciones
      }
    }

    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const rect = target
      ? target.getBoundingClientRect()
      : { left: vw / 2 - 80, top: vh / 2 - 24, width: 160, height: 48 };

    const pad = 6;
    const spotLeft = Math.max(4, Math.round(rect.left - pad));
    const spotTop = Math.max(4, Math.round(rect.top - pad));
    const spotWidth = Math.min(vw - 8, Math.round(rect.width + pad * 2));
    const spotHeight = Math.min(vh - 8, Math.round(rect.height + pad * 2));

    spotlight.style.left = `${spotLeft}px`;
    spotlight.style.top = `${spotTop}px`;
    spotlight.style.width = `${spotWidth}px`;
    spotlight.style.height = `${spotHeight}px`;

    const popRect = popover.getBoundingClientRect();
    const popWidth = Math.min(vw - 24, popRect.width || 350);
    const popHeight = popRect.height || 220;

    const layout = computePopoverPosition(
      { left: spotLeft, top: spotTop, width: spotWidth, height: spotHeight },
      { width: popWidth, height: popHeight },
      { width: vw, height: vh },
      step.placement || 'bottom'
    );

    popover.style.left = `${layout.left}px`;
    popover.style.top = `${layout.top}px`;
    popover.setAttribute('data-placement', layout.placement);
    popover.style.setProperty('--tour-arrow-x', `${layout.arrowX}px`);
    popover.style.setProperty('--tour-arrow-y', `${layout.arrowY}px`);
  }

  function renderStep(scrollTarget) {
    if (!layerEl) return;
    const step = STEPS[activeIndex];
    const isFirst = activeIndex === 0;
    const isLast = activeIndex === STEPS.length - 1;
    const popover = layerEl.querySelector('.pan-tour-popover');
    if (!popover) return;

    const stepBadge = tr('tour.stepBadge', { current: activeIndex + 1, total: STEPS.length }, `Guía rápida · Paso ${activeIndex + 1} de ${STEPS.length}`);
    const skipText = tr('tour.skip', null, 'Saltar ✕');
    const closeAria = tr('tour.closeAria', null, 'Cerrar presentación');
    const prevText = tr('tour.prev', null, '← Anterior');
    const nextText = isLast ? tr('tour.finish', null, '¡Listo, empezar!') : tr('tour.next', null, 'Siguiente →');
    const stepTitle = tr(step.titleKey, null, step.title);
    const stepDesc = tr(step.descKey, null, step.description);
    const stepTip = step.tipKey ? tr(step.tipKey, null, step.tip) : step.tip;

    popover.innerHTML = `
      <div class="pan-tour-arrow" aria-hidden="true"></div>
      <div class="pan-tour-head">
        <span class="badge badge-release">${escapeHtml(stepBadge)}</span>
        <button type="button" class="btn btn-xs btn-ghost pan-tour-close" data-tour-action="skip" aria-label="${escapeHtml(closeAria)}">${escapeHtml(skipText)}</button>
      </div>
      <h3 id="pan-tour-title">${escapeHtml(stepTitle)}</h3>
      <p class="pan-tour-desc">${escapeHtml(stepDesc)}</p>
      ${stepTip ? `<p class="pan-tour-tip">${escapeHtml(stepTip)}</p>` : ''}
      <div class="pan-tour-dots" aria-hidden="true">
        ${STEPS.map((s, idx) => `<span class="pan-tour-dot${idx === activeIndex ? ' active' : idx < activeIndex ? ' done' : ''}"></span>`).join('')}
      </div>
      <div class="pan-tour-actions">
        <button type="button" class="btn btn-sm" data-tour-action="prev" ${isFirst ? 'disabled' : ''}>${escapeHtml(prevText)}</button>
        <button type="button" class="btn btn-primary btn-sm" data-tour-action="${isLast ? 'finish' : 'next'}">
          ${escapeHtml(nextText)}
        </button>
      </div>`;

    positionStep(scrollTarget);
  }

  function ensureLayer() {
    if (layerEl && document.body.contains(layerEl)) return;
    const existing = document.getElementById('pan-tour-layer');
    if (existing) existing.remove();

    layerEl = document.createElement('div');
    layerEl.id = 'pan-tour-layer';
    layerEl.className = 'pan-tour-layer';
    layerEl.setAttribute('role', 'dialog');
    layerEl.setAttribute('aria-modal', 'true');
    layerEl.setAttribute('aria-labelledby', 'pan-tour-title');
    layerEl.innerHTML = `
      <div class="pan-tour-backdrop" data-tour-action="backdrop"></div>
      <div class="pan-tour-spotlight" aria-hidden="true"></div>
      <div class="pan-tour-popover" data-placement="bottom"></div>`;

    layerEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tour-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-tour-action');
      if (action === 'skip' || action === 'finish') {
        stop(true);
      } else if (action === 'next') {
        activeIndex = clampStepIndex(activeIndex + 1, STEPS.length);
        renderStep(true);
      } else if (action === 'prev') {
        activeIndex = clampStepIndex(activeIndex - 1, STEPS.length);
        renderStep(true);
      }
    });

    const onKeyDown = (event) => {
      if (!layerEl) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        stop(true);
      } else if (event.key === 'ArrowRight') {
        if (activeIndex < STEPS.length - 1) {
          activeIndex += 1;
          renderStep(true);
        } else {
          stop(true);
        }
      } else if (event.key === 'ArrowLeft') {
        if (activeIndex > 0) {
          activeIndex -= 1;
          renderStep(true);
        }
      }
    };
    const onReposition = () => positionStep(false);
    const viewRoot = document.getElementById('view-root');

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    if (viewRoot) viewRoot.addEventListener('scroll', onReposition, { passive: true });

    cleanupListeners = () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      if (viewRoot) viewRoot.removeEventListener('scroll', onReposition);
    };

    document.body.appendChild(layerEl);
  }

  function start(forceOrStartIndex) {
    const startIdx = typeof forceOrStartIndex === 'number' ? clampStepIndex(forceOrStartIndex, STEPS.length) : 0;
    activeIndex = startIdx;

    if (Nexus.router && Nexus.router.current !== 'home') {
      Nexus.router.navigate('home');
      window.setTimeout(() => {
        ensureLayer();
        renderStep(true);
      }, 90);
      return;
    }

    ensureLayer();
    renderStep(true);
  }

  Nexus.tour = Object.freeze({
    steps: STEPS,
    storageKey: STORAGE_KEY,
    clampStepIndex,
    shouldAutoStart,
    computePopoverPosition,
    start,
    stop,
    reposition: () => positionStep(false),
    isActive: () => Boolean(layerEl),
    getActiveIndex: () => activeIndex
  });
})();
