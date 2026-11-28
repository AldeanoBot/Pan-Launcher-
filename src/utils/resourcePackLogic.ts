export interface ResourcePackMeta {
  name: string;
  filename: string;
  description: string;
  packFormat: number | null;
  minFormat: number | null;
  maxFormat: number | null;
  mcVersionRangeLabel: string;
  hasMcmeta: boolean;
  source: 'mcmeta' | 'filename';
}

export interface ResourcePackCompatibility {
  compatible: boolean;
  status: 'compatible' | 'incompatible' | 'unknown';
  targetFormat: number | null;
  reasonCode: 'no-mcmeta' | 'unknown-mc' | 'format-mismatch' | 'compatible';
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
  if (Array.isArray(raw) && raw.length > 0 && Number.isFinite(Number(raw[0]))) {
    return Math.trunc(Number(raw[0]));
  }
  return null;
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

export function extractMcmetaInfo(rawInput: unknown, rawFilename: string): ResourcePackMeta {
  const filename = sanitizeResourcePackFilename(rawFilename);
  const fallbackName = filename.replace(/\.zip$/i, '');
  let parsed: Record<string, unknown> | null = null;

  if (typeof rawInput === 'string' && rawInput.trim()) {
    try {
      const obj = JSON.parse(rawInput);
      if (obj && typeof obj === 'object') parsed = obj as Record<string, unknown>;
    } catch {
      parsed = null;
    }
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

export function applyResourcePacksToOptionsTxt(
  optionsTxt: string,
  enabledFilenames: string[],
  mcVersion: string
): string {
  const base = String(optionsTxt || '').trimEnd();
  const rpLine = buildOptionsResourcePacksLine(enabledFilenames, mcVersion);
  const lines = base ? base.split(/\r?\n/) : [];
  const filtered = lines.filter((line) => !line.startsWith('resourcePacks:'));
  filtered.push(rpLine);
  return filtered.join('\n');
}
