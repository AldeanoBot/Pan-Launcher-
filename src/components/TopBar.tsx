import { Download, Menu, Play } from 'lucide-react';
import type { NavSection } from '../types/client';

interface TopBarProps {
  activeSection: NavSection;
  profileName: string;
  isInstalled: boolean;
  canLaunchJava: boolean | null;
  onOpenInstallApp: () => void;
  onLaunchGame: () => void;
  onOpenMobileMenu: () => void;
}

const SECTION_TITLES: Record<NavSection, string> = {
  launcher: 'Lanzador FPS',
  multiplayer: 'Multijugador',
  mods: 'Motor de Mods',
  hud: 'HUD y Vídeo',
  accounts: 'Descargar PC y Cuentas',
};

export function TopBar({
  activeSection,
  profileName,
  isInstalled,
  canLaunchJava,
  onOpenInstallApp,
  onLaunchGame,
  onOpenMobileMenu,
}: TopBarProps) {
  const showDownloadButton = !isInstalled && canLaunchJava !== true;

  return (
    <header className="h-16 px-4 md:px-7 bg-[#0E1116] border-b border-[#1E242E] flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Abrir menú lateral"
          className="lg:hidden p-2 rounded-lg text-zinc-300 hover:bg-[#192029] border border-[#232A34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <nav aria-label="Ruta actual" className="flex items-center gap-2 text-sm min-w-0 truncate">
          <span className="hidden sm:inline text-zinc-400 font-medium whitespace-nowrap">Pan-launcher</span>
          <span className="hidden sm:inline text-zinc-600" aria-hidden="true">/</span>
          <span className="text-white font-semibold whitespace-nowrap truncate">
            {SECTION_TITLES[activeSection]}
          </span>
          <span className="hidden md:inline text-zinc-600" aria-hidden="true">·</span>
          <span className="hidden md:inline text-zinc-400 truncate max-w-[200px]">
            {profileName}
          </span>
        </nav>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        {showDownloadButton && (
          <button
            type="button"
            onClick={onOpenInstallApp}
            aria-label="Descargar como App"
            className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg text-sm font-medium text-zinc-200 bg-[#161B22] hover:bg-[#1E2530] border border-[#283241] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Download className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Descargar Instalador</span>
            <span className="sm:hidden">Instalar</span>
          </button>
        )}
        <button
          type="button"
          onClick={onLaunchGame}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-[#06120D] bg-emerald-500 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <Play className="w-4 h-4 fill-current" aria-hidden="true" />
          Jugar ahora
        </button>
      </div>
    </header>
  );
}
