import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUnixLocalServerPy,
  buildUnixSelfContainedSh,
  buildWindowsExe,
  buildWindowsSelfContainedBat,
} from './pcPackager';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

test('buildWindowsExe injects valid .panpkg PE section and recomputes PE CheckSum cleanly', () => {
  const stubPath = path.resolve(process.cwd(), 'native/pan-stub.exe');
  assert.ok(fs.existsSync(stubPath), 'native/pan-stub.exe must exist');
  const stubBuf = fs.readFileSync(stubPath);
  const mockZip = Buffer.from('PK\x03\x04MOCK_DIST_ZIP_CONTENT', 'binary');

  const exeBuf = buildWindowsExe(stubBuf, mockZip, '2.2.0');

  assert.equal(exeBuf.subarray(0, 2).toString('ascii'), 'MZ');
  const peOffset = exeBuf.readUInt32LE(0x3c);
  assert.equal(exeBuf.toString('ascii', peOffset, peOffset + 4), 'PE\0\0');

  const numSections = exeBuf.readUInt16LE(peOffset + 6);
  const stubSections = stubBuf.readUInt16LE(peOffset + 6);
  assert.equal(numSections, stubSections + 1);

  const optStart = peOffset + 24;
  const checkSum = exeBuf.readUInt32LE(optStart + 64);
  assert.ok(checkSum !== 0, 'PE OptionalHeader.CheckSum must be non-zero');

  const optSize = exeBuf.readUInt16LE(peOffset + 20);
  const lastSecOff = optStart + optSize + (numSections - 1) * 40;
  assert.equal(exeBuf.toString('ascii', lastSecOff, lastSecOff + 7), '.panpkg');

  const vSize = exeBuf.readUInt32LE(lastSecOff + 8);
  const rawPtr = exeBuf.readUInt32LE(lastSecOff + 20);
  assert.equal(vSize, mockZip.length);
  assert.ok(rawPtr >= stubBuf.length);

  const extractedZip = exeBuf.subarray(rawPtr, rawPtr + vSize);
  assert.ok(Buffer.compare(extractedZip, mockZip) === 0, 'Extracted .panpkg bytes must match input zip');
});

