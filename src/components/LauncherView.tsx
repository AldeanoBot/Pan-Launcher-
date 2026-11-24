import { useState } from 'react';
import { Check, Copy, Plus, SlidersHorizontal, Sparkles, Terminal, Trash2 } from 'lucide-react';
import type {
  ClientProfile,
  GarbageCollector,
  ModLoader,
  PerformanceEstimate,
} from '../types/client';
import { HERO_BACKDROP_IMG } from '../data/catalog';
import { generateJvmArgs } from '../utils/fpsEngine';

interface LauncherViewProps {
  profiles: ClientProfile[];
  activeProfile: ClientProfile;
  availableVersions: string[];
  estimate: PerformanceEstimate;
  onSelectProfile: (id: string) => void;
  onCreateProfile: (name: string, mcVersion: string, loader: ModLoader, presetId: ClientProfile['presetId']) => void;
  onDeleteProfile: (id: string) => void;
  onApplyPreset: (presetId: ClientProfile['presetId']) => void;
  onUpdateJvm: (patch: Partial<ClientProfile['jvm']>) => void;
  onNavigateMods: () => void;
}

const PRESETS: Array<{
  id: ClientProfile['presetId'];
  name: string;
  summary: string;
}> = [
  {
    id: 'pvp',
    name: 'Competitivo PvP',
    summary: '8 chunks · Gráficos rápidos · Sin sombras · Fullbright',
  },
  {
    id: 'survival',
    name: 'Survival Fluido',
    summary: '14 chunks · Iluminación suave · Nubes rápidas',
  },
  {
    id: 'potato',
    name: 'PC Bajos Recursos',
    summary: '5 chunks · Partículas mínimas · Máximo ahorro RAM',
  },
  {
    id: 'shaders',
    name: 'Shaders y Visual',
    summary: '12 chunks · Sombras activas · Calidad fabulosa',
  },
];

