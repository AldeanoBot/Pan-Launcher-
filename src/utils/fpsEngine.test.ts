import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectModConflicts,
  estimatePerformance,
  generateJvmArgs,
  generateMacLinuxDesktopLauncher,
  generateOptionsTxt,
  generateUnixInstallerSh,
  generateWindowsBatLauncher,
  generateWindowsInstallerPs1,
} from './fpsEngine';
import type { ClientProfile, PerfMod, VideoSettings, JvmConfig, NetworkConfig } from '../types/client';

const sampleVideo: VideoSettings = {
  renderDistance: 8,
  simulationDistance: 6,
  maxFps: 260,
  graphicsMode: 'fast',
  smoothLighting: false,
  entityShadows: false,
  particles: 'minimal',
  clouds: 'off',
  vsync: false,
  biomeBlend: 1,
  entityDistanceScaling: 80,
  guiScale: 2,
  fullbright: true,
};

const sampleJvm: JvmConfig = {
  ramGb: 6,
  gc: 'ZGC',
  alwaysPreTouch: true,
  stringDeduplication: false,
  parallelThreads: 4,
  customArgs: '',
};

const sampleNetwork: NetworkConfig = {
  packetCompressionThreshold: 256,
  nettyThreads: 4,
  keepAliveStabilizer: true,
  disableTelemetry: true,
  tcpNoDelay: true,
};

const sampleMods: PerfMod[] = [
  {
    id: 'sodium',
    name: 'Sodium',
    version: '0.6.5',
    category: 'render',
    fpsBoostPercent: 145,
    ramSavedMb: 180,
    frametimeReductionMs: 6.2,
    enabled: true,
    conflictsWith: ['optifine'],
    description: 'Motor de renderizado OpenGL moderno',
    loaders: ['Fabric', 'NeoForge'],
  },
  {
    id: 'lithium',
    name: 'Lithium',
    version: '0.14.3',
    category: 'cpu',
    fpsBoostPercent: 32,
    ramSavedMb: 90,
    frametimeReductionMs: 1.8,
    enabled: true,
    conflictsWith: [],
    description: 'Optimización de lógica y ticks',
    loaders: ['Fabric', 'NeoForge'],
  },
  {
    id: 'optifine',
    name: 'OptiFine Legacy',
    version: 'HD_U_J2',
    category: 'render',
    fpsBoostPercent: 35,
    ramSavedMb: 20,
    frametimeReductionMs: 1.5,
    enabled: false,
    conflictsWith: ['sodium'],
    description: 'Renderizado clásico heredado',
    loaders: ['Vanilla+'],
  },
];

test('estimatePerformance calculates substantial FPS gain over vanilla', () => {
  const result = estimatePerformance(sampleMods, sampleVideo, sampleJvm, 'mid');
  assert.ok(result.estimatedFps > result.vanillaFps, 'Estimated FPS must exceed vanilla FPS');
  assert.ok(result.fpsGainPercent > 50, 'FPS gain percent should be > 50% with Sodium + Lithium');
  assert.equal(result.ramSavedMb, 270);
  assert.equal(result.conflicts.length, 0);
});

test('vsync caps estimated FPS at 60', () => {
  const result = estimatePerformance(sampleMods, { ...sampleVideo, vsync: true }, sampleJvm, 'high');
  assert.equal(result.estimatedFps, 60);
});

test('detectModConflicts catches Sodium + OptiFine enabled together', () => {
  const conflictingMods = sampleMods.map((m) =>
    m.id === 'optifine' ? { ...m, enabled: true } : m
  );
  const conflicts = detectModConflicts(conflictingMods);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].label, /Sodium.*OptiFine|OptiFine.*Sodium/);
});

test('generateJvmArgs produces ZGC generational flags and correct RAM allocation', () => {
  const args = generateJvmArgs(sampleJvm);
  assert.ok(args.includes('-Xms6144M'));
  assert.ok(args.includes('-Xmx6144M'));
  assert.ok(args.includes('-XX:+UseZGC'));
  assert.ok(args.includes('-XX:+ZGenerational'));
  assert.ok(args.includes('-XX:+AlwaysPreTouch'));
  assert.ok(args.includes('-Djdk.nio.maxCachedBufferSize=262144'));
});

test('generateJvmArgs omits -XX:+ZGenerational on Java 25 / Minecraft 26.3 and falls back to G1GC on 1.12.2', () => {
  const args263 = generateJvmArgs(sampleJvm, '26.3');
  assert.ok(args263.includes('-XX:+UseZGC'));
  assert.ok(!args263.includes('-XX:+ZGenerational'));
  assert.ok(args263.includes('-XX:+UseCompactObjectHeaders'));

  const args112 = generateJvmArgs(sampleJvm, '1.12.2');
  assert.ok(!args112.includes('-XX:+UseZGC'));
  assert.ok(args112.includes('-XX:+UseG1GC'));
});

test('generateOptionsTxt outputs valid Minecraft options keys', () => {
  const txt = generateOptionsTxt(sampleVideo, sampleNetwork);
  assert.match(txt, /renderDistance:8/);
  assert.match(txt, /ao:false/);
  assert.match(txt, /entityShadows:false/);
  assert.match(txt, /snooperEnabled:false/);
});

test('generateWindowsInstallerPs1 and generateUnixInstallerSh write options.txt and download resolved mods', () => {
  const profile: ClientProfile = {
    id: 'pvp-1214',
    name: 'Competitivo PvP',
    mcVersion: '1.21.4',
    loader: 'Fabric',
    presetId: 'pvp',
    lastPlayed: 'Hoy',
    playtimeHours: 42,
    jvm: sampleJvm,
    video: sampleVideo,
    network: sampleNetwork,
  };
  const resolved = [
    {
      id: 'sodium',
      name: 'Sodium',
      filename: 'sodium-fabric-0.6.5.jar',
      url: 'https://cdn.modrinth.com/data/AANobbMI/versions/mock/sodium-fabric-0.6.5.jar',
    },
  ];
  const ps1 = generateWindowsInstallerPs1(profile, resolved, 'mc.universocraft.com');
  assert.match(ps1, /options\.txt/);
  assert.match(ps1, /sodium-fabric-0\.6\.5\.jar/);
  assert.match(ps1, /-XX:\+UseZGC/);
  assert.match(ps1, /mc\.universocraft\.com/);

  const sh = generateUnixInstallerSh(profile, resolved);
  assert.match(sh, /#!\/usr\/bin\/env bash/);
  assert.match(sh, /curl -fsSL/);
  assert.match(sh, /sodium-fabric-0\.6\.5\.jar/);
});

test('generateWindowsBatLauncher and generateMacLinuxDesktopLauncher produce standalone --app scripts', () => {
  const bat = generateWindowsBatLauncher('https://pan-launcher.example.com');
  assert.match(bat, /@echo off/);
  assert.match(bat, /msedge\.exe" --app="%PAN_URL%"/);
  assert.match(bat, /https:\/\/pan-launcher\.example\.com/);

  const mac = generateMacLinuxDesktopLauncher('https://pan-launcher.example.com');
  assert.match(mac, /#!\/usr\/bin\/env bash/);
  assert.match(mac, /--app="\$PAN_URL"/);
});
