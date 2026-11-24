import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Search, Zap } from 'lucide-react';
import type { ModCategory, PerfMod, PerformanceEstimate } from '../types/client';

interface ModsViewProps {
  mods: PerfMod[];
  estimate: PerformanceEstimate;
  onToggleMod: (id: string) => void;
  onApplyOptimalStack: () => void;
  onResolveConflicts: () => void;
}

const CATEGORY_LABELS: Record<ModCategory, string> = {
  render: 'Renderizado',
  cpu: 'CPU y Chunks',
  memory: 'Memoria RAM',
  network: 'Red y Paquetes',
};

export function ModsView({
  mods,
  estimate,
  onToggleMod,
  onApplyOptimalStack,
  onResolveConflicts,
}: ModsViewProps) {
  const [category, setCategory] = useState<'all' | ModCategory>('all');
  const [search, setSearch] = useState('');

  const filteredMods = mods.filter((mod) => {
    if (category !== 'all' && mod.category !== category) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        mod.name.toLowerCase().includes(q) ||
        mod.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Motor de Mods de Rendimiento
          </h1>
          <p className="text-sm text-zinc-400 mt-1 tabular-nums">
            {estimate.activeModsCount} mods activos · +{estimate.fpsGainPercent}% FPS proyectados · {estimate.ramSavedMb} MB RAM ahorrada
          </p>
        </div>

        <button
          type="button"
          onClick={onApplyOptimalStack}
          className="h-10 px-4 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center gap-2 whitespace-nowrap self-start lg:self-auto"
        >
          <Zap className="w-4 h-4 fill-current" aria-hidden="true" />
          Aplicar Stack Máximo FPS
        </button>
      </div>

      {/* Conflict Alert */}
      {estimate.conflicts.length > 0 && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-sm text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold">Incompatibilidad activa: </span>
              {estimate.conflicts.map((c) => c.label).join(' · ')}
            </div>
          </div>
          <button
            type="button"
            onClick={onResolveConflicts}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-amber-950 bg-amber-400 hover:bg-amber-300 whitespace-nowrap shrink-0"
          >
            Resolver automáticamente
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#12161C] rounded-lg border border-[#1E242E]">
          {(
            [
              { id: 'all', label: 'Todos' },
              { id: 'render', label: 'Renderizado' },
              { id: 'cpu', label: 'CPU y Chunks' },
              { id: 'memory', label: 'Memoria RAM' },
              { id: 'network', label: 'Red' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                category === tab.id
                  ? 'bg-[#1D2430] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor="mod-search-input" className="sr-only">
            Buscar mods de rendimiento
          </label>
          <input
            id="mod-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar mod..."
            className="h-9 pl-9 pr-3 w-full sm:w-64 rounded-lg bg-[#12161C] border border-[#1E242E] text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
        </div>
      </div>

      {/* Mods List */}
      <section className="rounded-xl bg-[#12161C] border border-[#1E242E] divide-y divide-[#1E242E] overflow-hidden">
        {filteredMods.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-zinc-200">No se encontraron mods.</p>
            <p className="text-xs text-zinc-400 mt-1">Prueba otro término o cambia la categoría.</p>
          </div>
        ) : (
          filteredMods.map((mod) => {
            const hasConflict = estimate.conflicts.some(
              (c) => c.modA === mod.id || c.modB === mod.id
            );
            return (
              <div
                key={mod.id}
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#161B22] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h2 className="text-sm font-semibold text-white">{mod.name}</h2>
                    <span className="text-xs font-mono text-zinc-400">v{mod.version}</span>
                    <span className="text-zinc-600" aria-hidden="true">·</span>
                    <span className="text-xs text-zinc-400">{CATEGORY_LABELS[mod.category]}</span>
                    <span className="text-zinc-600" aria-hidden="true">·</span>
                    <span className="text-xs text-zinc-500">{mod.loaders.join(' / ')}</span>
                    {hasConflict && (
                      <>
                        <span className="text-zinc-600" aria-hidden="true">·</span>
                        <span className="text-xs font-medium text-amber-400">
                          Conflicto activo
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400 leading-relaxed max-w-3xl">
                    {mod.description}
                  </p>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 shrink-0 tabular-nums">
                  <div className="text-right">
                    <div className="text-xs font-mono font-semibold text-emerald-400">
                      +{mod.fpsBoostPercent}% FPS
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400">
                      -{mod.ramSavedMb} MB RAM
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={mod.enabled}
                    aria-label={`${mod.enabled ? 'Desactivar' : 'Activar'} ${mod.name}`}
                    onClick={() => onToggleMod(mod.id)}
                    className={`h-8 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      mod.enabled
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-[#0E1116] border-[#283241] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {mod.enabled && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                    {mod.enabled ? 'Activo' : 'Activar'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
