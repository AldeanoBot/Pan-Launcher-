import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateDefaultPngSkin,
  mapFabricLoaderItems,
  mapForgeLoaderItems,
  mapMojangManifest,
  mapNeoforgeLoaderItems,
  neoforgeKeys,
  parseMavenVersions,
} from './panBackend';

test('mapMojangManifest maps release, snapshot, and legacy entries accurately', () => {
  const mapped = mapMojangManifest({
    latest: { release: '1.21.4', snapshot: '25w06a' },
    versions: [
      { id: '25w06a', type: 'snapshot', releaseTime: '2025-02-05T12:00:00+00:00', sha1: 'aaa' },
      { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T12:00:00+00:00', sha1: 'bbb' },
      { id: 'b1.7.3', type: 'old_beta', time: '2011-07-08T00:00:00+00:00', sha1: 'ccc' },
      { id: '../invalid', type: 'release' },
    ],
  });

  assert.equal(mapped.length, 3);
  assert.equal(mapped[0].id, '25w06a');
  assert.equal(mapped[0].latestSnapshot, true);
  assert.equal(mapped[0].category, 'snapshot');
  assert.equal(mapped[1].id, '1.21.4');
  assert.equal(mapped[1].latestRelease, true);
  assert.equal(mapped[2].category, 'beta');
});

test('parseMavenVersions and loader mappers filter compatible builds', () => {
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
  const neoXml = `<metadata><versioning><versions><version>21.4.80-beta</version><version>21.4.112</version></versions></versioning></metadata>`;
  const neoItems = mapNeoforgeLoaderItems(neoXml, '1.21.4');
  assert.equal(neoItems[0].id, '21.4.112');
  assert.equal(neoItems[0].stable, true);
  assert.equal(neoItems[1].stable, false);

  const fabricItems = mapFabricLoaderItems(
    [
      { loader: { version: '0.16.9', stable: false }, launcherMeta: { min_java_version: 21 } },
      { loader: { version: '0.16.10', stable: true }, launcherMeta: { min_java_version: 21 } },
    ],
    '1.21.4'
  );
  assert.equal(fabricItems[0].id, '0.16.10');
  assert.equal(fabricItems[0].minJava, 21);
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
