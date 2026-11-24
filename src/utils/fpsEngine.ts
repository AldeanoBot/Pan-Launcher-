import type {
  ClientProfile,
  HardwareTier,
  JvmConfig,
  NetworkConfig,
  PerfMod,
  PerformanceEstimate,
  VideoSettings,
  AccountProfile,
} from '../types/client';

const HARDWARE_BASELINE_FPS: Record<HardwareTier, number> = {
  low: 42,
  mid: 102,
  high: 195,
};

export function detectModConflicts(
  mods: PerfMod[]
): Array<{ modA: string; modB: string; label: string }> {
  const enabledMods = mods.filter((m) => m.enabled);
  const enabledMap = new Map(enabledMods.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const conflicts: Array<{ modA: string; modB: string; label: string }> = [];

  for (const mod of enabledMods) {
    for (const targetId of mod.conflictsWith) {
      const other = enabledMap.get(targetId);
      if (other) {
        const pairKey = [mod.id, other.id].sort().join('::');
        if (!seen.has(pairKey)) {
          seen.add(pairKey);
          conflicts.push({
            modA: mod.id,
            modB: other.id,
            label: `${mod.name} es incompatible con ${other.name}`,
          });
        }
      }
    }
  }

  return conflicts;
}

export function estimatePerformance(
  mods: PerfMod[],
  video: VideoSettings,
  jvm: JvmConfig,
  hardwareTier: HardwareTier
): PerformanceEstimate {
  const baseHardwareFps = HARDWARE_BASELINE_FPS[hardwareTier];

  // Video load penalty/bonus relative to Minecraft default (12 chunks, fancy, smooth lighting on)
  const chunkFactor = Math.max(0.45, Math.min(1.55, 12 / Math.max(2, video.renderDistance)));
  const graphicsMultiplier =
    video.graphicsMode === 'fast' ? 1.14 : video.graphicsMode === 'fancy' ? 1.0 : 0.74;
  const smoothLightingMultiplier = video.smoothLighting ? 0.95 : 1.04;
  const shadowMultiplier = video.entityShadows ? 0.94 : 1.03;
  const particleMultiplier =
    video.particles === 'minimal' ? 1.06 : video.particles === 'decreased' ? 1.02 : 0.95;
  const cloudsMultiplier = video.clouds === 'off' ? 1.03 : video.clouds === 'fast' ? 1.0 : 0.94;
  const biomeMultiplier = video.biomeBlend <= 1 ? 1.03 : Math.max(0.88, 1 - video.biomeBlend * 0.015);
  const entityDistMultiplier = Math.max(0.84, Math.min(1.1, 100 / Math.max(50, video.entityDistanceScaling)));

  const rawVideoMultiplier =
    chunkFactor *
    graphicsMultiplier *
    smoothLightingMultiplier *
    shadowMultiplier *
    particleMultiplier *
    cloudsMultiplier *
    biomeMultiplier *
    entityDistMultiplier;
  const videoMultiplier = Math.pow(rawVideoMultiplier, 0.58);

  const vanillaFps = Math.max(
    18,
    Math.round(baseHardwareFps * Math.min(1.15, Math.max(0.55, chunkFactor * (video.graphicsMode === 'fab' ? 0.75 : 1))))
  );

  const enabledMods = mods.filter((m) => m.enabled);
  const conflicts = detectModConflicts(mods);

  // Calibrated saturation curve matching real Sodium + Lithium benchmarks
  let rawModBoostSum = 0;
  let ramSavedMb = 0;

  for (const mod of enabledMods) {
    rawModBoostSum += mod.fpsBoostPercent / 100;
    ramSavedMb += mod.ramSavedMb;
  }
  const modMultiplier = 1 + rawModBoostSum / (1 + rawModBoostSum * 0.28);

  // JVM GC & Memory optimization boost
  const gcBonus = jvm.gc === 'ZGC' ? 1.06 : jvm.gc === 'Shenandoah' ? 1.04 : 1.02;
  const ramBonus = jvm.ramGb >= 4 && jvm.ramGb <= 10 ? 1.03 : jvm.ramGb > 12 ? 0.98 : 0.95;
  const preTouchBonus = jvm.alwaysPreTouch ? 1.02 : 1.0;

  // Conflict penalty if incompatible mods are both enabled
  const conflictPenalty = conflicts.length > 0 ? Math.max(0.4, 1 - conflicts.length * 0.25) : 1.0;

  let rawFps = Math.round(
    baseHardwareFps * videoMultiplier * modMultiplier * gcBonus * ramBonus * preTouchBonus * conflictPenalty
  );

  if (video.vsync) {
    rawFps = Math.min(rawFps, 60);
  } else if (video.maxFps < 260) {
    rawFps = Math.min(rawFps, video.maxFps);
  }

  const estimatedFps = Math.max(15, rawFps);
  const fpsGainPercent = Math.round(((estimatedFps - vanillaFps) / Math.max(1, vanillaFps)) * 100);
  const vanillaFrameTimeMs = Number((1000 / Math.max(1, vanillaFps)).toFixed(1));
  const frameTimeMs = Number((1000 / Math.max(1, estimatedFps)).toFixed(1));

  return {
    vanillaFps,
    estimatedFps,
    fpsGainPercent,
    vanillaFrameTimeMs,
    frameTimeMs,
    ramSavedMb,
    activeModsCount: enabledMods.length,
    conflicts,
  };
}

export function resolveJavaMajorFromVersion(versionOrMajor?: string | number): number | null {
  if (typeof versionOrMajor === 'number' && Number.isFinite(versionOrMajor)) {
    return Math.round(versionOrMajor);
  }
  const id = String(versionOrMajor || '').trim();
  if (!id) return null;
  const calver = id.match(/^(\d{2,})\.(\d+)(?:\.(\d+))?/);
  if (calver && Number(calver[1]) >= 26) return 25;
  const snap = id.match(/^(\d{2})w(\d{2})/);
  if (snap) {
    const yr = Number(snap[1]);
    const wk = Number(snap[2]);
    if (yr >= 26) return 25;
    if (yr > 24 || (yr === 24 && wk >= 14)) return 21;
    return yr >= 21 ? 17 : 8;
  }
  const sem = id.match(/1\.(\d+)(?:\.(\d+))?/);
  if (sem) {
    const minor = Number(sem[1]);
    const patch = Number(sem[2] || 0);
    if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
    return minor >= 17 ? 17 : 8;
  }
  return 21;
}

export function generateJvmArgs(jvm: JvmConfig, mcVersionOrJavaMajor?: string | number): string[] {
  const ramMb = Math.max(1024, Math.round(jvm.ramGb * 1024));
  const args: string[] = [`-Xms${ramMb}M`, `-Xmx${ramMb}M`];
  const javaMajor = resolveJavaMajorFromVersion(mcVersionOrJavaMajor);
  const useSafeG1 = javaMajor !== null && javaMajor < 21 && jvm.gc === 'ZGC';

  if (jvm.gc === 'ZGC' && !useSafeG1) {
    args.push('-XX:+UseZGC');
    if (javaMajor !== null && javaMajor >= 24) {
      // Java 24/25 removed -XX:+ZGenerational and enables Generational ZGC by default
      args.push('-XX:+UnlockExperimentalVMOptions', '-XX:+UseCompactObjectHeaders');
    } else {
      args.push('-XX:+ZGenerational');
    }
  } else if (jvm.gc === 'Shenandoah' && (javaMajor === null || javaMajor >= 17)) {
    args.push('-XX:+UseShenandoahGC', '-XX:ShenandoahGCHeuristics=compact');
  } else {
    args.push(
      '-XX:+UseG1GC',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20',
      '-XX:MaxGCPauseMillis=35',
      '-XX:G1HeapRegionSize=32M'
    );
  }

  if (jvm.alwaysPreTouch) {
    args.push('-XX:+AlwaysPreTouch');
  }
  if (jvm.stringDeduplication && (jvm.gc !== 'ZGC' || useSafeG1)) {
    args.push('-XX:+UseStringDeduplication');
  }

  args.push(
    `-XX:ConcGCThreads=${Math.max(1, Math.min(8, jvm.parallelThreads))}`,
    '-XX:+DisableExplicitGC',
    '-XX:+PerfDisableSharedMem',
    '-Djdk.nio.maxCachedBufferSize=262144',
    '-Dfml.readTimeout=90'
  );

  if (jvm.customArgs.trim()) {
    const extra = jvm.customArgs
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    args.push(...extra);
  }

  return args;
}

export function generateOptionsTxt(video: VideoSettings, network: NetworkConfig): string {
  const graphicsNum = video.graphicsMode === 'fast' ? 0 : video.graphicsMode === 'fancy' ? 1 : 2;
  const particlesNum = video.particles === 'all' ? 0 : video.particles === 'decreased' ? 1 : 2;
  const cloudsStr = video.clouds === 'off' ? 'false' : video.clouds === 'fast' ? '"fast"' : '"true"';

  return [
    '# Pan-launcher - Configuracion Ultra FPS generada automaticamente',
    `renderDistance:${video.renderDistance}`,
    `simulationDistance:${video.simulationDistance}`,
    `maxFps:${video.maxFps >= 260 ? 260 : video.maxFps}`,
    `graphicsMode:${graphicsNum}`,
    `ao:${video.smoothLighting ? 'true' : 'false'}`,
    `entityShadows:${video.entityShadows ? 'true' : 'false'}`,
    `particles:${particlesNum}`,
    `renderClouds:${cloudsStr}`,
    `enableVsync:${video.vsync ? 'true' : 'false'}`,
    `biomeBlendRadius:${video.biomeBlend}`,
    `entityDistanceScaling:${(video.entityDistanceScaling / 100).toFixed(2)}`,
    `guiScale:${video.guiScale}`,
    `gamma:${video.fullbright ? '10.0' : '1.0'}`,
    `rawMouseInput:true`,
    `skipMultiplayerWarning:true`,
    `snooperEnabled:${network.disableTelemetry ? 'false' : 'true'}`,
  ].join('\n');
}

export interface ResolvedModFile {
  id: string;
  name: string;
  filename: string;
  url: string;
  sha512?: string;
  sha1?: string;
  size?: number;
}

export function generateWindowsInstallerPs1(
  profile: ClientProfile,
  resolvedMods: ResolvedModFile[],
  serverIp?: string
): string {
  const jvmFlags = generateJvmArgs(profile.jvm, profile.mcVersion).join(' ');
  const optionsTxt = generateOptionsTxt(profile.video, profile.network);
  const modLines =
    resolvedMods.length > 0
      ? resolvedMods
          .map(
            (m) =>
              `Write-Host "Descargando ${m.name}..." -ForegroundColor Cyan\nInvoke-WebRequest -Uri "${m.url}" -OutFile (Join-Path $modsDir "${m.filename}")`
          )
          .join('\r\n')
      : '# Usa el archivo .mrpack si no hay URLs directas';

  return [
    '# Instalador automatico Pan-launcher para Windows',
    '$ErrorActionPreference = "Stop"',
    '$mcDir = Join-Path $env:APPDATA ".minecraft"',
    '$modsDir = Join-Path $mcDir "mods"',
    'if (!(Test-Path $mcDir)) { New-Item -ItemType Directory -Path $mcDir -Force | Out-Null }',
    'if (!(Test-Path $modsDir)) { New-Item -ItemType Directory -Path $modsDir -Force | Out-Null }',
    '',
    'Write-Host "=== Instalando Pan-launcher (' + profile.mcVersion + ' / ' + profile.loader + ') ===" -ForegroundColor Green',
    '',
    '$optionsContent = @"',
    optionsTxt,
    '"@',
    'Set-Content -Path (Join-Path $mcDir "options.txt") -Value $optionsContent -Encoding UTF8',
    'Write-Host "options.txt optimizado guardado en $mcDir" -ForegroundColor Green',
    '',
    modLines,
    '',
    'Write-Host ""',
    'Write-Host "Listo! Perfil ' + profile.mcVersion + ' (' + profile.loader + ') configurado con Argumentos JVM de Pan-launcher:" -ForegroundColor Yellow',
    `Write-Host '${jvmFlags}' -ForegroundColor White`,
    serverIp ? `Write-Host "IP de servidor seleccionada: ${serverIp}" -ForegroundColor Cyan` : '',
    'Read-Host "Pulsa Enter para salir"',
  ]
    .filter((line) => line !== undefined)
    .join('\r\n');
}

export function generateUnixInstallerSh(
  profile: ClientProfile,
  resolvedMods: ResolvedModFile[]
): string {
  const jvmFlags = generateJvmArgs(profile.jvm, profile.mcVersion).join(' ');
  const optionsTxt = generateOptionsTxt(profile.video, profile.network);
  const modLines =
    resolvedMods.length > 0
      ? resolvedMods
          .map(
            (m) =>
              `echo "Descargando ${m.name}..."\ncurl -fsSL "${m.url}" -o "$MODS_DIR/${m.filename}"`
          )
          .join('\n')
      : '# Usa el archivo .mrpack si no hay mods directos';

  return [
    '#!/usr/bin/env bash',
    `# Instalador automatico Pan-launcher (${profile.mcVersion} / ${profile.loader})`,
    'set -euo pipefail',
    'if [[ "$OSTYPE" == "darwin"* ]]; then',
    '  MC_DIR="$HOME/Library/Application Support/minecraft"',
    'else',
    '  MC_DIR="$HOME/.minecraft"',
    'fi',
    'MODS_DIR="$MC_DIR/mods"',
    'mkdir -p "$MODS_DIR"',
    '',
    'cat << \'EOF\' > "$MC_DIR/options.txt"',
    optionsTxt,
    'EOF',
    'echo "options.txt optimizado guardado en $MC_DIR/options.txt"',
    '',
    modLines,
    '',
    'echo ""',
    `echo "Listo! Argumentos JVM de Pan-launcher (${profile.mcVersion} / ${profile.loader}):"`,
    `echo "${jvmFlags}"`,
  ].join('\n');
}

export function generateWindowsBatLauncher(appUrl: string): string {
  const safeUrl = appUrl.replace(/[^a-zA-Z0-9:/._?=&%-]/g, '') || 'http://localhost:3000';
  return [
    '@echo off',
    'chcp 65001 >nul',
    'title Pan-launcher - Cliente PC',
    `set "PAN_URL=${safeUrl}"`,
    'echo Iniciando Pan-launcher en modo ventana de escritorio...',
    '',
    'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%PAN_URL%"',
    '  exit /b',
    ')',
    'if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%PAN_URL%"',
    '  exit /b',
    ')',
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app="%PAN_URL%"',
    '  exit /b',
    ')',
    'if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" --app="%PAN_URL%"',
    '  exit /b',
    ')',
    'if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" --app="%PAN_URL%"',
    '  exit /b',
    ')',
    'if exist "%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" (',
    '  start "" "%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --app="%PAN_URL%"',
    '  exit /b',
    ')',
    'start "" "%PAN_URL%"',
  ].join('\r\n');
}

export function generateMacLinuxDesktopLauncher(appUrl: string): string {
  const safeUrl = appUrl.replace(/[^a-zA-Z0-9:/._?=&%-]/g, '') || 'http://localhost:3000';
  return [
    '#!/usr/bin/env bash',
    '# Lanzador de escritorio Pan-launcher para macOS y Linux',
    `PAN_URL="${safeUrl}"`,
    'if [[ "$OSTYPE" == "darwin"* ]]; then',
    '  if [ -d "/Applications/Google Chrome.app" ]; then',
    '    open -a "Google Chrome" --args --app="$PAN_URL"',
    '  elif [ -d "/Applications/Microsoft Edge.app" ]; then',
    '    open -a "Microsoft Edge" --args --app="$PAN_URL"',
    '  else',
    '    open "$PAN_URL"',
    '  fi',
    'elif command -v google-chrome >/dev/null 2>&1; then',
    '  google-chrome --app="$PAN_URL" >/dev/null 2>&1 &',
    'elif command -v chromium >/dev/null 2>&1; then',
    '  chromium --app="$PAN_URL" >/dev/null 2>&1 &',
    'else',
    '  xdg-open "$PAN_URL"',
    'fi',
  ].join('\n');
}

