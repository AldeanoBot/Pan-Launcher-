import express from 'express';
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { build as viteBuild, createServer as createViteServer } from 'vite';
import {
  buildUnixSelfContainedSh,
  buildWindowsExe,
  buildWindowsGuidedCmd,
  buildWindowsGuidedGuiPs1,
  buildWindowsLaunchPs1,
  buildWindowsPanAppCs,
  buildWindowsSelfContainedBat,
  buildWindowsServerPs1,
  buildWindowsStartServerCmd,
} from './src/utils/pcPackager';
import {
  DefaultSkinAsset,
  PanLoaderCatalogItem,
  PanVersionItem,
  RawMojangManifest,
  generateDefaultPngSkin,
  mapFabricLoaderItems,
  mapForgeLoaderItems,
  mapMojangManifest,
  mapNeoforgeLoaderItems,
} from './src/utils/panBackend';
import {
  detectModConflicts,
  estimatePerformance,
  generateJvmArgs,
  generateOptionsTxt,
} from './src/utils/fpsEngine';
import {
  INITIAL_MODS,
  INITIAL_PROFILES,
  PRESET_VIDEO_MAP,
} from './src/data/catalog';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let temp = v & 0x7f;
    v >>>= 7;
    if (v !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset = 0): { value: number; length: number } | null {
  let numRead = 0;
  let result = 0;
  let read: number;
  do {
    if (offset + numRead >= buffer.length) return null;
    read = buffer[offset + numRead];
    const value = read & 0x7f;
    result |= value << (7 * numRead);
    numRead++;
    if (numRead > 5) throw new Error('VarInt demasiado grande');
  } while ((read & 0x80) !== 0);
  return { value: result, length: numRead };
}

function createPacket(packetId: number, payload: Buffer): Buffer {
  const idBuf = writeVarInt(packetId);
  const full = Buffer.concat([idBuf, payload]);
  return Buffer.concat([writeVarInt(full.length), full]);
}

function stripMotdFormatting(desc: unknown): string {
  if (!desc) return 'Servidor Minecraft';
  if (typeof desc === 'string') {
    return desc.replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
  }
  if (typeof desc === 'object') {
    const obj = desc as { text?: string; extra?: unknown[] };
    let out = obj.text || '';
    if (Array.isArray(obj.extra)) {
      out += obj.extra.map((part) => stripMotdFormatting(part)).join('');
    }
    return out.replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
  }
  return 'Servidor Minecraft';
}

interface PingResult {
  online: boolean;
  host: string;
  port: number;
  latencyMs: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  versionName: string | null;
  motd: string | null;
  checkedAt: string;
  error?: string;
}

