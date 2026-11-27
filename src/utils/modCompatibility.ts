export type ModLoaderId = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';

export interface ModManifestEntries {
  filename: string;
  fabricJson?: string | null;
  quiltJson?: string | null;
  neoforgeToml?: string | null;
  forgeToml?: string | null;
  mcmodInfo?: string | null;
  manifestMf?: string | null;
}

export interface InspectedModMeta {
  modId: string;
  name: string;
  version: string;
  description: string;
  loaders: ModLoaderId[];
  mcVersionSpec: string | null;
  source: 'fabric' | 'quilt' | 'neoforge' | 'forge' | 'mcmod' | 'filename';
}

export interface ModCompatibilityResult {
  compatible: boolean;
  status: 'compatible' | 'incompatible' | 'warning';
  reasonCode: 'compatible' | 'open-version' | 'vanilla-loader' | 'wrong-loader' | 'wrong-version';
  reason: string;
}

const VALID_MOD_LOADERS: ModLoaderId[] = ['fabric', 'forge', 'neoforge', 'quilt'];

export function normalizeLoaderId(raw: string | null | undefined): ModLoaderId {
  const low = String(raw || 'vanilla').trim().toLowerCase();
  if (low === 'fabric' || low === 'forge' || low === 'neoforge' || low === 'quilt') {
    return low;
  }
  return 'vanilla';
}

export function loaderDisplayName(loader: ModLoaderId): string {
  switch (loader) {
    case 'fabric':
      return 'Fabric';
    case 'forge':
      return 'Forge';
    case 'neoforge':
      return 'NeoForge';
    case 'quilt':
      return 'Quilt';
    default:
      return 'Vanilla';
  }
}

export function sanitizeJarFilename(rawName: string): string {
  const base = String(rawName || '')
    .split(/[\\/]/)
    .pop() || 'mod.jar';
  let clean = base.replace(/[^A-Za-z0-9._+-]/g, '_').replace(/^\.+/, '');
  if (!clean) clean = 'custom-mod.jar';
  if (!clean.toLowerCase().endsWith('.jar')) {
    clean += '.jar';
  }
  return clean.slice(0, 140);
}

export function parseMcVersionTuple(raw: string): [number, number, number] | null {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^mc/i, '')
    .replace(/[-+].*$/, '');
  const m = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

export function compareMcTuples(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

function matchSingleWildcard(mcTuple: [number, number, number], pattern: string): boolean | null {
  const p = pattern.trim().replace(/^=/, '');
  if (!p || p === '*' || p.toLowerCase() === 'x') return true;
  if (!/[x*]/i.test(p)) return null;
  const parts = p.split('.');
  if (parts.length < 2 || parts.length > 3) return null;
  for (let i = 0; i < 3; i++) {
    const seg = parts[i];
    if (seg === undefined || seg === '*' || seg.toLowerCase() === 'x') {
      continue;
    }
    const n = Number(seg);
    if (!Number.isFinite(n)) return null;
    if (mcTuple[i] !== n) return false;
  }
  return true;
}

function matchFabricClause(mcTuple: [number, number, number], rawVersion: string, clause: string): boolean {
  const c = clause.trim();
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
    const upper: [number, number, number] = [t[0], t[1] + 1, 0];
    return compareMcTuples(mcTuple, t) >= 0 && compareMcTuples(mcTuple, upper) < 0;
  }
  if (c.startsWith('^')) {
    const targetRaw = c.slice(1).trim();
    const t = parseMcVersionTuple(targetRaw);
    if (!t) return true;
    const upper: [number, number, number] = t[0] === 0 ? [0, t[1] + 1, 0] : [t[0] + 1, 0, 0];
    return compareMcTuples(mcTuple, t) >= 0 && compareMcTuples(mcTuple, upper) < 0;
  }
  if (c.startsWith('=')) {
    const t = parseMcVersionTuple(c.slice(1));
    return t ? compareMcTuples(mcTuple, t) === 0 : c.slice(1).trim() === rawVersion.trim();
  }

  const exact = parseMcVersionTuple(c);
  if (exact) {
    return compareMcTuples(mcTuple, exact) === 0;
  }
  return rawVersion.trim().toLowerCase() === c.toLowerCase();
}

