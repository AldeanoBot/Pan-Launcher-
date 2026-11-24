import { useEffect, useRef, useState } from 'react';
import type { HudModule, PerformanceEstimate, VideoSettings } from '../types/client';

interface HudVideoViewProps {
  hudModules: HudModule[];
  video: VideoSettings;
  estimate: PerformanceEstimate;
  onToggleHudModule: (id: HudModule['id']) => void;
  onUpdateVideo: (patch: Partial<VideoSettings>) => void;
}

export function HudVideoView({
  hudModules,
  video,
  estimate,
  onToggleHudModule,
  onUpdateVideo,
}: HudVideoViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef(video);
  const estimateRef = useRef(estimate);
  videoRef.current = video;
  estimateRef.current = estimate;

  const [pressedKeys, setPressedKeys] = useState<Record<string, boolean>>({});
  const [cpsLeft, setCpsLeft] = useState(0);
  const [cpsRight, setCpsRight] = useState(0);
  const leftClicksRef = useRef<number[]>([]);
  const rightClicksRef = useRef<number[]>([]);

  const isEnabled = (id: HudModule['id']) =>
    hudModules.find((m) => m.id === id)?.enabled ?? false;

  // Interactive keyboard & CPS tracker for Keystrokes preview
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' '].includes(k)) {
        setPressedKeys((prev) => ({ ...prev, [k]: true }));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' '].includes(k)) {
        setPressedKeys((prev) => ({ ...prev, [k]: false }));
      }
    };
    const interval = setInterval(() => {
      const now = Date.now();
      leftClicksRef.current = leftClicksRef.current.filter((t) => now - t < 1000);
      rightClicksRef.current = rightClicksRef.current.filter((t) => now - t < 1000);
      setCpsLeft(leftClicksRef.current.length);
      setCpsRight(rightClicksRef.current.length);
    }, 100);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Mount Canvas voxel engine preview once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let time = 0;

    const renderFrame = () => {
      time += 0.016;
      const w = canvas.width;
      const h = canvas.height;
      const v = videoRef.current;
      const est = estimateRef.current;

      // Sky & Fullbright atmosphere
      const skyTop = v.fullbright ? '#1e2c3a' : '#0b1017';
      const skyBottom = v.fullbright ? '#344c63' : '#182230';
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, skyTop);
      grad.addColorStop(1, skyBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Clouds if enabled
      if (v.clouds !== 'off') {
        ctx.fillStyle = v.clouds === 'fancy' ? 'rgba(226, 232, 240, 0.22)' : 'rgba(203, 213, 225, 0.14)';
        for (let i = 0; i < 6; i++) {
          const cx = ((i * 190 + time * 18) % (w + 160)) - 80;
          const cy = 38 + (i % 3) * 26;
          ctx.fillRect(cx, cy, 96, v.clouds === 'fancy' ? 18 : 10);
        }
      }

      // Horizon voxel terrain strips affected by renderDistance
      const visibleCols = Math.min(28, Math.max(8, v.renderDistance * 2));
      const colWidth = w / visibleCols;
      const horizonY = h * 0.56;

      for (let i = 0; i < visibleCols; i++) {
        const wave = Math.sin(i * 0.45 + time * 0.35) * 18 + Math.cos(i * 0.2) * 12;
        const blockTop = horizonY + wave;
        // Distant voxel pine silhouette on every 3rd column
        if (i % 3 === 0) {
          const tx = i * colWidth + colWidth * 0.25;
          ctx.fillStyle = '#19352b';
          ctx.fillRect(tx, blockTop - 26, colWidth * 0.5, 26);
          ctx.fillStyle = '#204739';
          ctx.fillRect(tx + 4, blockTop - 38, Math.max(4, colWidth * 0.5 - 8), 14);
        }
        // Grass top block
        ctx.fillStyle = v.smoothLighting ? '#2c6e49' : '#357f56';
        ctx.fillRect(i * colWidth, blockTop, colWidth + 1, 14);
        // Dirt/stone body
        ctx.fillStyle = '#1f2933';
        ctx.fillRect(i * colWidth, blockTop + 14, colWidth + 1, h - blockTop);
      }

      // Foreground voxel bridge blocks
      const floorY = h * 0.74;
      for (let x = 0; x < w; x += 36) {
        ctx.fillStyle = (x / 36) % 2 === 0 ? '#28313c' : '#232b35';
        ctx.fillRect(x, floorY, 35, h - floorY);
        ctx.fillStyle = '#10b981';
        ctx.fillRect(x, floorY, 35, 3);
      }

      // Entity silhouette + optional shadow
      const playerX = w * 0.5 + Math.sin(time * 1.1) * 24;
      const playerY = floorY - 56;
      if (v.entityShadows) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.ellipse(playerX + 14, floorY + 2, 18, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#334155';
      ctx.fillRect(playerX, playerY, 28, 52);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(playerX + 4, playerY + 6, 20, 8);

      // Render Distance Fog overlay
      const fogOpacity = Math.max(0.05, 0.55 - v.renderDistance * 0.018);
      ctx.fillStyle = `rgba(11, 13, 16, ${fogOpacity.toFixed(2)})`;
      ctx.fillRect(0, horizonY - 40, w, 40);

      // Crosshair in center
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(w / 2 - 7, h / 2 - 1, 14, 2);
      ctx.fillRect(w / 2 - 1, h / 2 - 7, 2, 14);

      // Subtle frame-time bar graph in bottom center-right
      const barBaseX = w - 135;
      const barBaseY = h - 18;
      ctx.fillStyle = 'rgba(11, 13, 16, 0.72)';
      ctx.fillRect(barBaseX - 6, barBaseY - 34, 126, 42);
      for (let b = 0; b < 24; b++) {
        const jitter = Math.sin(time * 6 + b * 0.9) * 3;
        const barH = Math.max(4, Math.min(28, (est.frameTimeMs * 1.8) + jitter));
        ctx.fillStyle = '#10B981';
        ctx.fillRect(barBaseX + b * 5, barBaseY - barH, 3, barH);
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const now = Date.now();
    if (e.button === 2) {
      rightClicksRef.current.push(now);
    } else {
      leftClicksRef.current.push(now);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white tracking-tight">
          HUD Competitivo y Ajustes de Vídeo
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Activa módulos en pantalla y ajusta la calidad gráfica viendo el impacto inmediato en FPS y tiempo de fotograma.
        </p>
      </div>

      {/* Live Interactive Minecraft Viewport + HUD Overlay */}
      <section className="rounded-xl overflow-hidden border border-[#222A35] bg-[#0E1116]">
        <div className="relative w-full aspect-video max-h-[460px] bg-[#0B0D10] select-none overflow-hidden">
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            data-testid="hud-preview-canvas"
            onMouseDown={handleCanvasMouseDown}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full h-full object-cover cursor-crosshair"
          />

          {/* Top-Left HUD Stack: FPS, Coords, CPS */}
          <div className="absolute top-4 left-4 space-y-1.5 pointer-events-none font-mono text-xs tabular-nums">
            {isEnabled('fps') && (
              <div className="px-2.5 py-1 rounded bg-black/65 text-white border border-white/10">
                <span className="text-emerald-400 font-semibold">{estimate.estimatedFps} FPS</span>{' '}
                <span className="text-zinc-300">({estimate.frameTimeMs} ms)</span>
              </div>
            )}
            {isEnabled('coords') && (
              <div className="px-2.5 py-1 rounded bg-black/65 text-zinc-200 border border-white/10">
                XYZ: 142 / 68 / -318 · Mirando: Norte (N)
              </div>
            )}
            {isEnabled('cps') && (
              <div className="px-2.5 py-1 rounded bg-black/65 text-zinc-200 border border-white/10">
                CPS: {cpsLeft} LMB · {cpsRight} RMB
              </div>
            )}
          </div>

          {/* Top-Center Compass */}
          {isEnabled('compass') && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded bg-black/65 border border-white/10 font-mono text-xs text-zinc-200 tracking-widest pointer-events-none">
              O · · · NO · · · <span className="text-emerald-400 font-bold">N</span> · · · NE · · · E
            </div>
          )}

          {/* Top-Right Ping */}
          {isEnabled('ping') && (
            <div className="absolute top-4 right-4 px-2.5 py-1 rounded bg-black/65 border border-white/10 font-mono text-xs text-zinc-200 tabular-nums pointer-events-none">
              Ping: <span className="text-emerald-400 font-semibold">34 ms</span>
            </div>
          )}

          {/* Bottom-Left Keystrokes + ToggleSprint */}
          <div className="absolute bottom-4 left-4 space-y-2 pointer-events-none font-mono text-xs">
            {isEnabled('keystrokes') && (
              <div className="grid grid-cols-3 gap-1 w-32 text-center">
                <div />
                <div
                  className={`py-1.5 rounded border ${
                    pressedKeys['w']
                      ? 'bg-emerald-500 text-black border-emerald-400 font-bold'
                      : 'bg-black/65 text-white border-white/15'
                  }`}
                >
                  W
                </div>
                <div />
                {(['a', 's', 'd'] as const).map((k) => (
                  <div
                    key={k}
                    className={`py-1.5 rounded border uppercase ${
                      pressedKeys[k]
                        ? 'bg-emerald-500 text-black border-emerald-400 font-bold'
                        : 'bg-black/65 text-white border-white/15'
                    }`}
                  >
                    {k}
                  </div>
                ))}
                <div className="col-span-3 py-1 rounded bg-black/65 text-zinc-300 border border-white/15 text-[10px]">
                  LMB {cpsLeft} | RMB {cpsRight}
                </div>
              </div>
            )}

            {isEnabled('togglesprint') && (
              <div className="px-2.5 py-1 rounded bg-black/65 border border-white/10 text-[11px] text-emerald-300">
                [Esprint: Activado]
              </div>
            )}
          </div>

          {/* Bottom-Right Armor Status */}
          {isEnabled('armor') && (
            <div className="absolute bottom-14 right-4 px-2.5 py-1.5 rounded bg-black/65 border border-white/10 font-mono text-[11px] text-zinc-200 space-y-0.5 tabular-nums pointer-events-none">
              <div>Casco: 98%</div>
              <div>Peto: 94%</div>
              <div>Mallas: 96%</div>
              <div>Botas: 91%</div>
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 bg-[#12161C] border-t border-[#1E242E] flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>Pulsa WASD o haz clic sobre la vista previa para probar el HUD de Keystrokes y CPS en vivo.</span>
          <span className="font-mono text-emerald-400 tabular-nums">
            Rendimiento actual: {estimate.estimatedFps} FPS ({estimate.frameTimeMs} ms)
          </span>
        </div>
      </section>

      {/* Two-Column Controls: HUD Modules + Video Settings */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* HUD Modules */}
        <section className="xl:col-span-6 p-5 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-3">
          <h2 className="font-display text-lg font-semibold text-white">
            Módulos del HUD en juego
          </h2>
          <div className="divide-y divide-[#1E242E]">
            {hudModules.map((mod) => (
              <div key={mod.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-white">{mod.name}</div>
                  <div className="text-xs text-zinc-400">{mod.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={mod.enabled}
                  aria-label={`${mod.enabled ? 'Ocultar' : 'Mostrar'} ${mod.name}`}
                  onClick={() => onToggleHudModule(mod.id)}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                    mod.enabled
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-[#0E1116] border-[#283241] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {mod.enabled ? 'Visible' : 'Oculto'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Video Settings */}
        <section className="xl:col-span-6 p-5 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-4">
          <h2 className="font-display text-lg font-semibold text-white">
            Ajustes gráficos de máximo FPS
          </h2>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <label htmlFor="render-distance-slider" className="text-zinc-300 font-medium">
                Distancia de renderizado
              </label>
              <span className="font-mono text-emerald-400 tabular-nums">
                {video.renderDistance} chunks
              </span>
            </div>
            <input
              id="render-distance-slider"
              type="range"
              min={2}
              max={32}
              value={video.renderDistance}
              onChange={(e) => onUpdateVideo({ renderDistance: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <label htmlFor="max-fps-slider" className="text-zinc-300 font-medium">
                Límite de FPS
              </label>
              <span className="font-mono text-emerald-400 tabular-nums">
                {video.maxFps >= 260 ? 'Ilimitado' : `${video.maxFps} FPS`}
              </span>
            </div>
            <input
              id="max-fps-slider"
              type="range"
              min={60}
              max={260}
              step={10}
              value={video.maxFps}
              onChange={(e) => onUpdateVideo({ maxFps: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label htmlFor="graphics-mode" className="block text-xs text-zinc-400 mb-1">
                Calidad gráfica
              </label>
              <select
                id="graphics-mode"
                value={video.graphicsMode}
                onChange={(e) =>
                  onUpdateVideo({ graphicsMode: e.target.value as VideoSettings['graphicsMode'] })
                }
                className="w-full h-9 px-3 rounded-lg bg-[#0E1116] border border-[#242C38] text-xs text-white"
              >
                <option value="fast">Rápidos (Máx. FPS)</option>
                <option value="fancy">Detallados</option>
                <option value="fab">Fabulosos</option>
              </select>
            </div>

            <div>
              <label htmlFor="particles-mode" className="block text-xs text-zinc-400 mb-1">
                Partículas
              </label>
              <select
                id="particles-mode"
                value={video.particles}
                onChange={(e) =>
                  onUpdateVideo({ particles: e.target.value as VideoSettings['particles'] })
                }
                className="w-full h-9 px-3 rounded-lg bg-[#0E1116] border border-[#242C38] text-xs text-white"
              >
                <option value="minimal">Mínimas</option>
                <option value="decreased">Disminuidas</option>
                <option value="all">Todas</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <label className="flex items-center justify-between p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
              <span className="text-xs text-zinc-200">Iluminación suave</span>
              <input
                type="checkbox"
                checked={video.smoothLighting}
                onChange={(e) => onUpdateVideo({ smoothLighting: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
              <span className="text-xs text-zinc-200">Sombras de entidades</span>
              <input
                type="checkbox"
                checked={video.entityShadows}
                onChange={(e) => onUpdateVideo({ entityShadows: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
              <span className="text-xs text-zinc-200">Fullbright (Brillo x10)</span>
              <input
                type="checkbox"
                checked={video.fullbright}
                onChange={(e) => onUpdateVideo({ fullbright: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[#0E1116] border border-[#222A35] cursor-pointer">
              <span className="text-xs text-zinc-200">VSync (Limita a 60 FPS)</span>
              <input
                type="checkbox"
                checked={video.vsync}
                onChange={(e) => onUpdateVideo({ vsync: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
