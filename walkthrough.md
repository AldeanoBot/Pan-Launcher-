# Security Summary

**Reviewed Files**: 14  
**Issues Resolved**: 6  

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Cross-Origin Fallback & Status Leak | `public/js/web-bridge.js`, `server.ts` | 808–815, 550–568 | When selecting legacy versions unsupported by Fabric/Quilt (e.g., `1.8.9`), the backend returned HTTP 502 and the client fell back to a direct cross-origin browser fetch against `meta.fabricmc.net`, producing CORS console errors. | Low | Fixed | Backend `/api/pan/catalog/:kind/:gameVersion` now handles HTTP 400/404 from Mojang/Fabric/Quilt meta as an empty compatible build list (HTTP 200), and the browser fallback no longer performs cross-origin requests. |
| ZIP Entry Path Normalization & Crash | `public/js/resourcepack-inspector.js`, `public/js/web-bridge.js` | 15–27, 296–331, 1991–2025 | Adding resource packs crashed in `web-bridge.js` (`sanitizePackFilename` mismatch), ZIP entries prefixed with `./` or BOM failed `pack.mcmeta` parsing, and `minFormat`/`maxFormat` metadata fields were dropped on save. | Medium | Fixed | Added `findIncompatibleEnabledPacks`, exported canonical `sanitizeResourcePackFilename` (with `sanitizePackFilename` alias), stripped UTF-8 BOM + leading `./` / `/` on ZIP paths, and persisted full format metadata from canonical server filenames. |
| Pack Filename Consistency & Traversal Defense | `src/utils/pcPackager.ts` | 1344–1353, 2481–2491 | Windows PowerShell (`Get-SafeZipName`) and Unix Python (`sanitize_ext_name`) stripped spaces differently from the UI inspector and lacked uniform length/dot-sequence caps for uploaded `.zip` resource packs. | Medium | Fixed | Aligned Windows & Unix `.zip` sanitization rules (`[A-Za-z0-9._+\-() ]`, control-char stripping, `..` collapse, `.zip` enforcement, 140-char cap) across client and both desktop hosts. |
| Stale Resource Pack / Config Isolation Across Versions | `src/utils/pcPackager.ts` | 141–146, 970–982, 3301–3310 | Switching versions on Windows left stale `incompatibleResourcePacks` entries in `options.txt`, and merged `options.txt` wasn't mirrored immediately back to `shared/options.txt` before launching. | Low | Fixed | Cleared `incompatibleResourcePacks:[]` explicitly on Windows launch (matching Unix) and mirrored the merged `options.txt` back to `shared/options.txt` on launch so subsequent version/mode switches preserve settings cleanly. |
| Missing Pre-Check Function Crash | `public/js/resourcepack-inspector.js`, `public/js/app.js` | 233–241, 800–830 | Switching Minecraft versions or uploading packs referenced `findIncompatibleEnabledPacks`, which was missing from `resourcepack-inspector.js`. | Medium | Fixed | Implemented `findIncompatibleEnabledPacks`, wired immediate incompatibility warning toasts on version/loader/installation switches, and added the live Home alert banner (`#home-compat-alert`). |
| Desktop Host C Binary Recompilation Scope | `native/pan-stub.exe`, `native/pan-host.exe` | — | The Linux container environment does not include `x86_64-w64-mingw32-gcc`, so prebuilt Windows native PE C stubs (`native/*.exe`) cannot be recompiled from C source inside this container. | Info | Verified | Rebuilt the JavaScript/Vite dist bundle and regenerated all `/release/*` installers (`Pan-launcher-Setup.exe`, `Pan-launcher-Windows.zip`, `Pan-launcher.sh`, `Pan-launcher-MacLinux.zip`) embedding updated frontend assets, PowerShell hosts, and Python backend. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Loopback-Only Local API & CORS | `src/utils/pcPackager.ts` | Both PowerShell (`Test-IsLoopbackOrigin`) and Python (`_check_origin`) desktop servers bind exclusively to `127.0.0.1` and reject non-loopback `Origin` headers instead of using wildcard CORS. |
| SSRF / Private Network Pinger Block | `server.ts`, `src/utils/pcPackager.ts` | Server status pings validate host tokens/ports, resolve DNS to concrete IPv4/IPv6 addresses, and reject loopback, private RFC1918, link-local, CGNAT, ULA, and multicast IP ranges before opening a TCP socket. |
| Archive Upload Confinement & Size Caps | `src/utils/pcPackager.ts` | Uploaded `.jar` mods and `.zip` packs require magic `PK` headers, enforce a strict 64 MB ceiling, and sanitize filenames to basename-only safe characters inside dedicated `custom-mods` and `shared/resourcepacks` directories. |
| Tarball Extraction Safety | `src/utils/pcPackager.ts` | Unix Adoptium Java runtime extraction (`safe_extract_tar`) rejects symlinks, hardlinks, device nodes, absolute paths, and `..` traversal components before extracting. |
| XSS & Native Dialog Elimination | `public/js/views/*.js`, `public/js/app.js`, `public/js/core.js` | User/mod/resource-pack strings (`pack.mcmeta`, `fabric.mod.json`, player names) are rendered exclusively through `escapeHtml`; zero `window.alert`, `window.confirm`, `window.open`, or inline HTML handlers exist across `public/js/`. |
| Dependency Audit | `package.json`, `bun.lock` | `bun audit` completed with 0 critical/high advisories (2 moderate advisories limited strictly to dev-time `vite-plugin-pwa > workbox-build > glob/minimatch` build tooling, unreachable at runtime). |

