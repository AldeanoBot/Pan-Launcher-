#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winhttp.h>
#include <shellapi.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#include "pan_json.h"
#include "pan_mc.h"

#define WM_TRAY_CALLBACK (WM_APP + 10)
#define WM_APP_SHUTDOWN  (WM_APP + 11)
#define WM_APP_REOPEN_UI (WM_APP + 12)
#define ID_TRAY_ICON     1
#define IDM_OPEN_UI      1001
#define IDM_EXIT_APP     1002

static HINSTANCE g_hInst = NULL;
static HWND g_trayHwnd = NULL;
static SOCKET g_listenSock = INVALID_SOCKET;
static volatile LONG g_shuttingDown = 0;
static uint16_t g_port = 41735;
static wchar_t g_panDir[MAX_PATH] = L"";
static wchar_t g_appRoot[MAX_PATH] = L"";
static wchar_t g_selfPath[MAX_PATH] = L"";

static CRITICAL_SECTION g_verCs;
static char* g_cachedVersionsJson = NULL;
static ULONGLONG g_cachedVersionsAt = 0;

/* =========================================================================
 * Utilities
 * ========================================================================= */

static int FileExistsW(const wchar_t* path) {
  DWORD attr = GetFileAttributesW(path);
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

static int FindEdgeOrChrome(wchar_t* outPath, size_t cap) {
  const wchar_t* candidates[5] = {
      L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      L"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      L"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      NULL
  };
  for (int i = 0; candidates[i]; i++) {
    if (FileExistsW(candidates[i])) {
      wcsncpy(outPath, candidates[i], cap - 1);
      outPath[cap - 1] = L'\0';
      return 1;
    }
  }
  wchar_t localApp[MAX_PATH];
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", localApp, MAX_PATH);
  if (n > 0 && n < MAX_PATH) {
    _snwprintf(outPath, cap, L"%ls\\Google\\Chrome\\Application\\chrome.exe", localApp);
    outPath[cap - 1] = L'\0';
    if (FileExistsW(outPath)) return 1;
  }
  return 0;
}

static void OpenLauncherUi(const wchar_t* panDir, uint16_t port) {
  wchar_t wv2Exe[MAX_PATH];
  _snwprintf(wv2Exe, MAX_PATH, L"%ls\\appbin\\Pan-launcher-WV2.exe", panDir);
  wv2Exe[MAX_PATH - 1] = L'\0';

  if (FileExistsW(wv2Exe)) {
    wchar_t binDir[MAX_PATH];
    _snwprintf(binDir, MAX_PATH, L"%ls\\appbin", panDir);
    binDir[MAX_PATH - 1] = L'\0';
    wchar_t wvArgs[64];
    _snwprintf(wvArgs, 64, L"--port=%u", (unsigned)port);
    ShellExecuteW(NULL, L"open", wv2Exe, wvArgs, binDir, SW_SHOWNORMAL);
    return;
  }

  wchar_t browser[MAX_PATH];
  if (FindEdgeOrChrome(browser, MAX_PATH)) {
    wchar_t args[1024];
    _snwprintf(
        args,
        1024,
        L"--app=http://127.0.0.1:%u/ --user-data-dir=\"%ls\\appprofile\"",
        (unsigned)port,
        panDir);
    args[1023] = L'\0';
    ShellExecuteW(NULL, L"open", browser, args, panDir, SW_SHOWNORMAL);
    return;
  }

  wchar_t url[128];
  _snwprintf(url, 128, L"http://127.0.0.1:%u/", (unsigned)port);
  ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

static void EscapeJsonStr(const char* src, char* dst, size_t cap) {
  if (!dst || cap == 0) return;
  if (!src) {
    dst[0] = '\0';
    return;
  }
  size_t j = 0;
  for (size_t i = 0; src[i] && j + 4 < cap; i++) {
    unsigned char c = (unsigned char)src[i];
    if (c == '"' || c == '\\') {
      dst[j++] = '\\';
      dst[j++] = (char)c;
    } else if (c == '\n') {
      dst[j++] = '\\';
      dst[j++] = 'n';
    } else if (c == '\r') {
      /* skip */
    } else if (c < 0x20) {
      dst[j++] = ' ';
    } else {
      dst[j++] = (char)c;
    }
  }
  dst[j] = '\0';
}

static int StrStartsWithCI(const char* s, const char* prefix) {
  size_t len = strlen(prefix);
  return _strnicmp(s, prefix, len) == 0;
}

static int StrEndsWithCI(const char* s, const char* suffix) {
  size_t slen = strlen(s);
  size_t xlen = strlen(suffix);
  if (slen < xlen) return 0;
  return _stricmp(s + (slen - xlen), suffix) == 0;
}

static int CheckNativeHostAlive(uint16_t port) {
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == INVALID_SOCKET) return 0;

  u_long nonblock = 1;
  ioctlsocket(s, FIONBIO, &nonblock);

  struct sockaddr_in addr;
  ZeroMemory(&addr, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

  int rc = connect(s, (struct sockaddr*)&addr, sizeof(addr));
  if (rc == SOCKET_ERROR) {
    if (WSAGetLastError() != WSAEWOULDBLOCK) {
      closesocket(s);
      return 0;
    }
    fd_set wfds;
    FD_ZERO(&wfds);
    FD_SET(s, &wfds);
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 350000;
    if (select(0, NULL, &wfds, NULL, &tv) <= 0) {
      closesocket(s);
      return 0;
    }
    int so_err = 0;
    int len = sizeof(so_err);
    getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&so_err, &len);
    if (so_err != 0) {
      closesocket(s);
      return 0;
    }
  }

  nonblock = 0;
  ioctlsocket(s, FIONBIO, &nonblock);
  DWORD rcvTimeout = 600;
  setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&rcvTimeout, sizeof(rcvTimeout));

  const char* req =
      "GET /api/health HTTP/1.1\r\n"
      "Host: 127.0.0.1\r\n"
      "Connection: close\r\n\r\n";
  send(s, req, (int)strlen(req), 0);

  char buf[1024];
  int total = 0;
  while (total < (int)sizeof(buf) - 1) {
    int n = recv(s, buf + total, (int)sizeof(buf) - 1 - total, 0);
    if (n <= 0) break;
    total += n;
  }
  buf[total] = '\0';
  closesocket(s);

  return strstr(buf, "pan-launcher-native") != NULL;
}

/* =========================================================================
 * Socket Send / HTTP Helpers
 * ========================================================================= */

