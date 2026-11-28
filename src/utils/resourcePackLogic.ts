import zlib from 'node:zlib';

export interface ResourcePackMeta {
  name: string;
  filename: string;
  description: string;
  packFormat: number | null;
  minFormat: number | null;
  maxFormat: number | null;
  mcVersionRangeLabel: string;
  hasMcmeta: boolean;
  normalized?: boolean;
  nestedRoot?: string | null;
  isShaderPack?: boolean;
  source: 'mcmeta' | 'filename';
}

export interface ResourcePackCompatibility {
  compatible: boolean;
  status: 'compatible' | 'incompatible' | 'unknown';
  targetFormat: number | null;
  reasonCode: 'no-mcmeta' | 'shader-pack' | 'unknown-mc' | 'format-mismatch' | 'compatible';
}

export function sanitizeResourcePackFilename(rawName: unknown): string {
  const base = String(rawName || '')
    .split(/[\\/]/)
    .pop() || 'pack.zip';
  let clean = base
    .replace(/[\x00-\x1f]/g, '')
    .replace(/:/g, '_')
    .replace(/[^A-Za-z0-9._+\-() ]/g, '_')
    .trim()
    .replace(/^\.+/, '');
  if (!clean) clean = 'resourcepack.zip';
  if (!clean.toLowerCase().endsWith('.zip')) clean += '.zip';
  if (clean.includes('..')) clean = clean.replace(/\.\.+/g, '.');
  return clean.slice(0, 140);
}

export function stripMcFormatting(raw: unknown): string {
  return String(raw || '')
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\u00a7[0-9a-fk-or]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenTextComponent(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(flattenTextComponent).join('');
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const head = typeof obj.text === 'string' ? obj.text : '';
    const extra = Array.isArray(obj.extra) ? obj.extra.map(flattenTextComponent).join('') : '';
    return head + extra;
  }
  return '';
}

function normalizeFormatValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw.trim()))) {
    return Math.trunc(Number(raw.trim()));
  }
  if (Array.isArray(raw) && raw.length > 0 && Number.isFinite(Number(raw[0]))) {
    return Math.trunc(Number(raw[0]));
  }
  return null;
}

