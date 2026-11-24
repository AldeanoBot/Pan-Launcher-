import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type {
  AccountProfile,
  AccountType,
  ClientProfile,
  HardwareTier,
  HudModule,
  ModLoader,
  MultiplayerServer,
  NavSection,
  PerfMod,
  ServerCategory,
} from './types/client';
import {
  INITIAL_ACCOUNTS,
  INITIAL_HUD_MODULES,
  INITIAL_MODS,
  INITIAL_PROFILES,
  INITIAL_SERVERS,
  PRESET_VIDEO_MAP,
} from './data/catalog';
import { estimatePerformance } from './utils/fpsEngine';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LauncherView } from './components/LauncherView';
import { MultiplayerView } from './components/MultiplayerView';
import { ModsView } from './components/ModsView';
import { HudVideoView } from './components/HudVideoView';
import { AccountsExportView } from './components/AccountsExportView';
import { InstallAppModal } from './components/InstallAppModal';
import { LaunchModal } from './components/LaunchModal';
import { DownloadPortalView } from './components/DownloadPortalView';
import { usePWAInstall } from './hooks/usePWAInstall';

const STORAGE_KEY = 'pan_launcher_state_v1';

interface PersistedState {
  profiles: ClientProfile[];
  activeProfileId: string;
  mods: PerfMod[];
  servers: MultiplayerServer[];
  accounts: AccountProfile[];
  activeAccountId: string;
  hudModules: HudModule[];
  hardwareTier: HardwareTier;
}

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (
        Array.isArray(parsed.profiles) &&
        parsed.profiles.length > 0 &&
        Array.isArray(parsed.mods) &&
        Array.isArray(parsed.servers) &&
        Array.isArray(parsed.accounts) &&
        parsed.accounts.length > 0 &&
        Array.isArray(parsed.hudModules)
      ) {
        return {
          profiles: parsed.profiles,
          activeProfileId: parsed.activeProfileId || parsed.profiles[0].id,
          mods: parsed.mods,
          servers: parsed.servers,
          accounts: parsed.accounts,
          activeAccountId: parsed.activeAccountId || parsed.accounts[0].id,
          hudModules: parsed.hudModules,
          hardwareTier: parsed.hardwareTier || 'mid',
        };
      }
    }
  } catch {
    // Fallback to initial defaults
  }

  return {
    profiles: INITIAL_PROFILES,
    activeProfileId: INITIAL_PROFILES[0].id,
    mods: INITIAL_MODS,
    servers: INITIAL_SERVERS,
    accounts: INITIAL_ACCOUNTS,
    activeAccountId: INITIAL_ACCOUNTS[0].id,
    hudModules: INITIAL_HUD_MODULES,
    hardwareTier: 'mid',
  };
}

