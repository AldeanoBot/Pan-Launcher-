(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const VALID_MOD_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];

  function tr(key, vars, fallback) {
    if (Nexus.i18n && typeof Nexus.i18n.t === 'function') {
      const translated = Nexus.i18n.t(key, vars);
      if (translated !== key || !fallback) return translated;
    }
    return String(fallback || key);
  }

  function normalizeLoaderId(raw) {
    const low = String(raw || 'vanilla').trim().toLowerCase();
    return VALID_MOD_LOADERS.includes(low) ? low : 'vanilla';
  }

  function loaderDisplayName(loader) {
    switch (normalizeLoaderId(loader)) {
      case 'fabric': return 'Fabric';
      case 'forge': return 'Forge';
      case 'neoforge': return 'NeoForge';
      case 'quilt': return 'Quilt';
      default: return 'Vanilla';
    }
  }

  function sanitizeJarFilename(rawName) {
    const base = String(rawName || '').split(/[\\/]/).pop() || 'mod.jar';
    let clean = base.replace(/[^A-Za-z0-9._+-]/g, '_').replace(/^\.+/, '');
    if (!clean) clean = 'custom-mod.jar';
    if (!clean.toLowerCase().endsWith('.jar')) clean += '.jar';
    return clean.slice(0, 140);
  }

  function parseMcVersionTuple(raw) {
    const cleaned = String(raw || '')
      .trim()
      .replace(/^mc/i, '')
      .replace(/[-+].*$/, '');
    const m = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  }

  function compareMcTuples(a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
    return 0;
  }

  function matchSingleWildcard(mcTuple, pattern) {
    const p = String(pattern || '').trim().replace(/^=/, '');
    if (!p || p === '*' || p.toLowerCase() === 'x') return true;
    if (!/[x*]/i.test(p)) return null;
    const parts = p.split('.');
    if (parts.length < 2 || parts.length > 3) return null;
    for (let i = 0; i < 3; i++) {
      const seg = parts[i];
      if (seg === undefined || seg === '*' || seg.toLowerCase() === 'x') continue;
      const n = Number(seg);
      if (!Number.isFinite(n)) return null;
      if (mcTuple[i] !== n) return false;
    }
    return true;
  }

  function matchFabricClause(mcTuple, rawVersion, clause) {
    const c = String(clause || '').trim();
    if (!c || c === '*') return true;
    const wc = matchSingleWildcard(mcTuple, c);
    if (wc !== null) return wc;

    if (c.startsWith('>=')) {
      const t = parseMcVersionTuple(c.slice(2));
      return t ? compareMcTuples(mcTuple, t) >= 0 : true;
    }
    if (c.startsWith('<=')) {
      const t = parseMcVersionTuple(c.slice(2));
      return t ? compareMcTuples(mcTuple, t) <= 0 : true;
    }
    if (c.startsWith('>')) {
      const t = parseMcVersionTuple(c.slice(1));
      return t ? compareMcTuples(mcTuple, t) > 0 : true;
    }
    if (c.startsWith('<')) {
      const t = parseMcVersionTuple(c.slice(1));
      return t ? compareMcTuples(mcTuple, t) < 0 : true;
    }
    if (c.startsWith('~')) {
      const targetRaw = c.slice(1).trim();
      const wcTilde = matchSingleWildcard(mcTuple, targetRaw);
      if (wcTilde !== null) return wcTilde;
      const t = parseMcVersionTuple(targetRaw);
      if (!t) return true;
      const upper = [t[0], t[1] + 1, 0];
      return compareMcTuples(mcTuple, t) >= 0 && compareMcTuples(mcTuple, upper) < 0;
    }
    if (c.startsWith('^')) {
      const targetRaw = c.slice(1).trim();
      const t = parseMcVersionTuple(targetRaw);
      if (!t) return true;
      const upper = t[0] === 0 ? [0, t[1] + 1, 0] : [t[0] + 1, 0, 0];
      return compareMcTuples(mcTuple, t) >= 0 && compareMcTuples(mcTuple, upper) < 0;
    }
    if (c.startsWith('=')) {
      const t = parseMcVersionTuple(c.slice(1));
      return t ? compareMcTuples(mcTuple, t) === 0 : c.slice(1).trim() === rawVersion.trim();
    }
    const exact = parseMcVersionTuple(c);
    if (exact) return compareMcTuples(mcTuple, exact) === 0;
    return rawVersion.trim().toLowerCase() === c.toLowerCase();
  }

  function matchMavenBracketToken(mcTuple, rawVersion, token) {
    const t = String(token || '').trim();
    if (!t) return false;
    const first = t[0];
    const last = t[t.length - 1];
    if ((first !== '[' && first !== '(') || (last !== ']' && last !== ')')) {
      return matchFabricClause(mcTuple, rawVersion, t);
    }
    const inner = t.slice(1, -1).trim();
    if (!inner.includes(',')) {
      const exact = parseMcVersionTuple(inner);
      return Boolean(exact && first === '[' && last === ']' && compareMcTuples(mcTuple, exact) === 0);
    }
    const commaIdx = inner.indexOf(',');
    const lowStr = inner.slice(0, commaIdx).trim();
    const highStr = inner.slice(commaIdx + 1).trim();
    if (lowStr) {
      const low = parseMcVersionTuple(lowStr);
      if (low) {
        const cmp = compareMcTuples(mcTuple, low);
        if (first === '[' ? cmp < 0 : cmp <= 0) return false;
      }
    }
    if (highStr) {
      const high = parseMcVersionTuple(highStr);
      if (high) {
        const cmp = compareMcTuples(mcTuple, high);
        if (last === ']' ? cmp > 0 : cmp >= 0) return false;
      }
    }
    return true;
  }

  function matchesMcVersionRange(mcVersion, spec) {
    if (!spec || (Array.isArray(spec) && spec.length === 0)) return true;
    const specs = Array.isArray(spec)
      ? spec.map((s) => String(s || '').trim()).filter(Boolean)
      : String(spec).split(/\s*\|\|\s*/).map((s) => s.trim()).filter(Boolean);
    if (specs.length === 0) return true;
    const raw = String(mcVersion || '').trim();
    if (!raw) return true;
    const mcTuple = parseMcVersionTuple(raw);

    for (const expr of specs) {
      if (expr === '*') return true;
      if (!mcTuple) {
        if (expr.toLowerCase().includes(raw.toLowerCase())) return true;
        continue;
      }
      if (/^[\[(]/.test(expr)) {
        const tokens = expr.match(/[\[(][^\])\r\n]*[\])]/g);
        if (tokens && tokens.length > 0) {
          if (tokens.some((tok) => matchMavenBracketToken(mcTuple, raw, tok))) return true;
          continue;
        }
      }
      const clauses = expr.split(/\s+/).filter(Boolean);
      if (clauses.length > 0 && clauses.every((cl) => matchFabricClause(mcTuple, raw, cl))) {
        return true;
      }
    }
    return false;
  }

  function unquoteTomlValue(raw) {
    const s = String(raw || '').trim();
    if (s.startsWith('"""') && s.endsWith('"""') && s.length >= 6) return s.slice(3, -3).trim();
    if (s.startsWith("'''") && s.endsWith("'''") && s.length >= 6) return s.slice(3, -3).trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1).trim();
    }
    return s;
  }

  function parseModsToml(tomlText, defaultLoader) {
    const lines = String(tomlText || '').split(/\r?\n/);
    let section = '';
    let modId = '';
    let displayName = '';
    let version = '';
    let description = '';
    let detectedLoader = defaultLoader;
    let curDep = null;
    const deps = [];

    for (const rawLine of lines) {
      const noComment = rawLine.replace(/^\s*#.*$/, '').trim();
      if (!noComment) continue;
      if (noComment.startsWith('[[')) {
        if (curDep) { deps.push(curDep); curDep = null; }
        section = noComment.toLowerCase();
        if (section.includes('dependencies')) curDep = {};
        continue;
      }
      if (noComment.startsWith('[')) {
        if (curDep) { deps.push(curDep); curDep = null; }
        section = noComment.toLowerCase();
        continue;
      }
      const eqIdx = noComment.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = noComment.slice(0, eqIdx).trim().toLowerCase();
      const rawVal = noComment.slice(eqIdx + 1).replace(/\s+#.*$/, '').trim();
      const val = unquoteTomlValue(rawVal);

      if (section === '[[mods]]') {
        if (key === 'modid' && !modId) modId = val;
        else if (key === 'displayname' && !displayName) displayName = val;
        else if (key === 'version' && !version) version = val;
        else if (key === 'description' && !description) description = val;
      } else if (curDep) {
        if (key === 'modid') curDep.modId = val.toLowerCase();
        else if (key === 'versionrange') curDep.versionRange = val;
      } else if (key === 'modloader' && val.toLowerCase().includes('neoforge')) {
        detectedLoader = 'neoforge';
      }
    }
    if (curDep) deps.push(curDep);
    if (deps.some((d) => d.modId === 'neoforge')) detectedLoader = 'neoforge';
    const mcDep = deps.find((d) => d.modId === 'minecraft');
    return {
      modId,
      displayName,
      version: version === '${file.jarVersion}' ? '' : version,
      description,
      mcVersionSpec: mcDep && mcDep.versionRange ? mcDep.versionRange : null,
      loader: detectedLoader
    };
  }

  function inferModHintsFromFilename(filename) {
    const base = String(filename || 'mod.jar').replace(/\.jar$/i, '');
    const low = base.toLowerCase();
    const loaders = [];
    if (/(?:^|[-_+.\s])neoforge(?:[-_+.\s]|$)/i.test(low)) loaders.push('neoforge');
    else if (/(?:^|[-_+.\s])forge(?:[-_+.\s]|$)/i.test(low)) loaders.push('forge');
    if (/(?:^|[-_+.\s])fabric(?:[-_+.\s]|$)/i.test(low)) loaders.push('fabric');
    if (/(?:^|[-_+.\s])quilt(?:[-_+.\s]|$)/i.test(low)) loaders.push('quilt');

    let mcVersionSpec = null;
    const explicitMc = base.match(/(?:mc|minecraft)[-_ ]?(1\.\d+(?:\.\d+)?|2[5-9]\.\d+(?:\.\d+)?)/i);
    if (explicitMc) {
      mcVersionSpec = explicitMc[1];
    } else {
      const standalone = base.match(/(?:^|[-_+])(1\.(?:7|8|9|1\d|2\d)(?:\.\d+)?|2[5-9]\.\d+(?:\.\d+)?)(?=$|[-_+])/);
      if (standalone) mcVersionSpec = standalone[1];
    }
    return { name: base, loaders, mcVersionSpec };
  }

  function formatSpec(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
      const parts = raw.map((x) => String(x || '').trim()).filter(Boolean);
      return parts.length ? parts.join(' || ') : null;
    }
    const str = String(raw).trim();
    return str || null;
  }

  function extractModMetadataFromEntries(entries) {
    const filename = sanitizeJarFilename(entries && entries.filename);
    const hints = inferModHintsFromFilename(filename);
    const loaderSet = new Set();

    let modId = '';
    let name = '';
    let version = '';
    let description = '';
    let mcVersionSpec = null;
    let source = 'filename';

    if (entries && entries.fabricJson) {
      try {
        const f = JSON.parse(String(entries.fabricJson).replace(/^\uFEFF/, ''));
        modId = String(f.id || '');
        name = String(f.name || f.id || '');
        version = String(f.version || '');
        description = typeof f.description === 'string' ? f.description : '';
        mcVersionSpec = formatSpec(f.depends && f.depends.minecraft);
        loaderSet.add('fabric');
        source = 'fabric';
      } catch {
        // fallback
      }
    }

    if (entries && entries.quiltJson) {
      try {
        const q = JSON.parse(String(entries.quiltJson).replace(/^\uFEFF/, ''));
        const ql = q.quilt_loader || {};
        const meta = ql.metadata || {};
        if (!modId) modId = String(ql.id || '');
        if (!name) name = String(meta.name || ql.id || '');
        if (!version) version = String(ql.version || '');
        if (!description && typeof meta.description === 'string') description = meta.description;
        if (!mcVersionSpec && Array.isArray(ql.depends)) {
          const mcDep = ql.depends.find((d) => d && typeof d === 'object' && d.id === 'minecraft');
          if (mcDep && mcDep.versions) mcVersionSpec = formatSpec(mcDep.versions);
        }
        loaderSet.add('quilt');
        if (source === 'filename') source = 'quilt';
      } catch {
        // fallback
      }
    }

    if (entries && entries.neoforgeToml) {
      const parsed = parseModsToml(entries.neoforgeToml, 'neoforge');
      if (!modId) modId = parsed.modId;
      if (!name) name = parsed.displayName || parsed.modId;
      if (!version) version = parsed.version;
      if (!description) description = parsed.description;
      if (!mcVersionSpec && parsed.mcVersionSpec) mcVersionSpec = parsed.mcVersionSpec;
      loaderSet.add('neoforge');
      if (source === 'filename') source = 'neoforge';
    }

    if (entries && entries.forgeToml) {
      const parsed = parseModsToml(entries.forgeToml, 'forge');
      if (!modId) modId = parsed.modId;
      if (!name) name = parsed.displayName || parsed.modId;
      if (!version) version = parsed.version;
      if (!description) description = parsed.description;
      if (!mcVersionSpec && parsed.mcVersionSpec) mcVersionSpec = parsed.mcVersionSpec;
      loaderSet.add(parsed.loader);
      if (source === 'filename') source = parsed.loader;
    }

    if (entries && entries.mcmodInfo) {
      try {
        const parsed = JSON.parse(String(entries.mcmodInfo).replace(/^\uFEFF/, ''));
        const first = Array.isArray(parsed)
          ? parsed[0]
          : (Array.isArray(parsed && parsed.modList) ? parsed.modList[0] : null);
        if (first && typeof first === 'object') {
          if (!modId) modId = String(first.modid || '');
          if (!name) name = String(first.name || first.modid || '');
          if (!version) version = String(first.version || '');
          if (!description && typeof first.description === 'string') description = first.description;
          if (!mcVersionSpec && first.mcversion) mcVersionSpec = String(first.mcversion).trim();
          loaderSet.add('forge');
          if (source === 'filename') source = 'mcmod';
        }
      } catch {
        // fallback
      }
    }

    if (loaderSet.size === 0) {
      for (const hl of hints.loaders) loaderSet.add(hl);
    }
    if (!mcVersionSpec && hints.mcVersionSpec) {
      mcVersionSpec = hints.mcVersionSpec;
    }

    const loaders = [...loaderSet].filter((l) => VALID_MOD_LOADERS.includes(l));

    return {
      modId: modId || filename.replace(/\.jar$/i, '').toLowerCase(),
      name: name || hints.name,
      version: version || '—',
      description: String(description || '').slice(0, 180),
      loaders,
      mcVersionSpec,
      source
    };
  }

  function evaluateCustomModCompatibility(mod, targetMcVersion, targetLoaderRaw) {
    const targetLoader = normalizeLoaderId(targetLoaderRaw);
    const mcVer = String(targetMcVersion || '1.21.4').trim() || '1.21.4';
    const loaders = Array.isArray(mod && mod.loaders)
      ? mod.loaders.map(normalizeLoaderId).filter((l) => l !== 'vanilla')
      : [];

    if (targetLoader === 'vanilla') {
      return {
        compatible: false,
        status: 'incompatible',
        reasonCode: 'vanilla-loader',
        reason: tr('mods.compat.vanilla', null, 'Estás en modo Vanilla (no carga mods). Cambia a Fabric, Forge, NeoForge o Quilt.')
      };
    }

    if (loaders.length > 0) {
      const supportsLoader =
        loaders.includes(targetLoader) ||
        (targetLoader === 'quilt' && loaders.includes('fabric'));
      if (!supportsLoader) {
        const expected = loaders.map(loaderDisplayName).join(' / ');
        const current = loaderDisplayName(targetLoader);
        return {
          compatible: false,
          status: 'incompatible',
          reasonCode: 'wrong-loader',
          reason: tr('mods.compat.wrongLoader', { expected, current }, `Requiere ${expected}, pero tienes ${current} seleccionado.`)
        };
      }
    }

    if (mod && mod.mcVersionSpec && !matchesMcVersionRange(mcVer, mod.mcVersionSpec)) {
      return {
        compatible: false,
        status: 'incompatible',
        reasonCode: 'wrong-version',
        reason: tr('mods.compat.wrongVersion', { spec: mod.mcVersionSpec, mc: mcVer }, `Compatible con Minecraft ${mod.mcVersionSpec}, incompatible con ${mcVer}.`)
      };
    }

    if (!mod || !mod.mcVersionSpec) {
      const loaderName = loaderDisplayName(targetLoader);
      return {
        compatible: true,
        status: 'compatible',
        reasonCode: 'open-version',
        reason: tr('mods.compat.openVersion', { loader: loaderName, mc: mcVer }, `Listo para ${loaderName} ${mcVer} (sin restricción de versión).`)
      };
    }

    const loaderName = loaderDisplayName(targetLoader);
    return {
      compatible: true,
      status: 'compatible',
      reasonCode: 'compatible',
      reason: tr('mods.compat.ok', { mc: mcVer, loader: loaderName }, `Compatible con Minecraft ${mcVer} (${loaderName}).`)
    };
  }

  function findIncompatibleEnabledMods(mods, targetMcVersion, targetLoaderRaw) {
    return (Array.isArray(mods) ? mods : [])
      .filter((m) => m && m.enabled)
      .map((m) => ({
        mod: m,
        compat: evaluateCustomModCompatibility(m, targetMcVersion, targetLoaderRaw)
      }))
      .filter((entry) => !entry.compat.compatible);
  }

  async function readZipTargetEntries(buffer) {
    const out = {};
    const TARGETS = {
      'fabric.mod.json': 'fabricJson',
      'quilt.mod.json': 'quiltJson',
      'meta-inf/neoforge.mods.toml': 'neoforgeToml',
      'meta-inf/mods.toml': 'forgeToml',
      'mcmod.info': 'mcmodInfo'
    };
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 22) return out;
    const view = new DataView(buffer);

    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65558);
    for (let pos = bytes.length - 22; pos >= minSearch; pos--) {
      if (
        bytes[pos] === 0x50 &&
        bytes[pos + 1] === 0x4b &&
        bytes[pos + 2] === 0x05 &&
        bytes[pos + 3] === 0x06
      ) {
        eocdOffset = pos;
        break;
      }
    }
    if (eocdOffset < 0) return out;

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let ptr = cdOffset;

    for (let i = 0; i < totalEntries && ptr + 46 <= bytes.length; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      if (ptr + 46 + nameLen > bytes.length) break;
      const entryName = decoder
        .decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
        .replace(/\\/g, '/')
        .replace(/^(\.\/|\/)+/, '')
        .toLowerCase();
      ptr += 46 + nameLen + extraLen + commentLen;

      const targetKey = TARGETS[entryName];
      if (!targetKey || out[targetKey]) continue;
      if (localHeaderOffset + 30 > bytes.length) continue;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;

      const lNameLen = view.getUint16(localHeaderOffset + 26, true);
      const lExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > bytes.length || compSize > 512 * 1024) continue;

      const slice = bytes.subarray(dataStart, dataEnd);
      try {
        if (method === 0) {
          out[targetKey] = decoder.decode(slice);
        } else if (method === 8 && typeof DecompressionStream === 'function') {
          const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          out[targetKey] = await new Response(stream).text();
        }
      } catch {
        // Ignore single compressed manifest failure
      }
    }
    return out;
  }

  async function inspectJarBuffer(buffer, rawFilename) {
    const filename = sanitizeJarFilename(rawFilename);
    let entries = {};
    try {
      entries = await readZipTargetEntries(buffer);
    } catch {
      entries = {};
    }
    return extractModMetadataFromEntries({ ...entries, filename });
  }

  Nexus.modInspector = Object.freeze({
    normalizeLoaderId,
    loaderDisplayName,
    sanitizeJarFilename,
    matchesMcVersionRange,
    inferModHintsFromFilename,
    extractModMetadataFromEntries,
    evaluateCustomModCompatibility,
    findIncompatibleEnabledMods,
    inspectJarBuffer
  });
})();
