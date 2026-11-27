import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  sanitizeJarFilename,
  matchesMcVersionRange,
  extractModMetadataFromEntries,
  evaluateCustomModCompatibility,
  findIncompatibleEnabledMods,
} from './modCompatibility.ts';

function buildStoredJarBuffer(entries: Record<string, string>): ArrayBuffer {
  // Minimal standard ZIP builder (STORE method = 0) to verify readZipTargetEntries in mod-inspector.js
  const chunks: Buffer[] = [];
  const cdRecords: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10); // STORE
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);

    chunks.push(local, dataBuf);
    cdRecords.push(cd);
    offset += local.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(cdRecords);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(cdRecords.length, 8);
  eocd.writeUInt16LE(cdRecords.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const full = Buffer.concat([...chunks, cdBuf, eocd]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
}

describe('modCompatibility', () => {
  it('sanitizes arbitrary uploaded .jar filenames safely', () => {
    assert.equal(sanitizeJarFilename('../../evil/Sodium Fabric!.jar'), 'Sodium_Fabric_.jar');
    assert.equal(sanitizeJarFilename('custom_mod'), 'custom_mod.jar');
    assert.equal(sanitizeJarFilename('...'), 'custom-mod.jar');
  });

  it('evaluates Fabric/Semver and Maven Minecraft version ranges accurately', () => {
    assert.equal(matchesMcVersionRange('1.21.4', '~1.21.4'), true);
    assert.equal(matchesMcVersionRange('1.21.5', '~1.21.4'), true);
    assert.equal(matchesMcVersionRange('1.22.0', '~1.21.4'), false);
    assert.equal(matchesMcVersionRange('1.21.4', '>=1.21.3 <=1.21.4'), true);
    assert.equal(matchesMcVersionRange('1.21.1', '>=1.21.3 <=1.21.4'), false);
    assert.equal(matchesMcVersionRange('1.20.4', '1.20.x'), true);
    assert.equal(matchesMcVersionRange('1.21.4', '1.20.x'), false);
    assert.equal(matchesMcVersionRange('1.21.4', '[1.21.1,1.22)'), true);
    assert.equal(matchesMcVersionRange('1.20.1', '[1.21.1,1.22)'), false);
    assert.equal(matchesMcVersionRange('1.21.4', '[1.21.4]'), true);
    assert.equal(matchesMcVersionRange('1.21.3', '[1.21.4]'), false);
    assert.equal(matchesMcVersionRange('1.21.4', ['1.21.3', '1.21.4']), true);
  });

  it('extracts metadata from Fabric, Forge TOML, NeoForge TOML, Quilt, mcmod.info, and filename fallback', () => {
    const fabricMeta = extractModMetadataFromEntries({
      filename: 'sodium-fabric.jar',
      fabricJson: JSON.stringify({
        id: 'sodium',
        name: 'Sodium',
        version: '0.6.5',
        depends: { minecraft: '~1.21.4' }
      })
    });
    assert.equal(fabricMeta.name, 'Sodium');
    assert.deepEqual(fabricMeta.loaders, ['fabric']);
    assert.equal(fabricMeta.mcVersionSpec, '~1.21.4');

    const neoforgeMeta = extractModMetadataFromEntries({
      filename: 'iris-neoforge.jar',
      neoforgeToml: [
        'modLoader="javafml"',
        '[[mods]]',
        'modId="iris"',
        'version="1.8.0"',
        'displayName="Iris Shaders"',
        '[[dependencies.iris]]',
        'modId="minecraft"',
        'versionRange="[1.21.1,1.21.5)"'
      ].join('\n')
    });
    assert.equal(neoforgeMeta.modId, 'iris');
    assert.equal(neoforgeMeta.name, 'Iris Shaders');
    assert.deepEqual(neoforgeMeta.loaders, ['neoforge']);
    assert.equal(neoforgeMeta.mcVersionSpec, '[1.21.1,1.21.5)');

    const legacyMeta = extractModMetadataFromEntries({
      filename: 'optifine_1.12.2.jar',
      mcmodInfo: JSON.stringify([{ modid: 'betterfps', name: 'BetterFps', version: '1.4.8', mcversion: '1.12.2' }])
    });
    assert.equal(legacyMeta.name, 'BetterFps');
    assert.deepEqual(legacyMeta.loaders, ['forge']);
    assert.equal(legacyMeta.mcVersionSpec, '1.12.2');

    const fallbackMeta = extractModMetadataFromEntries({
      filename: 'ReplayMod-1.20.1-fabric.jar'
    });
    assert.deepEqual(fallbackMeta.loaders, ['fabric']);
    assert.equal(fallbackMeta.mcVersionSpec, '1.20.1');
  });

  it('detects loader conflicts, version mismatches, and Vanilla mode warnings', () => {
    const mod = { name: 'Iris Shaders', loaders: ['fabric' as const], mcVersionSpec: '1.21.4' };

    assert.equal(evaluateCustomModCompatibility(mod, '1.21.4', 'fabric').compatible, true);
    assert.equal(evaluateCustomModCompatibility(mod, '1.21.4', 'quilt').compatible, true);

    const onVanilla = evaluateCustomModCompatibility(mod, '1.21.4', 'vanilla');
    assert.equal(onVanilla.compatible, false);
    assert.equal(onVanilla.reasonCode, 'vanilla-loader');

    const onForge = evaluateCustomModCompatibility(mod, '1.21.4', 'forge');
    assert.equal(onForge.compatible, false);
    assert.equal(onForge.reasonCode, 'wrong-loader');

    const onWrongMc = evaluateCustomModCompatibility(mod, '1.20.1', 'fabric');
    assert.equal(onWrongMc.compatible, false);
    assert.equal(onWrongMc.reasonCode, 'wrong-version');
  });

  it('lists enabled incompatible mods for launch pre-check', () => {
    const items = [
      { id: '1', filename: 'ok.jar', name: 'OK Mod', loaders: ['fabric' as const], mcVersionSpec: '1.21.4', enabled: true },
      { id: '2', filename: 'bad.jar', name: 'Old Forge Mod', loaders: ['forge' as const], mcVersionSpec: '1.19.4', enabled: true },
      { id: '3', filename: 'off.jar', name: 'Disabled Bad Mod', loaders: ['forge' as const], mcVersionSpec: '1.8.9', enabled: false }
    ];
    const conflicts = findIncompatibleEnabledMods(items, '1.21.4', 'fabric');
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].mod.id, '2');
  });

  it('browser public/js/mod-inspector.js inspects real ZIP/JAR buffers identically', async () => {
    const code = fs.readFileSync(path.resolve('public/js/mod-inspector.js'), 'utf8');
    const sandbox: any = {
      window: {},
      TextDecoder,
      Blob,
      Response,
      DecompressionStream: globalThis.DecompressionStream
    };
    vm.runInNewContext(code, sandbox);
    const inspector = sandbox.window.Nexus.modInspector;
    assert.ok(inspector);

    const jarBuf = buildStoredJarBuffer({
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n',
      'fabric.mod.json': JSON.stringify({
        id: 'appleskin',
        name: 'AppleSkin',
        version: '3.0.6',
        depends: { minecraft: '~1.21.4' }
      })
    });
    const inspected = await inspector.inspectJarBuffer(jarBuf, 'appleskin-fabric-3.0.6.jar');
    assert.equal(inspected.name, 'AppleSkin');
    assert.equal(inspected.version, '3.0.6');
    assert.equal(inspected.mcVersionSpec, '~1.21.4');
    assert.equal(inspector.evaluateCustomModCompatibility(inspected, '1.21.4', 'fabric').compatible, true);
    assert.equal(inspector.evaluateCustomModCompatibility(inspected, '1.16.5', 'fabric').compatible, false);
  });
});