test('buildWindowsSelfContainedBat embeds hardened run.ps1, server.ps1, launch.ps1, resourcepacks, and zip payload', () => {
  const fakeZipB64 = Buffer.from('PK_MOCK_ZIP').toString('base64');
  const bat = buildWindowsSelfContainedBat(fakeZipB64, '2.0.1');

  assert.match(bat, /@echo off/);
  assert.match(bat, /set "PAN_SELF=%~f0"/);
  assert.match(bat, /::PAN_PS_B64::/);
  assert.match(bat, /::PAN_ZIP_B64::/);
  assert.ok(bat.includes(fakeZipB64));
  assert.ok(!bat.includes('ais-dev'), 'Must never embed protected AI Studio dev URL');

  const marker = '::PAN_PS_B64::\r\n';
  const start = bat.indexOf(marker) + marker.length;
  const end = bat.indexOf('\r\n::PAN_ZIP_B64::');
  const decodedRunPs1 = Buffer.from(bat.slice(start, end), 'base64').toString('utf8');
  assert.match(decodedRunPs1, /http:\/\/127\.0\.0\.1:\$port\//);
  assert.match(decodedRunPs1, /2\.0\.1/);
  assert.match(decodedRunPs1, /--app=\$url/);
  assert.match(decodedRunPs1, /launch\.ps1/);

  const b64Matches = [...decodedRunPs1.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)];
  assert.equal(b64Matches.length, 3, 'run.ps1 must embed server.ps1, launch.ps1, and PanLauncherApp.cs');

  const serverPs1 = Buffer.from(b64Matches[0][1], 'base64').toString('utf8');
  assert.match(serverPs1, /canLaunchJava":true/);
  assert.match(serverPs1, /api\/local\/launch/);
  assert.match(serverPs1, /api\/local\/stop/);
  assert.match(serverPs1, /api\/local\/status/);
  assert.match(serverPs1, /api\/local\/hide-ui/);
  assert.match(serverPs1, /api\/local\/shutdown/);
  assert.match(serverPs1, /api\/local\/mods/);
  assert.match(serverPs1, /api\/local\/mods\/upload/);
  assert.match(serverPs1, /api\/local\/mods\/delete/);
  assert.match(serverPs1, /api\/local\/mods\/open-folder/);
  assert.match(serverPs1, /api\/local\/resourcepacks/);
  assert.match(serverPs1, /api\/local\/resourcepacks\/file/);
  assert.match(serverPs1, /api\/local\/resourcepacks\/upload/);
  assert.match(serverPs1, /api\/local\/resourcepacks\/delete/);
  assert.match(serverPs1, /api\/local\/resourcepacks\/open-folder/);
  assert.match(serverPs1, /Test-IsLoopbackOrigin/);
  assert.match(serverPs1, /Test-BlockedIpAddress/);
  assert.doesNotMatch(serverPs1, /Access-Control-Allow-Origin.*'\*'/);
  assert.match(serverPs1, /api\/mc\/ping/);
  assert.match(serverPs1, /api\/pc\/download-app/);
  assert.match(serverPs1, /Resolve-LoaderCatalog/);
  assert.match(serverPs1, /Start-LaunchWorker/);
  assert.match(serverPs1, /KeepAlive = \$false/);
  assert.match(serverPs1, /try \{ \$res\.StatusCode = 500 \} catch \{\}/);

  const launchPs1 = Buffer.from(b64Matches[1][1], 'base64').toString('utf8');
  assert.match(launchPs1, /piston-meta\.mojang\.com\/mc\/game\/version_manifest_v2\.json/);
  assert.match(launchPs1, /api\.adoptium\.net\/v3\/binary\/latest/);
  assert.match(launchPs1, /meta\.fabricmc\.net\/v2\/versions\/loader/);
  assert.match(launchPs1, /meta\.quiltmc\.org\/v3\/versions\/loader/);
  assert.match(launchPs1, /maven\.minecraftforge\.net\/net\/minecraftforge\/forge/);
  assert.match(launchPs1, /maven\.neoforged\.net\/releases\/net\/neoforged\/neoforge/);
  assert.match(launchPs1, /launcher_profiles\.json/);
  assert.match(launchPs1, /natives-windows-\(arm64\|x86\)/);
  assert.match(launchPs1, /api\.modrinth\.com\/v2\/project/);
  assert.match(launchPs1, /fabric-api/);
  assert.match(launchPs1, /version_type -eq "release"/);
  assert.match(launchPs1, /\$javaMajor -ge 21/);
  assert.match(launchPs1, /-XX:\+UseG1GC/);
  assert.match(launchPs1, /-XX:\+ExplicitGCInvokesConcurrent/);
  assert.doesNotMatch(launchPs1, /UseCompactObjectHeaders/);
  assert.doesNotMatch(launchPs1, /DisableExplicitGC/);
  assert.match(launchPs1, /Merge-OptionsTxt/);
  assert.match(launchPs1, /Bootstrap-SharedState/);
  assert.match(launchPs1, /Sync-SharedFileNewest/);
  assert.match(launchPs1, /Link-SharedDirectory/);
  assert.match(launchPs1, /Sync-InstanceBackToShared/);
  assert.match(launchPs1, /servers\.dat/);
  assert.match(launchPs1, /screenshots/);
  assert.match(launchPs1, /resourcepacks/);
  assert.match(launchPs1, /Open-PanUiWindow/);
  assert.match(launchPs1, /javaw\.exe/);
  assert.match(launchPs1, /--quickPlayMultiplayer/);
  assert.match(launchPs1, /dependency_type -eq "required"/);
  assert.match(launchPs1, /TotalPhysicalMemory/);
  assert.match(launchPs1, /Find-CrashTailSafe/);
  assert.match(launchPs1, /pan-custom-mods\.json/);
  assert.match(launchPs1, /customModFiles/);
  assert.match(launchPs1, /incompatibleResourcePacks:\[\]/);
  assert.match(launchPs1, /sharedOptPath/);
  assert.ok(!/"\$\{(auth_|natives_|classpath|launcher_|version_|game_|assets_)/.test(launchPs1), 'Must use single quotes for Mojang template tokens in PowerShell');

  const panAppCs = Buffer.from(b64Matches[2][1], 'base64').toString('utf8');
  assert.match(panAppCs, /using Microsoft\.Web\.WebView2\.WinForms;/);
  assert.match(panAppCs, /WindowCloseRequested/);
  assert.match(panAppCs, /http:\/\/127\.0\.0\.1:41735\//);
  assert.match(decodedRunPs1, /Pan-launcher\.exe/);
  assert.match(decodedRunPs1, /csc\.exe/);
  assert.match(decodedRunPs1, /Pan-launcher\.lnk/);
});

test('buildUnixSelfContainedSh embeds hardened Python 3 backend with resourcepacks, CORS, and SSRF protection', () => {
  const fakeZipB64 = Buffer.from('PK_MOCK_ZIP').toString('base64');
  const sh = buildUnixSelfContainedSh(fakeZipB64, '2.0.1');

  assert.match(sh, /^#!\/usr\/bin\/env bash/);
  assert.match(sh, /127\.0\.0\.1/);
  assert.match(sh, /__PAN_SERVER_PY_B64__/);
  assert.match(sh, /__PAN_ZIP_B64__/);
  assert.ok(sh.includes(fakeZipB64));

  const serverPy = buildUnixLocalServerPy();
  assert.match(serverPy, /"canLaunchJava": True/);
  assert.match(serverPy, /api\/local\/launch/);
  assert.match(serverPy, /api\/local\/stop/);
  assert.match(serverPy, /api\/local\/hide-ui/);
  assert.match(serverPy, /api\/local\/status/);
  assert.match(serverPy, /api\/local\/shutdown/);
  assert.match(serverPy, /api\/local\/mods/);
  assert.match(serverPy, /api\/local\/mods\/upload/);
  assert.match(serverPy, /api\/local\/mods\/delete/);
  assert.match(serverPy, /api\/local\/mods\/open-folder/);
  assert.match(serverPy, /api\/local\/resourcepacks/);
  assert.match(serverPy, /api\/local\/resourcepacks\/file/);
  assert.match(serverPy, /api\/local\/resourcepacks\/upload/);
  assert.match(serverPy, /api\/local\/resourcepacks\/delete/);
  assert.match(serverPy, /api\/local\/resourcepacks\/open-folder/);
  assert.match(serverPy, /_check_origin/);
  assert.match(serverPy, /is_blocked_ip/);
  assert.doesNotMatch(serverPy, /"Access-Control-Allow-Origin", "\*"/);
  assert.match(serverPy, /pan-custom-mods\.json/);
  assert.match(serverPy, /customModFiles/);
  assert.match(serverPy, /meta\.quiltmc\.org\/v3\/versions\/loader/);
  assert.match(serverPy, /maven\.minecraftforge\.net\/net\/minecraftforge\/forge/);
  assert.match(serverPy, /api\.adoptium\.net\/v3\/binary\/latest/);
  assert.match(serverPy, /-XX:\+ExplicitGCInvokesConcurrent/);
  assert.doesNotMatch(serverPy, /UseCompactObjectHeaders/);
  assert.doesNotMatch(serverPy, /DisableExplicitGC/);
  assert.match(serverPy, /merge_options_txt/);
  assert.match(serverPy, /bootstrap_shared_state/);
  assert.match(serverPy, /sync_shared_file_newest/);
  assert.match(serverPy, /link_shared_dir/);
  assert.match(serverPy, /sync_instance_back_to_shared/);
  assert.match(serverPy, /servers\.dat/);
  assert.match(serverPy, /screenshots/);
  assert.match(serverPy, /resourcepacks/);
  assert.match(serverPy, /open_launcher_ui/);
  assert.match(serverPy, /watch_mc_exit/);
  assert.match(serverPy, /find_crash_tail/);
  assert.match(serverPy, /incompatibleResourcePacks:\[\]/);
  assert.match(serverPy, /shared_dir \/ "options\.txt"/);
  assert.match(serverPy, /version_type.*==.*"release"/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-unix-test-'));
  try {
    const shFile = path.join(tmpDir, 'Pan-launcher.sh');
    const pyFile = path.join(tmpDir, 'server.py');
    fs.writeFileSync(shFile, sh, 'utf8');
    fs.writeFileSync(pyFile, serverPy, 'utf8');
    execFileSync('bash', ['-n', shFile]);
    execFileSync('python3', ['-m', 'py_compile', pyFile]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
