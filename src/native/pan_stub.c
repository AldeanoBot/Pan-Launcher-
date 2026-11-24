#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <objbase.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#include "pan_zip.h"

#define WM_INSTALL_PROGRESS (WM_APP + 1)
#define WM_INSTALL_DONE     (WM_APP + 2)
#define WM_INSTALL_ERROR    (WM_APP + 3)

#define HIT_NONE            0
#define HIT_BTN_CANCEL      1
#define HIT_BTN_BACK        2
#define HIT_BTN_NEXT        3
#define HIT_CHK_DESKTOP     4
#define HIT_CHK_STARTMENU   5
#define HIT_CHK_LAUNCH      6

static HINSTANCE g_hInst = NULL;
static HWND g_hwnd = NULL;
static int g_dpi = 96;

static int g_step = 0; /* 0: Welcome, 1: Options, 2: Installing, 3: Done */
static int g_optDesktop = 1;
static int g_optStartMenu = 1;
static int g_optLaunch = 1;
static int g_hoverId = HIT_NONE;

static CRITICAL_SECTION g_cs;
static int g_progressPct = 0;
static int g_hasError = 0;
static int g_installing = 0;
static wchar_t g_progressMsg[256] = L"Preparando instalador...";
static wchar_t g_errorMsg[512] = L"";
static wchar_t g_baseDir[MAX_PATH] = L"";
static wchar_t g_selfPath[MAX_PATH] = L"";

static RECT g_rcCancel = {0};
static RECT g_rcBack = {0};
static RECT g_rcNext = {0};
static RECT g_rcChkDesktop = {0};
static RECT g_rcChkStartMenu = {0};
static RECT g_rcChkLaunch = {0};

static int S(int px) {
  return MulDiv(px, g_dpi, 96);
}

static void SetProgressState(int pct, const wchar_t* msg) {
  EnterCriticalSection(&g_cs);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  g_progressPct = pct;
  if (msg) {
    wcsncpy(g_progressMsg, msg, 255);
    g_progressMsg[255] = L'\0';
  }
  LeaveCriticalSection(&g_cs);
  if (g_hwnd) {
    PostMessageW(g_hwnd, WM_INSTALL_PROGRESS, 0, 0);
  }
}

static void SetErrorState(const wchar_t* msg) {
  EnterCriticalSection(&g_cs);
  g_hasError = 1;
  g_installing = 0;
  if (msg) {
    wcsncpy(g_errorMsg, msg, 511);
    g_errorMsg[511] = L'\0';
  }
  LeaveCriticalSection(&g_cs);
  if (g_hwnd) {
    PostMessageW(g_hwnd, WM_INSTALL_ERROR, 0, 0);
  }
}

static void EnsureDirRecursiveW(const wchar_t* dirPath) {
  wchar_t tmp[MAX_PATH];
  wcsncpy(tmp, dirPath, MAX_PATH - 1);
  tmp[MAX_PATH - 1] = L'\0';

  for (wchar_t* p = tmp; *p; p++) {
    if (*p == L'\\' || *p == L'/') {
      if (p - tmp >= 2 && *(p - 1) != L':') {
        *p = L'\0';
        CreateDirectoryW(tmp, NULL);
        *p = L'\\';
      }
    }
  }
  CreateDirectoryW(tmp, NULL);
}

static int FindPanPkgInPeFile(HANDLE hFile, uint64_t fileSize, uint64_t* outOffset, uint64_t* outSize) {
  if (fileSize < sizeof(IMAGE_DOS_HEADER) + sizeof(IMAGE_NT_HEADERS64)) return 0;

  IMAGE_DOS_HEADER dos;
  DWORD rd = 0;
  LARGE_INTEGER zero = {0};
  if (!SetFilePointerEx(hFile, zero, NULL, FILE_BEGIN) ||
      !ReadFile(hFile, &dos, sizeof(dos), &rd, NULL) || rd != sizeof(dos)) {
    return 0;
  }
  if (dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 0 ||
      (uint64_t)dos.e_lfanew + sizeof(IMAGE_NT_HEADERS64) > fileSize) {
    return 0;
  }

  LARGE_INTEGER ntPos;
  ntPos.QuadPart = (LONGLONG)dos.e_lfanew;
  IMAGE_NT_HEADERS64 nt;
  if (!SetFilePointerEx(hFile, ntPos, NULL, FILE_BEGIN) ||
      !ReadFile(hFile, &nt, sizeof(nt), &rd, NULL) || rd != sizeof(nt)) {
    return 0;
  }
  if (nt.Signature != IMAGE_NT_SIGNATURE) return 0;

  WORD numSec = nt.FileHeader.NumberOfSections;
  WORD optSz = nt.FileHeader.SizeOfOptionalHeader;
  uint64_t secTableOff = (uint64_t)dos.e_lfanew + 4 + sizeof(IMAGE_FILE_HEADER) + optSz;
  if (secTableOff + (uint64_t)numSec * sizeof(IMAGE_SECTION_HEADER) > fileSize) return 0;

  LARGE_INTEGER secPos;
  secPos.QuadPart = (LONGLONG)secTableOff;
  if (!SetFilePointerEx(hFile, secPos, NULL, FILE_BEGIN)) return 0;

  for (WORD i = 0; i < numSec; i++) {
    IMAGE_SECTION_HEADER sec;
    if (!ReadFile(hFile, &sec, sizeof(sec), &rd, NULL) || rd != sizeof(sec)) return 0;
    if (memcmp(sec.Name, ".panpkg\0", 8) == 0) {
      uint64_t rawOff = sec.PointerToRawData;
      uint64_t dataSz = sec.Misc.VirtualSize > 0 ? sec.Misc.VirtualSize : sec.SizeOfRawData;
      if (dataSz > sec.SizeOfRawData && sec.SizeOfRawData > 0) {
        dataSz = sec.SizeOfRawData;
      }
      if (rawOff > 0 && dataSz > 22 && rawOff + dataSz <= fileSize) {
        *outOffset = rawOff;
        *outSize = dataSz;
        return 1;
      }
    }
  }
  return 0;
}