static int SendAll(SOCKET s, const char* data, size_t len) {
  size_t sent = 0;
  while (sent < len) {
    int chunk = (len - sent) > 65536 ? 65536 : (int)(len - sent);
    int n = send(s, data + sent, chunk, 0);
    if (n <= 0) return 0;
    sent += (size_t)n;
  }
  return 1;
}

static void SendHttpResponse(
    SOCKET s,
    int code,
    const char* statusText,
    const char* contentType,
    const void* body,
    size_t bodyLen,
    int noStore,
    const char* extraHeaders) {
  char hdr[1536];
  int hlen = _snprintf(
      hdr,
      sizeof(hdr),
      "HTTP/1.1 %d %s\r\n"
      "Content-Type: %s\r\n"
      "Content-Length: %llu\r\n"
      "Connection: close\r\n"
      "Access-Control-Allow-Origin: *\r\n"
      "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
      "Access-Control-Allow-Headers: Content-Type\r\n"
      "%s%s\r\n",
      code,
      statusText,
      contentType,
      (unsigned long long)bodyLen,
      noStore ? "Cache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\n" : "",
      extraHeaders ? extraHeaders : "");
  if (hlen > 0) {
    SendAll(s, hdr, (size_t)hlen);
  }
  if (body && bodyLen > 0) {
    SendAll(s, (const char*)body, bodyLen);
  }
}

static void SendJsonResponse(SOCKET s, int code, const char* jsonBody) {
  const char* st = (code == 200) ? "OK" : (code == 400) ? "Bad Request" : (code == 404) ? "Not Found" : "Internal Server Error";
  SendHttpResponse(s, code, st, "application/json; charset=utf-8", jsonBody, strlen(jsonBody), 1, NULL);
}

/* =========================================================================
 * Minecraft Server List Ping (SLP) + VarInt
 * ========================================================================= */

static size_t WriteVarInt(uint8_t* dst, uint32_t v) {
  size_t i = 0;
  do {
    uint8_t b = (uint8_t)(v & 0x7Fu);
    v >>= 7;
    if (v != 0) b |= 0x80u;
    dst[i++] = b;
  } while (v != 0);
  return i;
}

static int ReadVarInt(const uint8_t* src, size_t avail, size_t* pos, uint32_t* out) {
  uint32_t result = 0;
  int shift = 0;
  for (int i = 0; i < 5; i++) {
    if (*pos >= avail) return 0;
    uint8_t b = src[(*pos)++];
    result |= (uint32_t)(b & 0x7Fu) << shift;
    if ((b & 0x80u) == 0) {
      *out = result;
      return 1;
    }
    shift += 7;
  }
  return -1;
}

static void StripMotdCodes(const char* src, char* dst, size_t cap) {
  size_t j = 0;
  int prevWs = 1;
  for (size_t i = 0; src && src[i] && j + 1 < cap; i++) {
    unsigned char c = (unsigned char)src[i];
    if (c == 0xC2 && (unsigned char)src[i + 1] == 0xA7 && src[i + 2]) {
      i += 2;
      continue;
    }
    if (c == 0xA7 && src[i + 1]) {
      i += 1;
      continue;
    }
    if (c == '\r' || c == '\n' || c == '\t' || c == ' ') {
      if (!prevWs) {
        dst[j++] = ' ';
        prevWs = 1;
      }
    } else if (c >= 0x20) {
      dst[j++] = (char)c;
      prevWs = 0;
    }
  }
  while (j > 0 && dst[j - 1] == ' ') j--;
  dst[j] = '\0';
}

static void ExtractMotdText(const PanJsonValue* desc, char* out, size_t cap) {
  if (!desc || cap == 0) return;
  if (desc->type == PAN_JSON_STRING && desc->u.str) {
    strncat(out, desc->u.str, cap - strlen(out) - 1);
  } else if (desc->type == PAN_JSON_OBJECT) {
    const char* txt = pan_json_str(pan_json_get(desc, "text"), NULL);
    if (txt) strncat(out, txt, cap - strlen(out) - 1);
    const PanJsonValue* extra = pan_json_get(desc, "extra");
    if (extra && extra->type == PAN_JSON_ARRAY) {
      for (size_t i = 0; i < extra->u.arr.count; i++) {
        ExtractMotdText(extra->u.arr.items[i], out, cap);
      }
    }
  }
}

