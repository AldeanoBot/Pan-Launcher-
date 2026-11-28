import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { formatTemplate, normalizeLanguage } from './i18nLogic';
import {
  applyResourcePacksToOptionsTxt,
  buildOptionsResourcePacksLine,
  evaluateResourcePackCompatibility,
  extractMcmetaInfo,
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

test('resourcePackLogic parses pack.mcmeta formats, ranges, and formatting codes', () => {
  const legacy = extractMcmetaInfo(
    JSON.stringify({ pack: { pack_format: 15, description: '§6PvP §fClear Sky\n16x' } }),
    'PvP16x.zip'
  );
  assert.equal(legacy.hasMcmeta, true);
  assert.equal(legacy.packFormat, 15);
  assert.equal(legacy.minFormat, 15);
  assert.equal(legacy.maxFormat, 15);
  assert.equal(legacy.description, 'PvP Clear Sky 16x');

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

test('resourcePackLogic evaluates Minecraft version compatibility and generates options.txt entries', () => {
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

  assert.equal(
    buildOptionsResourcePacksLine(['Pack A.zip', 'Pack B.zip'], '1.21.4'),
    'resourcePacks:["vanilla","file/Pack A.zip","file/Pack B.zip"]'
  );
  assert.equal(
    buildOptionsResourcePacksLine(['OldPvP.zip'], '1.8.9'),
    'resourcePacks:["OldPvP.zip"]'
  );
  assert.equal(
    applyResourcePacksToOptionsTxt('maxFps:260\nresourcePacks:["vanilla"]', ['Pack.zip'], '1.21.4'),
    'maxFps:260\nresourcePacks:["vanilla","file/Pack.zip"]'
  );
});

test('public/js/resourcepack-inspector.js exports findIncompatibleEnabledPacks, sanitizePackFilename alias, and strips BOM', () => {
  const code = fs.readFileSync(path.resolve(process.cwd(), 'public/js/resourcepack-inspector.js'), 'utf8');
  const context: Record<string, unknown> = {
    window: { Nexus: {} },
    TextDecoder
  };
  (context.window as Record<string, unknown>).window = context.window;
  vm.runInNewContext(code, context);
  const inspector = ((context.window as Record<string, unknown>).Nexus as Record<string, unknown>).resourcePackInspector as {
    sanitizeResourcePackFilename: (n: string) => string;
    sanitizePackFilename: (n: string) => string;
    extractMcmetaInfo: (raw: string | null, name: string) => Record<string, unknown>;
    findIncompatibleEnabledPacks: (packs: Array<Record<string, unknown>>, mcVersion: string) => Array<Record<string, unknown>>;
  };

  assert.equal(typeof inspector.findIncompatibleEnabledPacks, 'function');
  assert.equal(inspector.sanitizePackFilename('PvP 16x Blue.zip'), 'PvP 16x Blue.zip');
  const bomPack = inspector.extractMcmetaInfo(
    '\uFEFF' + JSON.stringify({ pack: { pack_format: 46, description: '§bBlue Sky' } }),
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
});

test('public/js/views/versions.js avoids inline style attributes', () => {
  const body = fs.readFileSync(path.resolve(process.cwd(), 'public/js/views/versions.js'), 'utf8');
  assert.doesNotMatch(body, /\sstyle\s*=\s*["']/, 'Views should use CSS classes instead of inline style attributes');
});