static int LoadBundleZip(uint8_t** outBuf, size_t* outLen) {
  HANDLE hSelf = CreateFileW(
      g_selfPath,
      GENERIC_READ,
      FILE_SHARE_READ,
      NULL,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      NULL);
  if (hSelf != INVALID_HANDLE_VALUE) {
    LARGE_INTEGER fs;
    uint64_t pkgOff = 0, pkgLen = 0;
    if (GetFileSizeEx(hSelf, &fs) &&
        FindPanPkgInPeFile(hSelf, (uint64_t)fs.QuadPart, &pkgOff, &pkgLen) &&
        pkgLen <= 64u * 1024u * 1024u) {
      uint8_t* buf = (uint8_t*)malloc((size_t)pkgLen);
      if (buf) {
        LARGE_INTEGER startPos;
        startPos.QuadPart = (LONGLONG)pkgOff;
        if (SetFilePointerEx(hSelf, startPos, NULL, FILE_BEGIN)) {
          size_t done = 0;
          int ok = 1;
          while (done < (size_t)pkgLen) {
            DWORD chunk = (pkgLen - done) > 65536 ? 65536 : (DWORD)(pkgLen - done);
            DWORD rd = 0;
            if (!ReadFile(hSelf, buf + done, chunk, &rd, NULL) || rd == 0) {
              ok = 0;
              break;
            }
            done += rd;
          }
          if (ok) {
            CloseHandle(hSelf);
            *outBuf = buf;
            *outLen = (size_t)pkgLen;
            return 1;
          }
        }
        free(buf);
      }
    }
    CloseHandle(hSelf);
  }

  /* Fallback: check adjacent app.zip in the same folder */
  wchar_t siblingZip[MAX_PATH];
  wcsncpy(siblingZip, g_selfPath, MAX_PATH - 1);
  siblingZip[MAX_PATH - 1] = L'\0';
  wchar_t* slash = wcsrchr(siblingZip, L'\\');
  if (slash) {
    _snwprintf(slash + 1, MAX_PATH - (size_t)(slash + 1 - siblingZip), L"app.zip");
    siblingZip[MAX_PATH - 1] = L'\0';
    HANDLE hZip = CreateFileW(siblingZip, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hZip != INVALID_HANDLE_VALUE) {
      LARGE_INTEGER fs;
      if (GetFileSizeEx(hZip, &fs) && fs.QuadPart > 22 && fs.QuadPart <= 64LL * 1024LL * 1024LL) {
        size_t sz = (size_t)fs.QuadPart;
        uint8_t* buf = (uint8_t*)malloc(sz);
        if (buf) {
          size_t done = 0;
          int ok = 1;
          while (done < sz) {
            DWORD chunk = (sz - done) > 65536 ? 65536 : (DWORD)(sz - done);
            DWORD rd = 0;
            if (!ReadFile(hZip, buf + done, chunk, &rd, NULL) || rd == 0) {
              ok = 0;
              break;
            }
            done += rd;
          }
          if (ok) {
            CloseHandle(hZip);
            *outBuf = buf;
            *outLen = sz;
            return 1;
          }
          free(buf);
        }
      }
      CloseHandle(hZip);
    }
  }

  return 0;
}

static int OnExtractZipEntry(
    const char* name,
    const uint8_t* data,
    size_t dataLen,
    size_t index,
    size_t total,
    void* user) {
  (void)user;

  wchar_t wRel[512];
  if (MultiByteToWideChar(CP_UTF8, 0, name, -1, wRel, 512) <= 0) {
    return 0;
  }
  for (int i = 0; wRel[i]; i++) {
    if (wRel[i] == L'/') wRel[i] = L'\\';
  }

  wchar_t destPath[MAX_PATH];
  if (_snwprintf(destPath, MAX_PATH, L"%ls\\%ls", g_baseDir, wRel) >= MAX_PATH) {
    return 0;
  }
  destPath[MAX_PATH - 1] = L'\0';

  wchar_t dirOnly[MAX_PATH];
  wcsncpy(dirOnly, destPath, MAX_PATH - 1);
  dirOnly[MAX_PATH - 1] = L'\0';
  wchar_t* lastSep = wcsrchr(dirOnly, L'\\');
  if (lastSep) {
    *lastSep = L'\0';
    EnsureDirRecursiveW(dirOnly);
  }

  HANDLE hOut = CreateFileW(destPath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (hOut == INVALID_HANDLE_VALUE) {
    wchar_t oldPath[MAX_PATH];
    _snwprintf(oldPath, MAX_PATH, L"%ls.old", destPath);
    oldPath[MAX_PATH - 1] = L'\0';
    MoveFileExW(destPath, oldPath, MOVEFILE_REPLACE_EXISTING);
    for (int retry = 0; retry < 8; retry++) {
      Sleep(150);
      hOut = CreateFileW(destPath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
      if (hOut != INVALID_HANDLE_VALUE) break;
    }
  }
  if (hOut == INVALID_HANDLE_VALUE) {
    return 0;
  }

  size_t writtenTotal = 0;
  while (writtenTotal < dataLen) {
    DWORD chunk = (dataLen - writtenTotal) > 65536 ? 65536 : (DWORD)(dataLen - writtenTotal);
    DWORD wr = 0;
    if (!WriteFile(hOut, data + writtenTotal, chunk, &wr, NULL) || wr != chunk) {
      CloseHandle(hOut);
      return 0;
    }
    writtenTotal += wr;
  }
  CloseHandle(hOut);

  if (total > 0 && (index % 2 == 0 || index + 1 == total)) {
    int pct = 20 + (int)(((index + 1) * 58) / total);
    SetProgressState(pct, L"Instalando archivos de Pan-launcher...");
  }
  return 1;
}

static int CreateShortcutLnk(
    const wchar_t* lnkPath,
    const wchar_t* targetPath,
    const wchar_t* workDir,
    const wchar_t* description) {
  IShellLinkW* psl = NULL;
  HRESULT hr = CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void**)&psl);
  if (FAILED(hr) || !psl) return 0;

  IShellLinkW_SetPath(psl, targetPath);
  IShellLinkW_SetWorkingDirectory(psl, workDir);
  IShellLinkW_SetDescription(psl, description);
  IShellLinkW_SetIconLocation(psl, targetPath, 0);

  IPersistFile* ppf = NULL;
  hr = IShellLinkW_QueryInterface(psl, &IID_IPersistFile, (void**)&ppf);
  int ok = 0;
  if (SUCCEEDED(hr) && ppf) {
    hr = IPersistFile_Save(ppf, lnkPath, TRUE);
    ok = SUCCEEDED(hr);
    IPersistFile_Release(ppf);
  }
  IShellLinkW_Release(psl);
  return ok;
}

