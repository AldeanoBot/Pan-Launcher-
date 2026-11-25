import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateDefaultPngSkin,
  mapFabricLoaderItems,
  mapForgeLoaderItems,
  mapMojangManifest,
  mapNeoforgeLoaderItems,
  mapQuiltLoaderItems,
  neoforgeKeys,
  normalizeLoaderId,
  parseMavenVersions,
  parseProfileVersionId,
  requiredJavaForVersion,
} from './panBackend';

test('mapMojangManifest maps release, snapshot, and legacy entries accurately', () => {
  const mapped = mapMojangManifest({
    latest: { release: '26.3', snapshot: '26w14a' },
    versions: [
      { id: '26w14a', type: 'snapshot', releaseTime: '2026-04-01T12:00:00+00:00', sha1: 'aaa' },
      { id: '26.3', type: 'release', releaseTime: '2026-04-10T12:00:00+00:00', sha1: 'bbb' },
      { id: 'b1.7.3', type: 'old_beta', time: '2011-07-08T00:00:00+00:00', sha1: 'ccc' },
      { id: '../invalid', type: 'release' },
    ],
  });

  assert.equal(mapped.length, 3);
  assert.equal(mapped[0].id, '26w14a');
  assert.equal(mapped[0].latestSnapshot, true);
  assert.equal(mapped[0].category, 'snapshot');
  assert.equal(mapped[1].id, '26.3');
  assert.equal(mapped[1].latestRelease, true);
  assert.equal(mapped[2].category, 'beta');
});

test('parseMavenVersions and loader mappers filter compatible builds including Quilt and 26.x NeoForge', () => {
  const forgeXml = `
    <metadata>
      <versioning><versions>
        <version>1.20.1-47.3.0</version>
        <version>1.21.4-54.0.2</version>
        <version>1.21.4-54.1.0</version>
      </versions></versioning>
    </metadata>`;
  assert.deepEqual(parseMavenVersions(forgeXml), ['1.20.1-47.3.0', '1.21.4-54.0.2', '1.21.4-54.1.0']);

  const forgeItems = mapForgeLoaderItems(forgeXml, '1.21.4');
  assert.equal(forgeItems.length, 2);
  assert.equal(forgeItems[0].id, '1.21.4-54.1.0');
  assert.equal(forgeItems[0].loaderVersion, '54.1.0');

  assert.deepEqual(neoforgeKeys('1.21.4'), ['21.4', '1.21.4']);
  assert.deepEqual(neoforgeKeys('26.3'), ['26.3']);
  const neoXml = `<metadata><versioning><versions><version>21.4.80-beta</version><version>21.4.112</version><version>26.3.0.117</version></versions></versioning></metadata>`;
  const neoItems = mapNeoforgeLoaderItems(neoXml, '1.21.4');
  assert.equal(neoItems[0].id, '21.4.112');
  assert.equal(neoItems[0].stable, true);
  assert.equal(neoItems[1].stable, false);
  const neo263 = mapNeoforgeLoaderItems(neoXml, '26.3');
  assert.equal(neo263[0].id, '26.3.0.117');

  const fabricItems = mapFabricLoaderItems(
    [
      { loader: { version: '0.16.9', stable: false }, launcherMeta: { min_java_version: 21 } },
      { loader: { version: '0.16.10', stable: true }, launcherMeta: { min_java_version: 21 } },
    ],
    '1.21.4'
  );
  assert.equal(fabricItems[0].id, '0.16.10');
  assert.equal(fabricItems[0].minJava, 21);

  const quiltItems = mapQuiltLoaderItems(
    [
      { loader: { version: '0.29.0-beta.1' }, launcherMeta: { min_java_version: 21 } },
      { loader: { version: '0.29.1' }, launcherMeta: { min_java_version: 21 } },
    ],
    '1.21.4'
  );
  assert.equal(quiltItems[0].id, '0.29.1');
  assert.equal(quiltItems[0].stable, true);
  assert.equal(quiltItems[1].stable, false);
});

test('requiredJavaForVersion, normalizeLoaderId, and parseProfileVersionId handle all versions and loaders', () => {
  assert.equal(requiredJavaForVersion('26.3'), 25);
  assert.equal(requiredJavaForVersion('26.2'), 25);
  assert.equal(requiredJavaForVersion('1.21.4'), 21);
  assert.equal(requiredJavaForVersion('1.20.5'), 21);
  assert.equal(requiredJavaForVersion('1.20.4'), 17);
  assert.equal(requiredJavaForVersion('1.17.1'), 17);
  assert.equal(requiredJavaForVersion('1.16.5'), 8);
  assert.equal(requiredJavaForVersion('1.12.2'), 8);
  assert.equal(requiredJavaForVersion('1.8.9'), 8);

  assert.equal(normalizeLoaderId('Quilt'), 'quilt');
  assert.equal(normalizeLoaderId('FORGE'), 'forge');
  assert.equal(normalizeLoaderId('unknown'), 'vanilla');

  assert.deepEqual(parseProfileVersionId('fabric-0.20.1-26.3'), {
    mcVersion: '26.3',
    loader: 'fabric',
    loaderVersion: '0.20.1',
  });
  assert.deepEqual(parseProfileVersionId('forge-66.1.9-26.3'), {
    mcVersion: '26.3',
    loader: 'forge',
    loaderVersion: '66.1.9',
  });
  assert.deepEqual(parseProfileVersionId('26.2'), {
    mcVersion: '26.2',
    loader: 'vanilla',
    loaderVersion: null,
  });
});

test('generateDefaultPngSkin emits valid 64x64 RGBA PNG payloads for Steve and Alex', () => {
  const steve = generateDefaultPngSkin('steve');
  const alex = generateDefaultPngSkin('alex');

  assert.equal(steve.model, 'classic');
  assert.equal(alex.model, 'slim');

  for (const skin of [steve, alex]) {
    assert.ok(skin.dataUrl.startsWith('data:image/png;base64,'));
    const raw = Buffer.from(skin.dataUrl.slice('data:image/png;base64,'.length), 'base64');
    assert.deepEqual(raw.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(raw.readUInt32BE(16), 64);
    assert.equal(raw.readUInt32BE(20), 64);
  }
});