---

## PoC Verification

### Path Traversal & Spoofed Filename in Uploaded Resource Pack
#### Summary
| Field | Value |
|---|---|
| Issue Type | Path Traversal / Filename Desynchronization |
| Impact | Medium |
| Affected File | `public/js/resourcepack-inspector.js:15`, `src/utils/pcPackager.ts:1344,2481` |
| Test Scenario | Uploading a resource pack with filename `../../evil:pack.zip` or `C:\Temp\Bad\Pack` |

#### How It Was Fixed
Both the browser inspector and the desktop HTTP upload handlers reduce uploaded names to their final basename, replace reserved characters (`:`, `/`, `\`, control chars) and `..` sequences, enforce the `.zip` extension, cap filenames at 140 characters, and return the canonical sanitized filename to store in client state.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `../../evil:pack.zip` enters `sanitizeResourcePackFilename` (`public/js/resourcepack-inspector.js:15`) or `POST /api/local/resourcepacks/upload` (`src/utils/pcPackager.ts:1703,3631`) | Path components and drive prefixes stripped via basename extraction |
| 2 | `Get-SafeZipName` (Windows) and `sanitize_ext_name` (Unix) replace `:` with `_`, remove leading dots, collapse `..`, enforce `.zip`, and join with the confined `sharedRpacksDir` / `shared/resourcepacks` root | Output resolves to `evil_pack.zip` inside the resourcepacks directory |
| 3 | Client (`public/js/web-bridge.js:2010`) stores `upJson.filename` | **Handled Safely** |

#### Conclusion
**Fix Verified** - Neither path traversal sequences nor spoofed Windows/Unix separators can escape the confined resource packs directory or desync stored pack identifiers.

### Malformed / BOM-Prefixed `pack.mcmeta` & Legacy/Modern Version Switching
#### Summary
| Field | Value |
|---|---|
| Issue Type | ZIP Inspection Failure & Compatibility Desynchronization |
| Impact | Medium |
| Affected File | `public/js/resourcepack-inspector.js:95,233,324` |
| Test Scenario | Uploading a `.zip` pack with UTF-8 BOM + `./pack.mcmeta` + `pack_format: 46` and switching target version from `1.21.4` to `1.8.9` |

#### How It Was Fixed
ZIP entry parsing normalizes `./`, `/`, and backslashes; JSON parsing strips leading `\uFEFF` BOM bytes; `findIncompatibleEnabledPacks` evaluates active packs against the target version; switching version/loader immediately fires incompatibility warning toasts and updates the persistent Home compatibility alert; and launching writes `resourcePacks:[...]` (using legacy/modern syntax) along with `incompatibleResourcePacks:[]`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Browser uploads `"PvP 16x Blue.zip"` in Chromium (`playwright-cli`) with `pack_format: 46` and PNG thumbnail | Extracted icon (`rpack-thumb`), description `PvP Clear Sky 16x`, and `Compatible` badge rendered without errors |
| 2 | User switches active Minecraft version to `1.8.9` in Versions (`public/js/app.js:1047`) | Immediate error toasts displayed for both the incompatible Fabric `1.21.4` mod and the `1.21.4` resource pack |
| 3 | User views Home (`public/js/views/home.js:219`) and clicks `Disable incompatible` (`public/js/app.js:1063`) | `#home-compat-alert` displays both conflicts cleanly and disappears once disabled |

#### Conclusion
**Fix Verified** - Mods and resource packs parse cleanly across archive variations, alert immediately upon incompatible version/loader switches, and remain verified in unit tests (`35/35` passing) and live browser execution (`0` console/page errors).
