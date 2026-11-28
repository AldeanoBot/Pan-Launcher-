import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Blob } from 'node:buffer';
import JSZip from 'jszip';
import { formatTemplate, normalizeLanguage } from './i18nLogic';
import {
  applyResourcePacksToOptionsTxt,
  buildOptionsIncompatiblePacksLine,
  buildOptionsResourcePacksLine,
  evaluateResourcePackCompatibility,
  extractMcmetaInfo,
  normalizeResourcePackZipBuffer,
  resourcePackFormatForMcVersion,
  sanitizeResourcePackFilename,
  stripMcFormatting
} from './resourcePackLogic';

test('i18nLogic normalizes language codes and interpolates templates safely', () => {
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('EN-US'), 'en');
  assert.equal(normalizeLanguage('es'), 'es');
  assert.equal(normalizeLanguage('fr'), 'es');
  assert.equal(normalizeLanguage(null), 'es');

  assert.equal(
    formatTemplate('Compatible with Minecraft {version} ({loader}).', { version: '1.21.4', loader: 'Fabric' }),
    'Compatible with Minecraft 1.21.4 (Fabric).'
  );
  assert.equal(formatTemplate('Step {n} of {total}', { n: 1, total: 9 }), 'Step 1 of 9');
});

test('public/js/i18n.js maintains strict ES/EN key and placeholder parity', () => {
  const code = fs.readFileSync(path.resolve(process.cwd(), 'public/js/i18n.js'), 'utf8');
  const context: Record<string, unknown> = {
    window: { Nexus: {}, location: { search: '' }, localStorage: { getItem: () => null, setItem: () => {} } },
    document: { documentElement: { lang: 'es' }, querySelectorAll: () => [], getElementById: () => null }
  };
  (context.window as Record<string, unknown>).window = context.window;
  vm.runInNewContext(code, context);
  const i18n = ((context.window as Record<string, unknown>).Nexus as Record<string, unknown>).i18n as {
    DICTS: { es: Record<string, string>; en: Record<string, string> };
    t: (key: string, vars?: Record<string, unknown>) => string;
  };
  const esKeys = Object.keys(i18n.DICTS.es).sort();
  const enKeys = Object.keys(i18n.DICTS.en).sort();
  assert.deepEqual(enKeys, esKeys, 'ES and EN dictionaries must have identical key sets');

  for (const key of esKeys) {
    const esVars = [...i18n.DICTS.es[key].matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    const enVars = [...i18n.DICTS.en[key].matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(enVars, esVars, `Interpolation placeholders must match for key "${key}"`);
  }
});

test('public/js contains zero banned native dialogs or internal runtime leakage', () => {
  const jsDir = path.resolve(process.cwd(), 'public/js');
  const walk = (dir: string): string[] => {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
  };
  for (const file of walk(jsDir)) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /window\.(alert|confirm|open)\s*\(/, `Banned browser dialog in ${file}`);
    assert.doesNotMatch(body, /Node\.js/, `Internal runtime name leaked in ${file}`);
  }
});

test('resourcePackLogic sanitizes filenames against traversal and ADS characters', () => {
  assert.equal(sanitizeResourcePackFilename('../../evil:pack.zip'), 'evil_pack.zip');
  assert.equal(sanitizeResourcePackFilename('...hidden'), 'hidden.zip');
  assert.equal(sanitizeResourcePackFilename('PvP 16x Blue.zip'), 'PvP 16x Blue.zip');
  assert.equal(sanitizeResourcePackFilename('C:\\Temp\\Bad\\Pack'), 'Pack.zip');
});

test('resourcePackLogic parses lenient pack.mcmeta formats, ranges, and formatting codes', () => {
  const legacy = extractMcmetaInfo(
    JSON.stringify({ pack: { pack_format: 15, description: '§6PvP §fClear Sky\n16x' } }),
    'PvP16x.zip'
  );
  assert.equal(legacy.hasMcmeta, true);
  assert.equal(legacy.packFormat, 15);
  assert.equal(legacy.minFormat, 15);
  assert.equal(legacy.maxFormat, 15);
  assert.equal(legacy.description, 'PvP Clear Sky 16x');

  const lenient = extractMcmetaInfo(
    '\uFEFF{"pack":{"pack_format":"15","description":"Lenient Pack",},}',
    'Lenient.zip'
  );
  assert.equal(lenient.hasMcmeta, true);
  assert.equal(lenient.packFormat, 15);
  assert.equal(lenient.description, 'Lenient Pack');

  const ranged = extractMcmetaInfo(
    JSON.stringify({
      pack: {
        pack_format: 34,
        supported_formats: { min_inclusive: 15, max_inclusive: 46 },
        description: { text: 'Multi ', extra: [{ text: 'Pack §aOK' }] }
      }
    }),
    'Multi.zip'
  );
  assert.equal(ranged.minFormat, 15);
  assert.equal(ranged.maxFormat, 46);
  assert.equal(ranged.description, 'Multi Pack OK');
  assert.equal(stripMcFormatting('§cAlert §rText'), 'Alert Text');

  const calverPack = extractMcmetaInfo(
    JSON.stringify({ pack: { pack_format: 75, min_format: 46, max_format: [84, 0], description: '26.x' } }),
    'Modern.zip'
  );
  assert.equal(calverPack.minFormat, 46);
  assert.equal(calverPack.maxFormat, 84);
});

test('resourcePackLogic evaluates compatibility (including shader packs) and writes options.txt lines', () => {
  assert.equal(resourcePackFormatForMcVersion('1.8.9'), 1);
  assert.equal(resourcePackFormatForMcVersion('1.20.1'), 15);
  assert.equal(resourcePackFormatForMcVersion('1.21.4'), 46);
  assert.equal(resourcePackFormatForMcVersion('26.3'), 84);

  const pack1214 = extractMcmetaInfo(
    JSON.stringify({ pack: { pack_format: 46, description: '1.21.4 pack' } }),
    'Pack1214.zip'
  );
  assert.equal(evaluateResourcePackCompatibility(pack1214, '1.21.4').compatible, true);
  assert.equal(evaluateResourcePackCompatibility(pack1214, '1.20.1').reasonCode, 'format-mismatch');

  const noMeta = extractMcmetaInfo(null, 'broken.zip');
  assert.equal(evaluateResourcePackCompatibility(noMeta, '1.21.4').reasonCode, 'no-mcmeta');

  const shaderMeta = { ...noMeta, isShaderPack: true };
  assert.equal(evaluateResourcePackCompatibility(shaderMeta, '1.21.4').reasonCode, 'shader-pack');
  assert.equal(evaluateResourcePackCompatibility(shaderMeta, '1.21.4').compatible, false);

  assert.equal(
    buildOptionsResourcePacksLine(['Pack A.zip', 'Pack B.zip'], '1.21.4'),
    'resourcePacks:["vanilla","file/Pack A.zip","file/Pack B.zip"]'
  );
  assert.equal(
    buildOptionsResourcePacksLine(['OldPvP.zip'], '1.8.9'),
    'resourcePacks:["OldPvP.zip"]'
  );
  assert.equal(
    buildOptionsIncompatiblePacksLine(['Pack A.zip', 'Pack B.zip'], '1.21.4'),
    'incompatibleResourcePacks:["file/Pack A.zip","file/Pack B.zip"]'
  );
  assert.equal(
    buildOptionsIncompatiblePacksLine(['OldPvP.zip'], '1.8.9'),
    'incompatibleResourcePacks:[]'
  );

  const merged = applyResourcePacksToOptionsTxt(
    'maxFps:260\nresourcePacks:["vanilla"]\nincompatibleResourcePacks:[]\nresourcePacks:["duplicate"]',
    ['OldPvP.zip', 'Pack1214.zip'],
    '1.21.4',
    ['OldPvP.zip']
  );
  assert.equal(
    merged,
    'maxFps:260\nresourcePacks:["vanilla","file/OldPvP.zip","file/Pack1214.zip"]\nincompatibleResourcePacks:["file/OldPvP.zip"]'
  );
});

test('normalizeResourcePackZipBuffer flattens single-folder nested archives and strips __MACOSX', async () => {
  const nested = new JSZip();
  nested.file('CoolPvP/pack.mcmeta', JSON.stringify({ pack: { pack_format: 1, description: '§6Nested 1.8.9' } }));
  nested.file('CoolPvP/assets/minecraft/textures/gui/title.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]));
  nested.file('__MACOSX/CoolPvP/._pack.mcmeta', Buffer.from([0, 5, 22, 7]));
  nested.file('CoolPvP/.DS_Store', Buffer.from([1, 2, 3, 4]));
  const nestedBuf = await nested.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const norm = normalizeResourcePackZipBuffer(nestedBuf);
  assert.equal(norm.normalized, true);
  assert.equal(norm.nestedRoot, 'CoolPvP');

  const secondPass = normalizeResourcePackZipBuffer(norm.buffer);
  assert.equal(secondPass.normalized, false);

  const parsed = await JSZip.loadAsync(norm.buffer);
  assert.ok(parsed.file('pack.mcmeta'), 'Flattened ZIP must place pack.mcmeta at archive root');
  assert.ok(parsed.file('assets/minecraft/textures/gui/title.png'), 'Assets must keep relative path at root');
  assert.equal(parsed.file('CoolPvP/pack.mcmeta'), null);
  assert.equal(parsed.file('__MACOSX/CoolPvP/._pack.mcmeta'), null);

  const metaText = await parsed.file('pack.mcmeta')!.async('string');
  assert.match(metaText, /Nested 1\.8\.9/);

  const flat = new JSZip();
  flat.file('pack.mcmeta', JSON.stringify({ pack: { pack_format: 46, description: 'Flat' } }));
  const flatBuf = await flat.generateAsync({ type: 'nodebuffer' });
  const flatNorm = normalizeResourcePackZipBuffer(flatBuf);
  assert.equal(flatNorm.normalized, false);
});

test('public/js/resourcepack-inspector.js normalizes nested zips, detects shader packs, and handles BOM', async () => {
  const code = fs.readFileSync(path.resolve(process.cwd(), 'public/js/resourcepack-inspector.js'), 'utf8');
  const context: Record<string, unknown> = {
    window: { Nexus: {} },
    TextDecoder,
    TextEncoder,
    Blob,
    DecompressionStream: globalThis.DecompressionStream,
    Response: globalThis.Response,
    FileReader: undefined
  };
  (context.window as Record<string, unknown>).window = context.window;
  vm.runInNewContext(code, context);
  const inspector = ((context.window as Record<string, unknown>).Nexus as Record<string, unknown>).resourcePackInspector as {
    sanitizeResourcePackFilename: (n: string) => string;
    sanitizePackFilename: (n: string) => string;
    extractMcmetaInfo: (raw: string | null, name: string) => Record<string, unknown>;
    normalizeResourcePackBuffer: (ab: ArrayBuffer) => { buffer: ArrayBuffer; normalized: boolean; nestedRoot: string | null };
    inspectResourcePackBuffer: (ab: ArrayBuffer, name: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    findIncompatibleEnabledPacks: (packs: Array<Record<string, unknown>>, mcVersion: string) => Array<Record<string, unknown>>;
    applyResourcePacksToOptionsTxt: (txt: string, filenames: string[], mcVersion: string, incompat?: string[]) => string;
  };

  assert.equal(typeof inspector.findIncompatibleEnabledPacks, 'function');
  assert.equal(inspector.sanitizePackFilename('PvP 16x Blue.zip'), 'PvP 16x Blue.zip');
  const bomPack = inspector.extractMcmetaInfo(
    '\uFEFF{"pack":{"pack_format":"46","description":"§bBlue Sky",}}',
    'PvP 16x Blue.zip'
  );
  assert.equal(bomPack.hasMcmeta, true);
  assert.equal(bomPack.packFormat, 46);
  assert.equal(bomPack.description, 'Blue Sky');

  const enabledPack = { ...bomPack, enabled: true };
  const disabledPack = { ...bomPack, enabled: false };
  assert.equal(inspector.findIncompatibleEnabledPacks([enabledPack, disabledPack], '1.21.4').length, 0);
  const conflicts = inspector.findIncompatibleEnabledPacks([enabledPack, disabledPack], '1.8.9');
  assert.equal(conflicts.length, 1);
  assert.equal((conflicts[0].compat as Record<string, unknown>).status, 'incompatible');

  // Test normalizeResourcePackBuffer + inspectResourcePackBuffer on nested zip
  const nested = new JSZip();
  nested.file('Wrapper/pack.mcmeta', JSON.stringify({ pack: { pack_format: 1, description: '§ePvP Wrapper' } }));
  nested.file('__MACOSX/Wrapper/._pack.mcmeta', Buffer.from([1, 2, 3]));
  const nestedBytes = await nested.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const nestedAb = new Uint8Array(nestedBytes).buffer;
  const norm = inspector.normalizeResourcePackBuffer(nestedAb);
  assert.equal(norm.normalized, true);
  assert.equal(norm.nestedRoot, 'Wrapper');

  const inspected = await inspector.inspectResourcePackBuffer(norm.buffer, 'WrapperPack.zip', { normalized: norm.normalized });
  assert.equal(inspected.hasMcmeta, true);
  assert.equal(inspected.packFormat, 1);
  assert.equal(inspected.description, 'PvP Wrapper');
  assert.equal(inspected.normalized, true);

  // Test shaderpack detection
  const shader = new JSZip();
  shader.file('shaders/gbuffers_terrain.fsh', 'void main() {}');
  const shaderBytes = await shader.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const shaderAb = new Uint8Array(shaderBytes).buffer;
  const shaderInspected = await inspector.inspectResourcePackBuffer(shaderAb, 'ComplementaryShader.zip');
  assert.equal(shaderInspected.hasMcmeta, false);
  assert.equal(shaderInspected.isShaderPack, true);

  // Test incompatibleResourcePacks serialization in options.txt
  const optsOut = inspector.applyResourcePacksToOptionsTxt(
    'lang:es_es\nresourcePacks:["vanilla"]\nincompatibleResourcePacks:[]',
    ['WrapperPack.zip'],
    '1.21.4',
    ['WrapperPack.zip']
  );
  assert.equal(
    optsOut,
    'lang:es_es\nresourcePacks:["vanilla","file/WrapperPack.zip"]\nincompatibleResourcePacks:["file/WrapperPack.zip"]'
  );
});

test('public/js/views/versions.js avoids inline style attributes', () => {
  const body = fs.readFileSync(path.resolve(process.cwd(), 'public/js/views/versions.js'), 'utf8');
  assert.doesNotMatch(body, /\sstyle\s*=\s*["']/, 'Views should use CSS classes instead of inline style attributes');
});