export default function App() {
  const [initial] = useState<PersistedState>(() => loadInitialState());
  const [activeSection, setActiveSection] = useState<NavSection>('launcher');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [profiles, setProfiles] = useState<ClientProfile[]>(initial.profiles);
  const [activeProfileId, setActiveProfileId] = useState<string>(initial.activeProfileId);
  const [mods, setMods] = useState<PerfMod[]>(initial.mods);
  const [servers, setServers] = useState<MultiplayerServer[]>(initial.servers);
  const [accounts, setAccounts] = useState<AccountProfile[]>(initial.accounts);
  const [activeAccountId, setActiveAccountId] = useState<string>(initial.activeAccountId);
  const [hudModules, setHudModules] = useState<HudModule[]>(initial.hudModules);
  const [hardwareTier, setHardwareTier] = useState<HardwareTier>(initial.hardwareTier);

  const [availableVersions, setAvailableVersions] = useState<string[]>([
    '1.21.4',
    '1.21.3',
    '1.21.1',
    '1.20.4',
    '1.20.1',
    '1.19.4',
    '1.16.5',
    '1.12.2',
    '1.8.9',
  ]);

  const [isDownloadPortal, setIsDownloadPortal] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.location.pathname === '/descargar' ||
      new URLSearchParams(window.location.search).get('page') === 'descargar'
    );
  });

  useEffect(() => {
    const onPopState = () => {
      setIsDownloadPortal(
        window.location.pathname === '/descargar' ||
          new URLSearchParams(window.location.search).get('page') === 'descargar'
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [canLaunchJava, setCanLaunchJava] = useState<boolean | null>(null);
  const [targetServer, setTargetServer] = useState<{ name: string; address: string } | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // Persist to localStorage
  useEffect(() => {
    try {
      const payload: PersistedState = {
        profiles,
        activeProfileId,
        mods,
        servers,
        accounts,
        activeAccountId,
        hudModules,
        hardwareTier,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [profiles, activeProfileId, mods, servers, accounts, activeAccountId, hudModules, hardwareTier]);

  // Check whether running inside local PC runtime (capable of launching real Java)
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setCanLaunchJava(Boolean(data.canLaunchJava));
        }
      })
      .catch(() => {
        if (active) setCanLaunchJava(false);
      });

    fetch('/api/mc/versions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && Array.isArray(data.versions) && data.versions.length > 0) {
          setAvailableVersions(data.versions.map((v: { id: string }) => v.id));
        }
      })
      .catch(() => {
        // Keep curated defaults
      });
    return () => {
      active = false;
    };
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId]
  );

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) || accounts[0],
    [accounts, activeAccountId]
  );

  const estimate = useMemo(
    () => estimatePerformance(mods, activeProfile.video, activeProfile.jvm, hardwareTier),
    [mods, activeProfile.video, activeProfile.jvm, hardwareTier]
  );

  // Profile handlers
  const handleCreateProfile = (
    name: string,
    mcVersion: string,
    loader: ModLoader,
    presetId: ClientProfile['presetId']
  ) => {
    const newProfile: ClientProfile = {
      id: `prof-${Date.now()}`,
      name,
      mcVersion,
      loader,
      presetId,
      lastPlayed: 'Recién creada',
      playtimeHours: 0,
      jvm: {
        ramGb: presetId === 'potato' ? 4 : 6,
        gc: mcVersion === '1.8.9' || mcVersion === '1.12.2' ? 'G1GC' : 'ZGC',
        alwaysPreTouch: true,
        stringDeduplication: false,
        parallelThreads: 4,
        customArgs: '',
      },
      video: { ...PRESET_VIDEO_MAP[presetId] },
      network: {
        packetCompressionThreshold: 256,
        nettyThreads: 4,
        keepAliveStabilizer: true,
        disableTelemetry: true,
        tcpNoDelay: true,
      },
    };
    setProfiles((prev) => [newProfile, ...prev]);
    setActiveProfileId(newProfile.id);
  };

  const handleDeleteProfile = (id: string) => {
    setProfiles((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length > 0 && activeProfileId === id) {
        setActiveProfileId(next[0].id);
      }
      return next;
    });
  };

  const updateActiveProfile = (updater: (p: ClientProfile) => ClientProfile) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === activeProfile.id ? updater(p) : p))
    );
  };

  const handleApplyPreset = (presetId: ClientProfile['presetId']) => {
    updateActiveProfile((p) => ({
      ...p,
      presetId,
      video: { ...PRESET_VIDEO_MAP[presetId] },
    }));
  };

  // Mod handlers
  const handleToggleMod = (id: string) => {
    setMods((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)));
  };

  const handleApplyOptimalStack = () => {
    const optimalIds = new Set([
      'sodium',
      'lithium',
      'immediatelyfast',
      'ferritecore',
      'entityculling',
      'modernfix',
      'moreculling',
      'krypton',
      'c2me',
    ]);
    setMods((prev) => prev.map((m) => ({ ...m, enabled: optimalIds.has(m.id) })));
  };

  const handleResolveConflicts = () => {
    setMods((prev) =>
      prev.map((m) => {
        if (m.id === 'optifine' || m.id === 'vulkanmod') {
          return { ...m, enabled: false };
        }
        return m;
      })
    );
  };

  // Server handlers
  const handleAddServer = (name: string, address: string, category: ServerCategory) => {
    const newServer: MultiplayerServer = {
      id: `srv-${Date.now()}`,
      name,
      address,
      category,
      favorite: false,
      online: null,
      latencyMs: null,
      playersOnline: null,
      playersMax: null,
      versionName: activeProfile.mcVersion,
      motd: 'Servidor añadido por el usuario',
    };
    setServers((prev) => [newServer, ...prev]);
  };

  const handleRemoveServer = (id: string) => {
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleToggleFavorite = (id: string) => {
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s))
    );
  };

  const handleUpdateServerPing = (id: string, patch: Partial<MultiplayerServer>) => {
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  // Account handlers
  const handleAddAccount = (
    username: string,
    type: AccountType,
    capeStyle: AccountProfile['capeStyle']
  ) => {
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`;
    const acc: AccountProfile = {
      id: `acc-${Date.now()}`,
      username,
      type,
      uuid,
      capeStyle,
      skinModel: 'classic',
      accentColor: '#10B981',
    };
    setAccounts((prev) => [...prev, acc]);
    setActiveAccountId(acc.id);
  };

  const handleDeleteAccount = (id: string) => {
    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (next.length > 0 && activeAccountId === id) {
        setActiveAccountId(next[0].id);
      }
      return next;
    });
  };

  const handleUpdateCape = (id: string, capeStyle: AccountProfile['capeStyle']) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, capeStyle } : a)));
  };

  // HUD handlers
  const handleToggleHudModule = (id: HudModule['id']) => {
    setHudModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    );
  };

  if (isDownloadPortal) {
    return (
      <DownloadPortalView
        onOpenWebClient={() => {
          window.history.pushState({}, '', '/');
          setIsDownloadPortal(false);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0D10] text-[#E6E9EF] flex">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          activeAccount={activeAccount}
          hardwareTier={hardwareTier}
          onChangeHardwareTier={setHardwareTier}
          estimatedFps={estimate.estimatedFps}
          activeModsCount={estimate.activeModsCount}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 flex">
            <Sidebar
              activeSection={activeSection}
              onSelectSection={(sec) => {
                setActiveSection(sec);
                setMobileMenuOpen(false);
              }}
              activeAccount={activeAccount}
              hardwareTier={hardwareTier}
              onChangeHardwareTier={setHardwareTier}
              estimatedFps={estimate.estimatedFps}
              activeModsCount={estimate.activeModsCount}
            />
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Cerrar menú lateral"
              className="m-3 h-9 w-9 rounded-lg bg-[#161B22] border border-[#283241] flex items-center justify-center text-zinc-300"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeSection={activeSection}
          profileName={activeProfile.name}
          isInstalled={isInstalled}
          canLaunchJava={canLaunchJava}
          onOpenInstallApp={() => setShowInstallModal(true)}
          onLaunchGame={() => {
            setTargetServer(null);
            setLaunchModalOpen(true);
          }}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 p-4 md:p-7 max-w-[1320px] w-full mx-auto">
          {activeSection === 'launcher' && (
            <LauncherView
              profiles={profiles}
              activeProfile={activeProfile}
              availableVersions={availableVersions}
              estimate={estimate}
              onSelectProfile={setActiveProfileId}
              onCreateProfile={handleCreateProfile}
              onDeleteProfile={handleDeleteProfile}
              onApplyPreset={handleApplyPreset}
              onUpdateJvm={(patch) =>
                updateActiveProfile((p) => ({ ...p, jvm: { ...p.jvm, ...patch } }))
              }
              onNavigateMods={() => setActiveSection('mods')}
            />
          )}

          {activeSection === 'multiplayer' && (
            <MultiplayerView
              servers={servers}
              network={activeProfile.network}
              onAddServer={handleAddServer}
              onRemoveServer={handleRemoveServer}
              onToggleFavorite={handleToggleFavorite}
              onUpdateServerPing={handleUpdateServerPing}
              onUpdateNetwork={(patch) =>
                updateActiveProfile((p) => ({ ...p, network: { ...p.network, ...patch } }))
              }
              onLaunchServer={(address, name) => {
                setTargetServer({ address, name });
                setLaunchModalOpen(true);
              }}
            />
          )}

          {activeSection === 'mods' && (
            <ModsView
              mods={mods}
              estimate={estimate}
              onToggleMod={handleToggleMod}
              onApplyOptimalStack={handleApplyOptimalStack}
              onResolveConflicts={handleResolveConflicts}
            />
          )}

          {activeSection === 'hud' && (
            <HudVideoView
              hudModules={hudModules}
              video={activeProfile.video}
              estimate={estimate}
              onToggleHudModule={handleToggleHudModule}
              onUpdateVideo={(patch) =>
                updateActiveProfile((p) => ({ ...p, video: { ...p.video, ...patch } }))
              }
            />
          )}

          {activeSection === 'accounts' && (
            <AccountsExportView
              accounts={accounts}
              activeAccountId={activeAccount.id}
              activeProfile={activeProfile}
              mods={mods}
              onSelectAccount={setActiveAccountId}
              onAddAccount={handleAddAccount}
              onDeleteAccount={handleDeleteAccount}
              onUpdateCape={handleUpdateCape}
            />
          )}
        </main>
      </div>

      <InstallAppModal
        open={showInstallModal}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isIOS={isIOS}
        onNativeInstall={install}
        onClose={() => setShowInstallModal(false)}
      />

      <LaunchModal
        open={launchModalOpen}
        canLaunchJava={canLaunchJava}
        profile={activeProfile}
        account={activeAccount}
        mods={mods}
        serverInfo={targetServer}
        onClose={() => setLaunchModalOpen(false)}
      />
    </div>
  );
}
