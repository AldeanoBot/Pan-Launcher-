(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});

  function t(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const translated = Nexus.i18n.t(key, vars);
      if (translated && translated !== key) return translated;
    }
    if (!vars) return fallback;
    return String(fallback || '').replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  }

  function sanitizeResourcePackFilename(rawName) {
    const base = String(rawName || '').split(/[\\/]/).pop() || 'pack.zip';
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

  function stripMcFormatting(raw) {
    return String(raw || '')
      .replace(/§[0-9a-fk-or]/gi, '')
      .replace(/\u00a7[0-9a-fk-or]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function flattenTextComponent(val) {
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(flattenTextComponent).join('');
    if (val && typeof val === 'object') {
      const head = typeof val.text === 'string' ? val.text : '';
      const extra = Array.isArray(val.extra) ? val.extra.map(flattenTextComponent).join('') : '';
      return head + extra;
    }
    return '';
  }

  function normalizeFormatValue(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw.trim()))) {
      return Math.trunc(Number(raw.trim()));
    }
    if (Array.isArray(raw) && raw.length > 0 && Number.isFinite(Number(raw[0]))) {
      return Math.trunc(Number(raw[0]));
    }
    return null;
  }

  function parseLenientJson(rawInput) {
    const cleanJson = String(rawInput || '').replace(/^\uFEFF/, '').trim();
    if (!cleanJson) return null;
    try {
      const obj = JSON.parse(cleanJson);
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      try {
        const noTrailing = cleanJson.replace(/,\s*([}\]])/g, '$1');
        const obj = JSON.parse(noTrailing);
        return obj && typeof obj === 'object' ? obj : null;
      } catch {
        return null;
      }
    }
  }

  function describePackFormatRange(minFmt, maxFmt) {
    if (minFmt === null) return '—';
    const fmtToLabel = (f) => {
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

  function extractMcmetaInfo(rawInput, rawFilename, iconDataUrl, extra) {
    const filename = sanitizeResourcePackFilename(rawFilename);
    const fallbackName = filename.replace(/\.zip$/i, '');
    let parsed = null;

    if (typeof rawInput === 'string' && rawInput.trim()) {
      parsed = parseLenientJson(rawInput);
    } else if (rawInput && typeof rawInput === 'object') {
      parsed = rawInput;
    }

    const pack = parsed && parsed.pack && typeof parsed.pack === 'object' ? parsed.pack : null;
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
        iconDataUrl: iconDataUrl || '',
        normalized: Boolean(extra && extra.normalized),
        nestedRoot: (extra && extra.nestedRoot) || null,
        isShaderPack: Boolean(extra && extra.isShaderPack),
        source: 'filename'
      };
    }

    const packFormat = normalizeFormatValue(pack.pack_format);
    let minFormat = normalizeFormatValue(pack.min_format);
    if (minFormat === null) minFormat = packFormat;
    let maxFormat = normalizeFormatValue(pack.max_format);
    if (maxFormat === null) maxFormat = packFormat;

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
      const lo = Number(sup.min_inclusive);
      const hi = Number(sup.max_inclusive);
      if (Number.isFinite(lo)) minFormat = minFormat === null ? Math.trunc(lo) : Math.min(minFormat, Math.trunc(lo));
      if (Number.isFinite(hi)) maxFormat = maxFormat === null ? Math.trunc(hi) : Math.max(maxFormat, Math.trunc(hi));
    }

    if (minFormat !== null && maxFormat !== null && maxFormat < minFormat) {
      maxFormat = minFormat;
    }

    return {
      name: fallbackName,
      filename,
      description: stripMcFormatting(flattenTextComponent(pack.description)).slice(0, 180),
      packFormat: packFormat !== null ? packFormat : minFormat,
      minFormat,
      maxFormat,
      mcVersionRangeLabel: describePackFormatRange(minFormat, maxFormat),
      hasMcmeta: true,
      iconDataUrl: iconDataUrl || '',
      normalized: Boolean(extra && extra.normalized),
      nestedRoot: (extra && extra.nestedRoot) || null,
      isShaderPack: false,
      source: 'mcmeta'
    };
  }

  function resourcePackFormatForMcVersion(mcVersion) {
    const clean = String(mcVersion || '').trim().replace(/[-+].*$/, '');
    const calver = clean.match(/^(\d{2,})\.(\d+)(?:\.(\d+))?$/);
    if (calver && Number(calver[1]) >= 26) return 84;
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
    if (minor === 19) return patch <= 2 ? 9 : patch === 3 ? 12 : 13;
    if (minor === 20) return patch <= 1 ? 15 : patch === 2 ? 18 : patch <= 4 ? 22 : 32;
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

  function evaluateResourcePackCompatibility(pack, mcVersion) {
    const ver = String(mcVersion || '1.21.4').trim() || '1.21.4';
    const targetFormat = resourcePackFormatForMcVersion(ver);

    if (pack && pack.isShaderPack && !pack.hasMcmeta) {
      return {
        compatible: false,
        status: 'unknown',
        targetFormat,
        reason: t(
          'rpack.compat.isShader',
          null,
          'Parece un pack de Shaders (carpeta shaders/ sin pack.mcmeta). Debe ir en shaderpacks/, no en Resource Packs.'
        )
      };
    }

    if (!pack || !pack.hasMcmeta || (pack.minFormat === null && pack.packFormat === null)) {
      return {
        compatible: false,
        status: 'unknown',
        targetFormat,
        reason: t('rpack.compat.noMcmeta', null, 'No incluye pack.mcmeta en la raíz del .zip (comprueba que no esté dentro de una subcarpeta).')
      };
    }
    if (targetFormat === null) {
      return {
        compatible: true,
        status: 'unknown',
        targetFormat: null,
        reason: t('rpack.compat.open', { mc: ver }, `Listo para aplicar en Minecraft ${ver}.`)
      };
    }
    const minFmt = typeof pack.minFormat === 'number' ? pack.minFormat : pack.packFormat;
    const maxFmt = typeof pack.maxFormat === 'number' ? pack.maxFormat : minFmt;
    if (targetFormat < minFmt || targetFormat > maxFmt) {
      return {
        compatible: false,
        status: 'incompatible',
        targetFormat,
        reason: t(
          'rpack.compat.mismatch',
          { expected: pack.mcVersionRangeLabel || String(pack.packFormat), mc: ver, targetFmt: String(targetFormat) },
          `Formato pensado para MC ${pack.mcVersionRangeLabel || pack.packFormat}, diferente al de ${ver} (formato ${targetFormat}).`
        )
      };
    }
    return {
      compatible: true,
      status: 'compatible',
      targetFormat,
      reason: t('rpack.compat.ok', { mc: ver }, `Compatible con Minecraft ${ver}.`)
    };
  }

  function findIncompatibleEnabledPacks(packs, mcVersion) {
    return (Array.isArray(packs) ? packs : [])
      .filter((p) => p && p.enabled)
      .map((p) => ({
        pack: p,
        compat: evaluateResourcePackCompatibility(p, mcVersion)
      }))
      .filter((entry) => !entry.compat.compatible);
  }

  function isLegacyResourcePackMcVersion(mcVersion) {
    const clean = String(mcVersion || '').trim().replace(/[-+].*$/, '');
    const sem = clean.match(/^1\.(\d+)/);
    return Boolean(sem && Number(sem[1]) <= 12);
  }

  function buildOptionsResourcePacksLine(enabledFilenames, mcVersion) {
    const legacy = isLegacyResourcePackMcVersion(mcVersion);
    const clean = Array.isArray(enabledFilenames)
      ? enabledFilenames.map((name) => sanitizeResourcePackFilename(name))
      : [];
    const entries = legacy ? clean : ['vanilla', ...clean.map((n) => `file/${n}`)];
    return `resourcePacks:${JSON.stringify(entries)}`;
  }

  function buildOptionsIncompatiblePacksLine(incompatibleFilenames, mcVersion) {
    if (isLegacyResourcePackMcVersion(mcVersion)) {
      return 'incompatibleResourcePacks:[]';
    }
    const seen = new Set();
    const entries = [];
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

  function applyResourcePacksToOptionsTxt(optionsTxt, enabledFilenames, mcVersion, incompatibleFilenames) {
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

  function bytesToPngDataUrl(bytes) {
    if (!bytes || bytes.length < 24 || bytes.length > 2 * 1024 * 1024) return '';
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) return '';
    }
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    try {
      return `data:image/png;base64,${window.btoa(bin)}`;
    } catch {
      return '';
    }
  }

  function isMacOrOsJunkPath(lowerName) {
    return (
      lowerName === '__macosx' ||
      lowerName.startsWith('__macosx/') ||
      lowerName === '.ds_store' ||
      lowerName.endsWith('/.ds_store') ||
      lowerName === 'thumbs.db' ||
      lowerName.endsWith('/thumbs.db')
    );
  }

  function parseCentralDirectory(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 22) return { validZip: false, zip64: false, entries: [], bytes, view: null };
    const view = new DataView(buffer);
    const sig0 = view.getUint32(0, true);
    if (sig0 !== 0x04034b50 && sig0 !== 0x06054b50) {
      return { validZip: false, zip64: false, entries: [], bytes, view };
    }

    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65558);
    for (let pos = bytes.length - 22; pos >= minSearch; pos--) {
      if (bytes[pos] === 0x50 && bytes[pos + 1] === 0x4b && bytes[pos + 2] === 0x05 && bytes[pos + 3] === 0x06) {
        const cLen = view.getUint16(pos + 20, true);
        if (pos + 22 + cLen === bytes.length) {
          eocdOffset = pos;
          break;
        }
        if (eocdOffset < 0) eocdOffset = pos;
      }
    }
    if (eocdOffset < 0) return { validZip: false, zip64: false, entries: [], bytes, view };

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      return { validZip: true, zip64: true, entries: [], bytes, view };
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const entries = [];
    let ptr = cdOffset;

    for (let i = 0; i < totalEntries && ptr + 46 <= bytes.length; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const flags = view.getUint16(ptr + 8, true);
      const method = view.getUint16(ptr + 10, true);
      const dosTime = view.getUint16(ptr + 12, true);
      const dosDate = view.getUint16(ptr + 14, true);
      const crc32 = view.getUint32(ptr + 16, true);
      const compSize = view.getUint32(ptr + 20, true);
      const uncompSize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const internalAttr = view.getUint16(ptr + 36, true);
      const externalAttr = view.getUint32(ptr + 38, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      if (ptr + 46 + nameLen > bytes.length) break;

      const rawName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
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

    return { validZip: true, zip64: false, entries, bytes, view };
  }

  async function extractEntryBytes(view, bytes, entry, maxBytes) {
    if (!view || entry.localHeaderOffset + 30 > bytes.length) return null;
    if (view.getUint32(entry.localHeaderOffset, true) !== 0x04034b50) return null;
    const lNameLen = view.getUint16(entry.localHeaderOffset + 26, true);
    const lExtraLen = view.getUint16(entry.localHeaderOffset + 28, true);
    const dataStart = entry.localHeaderOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + entry.compSize;
    if (dataEnd > bytes.length || entry.compSize > maxBytes || entry.uncompSize > maxBytes * 2) return null;

    const slice = bytes.subarray(dataStart, dataEnd);
    if (entry.method === 0) return slice;
    if (entry.method === 8 && typeof DecompressionStream === 'function') {
      const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const outBuf = await new Response(stream).arrayBuffer();
      if (outBuf.byteLength > maxBytes) return null;
      return new Uint8Array(outBuf);
    }
    return null;
  }

  function detectZipLayout(entries) {
    let hasRootMcmeta = false;
    let mcmetaEntry = null;
    let pngEntry = null;
    const nestedMcmetas = [];
    const nestedPngs = [];
    const topSegments = new Set();
    let hasShaders = false;

    for (const e of entries) {
      if (e.isJunk || !e.cleanName) continue;
      const parts = e.cleanName.split('/').filter(Boolean);
      if (parts.length > 0) topSegments.add(parts[0]);

      if (e.lowerName === 'pack.mcmeta') {
        hasRootMcmeta = true;
        if (!mcmetaEntry) mcmetaEntry = e;
      } else if (e.lowerName === 'pack.png') {
        if (!pngEntry) pngEntry = e;
      } else if (/^[^/]+\/pack\.mcmeta$/i.test(e.lowerName)) {
        nestedMcmetas.push(e);
      } else if (/^[^/]+\/pack\.png$/i.test(e.lowerName)) {
        nestedPngs.push(e);
      }

      if (e.lowerName.startsWith('shaders/') || /^[^/]+\/shaders\//i.test(e.lowerName)) {
        hasShaders = true;
      }
    }

    let nestedRoot = null;
    if (!hasRootMcmeta && nestedMcmetas.length === 1 && topSegments.size === 1) {
      const candidate = nestedMcmetas[0].cleanName.split('/')[0];
      if (candidate) {
        nestedRoot = candidate;
        mcmetaEntry = nestedMcmetas[0];
        const expectedPng = `${candidate}/pack.png`.toLowerCase();
        pngEntry = nestedPngs.find((p) => p.lowerName === expectedPng) || null;
      }
    }

    return {
      nestedRoot,
      mcmetaEntry,
      pngEntry,
      isShaderPack: !mcmetaEntry && hasShaders
    };
  }

  function normalizeResourcePackBuffer(buffer) {
    const parsed = parseCentralDirectory(buffer);
    if (!parsed.validZip || parsed.zip64) {
      return { buffer, normalized: false, nestedRoot: null };
    }
    const layout = detectZipLayout(parsed.entries);
    if (!layout.nestedRoot) {
      return { buffer, normalized: false, nestedRoot: null };
    }

    const encoder = new TextEncoder();
    const stripPrefix = `${layout.nestedRoot}/`;
    const stripLower = stripPrefix.toLowerCase();
    const kept = [];

    for (const e of parsed.entries) {
      if (e.isJunk || !e.cleanName) continue;
      if ((e.flags & 0x0001) !== 0) {
        return { buffer, normalized: false, nestedRoot: null };
      }
      if (!e.lowerName.startsWith(stripLower)) continue;
      const stripped = e.cleanName.slice(stripPrefix.length);
      if (!stripped) continue;
      if (e.localHeaderOffset + 30 > parsed.bytes.length) continue;
      if (parsed.view.getUint32(e.localHeaderOffset, true) !== 0x04034b50) continue;
      const lNameLen = parsed.view.getUint16(e.localHeaderOffset + 26, true);
      const lExtraLen = parsed.view.getUint16(e.localHeaderOffset + 28, true);
      const dataStart = e.localHeaderOffset + 30 + lNameLen + lExtraLen;
      const dataEnd = dataStart + e.compSize;
      if (dataEnd > parsed.bytes.length) continue;

      kept.push({
        entry: e,
        nameBytes: encoder.encode(stripped),
        payload: parsed.bytes.subarray(dataStart, dataEnd)
      });
    }

    if (kept.length === 0) {
      return { buffer, normalized: false, nestedRoot: null };
    }

    let localTotal = 0;
    let cdTotal = 0;
    for (const item of kept) {
      localTotal += 30 + item.nameBytes.length + item.payload.length;
      cdTotal += 46 + item.nameBytes.length;
    }

    const out = new Uint8Array(localTotal + cdTotal + 22);
    const outView = new DataView(out.buffer);
    const offsets = [];
    let pos = 0;

    for (const item of kept) {
      offsets.push(pos);
      const flags = (item.entry.flags & ~0x0008) | 0x0800;
      outView.setUint32(pos, 0x04034b50, true);
      outView.setUint16(pos + 4, 20, true);
      outView.setUint16(pos + 6, flags, true);
      outView.setUint16(pos + 8, item.entry.method, true);
      outView.setUint16(pos + 10, item.entry.dosTime, true);
      outView.setUint16(pos + 12, item.entry.dosDate, true);
      outView.setUint32(pos + 14, item.entry.crc32 >>> 0, true);
      outView.setUint32(pos + 18, item.entry.compSize >>> 0, true);
      outView.setUint32(pos + 22, item.entry.uncompSize >>> 0, true);
      outView.setUint16(pos + 26, item.nameBytes.length, true);
      outView.setUint16(pos + 28, 0, true);
      pos += 30;
      out.set(item.nameBytes, pos);
      pos += item.nameBytes.length;
      out.set(item.payload, pos);
      pos += item.payload.length;
    }

    const cdOffset = pos;
    for (let i = 0; i < kept.length; i++) {
      const item = kept[i];
      const flags = (item.entry.flags & ~0x0008) | 0x0800;
      outView.setUint32(pos, 0x02014b50, true);
      outView.setUint16(pos + 4, 0x0314, true);
      outView.setUint16(pos + 6, 20, true);
      outView.setUint16(pos + 8, flags, true);
      outView.setUint16(pos + 10, item.entry.method, true);
      outView.setUint16(pos + 12, item.entry.dosTime, true);
      outView.setUint16(pos + 14, item.entry.dosDate, true);
      outView.setUint32(pos + 16, item.entry.crc32 >>> 0, true);
      outView.setUint32(pos + 20, item.entry.compSize >>> 0, true);
      outView.setUint32(pos + 24, item.entry.uncompSize >>> 0, true);
      outView.setUint16(pos + 28, item.nameBytes.length, true);
      outView.setUint16(pos + 30, 0, true);
      outView.setUint16(pos + 32, 0, true);
      outView.setUint16(pos + 34, 0, true);
      outView.setUint16(pos + 36, item.entry.internalAttr, true);
      outView.setUint32(pos + 38, item.entry.externalAttr >>> 0, true);
      outView.setUint32(pos + 42, offsets[i] >>> 0, true);
      pos += 46;
      out.set(item.nameBytes, pos);
      pos += item.nameBytes.length;
    }

    const cdSize = pos - cdOffset;
    outView.setUint32(pos, 0x06054b50, true);
    outView.setUint16(pos + 4, 0, true);
    outView.setUint16(pos + 6, 0, true);
    outView.setUint16(pos + 8, kept.length, true);
    outView.setUint16(pos + 10, kept.length, true);
    outView.setUint32(pos + 12, cdSize >>> 0, true);
    outView.setUint32(pos + 16, cdOffset >>> 0, true);
    outView.setUint16(pos + 20, 0, true);

    return {
      buffer: out.buffer,
      normalized: true,
      nestedRoot: layout.nestedRoot
    };
  }

  async function readZipEntries(buffer) {
    const out = { mcmeta: null, iconDataUrl: '', hasZipHeader: false, nestedRoot: null, isShaderPack: false };
    const parsed = parseCentralDirectory(buffer);
    out.hasZipHeader = parsed.validZip;
    if (!parsed.validZip || parsed.zip64) return out;

    const layout = detectZipLayout(parsed.entries);
    out.nestedRoot = layout.nestedRoot;
    out.isShaderPack = layout.isShaderPack;
    const decoder = new TextDecoder('utf-8', { fatal: false });

    if (layout.mcmetaEntry) {
      try {
        const data = await extractEntryBytes(parsed.view, parsed.bytes, layout.mcmetaEntry, 512 * 1024);
        if (data) out.mcmeta = decoder.decode(data);
      } catch { /* ignore */ }
    }
    if (layout.pngEntry) {
      try {
        const data = await extractEntryBytes(parsed.view, parsed.bytes, layout.pngEntry, 2 * 1024 * 1024);
        if (data) out.iconDataUrl = bytesToPngDataUrl(data);
      } catch { /* ignore */ }
    }
    return out;
  }

  async function inspectResourcePackBuffer(buffer, rawFilename, extra) {
    const filename = sanitizeResourcePackFilename(rawFilename);
    const entries = await readZipEntries(buffer).catch(() => ({
      mcmeta: null,
      iconDataUrl: '',
      hasZipHeader: false,
      nestedRoot: null,
      isShaderPack: false
    }));
    if (!entries.hasZipHeader) {
      throw new Error(t('rpack.err.invalidZip', { name: filename }, `"${filename}" no es un archivo ZIP válido.`));
    }
    return extractMcmetaInfo(entries.mcmeta, filename, entries.iconDataUrl, {
      normalized: Boolean(extra && extra.normalized),
      nestedRoot: entries.nestedRoot,
      isShaderPack: entries.isShaderPack
    });
  }

  Nexus.resourcePackInspector = Object.freeze({
    sanitizeResourcePackFilename,
    sanitizePackFilename: sanitizeResourcePackFilename,
    stripMcFormatting,
    extractMcmetaInfo,
    resourcePackFormatForMcVersion,
    evaluateResourcePackCompatibility,
    findIncompatibleEnabledPacks,
    isLegacyResourcePackMcVersion,
    buildOptionsResourcePacksLine,
    buildOptionsIncompatiblePacksLine,
    applyResourcePacksToOptionsTxt,
    normalizeResourcePackBuffer,
    inspectResourcePackBuffer
  });
})();