export function LauncherView({
  profiles,
  activeProfile,
  availableVersions,
  estimate,
  onSelectProfile,
  onCreateProfile,
  onDeleteProfile,
  onApplyPreset,
  onUpdateJvm,
  onNavigateMods,
}: LauncherViewProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVersion, setNewVersion] = useState(availableVersions[0] || '1.21.4');
  const [newLoader, setNewLoader] = useState<ModLoader>('Fabric');
  const [newPreset, setNewPreset] = useState<ClientProfile['presetId']>('pvp');
  const [formError, setFormError] = useState('');
  const [copiedFlags, setCopiedFlags] = useState(false);

  const jvmFlags = generateJvmArgs(activeProfile.jvm);
  const jvmFlagsText = jvmFlags.join(' ');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setFormError('Escribe un nombre para la instancia.');
      return;
    }
    onCreateProfile(newName.trim(), newVersion, newLoader, newPreset);
    setNewName('');
    setFormError('');
    setShowNewForm(false);
  };

  const handleCopyFlags = async () => {
    try {
      await navigator.clipboard.writeText(jvmFlagsText);
      setCopiedFlags(true);
      setTimeout(() => setCopiedFlags(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  // Compute clean comparison percentages for the Vanilla vs Pan-launcher chart
  const maxBar = Math.max(estimate.estimatedFps, estimate.vanillaFps, 120);
  const vanillaPct = Math.round((estimate.vanillaFps / maxBar) * 100);
  const panPct = Math.round((estimate.estimatedFps / maxBar) * 100);

  return (
    <div className="space-y-6">
      {/* Hero Instance Showcase */}
      <section className="relative rounded-xl overflow-hidden border border-[#222A35] bg-[#12161C]">
        <div className="relative min-h-[240px] flex flex-col justify-end p-6 md:p-8">
          <img
            src={HERO_BACKDROP_IMG}
            alt="Paisaje voxel nocturno de Pan-launcher"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#0B0D10] via-[#0B0D10]/75 to-[#0B0D10]/30"
            aria-hidden="true"
          />

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-emerald-400 mb-2">
                {activeProfile.mcVersion} · {activeProfile.loader} · Última sesión: {activeProfile.lastPlayed}
              </p>
              <h1 className="font-display text-2xl md:text-4xl font-bold text-white tracking-tight text-balance">
                {activeProfile.name}
              </h1>
              <p className="mt-2 text-sm md:text-base text-zinc-300 max-w-xl leading-relaxed">
                Motor gráfico optimizado con Sodium, Lithium y recolector {activeProfile.jvm.gc} para reducir tirones y multiplicar los FPS frente al cliente estándar.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3 shrink-0">
              <div className="flex flex-col">
                <label htmlFor="profile-select" className="text-xs text-zinc-400 mb-1">
                  Instancia activa
                </label>
                <select
                  id="profile-select"
                  value={activeProfile.id}
                  onChange={(e) => onSelectProfile(e.target.value)}
                  className="h-10 px-3 rounded-lg bg-[#141920]/95 border border-[#2B3544] text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mcVersion})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowNewForm((prev) => !prev)}
                className="h-10 px-3.5 rounded-lg text-sm font-medium text-zinc-200 bg-[#181E27]/95 hover:bg-[#212936] border border-[#2C3646] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Nueva instancia
              </button>

              {profiles.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteProfile(activeProfile.id)}
                  aria-label={`Eliminar instancia ${activeProfile.name}`}
                  className="h-10 px-3 rounded-lg text-sm font-medium text-zinc-400 hover:text-red-400 bg-[#181E27]/95 hover:bg-[#23191D] border border-[#2C3646] inline-flex items-center transition-colors"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inline New Instance Form */}
        {showNewForm && (
          <form
            onSubmit={handleCreateSubmit}
            className="p-5 border-t border-[#222A35] bg-[#10141A] grid grid-cols-1 md:grid-cols-5 gap-4 items-end"
          >
            <div className="md:col-span-2">
              <label htmlFor="new-inst-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Nombre de la instancia
              </label>
              <input
                id="new-inst-name"
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="Ej. SkyWars 1.21.4 Ultra FPS"
                className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              />
            </div>

            <div>
              <label htmlFor="new-inst-version" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Versión
              </label>
              <select
                id="new-inst-version"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {availableVersions.map((ver) => (
                  <option key={ver} value={ver}>
                    {ver}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-inst-loader" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Motor / Loader
              </label>
              <select
                id="new-inst-loader"
                value={newLoader}
                onChange={(e) => setNewLoader(e.target.value as ModLoader)}
                className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <option value="Fabric">Fabric (Máx. FPS)</option>
                <option value="NeoForge">NeoForge</option>
                <option value="Quilt">Quilt</option>
                <option value="Vanilla+">Vanilla+</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="h-10 flex-1 px-4 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 transition-colors whitespace-nowrap"
              >
                Crear perfil
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewForm(false);
                  setFormError('');
                }}
                className="h-10 px-3 rounded-lg text-sm font-medium text-zinc-400 hover:text-white bg-[#171C24] border border-[#283241] whitespace-nowrap"
              >
                Cancelar
              </button>
            </div>

            <div className="md:col-span-5 flex flex-wrap items-center gap-3 pt-1">
              <span className="text-xs text-zinc-400">Perfil inicial:</span>
              {PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => setNewPreset(pr.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    newPreset === pr.id
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-[#0B0D10] border-[#242C38] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {pr.name}
                </button>
              ))}
              {formError && <p className="text-xs text-red-400 ml-auto">{formError}</p>}
            </div>
          </form>
        )}
      </section>

      {/* Conflict Alert if incompatible mods enabled */}
      {estimate.conflicts.length > 0 && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="text-sm text-amber-200">
            <span className="font-semibold">Conflicto de mods detectado: </span>
            {estimate.conflicts.map((c) => c.label).join(' · ')}. Esto reduce el rendimiento estimado.
          </div>
          <button
            type="button"
            onClick={onNavigateMods}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-amber-950 bg-amber-400 hover:bg-amber-300 whitespace-nowrap shrink-0"
          >
            Revisar en Motor de Mods
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <section aria-label="Resumen de rendimiento" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-[#12161C] border border-[#1E242E]">
          <div className="text-xs font-medium text-zinc-400">FPS Proyectados (Pan-launcher)</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
            <span className="font-display text-3xl font-bold text-white whitespace-nowrap">
              {estimate.estimatedFps}
            </span>
            <span className="text-xs font-mono font-medium text-emerald-400 whitespace-nowrap">
              {estimate.fpsGainPercent >= 0 ? `+${estimate.fpsGainPercent}%` : `${estimate.fpsGainPercent}%`} vs Vanilla ({estimate.vanillaFps})
            </span>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#12161C] border border-[#1E242E]">
          <div className="text-xs font-medium text-zinc-400">Tiempo de Fotograma</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
            <span className="font-display text-3xl font-bold text-white whitespace-nowrap">
              {estimate.frameTimeMs} ms
            </span>
            <span className="text-xs font-mono text-zinc-400 whitespace-nowrap">
              Vanilla: {estimate.vanillaFrameTimeMs} ms
            </span>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#12161C] border border-[#1E242E]">
          <div className="text-xs font-medium text-zinc-400">Ahorro de Memoria RAM</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 tabular-nums">
            <span className="font-display text-3xl font-bold text-white whitespace-nowrap">
              {estimate.ramSavedMb} MB
            </span>
            <span className="text-xs font-mono text-zinc-400 whitespace-nowrap">
              Asignada: {activeProfile.jvm.ramGb} GB
            </span>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#12161C] border border-[#1E242E]">
          <div className="text-xs font-medium text-zinc-400">Mods de Rendimiento</div>
          <div className="mt-2 flex items-baseline justify-between gap-2 tabular-nums">
            <span className="font-display text-3xl font-bold text-white whitespace-nowrap">
              {estimate.activeModsCount} activos
            </span>
            <button
              type="button"
              onClick={onNavigateMods}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4 whitespace-nowrap"
            >
              Configurar
            </button>
          </div>
        </div>
      </section>

      {/* Main 2-Column Optimization Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Optimization Presets + Comparison Chart */}
        <div className="xl:col-span-7 space-y-6">
          {/* Quick Optimization Presets */}
          <section className="p-6 rounded-xl bg-[#12161C] border border-[#1E242E]">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  Perfiles de optimización rápida
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Ajusta distancia de renderizado, partículas, iluminación y culling con un clic.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRESETS.map((preset) => {
                const isSelected = activeProfile.presetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onApplyPreset(preset.id)}
                    className={`p-4 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      isSelected
                        ? 'bg-emerald-500/10 border-emerald-500/60'
                        : 'bg-[#0E1116] border-[#222A35] hover:border-[#344052]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">{preset.name}</span>
                      {isSelected && (
                        <span className="text-xs font-medium text-emerald-400">Activo</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">{preset.summary}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Vanilla vs Pan-launcher FPS Comparison */}
          <section className="p-6 rounded-xl bg-[#12161C] border border-[#1E242E]">
            <h2 className="font-display text-lg font-semibold text-white mb-1">
              Comparativa de rendimiento frente a Minecraft Vanilla
            </h2>
            <p className="text-xs text-zinc-400 mb-5">
              Cálculo en tiempo real según tu perfil de equipo, distancia de chunks ({activeProfile.video.renderDistance}) y mods habilitados.
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5 tabular-nums">
                  <span className="text-zinc-300 font-medium">
                    Pan-launcher ({activeProfile.loader} · {activeProfile.jvm.gc})
                  </span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {estimate.estimatedFps} FPS · {estimate.frameTimeMs} ms
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-[#0B0D10] border border-[#1E242E] overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(8, panPct)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5 tabular-nums">
                  <span className="text-zinc-400">Minecraft Vanilla (Sin optimizaciones)</span>
                  <span className="font-mono text-zinc-400">
                    {estimate.vanillaFps} FPS · {estimate.vanillaFrameTimeMs} ms
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-[#0B0D10] border border-[#1E242E] overflow-hidden">
                  <div
                    className="h-full bg-zinc-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(8, vanillaPct)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#1E242E] grid grid-cols-3 gap-4 text-xs tabular-nums">
              <div>
                <span className="text-zinc-400 block">Chunks activos</span>
                <span className="text-white font-mono font-semibold mt-0.5 block">
                  {activeProfile.video.renderDistance} chunks
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block">Sombras entidades</span>
                <span className="text-white font-mono font-semibold mt-0.5 block">
                  {activeProfile.video.entityShadows ? 'Activadas' : 'Desactivadas'}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block">Iluminación suave</span>
                <span className="text-white font-mono font-semibold mt-0.5 block">
                  {activeProfile.video.smoothLighting ? 'Activada' : 'Rápida (Off)'}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Right: JVM & Memory Configurator */}
        <section className="xl:col-span-5 p-6 rounded-xl bg-[#12161C] border border-[#1E242E] flex flex-col justify-between">
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                Motor Java (JVM) y Memoria
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Evita micro-congelamientos (lag spikes) asignando la RAM justa y el recolector moderno.
              </p>
            </div>

            {/* RAM Slider */}
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <label htmlFor="ram-slider" className="text-zinc-200 font-medium">
                  Memoria RAM asignada
                </label>
                <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                  {activeProfile.jvm.ramGb} GB ({activeProfile.jvm.ramGb * 1024} MB)
                </span>
              </div>
              <input
                id="ram-slider"
                type="range"
                min={2}
                max={16}
                step={1}
                value={activeProfile.jvm.ramGb}
                onChange={(e) => onUpdateJvm({ ramGb: Number(e.target.value) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-zinc-500 font-mono mt-1">
                <span>2 GB</span>
                <span>6 GB (Recomendado)</span>
                <span>16 GB</span>
              </div>
            </div>

            {/* Garbage Collector Selector */}
            <div>
              <span className="block text-sm text-zinc-200 font-medium mb-2">
                Recolector de Basura (GC)
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'ZGC', label: 'ZGC Gen', hint: 'Mín. latencia' },
                    { id: 'G1GC', label: 'G1GC', hint: 'Equilibrado' },
                    { id: 'Shenandoah', label: 'Shenandoah', hint: 'Bajas pausas' },
                  ] as Array<{ id: GarbageCollector; label: string; hint: string }>
                ).map((gc) => {
                  const active = activeProfile.jvm.gc === gc.id;
                  return (
                    <button
                      key={gc.id}
                      type="button"
                      onClick={() => onUpdateJvm({ gc: gc.id })}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-emerald-500/12 border-emerald-500/50 text-white'
                          : 'bg-[#0E1116] border-[#222A35] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{gc.label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{gc.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* JVM Flags Checkboxes */}
            <div className="space-y-2.5 pt-1">
              <label className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
                <div>
                  <span className="text-xs font-medium text-zinc-200 block">
                    Pre-asignar páginas de memoria (-XX:+AlwaysPreTouch)
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Elimina tirones al entrar por primera vez a un mundo
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={activeProfile.jvm.alwaysPreTouch}
                  onChange={(e) => onUpdateJvm({ alwaysPreTouch: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500"
                />
              </label>

              <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0E1116] border border-[#222A35]">
                <label htmlFor="gc-threads" className="text-xs font-medium text-zinc-200">
                  Hilos paralelos de GC
                </label>
                <select
                  id="gc-threads"
                  value={activeProfile.jvm.parallelThreads}
                  onChange={(e) => onUpdateJvm({ parallelThreads: Number(e.target.value) })}
                  className="h-8 px-2.5 rounded bg-[#151A22] border border-[#283241] text-xs font-mono text-white"
                >
                  {[2, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} hilos
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Generated JVM Arguments Preview */}
          <div className="mt-5 pt-4 border-t border-[#1E242E]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                Argumentos JVM generados
              </span>
              <button
                type="button"
                onClick={handleCopyFlags}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                {copiedFlags ? (
                  <>
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    Copiar
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-[#0B0D10] border border-[#1E242E] text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-28">
              {jvmFlagsText}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