function parseLenientJson(raw: string): Record<string, unknown> | null {
  const clean = raw.replace(/^\uFEFF/, '').trim();
  if (!clean) return null;
  try {
    const obj = JSON.parse(clean);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    try {
      const noTrailing = clean.replace(/,\s*([}\]])/g, '$1');
      const obj = JSON.parse(noTrailing);
      return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

export function describePackFormatRange(minFmt: number | null, maxFmt: number | null): string {
  if (minFmt === null) return '—';
  const fmtToLabel = (f: number): string => {
    if (f <= 1) return '1.6–1.8';
    if (f === 2) return '1.9–1.10';
    if (f === 3) return '1.11–1.12';
    if (f === 4) return '1.13–1.14';
    if (f === 5) return '1.15–1.16.1';
    if (f === 6) return '1.16.2–1.16.5';
    if (f === 7) return '1.17';
    if (f === 8) return '1.18';
    if (f <= 9) return '1.19–1.19.2';
    if (f <= 12) return '1.19.3';
    if (f <= 13) return '1.19.4';
    if (f <= 15) return '1.20–1.20.1';
    if (f <= 18) return '1.20.2';
    if (f <= 22) return '1.20.3–1.20.4';
    if (f <= 32) return '1.20.5–1.20.6';
    if (f <= 34) return '1.21–1.21.1';
    if (f <= 42) return '1.21.2–1.21.3';
    if (f <= 46) return '1.21.4';
    if (f <= 55) return '1.21.5';
    if (f <= 63) return '1.21.6–1.21.8';
    if (f <= 69) return '1.21.9–1.21.10';
    if (f <= 75) return '1.21.11';
    return '26.x';
  };
  if (maxFmt === null || maxFmt === minFmt) return fmtToLabel(minFmt);
  return `${fmtToLabel(minFmt)} – ${fmtToLabel(maxFmt)}`;
}

export function extractMcmetaInfo(
  rawInput: unknown,
  rawFilename: string,
  extra?: { normalized?: boolean; nestedRoot?: string | null; isShaderPack?: boolean }
): ResourcePackMeta {
  const filename = sanitizeResourcePackFilename(rawFilename);
  const fallbackName = filename.replace(/\.zip$/i, '');
  let parsed: Record<string, unknown> | null = null;

  if (typeof rawInput === 'string' && rawInput.trim()) {
    parsed = parseLenientJson(rawInput);
  } else if (rawInput && typeof rawInput === 'object') {
    parsed = rawInput as Record<string, unknown>;
  }

  const pack = parsed && parsed.pack && typeof parsed.pack === 'object'
    ? (parsed.pack as Record<string, unknown>)
    : null;

  if (!pack) {
    return {
      name: fallbackName,
      filename,
      description: '',
      packFormat: null,
      minFormat: null,
      maxFormat: null,
      mcVersionRangeLabel: '—',
      hasMcmeta: false,
      normalized: Boolean(extra?.normalized),
      nestedRoot: extra?.nestedRoot || null,
      isShaderPack: Boolean(extra?.isShaderPack),
      source: 'filename'
    };
  }

  const packFormat = normalizeFormatValue(pack.pack_format);
  let minFormat = normalizeFormatValue(pack.min_format) ?? packFormat;
  let maxFormat = normalizeFormatValue(pack.max_format) ?? packFormat;

  const sup = pack.supported_formats;
  if (typeof sup === 'number' && Number.isFinite(sup)) {
    const s = Math.trunc(sup);
    minFormat = minFormat === null ? s : Math.min(minFormat, s);
    maxFormat = maxFormat === null ? s : Math.max(maxFormat, s);
  } else if (Array.isArray(sup) && sup.length >= 2) {
    const lo = Number(sup[0]);
    const hi = Number(sup[1]);
    if (Number.isFinite(lo)) minFormat = minFormat === null ? Math.trunc(lo) : Math.min(minFormat, Math.trunc(lo));
    if (Number.isFinite(hi)) maxFormat = maxFormat === null ? Math.trunc(hi) : Math.max(maxFormat, Math.trunc(hi));
  } else if (sup && typeof sup === 'object') {
    const obj = sup as Record<string, unknown>;
    const lo = Number(obj.min_inclusive);
    const hi = Number(obj.max_inclusive);
    if (Number.isFinite(lo)) minFormat = minFormat === null ? Math.trunc(lo) : Math.min(minFormat, Math.trunc(lo));
    if (Number.isFinite(hi)) maxFormat = maxFormat === null ? Math.trunc(hi) : Math.max(maxFormat, Math.trunc(hi));
  }

  if (minFormat !== null && maxFormat !== null && maxFormat < minFormat) {
    maxFormat = minFormat;
  }

  const description = stripMcFormatting(flattenTextComponent(pack.description)).slice(0, 180);

  return {
    name: fallbackName,
    filename,
    description,
    packFormat: packFormat ?? minFormat,
    minFormat,
    maxFormat,
    mcVersionRangeLabel: describePackFormatRange(minFormat, maxFormat),
    hasMcmeta: true,
    normalized: Boolean(extra?.normalized),
    nestedRoot: extra?.nestedRoot || null,
    isShaderPack: false,
    source: 'mcmeta'
  };
}

export function resourcePackFormatForMcVersion(mcVersion: string): number | null {
  const clean = String(mcVersion || '').trim().replace(/[-+].*$/, '');
  const calver = clean.match(/^(\d{2,})\.(\d+)(?:\.(\d+))?$/);
  if (calver) {
    const yr = Number(calver[1]);
    if (yr >= 26) return 84;
  }
  const sem = clean.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (!sem) return null;
  const minor = Number(sem[1]);
  const patch = Number(sem[2] || 0);

  if (minor <= 8) return 1;
  if (minor <= 10) return 2;
  if (minor <= 12) return 3;
  if (minor <= 14) return 4;
  if (minor === 15 || (minor === 16 && patch <= 1)) return 5;
  if (minor === 16) return 6;
  if (minor === 17) return 7;
  if (minor === 18) return 8;
  if (minor === 19) {
    if (patch <= 2) return 9;
    if (patch === 3) return 12;
    return 13;
  }
  if (minor === 20) {
    if (patch <= 1) return 15;
    if (patch === 2) return 18;
    if (patch <= 4) return 22;
    return 32;
  }
  if (minor === 21) {
    if (patch <= 1) return 34;
    if (patch <= 3) return 42;
    if (patch === 4) return 46;
    if (patch === 5) return 55;
    if (patch <= 8) return 63;
    if (patch <= 10) return 69;
    return 75;
  }
  return 75;
}

export function evaluateResourcePackCompatibility(
  pack: Partial<ResourcePackMeta> | null | undefined,
  mcVersion: string
): ResourcePackCompatibility {
  const targetFormat = resourcePackFormatForMcVersion(mcVersion);
  if (pack && pack.isShaderPack && !pack.hasMcmeta) {
    return {
      compatible: false,
      status: 'unknown',
      targetFormat,
      reasonCode: 'shader-pack'
    };
  }
  if (!pack || !pack.hasMcmeta || (pack.minFormat === null && pack.packFormat === null)) {
    return {
      compatible: false,
      status: 'unknown',
      targetFormat,
      reasonCode: 'no-mcmeta'
    };
  }
  if (targetFormat === null) {
    return {
      compatible: true,
      status: 'unknown',
      targetFormat: null,
      reasonCode: 'unknown-mc'
    };
  }
  const minFmt = typeof pack.minFormat === 'number' ? pack.minFormat : (pack.packFormat as number);
  const maxFmt = typeof pack.maxFormat === 'number' ? pack.maxFormat : minFmt;
  if (targetFormat < minFmt || targetFormat > maxFmt) {
    return {
      compatible: false,
      status: 'incompatible',
      targetFormat,
      reasonCode: 'format-mismatch'
    };
  }
  return {
    compatible: true,
    status: 'compatible',
    targetFormat,
    reasonCode: 'compatible'
  };
}

export function isLegacyResourcePackMcVersion(mcVersion: string): boolean {
  const clean = String(mcVersion || '').trim().replace(/[-+].*$/, '');
  const sem = clean.match(/^1\.(\d+)/);
  return Boolean(sem && Number(sem[1]) <= 12);
}

export function buildOptionsResourcePacksLine(enabledFilenames: string[], mcVersion: string): string {
  const legacy = isLegacyResourcePackMcVersion(mcVersion);
  const cleanNames = Array.isArray(enabledFilenames)
    ? enabledFilenames.map((name) => sanitizeResourcePackFilename(name))
    : [];
  const entries = legacy
    ? cleanNames
    : ['vanilla', ...cleanNames.map((n) => `file/${n}`)];
  return `resourcePacks:${JSON.stringify(entries)}`;
}

export function buildOptionsIncompatiblePacksLine(incompatibleFilenames: string[], mcVersion: string): string {
  if (isLegacyResourcePackMcVersion(mcVersion)) {
    return 'incompatibleResourcePacks:[]';
  }
  const seen = new Set<string>();
  const entries: string[] = [];
  if (Array.isArray(incompatibleFilenames)) {
    for (const raw of incompatibleFilenames) {
      const clean = sanitizeResourcePackFilename(raw);
      const tok = `file/${clean}`;
      if (!seen.has(tok)) {
        seen.add(tok);
        entries.push(tok);
      }
    }
  }
  return `incompatibleResourcePacks:${JSON.stringify(entries)}`;
}

export function applyResourcePacksToOptionsTxt(
  optionsTxt: string,
  enabledFilenames: string[],
  mcVersion: string,
  incompatibleFilenames?: string[]
): string {
  const base = String(optionsTxt || '').trimEnd();
  const rpLine = buildOptionsResourcePacksLine(enabledFilenames, mcVersion);
  const lines = base ? base.split(/\r?\n/) : [];
  const filtered = lines.filter(
    (line) => !line.startsWith('resourcePacks:') && !line.startsWith('incompatibleResourcePacks:')
  );
  filtered.push(rpLine);
  if (Array.isArray(incompatibleFilenames)) {
    filtered.push(buildOptionsIncompatiblePacksLine(incompatibleFilenames, mcVersion));
  }
  return filtered.join('\n');
}

interface ParsedZipEntry {
  rawName: string;
  cleanName: string;
  lowerName: string;
  isDir: boolean;
  isJunk: boolean;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc32: number;
  compSize: number;
  uncompSize: number;
  internalAttr: number;
  externalAttr: number;
  localHeaderOffset: number;
}

function isMacOrOsJunkPath(lowerName: string): boolean {
  return (
    lowerName === '__macosx' ||
    lowerName.startsWith('__macosx/') ||
    lowerName === '.ds_store' ||
    lowerName.endsWith('/.ds_store') ||
    lowerName === 'thumbs.db' ||
    lowerName.endsWith('/thumbs.db')
  );
}

function parseCentralDirectory(buf: Buffer): {
  validZip: boolean;
  zip64: boolean;
  entries: ParsedZipEntry[];
} {
  if (buf.length < 22) return { validZip: false, zip64: false, entries: [] };
  const sig0 = buf.readUInt32LE(0);
  if (sig0 !== 0x04034b50 && sig0 !== 0x06054b50) {
    return { validZip: false, zip64: false, entries: [] };
  }

  let eocdOffset = -1;
  const minSearch = Math.max(0, buf.length - 65558);
  for (let pos = buf.length - 22; pos >= minSearch; pos--) {
    if (buf[pos] === 0x50 && buf[pos + 1] === 0x4b && buf[pos + 2] === 0x05 && buf[pos + 3] === 0x06) {
      const cLen = buf.readUInt16LE(pos + 20);
      if (pos + 22 + cLen === buf.length) {
        eocdOffset = pos;
        break;
      }
      if (eocdOffset < 0) eocdOffset = pos;
    }
  }
  if (eocdOffset < 0) return { validZip: false, zip64: false, entries: [] };

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    return { validZip: true, zip64: true, entries: [] };
  }

  const entries: ParsedZipEntry[] = [];
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries && ptr + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const dosTime = buf.readUInt16LE(ptr + 12);
    const dosDate = buf.readUInt16LE(ptr + 14);
    const crc32 = buf.readUInt32LE(ptr + 16);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const internalAttr = buf.readUInt16LE(ptr + 36);
    const externalAttr = buf.readUInt32LE(ptr + 38);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    if (ptr + 46 + nameLen > buf.length) break;

    const rawName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    const cleanName = rawName.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
    const lowerName = cleanName.toLowerCase();
    ptr += 46 + nameLen + extraLen + commentLen;

    entries.push({
      rawName,
      cleanName,
      lowerName,
      isDir: cleanName.endsWith('/'),
      isJunk: isMacOrOsJunkPath(lowerName),
      flags,
      method,
      dosTime,
      dosDate,
      crc32,
      compSize,
      uncompSize,
      internalAttr,
      externalAttr,
      localHeaderOffset
    });
  }

  return { validZip: true, zip64: false, entries };
}

