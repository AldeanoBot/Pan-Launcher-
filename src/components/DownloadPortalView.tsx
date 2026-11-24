import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FolderArchive,
  Laptop,
  Play,
  ShieldAlert,
} from 'lucide-react';
import { HERO_BACKDROP_IMG } from '../data/catalog';
import {
  INITIAL_DOWNLOAD_STATE,
  downloadInstallerWithProgress,
  formatBytesMb,
  type DownloadProgressState,
} from '../utils/installerDownload';

interface DownloadPortalViewProps {
  onOpenWebClient: () => void;
}

const INSTALL_STEPS = [
  {
    num: '01',
    title: 'Descarga el instalador oficial',
    detail:
      'Pulsa «Descargar Pan-launcher-Setup.exe». Si prefieres evitar avisos de archivos .exe sin firma en Windows, descarga la alternativa Pan-launcher-Windows.zip.',
  },
  {
    num: '02',
    title: 'Abre el instalador en tu PC',
    detail:
      'Haz doble clic en Pan-launcher-Setup.exe (SmartScreen: Más información → Ejecutar de todas formas). Si usas Panda Dome o aparece «no tiene acceso al dispositivo», descarga el ZIP sin .exe y abre Instalar-Guiado.cmd.',
  },
  {
    num: '03',
    title: 'Completa los 4 pasos del asistente',
    detail:
      'El instalador te guiará paso a paso en su ventana: Bienvenida, opciones de acceso directo en Escritorio/Menú Inicio, instalación instantánea y cierre.',
  },
  {
    num: '04',
    title: 'Pulsa Jugar ahora dentro de la app',
    detail:
      'Abre Pan-launcher desde tu Escritorio (sin pestañas de Chrome) y pulsa Jugar ahora para descargar Java y abrir Minecraft Java real.',
  },
];