async function pingMinecraftServer(rawAddress: string): Promise<PingResult> {
  const trimmed = rawAddress.trim();
  const [hostPart, portPart] = trimmed.split(':');
  let host = hostPart || '';
  let port = portPart ? Number.parseInt(portPart, 10) : 25565;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    port = 25565;
  }

  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) {
    return {
      online: false,
      host: trimmed,
      port,
      latencyMs: null,
      playersOnline: null,
      playersMax: null,
      versionName: null,
      motd: null,
      checkedAt: new Date().toISOString(),
      error: 'Dirección IP o dominio inválido',
    };
  }

  // Try SRV lookup when no explicit port was given
  if (!portPart) {
    try {
      const srv = await Promise.race([
        dns.resolveSrv(`_minecraft._tcp.${host}`),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('SRV timeout')), 700)),
      ]);
      if (srv && srv.length > 0) {
        host = srv[0].name;
        port = srv[0].port;
      }
    } catch {
      // Ignore SRV failure and connect directly
    }
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let settled = false;
    let recvBuffer = Buffer.alloc(0);

    const finish = (result: PingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(2500);

    socket.on('timeout', () => {
      finish({
        online: false,
        host: hostPart,
        port,
        latencyMs: null,
        playersOnline: null,
        playersMax: null,
        versionName: null,
        motd: null,
        checkedAt: new Date().toISOString(),
        error: 'Tiempo de espera agotado (2.5s)',
      });
    });

    socket.on('error', (err) => {
      finish({
        online: false,
        host: hostPart,
        port,
        latencyMs: null,
        playersOnline: null,
        playersMax: null,
        versionName: null,
        motd: null,
        checkedAt: new Date().toISOString(),
        error: err.message || 'No se pudo conectar',
      });
    });

    socket.connect(port, host, () => {
      const protocolVersion = writeVarInt(767);
      const hostBytes = Buffer.from(host, 'utf8');
      const hostLen = writeVarInt(hostBytes.length);
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port, 0);
      const nextState = writeVarInt(1); // Status

      const handshakePayload = Buffer.concat([protocolVersion, hostLen, hostBytes, portBuf, nextState]);
      const handshakePacket = createPacket(0x00, handshakePayload);
      const statusRequestPacket = createPacket(0x00, Buffer.alloc(0));

      socket.write(Buffer.concat([handshakePacket, statusRequestPacket]));
    });

    socket.on('data', (chunk) => {
      recvBuffer = Buffer.concat([recvBuffer, chunk]);
      try {
        const packetLength = readVarInt(recvBuffer, 0);
        if (!packetLength) return;
        const totalExpected = packetLength.length + packetLength.value;
        if (recvBuffer.length < totalExpected) return;

        let cursor = packetLength.length;
        const packetId = readVarInt(recvBuffer, cursor);
        if (!packetId || packetId.value !== 0x00) {
          finish({
            online: false,
            host: hostPart,
            port,
            latencyMs: null,
            playersOnline: null,
            playersMax: null,
            versionName: null,
            motd: null,
            checkedAt: new Date().toISOString(),
            error: 'Respuesta de protocolo inesperada',
          });
          return;
        }
        cursor += packetId.length;
        const jsonLen = readVarInt(recvBuffer, cursor);
        if (!jsonLen) return;
        cursor += jsonLen.length;
        const jsonStr = recvBuffer.subarray(cursor, cursor + jsonLen.value).toString('utf8');
        const parsed = JSON.parse(jsonStr);
        const latencyMs = Math.max(1, Date.now() - startTime);

        finish({
          online: true,
          host: hostPart,
          port,
          latencyMs,
          playersOnline: typeof parsed?.players?.online === 'number' ? parsed.players.online : null,
          playersMax: typeof parsed?.players?.max === 'number' ? parsed.players.max : null,
          versionName: parsed?.version?.name ? String(parsed.version.name) : null,
          motd: stripMotdFormatting(parsed?.description) || 'Servidor Minecraft',
          checkedAt: new Date().toISOString(),
        });
      } catch {
        // Wait for more bytes or fail cleanly on close
      }
    });
  });
}

let cachedVersions: { latest: { release: string; snapshot: string }; versions: Array<{ id: string; type: string }> } | null = null;

interface PanVersionsCacheEntry {
  items: PanVersionItem[];
  fetchedAt: number;
  stale: boolean;
  warning: string | null;
  source: 'official' | 'cache' | 'unavailable';
}

let cachedPanManifest: PanVersionsCacheEntry | null = null;
const cachedPanCatalogs = new Map<string, { items: PanLoaderCatalogItem[]; fetchedAt: number }>();
let cachedDefaultSkins: DefaultSkinAsset[] | null = null;

const PAN_MANIFEST_TTL_MS = 5 * 60 * 1000;
const PAN_CATALOG_TTL_MS = 15 * 60 * 1000;