static void HandleMcPing(SOCKET clientSock, const char* reqBody, size_t reqLen) {
  PanJsonValue* body = pan_json_parse(reqBody, reqLen);
  const char* rawAddr = body ? pan_json_str(pan_json_get(body, "address"), "") : "";

  char trimmed[256];
  size_t ti = 0;
  while (*rawAddr == ' ' || *rawAddr == '\t') rawAddr++;
  for (size_t i = 0; rawAddr[i] && ti + 1 < sizeof(trimmed); i++) {
    if (rawAddr[i] == ' ' || rawAddr[i] == '\t' || rawAddr[i] == '\r' || rawAddr[i] == '\n') break;
    trimmed[ti++] = rawAddr[i];
  }
  trimmed[ti] = '\0';
  pan_json_free(body);

  if (trimmed[0] == '\0') {
    SendJsonResponse(clientSock, 400, "{\"error\":\"Direcci\\u00f3n de servidor requerida\"}");
    return;
  }

  char host[256];
  uint16_t port = 25565;
  const char* colon = strchr(trimmed, ':');
  if (colon) {
    size_t hlen = (size_t)(colon - trimmed);
    if (hlen >= sizeof(host)) hlen = sizeof(host) - 1;
    memcpy(host, trimmed, hlen);
    host[hlen] = '\0';
    int p = atoi(colon + 1);
    if (p >= 1 && p <= 65535) port = (uint16_t)p;
  } else {
    strncpy(host, trimmed, sizeof(host) - 1);
    host[sizeof(host) - 1] = '\0';
  }

  char escHost[512];
  EscapeJsonStr(host, escHost, sizeof(escHost));

  char portStr[16];
  _snprintf(portStr, sizeof(portStr), "%u", (unsigned)port);

  struct addrinfo hints;
  ZeroMemory(&hints, sizeof(hints));
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;

  struct addrinfo* res = NULL;
  if (getaddrinfo(host, portStr, &hints, &res) != 0 || !res) {
    char out[1024];
    _snprintf(
        out,
        sizeof(out),
        "{\"online\":false,\"host\":\"%s\",\"port\":%u,\"latencyMs\":null,"
        "\"playersOnline\":null,\"playersMax\":null,\"versionName\":null,"
        "\"motd\":null,\"error\":\"No se pudo resolver el dominio\"}",
        escHost,
        (unsigned)port);
    SendJsonResponse(clientSock, 200, out);
    return;
  }

  SOCKET mc = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
  if (mc == INVALID_SOCKET) {
    freeaddrinfo(res);
    char out[1024];
    _snprintf(
        out,
        sizeof(out),
        "{\"online\":false,\"host\":\"%s\",\"port\":%u,\"latencyMs\":null,"
        "\"playersOnline\":null,\"playersMax\":null,\"versionName\":null,"
        "\"motd\":null,\"error\":\"Error creando socket\"}",
        escHost,
        (unsigned)port);
    SendJsonResponse(clientSock, 200, out);
    return;
  }

  ULONGLONG tStart = GetTickCount64();
  u_long nonblock = 1;
  ioctlsocket(mc, FIONBIO, &nonblock);
  int cRc = connect(mc, res->ai_addr, (int)res->ai_addrlen);
  freeaddrinfo(res);

  int connected = (cRc == 0);
  if (!connected && WSAGetLastError() == WSAEWOULDBLOCK) {
    fd_set wfds;
    FD_ZERO(&wfds);
    FD_SET(mc, &wfds);
    struct timeval tv;
    tv.tv_sec = 2;
    tv.tv_usec = 200000;
    if (select(0, NULL, &wfds, NULL, &tv) > 0) {
      int soErr = 0;
      int soLen = sizeof(soErr);
      getsockopt(mc, SOL_SOCKET, SO_ERROR, (char*)&soErr, &soLen);
      connected = (soErr == 0);
    }
  }

  if (!connected) {
    closesocket(mc);
    char out[1024];
    _snprintf(
        out,
        sizeof(out),
        "{\"online\":false,\"host\":\"%s\",\"port\":%u,\"latencyMs\":null,"
        "\"playersOnline\":null,\"playersMax\":null,\"versionName\":null,"
        "\"motd\":null,\"error\":\"Sin respuesta (tiempo agotado)\"}",
        escHost,
        (unsigned)port);
    SendJsonResponse(clientSock, 200, out);
    return;
  }

  nonblock = 0;
  ioctlsocket(mc, FIONBIO, &nonblock);
  DWORD rcvTimeout = 2000;
  setsockopt(mc, SOL_SOCKET, SO_RCVTIMEO, (const char*)&rcvTimeout, sizeof(rcvTimeout));

  /* Build Handshake + Status Request */
  uint8_t pkt[700];
  uint8_t hsPayload[600];
  size_t hp = 0;
  hp += WriteVarInt(hsPayload + hp, 767);
  size_t hlen = strlen(host);
  if (hlen > 250) hlen = 250;
  hp += WriteVarInt(hsPayload + hp, (uint32_t)hlen);
  memcpy(hsPayload + hp, host, hlen);
  hp += hlen;
  hsPayload[hp++] = (uint8_t)((port >> 8) & 0xFF);
  hsPayload[hp++] = (uint8_t)(port & 0xFF);
  hp += WriteVarInt(hsPayload + hp, 1); /* Status */

  uint8_t idBuf[5];
  size_t idLen = WriteVarInt(idBuf, 0x00);
  size_t totalHs = idLen + hp;
  size_t ppos = 0;
  ppos += WriteVarInt(pkt + ppos, (uint32_t)totalHs);
  memcpy(pkt + ppos, idBuf, idLen);
  ppos += idLen;
  memcpy(pkt + ppos, hsPayload, hp);
  ppos += hp;

  /* Status Request packet: len=1, id=0x00 */
  pkt[ppos++] = 0x01;
  pkt[ppos++] = 0x00;

  SendAll(mc, (const char*)pkt, ppos);

  uint8_t* recvBuf = (uint8_t*)malloc(65536);
  size_t recvLen = 0;
  int gotSlp = 0;
  long playersOnline = -1;
  long playersMax = -1;
  char verName[128] = "";
  char motdClean[512] = "";

  if (recvBuf) {
    while (recvLen < 65536) {
      int n = recv(mc, (char*)(recvBuf + recvLen), (int)(65536 - recvLen), 0);
      if (n <= 0) break;
      recvLen += (size_t)n;

      size_t cursor = 0;
      uint32_t pktLen = 0;
      if (ReadVarInt(recvBuf, recvLen, &cursor, &pktLen) == 1 && recvLen >= cursor + pktLen) {
        uint32_t pktId = 0;
        uint32_t jsonLen = 0;
        if (ReadVarInt(recvBuf, recvLen, &cursor, &pktId) == 1 && pktId == 0x00 &&
            ReadVarInt(recvBuf, recvLen, &cursor, &jsonLen) == 1 && cursor + jsonLen <= recvLen) {
          PanJsonValue* pj = pan_json_parse((const char*)(recvBuf + cursor), jsonLen);
          if (pj) {
            const PanJsonValue* players = pan_json_get(pj, "players");
            if (players) {
              const PanJsonValue* po = pan_json_get(players, "online");
              const PanJsonValue* pm = pan_json_get(players, "max");
              if (po && po->type == PAN_JSON_NUMBER) playersOnline = (long)po->u.number;
              if (pm && pm->type == PAN_JSON_NUMBER) playersMax = (long)pm->u.number;
            }
            const PanJsonValue* ver = pan_json_get(pj, "version");
            if (ver) {
              const char* vn = pan_json_str(pan_json_get(ver, "name"), NULL);
              if (vn) {
                strncpy(verName, vn, sizeof(verName) - 1);
                verName[sizeof(verName) - 1] = '\0';
              }
            }
            char rawMotd[512] = "";
            ExtractMotdText(pan_json_get(pj, "description"), rawMotd, sizeof(rawMotd));
            StripMotdCodes(rawMotd, motdClean, sizeof(motdClean));
            pan_json_free(pj);
            gotSlp = 1;
          }
        }
        break;
      }
    }
    free(recvBuf);
  }

  ULONGLONG elapsed = GetTickCount64() - tStart;
  if (elapsed < 1) elapsed = 1;
  closesocket(mc);

  if (!motdClean[0]) {
    strcpy(motdClean, gotSlp ? "Servidor Minecraft" : "Servidor accesible por TCP");
  }

  char escVer[256], escMotd[1024];
  EscapeJsonStr(verName, escVer, sizeof(escVer));
  EscapeJsonStr(motdClean, escMotd, sizeof(escMotd));

  char poBuf[32], pmBuf[32], verJson[300];
  if (playersOnline >= 0) _snprintf(poBuf, sizeof(poBuf), "%ld", playersOnline);
  else strcpy(poBuf, "null");
  if (playersMax >= 0) _snprintf(pmBuf, sizeof(pmBuf), "%ld", playersMax);
  else strcpy(pmBuf, "null");
  if (verName[0]) _snprintf(verJson, sizeof(verJson), "\"%s\"", escVer);
  else strcpy(verJson, "null");

  char out[2048];
  _snprintf(
      out,
      sizeof(out),
      "{\"online\":true,\"host\":\"%s\",\"port\":%u,\"latencyMs\":%llu,"
      "\"playersOnline\":%s,\"playersMax\":%s,\"versionName\":%s,\"motd\":\"%s\"}",
      escHost,
      (unsigned)port,
      (unsigned long long)elapsed,
      poBuf,
      pmBuf,
      verJson,
      escMotd);
  SendJsonResponse(clientSock, 200, out);
}

