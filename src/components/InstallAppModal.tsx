import { useEffect, useState } from 'react';
import { Check, Download, ExternalLink, FolderArchive, Laptop, X } from 'lucide-react';
import {
  INITIAL_DOWNLOAD_STATE,
  downloadInstallerWithProgress,
  formatBytesMb,
  type DownloadProgressState,
} from '../utils/installerDownload';

interface InstallAppModalProps {
  open: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  onNativeInstall: () => Promise<boolean>;
  onClose: () => void;
}

export function InstallAppModal({
  open,
  isInstallable,
  isInstalled,
  isIOS,
  onNativeInstall,
  onClose,
}: InstallAppModalProps) {
  const [dlState, setDlState] = useState<DownloadProgressState>(INITIAL_DOWNLOAD_STATE);
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  useEffect(() => {
    if (!open) {
      setDlState(INITIAL_DOWNLOAD_STATE);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-app-title"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-[#12161C] border border-[#283241] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-emerald-400">Pan-launcher · Instalador oficial PC</p>
            <h2 id="install-app-title" className="font-display text-xl font-bold text-white mt-0.5">
              Descargar Pan-launcher
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de descarga"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-[#181E27] border border-[#283241]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {isInstalled ? (
          <div className="p-4 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-sm text-emerald-200 flex items-center gap-2.5">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Ya estás ejecutando Pan-launcher como aplicación instalada en tu equipo.</span>
          </div>
        ) : (
          <div className="space-y-3.5">
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
                <div className="text-sm font-semibold text-[#05120C]">
                  {dlState.status === 'downloading'
                    ? `Descargando instalador... ${dlState.percent}%`
                    : 'Descargar Pan-launcher-Setup.exe'}
                </div>
                <div className="text-xs text-[#06291A] mt-0.5">
                  Asistente paso a paso (sin Chrome) · Abre Minecraft Java real
                </div>
              </div>
              <Download className="w-5 h-5 shrink-0 text-[#05120C]" aria-hidden="true" />
            </button>

            {dlState.status === 'downloading' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono text-zinc-300 tabular-nums">
                  <span>{dlState.filename}</span>
                  <span>{formatBytesMb(dlState.loadedBytes)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#0B0D10] border border-[#222A35] overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-150" style={{ width: `${dlState.percent}%` }} />
                </div>
              </div>
            )}

            <a
              href="/descargar"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#283241] flex items-center justify-between gap-2 text-xs font-medium text-emerald-300 transition-colors"
            >
              <span>
                {isInIframe
                  ? 'Abrir web oficial de descarga en pestaña nueva'
                  : 'Ver web de descarga y pasos detallados'}
              </span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
              <button
                type="button"
                onClick={() =>
                  void downloadInstallerWithProgress(
                    '/api/pc/download-app?os=windows&format=zip',
                    'Pan-launcher-Windows.zip',
                    setDlState
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer"
              >
                <FolderArchive className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                Alternativa .zip sin .exe (Panda Dome)
              </button>

              <button
                type="button"
                onClick={() =>
                  void downloadInstallerWithProgress(
                    '/api/pc/download-app?os=unix&format=zip',
                    'Pan-launcher-MacLinux.zip',
                    setDlState
                  )
                }
                className="text-xs font-medium text-zinc-400 hover:text-white underline underline-offset-4 cursor-pointer"
              >
                Mac / Linux (.zip)
              </button>

              {isInstallable && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await onNativeInstall();
                    if (ok) onClose();
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300"
                >
                  <Laptop className="w-3.5 h-3.5" aria-hidden="true" />
                  Instalar en navegador
                </button>
              )}
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Si <strong className="text-zinc-200">Panda Dome</strong> o Windows bloquean el <code className="text-zinc-200">.exe</code>: baja la <strong className="text-emerald-300">Alternativa .zip sin .exe</strong>, extrae todo y abre <code className="text-zinc-200">Instalar-Guiado.cmd</code> (o añade exclusión en Panda Dome).
            </p>

            {isIOS && (
              <p className="text-xs text-zinc-400 bg-[#0E1116] border border-[#222A35] rounded-lg p-3">
                En iPhone o iPad: pulsa <strong className="text-zinc-200">Compartir</strong> en Safari y elige <strong className="text-zinc-200">Añadir a pantalla de inicio</strong>.
              </p>
            )}

            {dlState.status === 'done' && (
              <div
                role="status"
                className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2"
              >
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Guardado: <strong className="font-mono">{dlState.filename}</strong> ({formatBytesMb(dlState.loadedBytes)}). Revisa tu carpeta Descargas (<code className="text-emerald-200">Ctrl+J</code>) y ábrelo para ver los pasos.
                </span>
              </div>
            )}

            {dlState.status === 'error' && dlState.error && (
              <div role="alert" className="p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200">
                {dlState.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