function matchMavenBracketToken(mcTuple: [number, number, number], rawVersion: string, token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  const first = t[0];
  const last = t[t.length - 1];
  if ((first !== '[' && first !== '(') || (last !== ']' && last !== ')')) {
    return matchFabricClause(mcTuple, rawVersion, t);
  }
  const inner = t.slice(1, -1).trim();
  if (!inner.includes(',')) {
    const exact = parseMcVersionTuple(inner);
    if (exact && first === '[' && last === ']') {
      return compareMcTuples(mcTuple, exact) === 0;
    }
    return false;
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

export function matchesMcVersionRange(mcVersion: string, spec: string | string[] | null | undefined): boolean {
  if (!spec || (Array.isArray(spec) && spec.length === 0)) return true;
  const specs = Array.isArray(spec)
    ? spec.map((s) => String(s || '').trim()).filter(Boolean)
    : String(spec)
        .split(/\s*\|\|\s*/)
        .map((s) => s.trim())
        .filter(Boolean);

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

    // Maven style brackets: e.g. [1.21,1.22) or [1.21.1],[1.21.4]
    if (/^[\[(]/.test(expr)) {
      const tokens = expr.match(/[\[(][^\])\r\n]*[\])]/g);
      if (tokens && tokens.length > 0) {
        if (tokens.some((tok) => matchMavenBracketToken(mcTuple, raw, tok))) {
          return true;
        }
        continue;
      }
    }

    // Fabric / Semver space-separated AND clauses
    const clauses = expr.split(/\s+/).filter(Boolean);
    if (clauses.length > 0 && clauses.every((cl) => matchFabricClause(mcTuple, raw, cl))) {
      return true;
    }
  }
  return false;
}

function unquoteTomlValue(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"""') && s.endsWith('"""') && s.length >= 6) {
    return s.slice(3, -3).trim();
  }
  if (s.startsWith("'''") && s.endsWith("'''") && s.length >= 6) {
    return s.slice(3, -3).trim();
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseModsToml(tomlText: string, defaultLoader: 'forge' | 'neoforge') {
  const lines = String(tomlText || '').split(/\r?\n/);
  let section = '';
  let modId = '';
  let displayName = '';
  let version = '';
  let description = '';
  let detectedLoader: 'forge' | 'neoforge' = defaultLoader;
  let curDep: { modId?: string; versionRange?: string } | null = null;
  const deps: Array<{ modId?: string; versionRange?: string }> = [];

  for (const rawLine of lines) {
    const noComment = rawLine.replace(/^\s*#.*$/, '').trim();
    if (!noComment) continue;

    if (noComment.startsWith('[[')) {
      if (curDep) {
        deps.push(curDep);
        curDep = null;
      }
      section = noComment.toLowerCase();
      if (section.includes('dependencies')) {
        curDep = {};
      }
      continue;
    }
    if (noComment.startsWith('[')) {
      if (curDep) {
        deps.push(curDep);
        curDep = null;
      }
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

  if (deps.some((d) => d.modId === 'neoforge')) {
    detectedLoader = 'neoforge';
  }
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

export function inferModHintsFromFilename(filename: string): {
  name: string;
  loaders: ModLoaderId[];
  mcVersionSpec: string | null;
} {
  const base = String(filename || 'mod.jar').replace(/\.jar$/i, '');
  const low = base.toLowerCase();
  const loaders: ModLoaderId[] = [];
  if (/(?:^|[-_+.\s])neoforge(?:[-_+.\s]|$)/i.test(low)) loaders.push('neoforge');
  else if (/(?:^|[-_+.\s])forge(?:[-_+.\s]|$)/i.test(low)) loaders.push('forge');
  if (/(?:^|[-_+.\s])fabric(?:[-_+.\s]|$)/i.test(low)) loaders.push('fabric');
  if (/(?:^|[-_+.\s])quilt(?:[-_+.\s]|$)/i.test(low)) loaders.push('quilt');

  let mcVersionSpec: string | null = null;
  const explicitMc = base.match(/(?:mc|minecraft)[-_ ]?(1\.\d+(?:\.\d+)?|2[5-9]\.\d+(?:\.\d+)?)/i);
  if (explicitMc) {
    mcVersionSpec = explicitMc[1];
  } else {
    const standalone = base.match(/(?:^|[-_+])(1\.(?:7|8|9|1\d|2\d)(?:\.\d+)?|2[5-9]\.\d+(?:\.\d+)?)(?=$|[-_+])/);
    if (standalone) mcVersionSpec = standalone[1];
  }

  return {
    name: base,
    loaders,
    mcVersionSpec
  };
}

function formatSpec(raw: unknown): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const parts = raw.map((x) => String(x || '').trim()).filter(Boolean);
    return parts.length ? parts.join(' || ') : null;
  }
  const str = String(raw).trim();
  return str || null;
}

export function extractModMetadataFromEntries(entries: ModManifestEntries): InspectedModMeta {
  const filename = sanitizeJarFilename(entries.filename);
  const hints = inferModHintsFromFilename(filename);
  const loaderSet = new Set<ModLoaderId>();

  let modId = '';
  let name = '';
  let version = '';
  let description = '';
  let mcVersionSpec: string | null = null;
  let source: InspectedModMeta['source'] = 'filename';

  if (entries.fabricJson) {
    try {
      const f = JSON.parse(entries.fabricJson);
      modId = String(f.id || '');
      name = String(f.name || f.id || '');
      version = String(f.version || '');
      description = typeof f.description === 'string' ? f.description : '';
      mcVersionSpec = formatSpec(f.depends && f.depends.minecraft);
      loaderSet.add('fabric');
      source = 'fabric';
    } catch {
      // Ignore malformed JSON and fallback
    }
  }

  if (entries.quiltJson) {
    try {
      const q = JSON.parse(entries.quiltJson);
      const ql = q.quilt_loader || {};
      const meta = ql.metadata || {};
      if (!modId) modId = String(ql.id || '');
      if (!name) name = String(meta.name || ql.id || '');
      if (!version) version = String(ql.version || '');
      if (!description && typeof meta.description === 'string') description = meta.description;
      if (!mcVersionSpec && Array.isArray(ql.depends)) {
        const mcDep = ql.depends.find((d: any) => d && typeof d === 'object' && d.id === 'minecraft');
        if (mcDep && mcDep.versions) mcVersionSpec = formatSpec(mcDep.versions);
      }
      loaderSet.add('quilt');
      if (source === 'filename') source = 'quilt';
    } catch {
      // Ignore malformed JSON
    }
  }

  if (entries.neoforgeToml) {
    const parsed = parseModsToml(entries.neoforgeToml, 'neoforge');
    if (!modId) modId = parsed.modId;
    if (!name) name = parsed.displayName || parsed.modId;
    if (!version) version = parsed.version;
    if (!description) description = parsed.description;
    if (!mcVersionSpec && parsed.mcVersionSpec) mcVersionSpec = parsed.mcVersionSpec;
    loaderSet.add('neoforge');
    if (source === 'filename') source = 'neoforge';
  }

  if (entries.forgeToml) {
    const parsed = parseModsToml(entries.forgeToml, 'forge');
    if (!modId) modId = parsed.modId;
    if (!name) name = parsed.displayName || parsed.modId;
    if (!version) version = parsed.version;
    if (!description) description = parsed.description;
    if (!mcVersionSpec && parsed.mcVersionSpec) mcVersionSpec = parsed.mcVersionSpec;
    loaderSet.add(parsed.loader);
    if (source === 'filename') source = parsed.loader;
  }

  if (entries.mcmodInfo) {
    try {
      const parsed = JSON.parse(entries.mcmodInfo);
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
      // Ignore malformed JSON
    }
  }

  if (loaderSet.size === 0) {
    for (const hl of hints.loaders) loaderSet.add(hl);
  }
  if (!mcVersionSpec && hints.mcVersionSpec) {
    mcVersionSpec = hints.mcVersionSpec;
  }

  const cleanLoaders = [...loaderSet].filter((l): l is ModLoaderId => VALID_MOD_LOADERS.includes(l));

  return {
    modId: modId || filename.replace(/\.jar$/i, '').toLowerCase(),
    name: name || hints.name,
    version: version || '—',
    description: description.slice(0, 180),
    loaders: cleanLoaders,
    mcVersionSpec,
    source
  };
}

export function evaluateCustomModCompatibility(
  mod: Pick<InspectedModMeta, 'name' | 'loaders' | 'mcVersionSpec'>,
  targetMcVersion: string,
  targetLoaderRaw: string
): ModCompatibilityResult {
  const targetLoader = normalizeLoaderId(targetLoaderRaw);
  const mcVer = String(targetMcVersion || '1.21.4').trim() || '1.21.4';
  const loaders = Array.isArray(mod.loaders) ? mod.loaders.map(normalizeLoaderId).filter((l) => l !== 'vanilla') : [];

  if (targetLoader === 'vanilla') {
    return {
      compatible: false,
      status: 'incompatible',
      reasonCode: 'vanilla-loader',
      reason: 'Estás en modo Vanilla (no carga mods). Cambia a Fabric, Forge, NeoForge o Quilt.'
    };
  }

  if (loaders.length > 0) {
    const supportsLoader =
      loaders.includes(targetLoader) ||
      (targetLoader === 'quilt' && loaders.includes('fabric'));
    if (!supportsLoader) {
      const expected = loaders.map(loaderDisplayName).join(' / ');
      return {
        compatible: false,
        status: 'incompatible',
        reasonCode: 'wrong-loader',
        reason: `Requiere ${expected}, pero tienes ${loaderDisplayName(targetLoader)} seleccionado.`
      };
    }
  }

  if (mod.mcVersionSpec && !matchesMcVersionRange(mcVer, mod.mcVersionSpec)) {
    return {
      compatible: false,
      status: 'incompatible',
      reasonCode: 'wrong-version',
      reason: `Compatible con Minecraft ${mod.mcVersionSpec}, incompatible con ${mcVer}.`
    };
  }

  if (!mod.mcVersionSpec) {
    return {
      compatible: true,
      status: 'compatible',
      reasonCode: 'open-version',
      reason: `Listo para ${loaderDisplayName(targetLoader)} ${mcVer} (sin restricción de versión).`
    };
  }

  return {
    compatible: true,
    status: 'compatible',
    reasonCode: 'compatible',
    reason: `Compatible con Minecraft ${mcVer} (${loaderDisplayName(targetLoader)}).`
  };
}

export function findIncompatibleEnabledMods<
  T extends Pick<InspectedModMeta, 'name' | 'loaders' | 'mcVersionSpec'> & {
    id: string;
    filename: string;
    enabled: boolean;
  }
>(mods: T[], targetMcVersion: string, targetLoaderRaw: string) {
  return mods
    .filter((m) => m && m.enabled)
    .map((m) => ({
      mod: m,
      compat: evaluateCustomModCompatibility(m, targetMcVersion, targetLoaderRaw)
    }))
    .filter((entry) => !entry.compat.compatible);
}
