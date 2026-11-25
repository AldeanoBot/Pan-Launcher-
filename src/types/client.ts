export type NavSection = 'launcher' | 'multiplayer' | 'mods' | 'hud' | 'accounts';

export type HardwareTier = 'low' | 'mid' | 'high';

export type ModLoader = 'Fabric' | 'NeoForge' | 'Quilt' | 'Vanilla+';

export type GarbageCollector = 'ZGC' | 'G1GC' | 'Shenandoah';

export type ModCategory = 'render' | 'cpu' | 'memory' | 'network';

export interface PerfMod {
  id: string;
  name: string;
  version: string;
  category: ModCategory;
  fpsBoostPercent: number;
  ramSavedMb: number;
  frametimeReductionMs: number;
  enabled: boolean;
  required?: boolean;
  conflictsWith: string[];
  description: string;
  loaders: ModLoader[];
}

export interface VideoSettings {
  renderDistance: number; // 2 to 32 chunks
  simulationDistance: number; // 5 to 16 chunks
  maxFps: number; // 60 to 260 (260 = Unlimited)
  graphicsMode: 'fast' | 'fancy' | 'fab';
  smoothLighting: boolean;
  entityShadows: boolean;
  particles: 'minimal' | 'decreased' | 'all';
  clouds: 'off' | 'fast' | 'fancy';
  vsync: boolean;
  biomeBlend: number; // 0 to 7
  entityDistanceScaling: number; // 50 to 200%
  guiScale: number; // 1 to 4
  fullbright: boolean;
  viewBobbing?: boolean;
  mipmapZero?: boolean;
  disableVisualEffects?: boolean;
}

export interface JvmConfig {
  ramGb: number;
  gc: GarbageCollector;
  alwaysPreTouch: boolean;
  stringDeduplication: boolean;
  parallelThreads: number;
  customArgs: string;
}

export interface NetworkConfig {
  packetCompressionThreshold: number; // 64, 256, 512
  nettyThreads: number;
  keepAliveStabilizer: boolean;
  disableTelemetry: boolean;
  tcpNoDelay: boolean;
}

export interface ClientProfile {
  id: string;
  name: string;
  mcVersion: string;
  loader: ModLoader;
  presetId: 'pvp' | 'survival' | 'potato' | 'shaders';
  lastPlayed: string;
  playtimeHours: number;
  jvm: JvmConfig;
  video: VideoSettings;
  network: NetworkConfig;
}

export type AccountType = 'offline' | 'elyby' | 'microsoft';

export interface AccountProfile {
  id: string;
  username: string;
  type: AccountType;
  uuid: string;
  capeStyle: 'emerald' | 'obsidian' | 'crimson' | 'none';
  skinModel: 'classic' | 'slim';
  accentColor: string;
}

export type ServerCategory = 'pvp' | 'survival' | 'skyblock' | 'custom';

export interface MultiplayerServer {
  id: string;
  name: string;
  address: string;
  category: ServerCategory;
  favorite: boolean;
  online: boolean | null;
  latencyMs: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  versionName: string | null;
  motd: string;
  featured?: boolean;
  lastChecked?: string;
}

export interface HudModule {
  id: 'fps' | 'keystrokes' | 'cps' | 'coords' | 'armor' | 'ping' | 'togglesprint' | 'compass';
  name: string;
  description: string;
  enabled: boolean;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center';
  scale: number;
}

export interface PerformanceEstimate {
  vanillaFps: number;
  estimatedFps: number;
  fpsGainPercent: number;
  vanillaFrameTimeMs: number;
  frameTimeMs: number;
  ramSavedMb: number;
  activeModsCount: number;
  conflicts: Array<{ modA: string; modB: string; label: string }>;
}