export function DownloadPortalView({ onOpenWebClient }: DownloadPortalViewProps) {
  const [dlState, setDlState] = useState<DownloadProgressState>(INITIAL_DOWNLOAD_STATE);
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const startDownload = async (endpoint: string, filename: string) => {
    await downloadInstallerWithProgress(endpoint, filename, setDlState);
  };

  return (
    <div className="min-h-screen bg-[#0B0D10] text-[#E6E9EF] flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="h-16 px-4 md:px-8 border-b border-[#1E242E] bg-[#0E1116] flex items-center justify-between gap-8 shrink-0">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onOpenWebClient();
          }}
          className="flex items-center gap-2.5 text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          <span className="w-7 h-7 rounded-md bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2L20 6.5V17.5L12 22L4 17.5V6.5L12 2Z"
                stroke="#10B981"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <path d="M12 22V12M12 12L20 6.5M12 12L4 6.5" stroke="#10B981" strokeWidth="1.75" />
            </svg>
          </span>
          Pan-launcher
        </a>

        <nav aria-label="Navegación de descarga" className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
          <a href="#instalador" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Instalador
          </a>
          <a href="#pasos" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Pasos de instalación
          </a>
          <a href="#incluye" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Qué incluye
          </a>
          <button
            type="button"
            onClick={onOpenWebClient}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Abrir cliente web
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void startDownload('/api/pc/download-app?os=windows', 'Pan-launcher-Setup.exe')}
            disabled={dlState.status === 'downloading'}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            Descargar .exe
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1160px] mx-auto px-4 md:px-8 py-8 md:py-12 space-y-12">
        {/* Embedded Iframe Helper Banner */}
        {isInIframe && (
          <div className="p-4 rounded-xl bg-amber-950/35 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 text-sm text-amber-100">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold">Estás viendo esta web dentro de una vista previa integrada</p>
                <p className="text-xs text-amber-200/85 mt-0.5">
                  Algunos navegadores bloquean archivos <code className="text-white">.exe</code> dentro de iframes. Si no empieza la descarga abajo, abre esta web en una pestaña normal de Chrome igual que SKLauncher.
                </p>
              </div>
            </div>
            <a
              href="/descargar"
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-4 rounded-lg text-xs font-semibold text-[#05120C] bg-amber-400 hover:bg-amber-300 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              Abrir web en pestaña nueva
            </a>
          </div>
        )}

        {/* Hero Download Section */}
        <section
          id="instalador"
          className="relative rounded-2xl overflow-hidden border border-[#222A35] bg-[#12161C]"
        >
          <div className="relative p-6 md:p-10 lg:p-12 min-h-[360px] flex flex-col justify-between gap-8">
            <img
              src={HERO_BACKDROP_IMG}
              alt="Escenario voxel de Pan-launcher"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-40"
            />
            <div
              className="absolute inset-0 bg-gradient-to-r from-[#0B0D10] via-[#0B0D10]/90 to-[#0B0D10]/65"
              aria-hidden="true"
            />

            <div className="relative z-10 max-w-2xl space-y-4">
              <p className="text-xs font-medium text-emerald-400">
                Windows 10 / 11 (64-bit) · Instalador nativo con asistente de 4 pasos · Sin Chrome
              </p>
              <h1
                className="font-display font-bold text-white tracking-tight text-balance leading-[1.1]"
                style={{ fontSize: 'clamp(2.1rem, 4vw, 3.25rem)' }}
              >
                Descarga <span className="whitespace-nowrap">Pan-launcher</span> para tu PC
              </h1>
              <p className="text-sm md:text-base text-zinc-300 leading-relaxed max-w-xl">
                Instalador todo-en-uno para Minecraft Java Edition. Te guía paso a paso al abrirlo, instala Pan-launcher en tu Escritorio en su propia ventana y descarga Java + Fabric + mods FPS automáticamente.
              </p>
            </div>

            <div className="relative z-10 space-y-4 max-w-xl">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  type="button"
                  disabled={dlState.status === 'downloading'}
                  onClick={() => void startDownload('/api/pc/download-app?os=windows', 'Pan-launcher-Setup.exe')}
                  className="h-12 px-6 rounded-xl text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap disabled:opacity-70 cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {dlState.status === 'downloading'
                      ? `Descargando... ${dlState.percent}%`
                      : 'Descargar Pan-launcher-Setup.exe'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onOpenWebClient}
                  className="h-12 px-5 rounded-xl text-sm font-medium text-zinc-200 bg-[#161C24]/95 hover:bg-[#1E2530] border border-[#2B3544] inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  Volver al cliente web
                </button>
              </div>

              {/* Live progress bar when downloading */}
              {dlState.status === 'downloading' && (
                <div className="p-3.5 rounded-xl bg-[#0E1116]/95 border border-[#242C38] space-y-2">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="text-zinc-200 font-medium">
                      Guardando <span className="font-mono text-emerald-300">{dlState.filename}</span>
                    </span>
                    <span className="font-mono text-emerald-400">
                      {formatBytesMb(dlState.loadedBytes)}
                      {dlState.totalBytes > 0 ? ` / ${formatBytesMb(dlState.totalBytes)}` : ''} · {dlState.percent}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#181E27] overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-150"
                      style={{ width: `${dlState.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {dlState.status === 'done' && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/45 text-xs text-emerald-100 flex items-start gap-2.5"
                >
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    <strong className="font-mono">{dlState.filename}</strong> guardado ({formatBytesMb(dlState.loadedBytes)}). Abre <strong className="text-white">Descargas</strong> (<code className="text-emerald-200">Ctrl+J</code>), haz doble clic y sigue los 4 pasos del instalador.
                  </span>
                </div>
              )}

              {dlState.status === 'error' && dlState.error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/45 text-xs text-red-200 space-y-2"
                >
                  <div>{dlState.error}</div>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href="/descargar"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-white underline underline-offset-4"
                    >
                      Abrir esta web en pestaña nueva
                    </a>
                    <a
                      href="/api/pc/download-app?os=windows&format=zip"
                      download="Pan-launcher-Windows.zip"
                      className="font-semibold text-emerald-300 underline underline-offset-4"
                    >
                      Probar descarga en .zip
                    </a>
                  </div>
                </div>
              )}

              {/* Secondary reliable links */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-400 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    void startDownload(
                      '/api/pc/download-app?os=windows&format=zip',
                      'Pan-launcher-Windows.zip'
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-left text-zinc-200 hover:text-emerald-300 underline underline-offset-4 cursor-pointer"
                >
                  <FolderArchive className="w-3.5 h-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                  Alternativa ZIP sin .exe (Panda Dome / Antivirus)
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void startDownload('/api/pc/download-app?os=unix&format=zip', 'Pan-launcher-MacLinux.zip')
                  }
                  className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  <Laptop className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                  macOS / Linux (.zip)
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Step-by-Step Guide */}
        <section id="pasos" className="space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-white tracking-tight">
              Pasos para instalar Pan-launcher en tu PC
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              El instalador te muestra estas instrucciones dentro de su ventana gráfica para que no tengas que usar comandos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {INSTALL_STEPS.map((step) => (
              <div
                key={step.num}
                className="p-5 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-2"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                    {step.num}.
                  </span>
                  <h3 className="font-display text-base font-semibold text-white">
                    {step.title}
                  </h3>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed pl-8">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Asymmetric Bento: What's Inside vs Requirements */}
        <section id="incluye" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 p-6 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-4">
            <h2 className="font-display text-xl font-bold text-white">
              Qué instala en tu ordenador
            </h2>
            <div className="divide-y divide-[#1E242E] text-sm">
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="font-medium text-white">Ventana nativa sin Chrome</span>
                <span className="text-zinc-400">Microsoft WebView2 · acceso directo en Escritorio</span>
              </div>
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="font-medium text-white">Java automático (8, 17 o 21)</span>
                <span className="text-zinc-400">Eclipse Temurin JRE según la versión elegida</span>
              </div>
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="font-medium text-white">Minecraft Java + Fabric + Mods FPS</span>
                <span className="text-zinc-400">Descarga oficial Mojang + Sodium, Lithium, FerriteCore</span>
              </div>
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="font-medium text-white">Carpeta aislada y segura</span>
                <span className="font-mono text-xs text-emerald-400">%LOCALAPPDATA%\Pan-launcher</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 p-6 rounded-xl bg-[#12161C] border border-[#1E242E] flex flex-col justify-between gap-5">
            <div className="space-y-3">
              <h2 className="font-display text-xl font-bold text-white">
                Si Panda Dome o Windows bloquean el archivo
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Antivirus como <strong className="text-white">Panda Dome</strong> o Windows Defender bloquean ejecutables nuevos sin firma comercial de pago:
              </p>
              <ul className="text-xs text-zinc-300 space-y-2 list-disc pl-4 leading-relaxed">
                <li>
                  <strong className="text-white">Sin archivos .exe:</strong> descarga <strong className="text-emerald-300">Pan-launcher-Windows.zip</strong> (0 ejecutables .exe dentro), haz clic derecho → <strong className="text-white">Extraer todo</strong> y abre <code className="text-emerald-300">Instalar-Guiado.cmd</code>.
                </li>
                <li>
                  <strong className="text-white">Permitir en Panda Dome:</strong> abre <strong className="text-white">Panda Dome → Antivirus → Cuarentena</strong> (pulsa <em>Restaurar</em>) o añade la carpeta de descargas en <strong className="text-white">Configuración → Antivirus → Exclusiones</strong>.
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void startDownload('/api/pc/download-app?os=windows', 'Pan-launcher-Setup.exe')}
                className="h-11 px-4 rounded-xl text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                Descargar .exe
              </button>
              <button
                type="button"
                onClick={() =>
                  void startDownload('/api/pc/download-app?os=windows&format=zip', 'Pan-launcher-Windows.zip')
                }
                className="h-11 px-4 rounded-xl text-sm font-medium text-zinc-100 bg-[#181E27] hover:bg-[#222A35] border border-[#2B3544] inline-flex items-center justify-center gap-2 transition-colors"
              >
                <FolderArchive className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                Descargar .zip
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="px-4 md:px-8 py-6 border-t border-[#1E242E] text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-4 max-w-[1160px] w-full mx-auto">
        <span>Pan-launcher · Cliente optimizado para Minecraft Java Edition</span>
        <button
          type="button"
          onClick={onOpenWebClient}
          className="text-zinc-400 hover:text-white underline underline-offset-4"
        >
          Ir al configurador web de perfiles y mods
        </button>
      </footer>
    </div>
  );
}
