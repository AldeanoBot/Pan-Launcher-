import {
  Cpu,
  Gauge,
  Globe,
  Layers,
  Monitor,
  UserCheck,
} from 'lucide-react';
import type { AccountProfile, HardwareTier, NavSection } from '../types/client';
import { PLAYER_AVATAR_IMG } from '../data/catalog';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  activeAccount: AccountProfile;
  hardwareTier: HardwareTier;
  onChangeHardwareTier: (tier: HardwareTier) => void;
  estimatedFps: number;
  activeModsCount: number;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof Gauge }> = [
  { id: 'launcher', label: 'Lanzador FPS', icon: Gauge },
  { id: 'multiplayer', label: 'Multijugador', icon: Globe },
  { id: 'mods', label: 'Motor de Mods', icon: Layers },
  { id: 'hud', label: 'HUD y Vídeo', icon: Monitor },
  { id: 'accounts', label: 'Descargar PC y Cuentas', icon: UserCheck },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  activeAccount,
  hardwareTier,
  onChangeHardwareTier,
  estimatedFps,
  activeModsCount,
}: SidebarProps) {
  return (
    <aside className="w-64 shrink-0 bg-[#101318] border-r border-[#1E242E] flex flex-col justify-between min-h-screen select-none">
      <div>
        {/* Brand Wordmark */}
        <div className="h-16 px-5 flex items-center gap-3 border-b border-[#1E242E]">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2L20 6.5V17.5L12 22L4 17.5V6.5L12 2Z"
                stroke="#10B981"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M12 22V12M12 12L20 6.5M12 12L4 6.5" stroke="#10B981" strokeWidth="1.75" />
            </svg>
          </div>
          <div className="min-w-0">
            <span className="font-display font-bold text-lg tracking-tight text-white block leading-none">
              Pan-launcher
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Navegación principal" className="p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  isActive
                    ? 'bg-[#19212B] text-white border border-[#283241]'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-[#161B22] border border-transparent'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-zinc-500'}`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Hardware Profile Calibration */}
        <div className="px-4 pt-4 mt-2 border-t border-[#1E242E]">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
              Perfil de tu equipo
            </span>
          </div>
          <div
            role="group"
            aria-label="Seleccionar nivel de hardware"
            className="grid grid-cols-3 gap-1 p-1 bg-[#0B0D10] rounded-lg border border-[#1E242E]"
          >
            {(
              [
                { id: 'low', label: 'Básico' },
                { id: 'mid', label: 'Medio' },
                { id: 'high', label: 'Alto' },
              ] as const
            ).map((tier) => {
              const selected = hardwareTier === tier.id;
              return (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => onChangeHardwareTier(tier.id)}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    selected
                      ? 'bg-[#1E2530] text-emerald-400'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tier.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-400 tabular-nums">
            <span>Estimado:</span>
            <span className="font-mono font-semibold text-emerald-400">
              {estimatedFps} FPS · {activeModsCount} mods
            </span>
          </div>
        </div>
      </div>

      {/* Active Account Footer Card */}
      <div className="p-3 border-t border-[#1E242E]">
        <button
          type="button"
          onClick={() => onSelectSection('accounts')}
          className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-[#141920] hover:bg-[#192029] border border-[#222A35] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={`Cuenta activa ${activeAccount.username}, abrir gestor de cuentas`}
        >
          <div className="w-9 h-9 rounded-md overflow-hidden bg-[#1D242E] shrink-0 border border-[#2B3544]">
            <img
              src={PLAYER_AVATAR_IMG}
              alt={`Avatar de ${activeAccount.username}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{activeAccount.username}</div>
            <div className="text-xs text-zinc-400 truncate">
              {activeAccount.type === 'offline'
                ? 'Sin conexión · Offline'
                : activeAccount.type === 'elyby'
                ? 'Cuenta Ely.by'
                : 'Cuenta Microsoft'}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}