static void StopRunningLocalHost(void) {
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return;

  int stoppedAny = 0;
  for (uint16_t p = 41735; p <= 41745; p++) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) continue;

    u_long nonblock = 1;
    ioctlsocket(s, FIONBIO, &nonblock);

    struct sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(p);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    int connected = (connect(s, (struct sockaddr*)&addr, sizeof(addr)) == 0);
    if (!connected && WSAGetLastError() == WSAEWOULDBLOCK) {
      fd_set wfds;
      FD_ZERO(&wfds);
      FD_SET(s, &wfds);
      struct timeval tv;
      tv.tv_sec = 0;
      tv.tv_usec = 200000;
      if (select(0, NULL, &wfds, NULL, &tv) > 0) {
        int soErr = 0;
        int soLen = sizeof(soErr);
        getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&soErr, &soLen);
        connected = (soErr == 0);
      }
    }

    if (connected) {
      nonblock = 0;
      ioctlsocket(s, FIONBIO, &nonblock);
      DWORD rcvTimeout = 500;
      setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&rcvTimeout, sizeof(rcvTimeout));
      const char* req =
          "POST /api/local/shutdown HTTP/1.1\r\n"
          "Host: 127.0.0.1\r\n"
          "Content-Length: 2\r\n"
          "Connection: close\r\n\r\n{}";
      send(s, req, (int)strlen(req), 0);
      char tmp[256];
      recv(s, tmp, sizeof(tmp), 0);
      stoppedAny = 1;
    }
    closesocket(s);
  }

  WSACleanup();
  if (stoppedAny) {
    Sleep(350);
  }
}

static DWORD WINAPI InstallThreadProc(LPVOID param) {
  (void)param;

  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  SetProgressState(10, L"Verificando paquete interno de Pan-launcher...");

  uint8_t* zipBuf = NULL;
  size_t zipLen = 0;
  if (!LoadBundleZip(&zipBuf, &zipLen)) {
    CoUninitialize();
    SetErrorState(L"No se encontró el paquete interno. Vuelve a descargar Pan-launcher-Setup.exe.");
    return 1;
  }

  SetProgressState(16, L"Cerrando sesiones anteriores de Pan-launcher...");
  StopRunningLocalHost();

  SetProgressState(19, L"Preparando carpeta AppData\\Local\\Pan-launcher...");
  EnsureDirRecursiveW(g_baseDir);

  if (!pan_zip_extract_memory(zipBuf, zipLen, OnExtractZipEntry, NULL)) {
    free(zipBuf);
    CoUninitialize();
    SetErrorState(L"No se pudieron extraer los archivos en AppData\\Local\\Pan-launcher. Cierra Pan-launcher si estaba abierto e inténtalo de nuevo.");
    return 1;
  }
  free(zipBuf);

  SetProgressState(84, L"Creando accesos directos en Windows...");

  wchar_t hostExe[MAX_PATH];
  _snwprintf(hostExe, MAX_PATH, L"%ls\\Pan-launcher.exe", g_baseDir);
  hostExe[MAX_PATH - 1] = L'\0';

  if (g_optDesktop) {
    wchar_t deskDir[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, deskDir))) {
      wchar_t deskLnk[MAX_PATH];
      _snwprintf(deskLnk, MAX_PATH, L"%ls\\Pan-launcher.lnk", deskDir);
      deskLnk[MAX_PATH - 1] = L'\0';
      CreateShortcutLnk(deskLnk, hostExe, g_baseDir, L"Pan-launcher - Cliente Minecraft Alto Rendimiento");
    }
  }

  if (g_optStartMenu) {
    wchar_t progDir[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, progDir))) {
      wchar_t menuFolder[MAX_PATH];
      _snwprintf(menuFolder, MAX_PATH, L"%ls\\Pan-launcher", progDir);
      menuFolder[MAX_PATH - 1] = L'\0';
      EnsureDirRecursiveW(menuFolder);

      wchar_t startLnk[MAX_PATH];
      _snwprintf(startLnk, MAX_PATH, L"%ls\\Pan-launcher.lnk", menuFolder);
      startLnk[MAX_PATH - 1] = L'\0';
      CreateShortcutLnk(startLnk, hostExe, g_baseDir, L"Pan-launcher - Cliente Minecraft Alto Rendimiento");
    }
  }

  CoUninitialize();

  SetProgressState(100, L"¡Instalación completada!");
  EnterCriticalSection(&g_cs);
  g_installing = 0;
  LeaveCriticalSection(&g_cs);
  if (g_hwnd) {
    PostMessageW(g_hwnd, WM_INSTALL_DONE, 0, 0);
  }
  return 0;
}

static void LaunchInstalledApp(void) {
  wchar_t hostExe[MAX_PATH];
  _snwprintf(hostExe, MAX_PATH, L"%ls\\Pan-launcher.exe", g_baseDir);
  hostExe[MAX_PATH - 1] = L'\0';
  ShellExecuteW(NULL, L"open", hostExe, NULL, g_baseDir, SW_SHOWNORMAL);
}

