import crypto from 'node:crypto';
import zlib from 'node:zlib';

export interface PanVersionItem {
  id: string;
  order: number;
  type: string;
  category: string;
  rawType: string;
  released: string;
  sha1: string;
  source: string;
  latestRelease: boolean;
  latestSnapshot: boolean;
}

export interface PanLoaderCatalogItem {
  id: string;
  label: string;
  loaderVersion: string;
  gameVersion: string;
  stable: boolean;
  maven: string | null;
  minJava?: number | null;
}

export interface DefaultSkinAsset {
  id: string;
  name: string;
  model: 'classic' | 'slim';
  width: number;
  height: number;
  size: number;
  sha256: string;
  source: 'official';
  dataUrl: string;
}

const CATEGORY_BY_TYPE: Record<string, string> = {
  release: 'release',
  snapshot: 'snapshot',
  old_beta: 'beta',
  old_alpha: 'alpha',
};

export interface RawMojangManifest {
  latest?: { release?: string; snapshot?: string };
  versions?: Array<{
    id?: string;
    type?: string;
    url?: string;
    releaseTime?: string;
    time?: string;
    sha1?: string;
  }>;
}

export function mapMojangManifest(manifest: RawMojangManifest): PanVersionItem[] {
  const latest = manifest?.latest || {};
  const list = Array.isArray(manifest?.versions) ? manifest.versions : [];
  return list
    .filter(
      (version): version is NonNullable<RawMojangManifest['versions']>[number] & { id: string } =>
        Boolean(version && typeof version.id === 'string' && /^[A-Za-z0-9._+-]{1,64}$/.test(version.id))
    )
    .map((version, index) => {
      const rawType = typeof version.type === 'string' && version.type ? version.type : 'unknown';
      const released =
        typeof version.releaseTime === 'string' && version.releaseTime
          ? version.releaseTime
          : typeof version.time === 'string'
            ? version.time
            : '';
      return {
        id: version.id,
        order: index,
        type: rawType,
        category: CATEGORY_BY_TYPE[rawType] || 'other',
        rawType,
        released,
        sha1: typeof version.sha1 === 'string' ? version.sha1 : '',
        source: 'official',
        latestRelease: Boolean(latest.release) && version.id === latest.release,
        latestSnapshot: Boolean(latest.snapshot) && version.id === latest.snapshot,
      };
    });
}