/* =========================================================================
 * Live Mojang Versions Query (with fast cached fallback)
 * ========================================================================= */

static void HandleMcVersionsImpl(SOCKET clientSock, int panFormat) {
  static const char* FALLBACK_VERSIONS =
      "{\"latest\":{\"release\":\"26.3\",\"snapshot\":\"26w14a\"},"
      "\"versions\":["
      "{\"id\":\"26.3\",\"type\":\"release\"},"
      "{\"id\":\"26.2\",\"type\":\"release\"},"
      "{\"id\":\"1.21.11\",\"type\":\"release\"},"
      "{\"id\":\"1.21.4\",\"type\":\"release\"},"
      "{\"id\":\"1.21.3\",\"type\":\"release\"},"
      "{\"id\":\"1.21.1\",\"type\":\"release\"},"
      "{\"id\":\"1.20.4\",\"type\":\"release\"},"
      "{\"id\":\"1.20.1\",\"type\":\"release\"},"
      "{\"id\":\"1.19.4\",\"type\":\"release\"},"
      "{\"id\":\"1.18.2\",\"type\":\"release\"},"
      "{\"id\":\"1.16.5\",\"type\":\"release\"},"
      "{\"id\":\"1.12.2\",\"type\":\"release\"},"
      "{\"id\":\"1.8.9\",\"type\":\"release\"}"
      "]}";

  static const char* FALLBACK_PAN_VERSIONS =
      "{\"stale\":true,\"source\":\"cache\",\"items\":["
      "{\"id\":\"26.3\",\"order\":0,\"type\":\"release\",\"category\":\"release\",\"released\":\"2026-04-01T12:00:00Z\",\"latestRelease\":true},"
      "{\"id\":\"26.2\",\"order\":1,\"type\":\"release\",\"category\":\"release\",\"released\":\"2026-03-10T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.21.11\",\"order\":2,\"type\":\"release\",\"category\":\"release\",\"released\":\"2025-12-09T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.21.4\",\"order\":3,\"type\":\"release\",\"category\":\"release\",\"released\":\"2024-12-03T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.21.3\",\"order\":4,\"type\":\"release\",\"category\":\"release\",\"released\":\"2024-10-23T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.21.1\",\"order\":5,\"type\":\"release\",\"category\":\"release\",\"released\":\"2024-08-08T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.20.4\",\"order\":6,\"type\":\"release\",\"category\":\"release\",\"released\":\"2023-12-07T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.20.1\",\"order\":7,\"type\":\"release\",\"category\":\"release\",\"released\":\"2023-06-12T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.19.4\",\"order\":8,\"type\":\"release\",\"category\":\"release\",\"released\":\"2023-03-14T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.16.5\",\"order\":9,\"type\":\"release\",\"category\":\"release\",\"released\":\"2021-01-15T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.12.2\",\"order\":10,\"type\":\"release\",\"category\":\"release\",\"released\":\"2017-09-18T12:00:00Z\",\"latestRelease\":false},"
      "{\"id\":\"1.8.9\",\"order\":11,\"type\":\"release\",\"category\":\"release\",\"released\":\"2015-12-09T12:00:00Z\",\"latestRelease\":false}"
      "]}";

  if (!panFormat) {
    EnterCriticalSection(&g_verCs);
    if (g_cachedVersionsJson && (GetTickCount64() - g_cachedVersionsAt) < 300000ULL) {
      char* copy = _strdup(g_cachedVersionsJson);
      LeaveCriticalSection(&g_verCs);
      if (copy) {
        SendJsonResponse(clientSock, 200, copy);
        free(copy);
        return;
      }
    }
    LeaveCriticalSection(&g_verCs);
  }

  /* Quick WinHTTP query to Mojang Piston Meta */
  char* builtJson = NULL;
  HINTERNET hSession = WinHttpOpen(L"PanLauncher/2.4 (Windows)", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (hSession) {
    WinHttpSetTimeouts(hSession, 2000, 2000, 2000, 3500);
    HINTERNET hConn = WinHttpConnect(hSession, L"piston-meta.mojang.com", INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (hConn) {
      HINTERNET hReq = WinHttpOpenRequest(hConn, L"GET", L"/mc/game/version_manifest_v2.json", NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
      if (hReq) {
        if (WinHttpSendRequest(hReq, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
            WinHttpReceiveResponse(hReq, NULL)) {
          DWORD status = 0, stSz = sizeof(status);
          WinHttpQueryHeaders(hReq, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &status, &stSz, NULL);
          if (status == 200) {
            size_t cap = 65536, len = 0;
            char* buf = (char*)malloc(cap);
            if (buf) {
              for (;;) {
                DWORD avail = 0;
                if (!WinHttpQueryDataAvailable(hReq, &avail) || avail == 0) break;
                if (len + avail + 1 > cap) {
                  if (cap >= 2097152) break;
                  size_t ncap = cap * 2;
                  while (ncap < len + avail + 1) ncap *= 2;
                  char* nb = (char*)realloc(buf, ncap);
                  if (!nb) break;
                  buf = nb;
                  cap = ncap;
                }
                DWORD rd = 0;
                if (!WinHttpReadData(hReq, buf + len, avail, &rd) || rd == 0) break;
                len += rd;
              }
              buf[len] = '\0';

              PanJsonValue* root = pan_json_parse(buf, len);
              if (root) {
                const PanJsonValue* latest = pan_json_get(root, "latest");
                const char* lrel = pan_json_str(pan_json_get(latest, "release"), "26.3");
                const char* lsnp = pan_json_str(pan_json_get(latest, "snapshot"), "26w14a");
                const PanJsonValue* vers = pan_json_get(root, "versions");

                if (panFormat && vers && vers->type == PAN_JSON_ARRAY) {
                  size_t outCap = 131072;
                  builtJson = (char*)malloc(outCap);
                  if (builtJson) {
                    size_t pos = (size_t)_snprintf(builtJson, outCap, "{\"stale\":false,\"source\":\"official\",\"items\":[");
                    int added = 0;
                    for (size_t i = 0; i < vers->u.arr.count && added < 350 && pos + 320 < outCap; i++) {
                      const PanJsonValue* item = vers->u.arr.items[i];
                      const char* vtype = pan_json_str(pan_json_get(item, "type"), "release");
                      const char* vid = pan_json_str(pan_json_get(item, "id"), "");
                      const char* rtime = pan_json_str(pan_json_get(item, "releaseTime"), "");
                      const char* sha1 = pan_json_str(pan_json_get(item, "sha1"), "");
                      if (!vid[0]) continue;
                      char eId[64], eType[32], eRt[64], eSha[64];
                      EscapeJsonStr(vid, eId, sizeof(eId));
                      EscapeJsonStr(vtype, eType, sizeof(eType));
                      EscapeJsonStr(rtime, eRt, sizeof(eRt));
                      EscapeJsonStr(sha1, eSha, sizeof(eSha));
                      int isLatestRel = (strcmp(vid, lrel) == 0);
                      int isLatestSnap = (strcmp(vid, lsnp) == 0);
                      int wn = _snprintf(
                          builtJson + pos, outCap - pos,
                          "%s{\"id\":\"%s\",\"order\":%d,\"type\":\"%s\",\"category\":\"%s\",\"rawType\":\"%s\",\"released\":\"%s\",\"sha1\":\"%s\",\"source\":\"official\",\"latestRelease\":%s,\"latestSnapshot\":%s}",
                          added > 0 ? "," : "", eId, added, eType, eType, eType, eRt, eSha,
                          isLatestRel ? "true" : "false", isLatestSnap ? "true" : "false");
                      if (wn > 0) pos += (size_t)wn;
                      added++;
                    }
                    if (pos + 4 < outCap) {
                      builtJson[pos++] = ']';
                      builtJson[pos++] = '}';
                      builtJson[pos] = '\0';
                    }
                  }
                } else if (!panFormat && vers && vers->type == PAN_JSON_ARRAY) {
                  builtJson = (char*)malloc(8192);
                  if (builtJson) {
                    char eRel[64], eSnp[64];
                    EscapeJsonStr(lrel, eRel, sizeof(eRel));
                    EscapeJsonStr(lsnp, eSnp, sizeof(eSnp));
                    size_t pos = (size_t)_snprintf(
                        builtJson, 8192,
                        "{\"latest\":{\"release\":\"%s\",\"snapshot\":\"%s\"},\"versions\":[",
                        eRel, eSnp);
                    int added = 0;
                    for (size_t i = 0; i < vers->u.arr.count && added < 30 && pos + 128 < 8192; i++) {
                      const PanJsonValue* item = vers->u.arr.items[i];
                      const char* vtype = pan_json_str(pan_json_get(item, "type"), "");
                      const char* vid = pan_json_str(pan_json_get(item, "id"), "");
                      if (strcmp(vtype, "release") == 0 && vid[0]) {
                        char eId[64];
                        EscapeJsonStr(vid, eId, sizeof(eId));
                        int wn = _snprintf(builtJson + pos, 8192 - pos, "%s{\"id\":\"%s\",\"type\":\"release\"}", added > 0 ? "," : "", eId);
                        if (wn > 0) pos += (size_t)wn;
                        added++;
                      }
                    }
                    if (pos + 4 < 8192) {
                      builtJson[pos++] = ']';
                      builtJson[pos++] = '}';
                      builtJson[pos] = '\0';
                    }
                  }
                }
                pan_json_free(root);
              }
              free(buf);
            }
          }
        }
        WinHttpCloseHandle(hReq);
      }
      WinHttpCloseHandle(hConn);
    }
    WinHttpCloseHandle(hSession);
  }

  if (builtJson) {
    if (!panFormat) {
      EnterCriticalSection(&g_verCs);
      free(g_cachedVersionsJson);
      g_cachedVersionsJson = _strdup(builtJson);
      g_cachedVersionsAt = GetTickCount64();
      LeaveCriticalSection(&g_verCs);
    }
    SendJsonResponse(clientSock, 200, builtJson);
    free(builtJson);
    return;
  }

  SendJsonResponse(clientSock, 200, panFormat ? FALLBACK_PAN_VERSIONS : FALLBACK_VERSIONS);
}

static void HandleMcVersions(SOCKET clientSock) {
  HandleMcVersionsImpl(clientSock, 0);
}

static void HandlePanVersions(SOCKET clientSock) {
  HandleMcVersionsImpl(clientSock, 1);
}

static void HandleLoaderCatalog(SOCKET clientSock, const char* tail) {
  char loader[32] = "";
  char mcVer[96] = "1.21.4";
  const char* slash = tail ? strchr(tail, '/') : NULL;
  if (tail && slash) {
    size_t llen = (size_t)(slash - tail);
    if (llen >= sizeof(loader)) llen = sizeof(loader) - 1;
    memcpy(loader, tail, llen);
    loader[llen] = '\0';
    const char* gv = slash + 1;
    size_t j = 0;
    for (size_t i = 0; gv[i] && gv[i] != '/' && j + 1 < sizeof(mcVer); i++) {
      if (gv[i] == '%' && isxdigit((unsigned char)gv[i + 1]) && isxdigit((unsigned char)gv[i + 2])) {
        char hx[3] = {gv[i + 1], gv[i + 2], '\0'};
        mcVer[j++] = (char)strtol(hx, NULL, 16);
        i += 2;
      } else {
        mcVer[j++] = gv[i];
      }
    }
    mcVer[j] = '\0';
  } else if (tail && tail[0]) {
    strncpy(loader, tail, sizeof(loader) - 1);
  }

  if (_stricmp(loader, "vanilla") == 0) {
    HandlePanVersions(clientSock);
    return;
  }
  char* outBuf = (char*)malloc(32768);
  if (!outBuf) {
    SendJsonResponse(clientSock, 500, "{\"error\":\"Sin memoria\"}");
    return;
  }
  pan_mc_loader_catalog_json(loader, mcVer, outBuf, 32768);
  SendJsonResponse(clientSock, 200, outBuf);
  free(outBuf);
}

/* =========================================================================
 * Static File Serving
 * ========================================================================= */

static const char* GetMimeType(const wchar_t* path) {
  const wchar_t* dot = wcsrchr(path, L'.');
  if (!dot) return "application/octet-stream";
  if (_wcsicmp(dot, L".html") == 0) return "text/html; charset=utf-8";
  if (_wcsicmp(dot, L".js") == 0 || _wcsicmp(dot, L".mjs") == 0) return "application/javascript; charset=utf-8";
  if (_wcsicmp(dot, L".css") == 0) return "text/css; charset=utf-8";
  if (_wcsicmp(dot, L".json") == 0) return "application/json; charset=utf-8";
  if (_wcsicmp(dot, L".webmanifest") == 0) return "application/manifest+json; charset=utf-8";
  if (_wcsicmp(dot, L".svg") == 0) return "image/svg+xml";
  if (_wcsicmp(dot, L".png") == 0) return "image/png";
  if (_wcsicmp(dot, L".jpg") == 0 || _wcsicmp(dot, L".jpeg") == 0) return "image/jpeg";
  if (_wcsicmp(dot, L".ico") == 0) return "image/x-icon";
  if (_wcsicmp(dot, L".woff") == 0) return "font/woff";
  if (_wcsicmp(dot, L".woff2") == 0) return "font/woff2";
  if (_wcsicmp(dot, L".txt") == 0) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

static void ServeFileW(SOCKET clientSock, const wchar_t* fullPath, const char* mimeType, int noStore, const char* extraHeaders) {
  HANDLE hFile = CreateFileW(fullPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (hFile == INVALID_HANDLE_VALUE) {
    SendJsonResponse(clientSock, 404, "{\"error\":\"Archivo no encontrado\"}");
    return;
  }
  LARGE_INTEGER fs;
  if (!GetFileSizeEx(hFile, &fs) || fs.QuadPart < 0 || fs.QuadPart > 64LL * 1024LL * 1024LL) {
    CloseHandle(hFile);
    SendJsonResponse(clientSock, 500, "{\"error\":\"Error leyendo archivo\"}");
    return;
  }
  size_t sz = (size_t)fs.QuadPart;
  uint8_t* buf = (uint8_t*)malloc(sz > 0 ? sz : 1);
  if (!buf) {
    CloseHandle(hFile);
    SendJsonResponse(clientSock, 500, "{\"error\":\"Sin memoria\"}");
    return;
  }
  size_t done = 0;
  int ok = 1;
  while (done < sz) {
    DWORD chunk = (sz - done) > 65536 ? 65536 : (DWORD)(sz - done);
    DWORD rd = 0;
    if (!ReadFile(hFile, buf + done, chunk, &rd, NULL) || rd == 0) {
      ok = 0;
      break;
    }
    done += rd;
  }
  CloseHandle(hFile);
  if (!ok) {
    free(buf);
    SendJsonResponse(clientSock, 500, "{\"error\":\"Lectura incompleta\"}");
    return;
  }
  SendHttpResponse(clientSock, 200, "OK", mimeType, buf, sz, noStore, extraHeaders);
  free(buf);
}

static void ServeStaticRoute(SOCKET clientSock, const char* relPath) {
  /* Reject traversal or Windows drive prefixes */
  if (strstr(relPath, "..") != NULL || strchr(relPath, ':') != NULL) {
    SendJsonResponse(clientSock, 403, "{\"error\":\"Ruta no permitida\"}");
    return;
  }

  wchar_t wRel[512];
  if (relPath[0] == '\0') {
    wcscpy(wRel, L"index.html");
  } else {
    if (MultiByteToWideChar(CP_UTF8, 0, relPath, -1, wRel, 512) <= 0) {
      wcscpy(wRel, L"index.html");
    }
    for (int i = 0; wRel[i]; i++) {
      if (wRel[i] == L'/') wRel[i] = L'\\';
    }
  }

  wchar_t fullPath[MAX_PATH];
  _snwprintf(fullPath, MAX_PATH, L"%ls\\%ls", g_appRoot, wRel);
  fullPath[MAX_PATH - 1] = L'\0';

  if (!FileExistsW(fullPath)) {
    _snwprintf(fullPath, MAX_PATH, L"%ls\\index.html", g_appRoot);
    fullPath[MAX_PATH - 1] = L'\0';
  }

  const char* mime = GetMimeType(fullPath);
  int noStore = StrEndsWithCI(relPath, ".html") || relPath[0] == '\0' || !FileExistsW(fullPath);
  ServeFileW(clientSock, fullPath, mime, noStore, NULL);
}

/* =========================================================================
 * Multi-Threaded HTTP Request Worker
 * ========================================================================= */

static DWORD WINAPI HttpClientThread(LPVOID param) {
  SOCKET s = (SOCKET)(uintptr_t)param;

  DWORD ioTimeout = 8000;
  setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&ioTimeout, sizeof(ioTimeout));
  setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&ioTimeout, sizeof(ioTimeout));

  size_t cap = 16384;
  size_t len = 0;
  char* buf = (char*)malloc(cap);
  if (!buf) {
    closesocket(s);
    return 0;
  }

  char* hdrEnd = NULL;
  while (len < 65536) {
    if (len + 4096 + 1 > cap) {
      size_t ncap = cap * 2;
      char* nb = (char*)realloc(buf, ncap);
      if (!nb) break;
      buf = nb;
      cap = ncap;
    }
    int n = recv(s, buf + len, 4096, 0);
    if (n <= 0) break;
    len += (size_t)n;
    buf[len] = '\0';
    hdrEnd = strstr(buf, "\r\n\r\n");
    if (hdrEnd) break;
  }

  if (!hdrEnd) {
    free(buf);
    closesocket(s);
    return 0;
  }

  size_t hdrLen = (size_t)(hdrEnd - buf) + 4;
  size_t contentLength = 0;

  /* Parse Content-Length case-insensitively */
  for (const char* p = buf; p < hdrEnd; ) {
    const char* lineEnd = strstr(p, "\r\n");
    if (!lineEnd || lineEnd > hdrEnd) break;
    if ((size_t)(lineEnd - p) > 15 && StrStartsWithCI(p, "Content-Length:")) {
      const char* val = p + 15;
      while (val < lineEnd && (*val == ' ' || *val == '\t')) val++;
      long cl = atol(val);
      if (cl > 0 && cl <= 4 * 1024 * 1024) contentLength = (size_t)cl;
    }
    p = lineEnd + 2;
  }

  /* Read remaining body bytes if any */
  size_t neededTotal = hdrLen + contentLength;
  if (neededTotal > cap - 1) {
    char* nb = (char*)realloc(buf, neededTotal + 1);
    if (nb) {
      buf = nb;
      cap = neededTotal + 1;
      hdrEnd = buf + hdrLen - 4;
    } else {
      contentLength = 0;
      neededTotal = hdrLen;
    }
  }
  while (len < neededTotal) {
    size_t want = neededTotal - len;
    int chunk = want > 65536 ? 65536 : (int)want;
    int n = recv(s, buf + len, chunk, 0);
    if (n <= 0) break;
    len += (size_t)n;
  }
  buf[len] = '\0';

  /* Parse request line: METHOD /path HTTP/1.x */
  char method[16] = "";
  char urlPath[1024] = "/";
  const char* sp1 = strchr(buf, ' ');
  if (sp1 && (size_t)(sp1 - buf) < sizeof(method)) {
    memcpy(method, buf, (size_t)(sp1 - buf));
    method[sp1 - buf] = '\0';
    const char* pStart = sp1 + 1;
    const char* sp2 = strpbrk(pStart, " \r\n");
    if (sp2) {
      size_t ulen = (size_t)(sp2 - pStart);
      if (ulen >= sizeof(urlPath)) ulen = sizeof(urlPath) - 1;
      memcpy(urlPath, pStart, ulen);
      urlPath[ulen] = '\0';
    }
  }

  char* qmark = strchr(urlPath, '?');
  if (qmark) *qmark = '\0';
  const char* rel = urlPath[0] == '/' ? urlPath + 1 : urlPath;

  const char* bodyPtr = buf + hdrLen;
  size_t bodyLen = (len >= hdrLen) ? (len - hdrLen) : 0;
  if (bodyLen > contentLength) bodyLen = contentLength;

  if (_stricmp(method, "OPTIONS") == 0) {
    SendHttpResponse(s, 204, "No Content", "text/plain", "", 0, 1, NULL);
  } else if (strcmp(rel, "sw.js") == 0 || strcmp(rel, "registerSW.js") == 0) {
    static const char* SW_KILLER =
        "self.addEventListener('install',function(){self.skipWaiting();});\n"
        "self.addEventListener('activate',function(e){\n"
        "  e.waitUntil(self.registration.unregister().then(function(){\n"
        "    return self.clients.matchAll();\n"
        "  }).then(function(cs){\n"
        "    cs.forEach(function(c){try{c.navigate(c.url);}catch(err){}});\n"
        "  }));\n"
        "});\n";
    SendHttpResponse(s, 200, "OK", "application/javascript; charset=utf-8", SW_KILLER, strlen(SW_KILLER), 1, NULL);
  } else if (strcmp(rel, "api/health") == 0) {
    SendJsonResponse(s, 200, "{\"ok\":true,\"service\":\"pan-launcher-native\",\"canLaunchJava\":true}");
  } else if (strcmp(rel, "api/mc/versions") == 0) {
    HandleMcVersions(s);
  } else if (strcmp(rel, "api/pan/versions") == 0) {
    HandlePanVersions(s);
  } else if (strncmp(rel, "api/pan/loaders/", 16) == 0) {
    HandleLoaderCatalog(s, rel + 16);
  } else if (strncmp(rel, "api/pan/catalog/", 16) == 0) {
    HandleLoaderCatalog(s, rel + 16);
  } else if (strcmp(rel, "api/mc/ping") == 0 && _stricmp(method, "POST") == 0) {
    HandleMcPing(s, bodyPtr, bodyLen);
  } else if (strcmp(rel, "api/local/launch") == 0 && _stricmp(method, "POST") == 0) {
    if (bodyLen == 0) {
      SendJsonResponse(s, 400, "{\"ok\":false,\"error\":\"Falta configuraci\\u00f3n de lanzamiento\"}");
    } else {
      char errBuf[1024] = "";
      int rc = pan_mc_start_launch(bodyPtr, bodyLen, errBuf, sizeof(errBuf));
      if (rc != 0) {
        SendJsonResponse(s, 200, "{\"ok\":true,\"started\":true}");
      } else {
        char escErr[2048];
        EscapeJsonStr(errBuf[0] ? errBuf : "No se pudo iniciar Minecraft Java", escErr, sizeof(escErr));
        char resp[2200];
        _snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}", escErr);
        SendJsonResponse(s, 500, resp);
      }
    }
  } else if (strcmp(rel, "api/local/stop") == 0 && _stricmp(method, "POST") == 0) {
    pan_mc_stop();
    SendJsonResponse(s, 200, "{\"ok\":true}");
  } else if (strcmp(rel, "api/local/status") == 0) {
    char* statusBuf = (char*)malloc(32768);
    if (statusBuf) {
      pan_mc_get_status_json(statusBuf, 32768);
      SendJsonResponse(s, 200, statusBuf);
      free(statusBuf);
    } else {
      SendJsonResponse(s, 500, "{\"state\":\"error\",\"progress\":100,\"step\":\"Sin memoria\",\"error\":\"Sin memoria\"}");
    }
  } else if (strcmp(rel, "api/local/hide-ui") == 0 && _stricmp(method, "POST") == 0) {
    SendJsonResponse(s, 200, "{\"ok\":true,\"hidden\":true}");
  } else if (strcmp(rel, "api/local/shutdown") == 0 && _stricmp(method, "POST") == 0) {
    SendJsonResponse(s, 200, "{\"ok\":true}");
    pan_mc_shutdown();
    InterlockedExchange(&g_shuttingDown, 1);
    if (g_trayHwnd) {
      PostMessageW(g_trayHwnd, WM_APP_SHUTDOWN, 0, 0);
    }
  } else if (strcmp(rel, "api/pc/download-app") == 0) {
    ServeFileW(
        s,
        g_selfPath,
        "application/vnd.microsoft.portable-executable",
        1,
        "Content-Disposition: attachment; filename=\"Pan-launcher.exe\"\r\n");
  } else {
    ServeStaticRoute(s, rel);
  }

  free(buf);
  shutdown(s, SD_BOTH);
  closesocket(s);
  return 0;
}

static DWORD WINAPI AcceptLoopThread(LPVOID param) {
  (void)param;
  while (InterlockedCompareExchange(&g_shuttingDown, 0, 0) == 0) {
    SOCKET client = accept(g_listenSock, NULL, NULL);
    if (client == INVALID_SOCKET) {
      if (InterlockedCompareExchange(&g_shuttingDown, 0, 0) != 0) break;
      Sleep(25);
      continue;
    }
    HANDLE hThread = CreateThread(NULL, 0, HttpClientThread, (LPVOID)(uintptr_t)client, 0, NULL);
    if (hThread) {
      CloseHandle(hThread);
    } else {
      closesocket(client);
    }
  }
  return 0;
}

/* =========================================================================
 * System Tray Lifecycle Window
 * ========================================================================= */

static void AddTrayIcon(HWND hwnd) {
  NOTIFYICONDATAW nid;
  ZeroMemory(&nid, sizeof(nid));
  nid.cbSize = sizeof(nid);
  nid.hWnd = hwnd;
  nid.uID = ID_TRAY_ICON;
  nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
  nid.uCallbackMessage = WM_TRAY_CALLBACK;
  nid.hIcon = LoadIconW(g_hInst, MAKEINTRESOURCEW(1));
  _snwprintf(nid.szTip, 128, L"Pan-launcher (%u)", (unsigned)g_port);
  Shell_NotifyIconW(NIM_ADD, &nid);
}

static void RemoveTrayIcon(HWND hwnd) {
  NOTIFYICONDATAW nid;
  ZeroMemory(&nid, sizeof(nid));
  nid.cbSize = sizeof(nid);
  nid.hWnd = hwnd;
  nid.uID = ID_TRAY_ICON;
  Shell_NotifyIconW(NIM_DELETE, &nid);
}

static LRESULT CALLBACK TrayWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_TRAY_CALLBACK:
      if (lParam == WM_LBUTTONDBLCLK || lParam == WM_LBUTTONUP) {
        OpenLauncherUi(g_panDir, g_port);
      } else if (lParam == WM_RBUTTONUP || lParam == WM_CONTEXTMENU) {
        POINT pt;
        GetCursorPos(&pt);
        HMENU hMenu = CreatePopupMenu();
        if (hMenu) {
          AppendMenuW(hMenu, MF_STRING, IDM_OPEN_UI, L"Abrir Pan-launcher");
          AppendMenuW(hMenu, MF_SEPARATOR, 0, NULL);
          AppendMenuW(hMenu, MF_STRING, IDM_EXIT_APP, L"Cerrar Pan-launcher (Salir)");
          SetForegroundWindow(hwnd);
          TrackPopupMenu(hMenu, TPM_BOTTOMALIGN | TPM_LEFTALIGN, pt.x, pt.y, 0, hwnd, NULL);
          PostMessageW(hwnd, WM_NULL, 0, 0);
          DestroyMenu(hMenu);
        }
      }
      return 0;

    case WM_COMMAND:
      if (LOWORD(wParam) == IDM_OPEN_UI) {
        OpenLauncherUi(g_panDir, g_port);
      } else if (LOWORD(wParam) == IDM_EXIT_APP) {
        PostMessageW(hwnd, WM_APP_SHUTDOWN, 0, 0);
      }
      return 0;

    case WM_APP_REOPEN_UI:
      if (InterlockedCompareExchange(&g_shuttingDown, 0, 0) == 0) {
        OpenLauncherUi(g_panDir, g_port);
      }
      return 0;

    case WM_APP_SHUTDOWN:
    case WM_CLOSE:
      InterlockedExchange(&g_shuttingDown, 1);
      RemoveTrayIcon(hwnd);
      if (g_listenSock != INVALID_SOCKET) {
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
      }
      pan_mc_shutdown();
      DestroyWindow(hwnd);
      return 0;

    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;

    default:
      return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

/* =========================================================================
 * Entry Point
 * ========================================================================= */

static void OnMcExitReopenUi(void) {
  if (g_trayHwnd && InterlockedCompareExchange(&g_shuttingDown, 0, 0) == 0) {
    PostMessageW(g_trayHwnd, WM_APP_REOPEN_UI, 0, 0);
  }
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR lpCmdLine, int nCmdShow) {
  (void)hPrev;
  (void)lpCmdLine;
  (void)nCmdShow;

  g_hInst = hInst;
  InitializeCriticalSection(&g_verCs);

  if (GetModuleFileNameW(NULL, g_selfPath, MAX_PATH) == 0) {
    g_selfPath[0] = L'\0';
  }

  wchar_t localApp[MAX_PATH];
  DWORD envLen = GetEnvironmentVariableW(L"LOCALAPPDATA", localApp, MAX_PATH);
  if (envLen == 0 || envLen >= MAX_PATH) {
    return 1;
  }
  _snwprintf(g_panDir, MAX_PATH, L"%ls\\Pan-launcher", localApp);
  g_panDir[MAX_PATH - 1] = L'\0';
  _snwprintf(g_appRoot, MAX_PATH, L"%ls\\app", g_panDir);
  g_appRoot[MAX_PATH - 1] = L'\0';

  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
    MessageBoxW(NULL, L"No se pudo inicializar Winsock2 en Windows.", L"Pan-launcher", MB_OK | MB_ICONERROR);
    return 1;
  }

  /* Single-instance check: if an existing native Pan-launcher is running, open UI and exit */
  for (uint16_t p = 41735; p <= 41745; p++) {
    if (CheckNativeHostAlive(p)) {
      OpenLauncherUi(g_panDir, p);
      WSACleanup();
      return 0;
    }
  }

  /* Bind first free loopback port (41735..41755) */
  int bound = 0;
  for (uint16_t p = 41735; p <= 41755; p++) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) continue;

    struct sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(p);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    if (bind(s, (struct sockaddr*)&addr, sizeof(addr)) == 0 && listen(s, 32) == 0) {
      g_listenSock = s;
      g_port = p;
      bound = 1;
      break;
    }
    closesocket(s);
  }

  if (!bound) {
    WSACleanup();
    MessageBoxW(
        NULL,
        L"No se pudo abrir ningún puerto local (41735-41755). Cierra instancias anteriores e inténtalo de nuevo.",
        L"Pan-launcher",
        MB_OK | MB_ICONERROR);
    return 1;
  }

  pan_mc_init(g_panDir);
  pan_mc_set_reopen_ui_cb(OnMcExitReopenUi);

  WNDCLASSEXW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = TrayWndProc;
  wc.hInstance = hInst;
  wc.lpszClassName = L"PanLauncherNativeHostTray";
  RegisterClassExW(&wc);

  g_trayHwnd = CreateWindowExW(
      0,
      L"PanLauncherNativeHostTray",
      L"Pan-launcher Host",
      WS_OVERLAPPED,
      0, 0, 0, 0,
      NULL, NULL, hInst, NULL);
  if (g_trayHwnd) {
    AddTrayIcon(g_trayHwnd);
  }

  HANDLE hAccept = CreateThread(NULL, 0, AcceptLoopThread, NULL, 0, NULL);
  if (hAccept) {
    CloseHandle(hAccept);
  }

  OpenLauncherUi(g_panDir, g_port);

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  InterlockedExchange(&g_shuttingDown, 1);
  if (g_listenSock != INVALID_SOCKET) {
    closesocket(g_listenSock);
    g_listenSock = INVALID_SOCKET;
  }
  pan_mc_shutdown();
  WSACleanup();
  DeleteCriticalSection(&g_verCs);
  return 0;
}