async function fetchWithTimeout(url: string, accept: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'PanLauncher/0.1.0',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getPanVersions(force = false): Promise<PanVersionsCacheEntry> {
  if (!force && cachedPanManifest && Date.now() - cachedPanManifest.fetchedAt < PAN_MANIFEST_TTL_MS) {
    return cachedPanManifest;
  }
  try {
    const resp = await fetchWithTimeout(
      'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      'application/json',
      6000
    );
    if (!resp.ok) {
      throw new Error(`Error HTTP ${resp.status} en piston-meta.mojang.com`);
    }
    const data = (await resp.json()) as RawMojangManifest;
    const items = mapMojangManifest(data);
    if (items.length === 0) {
      throw new Error('El manifest oficial no contiene versiones.');
    }
    cachedPanManifest = {
      items,
      fetchedAt: Date.now(),
      stale: false,
      warning: null,
      source: 'official',
    };
    return cachedPanManifest;
  } catch (err) {
    if (cachedPanManifest) {
      return {
        ...cachedPanManifest,
        stale: true,
        source: 'cache',
        warning: `Manifest oficial en caché: ${err instanceof Error ? err.message : 'sin conexión'}.`,
      };
    }
    const fallbackItems: PanVersionItem[] = [
      { id: '26.3', order: 0, type: 'release', category: 'release', rawType: 'release', released: '2026-04-01T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: true, latestSnapshot: false },
      { id: '1.21.11', order: 1, type: 'release', category: 'release', rawType: 'release', released: '2025-12-09T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.21.4', order: 2, type: 'release', category: 'release', rawType: 'release', released: '2024-12-03T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.21.3', order: 3, type: 'release', category: 'release', rawType: 'release', released: '2024-10-23T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.21.1', order: 4, type: 'release', category: 'release', rawType: 'release', released: '2024-08-08T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.20.4', order: 5, type: 'release', category: 'release', rawType: 'release', released: '2023-12-07T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.20.1', order: 6, type: 'release', category: 'release', rawType: 'release', released: '2023-06-12T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.19.4', order: 7, type: 'release', category: 'release', rawType: 'release', released: '2023-03-14T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.16.5', order: 8, type: 'release', category: 'release', rawType: 'release', released: '2021-01-15T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.12.2', order: 9, type: 'release', category: 'release', rawType: 'release', released: '2017-09-18T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
      { id: '1.8.9', order: 10, type: 'release', category: 'release', rawType: 'release', released: '2015-12-09T12:00:00+00:00', sha1: '', source: 'cache', latestRelease: false, latestSnapshot: false },
    ];
    return {
      items: fallbackItems,
      fetchedAt: Date.now(),
      stale: true,
      warning: 'No se pudo consultar piston-meta.mojang.com; se muestra lista local en caché.',
      source: 'cache',
    };
  }
}

async function getPanLoaderCatalog(
  loader: 'fabric' | 'forge' | 'neoforge',
  gameVersion: string,
  force = false
): Promise<{
  schemaVersion: number;
  loader: string;
  gameVersion: string;
  fetchedAt: number;
  source: 'official' | 'cache';
  stale: boolean;
  warning: string | null;
  items: PanLoaderCatalogItem[];
}> {
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(gameVersion)) {
    throw new Error('Versión de Minecraft no válida.');
  }
  const key = `${loader}:${gameVersion}`;
  const cached = cachedPanCatalogs.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < PAN_CATALOG_TTL_MS) {
    return {
      schemaVersion: 1,
      loader,
      gameVersion,
      fetchedAt: cached.fetchedAt,
      source: 'official',
      stale: false,
      warning: null,
      items: cached.items,
    };
  }
  try {
    let items: PanLoaderCatalogItem[] = [];
    if (loader === 'fabric') {
      const resp = await fetchWithTimeout(
        `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`,
        'application/json',
        6500
      );
      if (!resp.ok) throw new Error(`Error HTTP ${resp.status} en meta.fabricmc.net`);
      items = mapFabricLoaderItems(await resp.json(), gameVersion);
    } else if (loader === 'forge') {
      const resp = await fetchWithTimeout(
        'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
        'application/xml',
        7500
      );
      if (!resp.ok) throw new Error(`Error HTTP ${resp.status} en maven.minecraftforge.net`);
      items = mapForgeLoaderItems(await resp.text(), gameVersion);
    } else {
      const resp = await fetchWithTimeout(
        'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
        'application/xml',
        7500
      );
      if (!resp.ok) throw new Error(`Error HTTP ${resp.status} en maven.neoforged.net`);
      items = mapNeoforgeLoaderItems(await resp.text(), gameVersion);
    }
    const fetchedAt = Date.now();
    cachedPanCatalogs.set(key, { items, fetchedAt });
    return {
      schemaVersion: 1,
      loader,
      gameVersion,
      fetchedAt,
      source: 'official',
      stale: false,
      warning: null,
      items,
    };
  } catch (err) {
    if (cached) {
      return {
        schemaVersion: 1,
        loader,
        gameVersion,
        fetchedAt: cached.fetchedAt,
        source: 'cache',
        stale: true,
        warning: err instanceof Error ? err.message : 'Catálogo en caché por falta de conexión.',
        items: cached.items,
      };
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'pan-launcher-api', canLaunchJava: false });
  });

  app.get('/api/pan/versions', async (req, res) => {
    const force = req.query.force === 'true' || req.query.force === '1';
    const result = await getPanVersions(force);
    res.json(result);
  });

  app.get('/api/pan/catalog/:kind/:gameVersion', async (req, res) => {
    const kind = String(req.params.kind || '').toLowerCase();
    const gameVersion = String(req.params.gameVersion || '');
    const force = req.query.force === 'true' || req.query.force === '1';
    try {
      if (kind === 'vanilla') {
        const result = await getPanVersions(force);
        res.json({
          schemaVersion: 1,
          loader: 'vanilla',
          gameVersion: null,
          fetchedAt: result.fetchedAt,
          source: result.source,
          stale: result.stale,
          warning: result.warning,
          items: result.items,
        });
        return;
      }
      if (kind !== 'fabric' && kind !== 'forge' && kind !== 'neoforge') {
        res.status(400).json({ error: 'Loader no válido (Vanilla, Fabric, Forge o NeoForge).' });
        return;
      }
      const catalog = await getPanLoaderCatalog(kind, gameVersion, force);
      res.json(catalog);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : `No se pudo consultar el catálogo de ${kind}.`,
      });
    }
  });

  app.get('/api/pan/loaders/:loader/:gameVersion', async (req, res) => {
    const loader = String(req.params.loader || '').toLowerCase();
    const gameVersion = String(req.params.gameVersion || '');
    const force = req.query.force === 'true' || req.query.force === '1';
    if (loader !== 'fabric' && loader !== 'forge' && loader !== 'neoforge') {
      res.status(400).json({ error: 'Loader no válido (Fabric, Forge o NeoForge).' });
      return;
    }
    try {
      const catalog = await getPanLoaderCatalog(loader, gameVersion, force);
      res.json(catalog);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : `No se pudo consultar el catálogo de ${loader}.`,
      });
    }
  });

  app.get('/api/pan/default-skins', (_req, res) => {
    if (!cachedDefaultSkins) {
      cachedDefaultSkins = [generateDefaultPngSkin('steve'), generateDefaultPngSkin('alex')];
    }
    res.json({ items: cachedDefaultSkins });
  });

  app.post('/api/pan/performance-eval', (req, res) => {
    try {
      const body = req.body || {};
      const presetKey: 'pvp' | 'survival' | 'potato' | 'shaders' =
        body.presetId === 'survival' || body.presetId === 'potato' || body.presetId === 'shaders'
          ? body.presetId
          : 'pvp';
      const defaultVideo = PRESET_VIDEO_MAP[presetKey];
      const defaultJvm = INITIAL_PROFILES[0].jvm;
      const defaultNetwork = INITIAL_PROFILES[0].network;

      let mods = INITIAL_MODS.map((m) => ({ ...m }));
      if (Array.isArray(body.mods) && body.mods.length > 0) {
        if (typeof body.mods[0] === 'string') {
          const activeIds = new Set(body.mods.map(String));
          mods = INITIAL_MODS.map((m) => ({ ...m, enabled: activeIds.has(m.id) }));
        } else {
          const byId = new Map(INITIAL_MODS.map((m) => [m.id, m]));
          mods = body.mods.map((raw: Record<string, unknown>) => {
            const base = byId.get(String(raw?.id || ''));
            return {
              id: String(raw?.id || base?.id || 'custom'),
              name: String(raw?.name || base?.name || 'Custom Mod'),
              version: String(raw?.version || base?.version || '1.0.0'),
              category: (raw?.category as (typeof INITIAL_MODS)[number]['category']) || base?.category || 'render',
              fpsBoostPercent: Number(raw?.fpsBoostPercent ?? base?.fpsBoostPercent ?? 10),
              ramSavedMb: Number(raw?.ramSavedMb ?? base?.ramSavedMb ?? 0),
              frametimeReductionMs: Number(raw?.frametimeReductionMs ?? base?.frametimeReductionMs ?? 0.5),
              enabled: raw?.enabled !== undefined ? Boolean(raw.enabled) : true,
              conflictsWith: Array.isArray(raw?.conflictsWith)
                ? raw.conflictsWith.map(String)
                : base?.conflictsWith || [],
              description: String(raw?.description || base?.description || ''),
              loaders: Array.isArray(raw?.loaders) ? raw.loaders.map(String) : base?.loaders || ['Fabric'],
            };
          });
        }
      } else if (Array.isArray(body.mods) && body.mods.length === 0) {
        mods = INITIAL_MODS.map((m) => ({ ...m, enabled: false }));
      }

      const video = { ...defaultVideo, ...(body.video && typeof body.video === 'object' ? body.video : {}) };
      const ramGbFromMb =
        typeof body.ramMb === 'number' && Number.isFinite(body.ramMb)
          ? Math.max(1, Math.round(body.ramMb / 1024))
          : defaultJvm.ramGb;
      const jvm = {
        ...defaultJvm,
        ramGb: ramGbFromMb,
        ...(body.jvm && typeof body.jvm === 'object' ? body.jvm : {}),
      };
      const network = {
        ...defaultNetwork,
        ...(body.network && typeof body.network === 'object' ? body.network : {}),
      };
      const hardwareTier =
        body.hardwareTier === 'low' || body.hardwareTier === 'high' ? body.hardwareTier : 'mid';
      const estimate = estimatePerformance(mods, video, jvm, hardwareTier);
      const conflicts = detectModConflicts(mods);
      const mcVer = typeof body.mcVersion === 'string' ? body.mcVersion : undefined;
      const jvmArgs = generateJvmArgs(jvm, mcVer);
      const optionsTxt = generateOptionsTxt(video, network);
      res.json({ estimate, conflicts, jvmArgs, optionsTxt });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Datos de rendimiento no válidos.',
      });
    }
  });

  app.post('/api/mc/ping', async (req, res) => {
    const address = typeof req.body?.address === 'string' ? req.body.address : '';
    if (!address.trim()) {
      res.status(400).json({ error: 'Dirección de servidor requerida' });
      return;
    }
    const result = await pingMinecraftServer(address);
    res.json(result);
  });

  app.get('/api/mc/versions', async (_req, res) => {
    if (cachedVersions) {
      res.json(cachedVersions);
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        const data = (await response.json()) as {
          latest: { release: string; snapshot: string };
          versions: Array<{ id: string; type: string }>;
        };
        const releases = data.versions
          .filter((v) => v.type === 'release')
          .slice(0, 20)
          .map((v) => ({ id: v.id, type: v.type }));
        cachedVersions = { latest: data.latest, versions: releases };
        res.json(cachedVersions);
        return;
      }
    } catch {
      // Fallback curated list if network is restricted
    }

    res.json({
      latest: { release: '26.3', snapshot: '26w14a' },
      versions: [
        { id: '26.3', type: 'release' },
        { id: '1.21.11', type: 'release' },
        { id: '1.21.4', type: 'release' },
        { id: '1.21.3', type: 'release' },
        { id: '1.21.1', type: 'release' },
        { id: '1.20.4', type: 'release' },
        { id: '1.20.1', type: 'release' },
        { id: '1.19.4', type: 'release' },
        { id: '1.18.2', type: 'release' },
        { id: '1.16.5', type: 'release' },
        { id: '1.12.2', type: 'release' },
        { id: '1.8.9', type: 'release' },
      ],
    });
  });

  const MODRINTH_SLUGS: Record<string, { slug: string; name: string }> = {
    sodium: { slug: 'sodium', name: 'Sodium' },
    lithium: { slug: 'lithium', name: 'Lithium' },
    immediatelyfast: { slug: 'immediatelyfast', name: 'ImmediatelyFast' },
    ferritecore: { slug: 'ferrite-core', name: 'FerriteCore' },
    entityculling: { slug: 'entityculling', name: 'EntityCulling' },
    modernfix: { slug: 'modernfix', name: 'ModernFix' },
    moreculling: { slug: 'moreculling', name: 'MoreCulling' },
    krypton: { slug: 'krypton', name: 'Krypton' },
    c2me: { slug: 'c2me-fabric', name: 'C2ME' },
    nvidium: { slug: 'nvidium', name: 'Nvidium' },
    vulkanmod: { slug: 'vulkanmod', name: 'VulkanMod' },
  };

  interface ModrinthFileEntry {
    id: string;
    name: string;
    filename: string;
    url: string;
    sha512: string;
    sha1: string;
    size: number;
  }

  async function resolveModsFromModrinth(
    modIds: string[],
    mcVersion: string,
    loader: string
  ): Promise<ModrinthFileEntry[]> {
    const loaderSlug = loader === 'NeoForge' ? 'neoforge' : loader === 'Quilt' ? 'quilt' : 'fabric';
    const targets = modIds.filter((id) => MODRINTH_SLUGS[id]);
    const results = await Promise.all(
      targets.map(async (id): Promise<ModrinthFileEntry | null> => {
        const meta = MODRINTH_SLUGS[id];
        try {
          const url = `https://api.modrinth.com/v2/project/${meta.slug}/version?game_versions=${encodeURIComponent(
            JSON.stringify([mcVersion])
          )}&loaders=${encodeURIComponent(JSON.stringify([loaderSlug]))}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'PanLauncher/1.0 (https://pan-launcher.local)' },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!resp.ok) return null;
          const versions = (await resp.json()) as Array<{
            files?: Array<{
              url: string;
              filename: string;
              primary?: boolean;
              size?: number;
              hashes?: { sha512?: string; sha1?: string };
            }>;
          }>;
          if (!Array.isArray(versions) || versions.length === 0) return null;
          const file = versions[0].files?.find((f) => f.primary) || versions[0].files?.[0];
          if (!file?.url || !file?.filename) return null;
          return {
            id,
            name: meta.name,
            filename: file.filename,
            url: file.url,
            sha512: file.hashes?.sha512 || '',
            sha1: file.hashes?.sha1 || '',
            size: file.size || 0,
          };
        } catch {
          return null;
        }
      })
    );
    return results.filter((r): r is ModrinthFileEntry => r !== null);
  }

  app.post('/api/mc/resolve-mods', async (req, res) => {
    const modIds = Array.isArray(req.body?.modIds) ? req.body.modIds.map(String) : [];
    const mcVersion = typeof req.body?.mcVersion === 'string' ? req.body.mcVersion : '1.21.4';
    const loader = typeof req.body?.loader === 'string' ? req.body.loader : 'Fabric';
    const resolved = await resolveModsFromModrinth(modIds, mcVersion, loader);
    res.json({ mcVersion, loader, mods: resolved });
  });

  app.post('/api/mc/export-mrpack', async (req, res) => {
    const modIds = Array.isArray(req.body?.modIds) ? req.body.modIds.map(String) : [];
    const mcVersion = typeof req.body?.mcVersion === 'string' ? req.body.mcVersion : '1.21.4';
    const loader = typeof req.body?.loader === 'string' ? req.body.loader : 'Fabric';
    const profileName = typeof req.body?.profileName === 'string' ? req.body.profileName : 'Pan-launcher';
    const optionsTxt = typeof req.body?.optionsTxt === 'string' ? req.body.optionsTxt : '';
    const jvmArgs = typeof req.body?.jvmArgs === 'string' ? req.body.jvmArgs : '';

    const resolved = await resolveModsFromModrinth(modIds, mcVersion, loader);
    const dependencies: Record<string, string> = { minecraft: mcVersion };
    if (loader === 'NeoForge') {
      dependencies['neoforge'] = '21.4.0-beta';
    } else if (loader === 'Quilt') {
      dependencies['quilt-loader'] = '0.28.0';
    } else {
      dependencies['fabric-loader'] = '0.16.10';
    }

    const indexJson = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: `pan-launcher-${mcVersion}`,
      name: profileName,
      summary: 'Pack optimizado para máximo FPS generado con Pan-launcher',
      files: resolved.map((m) => ({
        path: `mods/${m.filename}`,
        hashes: {
          ...(m.sha1 ? { sha1: m.sha1 } : {}),
          ...(m.sha512 ? { sha512: m.sha512 } : {}),
        },
        env: { client: 'required', server: 'optional' },
        downloads: [m.url],
        fileSize: m.size || 0,
      })),
      dependencies,
    };

    const zip = new JSZip();
    zip.file('modrinth.index.json', JSON.stringify(indexJson, null, 2));
    if (optionsTxt) {
      zip.file('overrides/options.txt', optionsTxt);
    }
    if (jvmArgs) {
      zip.file('overrides/pan-launcher-jvm-args.txt', jvmArgs);
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/x-modrinth-modpack+zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Pan-launcher-${mcVersion.replace(/[^a-zA-Z0-9._-]/g, '')}.mrpack"`
    );
    res.send(buffer);
  });

  let cachedPcBundle: {
    mtimeMs: number;
    version: string;
    zipBase64: string;
    zipBuffer: Buffer;
    winExeBundleBuffer: Buffer;
    winScriptBundleBuffer: Buffer;
  } | null = null;

  async function getDistZipBundle(): Promise<{
    version: string;
    zipBase64: string;
    zipBuffer: Buffer;
    winExeBundleBuffer: Buffer;
    winScriptBundleBuffer: Buffer;
  }> {
    const distDir = path.resolve(__dirname, 'dist');
    const distIndex = path.join(distDir, 'index.html');
    if (!fs.existsSync(distIndex)) {
      await viteBuild({ root: __dirname, logLevel: 'silent' });
    }
    const stat = fs.statSync(distIndex);
    if (cachedPcBundle && cachedPcBundle.mtimeMs === stat.mtimeMs) {
      return {
        version: cachedPcBundle.version,
        zipBase64: cachedPcBundle.zipBase64,
        zipBuffer: cachedPcBundle.zipBuffer,
        winExeBundleBuffer: cachedPcBundle.winExeBundleBuffer,
        winScriptBundleBuffer: cachedPcBundle.winScriptBundleBuffer,
      };
    }

    const distEntries: Array<{ rel: string; data: Buffer }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(distDir, full).replace(/\\/g, '/');
        if (rel === 'assets/aistudio' || rel.startsWith('assets/aistudio/')) {
          continue;
        }
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          distEntries.push({ rel, data: fs.readFileSync(full) });
        }
      }
    };
    walk(distDir);

    const zip = new JSZip();
    const winScriptZip = new JSZip();
    const winExeZip = new JSZip();

    for (const item of distEntries) {
      zip.file(item.rel, item.data);
      winScriptZip.file(`app/${item.rel}`, item.data);
      winExeZip.file(`app/${item.rel}`, item.data);
    }

    const version = String(Math.round(stat.mtimeMs));
    const withUtf8Bom = (s: string) => `\uFEFF${s}`;
    const commonWinFiles: Array<{ rel: string; content: string | Buffer }> = [
      { rel: 'server.ps1', content: withUtf8Bom(buildWindowsServerPs1()) },
      { rel: 'launch.ps1', content: withUtf8Bom(buildWindowsLaunchPs1()) },
      { rel: 'start-server.cmd', content: buildWindowsStartServerCmd() },
      { rel: 'appbin/PanLauncherApp.cs', content: buildWindowsPanAppCs() },
      { rel: 'version.txt', content: version },
    ];
    for (const f of commonWinFiles) {
      winScriptZip.file(f.rel, f.content);
    }
    winExeZip.file('version.txt', version);

    const hostExePath = path.resolve(__dirname, 'native/pan-host.exe');
    if (!fs.existsSync(hostExePath)) {
      throw new Error('Falta native/pan-host.exe para construir Pan-launcher.exe');
    }
    winExeZip.file('Pan-launcher.exe', fs.readFileSync(hostExePath));

    const [zipBuffer, winScriptBundleBuffer, winExeBundleBuffer] = await Promise.all([
      zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
      winScriptZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
      winExeZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    ]);

    const zipBase64 = zipBuffer.toString('base64');
    cachedPcBundle = {
      mtimeMs: stat.mtimeMs,
      version,
      zipBase64,
      zipBuffer,
      winExeBundleBuffer,
      winScriptBundleBuffer,
    };
    return { version, zipBase64, zipBuffer, winExeBundleBuffer, winScriptBundleBuffer };
  }

  app.get('/api/pc/download-app', async (req, res) => {
    try {
      const os = req.query.os === 'unix' ? 'unix' : 'windows';
      const format = typeof req.query.format === 'string' ? req.query.format : 'exe';
      const { version, zipBase64, winExeBundleBuffer, winScriptBundleBuffer } = await getDistZipBundle();
      res.setHeader('Cache-Control', 'no-store');
      if (os === 'unix') {
        const script = buildUnixSelfContainedSh(zipBase64, version);
        if (format === 'zip') {
          const pkg = new JSZip();
          pkg.file('Pan-launcher.sh', script, { unixPermissions: '755' });
          const buf = await pkg.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', 'attachment; filename="Pan-launcher-MacLinux.zip"');
          res.send(buf);
          return;
        }
        res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="Pan-launcher.sh"');
        res.send(script);
      } else if (format === 'bat') {
        const script = buildWindowsSelfContainedBat(zipBase64, version);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="Pan-launcher.bat"');
        res.send(script);
      } else {
        const stubPath = path.resolve(__dirname, 'native/pan-stub.exe');
        if (!fs.existsSync(stubPath)) {
          throw new Error('Falta native/pan-stub.exe para construir Pan-launcher-Setup.exe');
        }
        const stubBuffer = fs.readFileSync(stubPath);
        const exeBuffer = buildWindowsExe(stubBuffer, winExeBundleBuffer, version);
        if (format === 'zip') {
          const pkg = new JSZip();
          pkg.file('Pan-launcher-Setup.exe', exeBuffer);
          pkg.file('Instalar-Guiado.cmd', buildWindowsGuidedCmd());
          pkg.file('setup-gui.ps1', `\uFEFF${buildWindowsGuidedGuiPs1(version)}`);
          pkg.file('app-bundle.zip', winScriptBundleBuffer);
          pkg.file(
            'LEEME_SI_WINDOWS_BLOQUEA.txt',
            [
              'INSTALADOR DE PAN-LAUNCHER (WINDOWS 10 / 11)',
              '============================================',
              '',
              'METODO RECOMENDADO (Si Windows bloquea archivos .exe sin firma):',
              '1. Haz clic derecho en este ZIP -> "Extraer todo..." en una carpeta.',
              '2. Haz doble clic en: Instalar-Guiado.cmd',
              '   Abre el asistente de 4 pasos de Pan-launcher sin usar ejecutables .exe sin firma.',
              '',
              'SI QUIERES USAR Pan-launcher-Setup.exe DIRECTAMENTE:',
              '- Si Windows dice "Windows protegio su PC": pulsa "Mas informacion" -> "Ejecutar de todas formas".',
              '- Si Windows dice "Windows no tiene acceso al dispositivo, ruta de acceso o archivo especificado":',
              '  a) Haz clic derecho en Pan-launcher-Setup.exe -> Propiedades -> marca abajo "Desbloquear" -> Aceptar.',
              '  b) O abre Seguridad de Windows -> Proteccion contra virus y amenazas -> Historial de proteccion -> Permitir.',
              '  c) O simplemente abre Instalar-Guiado.cmd tras extraer el ZIP.',
              '',
            ].join('\r\n')
          );
          const buf = await pkg.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', 'attachment; filename="Pan-launcher-Windows.zip"');
          res.send(buf);
          return;
        }
        res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
        res.setHeader('Content-Disposition', 'attachment; filename="Pan-launcher-Setup.exe"');
        res.send(exeBuffer);
      }
    } catch (err) {
      console.error('Error building PC app bundle:', err);
      res.status(500).json({ error: 'No se pudo generar el instalador local de Pan-launcher.' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pan-launcher server listening on http://0.0.0.0:${PORT}`);
    if (fs.existsSync(path.resolve(__dirname, 'dist/index.html'))) {
      void getDistZipBundle().catch(() => {});
    }
  });
}

startServer();
