import { useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  FileCode2,
  Laptop,
  Package,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { AccountProfile, AccountType, ClientProfile, PerfMod } from '../types/client';
import { PLAYER_AVATAR_IMG } from '../data/catalog';
import {
  generateJvmArgs,
  generateOptionsTxt,
  generateUnixInstallerSh,
  generateWindowsInstallerPs1,
  type ResolvedModFile,
} from '../utils/fpsEngine';
import {
  INITIAL_DOWNLOAD_STATE,
  downloadInstallerWithProgress,
  formatBytesMb,
  type DownloadProgressState,
} from '../utils/installerDownload';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface AccountsExportViewProps {
  accounts: AccountProfile[];
  activeAccountId: string;
  activeProfile: ClientProfile;
  mods: PerfMod[];
  onSelectAccount: (id: string) => void;
  onAddAccount: (username: string, type: AccountType, capeStyle: AccountProfile['capeStyle']) => void;
  onDeleteAccount: (id: string) => void;
  onUpdateCape: (id: string, cape: AccountProfile['capeStyle']) => void;
}

function triggerBlobDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function triggerDownload(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  triggerBlobDownload(filename, new Blob([content], { type: mime }));
}

export function AccountsExportView({
  accounts,
  activeAccountId,
  activeProfile,
  mods,
  onSelectAccount,
  onAddAccount,
  onDeleteAccount,
  onUpdateCape,
}: AccountsExportViewProps) {
  const [username, setUsername] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('offline');
  const [capeStyle] = useState<AccountProfile['capeStyle']>('emerald');
  const [error, setError] = useState('');
  const [downloadedFile, setDownloadedFile] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState<string | null>(null);
  const [dlState, setDlState] = useState<DownloadProgressState>(INITIAL_DOWNLOAD_STATE);
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const activeAccount = accounts.find((a) => a.id === activeAccountId) || accounts[0];
  const enabledModIds = mods.filter((m) => m.enabled).map((m) => m.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = username.trim();
    if (clean.length < 3 || clean.length > 16 || !/^[a-zA-Z0-9_]+$/.test(clean)) {
      setError('El nombre debe tener entre 3 y 16 caracteres (letras, números o _).');
      return;
    }
    onAddAccount(clean, accountType, capeStyle);
    setUsername('');
    setError('');
  };

  const resolveModsForInstaller = async (): Promise<ResolvedModFile[]> => {
    try {
      const res = await fetch('/api/mc/resolve-mods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modIds: enabledModIds,
          mcVersion: activeProfile.mcVersion,
          loader: activeProfile.loader,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { mods?: ResolvedModFile[] };
        return data.mods || [];
      }
    } catch {
      // Fallback to empty mod URL list if offline
    }
    return [];
  };

  const handleDownload = async (
    type: 'bat' | 'mac-sh' | 'mrpack' | 'ps1' | 'sh' | 'options' | 'jvm'
  ) => {
    setBusyExport(type);
    try {
      if (type === 'bat' || type === 'mac-sh') {
        const os = type === 'mac-sh' ? 'unix' : 'windows';
        const filename = os === 'unix' ? 'Pan-launcher.sh' : 'Pan-launcher.exe';
        const res = await fetch(`/api/pc/download-app?os=${os}`);
        if (res.ok) {
          const blob = await res.blob();
          triggerBlobDownload(filename, blob);
          setDownloadedFile(`${filename} (app local autónoma sin Chrome)`);
        }
      } else if (type === 'mrpack') {
        const filename = `Pan-launcher-${activeProfile.mcVersion}.mrpack`;
        const res = await fetch('/api/mc/export-mrpack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modIds: enabledModIds,
            mcVersion: activeProfile.mcVersion,
            loader: activeProfile.loader,
            profileName: activeProfile.name,
            optionsTxt: generateOptionsTxt(activeProfile.video, activeProfile.network),
            jvmArgs: generateJvmArgs(activeProfile.jvm).join(' '),
          }),
        });
        if (res.ok) {
          const blob = await res.blob();
          triggerBlobDownload(filename, blob);
          setDownloadedFile(filename);
        }
      } else if (type === 'ps1') {
        const resolved = await resolveModsForInstaller();
        const filename = 'instalar-pan-launcher.ps1';
        triggerDownload(filename, generateWindowsInstallerPs1(activeProfile, resolved));
        setDownloadedFile(
          resolved.length > 0
            ? `${filename} (${resolved.length} mods FPS enlazados desde Modrinth)`
            : filename
        );
      } else if (type === 'sh') {
        const resolved = await resolveModsForInstaller();
        const filename = 'instalar-pan-launcher.sh';
        triggerDownload(filename, generateUnixInstallerSh(activeProfile, resolved));
        setDownloadedFile(filename);
      } else if (type === 'options') {
        const filename = 'options.txt';
        triggerDownload(filename, generateOptionsTxt(activeProfile.video, activeProfile.network));
        setDownloadedFile(filename);
      } else if (type === 'jvm') {
        const filename = 'pan-launcher-jvm-args.txt';
        triggerDownload(filename, generateJvmArgs(activeProfile.jvm).join(' '));
        setDownloadedFile(filename);
      }
      setTimeout(() => setDownloadedFile(null), 3200);
    } finally {
      setBusyExport(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white tracking-tight">
          Descargar Pan-launcher en tu PC y Cuentas
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Instala Pan-launcher como aplicación de escritorio en Windows/Mac o descarga el paquete de mods para Minecraft Java en tu ordenador.
        </p>
      </div>

      {/* Prominent PC Download & Desktop Install Card */}
      <section className="p-6 rounded-xl bg-[#12161C] border border-emerald-500/35 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
              <Laptop className="w-5 h-5 text-emerald-400" aria-hidden="true" />
              Instalar o descargar Pan-launcher en tu PC
            </h2>
            <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
              Ejecuta Pan-launcher en una ventana propia de escritorio (sin pestañas del navegador) con acceso directo en tu PC, o instálalo como App PWA desde Chrome / Edge.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <a
              href="/descargar"
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-4 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center gap-2 whitespace-nowrap"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              {isInIframe ? 'Abrir Web de Descarga' : 'Ver Web de Descarga'}
            </a>

            {isInstalled ? (
              <span className="px-3.5 py-2 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 inline-flex items-center gap-1.5">
                <Check className="w-4 h-4" aria-hidden="true" />
                App instalada en tu equipo
              </span>
            ) : isInstallable ? (
              <button
                type="button"
                onClick={() => void install()}
                className="h-10 px-4 rounded-lg text-sm font-medium text-zinc-200 bg-[#181E27] hover:bg-[#222A35] border border-[#283241] inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Laptop className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                Instalar PWA
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
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
            className="p-4 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#242C38] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-70 cursor-pointer"
          >
            <div>
              <div className="text-sm font-semibold text-white font-mono">
                {dlState.status === 'downloading' && dlState.filename === 'Pan-launcher-Setup.exe'
                  ? `Descargando... ${dlState.percent}%`
                  : 'Pan-launcher-Setup.exe'}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Instalador gráfico 4 pasos para Windows 10/11 (sin Chrome)
              </div>
            </div>
            <Download className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={dlState.status === 'downloading'}
            onClick={() =>
              void downloadInstallerWithProgress(
                '/api/pc/download-app?os=unix&format=zip',
                'Pan-launcher-MacLinux.zip',
                setDlState
              )
            }
            className="p-4 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#242C38] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-70 cursor-pointer"
          >
            <div>
              <div className="text-sm font-semibold text-white font-mono">
                Pan-launcher-MacLinux.zip
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Lanzador para macOS y Linux en ventana de escritorio independiente
              </div>
            </div>
            <Download className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {dlState.status === 'done' && (
          <div className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>
              Descargado: <strong className="font-mono">{dlState.filename}</strong> ({formatBytesMb(dlState.loadedBytes)}). Revisa Descargas (<code className="text-emerald-200">Ctrl+J</code>).
            </span>
          </div>
        )}

        {dlState.status === 'error' && dlState.error && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/40 text-xs text-red-200">
            {dlState.error}
          </div>
        )}

        <p className="text-xs text-zinc-400">
          ¿Tu navegador bloquea archivos .exe? Usa la <button type="button" onClick={() => void downloadInstallerWithProgress('/api/pc/download-app?os=windows&format=zip', 'Pan-launcher-Installer-Windows.zip', setDlState)} className="text-emerald-300 underline underline-offset-4 cursor-pointer">alternativa en .zip</button> o abre la <a href="/descargar" target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">web oficial de descarga</a>.
        </p>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Accounts & Skin Preview */}
        <section className="xl:col-span-6 p-6 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 pb-5 border-b border-[#1E242E]">
            <div className="w-24 h-24 rounded-xl overflow-hidden bg-[#181E27] border border-[#283241] shrink-0">
              <img
                src={PLAYER_AVATAR_IMG}
                alt={`Skin de ${activeAccount.username}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-emerald-400">
                Cuenta activa ·{' '}
                {activeAccount.type === 'offline'
                  ? 'Offline / No-Premium'
                  : activeAccount.type === 'elyby'
                  ? 'Ely.by Skins'
                  : 'Microsoft Oficial'}
              </div>
              <h2 className="font-display text-2xl font-bold text-white mt-0.5 truncate">
                {activeAccount.username}
              </h2>
              <div className="text-xs font-mono text-zinc-500 mt-1 truncate">
                UUID: {activeAccount.uuid}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">Capa Pan-launcher:</span>
                {(
                  [
                    { id: 'emerald', label: 'Esmeralda' },
                    { id: 'obsidian', label: 'Obsidiana' },
                    { id: 'crimson', label: 'Carmesí' },
                    { id: 'none', label: 'Sin capa' },
                  ] as const
                ).map((cape) => (
                  <button
                    key={cape.id}
                    type="button"
                    onClick={() => onUpdateCape(activeAccount.id, cape.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      activeAccount.capeStyle === cape.id
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                        : 'bg-[#0E1116] border-[#242C38] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {cape.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Accounts List */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Perfiles guardados</h3>
            <div className="divide-y divide-[#1E242E] rounded-lg border border-[#1E242E] bg-[#0E1116] overflow-hidden">
              {accounts.map((acc) => {
                const isSelected = acc.id === activeAccount.id;
                return (
                  <div key={acc.id} className="p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {acc.username}
                        </span>
                        <span className="text-xs text-zinc-400">
                          · {acc.type === 'offline' ? 'Offline' : acc.type === 'elyby' ? 'Ely.by' : 'Microsoft'}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 truncate">{acc.uuid}</div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectAccount(acc.id)}
                        className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                            : 'bg-[#141920] border-[#283241] text-zinc-300 hover:text-white'
                        }`}
                      >
                        {isSelected ? 'Activa' : 'Usar cuenta'}
                      </button>

                      {accounts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteAccount(acc.id)}
                          aria-label={`Eliminar cuenta ${acc.username}`}
                          className="h-8 px-2 rounded-md text-zinc-500 hover:text-red-400 bg-[#141920] border border-[#283241]"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Account Form */}
          <form onSubmit={handleSubmit} className="pt-2 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              Añadir nueva cuenta
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="acc-username" className="block text-xs text-zinc-400 mb-1">
                  Nombre de jugador
                </label>
                <input
                  id="acc-username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Ej. ProPvP_2026"
                  className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="acc-type" className="block text-xs text-zinc-400 mb-1">
                  Tipo de autenticación
                </label>
                <select
                  id="acc-type"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  className="w-full h-10 px-3 rounded-lg bg-[#0B0D10] border border-[#283241] text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <option value="offline">Sin conexión (Offline)</option>
                  <option value="elyby">Ely.by (Skins gratis)</option>
                  <option value="microsoft">Microsoft Premium</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full h-10 px-4 rounded-lg text-sm font-semibold text-[#05120C] bg-emerald-500 hover:bg-emerald-400 inline-flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Agregar cuenta
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>
        </section>

        {/* Right: Real Modpack & PC Exporter */}
        <section className="xl:col-span-6 p-6 rounded-xl bg-[#12161C] border border-[#1E242E] space-y-5 h-fit">
          <div>
            <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              Exportar pack y configuración local
            </h2>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Al usar <strong className="text-zinc-200">Pan-launcher.exe</strong> en tu PC, el botón <strong className="text-zinc-200">Jugar ahora</strong> descarga e inicia Minecraft Java real automáticamente; aquí también puedes exportar tu modpack ({enabledModIds.length} mods FPS de Modrinth) o <code className="text-zinc-300">options.txt</code> manualmente.
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={busyExport !== null}
              onClick={() => handleDownload('mrpack')}
              className="w-full p-4 rounded-lg bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-60"
            >
              <div>
                <div className="text-sm font-semibold text-white font-mono">
                  Pan-launcher-{activeProfile.mcVersion}.mrpack
                </div>
                <div className="text-xs text-zinc-300 mt-0.5">
                  Modpack Modrinth completo con mods de rendimiento + options.txt
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              disabled={busyExport !== null}
              onClick={() => handleDownload('ps1')}
              className="w-full p-3.5 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#222A35] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-60"
            >
              <div>
                <div className="text-sm font-semibold text-white font-mono">
                  instalar-pan-launcher.ps1
                </div>
                <div className="text-xs text-zinc-400">
                  Instalador Windows: descarga los .jar de Modrinth y configura options.txt
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              disabled={busyExport !== null}
              onClick={() => handleDownload('sh')}
              className="w-full p-3.5 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#222A35] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-60"
            >
              <div>
                <div className="text-sm font-semibold text-white font-mono">
                  instalar-pan-launcher.sh
                </div>
                <div className="text-xs text-zinc-400">
                  Instalador Linux / macOS: instala los mods FPS y options.txt
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleDownload('options')}
                className="p-3 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#222A35] flex items-center justify-between gap-2 text-left transition-colors"
              >
                <div>
                  <div className="text-xs font-semibold text-white font-mono">options.txt</div>
                  <div className="text-[11px] text-zinc-400">Solo ajustes de vídeo</div>
                </div>
                <FileCode2 className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => handleDownload('jvm')}
                className="p-3 rounded-lg bg-[#0E1116] hover:bg-[#171D26] border border-[#222A35] flex items-center justify-between gap-2 text-left transition-colors"
              >
                <div>
                  <div className="text-xs font-semibold text-white font-mono">pan-launcher-jvm-args.txt</div>
                  <div className="text-[11px] text-zinc-400">Flags {activeProfile.jvm.gc} ({activeProfile.jvm.ramGb} GB)</div>
                </div>
                <FileCode2 className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>

          {downloadedFile && (
            <div className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Descargado correctamente: {downloadedFile}</span>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-[#0B0D10] border border-[#1E242E] flex items-start gap-2.5 text-xs text-zinc-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Todas tus cuentas, servidores y ajustes de Pan-launcher se guardan localmente en tu navegador sin enviar credenciales a terceros.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
