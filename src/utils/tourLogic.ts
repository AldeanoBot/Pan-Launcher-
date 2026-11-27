export interface TourStepDef {
  id: string;
  selector: string;
  title: string;
  description: string;
  tip?: string;
  placement?: 'right' | 'bottom' | 'top' | 'left';
  view?: string;
}

export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PopoverLayout {
  left: number;
  top: number;
  placement: 'right' | 'bottom' | 'top' | 'left';
  arrowX: number;
  arrowY: number;
}

export const TOUR_STORAGE_KEY = 'pan_launcher_tour_v1';

export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'play',
    selector: '[data-action="play"]',
    title: '1. Botón JUGAR',
    description: 'Es el botón principal para abrir Minecraft. Cuando tengas tu versión instalada y un jugador elegido, se activará en dorado.',
    tip: 'Si algo falta antes de jugar, justo debajo verás botones directos para solucionarlo en un clic.',
    placement: 'bottom',
    view: 'home',
  },
  {
    id: 'versions',
    selector: '.nav-item[data-view="versions"]',
    title: '2. Versiones oficiales',
    description: 'Aquí descargas cualquier versión de Minecraft Java (como 1.21.4, 1.20.1 o 26.3) directamente desde Mojang.',
    tip: 'Pulsa «Instalar» en la versión que quieras y luego «Elegir» para usarla al jugar.',
    placement: 'right',
    view: 'home',
  },
  {
    id: 'loader',
    selector: '[data-tour="home-loader"]',
    title: '3. Cargador (Vanilla o con Mods)',
    description: 'Deja «Vanilla» para jugar normal sin mods. Si quieres usar mods .jar, elige Fabric, Forge, NeoForge o Quilt.',
    tip: 'Tu configuración, idioma y servidores se guardan aunque cambies de versión o cargador.',
    placement: 'top',
    view: 'home',
  },
  {
    id: 'mods',
    selector: '.nav-item[data-view="mods"]',
    title: '4. Arrastrar tus Mods (.jar)',
    description: 'Entra aquí y arrastra tus archivos .jar. Se aplican solos al iniciar y te avisan antes de jugar si alguno no es compatible.',
    tip: 'Si un mod da conflicto con tu versión, podrás desactivarlo al instante desde el aviso.',
    placement: 'right',
    view: 'home',
  },
  {
    id: 'players',
    selector: '.nav-item[data-view="players"]',
    title: '5. Cuenta Microsoft o Modo Offline',
    description: 'Inicia sesión con tu cuenta oficial de Microsoft (Online) o crea un nombre gratis sin cuenta (Modo Offline) en segundos.',
    tip: 'El modo Offline funciona al instante para servidores no-premium o mundos locales.',
    placement: 'right',
    view: 'home',
  },
  {
    id: 'performance',
    selector: '[data-tour="home-perf"]',
    title: '6. Modo PvP y Ultra FPS',
    description: 'Elige con un clic cómo quieres que rinda el juego: PvP Competitivo, Ultra FPS (máximo rendimiento), Survival o Normal.',
    tip: 'Puedes ajustar más opciones o exportar tu pack en «Rendimiento y PvP».',
    placement: 'top',
    view: 'home',
  },
  {
    id: 'skins',
    selector: '.nav-item[data-view="skins"]',
    title: '7. Skins 3D',
    description: 'Elige o importa cualquier archivo .png para cambiar tu personaje y previsualizarlo en 3D antes de entrar a jugar.',
    tip: 'Compatible tanto con cuentas Microsoft como con perfiles Offline.',
    placement: 'right',
    view: 'home',
  },
  {
    id: 'close-and-settings',
    selector: '[data-action="cycle-close-behavior"]',
    title: '8. Cerrar launcher al jugar y Ajustes',
    description: 'Cierra Pan Launcher mientras juegas para ahorrar memoria RAM; al salir de Minecraft, volverá a aparecer solo.',
    tip: '¿Quieres volver a ver esta guía más adelante? Pulsa «? Tutorial» arriba o abre Ajustes.',
    placement: 'bottom',
    view: 'home',
  },
];

export function clampStepIndex(index: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const n = Math.trunc(Number.isFinite(index) ? index : 0);
  if (n < 0) return 0;
  if (n >= total) return total - 1;
  return n;
}

export function shouldAutoStartTour(storageValue: string | null | undefined, search: string): boolean {
  const q = String(search || '');
  if (/[?&]notour=1(?:&|$)/i.test(q)) return false;
  if (/[?&]tour=1(?:&|$)/i.test(q)) return true;
  return !storageValue;
}

export function computePopoverPosition(
  targetRect: RectBox,
  popoverSize: { width: number; height: number },
  viewport: ViewportSize,
  preferredPlacement: 'right' | 'bottom' | 'top' | 'left' = 'bottom'
): PopoverLayout {
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
    top: targetRect.top - gap - popoverSize.height - pad >= 0,
  };

  let placement = preferredPlacement;
  if (!fits[placement]) {
    const order: Array<'bottom' | 'top' | 'right' | 'left'> =
      preferredPlacement === 'right'
        ? ['right', 'bottom', 'top', 'left']
        : preferredPlacement === 'left'
          ? ['left', 'bottom', 'top', 'right']
          : preferredPlacement === 'top'
            ? ['top', 'bottom', 'right', 'left']
            : ['bottom', 'top', 'right', 'left'];
    placement = order.find((p) => fits[p]) || (viewport.height - (targetRect.top + targetRect.height) >= targetRect.top ? 'bottom' : 'top');
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
