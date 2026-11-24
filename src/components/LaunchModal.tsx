import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  FolderArchive,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';
import type { AccountProfile, ClientProfile, PerfMod } from '../types/client';
import { generateOptionsTxt } from '../utils/fpsEngine';
import {
  INITIAL_DOWNLOAD_STATE,
  downloadInstallerWithProgress,
  formatBytesMb,
  type DownloadProgressState,
} from '../utils/installerDownload';

interface LaunchStatus {
  state: 'idle' | 'preparing' | 'downloading' | 'launching' | 'running' | 'finished' | 'error';
  progress: number;
  step: string;
  error: string | null;
  pid: number | null;
  mcVersion?: string;
  instanceDir?: string;
  logs: string[];
}

interface LaunchModalProps {
  open: boolean;
  canLaunchJava: boolean | null;
  profile: ClientProfile;
  account: AccountProfile;
  mods: PerfMod[];
  serverInfo: { name: string; address: string } | null;
  onClose: () => void;
}

const INITIAL_STATUS: LaunchStatus = {
  state: 'preparing',
  progress: 2,
  step: 'Conectando con el motor local de Pan-launcher...',
  error: null,
  pid: null,
  logs: [],
};

export function LaunchModal({
  open,
  canLaunchJava,
  profile,
  account,
  mods,
  serverInfo,
  onClose,
}: LaunchModalProps) {
  const [status, setStatus] = useState<LaunchStatus>(INITIAL_STATUS);
  const [dlState, setDlState] = useState<DownloadProgressState>(INITIAL_DOWNLOAD_STATE);
  const hasTriggeredOpenRef = useRef(false);
  const isLaunchingRef = useRef(false);
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const enabledModIds = useMemo(
    () => mods.filter((m) => m.enabled).map((m) => m.id),
    [mods]
  );

  const launchPayload = useMemo(
    () => ({
      profileId: profile.id,
      profileName: profile.name,
      mcVersion: profile.mcVersion,
      loader: profile.loader,
      ramGb: profile.jvm.ramGb,
      gc: profile.jvm.gc,
      alwaysPreTouch: profile.jvm.alwaysPreTouch,
      stringDeduplication: profile.jvm.stringDeduplication,
      parallelThreads: profile.jvm.parallelThreads,
      customArgs: profile.jvm.customArgs,
      username: account.username,
      uuid: account.uuid,
      accountType: account.type,
      enabledModIds,
      optionsTxt: generateOptionsTxt(profile.video, profile.network),
      serverAddress: serverInfo?.address || null,
    }),
    [account, enabledModIds, profile, serverInfo]
  );

  const launchPayloadRef = useRef(launchPayload);
  launchPayloadRef.current = launchPayload;

  const startLocalJavaLaunch = useCallback(async () => {
    if (isLaunchingRef.current) return;
    isLaunchingRef.current = true;

    const localHost = typeof window !== 'undefined' ? window.location.host : '127.0.0.1:41735';
    const payload = launchPayloadRef.current;
    const initLogs = [
      `Perfil: ${payload.profileName} (${payload.mcVersion} · ${payload.loader})`,
      `Enviando perfil y mods al motor nativo (${localHost})...`,
    ];

    setStatus({
      state: 'preparing',
      progress: 4,
      step: `Preparando Minecraft Java ${payload.mcVersion} (${payload.loader})...`,
      error: null,
      pid: null,
      logs: initLogs,
    });

    try {
      const bodyStr = JSON.stringify(payload);
      let res: Response | null = null;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch('/api/local/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyStr,
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
        }
      }

      if (lastErr || !res) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error('No se pudo conectar con el servidor local de Pan-launcher.');
      }

      if (!res.ok) {
        let serverErr = 'El servidor local rechazó la solicitud de lanzamiento.';
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) serverErr = data.error;
        } catch {
          // Ignore non-JSON error body
        }
        throw new Error(serverErr);
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Error de comunicación con el lanzador local.';
      const isConnFailure = /failed to fetch|networkerror|load failed|err_connection/i.test(rawMsg);
      const localHost = typeof window !== 'undefined' ? window.location.host : '127.0.0.1:41735';
      const helpfulError = isConnFailure
        ? `Se perdió la conexión con el motor nativo de Pan-launcher (${localHost}). Cierra el proceso anterior (icono en la bandeja del sistema o Administrador de tareas) y abre la nueva versión de Pan-launcher desde el Escritorio.`
        : rawMsg;

      setStatus({
        state: 'error',
        progress: 100,
        step: 'No se pudo iniciar Minecraft Java',
        error: helpfulError,
        pid: null,
        logs: [
          ...initLogs,
          `ERROR: ${rawMsg}`,
          ...(isConnFailure
            ? [
                `Diagnóstico: /api/local/launch no recibió respuesta del motor en ${localHost}.`,
                'Solución: cierra cualquier proceso antiguo de Pan-launcher/PowerShell y vuelve a abrir Pan-launcher.',
              ]
            : []),
        ],
      });
    } finally {
      isLaunchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      hasTriggeredOpenRef.current = false;
      isLaunchingRef.current = false;
      setDlState(INITIAL_DOWNLOAD_STATE);
      return;
    }
    if (canLaunchJava !== true) return;

    if (!hasTriggeredOpenRef.current) {
      hasTriggeredOpenRef.current = true;
      void startLocalJavaLaunch();
    }

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch('/api/local/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as LaunchStatus;
        setStatus(data);
        if (data.state === 'error' || data.state === 'finished') {
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling while local PowerShell server responds
      }
    }, 800);

    return () => window.clearInterval(timer);
  }, [open, canLaunchJava, startLocalJavaLaunch]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-modal-title"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xl rounded-xl bg-[#12161C] border border-[#283241] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-emerald-400">
              Minecraft Java {profile.mcVersion} · {profile.loader} · {account.username}
            </p>
            <h2 id="launch-modal-title" className="font-display text-xl font-bold text-white mt-0.5">
              {canLaunchJava ? 'Iniciando Minecraft Java real' : 'Ejecutar Minecraft Java en tu PC'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de lanzamiento"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-[#181E27] border border-[#283241]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Summary row */}
        <div className="p-3.5 rounded-lg bg-[#0E1116] border border-[#222A35] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-zinc-500">Perfil activo</div>
            <div className="text-zinc-100 font-medium truncate mt-0.5">{profile.name}</div>
          </div>
          <div>
            <div className="text-zinc-500">Cuenta</div>
            <div className="text-zinc-100 font-medium truncate mt-0.5">
              {account.username} ({account.type === 'offline' ? 'Offline' : account.type === 'elyby' ? 'Ely.by' : 'Microsoft'})
            </div>
          </div>
          <div>
            <div className="text-zinc-500">Destino</div>
            <div className="text-emerald-400 font-mono truncate mt-0.5">
              {serverInfo ? serverInfo.address : 'Menú principal'}
            </div>
          </div>
        </div>

        {account.type === 'microsoft' && (
          <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Esta versión autónoma aún no incluye inicio de sesión OAuth con Microsoft: iniciará con sesión offline local (válida para un jugador y servidores No-Premium).
            </span>
          </div>
        )}

        {canLaunchJava ? (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-zinc-200 font-medium flex items-center gap-2">
                  {status.state === 'running' ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : status.state === 'error' ? (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" aria-hidden="true" />
                  )}
                  {status.step || 'Procesando...'}
                </span>
                <span className="font-mono text-zinc-400 tabular-nums">{status.progress}%</span>
              </div>

              <div className="h-2.5 w-full rounded-full bg-[#0B0D10] border border-[#222A35] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    status.state === 'error' ? 'bg-red-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.max(4, Math.min(100, status.progress))}%` }}
                />
              </div>
            </div>

            {status.state === 'running' && (
              <div className="p-3.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 flex items-center justify-between gap-3">
                <span>
                  Minecraft Java se está ejecutando en tu PC{status.pid ? ` (PID ${status.pid})` : ''}. La primera descarga puede tardar unos minutos al abrir la ventana del juego.
                </span>
              </div>
            )}

            {status.state === 'error' && status.error && (
              <div role="alert" className="p-3.5 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200 space-y-2">
                <div className="font-semibold text-red-300">Error al iniciar Minecraft Java</div>
                <div className="font-mono break-words">{status.error}</div>
              </div>
            )}

            {/* Console logs */}
            <div className="rounded-lg bg-[#0B0D10] border border-[#222A35] overflow-hidden">
              <div className="px-3 py-2 border-b border-[#1E242E] flex items-center gap-2 text-[11px] font-medium text-zinc-400">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                Registro de descarga e inicio
              </div>
              <div className="p-3 max-h-44 overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-300 space-y-1">
                {status.logs && status.logs.length > 0 ? (
                  status.logs.map((line, idx) => <div key={idx}>{line}</div>)
                ) : (
                  <div className="text-zinc-500">Esperando salida del motor local...</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              {status.state === 'error' && (
                <button
                  type="button"
                  onClick={() => void startLocalJavaLaunch()}
                  className="h-9 px-4 rounded-lg text-xs font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Reintentar
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg text-xs font-medium text-zinc-200 bg-[#181E27] hover:bg-[#222A35] border border-[#283241]"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300 leading-relaxed">
              Para jugar a <strong className="text-white">Minecraft Java real</strong> sin Chrome, descarga e instala <code className="text-emerald-300 whitespace-nowrap">Pan-launcher-Setup.exe</code>. El asistente te indicará los 4 pasos en pantalla y creará el acceso directo en tu Escritorio.
            </p>

            <button
              type="button"
              disabled={dlState.status === 'downloading'}
              onClick={() =>
                void downloadInstallerWithProgress(
                  '/api/pc/download-app?os=windows',
                  'Pan-launcher-Setup.exe',
                  setDlState
                )
              }
              className="w-full p-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#05120C] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-70 cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-[#05120C] flex items-center gap-2">
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  {dlState.status === 'downloading'
                    ? `Descargando instalador... ${dlState.percent}%`
                    : 'Descargar Pan-launcher-Setup.exe'}
                </div>
                <div className="text-xs text-[#06291A] mt-0.5">
                  Asistente guiado (4 pasos) · Abre en ventana propia sin Chrome
                </div>
              </div>
              <Download className="w-5 h-5 shrink-0 text-[#05120C]" aria-hidden="true" />
            </button>

            {dlState.status === 'downloading' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono text-zinc-300 tabular-nums">
                  <span>{dlState.filename}</span>
                  <span>
                    {formatBytesMb(dlState.loadedBytes)}
                    {dlState.totalBytes > 0 ? ` / ${formatBytesMb(dlState.totalBytes)}` : ''}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#0B0D10] border border-[#222A35] overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-150" style={{ width: `${dlState.percent}%` }} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="/descargar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-emerald-300 hover:text-emerald-200 underline underline-offset-4 font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  {isInIframe ? 'Abrir web de descarga en Chrome' : 'Ver web de descarga y pasos'}
                </a>

                <button
                  type="button"
                  onClick={() =>
                    void downloadInstallerWithProgress(
                      '/api/pc/download-app?os=windows&format=zip',
                      'Pan-launcher-Windows.zip',
                      setDlState
                    )
                  }
                  className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  <FolderArchive className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                  Alternativa .zip (sin bloqueo)
                </button>
              </div>
              <span className="text-zinc-500">
                ¿Error de acceso? Usa el .zip → Instalar-Guiado.cmd
              </span>
            </div>

            {dlState.status === 'done' && (
              <div role="status" className="p-3.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Descargado: <strong className="font-mono">{dlState.filename}</strong> ({formatBytesMb(dlState.loadedBytes)}). Abre <strong className="text-white">Descargas</strong> (<code className="text-emerald-200">Ctrl+J</code>) y ábrelo para seguir los 4 pasos.
                </span>
              </div>
            )}

            {dlState.status === 'error' && dlState.error && (
              <div role="alert" className="p-3.5 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200 space-y-2">
                <div>{dlState.error}</div>
                <a
                  href="/descargar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-white underline underline-offset-4"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  Abrir web de descarga oficial (/descargar)
                </a>
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg text-xs font-medium text-zinc-200 bg-[#181E27] hover:bg-[#222A35] border border-[#283241]"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