function readZipEntryPayload(buf: Buffer, entry: ParsedZipEntry, maxBytes: number): Buffer | null {
  if (entry.localHeaderOffset + 30 > buf.length) return null;
  if (buf.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) return null;
  const lNameLen = buf.readUInt16LE(entry.localHeaderOffset + 26);
  const lExtraLen = buf.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + lNameLen + lExtraLen;
  const dataEnd = dataStart + entry.compSize;
  if (dataEnd > buf.length || entry.compSize > maxBytes || entry.uncompSize > maxBytes * 2) return null;
  const slice = buf.subarray(dataStart, dataEnd);
  if (entry.method === 0) return slice;
  if (entry.method === 8) {
    try {
      const out = zlib.inflateRawSync(slice, { maxOutputLength: maxBytes });
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeResourcePackZipBuffer(inputBuf: Buffer): {
  buffer: Buffer;
  normalized: boolean;
  nestedRoot: string | null;
  mcmetaRaw: string | null;
  isShaderPack: boolean;
} {
  const parsed = parseCentralDirectory(inputBuf);
  if (!parsed.validZip) {
    throw new Error('Invalid ZIP header');
  }

  let hasRootMcmeta = false;
  let mcmetaEntry: ParsedZipEntry | null = null;
  const nestedMcmetas: ParsedZipEntry[] = [];
  let hasShaders = false;
  const topSegments = new Set<string>();

  for (const e of parsed.entries) {
    if (e.isJunk || !e.cleanName) continue;
    const parts = e.cleanName.split('/').filter(Boolean);
    if (parts.length > 0) topSegments.add(parts[0]);

    if (e.lowerName === 'pack.mcmeta') {
      hasRootMcmeta = true;
      mcmetaEntry = e;
    } else if (/^[^/]+\/pack\.mcmeta$/i.test(e.lowerName)) {
      nestedMcmetas.push(e);
    }
    if (
      e.lowerName.startsWith('shaders/') ||
      /^[^/]+\/shaders\//i.test(e.lowerName)
    ) {
      hasShaders = true;
    }
  }

  let nestedRoot: string | null = null;
  if (!hasRootMcmeta && nestedMcmetas.length === 1 && topSegments.size === 1) {
    const candidate = nestedMcmetas[0].cleanName.split('/')[0];
    if (candidate) {
      nestedRoot = candidate;
      mcmetaEntry = nestedMcmetas[0];
    }
  }

  const mcmetaRaw = mcmetaEntry
    ? readZipEntryPayload(inputBuf, mcmetaEntry, 256 * 1024)?.toString('utf8') || null
    : null;

  if (!nestedRoot || parsed.zip64) {
    return {
      buffer: inputBuf,
      normalized: false,
      nestedRoot: null,
      mcmetaRaw,
      isShaderPack: !mcmetaEntry && hasShaders
    };
  }

  const stripPrefix = `${nestedRoot}/`;
  const stripLower = stripPrefix.toLowerCase();
  const kept: Array<{ entry: ParsedZipEntry; nameBuf: Buffer; payload: Buffer }> = [];

  for (const e of parsed.entries) {
    if (e.isJunk || !e.cleanName) continue;
    if ((e.flags & 0x0001) !== 0) {
      return { buffer: inputBuf, normalized: false, nestedRoot: null, mcmetaRaw, isShaderPack: false };
    }
    if (!e.lowerName.startsWith(stripLower)) continue;
    const stripped = e.cleanName.slice(stripPrefix.length);
    if (!stripped) continue;

    if (e.localHeaderOffset + 30 > inputBuf.length) continue;
    if (inputBuf.readUInt32LE(e.localHeaderOffset) !== 0x04034b50) continue;
    const lNameLen = inputBuf.readUInt16LE(e.localHeaderOffset + 26);
    const lExtraLen = inputBuf.readUInt16LE(e.localHeaderOffset + 28);
    const dataStart = e.localHeaderOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + e.compSize;
    if (dataEnd > inputBuf.length) continue;

    kept.push({
      entry: e,
      nameBuf: Buffer.from(stripped, 'utf8'),
      payload: inputBuf.subarray(dataStart, dataEnd)
    });
  }

  if (kept.length === 0) {
    return { buffer: inputBuf, normalized: false, nestedRoot: null, mcmetaRaw, isShaderPack: false };
  }

  let localTotal = 0;
  let cdTotal = 0;
  for (const item of kept) {
    localTotal += 30 + item.nameBuf.length + item.payload.length;
    cdTotal += 46 + item.nameBuf.length;
  }

  const out = Buffer.alloc(localTotal + cdTotal + 22);
  let pos = 0;
  const offsets: number[] = [];

  for (const item of kept) {
    offsets.push(pos);
    const flags = (item.entry.flags & ~0x0008) | 0x0800;
    out.writeUInt32LE(0x04034b50, pos);
    out.writeUInt16LE(20, pos + 4);
    out.writeUInt16LE(flags, pos + 6);
    out.writeUInt16LE(item.entry.method, pos + 8);
    out.writeUInt16LE(item.entry.dosTime, pos + 10);
    out.writeUInt16LE(item.entry.dosDate, pos + 12);
    out.writeUInt32LE(item.entry.crc32 >>> 0, pos + 14);
    out.writeUInt32LE(item.entry.compSize >>> 0, pos + 18);
    out.writeUInt32LE(item.entry.uncompSize >>> 0, pos + 22);
    out.writeUInt16LE(item.nameBuf.length, pos + 26);
    out.writeUInt16LE(0, pos + 28);
    pos += 30;
    item.nameBuf.copy(out, pos);
    pos += item.nameBuf.length;
    item.payload.copy(out, pos);
    pos += item.payload.length;
  }

  const cdOffset = pos;
  for (let i = 0; i < kept.length; i++) {
    const item = kept[i];
    const flags = (item.entry.flags & ~0x0008) | 0x0800;
    out.writeUInt32LE(0x02014b50, pos);
    out.writeUInt16LE(0x0314, pos + 4);
    out.writeUInt16LE(20, pos + 6);
    out.writeUInt16LE(flags, pos + 8);
    out.writeUInt16LE(item.entry.method, pos + 10);
    out.writeUInt16LE(item.entry.dosTime, pos + 12);
    out.writeUInt16LE(item.entry.dosDate, pos + 14);
    out.writeUInt32LE(item.entry.crc32 >>> 0, pos + 16);
    out.writeUInt32LE(item.entry.compSize >>> 0, pos + 20);
    out.writeUInt32LE(item.entry.uncompSize >>> 0, pos + 24);
    out.writeUInt16LE(item.nameBuf.length, pos + 28);
    out.writeUInt16LE(0, pos + 30);
    out.writeUInt16LE(0, pos + 32);
    out.writeUInt16LE(0, pos + 34);
    out.writeUInt16LE(item.entry.internalAttr, pos + 36);
    out.writeUInt32LE(item.entry.externalAttr >>> 0, pos + 38);
    out.writeUInt32LE(offsets[i] >>> 0, pos + 42);
    pos += 46;
    item.nameBuf.copy(out, pos);
    pos += item.nameBuf.length;
  }

  const cdSize = pos - cdOffset;
  out.writeUInt32LE(0x06054b50, pos);
  out.writeUInt16LE(0, pos + 4);
  out.writeUInt16LE(0, pos + 6);
  out.writeUInt16LE(kept.length, pos + 8);
  out.writeUInt16LE(kept.length, pos + 10);
  out.writeUInt32LE(cdSize >>> 0, pos + 12);
  out.writeUInt32LE(cdOffset >>> 0, pos + 16);
  out.writeUInt16LE(0, pos + 20);

  return {
    buffer: out,
    normalized: true,
    nestedRoot,
    mcmetaRaw,
    isShaderPack: false
  };
}