export function parseMavenVersions(xml: string): string[] {
  const result: string[] = [];
  const pattern = /<version>([^<]+)<\/version>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const value = match[1].trim();
    if (/^[A-Za-z0-9._+-]{1,64}$/.test(value) && !result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

export function assertCompleteMavenMetadata(xml: string): void {
  if (typeof xml !== 'string' || !/<metadata\b[\s\S]*<\/metadata>\s*$/i.test(xml)) {
    throw new Error('El metadata oficial de Maven está incompleto.');
  }
}

export function neoforgeKeys(gameVersion: string): string[] {
  const keys: string[] = [];
  if (/^1\.\d+/.test(gameVersion)) {
    keys.push(gameVersion.replace(/^1\./, ''));
  }
  keys.push(gameVersion);
  return [...new Set(keys)];
}

function compareLoaderItems(left: PanLoaderCatalogItem, right: PanLoaderCatalogItem): number {
  if (left.stable !== right.stable) return left.stable ? -1 : 1;
  return right.id.localeCompare(left.id, undefined, { numeric: true });
}

export function mapFabricLoaderItems(data: unknown, gameVersion: string): PanLoaderCatalogItem[] {
  if (!Array.isArray(data)) {
    throw new Error('El metadato oficial de Fabric no es una lista.');
  }
  const items: PanLoaderCatalogItem[] = [];
  for (const entry of data) {
    const rec = entry as {
      loader?: { version?: unknown; stable?: unknown; maven?: unknown };
      launcherMeta?: { min_java_version?: unknown };
    };
    const info = rec?.loader;
    if (!info || typeof info.version !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(info.version)) {
      continue;
    }
    const minJavaNum = Number(rec.launcherMeta?.min_java_version);
    items.push({
      id: info.version,
      label: info.version,
      loaderVersion: info.version,
      gameVersion,
      stable: Boolean(info.stable),
      maven: typeof info.maven === 'string' ? info.maven : null,
      minJava: Number.isInteger(minJavaNum) && minJavaNum > 0 ? minJavaNum : null,
    });
  }
  if (items.length === 0) {
    throw new Error(`Fabric no publica cargadores para ${gameVersion}.`);
  }
  return items.sort(compareLoaderItems);
}

export function mapForgeLoaderItems(xml: string, gameVersion: string): PanLoaderCatalogItem[] {
  assertCompleteMavenMetadata(xml);
  const prefix = `${gameVersion}-`;
  const items = parseMavenVersions(xml)
    .filter((value) => value.startsWith(prefix))
    .map((value) => ({
      id: value,
      label: value.slice(prefix.length),
      loaderVersion: value.slice(prefix.length),
      gameVersion,
      stable: true,
      maven: `net.minecraftforge:forge:${value}`,
    }));
  if (items.length === 0) {
    throw new Error(`Forge no publica versiones para ${gameVersion}.`);
  }
  return items.sort(compareLoaderItems);
}

export function mapNeoforgeLoaderItems(xml: string, gameVersion: string): PanLoaderCatalogItem[] {
  assertCompleteMavenMetadata(xml);
  const keys = neoforgeKeys(gameVersion);
  const items = parseMavenVersions(xml)
    .filter((value) => keys.some((key) => value.startsWith(`${key}.`)))
    .map((value) => ({
      id: value,
      label: value,
      loaderVersion: value,
      gameVersion,
      stable: !/-beta|-alpha|snapshot/.test(value),
      maven: `net.neoforged:neoforge:${value}`,
    }));
  if (items.length === 0) {
    throw new Error(`NeoForge no publica versiones para ${gameVersion}.`);
  }
  return items.sort(compareLoaderItems);
}

export function mapQuiltLoaderItems(data: unknown, gameVersion: string): PanLoaderCatalogItem[] {
  if (!Array.isArray(data)) {
    throw new Error('El metadato oficial de Quilt no es una lista.');
  }
  const items: PanLoaderCatalogItem[] = [];
  for (const entry of data) {
    const rec = entry as {
      loader?: { version?: unknown; maven?: unknown };
      launcherMeta?: { min_java_version?: unknown };
    };
    const info = rec?.loader;
    if (!info || typeof info.version !== 'string' || !/^[A-Za-z0-9._+-]{1,64}$/.test(info.version)) {
      continue;
    }
    const minJavaNum = Number(rec.launcherMeta?.min_java_version);
    const isStable = !/-beta|-alpha|pre/i.test(info.version);
    items.push({
      id: info.version,
      label: info.version,
      loaderVersion: info.version,
      gameVersion,
      stable: isStable,
      maven: typeof info.maven === 'string' ? info.maven : `org.quiltmc:quilt-loader:${info.version}`,
      minJava: Number.isInteger(minJavaNum) && minJavaNum > 0 ? minJavaNum : null,
    });
  }
  if (items.length === 0) {
    throw new Error(`Quilt no publica cargadores para ${gameVersion}.`);
  }
  return items.sort(compareLoaderItems);
}

export type SupportedLoaderId = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';

export function normalizeLoaderId(raw: unknown): SupportedLoaderId {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'fabric') return 'fabric';
  if (s === 'forge') return 'forge';
  if (s === 'neoforge') return 'neoforge';
  if (s === 'quilt') return 'quilt';
  return 'vanilla';
}

export function requiredJavaForVersion(versionId: string): number {
  const raw = String(versionId || '').trim();
  if (!raw) return 21;
  const parts = raw.split('.');
  const first = Number.parseInt(parts[0] || '', 10);
  const second = Number.parseInt(parts[1] || '', 10);
  const third = Number.parseInt((parts[2] || '0').split('-')[0], 10);

  // Calendar-based Minecraft releases starting in 2026 (26.1, 26.2, 26.3, etc.)
  if (Number.isFinite(first) && first >= 26 && first < 100) {
    return 25;
  }
  // Snapshots from 26w+
  const snapMatch = /^(\d{2})w(\d{2})[a-z]?$/i.exec(raw);
  if (snapMatch) {
    const yy = Number.parseInt(snapMatch[1], 10);
    if (yy >= 26) return 25;
    if (yy >= 24) return 21;
    if (yy >= 21) return 17;
    return 8;
  }
  if (first === 1 && Number.isFinite(second)) {
    if (second <= 16) return 8;
    if (second <= 19 || (second === 20 && (Number.isNaN(third) || third <= 4))) return 17;
    return 21;
  }
  return 21;
}

export function parseProfileVersionId(rawVersionId: string): {
  mcVersion: string;
  loader: SupportedLoaderId;
  loaderVersion: string | null;
} {
  const v = String(rawVersionId || '').trim();
  const fabricMatch = /^fabric-([^-]+)-(.+)$/.exec(v);
  if (fabricMatch) {
    return { mcVersion: fabricMatch[2], loader: 'fabric', loaderVersion: fabricMatch[1] };
  }
  const quiltMatch = /^quilt-([^-]+)-(.+)$/.exec(v);
  if (quiltMatch) {
    return { mcVersion: quiltMatch[2], loader: 'quilt', loaderVersion: quiltMatch[1] };
  }
  const neoforgeMatch = /^neoforge-(.+)-(.+)$/.exec(v);
  if (neoforgeMatch) {
    return { mcVersion: neoforgeMatch[2], loader: 'neoforge', loaderVersion: neoforgeMatch[1] };
  }
  const forgeMatch = /^forge-(.+)-(.+)$/.exec(v);
  if (forgeMatch) {
    return { mcVersion: forgeMatch[2], loader: 'forge', loaderVersion: forgeMatch[1] };
  }
  return { mcVersion: v || '1.21.4', loader: 'vanilla', loaderVersion: null };
}

// --- Pure PNG 64x64 RGBA skin synthesizer (for official default skins Steve & Alex) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, pixels: Uint8Array): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter None
    pixels.subarray(y * width * 4, (y + 1) * width * 4).forEach((b, i) => {
      raw[y * stride + 1 + i] = b;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function generateDefaultPngSkin(variant: 'steve' | 'alex'): DefaultSkinAsset {
  const width = 64;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);

  const fillRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: [number, number, number, number]
  ) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const idx = (py * width + px) * 4;
        pixels[idx] = rgba[0];
        pixels[idx + 1] = rgba[1];
        pixels[idx + 2] = rgba[2];
        pixels[idx + 3] = rgba[3];
      }
    }
  };

  const setPx = (px: number, py: number, rgba: [number, number, number, number]) => {
    fillRect(px, py, 1, 1, rgba);
  };

  const isAlex = variant === 'alex';
  const skin: [number, number, number, number] = isAlex ? [246, 206, 174, 255] : [201, 155, 118, 255];
  const skinShadow: [number, number, number, number] = isAlex ? [225, 176, 142, 255] : [182, 135, 100, 255];
  const hair: [number, number, number, number] = isAlex ? [214, 120, 42, 255] : [59, 39, 25, 255];
  const hairLight: [number, number, number, number] = isAlex ? [232, 144, 58, 255] : [75, 50, 32, 255];
  const eyeWhite: [number, number, number, number] = [255, 255, 255, 255];
  const eyePupil: [number, number, number, number] = isAlex ? [58, 125, 62, 255] : [69, 55, 150, 255];
  const mouth: [number, number, number, number] = isAlex ? [196, 128, 105, 255] : [138, 86, 62, 255];
  const shirt: [number, number, number, number] = isAlex ? [99, 155, 69, 255] : [0, 168, 178, 255];
  const shirtDark: [number, number, number, number] = isAlex ? [76, 125, 52, 255] : [0, 136, 146, 255];
  const pants: [number, number, number, number] = isAlex ? [76, 56, 40, 255] : [54, 48, 138, 255];
  const pantsDark: [number, number, number, number] = isAlex ? [60, 44, 31, 255] : [42, 37, 110, 255];
  const shoes: [number, number, number, number] = [88, 88, 94, 255];

  // Head UVs (top: 8,0 8x8; right: 0,8 8x8; front: 8,8 8x8)
  fillRect(8, 0, 8, 8, hair);
  fillRect(10, 2, 4, 4, hairLight);
  fillRect(0, 8, 8, 8, skinShadow);
  fillRect(0, 8, 8, 2, hair);
  fillRect(0, 10, 3, 4, hair);
  fillRect(8, 8, 8, 8, skin);
  fillRect(8, 8, 8, 2, hair);
  setPx(8, 10, hair);
  setPx(15, 10, hair);
  // Eyes & mouth
  setPx(9, 12, eyeWhite);
  setPx(10, 12, eyePupil);
  setPx(13, 12, eyePupil);
  setPx(14, 12, eyeWhite);
  fillRect(11, 14, 2, 1, mouth);

  // Body (top: 20,16 8x4; right: 16,20 4x12; front: 20,20 8x12)
  fillRect(20, 16, 8, 4, shirtDark);
  fillRect(16, 20, 4, 12, shirtDark);
  fillRect(20, 20, 8, 12, shirt);
  fillRect(22, 20, 4, 1, skinShadow);
  if (isAlex) {
    fillRect(20, 30, 8, 2, pants);
  }

  // Arms (rightArm: top 44,16 w x4, right 40,20 w x12, front 44,20 w x12)
  const aw = isAlex ? 3 : 4;
  fillRect(44, 16, aw, 4, shirtDark);
  fillRect(40, 20, aw, 5, shirtDark);
  fillRect(40, 25, aw, 7, skinShadow);
  fillRect(44, 20, aw, 5, shirt);
  fillRect(44, 25, aw, 7, skin);

  // Left arm (top: 36,48 w x4; right: 32,52 w x12; front: 36,52 w x12)
  fillRect(36, 48, aw, 4, shirtDark);
  fillRect(32, 52, aw, 5, shirtDark);
  fillRect(32, 57, aw, 7, skinShadow);
  fillRect(36, 52, aw, 5, shirt);
  fillRect(36, 57, aw, 7, skin);

  // Right leg (top: 4,16 4x4; right: 0,20 4x12; front: 4,20 4x12)
  fillRect(4, 16, 4, 4, pantsDark);
  fillRect(0, 20, 4, 10, pantsDark);
  fillRect(0, 30, 4, 2, shoes);
  fillRect(4, 20, 4, 10, pants);
  fillRect(4, 30, 4, 2, shoes);

  // Left leg (top: 20,48 4x4; right: 16,52 4x12; front: 20,52 4x12)
  fillRect(20, 48, 4, 4, pantsDark);
  fillRect(16, 52, 4, 10, pantsDark);
  fillRect(16, 62, 4, 2, shoes);
  fillRect(20, 52, 4, 10, pants);
  fillRect(20, 62, 4, 2, shoes);

  const pngBuffer = encodeRgbaPng(width, height, pixels);
  const sha256 = crypto.createHash('sha256').update(pngBuffer).digest('hex');

  return {
    id: `official:${variant}`,
    name: isAlex ? 'Alex (Oficial)' : 'Steve (Oficial)',
    model: isAlex ? 'slim' : 'classic',
    width,
    height,
    size: pngBuffer.length,
    sha256,
    source: 'official',
    dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
  };
}