static HFONT MakeFont(int px, int weight) {
  return CreateFontW(
      S(px), 0, 0, 0, weight, FALSE, FALSE, FALSE,
      DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
      CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
}

static void DrawRoundRectBox(HDC hdc, RECT rc, COLORREF fill, COLORREF border, int radius) {
  HBRUSH hbr = CreateSolidBrush(fill);
  HPEN hpen = CreatePen(PS_SOLID, 1, border);
  HGDIOBJ oldBr = SelectObject(hdc, hbr);
  HGDIOBJ oldPen = SelectObject(hdc, hpen);
  RoundRect(hdc, rc.left, rc.top, rc.right, rc.bottom, S(radius), S(radius));
  SelectObject(hdc, oldPen);
  SelectObject(hdc, oldBr);
  DeleteObject(hpen);
  DeleteObject(hbr);
}

static void DrawButton(HDC hdc, RECT rc, const wchar_t* text, int primary, int hovered, int disabled, HFONT font) {
  COLORREF fill, border, fg;
  if (disabled) {
    fill = RGB(24, 30, 39);
    border = RGB(36, 44, 56);
    fg = RGB(113, 113, 122);
  } else if (primary) {
    fill = hovered ? RGB(52, 211, 153) : RGB(16, 185, 129);
    border = fill;
    fg = RGB(5, 18, 12);
  } else {
    fill = hovered ? RGB(33, 41, 54) : RGB(24, 30, 39);
    border = RGB(44, 54, 70);
    fg = RGB(228, 228, 231);
  }
  DrawRoundRectBox(hdc, rc, fill, border, 8);
  SelectObject(hdc, font);
  SetTextColor(hdc, fg);
  DrawTextW(hdc, text, -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
}

static void DrawCheckbox(HDC hdc, RECT rc, const wchar_t* label, int checked, int hovered, HFONT font) {
  COLORREF rowBg = hovered ? RGB(20, 26, 34) : RGB(14, 17, 22);
  COLORREF rowBorder = checked ? RGB(20, 83, 61) : RGB(34, 42, 53);
  DrawRoundRectBox(hdc, rc, rowBg, rowBorder, 8);

  int boxSize = S(18);
  int bx = rc.left + S(14);
  int by = rc.top + ((rc.bottom - rc.top) - boxSize) / 2;
  RECT boxRc = {bx, by, bx + boxSize, by + boxSize};
  DrawRoundRectBox(
      hdc,
      boxRc,
      checked ? RGB(16, 185, 129) : RGB(11, 13, 16),
      checked ? RGB(16, 185, 129) : RGB(63, 75, 92),
      4);

  if (checked) {
    HPEN chkPen = CreatePen(PS_SOLID, S(2), RGB(5, 18, 12));
    HGDIOBJ oldPen = SelectObject(hdc, chkPen);
    MoveToEx(hdc, bx + S(4), by + S(9), NULL);
    LineTo(hdc, bx + S(8), by + S(13));
    LineTo(hdc, bx + S(14), by + S(5));
    SelectObject(hdc, oldPen);
    DeleteObject(chkPen);
  }

  RECT txtRc = {bx + boxSize + S(12), rc.top, rc.right - S(12), rc.bottom};
  SelectObject(hdc, font);
  SetTextColor(hdc, RGB(244, 244, 245));
  DrawTextW(hdc, label, -1, &txtRc, DT_LEFT | DT_VCENTER | DT_SINGLELINE);
}

static void DrawStepBadge(HDC hdc, int x, int y, const wchar_t* num, const wchar_t* label, int active, int done, HFONT font) {
  int circle = S(22);
  RECT cRc = {x, y, x + circle, y + circle};
  COLORREF cBg = active ? RGB(16, 185, 129) : (done ? RGB(16, 78, 57) : RGB(24, 30, 39));
  COLORREF cBorder = active ? RGB(16, 185, 129) : (done ? RGB(16, 185, 129) : RGB(44, 54, 70));
  DrawRoundRectBox(hdc, cRc, cBg, cBorder, 11);

  SelectObject(hdc, font);
  SetTextColor(hdc, active ? RGB(5, 18, 12) : (done ? RGB(110, 231, 183) : RGB(161, 161, 170)));
  DrawTextW(hdc, done ? L"✓" : num, -1, &cRc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

  RECT lRc = {x + circle + S(7), y, x + S(118), y + circle};
  SetTextColor(hdc, active ? RGB(255, 255, 255) : (done ? RGB(167, 243, 208) : RGB(113, 113, 122)));
  DrawTextW(hdc, label, -1, &lRc, DT_LEFT | DT_VCENTER | DT_SINGLELINE);
}

static void PaintWizard(HWND hwnd) {
  PAINTSTRUCT ps;
  HDC hdcScreen = BeginPaint(hwnd, &ps);
  RECT client;
  GetClientRect(hwnd, &client);
  int cw = client.right - client.left;
  int ch = client.bottom - client.top;

  HDC hdc = CreateCompatibleDC(hdcScreen);
  HBITMAP bmp = CreateCompatibleBitmap(hdcScreen, cw, ch);
  HGDIOBJ oldBmp = SelectObject(hdc, bmp);

  HBRUSH bgBrush = CreateSolidBrush(RGB(11, 13, 16));
  FillRect(hdc, &client, bgBrush);
  DeleteObject(bgBrush);

  int headerH = S(74);
  int footerH = S(66);
  RECT headerRc = {0, 0, cw, headerH};
  RECT footerRc = {0, ch - footerH, cw, ch};

  HBRUSH barBrush = CreateSolidBrush(RGB(16, 19, 24));
  FillRect(hdc, &headerRc, barBrush);
  FillRect(hdc, &footerRc, barBrush);
  DeleteObject(barBrush);

  HPEN divPen = CreatePen(PS_SOLID, 1, RGB(30, 36, 46));
  HGDIOBJ oldPen = SelectObject(hdc, divPen);
  MoveToEx(hdc, 0, headerH, NULL);
  LineTo(hdc, cw, headerH);
  MoveToEx(hdc, 0, ch - footerH, NULL);
  LineTo(hdc, cw, ch - footerH);
  SelectObject(hdc, oldPen);
  DeleteObject(divPen);

  HFONT fTitle = MakeFont(22, FW_BOLD);
  HFONT fSub = MakeFont(15, FW_SEMIBOLD);
  HFONT fBody = MakeFont(14, FW_NORMAL);
  HFONT fSmall = MakeFont(12, FW_SEMIBOLD);
  HFONT fTiny = MakeFont(12, FW_NORMAL);
  SetBkMode(hdc, TRANSPARENT);

  RECT logoBox = {S(22), S(20), S(54), S(52)};
  DrawRoundRectBox(hdc, logoBox, RGB(12, 46, 34), RGB(16, 185, 129), 8);
  SelectObject(hdc, fSub);
  SetTextColor(hdc, RGB(16, 185, 129));
  DrawTextW(hdc, L"P", -1, &logoBox, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

  RECT brandRc = {S(64), S(16), S(215), S(38)};
  SelectObject(hdc, fSub);
  SetTextColor(hdc, RGB(255, 255, 255));
  DrawTextW(hdc, L"Pan-launcher", -1, &brandRc, DT_LEFT | DT_SINGLELINE);

  RECT verRc = {S(64), S(38), S(215), S(56)};
  SelectObject(hdc, fTiny);
  SetTextColor(hdc, RGB(16, 185, 129));
  DrawTextW(hdc, L"Instalador PC", -1, &verRc, DT_LEFT | DT_SINGLELINE);

  DrawStepBadge(hdc, S(206), S(26), L"1", L"Bienvenida", g_step == 0, g_step > 0, fSmall);
  DrawStepBadge(hdc, S(314), S(26), L"2", L"Opciones", g_step == 1, g_step > 1, fSmall);
  DrawStepBadge(hdc, S(416), S(26), L"3", L"Instalando", g_step == 2, g_step > 2, fSmall);
  DrawStepBadge(hdc, S(524), S(26), L"4", L"Listo", g_step == 3, 0, fSmall);

  ZeroMemory(&g_rcCancel, sizeof(RECT));
  ZeroMemory(&g_rcBack, sizeof(RECT));
  ZeroMemory(&g_rcNext, sizeof(RECT));
  ZeroMemory(&g_rcChkDesktop, sizeof(RECT));
  ZeroMemory(&g_rcChkStartMenu, sizeof(RECT));
  ZeroMemory(&g_rcChkLaunch, sizeof(RECT));

  int padX = S(28);
  int y = headerH + S(24);
  int bodyW = cw - padX * 2;

  if (g_step == 0) {
    RECT tRc = {padX, y, padX + bodyW, y + S(32)};
    SelectObject(hdc, fTitle);
    SetTextColor(hdc, RGB(255, 255, 255));
    DrawTextW(hdc, L"Instalar Pan-launcher en tu PC", -1, &tRc, DT_LEFT | DT_SINGLELINE);

    RECT dRc = {padX, y + S(34), padX + bodyW, y + S(76)};
    SelectObject(hdc, fBody);
    SetTextColor(hdc, RGB(180, 188, 200));
    DrawTextW(
        hdc,
        L"Este asistente instalará Pan-launcher como aplicación propia en tu ordenador (sin usar pestañas de Chrome) para descargar e iniciar Minecraft Java real.",
        -1, &dRc, DT_LEFT | DT_WORDBREAK);

    const wchar_t* stepTitles[3] = {
        L"1. Instala los archivos y servidor local en tu PC",
        L"2. Crea accesos directos propios de Pan-launcher",
        L"3. Listo para abrir Minecraft Java real"
    };
    const wchar_t* stepDescs[3] = {
        L"Extrae los archivos en AppData\\Local\\Pan-launcher sin modificar tus mundos actuales.",
        L"Añade el icono en tu Escritorio y Menú Inicio para abrirlo en su propia ventana.",
        L"Al pulsar «Jugar ahora» descarga Java, Minecraft oficial y mods FPS automáticamente."
    };

    for (int i = 0; i < 3; i++) {
      int cy = y + S(88) + i * S(66);
      RECT card = {padX, cy, padX + bodyW, cy + S(58)};
      DrawRoundRectBox(hdc, card, RGB(18, 22, 28), RGB(34, 42, 53), 8);

      RECT st = {card.left + S(14), card.top + S(9), card.right - S(14), card.top + S(29)};
      SelectObject(hdc, fSub);
      SetTextColor(hdc, RGB(16, 185, 129));
      DrawTextW(hdc, stepTitles[i], -1, &st, DT_LEFT | DT_SINGLELINE);

      RECT sd = {card.left + S(14), card.top + S(31), card.right - S(14), card.bottom - S(6)};
      SelectObject(hdc, fTiny);
      SetTextColor(hdc, RGB(200, 208, 220));
      DrawTextW(hdc, stepDescs[i], -1, &sd, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);
    }

    g_rcCancel = (RECT){padX, ch - footerH + S(14), padX + S(104), ch - S(14)};
    g_rcNext = (RECT){cw - padX - S(156), ch - footerH + S(14), cw - padX, ch - S(14)};
    DrawButton(hdc, g_rcCancel, L"Cancelar", 0, g_hoverId == HIT_BTN_CANCEL, 0, fSmall);
    DrawButton(hdc, g_rcNext, L"Siguiente →", 1, g_hoverId == HIT_BTN_NEXT, 0, fSmall);

  } else if (g_step == 1) {
    RECT tRc = {padX, y, padX + bodyW, y + S(32)};
    SelectObject(hdc, fTitle);
    SetTextColor(hdc, RGB(255, 255, 255));
    DrawTextW(hdc, L"Elige las opciones de instalación", -1, &tRc, DT_LEFT | DT_SINGLELINE);

    RECT pathCard = {padX, y + S(42), padX + bodyW, y + S(98)};
    DrawRoundRectBox(hdc, pathCard, RGB(18, 22, 28), RGB(34, 42, 53), 8);
    RECT pl = {pathCard.left + S(14), pathCard.top + S(8), pathCard.right - S(14), pathCard.top + S(26)};
    SelectObject(hdc, fTiny);
    SetTextColor(hdc, RGB(148, 163, 184));
    DrawTextW(hdc, L"Carpeta de instalación en tu PC:", -1, &pl, DT_LEFT | DT_SINGLELINE);

    RECT pv = {pathCard.left + S(14), pathCard.top + S(28), pathCard.right - S(14), pathCard.bottom - S(8)};
    SelectObject(hdc, fBody);
    SetTextColor(hdc, RGB(110, 231, 183));
    DrawTextW(hdc, g_baseDir, -1, &pv, DT_LEFT | DT_SINGLELINE | DT_PATH_ELLIPSIS);

    g_rcChkDesktop = (RECT){padX, y + S(112), padX + bodyW, y + S(154)};
    g_rcChkStartMenu = (RECT){padX, y + S(162), padX + bodyW, y + S(204)};
    g_rcChkLaunch = (RECT){padX, y + S(212), padX + bodyW, y + S(254)};

    DrawCheckbox(hdc, g_rcChkDesktop, L"Crear acceso directo en el Escritorio (Pan-launcher)", g_optDesktop, g_hoverId == HIT_CHK_DESKTOP, fBody);
    DrawCheckbox(hdc, g_rcChkStartMenu, L"Añadir al Menú Inicio de Windows", g_optStartMenu, g_hoverId == HIT_CHK_STARTMENU, fBody);
    DrawCheckbox(hdc, g_rcChkLaunch, L"Abrir Pan-launcher automáticamente al finalizar", g_optLaunch, g_hoverId == HIT_CHK_LAUNCH, fBody);

    RECT noteRc = {padX, y + S(264), padX + bodyW, y + S(286)};
    SelectObject(hdc, fTiny);
    SetTextColor(hdc, RGB(161, 161, 170));
    DrawTextW(hdc, L"La instalación tarda menos de 2 segundos y no requiere permisos de administrador.", -1, &noteRc, DT_LEFT | DT_SINGLELINE);

    g_rcBack = (RECT){padX, ch - footerH + S(14), padX + S(110), ch - S(14)};
    g_rcNext = (RECT){cw - padX - S(166), ch - footerH + S(14), cw - padX, ch - S(14)};
    DrawButton(hdc, g_rcBack, L"← Atrás", 0, g_hoverId == HIT_BTN_BACK, 0, fSmall);
    DrawButton(hdc, g_rcNext, L"Instalar ahora", 1, g_hoverId == HIT_BTN_NEXT, 0, fSmall);

  } else if (g_step == 2) {
    int pct = 0, hasErr = 0;
    wchar_t msg[256], err[512];
    EnterCriticalSection(&g_cs);
    pct = g_progressPct;
    hasErr = g_hasError;
    wcsncpy(msg, g_progressMsg, 255);
    msg[255] = L'\0';
    wcsncpy(err, g_errorMsg, 511);
    err[511] = L'\0';
    LeaveCriticalSection(&g_cs);

    RECT tRc = {padX, y, padX + bodyW, y + S(32)};
    SelectObject(hdc, fTitle);
    SetTextColor(hdc, hasErr ? RGB(248, 113, 113) : RGB(255, 255, 255));
    DrawTextW(hdc, hasErr ? L"No se pudo completar la instalación" : L"Instalando Pan-launcher...", -1, &tRc, DT_LEFT | DT_SINGLELINE);

    if (!hasErr) {
      RECT sRc = {padX, y + S(46), padX + bodyW - S(60), y + S(70)};
      SelectObject(hdc, fBody);
      SetTextColor(hdc, RGB(212, 212, 216));
      DrawTextW(hdc, msg, -1, &sRc, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

      wchar_t pctText[16];
      _snwprintf(pctText, 16, L"%d%%", pct);
      RECT pRc = {padX + bodyW - S(60), y + S(46), padX + bodyW, y + S(70)};
      SelectObject(hdc, fSub);
      SetTextColor(hdc, RGB(16, 185, 129));
      DrawTextW(hdc, pctText, -1, &pRc, DT_RIGHT | DT_SINGLELINE);

      RECT barBg = {padX, y + S(78), padX + bodyW, y + S(96)};
      DrawRoundRectBox(hdc, barBg, RGB(24, 30, 39), RGB(40, 50, 65), 8);
      int fillW = MulDiv(bodyW - S(4), pct, 100);
      if (fillW > S(8)) {
        RECT barFill = {barBg.left + S(2), barBg.top + S(2), barBg.left + S(2) + fillW, barBg.bottom - S(2)};
        DrawRoundRectBox(hdc, barFill, RGB(16, 185, 129), RGB(16, 185, 129), 6);
      }

      RECT infoCard = {padX, y + S(120), padX + bodyW, y + S(236)};
      DrawRoundRectBox(hdc, infoCard, RGB(18, 22, 28), RGB(30, 36, 46), 8);
      RECT it = {infoCard.left + S(16), infoCard.top + S(14), infoCard.right - S(16), infoCard.bottom - S(14)};
      SelectObject(hdc, fBody);
      SetTextColor(hdc, RGB(180, 188, 200));
      DrawTextW(
          hdc,
          L"Qué está ocurriendo ahora:\n• Extrayendo la app y el servidor local en AppData\\Local\\Pan-launcher\n• Configurando el lanzador en ventana independiente\n• Creando los accesos directos seleccionados",
          -1, &it, DT_LEFT | DT_WORDBREAK);

      g_rcCancel = (RECT){cw - padX - S(130), ch - footerH + S(14), cw - padX, ch - S(14)};
      DrawButton(hdc, g_rcCancel, L"Instalando...", 0, 0, 1, fSmall);
    } else {
      RECT errCard = {padX, y + S(48), padX + bodyW, y + S(220)};
      DrawRoundRectBox(hdc, errCard, RGB(45, 18, 22), RGB(185, 28, 28), 8);
      RECT et = {errCard.left + S(16), errCard.top + S(16), errCard.right - S(16), errCard.bottom - S(16)};
      SelectObject(hdc, fBody);
      SetTextColor(hdc, RGB(254, 202, 202));
      DrawTextW(hdc, err, -1, &et, DT_LEFT | DT_WORDBREAK);

      g_rcCancel = (RECT){padX, ch - footerH + S(14), padX + S(104), ch - S(14)};
      g_rcNext = (RECT){cw - padX - S(146), ch - footerH + S(14), cw - padX, ch - S(14)};
      DrawButton(hdc, g_rcCancel, L"Cerrar", 0, g_hoverId == HIT_BTN_CANCEL, 0, fSmall);
      DrawButton(hdc, g_rcNext, L"Reintentar", 1, g_hoverId == HIT_BTN_NEXT, 0, fSmall);
    }

  } else {
    RECT tRc = {padX, y, padX + bodyW, y + S(32)};
    SelectObject(hdc, fTitle);
    SetTextColor(hdc, RGB(16, 185, 129));
    DrawTextW(hdc, L"¡Pan-launcher está listo para usar!", -1, &tRc, DT_LEFT | DT_SINGLELINE);

    RECT card = {padX, y + S(42), padX + bodyW, y + S(196)};
    DrawRoundRectBox(hdc, card, RGB(18, 22, 28), RGB(34, 42, 53), 8);

    RECT ct = {card.left + S(16), card.top + S(14), card.right - S(16), card.top + S(36)};
    SelectObject(hdc, fSub);
    SetTextColor(hdc, RGB(255, 255, 255));
    DrawTextW(hdc, L"Siguientes pasos para entrar a Minecraft:", -1, &ct, DT_LEFT | DT_SINGLELINE);

    RECT cb = {card.left + S(16), card.top + S(42), card.right - S(16), card.bottom - S(12)};
    SelectObject(hdc, fBody);
    SetTextColor(hdc, RGB(208, 214, 224));
    DrawTextW(
        hdc,
        L"1. Usa el icono «Pan-launcher» en tu Escritorio o Menú Inicio para abrirlo en su propia ventana.\n"
        L"2. Elige tu versión de Minecraft (ej. 1.21.4), mods FPS y cuenta.\n"
        L"3. Pulsa «Jugar ahora»: descargará Java y abrirá Minecraft Java real.",
        -1, &cb, DT_LEFT | DT_WORDBREAK);

    g_rcChkLaunch = (RECT){padX, y + S(212), padX + bodyW, y + S(254)};
    DrawCheckbox(hdc, g_rcChkLaunch, L"Abrir Pan-launcher ahora al finalizar", g_optLaunch, g_hoverId == HIT_CHK_LAUNCH, fBody);

    g_rcNext = (RECT){cw - padX - S(196), ch - footerH + S(14), cw - padX, ch - S(14)};
    DrawButton(
        hdc,
        g_rcNext,
        g_optLaunch ? L"Finalizar y abrir" : L"Finalizar",
        1,
        g_hoverId == HIT_BTN_NEXT,
        0,
        fSmall);
  }

  BitBlt(hdcScreen, 0, 0, cw, ch, hdc, 0, 0, SRCCOPY);
  SelectObject(hdc, oldBmp);
  DeleteObject(bmp);
  DeleteDC(hdc);

  DeleteObject(fTitle);
  DeleteObject(fSub);
  DeleteObject(fBody);
  DeleteObject(fSmall);
  DeleteObject(fTiny);

  EndPaint(hwnd, &ps);
}

static int HitTest(POINT pt) {
  if (PtInRect(&g_rcNext, pt)) return HIT_BTN_NEXT;
  if (PtInRect(&g_rcBack, pt)) return HIT_BTN_BACK;
  if (PtInRect(&g_rcCancel, pt)) return HIT_BTN_CANCEL;
  if (PtInRect(&g_rcChkDesktop, pt)) return HIT_CHK_DESKTOP;
  if (PtInRect(&g_rcChkStartMenu, pt)) return HIT_CHK_STARTMENU;
  if (PtInRect(&g_rcChkLaunch, pt)) return HIT_CHK_LAUNCH;
  return HIT_NONE;
}

static void StartInstallWorker(HWND hwnd) {
  EnterCriticalSection(&g_cs);
  g_hasError = 0;
  g_installing = 1;
  g_progressPct = 5;
  wcscpy(g_progressMsg, L"Iniciando instalación de Pan-launcher...");
  LeaveCriticalSection(&g_cs);

  g_step = 2;
  InvalidateRect(hwnd, NULL, FALSE);

  HANDLE hThread = CreateThread(NULL, 0, InstallThreadProc, NULL, 0, NULL);
  if (hThread) {
    CloseHandle(hThread);
  } else {
    SetErrorState(L"No se pudo iniciar el hilo de instalación.");
  }
}

static LRESULT CALLBACK WizardWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_CREATE: {
      typedef HRESULT (WINAPI *DwmSetAttrFn)(HWND, DWORD, LPCVOID, DWORD);
      HMODULE hDwm = LoadLibraryW(L"dwmapi.dll");
      if (hDwm) {
        DwmSetAttrFn fn = (DwmSetAttrFn)GetProcAddress(hDwm, "DwmSetWindowAttribute");
        if (fn) {
          BOOL dark = TRUE;
          fn(hwnd, 20, &dark, sizeof(dark));
        }
        FreeLibrary(hDwm);
      }
      return 0;
    }

    case WM_PAINT:
      PaintWizard(hwnd);
      return 0;

    case WM_ERASEBKGND:
      return 1;

    case WM_MOUSEMOVE: {
      POINT pt = {(short)LOWORD(lParam), (short)HIWORD(lParam)};
      int h = HitTest(pt);
      if (h != g_hoverId) {
        g_hoverId = h;
        SetCursor(LoadCursorW(NULL, h != HIT_NONE && !(g_step == 2 && !g_hasError) ? IDC_HAND : IDC_ARROW));
        InvalidateRect(hwnd, NULL, FALSE);
      }
      return 0;
    }

    case WM_LBUTTONDOWN: {
      POINT pt = {(short)LOWORD(lParam), (short)HIWORD(lParam)};
      int h = HitTest(pt);
      if (h == HIT_BTN_CANCEL) {
        if (g_step != 2 || g_hasError) {
          PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
      } else if (h == HIT_BTN_BACK && g_step == 1) {
        g_step = 0;
        InvalidateRect(hwnd, NULL, FALSE);
      } else if (h == HIT_CHK_DESKTOP && g_step == 1) {
        g_optDesktop = !g_optDesktop;
        InvalidateRect(hwnd, NULL, FALSE);
      } else if (h == HIT_CHK_STARTMENU && g_step == 1) {
        g_optStartMenu = !g_optStartMenu;
        InvalidateRect(hwnd, NULL, FALSE);
      } else if (h == HIT_CHK_LAUNCH && (g_step == 1 || g_step == 3)) {
        g_optLaunch = !g_optLaunch;
        InvalidateRect(hwnd, NULL, FALSE);
      } else if (h == HIT_BTN_NEXT) {
        if (g_step == 0) {
          g_step = 1;
          InvalidateRect(hwnd, NULL, FALSE);
        } else if (g_step == 1) {
          StartInstallWorker(hwnd);
        } else if (g_step == 2 && g_hasError) {
          StartInstallWorker(hwnd);
        } else if (g_step == 3) {
          if (g_optLaunch) {
            LaunchInstalledApp();
          }
          DestroyWindow(hwnd);
        }
      }
      return 0;
    }

    case WM_KEYDOWN: {
      if (wParam == VK_RETURN) {
        if (g_step == 0) {
          g_step = 1;
          InvalidateRect(hwnd, NULL, FALSE);
        } else if (g_step == 1) {
          StartInstallWorker(hwnd);
        } else if (g_step == 3) {
          if (g_optLaunch) LaunchInstalledApp();
          DestroyWindow(hwnd);
        }
      } else if (wParam == VK_ESCAPE && (g_step != 2 || g_hasError)) {
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
      }
      return 0;
    }

    case WM_INSTALL_PROGRESS:
      InvalidateRect(hwnd, NULL, FALSE);
      return 0;

    case WM_INSTALL_DONE:
      g_step = 3;
      InvalidateRect(hwnd, NULL, FALSE);
      return 0;

    case WM_INSTALL_ERROR:
      InvalidateRect(hwnd, NULL, FALSE);
      return 0;

    case WM_CLOSE:
      if (g_step == 2 && g_installing) {
        return 0;
      }
      DestroyWindow(hwnd);
      return 0;

    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;

    default:
      return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR lpCmdLine, int nCmdShow) {
  (void)hPrev;
  (void)lpCmdLine;
  (void)nCmdShow;

  g_hInst = hInst;
  InitializeCriticalSection(&g_cs);

  HDC hdcScreen = GetDC(NULL);
  if (hdcScreen) {
    g_dpi = GetDeviceCaps(hdcScreen, LOGPIXELSX);
    if (g_dpi < 96) g_dpi = 96;
    ReleaseDC(NULL, hdcScreen);
  }

  DWORD selfLen = GetModuleFileNameW(NULL, g_selfPath, MAX_PATH);
  if (selfLen == 0 || selfLen >= MAX_PATH) {
    MessageBoxW(NULL, L"No se pudo localizar el archivo instalador.", L"Pan-launcher", MB_OK | MB_ICONERROR);
    return 1;
  }

  wchar_t localAppData[MAX_PATH];
  DWORD envLen = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
  if (envLen == 0 || envLen >= MAX_PATH) {
    GetTempPathW(MAX_PATH, localAppData);
  }
  _snwprintf(g_baseDir, MAX_PATH, L"%ls\\Pan-launcher", localAppData);
  g_baseDir[MAX_PATH - 1] = L'\0';

  WNDCLASSEXW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = WizardWndProc;
  wc.hInstance = hInst;
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  wc.hIcon = LoadIconW(hInst, MAKEINTRESOURCEW(1));
  wc.hIconSm = LoadIconW(hInst, MAKEINTRESOURCEW(1));
  wc.lpszClassName = L"PanLauncherSetupClass";
  RegisterClassExW(&wc);

  DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
  RECT wr = {0, 0, S(640), S(450)};
  AdjustWindowRectEx(&wr, style, FALSE, 0);
  int winW = wr.right - wr.left;
  int winH = wr.bottom - wr.top;
  int x = (GetSystemMetrics(SM_CXSCREEN) - winW) / 2;
  int y = (GetSystemMetrics(SM_CYSCREEN) - winH) / 2;

  g_hwnd = CreateWindowExW(
      0,
      L"PanLauncherSetupClass",
      L"Instalador de Pan-launcher",
      style | WS_VISIBLE,
      x, y, winW, winH,
      NULL, NULL, hInst, NULL);
  if (!g_hwnd) {
    MessageBoxW(NULL, L"No se pudo abrir la ventana del instalador.", L"Pan-launcher", MB_OK | MB_ICONERROR);
    return 1;
  }

  ShowWindow(g_hwnd, SW_SHOWNORMAL);
  UpdateWindow(g_hwnd);

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  DeleteCriticalSection(&g_cs);
  return 0;
}
