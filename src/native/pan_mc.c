#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <ctype.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#include "pan_mc.h"
#include "pan_json.h"
#include "pan_zip.h"

#ifndef WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY
#define WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY 4
#endif

#ifndef WINHTTP_OPTION_REDIRECT_POLICY
#define WINHTTP_OPTION_REDIRECT_POLICY 88
#define WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS 2
#endif

#ifndef BCRYPT_SHA1_ALGORITHM
#define BCRYPT_SHA1_ALGORITHM L"SHA1"
#endif

#ifndef BCRYPT_MD5_ALGORITHM
#define BCRYPT_MD5_ALGORITHM L"MD5"
#endif

/* =========================================================================
 * Thread-safe Status & Logs
 * ========================================================================= */

#define MAX_LOG_LINES 80
#define MAX_LINE_LEN 512

typedef struct {
  CRITICAL_SECTION cs;
  int initialized;
  volatile LONG launching;
  volatile LONG stop_requested;
  volatile LONG user_stopped;
  PanMcReopenUiFn reopen_ui_cb;
  char state[32];
  int progress;
  char step[512];
  char error[2048];
  DWORD pid;
  char mc_version[64];
  char instance_dir[1024];
  char logs[MAX_LOG_LINES][MAX_LINE_LEN];
  int log_count;
  wchar_t base_dir[MAX_PATH];
  HANDLE worker_thread;
  HANDLE child_process;
  char* pending_req_json;
  size_t pending_req_len;
} PanMcEngine;

static PanMcEngine g_mc = {0};

static void sanitize_json_str(const char* src, char* dst, size_t cap) {
  if (!dst || cap == 0) return;
  if (!src) {
    dst[0] = '\0';
    return;
  }
  size_t j = 0;
  for (size_t i = 0; src[i] && j + 8 < cap; i++) {
    unsigned char c = (unsigned char)src[i];
    if (c == '"' || c == '\\') {
      dst[j++] = '\\';
      dst[j++] = (char)c;
    } else if (c == '\n') {
      dst[j++] = '\\';
      dst[j++] = 'n';
    } else if (c == '\r') {
      /* skip */
    } else if (c == '\t') {
      dst[j++] = ' ';
    } else if (c < 0x20) {
      dst[j++] = ' ';
    } else {
      dst[j++] = (char)c;
    }
  }
  dst[j] = '\0';
}

static void append_log_locked(const char* line) {
  if (!line || !line[0]) return;
  SYSTEMTIME st;
  GetLocalTime(&st);
  char formatted[MAX_LINE_LEN];
  _snprintf(formatted, sizeof(formatted), "[%02d:%02d:%02d] %s",
            (int)st.wHour, (int)st.wMinute, (int)st.wSecond, line);
  formatted[sizeof(formatted) - 1] = '\0';

  if (g_mc.log_count >= MAX_LOG_LINES) {
    memmove(g_mc.logs[0], g_mc.logs[1], (MAX_LOG_LINES - 1) * MAX_LINE_LEN);
    g_mc.log_count = MAX_LOG_LINES - 1;
  }
  strncpy(g_mc.logs[g_mc.log_count], formatted, MAX_LINE_LEN - 1);
  g_mc.logs[g_mc.log_count][MAX_LINE_LEN - 1] = '\0';
  g_mc.log_count++;
}

static void set_pan_status(
    const char* state,
    int progress,
    const char* step,
    const char* err_msg,
    DWORD proc_id,
    const char* mc_ver,
    const char* inst_dir) {
  EnterCriticalSection(&g_mc.cs);
  strncpy(g_mc.state, state ? state : "idle", sizeof(g_mc.state) - 1);
  g_mc.state[sizeof(g_mc.state) - 1] = '\0';
  g_mc.progress = progress;
  if (step) {
    strncpy(g_mc.step, step, sizeof(g_mc.step) - 1);
    g_mc.step[sizeof(g_mc.step) - 1] = '\0';
    append_log_locked(step);
  }
  if (err_msg && err_msg[0]) {
    strncpy(g_mc.error, err_msg, sizeof(g_mc.error) - 1);
    g_mc.error[sizeof(g_mc.error) - 1] = '\0';
    char eline[MAX_LINE_LEN];
    _snprintf(eline, sizeof(eline), "ERROR: %.480s", err_msg);
    eline[sizeof(eline) - 1] = '\0';
    append_log_locked(eline);
  } else if (err_msg) {
    g_mc.error[0] = '\0';
  }
  g_mc.pid = proc_id;
  if (mc_ver) {
    strncpy(g_mc.mc_version, mc_ver, sizeof(g_mc.mc_version) - 1);
    g_mc.mc_version[sizeof(g_mc.mc_version) - 1] = '\0';
  }
  if (inst_dir) {
    strncpy(g_mc.instance_dir, inst_dir, sizeof(g_mc.instance_dir) - 1);
    g_mc.instance_dir[sizeof(g_mc.instance_dir) - 1] = '\0';
  }
  LeaveCriticalSection(&g_mc.cs);
}

static void set_pan_statusf(const char* state, int progress, const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  buf[sizeof(buf) - 1] = '\0';
  set_pan_status(state, progress, buf, NULL, 0, NULL, NULL);
}

void pan_mc_init(const wchar_t* base_dir) {
  if (!g_mc.initialized) {
    InitializeCriticalSection(&g_mc.cs);
    g_mc.initialized = 1;
    strcpy(g_mc.state, "idle");
  }
  if (base_dir) {
    wcsncpy(g_mc.base_dir, base_dir, MAX_PATH - 1);
    g_mc.base_dir[MAX_PATH - 1] = L'\0';
  }
}

void pan_mc_set_reopen_ui_cb(PanMcReopenUiFn cb) {
  g_mc.reopen_ui_cb = cb;
}

void pan_mc_get_status_json(char* out_buf, size_t out_cap) {
  if (!out_buf || out_cap == 0) return;
  if (!g_mc.initialized) {
    strncpy(out_buf, "{\"state\":\"idle\",\"progress\":0,\"step\":\"\",\"error\":null,\"pid\":null,\"logs\":[]}", out_cap - 1);
    out_buf[out_cap - 1] = '\0';
    return;
  }

  EnterCriticalSection(&g_mc.cs);
  char s_step[1024], s_err[4096], s_ver[128], s_inst[2048];
  sanitize_json_str(g_mc.step, s_step, sizeof(s_step));
  sanitize_json_str(g_mc.error, s_err, sizeof(s_err));
  sanitize_json_str(g_mc.mc_version, s_ver, sizeof(s_ver));
  sanitize_json_str(g_mc.instance_dir, s_inst, sizeof(s_inst));

  size_t pos = 0;
  int n = _snprintf(
      out_buf + pos, out_cap - pos,
      "{\"state\":\"%s\",\"progress\":%d,\"step\":\"%s\",\"error\":%s%s%s,\"pid\":",
      g_mc.state, g_mc.progress, s_step,
      g_mc.error[0] ? "\"" : "null",
      g_mc.error[0] ? s_err : "",
      g_mc.error[0] ? "\"" : "");
  if (n > 0) pos += (size_t)n;

  if (g_mc.pid > 0 && pos + 32 < out_cap) {
    n = _snprintf(out_buf + pos, out_cap - pos, "%lu", (unsigned long)g_mc.pid);
  } else if (pos + 16 < out_cap) {
    n = _snprintf(out_buf + pos, out_cap - pos, "null");
  } else {
    n = 0;
  }
  if (n > 0) pos += (size_t)n;

  if (pos + 256 < out_cap) {
    n = _snprintf(out_buf + pos, out_cap - pos,
                  ",\"mcVersion\":\"%s\",\"instanceDir\":\"%s\",\"logs\":[",
                  s_ver, s_inst);
    if (n > 0) pos += (size_t)n;
  }

  for (int i = 0; i < g_mc.log_count && pos + 64 < out_cap; i++) {
    char sl[1024];
    sanitize_json_str(g_mc.logs[i], sl, sizeof(sl));
    if (pos + strlen(sl) + 16 >= out_cap) break;
    n = _snprintf(out_buf + pos, out_cap - pos, "%s\"%s\"", (i > 0 ? "," : ""), sl);
    if (n > 0) pos += (size_t)n;
  }

  if (pos + 4 < out_cap) {
    out_buf[pos++] = ']';
    out_buf[pos++] = '}';
    out_buf[pos] = '\0';
  } else {
    out_buf[out_cap - 1] = '\0';
  }
  LeaveCriticalSection(&g_mc.cs);
}

/* =========================================================================
 * String / UTF-8 / Path Helpers
 * ========================================================================= */

static char* xstrdup(const char* s) {
  if (!s) return NULL;
  size_t len = strlen(s);
  char* p = (char*)malloc(len + 1);
  if (p) memcpy(p, s, len + 1);
  return p;
}

static int utf8_to_wide(const char* s, wchar_t* w, size_t wcap) {
  if (!s || !w || wcap == 0) return 0;
  int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, w, (int)wcap);
  if (n <= 0) {
    w[0] = L'\0';
    return 0;
  }
  return 1;
}

static int wide_to_utf8(const wchar_t* w, char* s, size_t scap) {
  if (!w || !s || scap == 0) return 0;
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, s, (int)scap, NULL, NULL);
  if (n <= 0) {
    s[0] = '\0';
    return 0;
  }
  return 1;
}

static void ensure_dir_w(const wchar_t* dir_path) {
  wchar_t tmp[MAX_PATH];
  wcsncpy(tmp, dir_path, MAX_PATH - 1);
  tmp[MAX_PATH - 1] = L'\0';
  for (wchar_t* p = tmp; *p; p++) {
    if (*p == L'\\' || *p == L'/') {
      *p = L'\\';
      if (p - tmp >= 2 && *(p - 1) != L':') {
        *p = L'\0';
        CreateDirectoryW(tmp, NULL);
        *p = L'\\';
      }
    }
  }
  CreateDirectoryW(tmp, NULL);
}

static void ensure_parent_dir_w(const wchar_t* file_path) {
  wchar_t dir[MAX_PATH];
  wcsncpy(dir, file_path, MAX_PATH - 1);
  dir[MAX_PATH - 1] = L'\0';
  wchar_t* sep = wcsrchr(dir, L'\\');
  if (!sep) sep = wcsrchr(dir, L'/');
  if (sep) {
    *sep = L'\0';
    ensure_dir_w(dir);
  }
}

static int file_exists_nonempty_w(const wchar_t* path) {
  WIN32_FILE_ATTRIBUTE_DATA fad;
  if (!GetFileAttributesExW(path, GetFileExInfoStandard, &fad)) return 0;
  if (fad.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return 0;
  return (fad.nFileSizeHigh > 0 || fad.nFileSizeLow > 0);
}

static uint8_t* read_entire_file_w(const wchar_t* path, size_t* out_len) {
  HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                         NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return NULL;
  LARGE_INTEGER fs;
  if (!GetFileSizeEx(h, &fs) || fs.QuadPart < 0 || fs.QuadPart > 256LL * 1024LL * 1024LL) {
    CloseHandle(h);
    return NULL;
  }
  size_t sz = (size_t)fs.QuadPart;
  uint8_t* buf = (uint8_t*)malloc(sz + 1);
  if (!buf) {
    CloseHandle(h);
    return NULL;
  }
  size_t done = 0;
  while (done < sz) {
    DWORD chunk = (sz - done) > 65536 ? 65536 : (DWORD)(sz - done);
    DWORD rd = 0;
    if (!ReadFile(h, buf + done, chunk, &rd, NULL) || rd == 0) {
      free(buf);
      CloseHandle(h);
      return NULL;
    }
    done += rd;
  }
  CloseHandle(h);
  buf[sz] = '\0';
  if (out_len) *out_len = sz;
  return buf;
}

static int write_entire_file_w(const wchar_t* path, const void* data, size_t len) {
  ensure_parent_dir_w(path);
  HANDLE h = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) return 0;
  const uint8_t* ptr = (const uint8_t*)data;
  size_t done = 0;
  while (done < len) {
    DWORD chunk = (len - done) > 65536 ? 65536 : (DWORD)(len - done);
    DWORD wr = 0;
    if (!WriteFile(h, ptr + done, chunk, &wr, NULL) || wr != chunk) {
      CloseHandle(h);
      return 0;
    }
    done += wr;
  }
  CloseHandle(h);
  return 1;
}

/* =========================================================================
 * Shared Player State Persistence (across all versions, loaders & modes)
 * ========================================================================= */

static uint64_t file_mtime_u64_w(const wchar_t* path) {
  WIN32_FILE_ATTRIBUTE_DATA fad;
  if (!GetFileAttributesExW(path, GetFileExInfoStandard, &fad)) return 0;
  if (fad.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return 0;
  if (fad.nFileSizeHigh == 0 && fad.nFileSizeLow == 0) return 0;
  return (((uint64_t)fad.ftLastWriteTime.dwHighDateTime) << 32) |
         (uint64_t)fad.ftLastWriteTime.dwLowDateTime;
}

static int is_reparse_dir_w(const wchar_t* path) {
  DWORD attr = GetFileAttributesW(path);
  if (attr == INVALID_FILE_ATTRIBUTES) return 0;
  return (attr & FILE_ATTRIBUTE_DIRECTORY) && (attr & FILE_ATTRIBUTE_REPARSE_POINT);
}

static int is_regular_dir_w(const wchar_t* path) {
  DWORD attr = GetFileAttributesW(path);
  if (attr == INVALID_FILE_ATTRIBUTES) return 0;
  return (attr & FILE_ATTRIBUTE_DIRECTORY) && !(attr & FILE_ATTRIBUTE_REPARSE_POINT);
}

static int copy_file_w_safe(const wchar_t* src, const wchar_t* dst) {
  if (!file_exists_nonempty_w(src)) return 0;
  ensure_parent_dir_w(dst);
  return CopyFileW(src, dst, FALSE) ? 1 : 0;
}

static void sync_shared_file_newest_w(const wchar_t* shared_file, const wchar_t* inst_file) {
  uint64_t s_mt = file_mtime_u64_w(shared_file);
  uint64_t i_mt = file_mtime_u64_w(inst_file);
  if (s_mt == 0 && i_mt == 0) return;
  if (s_mt > i_mt) {
    copy_file_w_safe(shared_file, inst_file);
  } else if (i_mt > s_mt) {
    copy_file_w_safe(inst_file, shared_file);
  }
}

static int dir_has_entries_w(const wchar_t* dir) {
  wchar_t search[MAX_PATH];
  _snwprintf(search, MAX_PATH, L"%ls\\*", dir);
  search[MAX_PATH - 1] = L'\0';
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(search, &fd);
  if (h == INVALID_HANDLE_VALUE) return 0;
  int found = 0;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    found = 1;
    break;
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return found;
}

static void sync_dir_recursive_newer_w(const wchar_t* src_dir, const wchar_t* dst_dir) {
  if (!is_regular_dir_w(src_dir)) return;
  ensure_dir_w(dst_dir);
  wchar_t search[MAX_PATH];
  _snwprintf(search, MAX_PATH, L"%ls\\*", src_dir);
  search[MAX_PATH - 1] = L'\0';
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(search, &fd);
  if (h == INVALID_HANDLE_VALUE) return;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) continue;
    wchar_t s_sub[MAX_PATH], d_sub[MAX_PATH];
    _snwprintf(s_sub, MAX_PATH, L"%ls\\%ls", src_dir, fd.cFileName);
    _snwprintf(d_sub, MAX_PATH, L"%ls\\%ls", dst_dir, fd.cFileName);
    s_sub[MAX_PATH - 1] = L'\0';
    d_sub[MAX_PATH - 1] = L'\0';
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      sync_dir_recursive_newer_w(s_sub, d_sub);
    } else {
      uint64_t s_mt = file_mtime_u64_w(s_sub);
      uint64_t d_mt = file_mtime_u64_w(d_sub);
      if (s_mt > d_mt) {
        copy_file_w_safe(s_sub, d_sub);
      }
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
}

static void remove_regular_dir_tree_w(const wchar_t* dir) {
  if (is_reparse_dir_w(dir)) {
    RemoveDirectoryW(dir);
    return;
  }
  if (!is_regular_dir_w(dir)) return;
  wchar_t search[MAX_PATH];
  _snwprintf(search, MAX_PATH, L"%ls\\*", dir);
  search[MAX_PATH - 1] = L'\0';
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(search, &fd);
  if (h != INVALID_HANDLE_VALUE) {
    do {
      if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
      wchar_t sub[MAX_PATH];
      _snwprintf(sub, MAX_PATH, L"%ls\\%ls", dir, fd.cFileName);
      sub[MAX_PATH - 1] = L'\0';
      if (fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) {
        RemoveDirectoryW(sub);
      } else if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
        remove_regular_dir_tree_w(sub);
      } else {
        SetFileAttributesW(sub, FILE_ATTRIBUTE_NORMAL);
        DeleteFileW(sub);
      }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
  }
  RemoveDirectoryW(dir);
}

static int create_dir_junction_w(const wchar_t* link_dir, const wchar_t* target_dir) {
  wchar_t comspec[MAX_PATH] = L"cmd.exe";
  DWORD n = GetEnvironmentVariableW(L"ComSpec", comspec, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) wcscpy(comspec, L"cmd.exe");

  wchar_t cmdline[MAX_PATH * 3];
  _snwprintf(cmdline, MAX_PATH * 3, L"\"%ls\" /c mklink /J \"%ls\" \"%ls\"",
             comspec, link_dir, target_dir);
  cmdline[MAX_PATH * 3 - 1] = L'\0';

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;

  if (!CreateProcessW(NULL, cmdline, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
    return 0;
  }
  WaitForSingleObject(pi.hProcess, 5000);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return is_reparse_dir_w(link_dir);
}

static void migrate_and_link_dir_w(const wchar_t* inst_sub, const wchar_t* shared_sub) {
  ensure_dir_w(shared_sub);
  if (is_reparse_dir_w(inst_sub)) {
    return;
  }
  if (is_regular_dir_w(inst_sub)) {
    sync_dir_recursive_newer_w(inst_sub, shared_sub);
    remove_regular_dir_tree_w(inst_sub);
  }
  if (!create_dir_junction_w(inst_sub, shared_sub)) {
    ensure_dir_w(inst_sub);
    sync_dir_recursive_newer_w(shared_sub, inst_sub);
  }
}

static void bootstrap_shared_from_instances_w(const wchar_t* base_dir, const wchar_t* shared_dir) {
  static const wchar_t* kSharedDirs[] = {L"saves", L"resourcepacks", L"shaderpacks", L"screenshots"};
  static const wchar_t* kSharedFiles[] = {L"servers.dat", L"servers.dat_old", L"optionsof.txt", L"options.txt"};

  ensure_dir_w(shared_dir);
  for (int i = 0; i < 4; i++) {
    wchar_t sd[MAX_PATH];
    _snwprintf(sd, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedDirs[i]);
    ensure_dir_w(sd);
  }

  wchar_t inst_root[MAX_PATH], search[MAX_PATH];
  _snwprintf(inst_root, MAX_PATH, L"%ls\\instances", base_dir);
  _snwprintf(search, MAX_PATH, L"%ls\\*", inst_root);
  search[MAX_PATH - 1] = L'\0';

  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(search, &fd);
  if (h == INVALID_HANDLE_VALUE) return;

  uint64_t best_mt[4];
  wchar_t best_path[4][MAX_PATH];
  for (int f = 0; f < 4; f++) {
    wchar_t sf[MAX_PATH];
    _snwprintf(sf, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedFiles[f]);
    best_mt[f] = file_mtime_u64_w(sf);
    best_path[f][0] = L'\0';
  }
  int dir_empty[4];
  for (int d = 0; d < 4; d++) {
    wchar_t sd[MAX_PATH];
    _snwprintf(sd, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedDirs[d]);
    dir_empty[d] = !dir_has_entries_w(sd);
  }

  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
    wchar_t idir[MAX_PATH];
    _snwprintf(idir, MAX_PATH, L"%ls\\%ls", inst_root, fd.cFileName);
    idir[MAX_PATH - 1] = L'\0';

    for (int f = 0; f < 4; f++) {
      /* For options.txt only bootstrap when shared/options.txt does not exist yet */
      if (f == 3 && best_mt[3] > 0 && best_path[3][0] == L'\0') continue;
      wchar_t cand[MAX_PATH];
      _snwprintf(cand, MAX_PATH, L"%ls\\%ls", idir, kSharedFiles[f]);
      uint64_t mt = file_mtime_u64_w(cand);
      if (mt > best_mt[f]) {
        best_mt[f] = mt;
        wcsncpy(best_path[f], cand, MAX_PATH - 1);
        best_path[f][MAX_PATH - 1] = L'\0';
      }
    }

    for (int d = 0; d < 4; d++) {
      if (!dir_empty[d]) continue;
      wchar_t isub[MAX_PATH], ssub[MAX_PATH];
      _snwprintf(isub, MAX_PATH, L"%ls\\%ls", idir, kSharedDirs[d]);
      _snwprintf(ssub, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedDirs[d]);
      if (is_regular_dir_w(isub)) {
        sync_dir_recursive_newer_w(isub, ssub);
      }
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);

  for (int f = 0; f < 4; f++) {
    if (best_path[f][0]) {
      wchar_t sf[MAX_PATH];
      _snwprintf(sf, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedFiles[f]);
      copy_file_w_safe(best_path[f], sf);
    }
  }
}

static void sync_mc_state_to_instance_w(const wchar_t* base_dir, const wchar_t* instance_dir, wchar_t shared_dir_out[MAX_PATH]) {
  static const wchar_t* kSharedDirs[] = {L"saves", L"resourcepacks", L"shaderpacks", L"screenshots"};
  static const wchar_t* kSharedFiles[] = {L"servers.dat", L"servers.dat_old", L"optionsof.txt", L"options.txt"};

  _snwprintf(shared_dir_out, MAX_PATH, L"%ls\\shared", base_dir);
  shared_dir_out[MAX_PATH - 1] = L'\0';

  bootstrap_shared_from_instances_w(base_dir, shared_dir_out);

  for (int d = 0; d < 4; d++) {
    wchar_t isub[MAX_PATH], ssub[MAX_PATH];
    _snwprintf(isub, MAX_PATH, L"%ls\\%ls", instance_dir, kSharedDirs[d]);
    _snwprintf(ssub, MAX_PATH, L"%ls\\%ls", shared_dir_out, kSharedDirs[d]);
    migrate_and_link_dir_w(isub, ssub);
  }

  for (int f = 0; f < 4; f++) {
    wchar_t sf[MAX_PATH], inf[MAX_PATH];
    _snwprintf(sf, MAX_PATH, L"%ls\\%ls", shared_dir_out, kSharedFiles[f]);
    _snwprintf(inf, MAX_PATH, L"%ls\\%ls", instance_dir, kSharedFiles[f]);
    sync_shared_file_newest_w(sf, inf);
  }
}

static void sync_mc_state_back_w(const wchar_t* instance_dir, const wchar_t* shared_dir) {
  if (!instance_dir || !instance_dir[0] || !shared_dir || !shared_dir[0]) return;
  static const wchar_t* kSharedDirs[] = {L"saves", L"resourcepacks", L"shaderpacks", L"screenshots"};
  static const wchar_t* kSharedFiles[] = {L"servers.dat", L"servers.dat_old", L"optionsof.txt", L"options.txt"};

  ensure_dir_w(shared_dir);
  for (int f = 0; f < 4; f++) {
    wchar_t sf[MAX_PATH], inf[MAX_PATH];
    _snwprintf(sf, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedFiles[f]);
    _snwprintf(inf, MAX_PATH, L"%ls\\%ls", instance_dir, kSharedFiles[f]);
    uint64_t i_mt = file_mtime_u64_w(inf);
    uint64_t s_mt = file_mtime_u64_w(sf);
    if (i_mt > 0 && i_mt >= s_mt) {
      copy_file_w_safe(inf, sf);
    }
  }
  for (int d = 0; d < 4; d++) {
    wchar_t isub[MAX_PATH], ssub[MAX_PATH];
    _snwprintf(isub, MAX_PATH, L"%ls\\%ls", instance_dir, kSharedDirs[d]);
    _snwprintf(ssub, MAX_PATH, L"%ls\\%ls", shared_dir, kSharedDirs[d]);
    if (is_regular_dir_w(isub)) {
      sync_dir_recursive_newer_w(isub, ssub);
    }
  }
}

/* =========================================================================
 * BCrypt SHA-1 & MD5
 * ========================================================================= */

static int compute_file_sha1_hex(const wchar_t* path, char out_hex[41]) {
  size_t len = 0;
  uint8_t* buf = read_entire_file_w(path, &len);
  if (!buf) return 0;

  BCRYPT_ALG_HANDLE hAlg = NULL;
  BCRYPT_HASH_HANDLE hHash = NULL;
  uint8_t digest[20];
  int ok = 0;

  if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA1_ALGORITHM, NULL, 0) == 0) {
    if (BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0) == 0) {
      if (BCryptHashData(hHash, buf, (ULONG)len, 0) == 0 &&
          BCryptFinishHash(hHash, digest, sizeof(digest), 0) == 0) {
        static const char hex[] = "0123456789abcdef";
        for (int i = 0; i < 20; i++) {
          out_hex[i * 2] = hex[(digest[i] >> 4) & 0xF];
          out_hex[i * 2 + 1] = hex[digest[i] & 0xF];
        }
        out_hex[40] = '\0';
        ok = 1;
      }
      BCryptDestroyHash(hHash);
    }
    BCryptCloseAlgorithmProvider(hAlg, 0);
  }
  free(buf);
  return ok;
}

static void compute_offline_uuid(const char* username, char out_hex[33]) {
  char input[256];
  _snprintf(input, sizeof(input), "OfflinePlayer:%s", username && username[0] ? username : "PanWarrior");
  input[sizeof(input) - 1] = '\0';

  uint8_t digest[16] = {0};
  BCRYPT_ALG_HANDLE hAlg = NULL;
  BCRYPT_HASH_HANDLE hHash = NULL;
  if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_MD5_ALGORITHM, NULL, 0) == 0) {
    if (BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0) == 0) {
      if (BCryptHashData(hHash, (PUCHAR)input, (ULONG)strlen(input), 0) == 0) {
        BCryptFinishHash(hHash, digest, sizeof(digest), 0);
      }
      BCryptDestroyHash(hHash);
    }
    BCryptCloseAlgorithmProvider(hAlg, 0);
  }
  digest[6] = (uint8_t)((digest[6] & 0x0Fu) | 0x30u);
  digest[8] = (uint8_t)((digest[8] & 0x3Fu) | 0x80u);
  static const char hex[] = "0123456789abcdef";
  for (int i = 0; i < 16; i++) {
    out_hex[i * 2] = hex[(digest[i] >> 4) & 0xF];
    out_hex[i * 2 + 1] = hex[digest[i] & 0xF];
  }
  out_hex[32] = '\0';
}

/* =========================================================================
 * WinHTTP Client (Redirects + Streaming to File / Memory)
 * ========================================================================= */

static HINTERNET create_winhttp_session(void) {
  HINTERNET h = WinHttpOpen(L"PanLauncher/2.3 (Windows)", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                            WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!h) {
    h = WinHttpOpen(L"PanLauncher/2.3 (Windows)", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  }
  if (h) {
    WinHttpSetTimeouts(h, 8000, 12000, 15000, 60000);
  }
  return h;
}

static int http_fetch_once(
    HINTERNET hSession,
    const char* url_utf8,
    const wchar_t* dest_file,
    char** out_mem,
    size_t* out_mem_len,
    char* err_buf,
    size_t err_cap) {
  wchar_t wurl[2048];
  if (!utf8_to_wide(url_utf8, wurl, 2048)) {
    if (err_buf) _snprintf(err_buf, err_cap, "URL inválida");
    return 0;
  }

  wchar_t host[256] = {0};
  wchar_t path_buf[1792] = {0};
  wchar_t extra[512] = {0};
  URL_COMPONENTS uc;
  ZeroMemory(&uc, sizeof(uc));
  uc.dwStructSize = sizeof(uc);
  uc.lpszHostName = host;
  uc.dwHostNameLength = 256;
  uc.lpszUrlPath = path_buf;
  uc.dwUrlPathLength = 1500;
  uc.lpszExtraInfo = extra;
  uc.dwExtraInfoLength = 512;

  if (!WinHttpCrackUrl(wurl, 0, 0, &uc)) {
    if (err_buf) _snprintf(err_buf, err_cap, "No se pudo analizar URL (%lu)", GetLastError());
    return 0;
  }

  wchar_t full_path[2048];
  _snwprintf(full_path, 2048, L"%ls%ls", path_buf[0] ? path_buf : L"/", extra);
  full_path[2047] = L'\0';

  HINTERNET hConnect = WinHttpConnect(hSession, host, uc.nPort, 0);
  if (!hConnect) {
    if (err_buf) _snprintf(err_buf, err_cap, "Error conectando al servidor (%lu)", GetLastError());
    return 0;
  }

  DWORD flags = (uc.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
  HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", full_path, NULL,
                                          WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
  if (!hRequest) {
    WinHttpCloseHandle(hConnect);
    if (err_buf) _snprintf(err_buf, err_cap, "Error creando petición HTTP (%lu)", GetLastError());
    return 0;
  }

  DWORD redir = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
  WinHttpSetOption(hRequest, WINHTTP_OPTION_REDIRECT_POLICY, &redir, sizeof(redir));

  if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
      !WinHttpReceiveResponse(hRequest, NULL)) {
    DWORD le = GetLastError();
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    if (err_buf) _snprintf(err_buf, err_cap, "Sin respuesta de red (%lu)", le);
    return 0;
  }

  DWORD status_code = 0;
  DWORD sc_len = sizeof(status_code);
  WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX, &status_code, &sc_len, WINHTTP_NO_HEADER_INDEX);
  if (status_code < 200 || status_code >= 300) {
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    if (err_buf) _snprintf(err_buf, err_cap, "HTTP %lu", (unsigned long)status_code);
    return 0;
  }

  HANDLE hFile = INVALID_HANDLE_VALUE;
  wchar_t tmp_path[MAX_PATH] = {0};
  if (dest_file) {
    ensure_parent_dir_w(dest_file);
    _snwprintf(tmp_path, MAX_PATH, L"%ls.tmp.%lu", dest_file, (unsigned long)GetCurrentThreadId());
    tmp_path[MAX_PATH - 1] = L'\0';
    hFile = CreateFileW(tmp_path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
      WinHttpCloseHandle(hRequest);
      WinHttpCloseHandle(hConnect);
      if (err_buf) _snprintf(err_buf, err_cap, "No se pudo crear archivo en disco (%lu)", GetLastError());
      return 0;
    }
  }

  char* mem_buf = NULL;
  size_t mem_len = 0;
  size_t mem_cap = 0;
  if (!dest_file) {
    mem_cap = 8192;
    mem_buf = (char*)malloc(mem_cap);
  }

  uint8_t chunk[32768];
  int ok = 1;
  for (;;) {
    DWORD avail = 0;
    if (!WinHttpQueryDataAvailable(hRequest, &avail)) {
      ok = 0;
      break;
    }
    if (avail == 0) break;

    while (avail > 0) {
      DWORD to_read = avail > sizeof(chunk) ? (DWORD)sizeof(chunk) : avail;
      DWORD rd = 0;
      if (!WinHttpReadData(hRequest, chunk, to_read, &rd)) {
        ok = 0;
        break;
      }
      if (rd == 0) break;
      avail -= rd;

      if (hFile != INVALID_HANDLE_VALUE) {
        DWORD wr = 0;
        if (!WriteFile(hFile, chunk, rd, &wr, NULL) || wr != rd) {
          ok = 0;
          break;
        }
      } else {
        if (mem_len + rd + 1 > mem_cap) {
          size_t ncap = mem_cap * 2;
          while (ncap < mem_len + rd + 1) ncap *= 2;
          if (ncap > 64u * 1024u * 1024u) {
            ok = 0;
            break;
          }
          char* nb = (char*)realloc(mem_buf, ncap);
          if (!nb) {
            ok = 0;
            break;
          }
          mem_buf = nb;
          mem_cap = ncap;
        }
        memcpy(mem_buf + mem_len, chunk, rd);
        mem_len += rd;
      }
    }
    if (!ok) break;
  }

  WinHttpCloseHandle(hRequest);
  WinHttpCloseHandle(hConnect);

  if (hFile != INVALID_HANDLE_VALUE) {
    CloseHandle(hFile);
    if (ok) {
      if (!MoveFileExW(tmp_path, dest_file, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tmp_path);
        if (err_buf) _snprintf(err_buf, err_cap, "Error moviendo archivo descargado (%lu)", GetLastError());
        return 0;
      }
    } else {
      DeleteFileW(tmp_path);
      if (err_buf) _snprintf(err_buf, err_cap, "Descarga interrumpida");
      return 0;
    }
    return 1;
  }

  if (!ok || !mem_buf) {
    free(mem_buf);
    if (err_buf) _snprintf(err_buf, err_cap, "Error leyendo respuesta HTTP");
    return 0;
  }
  mem_buf[mem_len] = '\0';
  *out_mem = mem_buf;
  *out_mem_len = mem_len;
  return 1;
}

static int http_download_file(
    HINTERNET hSession,
    const char* url,
    const wchar_t* dest_file,
    const char* expected_sha1,
    char* err_buf,
    size_t err_cap) {
  if (file_exists_nonempty_w(dest_file)) {
    if (!expected_sha1 || !expected_sha1[0]) return 1;
    char actual[41];
    if (compute_file_sha1_hex(dest_file, actual) && _stricmp(actual, expected_sha1) == 0) {
      return 1;
    }
  }

  for (int attempt = 1; attempt <= 2; attempt++) {
    char local_err[256] = {0};
    if (http_fetch_once(hSession, url, dest_file, NULL, NULL, local_err, sizeof(local_err))) {
      return 1;
    }
    if (attempt == 2 && err_buf) {
      _snprintf(err_buf, err_cap, "Error descargando %s: %s", url, local_err);
    }
    Sleep(300);
  }
  return 0;
}

static char* http_get_text(
    HINTERNET hSession,
    const char* url,
    size_t* out_len,
    char* err_buf,
    size_t err_cap) {
  for (int attempt = 1; attempt <= 2; attempt++) {
    char* mem = NULL;
    size_t mlen = 0;
    char local_err[256] = {0};
    if (http_fetch_once(hSession, url, NULL, &mem, &mlen, local_err, sizeof(local_err))) {
      if (out_len) *out_len = mlen;
      return mem;
    }
    if (attempt == 2 && err_buf) {
      _snprintf(err_buf, err_cap, "Error consultando %s: %s", url, local_err);
    }
    Sleep(300);
  }
  return NULL;
}

static PanJsonValue* http_get_json(
    HINTERNET hSession,
    const char* url,
    char* err_buf,
    size_t err_cap) {
  size_t mlen = 0;
  char* mem = http_get_text(hSession, url, &mlen, err_buf, err_cap);
  if (!mem) return NULL;
  PanJsonValue* v = pan_json_parse(mem, mlen);
  free(mem);
  if (!v && err_buf) _snprintf(err_buf, err_cap, "JSON inválido desde %s", url);
  return v;
}

/* =========================================================================
 * Dynamic Collections & Zip Native DLL Extractor
 * ========================================================================= */

typedef struct {
  char** items;
  size_t count;
  size_t cap;
} PanStrList;

static void strlist_add(PanStrList* l, const char* s) {
  if (!s) return;
  if (l->count >= l->cap) {
    size_t ncap = l->cap ? l->cap * 2 : 16;
    char** ni = (char**)realloc(l->items, ncap * sizeof(char*));
    if (!ni) return;
    l->items = ni;
    l->cap = ncap;
  }
  l->items[l->count++] = xstrdup(s);
}

static int strlist_contains(const PanStrList* l, const char* s) {
  if (!s) return 0;
  for (size_t i = 0; i < l->count; i++) {
    if (strcmp(l->items[i], s) == 0) return 1;
  }
  return 0;
}

static void strlist_free(PanStrList* l) {
  for (size_t i = 0; i < l->count; i++) free(l->items[i]);
  free(l->items);
  l->items = NULL;
  l->count = 0;
  l->cap = 0;
}

typedef struct {
  char* key;
  wchar_t* val;
} PanCpEntry;

typedef struct {
  PanCpEntry* items;
  size_t count;
  size_t cap;
} PanCpMap;

static void cpmap_set(PanCpMap* m, const char* key, const wchar_t* val) {
  for (size_t i = 0; i < m->count; i++) {
    if (strcmp(m->items[i].key, key) == 0) {
      free(m->items[i].val);
      m->items[i].val = _wcsdup(val);
      return;
    }
  }
  if (m->count >= m->cap) {
    size_t ncap = m->cap ? m->cap * 2 : 64;
    PanCpEntry* ni = (PanCpEntry*)realloc(m->items, ncap * sizeof(PanCpEntry));
    if (!ni) return;
    m->items = ni;
    m->cap = ncap;
  }
  m->items[m->count].key = xstrdup(key);
  m->items[m->count].val = _wcsdup(val);
  m->count++;
}

static void cpmap_free(PanCpMap* m) {
  for (size_t i = 0; i < m->count; i++) {
    free(m->items[i].key);
    free(m->items[i].val);
  }
  free(m->items);
  m->items = NULL;
  m->count = 0;
  m->cap = 0;
}

static int is_safe_rel_path_a(const char* rel) {
  if (!rel || !rel[0] || rel[0] == '/' || rel[0] == '\\' ||
      strstr(rel, "..") != NULL || strchr(rel, ':') != NULL) {
    return 0;
  }
  return 1;
}

static int is_safe_version_token_a(const char* val) {
  if (!val || !val[0]) return 0;
  size_t len = strlen(val);
  if (len == 0 || len > 64 || strstr(val, "..") != NULL) return 0;
  unsigned char first = (unsigned char)val[0];
  if (!isalnum(first)) return 0;
  for (size_t i = 0; val[i]; i++) {
    unsigned char c = (unsigned char)val[i];
    if (!(isalnum(c) || c == '.' || c == '_' || c == '+' || c == '-')) return 0;
  }
  return 1;
}

static int is_legacy_pack_mc_version_a(const char* mc_ver) {
  if (!mc_ver) return 0;
  if (strncmp(mc_ver, "1.", 2) != 0) return 0;
  int minor = atoi(mc_ver + 2);
  return minor > 0 && minor <= 12;
}

static int extract_full_zip_cb(
    const char* name,
    const uint8_t* data,
    size_t data_len,
    size_t idx,
    size_t total,
    void* user) {
  (void)idx;
  (void)total;
  const wchar_t* target_dir = (const wchar_t*)user;
  if (!is_safe_rel_path_a(name)) return 0;
  wchar_t wrel[512];
  if (!utf8_to_wide(name, wrel, 512)) return 0;
  for (int i = 0; wrel[i]; i++) {
    if (wrel[i] == L'/') wrel[i] = L'\\';
  }
  wchar_t raw_dest[MAX_PATH], canon_base[MAX_PATH], dest[MAX_PATH];
  if (_snwprintf(raw_dest, MAX_PATH, L"%ls\\%ls", target_dir, wrel) >= MAX_PATH) return 0;
  raw_dest[MAX_PATH - 1] = L'\0';
  DWORD bl = GetFullPathNameW(target_dir, MAX_PATH, canon_base, NULL);
  DWORD dl = GetFullPathNameW(raw_dest, MAX_PATH, dest, NULL);
  if (bl == 0 || bl >= MAX_PATH || dl == 0 || dl >= MAX_PATH) return 0;
  if (_wcsnicmp(dest, canon_base, bl) != 0 || (dest[bl] != L'\\' && dest[bl] != L'\0')) return 0;
  return write_entire_file_w(dest, data, data_len);
}

static int extract_native_dll_cb(
    const char* name,
    const uint8_t* data,
    size_t data_len,
    size_t idx,
    size_t total,
    void* user) {
  (void)idx;
  (void)total;
  const wchar_t* natives_dir = (const wchar_t*)user;
  size_t nlen = strlen(name);
  int is_dll = (nlen > 4 && _stricmp(name + nlen - 4, ".dll") == 0);
  int is_so = (nlen > 3 && _stricmp(name + nlen - 3, ".so") == 0);
  if (!is_dll && !is_so) return 1;

  const char* base = strrchr(name, '/');
  base = base ? base + 1 : name;
  if (!base[0]) return 1;

  wchar_t wbase[256];
  if (!utf8_to_wide(base, wbase, 256)) return 1;
  wchar_t dest[MAX_PATH];
  _snwprintf(dest, MAX_PATH, L"%ls\\%ls", natives_dir, wbase);
  dest[MAX_PATH - 1] = L'\0';
  return write_entire_file_w(dest, data, data_len);
}

static void clean_natives_dir_w(const wchar_t* natives_dir) {
  wchar_t pattern[MAX_PATH];
  _snwprintf(pattern, MAX_PATH, L"%ls\\*", natives_dir);
  pattern[MAX_PATH - 1] = L'\0';
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pattern, &fd);
  if (h == INVALID_HANDLE_VALUE) return;
  do {
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
    wchar_t full[MAX_PATH];
    _snwprintf(full, MAX_PATH, L"%ls\\%ls", natives_dir, fd.cFileName);
    full[MAX_PATH - 1] = L'\0';
    DeleteFileW(full);
  } while (FindNextFileW(h, &fd));
  FindClose(h);
}

static void extract_native_jar_dlls(const wchar_t* jar_path, const wchar_t* natives_dir) {
  size_t len = 0;
  uint8_t* buf = read_entire_file_w(jar_path, &len);
  if (!buf) return;
  pan_zip_extract_memory(buf, len, extract_native_dll_cb, (void*)natives_dir);
  free(buf);
}

static int find_javaw_recursive(const wchar_t* dir, wchar_t* out_path, size_t cap) {
  wchar_t pattern[MAX_PATH];
  _snwprintf(pattern, MAX_PATH, L"%ls\\*", dir);
  pattern[MAX_PATH - 1] = L'\0';

  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pattern, &fd);
  if (h == INVALID_HANDLE_VALUE) return 0;

  int found = 0;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    wchar_t full[MAX_PATH];
    _snwprintf(full, MAX_PATH, L"%ls\\%ls", dir, fd.cFileName);
    full[MAX_PATH - 1] = L'\0';
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (find_javaw_recursive(full, out_path, cap)) {
        found = 1;
        break;
      }
    } else if (_wcsicmp(fd.cFileName, L"javaw.exe") == 0) {
      wcsncpy(out_path, full, cap - 1);
      out_path[cap - 1] = L'\0';
      found = 1;
      break;
    }
  } while (FindNextFileW(h, &fd));

  FindClose(h);
  return found;
}

static int parse_java_major_from_text(const char* txt) {
  if (!txt) return 0;
  const char* p = strstr(txt, "version \"");
  if (!p) return 0;
  p += 9;
  int first = atoi(p);
  if (first == 1) {
    const char* dot = strchr(p, '.');
    if (dot) return atoi(dot + 1);
  }
  return first;
}

static int probe_java_major(const wchar_t* exe_path) {
  if (!exe_path || !file_exists_nonempty_w(exe_path)) return 0;
  wchar_t probe_exe[MAX_PATH];
  wcsncpy(probe_exe, exe_path, MAX_PATH - 1);
  probe_exe[MAX_PATH - 1] = L'\0';
  size_t len = wcslen(probe_exe);
  if (len >= 9 && _wcsicmp(probe_exe + len - 9, L"javaw.exe") == 0) {
    wchar_t java_sibling[MAX_PATH];
    wcsncpy(java_sibling, probe_exe, MAX_PATH - 1);
    java_sibling[MAX_PATH - 1] = L'\0';
    wcscpy(java_sibling + len - 9, L"java.exe");
    if (file_exists_nonempty_w(java_sibling)) {
      wcscpy(probe_exe, java_sibling);
    }
  }

  SECURITY_ATTRIBUTES sa;
  ZeroMemory(&sa, sizeof(sa));
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;

  HANDLE hRead = NULL, hWrite = NULL;
  if (!CreatePipe(&hRead, &hWrite, &sa, 0)) return 0;
  SetHandleInformation(hRead, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = hWrite;
  si.hStdError = hWrite;
  si.hStdInput = INVALID_HANDLE_VALUE;

  wchar_t cmd[MAX_PATH + 32];
  _snwprintf(cmd, MAX_PATH + 32, L"\"%ls\" -version", probe_exe);
  cmd[MAX_PATH + 31] = L'\0';

  int major = 0;
  if (CreateProcessW(probe_exe, cmd, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
    CloseHandle(hWrite);
    hWrite = INVALID_HANDLE_VALUE;
    char out[2048];
    DWORD total = 0, rd = 0;
    WaitForSingleObject(pi.hProcess, 3000);
    while (total + 1 < sizeof(out) && ReadFile(hRead, out + total, (DWORD)(sizeof(out) - 1 - total), &rd, NULL) && rd > 0) {
      total += rd;
    }
    out[total] = '\0';
    major = parse_java_major_from_text(out);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
  }
  if (hWrite != INVALID_HANDLE_VALUE && hWrite != NULL) CloseHandle(hWrite);
  if (hRead != NULL) CloseHandle(hRead);
  return major;
}

static int java_matches_req(int major, int req_major) {
  if (major <= 0) return 0;
  if (req_major >= 25) return major >= req_major;
  return major == req_major;
}

static void javaw_to_java_exe(const wchar_t* javaw_path, wchar_t* out_java, size_t cap) {
  wcsncpy(out_java, javaw_path, cap - 1);
  out_java[cap - 1] = L'\0';
  size_t len = wcslen(out_java);
  if (len >= 9 && _wcsicmp(out_java + len - 9, L"javaw.exe") == 0) {
    wchar_t cand[MAX_PATH];
    wcsncpy(cand, out_java, MAX_PATH - 1);
    cand[MAX_PATH - 1] = L'\0';
    wcscpy(cand + len - 9, L"java.exe");
    if (file_exists_nonempty_w(cand)) {
      wcsncpy(out_java, cand, cap - 1);
      out_java[cap - 1] = L'\0';
    }
  }
}

static int find_matching_javaw_in_tree(const wchar_t* dir, int req_major, int depth, wchar_t* out_path, size_t cap) {
  if (!dir || !dir[0] || depth > 4) return 0;
  wchar_t direct[MAX_PATH];
  _snwprintf(direct, MAX_PATH, L"%ls\\bin\\javaw.exe", dir);
  direct[MAX_PATH - 1] = L'\0';
  if (file_exists_nonempty_w(direct)) {
    int m = probe_java_major(direct);
    if (java_matches_req(m, req_major)) {
      wcsncpy(out_path, direct, cap - 1);
      out_path[cap - 1] = L'\0';
      return 1;
    }
  }
  _snwprintf(direct, MAX_PATH, L"%ls\\javaw.exe", dir);
  direct[MAX_PATH - 1] = L'\0';
  if (file_exists_nonempty_w(direct)) {
    int m = probe_java_major(direct);
    if (java_matches_req(m, req_major)) {
      wcsncpy(out_path, direct, cap - 1);
      out_path[cap - 1] = L'\0';
      return 1;
    }
  }

  wchar_t pattern[MAX_PATH];
  _snwprintf(pattern, MAX_PATH, L"%ls\\*", dir);
  pattern[MAX_PATH - 1] = L'\0';
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(pattern, &fd);
  if (h == INVALID_HANDLE_VALUE) return 0;
  int found = 0;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
    wchar_t sub[MAX_PATH];
    _snwprintf(sub, MAX_PATH, L"%ls\\%ls", dir, fd.cFileName);
    sub[MAX_PATH - 1] = L'\0';
    if (find_matching_javaw_in_tree(sub, req_major, depth + 1, out_path, cap)) {
      found = 1;
      break;
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return found;
}

static int find_system_javaw(int req_major, const char* custom_path_utf8, wchar_t* out_path, size_t cap) {
  if (custom_path_utf8 && custom_path_utf8[0]) {
    wchar_t wcustom[MAX_PATH];
    if (utf8_to_wide(custom_path_utf8, wcustom, MAX_PATH) && file_exists_nonempty_w(wcustom)) {
      int m = probe_java_major(wcustom);
      if (java_matches_req(m, req_major) || m == 0) {
        wcsncpy(out_path, wcustom, cap - 1);
        out_path[cap - 1] = L'\0';
        return 1;
      }
    }
  }

  wchar_t env_val[MAX_PATH] = {0};
  if (GetEnvironmentVariableW(L"JAVA_HOME", env_val, MAX_PATH) > 0) {
    if (find_matching_javaw_in_tree(env_val, req_major, 0, out_path, cap)) return 1;
  }

  const wchar_t* roots[2] = {NULL, NULL};
  wchar_t pf[MAX_PATH] = {0}, pf86[MAX_PATH] = {0};
  if (GetEnvironmentVariableW(L"ProgramFiles", pf, MAX_PATH) > 0) roots[0] = pf;
  if (GetEnvironmentVariableW(L"ProgramFiles(x86)", pf86, MAX_PATH) > 0) roots[1] = pf86;

  static const wchar_t* VENDORS[] = {
    L"Eclipse Adoptium",
    L"Java",
    L"Microsoft",
    L"Zulu",
    L"BellSoft",
    L"Amazon Corretto",
    L"SapMachine",
    NULL
  };
  for (int r = 0; r < 2; r++) {
    if (!roots[r]) continue;
    for (int v = 0; VENDORS[v]; v++) {
      wchar_t vdir[MAX_PATH];
      _snwprintf(vdir, MAX_PATH, L"%ls\\%ls", roots[r], VENDORS[v]);
      vdir[MAX_PATH - 1] = L'\0';
      if (find_matching_javaw_in_tree(vdir, req_major, 0, out_path, cap)) return 1;
    }
  }

  wchar_t localapp[MAX_PATH] = {0}, appdata[MAX_PATH] = {0};
  if (GetEnvironmentVariableW(L"LOCALAPPDATA", localapp, MAX_PATH) > 0) {
    wchar_t ad_dir[MAX_PATH];
    _snwprintf(ad_dir, MAX_PATH, L"%ls\\Programs\\Eclipse Adoptium", localapp);
    ad_dir[MAX_PATH - 1] = L'\0';
    if (find_matching_javaw_in_tree(ad_dir, req_major, 0, out_path, cap)) return 1;
  }
  if (GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH) > 0) {
    wchar_t mc_rt[MAX_PATH];
    _snwprintf(mc_rt, MAX_PATH, L"%ls\\.minecraft\\runtime", appdata);
    mc_rt[MAX_PATH - 1] = L'\0';
    if (find_matching_javaw_in_tree(mc_rt, req_major, 0, out_path, cap)) return 1;
  }

  wchar_t path_hit[MAX_PATH] = {0};
  if (SearchPathW(NULL, L"javaw.exe", NULL, MAX_PATH, path_hit, NULL) > 0) {
    int m = probe_java_major(path_hit);
    if (java_matches_req(m, req_major)) {
      wcsncpy(out_path, path_hit, cap - 1);
      out_path[cap - 1] = L'\0';
      return 1;
    }
  }
  return 0;
}

/* =========================================================================
 * Mojang Rules & Maven Coordinates
 * ========================================================================= */

static int test_mojang_rules(const PanJsonValue* rules) {
  if (!rules || rules->type != PAN_JSON_ARRAY || rules->u.arr.count == 0) return 1;
  int allowed = 0;
  for (size_t i = 0; i < rules->u.arr.count; i++) {
    const PanJsonValue* rule = rules->u.arr.items[i];
    if (pan_json_get(rule, "features")) continue;
    int os_match = 1;
    const PanJsonValue* os_obj = pan_json_get(rule, "os");
    if (os_obj && os_obj->type == PAN_JSON_OBJECT) {
      const char* os_name = pan_json_str(pan_json_get(os_obj, "name"), NULL);
      const char* os_arch = pan_json_str(pan_json_get(os_obj, "arch"), NULL);
      if (os_name && strcmp(os_name, "windows") != 0) os_match = 0;
      if (os_arch && strcmp(os_arch, "x86_64") != 0 && strcmp(os_arch, "amd64") != 0) os_match = 0;
    }
    if (os_match) {
      const char* action = pan_json_str(pan_json_get(rule, "action"), "");
      allowed = (strcmp(action, "allow") == 0);
    }
  }
  return allowed;
}

static void split_ga_key(const char* maven_name, char* out_ga, size_t cap) {
  const char* c1 = strchr(maven_name, ':');
  if (!c1) {
    strncpy(out_ga, maven_name, cap - 1);
    out_ga[cap - 1] = '\0';
    return;
  }
  const char* c2 = strchr(c1 + 1, ':');
  size_t ga_len = c2 ? (size_t)(c2 - maven_name) : strlen(maven_name);
  if (ga_len >= cap) ga_len = cap - 1;
  memcpy(out_ga, maven_name, ga_len);
  out_ga[ga_len] = '\0';
  if (c2) {
    const char* c3 = strchr(c2 + 1, ':');
    if (c3 && c3[1] && ga_len + 1 + strlen(c3) < cap) {
      out_ga[ga_len] = ':';
      strcpy(out_ga + ga_len + 1, c3 + 1);
    }
  }
}

static int maven_coord_to_rel_path(const char* coord, char* out, size_t cap) {
  char tmp[512];
  strncpy(tmp, coord, sizeof(tmp) - 1);
  tmp[sizeof(tmp) - 1] = '\0';
  char* p1 = strchr(tmp, ':');
  if (!p1) return 0;
  *p1++ = '\0';
  char* p2 = strchr(p1, ':');
  if (!p2) return 0;
  *p2++ = '\0';
  char* p3 = strchr(p2, ':');
  char* cls = NULL;
  if (p3) {
    *p3++ = '\0';
    cls = p3;
  }
  for (char* g = tmp; *g; g++) {
    if (*g == '.') *g = '/';
  }
  if (cls && cls[0]) {
    _snprintf(out, cap, "%s/%s/%s/%s-%s-%s.jar", tmp, p1, p2, p1, p2, cls);
  } else {
    _snprintf(out, cap, "%s/%s/%s/%s-%s.jar", tmp, p1, p2, p1, p2);
  }
  out[cap - 1] = '\0';
  return 1;
}

/* =========================================================================
 * Parallel Asset / Library Download Workers
 * ========================================================================= */

typedef struct {
  char url[1024];
  wchar_t dest[MAX_PATH];
  char sha1[48];
  int is_native_jar;
  int copy_mc_local;
  wchar_t mc_local_src[MAX_PATH];
} PanDlTask;

typedef struct {
  PanDlTask* tasks;
  size_t count;
  volatile LONG next_idx;
  volatile LONG done_cnt;
  const wchar_t* natives_dir;
  int base_pct;
  int span_pct;
  const char* label;
  int fatal_on_fail;
  volatile LONG failed_flag;
  char fail_msg[512];
} PanDlPool;

static DWORD WINAPI dl_pool_worker(LPVOID param) {
  PanDlPool* pool = (PanDlPool*)param;
  HINTERNET hSess = create_winhttp_session();
  if (!hSess) {
    if (pool->fatal_on_fail && InterlockedCompareExchange(&pool->failed_flag, 1, 0) == 0) {
      _snprintf(pool->fail_msg, sizeof(pool->fail_msg), "No se pudo inicializar WinHTTP");
    }
    return 1;
  }

  for (;;) {
    LONG idx = InterlockedIncrement(&pool->next_idx) - 1;
    if (idx < 0 || (size_t)idx >= pool->count) break;
    if (pool->failed_flag && pool->fatal_on_fail) break;

    PanDlTask* t = &pool->tasks[idx];
    if (t->copy_mc_local) {
      ensure_parent_dir_w(t->dest);
      if (CopyFileW(t->mc_local_src, t->dest, FALSE)) {
        InterlockedIncrement(&pool->done_cnt);
        continue;
      }
    }

    char err[512] = {0};
    if (!http_download_file(hSess, t->url, t->dest, t->sha1, err, sizeof(err))) {
      if (pool->fatal_on_fail && InterlockedCompareExchange(&pool->failed_flag, 1, 0) == 0) {
        strncpy(pool->fail_msg, err, sizeof(pool->fail_msg) - 1);
      }
    } else if (t->is_native_jar && pool->natives_dir) {
      extract_native_jar_dlls(t->dest, pool->natives_dir);
    }

    LONG done = InterlockedIncrement(&pool->done_cnt);
    if (pool->count > 0 && (done % 40 == 0 || (size_t)done == pool->count)) {
      int pct = pool->base_pct + (int)(((double)done / (double)pool->count) * pool->span_pct);
      set_pan_statusf("downloading", pct, "%s: %ld / %llu...", pool->label, done, (unsigned long long)pool->count);
    }
  }

  WinHttpCloseHandle(hSess);
  return 0;
}

static int run_dl_pool(PanDlPool* pool, int num_threads) {
  if (pool->count == 0) return 1;
  int n = (int)pool->count < num_threads ? (int)pool->count : num_threads;
  if (n < 1) n = 1;
  if (n > 8) n = 8;

  HANDLE threads[8];
  for (int i = 0; i < n; i++) {
    threads[i] = CreateThread(NULL, 0, dl_pool_worker, pool, 0, NULL);
  }
  WaitForMultipleObjects((DWORD)n, threads, TRUE, INFINITE);
  for (int i = 0; i < n; i++) {
    if (threads[i]) CloseHandle(threads[i]);
  }
  return !(pool->fatal_on_fail && pool->failed_flag);
}

/* =========================================================================
 * Command Line / String Replacement / Log Tail
 * ========================================================================= */

static void str_replace_all(const char* src, const char* needle, const char* rep, char* out, size_t cap) {
  size_t nlen = strlen(needle);
  size_t rlen = strlen(rep);
  size_t j = 0;
  for (size_t i = 0; src[i] && j + 1 < cap;) {
    if (nlen > 0 && strncmp(src + i, needle, nlen) == 0) {
      if (j + rlen + 1 >= cap) break;
      memcpy(out + j, rep, rlen);
      j += rlen;
      i += nlen;
    } else {
      out[j++] = src[i++];
    }
  }
  out[j] = '\0';
}

static void read_log_tail_safe(const wchar_t* path, char* out, size_t cap) {
  if (!out || cap == 0) return;
  out[0] = '\0';
  size_t len = 0;
  uint8_t* raw = read_entire_file_w(path, &len);
  if (!raw || len == 0) {
    free(raw);
    return;
  }
  size_t start = len > 1400 ? len - 1400 : 0;
  size_t j = 0;
  for (size_t i = start; i < len && j + 2 < cap; i++) {
    char c = (char)raw[i];
    if (c == '\r') continue;
    if (c == '\n') c = ' ';
    out[j++] = c;
  }
  out[j] = '\0';
  free(raw);
}

static void read_log_head_safe(const wchar_t* path, char* out, size_t cap) {
  if (!out || cap == 0) return;
  out[0] = '\0';
  size_t len = 0;
  uint8_t* raw = read_entire_file_w(path, &len);
  if (!raw || len == 0) {
    free(raw);
    return;
  }
  size_t lim = len > 1400 ? 1400 : len;
  size_t j = 0;
  for (size_t i = 0; i < lim && j + 2 < cap; i++) {
    char c = (char)raw[i];
    if (c == '\r') continue;
    if (c == '\n') c = ' ';
    out[j++] = c;
  }
  out[j] = '\0';
  free(raw);
}

static int find_newest_file_w(const wchar_t* dir, const wchar_t* glob_pat, wchar_t* out_path, size_t cap) {
  wchar_t search[MAX_PATH];
  _snwprintf(search, MAX_PATH, L"%ls\\%ls", dir, glob_pat);
  search[MAX_PATH - 1] = L'\0';
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(search, &fd);
  if (h == INVALID_HANDLE_VALUE) return 0;
  FILETIME best_ft = {0, 0};
  int found = 0;
  do {
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
    if (!found || CompareFileTime(&fd.ftLastWriteTime, &best_ft) > 0) {
      best_ft = fd.ftLastWriteTime;
      _snwprintf(out_path, cap, L"%ls\\%ls", dir, fd.cFileName);
      out_path[cap - 1] = L'\0';
      found = 1;
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return found;
}

static void find_crash_tail_w(
    const wchar_t* instance_dir,
    const wchar_t* err_log,
    const wchar_t* out_log,
    char* out,
    size_t cap) {
  if (!out || cap == 0) return;
  out[0] = '\0';
  wchar_t newest[MAX_PATH];
  wchar_t cr_dir[MAX_PATH];
  _snwprintf(cr_dir, MAX_PATH, L"%ls\\crash-reports", instance_dir);
  if (find_newest_file_w(instance_dir, L"hs_err_pid*.log", newest, MAX_PATH)) {
    read_log_head_safe(newest, out, cap);
    if (out[0]) return;
  }
  if (find_newest_file_w(cr_dir, L"crash-*.txt", newest, MAX_PATH)) {
    read_log_head_safe(newest, out, cap);
    if (out[0]) return;
  }
  read_log_tail_safe(err_log, out, cap);
  if (out[0]) return;
  {
    wchar_t mc_log[MAX_PATH];
    _snwprintf(mc_log, MAX_PATH, L"%ls\\logs\\latest.log", instance_dir);
    read_log_tail_safe(mc_log, out, cap);
    if (out[0]) return;
  }
  read_log_tail_safe(out_log, out, cap);
}

static void merge_options_txt_w(const wchar_t* opt_path, const char* new_txt) {
  if (!new_txt || !new_txt[0]) return;
  size_t ex_len = 0;
  uint8_t* ex_raw = read_entire_file_w(opt_path, &ex_len);
  if (!ex_raw || ex_len == 0) {
    free(ex_raw);
    write_entire_file_w(opt_path, new_txt, strlen(new_txt));
    return;
  }

  PanStrList lines = {0};
  {
    char* ex_str = (char*)malloc(ex_len + 1);
    if (!ex_str) {
      free(ex_raw);
      return;
    }
    memcpy(ex_str, ex_raw, ex_len);
    ex_str[ex_len] = '\0';
    free(ex_raw);
    char* cur = ex_str;
    while (*cur) {
      char* nl = strchr(cur, '\n');
      if (nl) *nl = '\0';
      size_t ll = strlen(cur);
      while (ll > 0 && cur[ll - 1] == '\r') cur[--ll] = '\0';
      if (cur[0]) strlist_add(&lines, cur);
      if (!nl) break;
      cur = nl + 1;
    }
    free(ex_str);
  }

  {
    char* nw = xstrdup(new_txt);
    if (nw) {
      char* cur = nw;
      while (*cur) {
        char* nl = strchr(cur, '\n');
        if (nl) *nl = '\0';
        size_t ll = strlen(cur);
        while (ll > 0 && cur[ll - 1] == '\r') cur[--ll] = '\0';
        if (cur[0] && cur[0] != '#') {
          char* colon = strchr(cur, ':');
          if (colon && colon > cur) {
            size_t klen = (size_t)(colon - cur);
            int replaced = 0;
            for (size_t i = 0; i < lines.count; i++) {
              if (strncmp(lines.items[i], cur, klen) == 0 && lines.items[i][klen] == ':') {
                free(lines.items[i]);
                lines.items[i] = xstrdup(cur);
                replaced = 1;
                break;
              }
            }
            if (!replaced) strlist_add(&lines, cur);
          }
        }
        if (!nl) break;
        cur = nl + 1;
      }
      free(nw);
    }
  }

  size_t total = 1;
  for (size_t i = 0; i < lines.count; i++) {
    total += strlen(lines.items[i]) + 1;
  }
  char* merged = (char*)malloc(total + 1);
  if (merged) {
    size_t pos = 0;
    for (size_t i = 0; i < lines.count; i++) {
      size_t ll = strlen(lines.items[i]);
      memcpy(merged + pos, lines.items[i], ll);
      pos += ll;
      merged[pos++] = '\n';
    }
    merged[pos] = '\0';
    write_entire_file_w(opt_path, merged, pos);
    free(merged);
  }
  strlist_free(&lines);
}

static void merge_resource_packs_w(const wchar_t* opt_path, const PanJsonValue* arr, const char* mc_ver) {
  if (!arr || arr->type != PAN_JSON_ARRAY) return;
  int legacy = is_legacy_pack_mc_version_a(mc_ver);

  size_t rp_cap = 8192;
  char* rp_line = (char*)malloc(rp_cap);
  if (!rp_line) return;
  size_t pos = 0;
  pos += (size_t)_snprintf(rp_line + pos, rp_cap - pos, "resourcePacks:[%s", legacy ? "" : "\"vanilla\"");
  int entry_cnt = legacy ? 0 : 1;

  for (size_t i = 0; i < arr->u.arr.count; i++) {
    const char* raw_fn = pan_json_str(arr->u.arr.items[i], NULL);
    if (!raw_fn || !raw_fn[0]) continue;
    if (strstr(raw_fn, "..") || strchr(raw_fn, '/') || strchr(raw_fn, '\\') ||
        strchr(raw_fn, '"') || strchr(raw_fn, '\n') || strchr(raw_fn, '\r')) {
      continue;
    }
    char entry_buf[540];
    if (legacy) _snprintf(entry_buf, sizeof(entry_buf), "\"%s\"", raw_fn);
    else _snprintf(entry_buf, sizeof(entry_buf), "\"file/%s\"", raw_fn);
    entry_buf[sizeof(entry_buf) - 1] = '\0';
    size_t elen = strlen(entry_buf);
    if (pos + elen + 16 < rp_cap) {
      if (entry_cnt > 0) rp_line[pos++] = ',';
      memcpy(rp_line + pos, entry_buf, elen);
      pos += elen;
      entry_cnt++;
    }
  }
  rp_line[pos++] = ']';
  rp_line[pos] = '\0';

  PanStrList lines = {0};
  size_t ex_len = 0;
  uint8_t* ex_raw = read_entire_file_w(opt_path, &ex_len);
  int replaced = 0;
  int has_incompat = 0;
  if (ex_raw && ex_len > 0) {
    char* ex_str = (char*)malloc(ex_len + 1);
    if (ex_str) {
      memcpy(ex_str, ex_raw, ex_len);
      ex_str[ex_len] = '\0';
      char* cur = ex_str;
      while (*cur) {
        char* nl = strchr(cur, '\n');
        if (nl) *nl = '\0';
        size_t ll = strlen(cur);
        while (ll > 0 && cur[ll - 1] == '\r') cur[--ll] = '\0';
        if (strncmp(cur, "resourcePacks:", 14) == 0) {
          if (!replaced) {
            strlist_add(&lines, rp_line);
            replaced = 1;
          }
        } else if (strncmp(cur, "incompatibleResourcePacks:", 26) == 0) {
          strlist_add(&lines, "incompatibleResourcePacks:[]");
          has_incompat = 1;
        } else if (cur[0]) {
          strlist_add(&lines, cur);
        }
        if (!nl) break;
        cur = nl + 1;
      }
      free(ex_str);
    }
  }
  free(ex_raw);
  if (!replaced) strlist_add(&lines, rp_line);
  if (!has_incompat) strlist_add(&lines, "incompatibleResourcePacks:[]");
  free(rp_line);

  size_t total = 1;
  for (size_t i = 0; i < lines.count; i++) total += strlen(lines.items[i]) + 1;
  char* merged = (char*)malloc(total + 1);
  if (merged) {
    size_t out_p = 0;
    for (size_t i = 0; i < lines.count; i++) {
      size_t ll = strlen(lines.items[i]);
      memcpy(merged + out_p, lines.items[i], ll);
      out_p += ll;
      merged[out_p++] = '\n';
    }
    merged[out_p] = '\0';
    write_entire_file_w(opt_path, merged, out_p);
    free(merged);
  }
  strlist_free(&lines);
}

static char* build_quoted_argfile(const PanStrList* args) {
  size_t cap = 16384;
  size_t len = 0;
  char* buf = (char*)malloc(cap);
  if (!buf) return NULL;

  for (size_t i = 0; i < args->count; i++) {
    const char* a = args->items[i];
    size_t alen = strlen(a);
    int needs_q = (strchr(a, ' ') != NULL || strchr(a, '\\') != NULL || strchr(a, '"') != NULL || alen == 0);
    size_t need = alen * 2 + 8;
    if (len + need >= cap) {
      while (len + need >= cap) cap *= 2;
      char* nb = (char*)realloc(buf, cap);
      if (!nb) {
        free(buf);
        return NULL;
      }
      buf = nb;
    }
    if (needs_q) {
      buf[len++] = '"';
      for (size_t k = 0; k < alen; k++) {
        if (a[k] == '\\' || a[k] == '"') buf[len++] = '\\';
        buf[len++] = a[k];
      }
      buf[len++] = '"';
    } else {
      memcpy(buf + len, a, alen);
      len += alen;
    }
    buf[len++] = '\n';
  }
  buf[len] = '\0';
  return buf;
}

static char* build_win32_cmdline(const wchar_t* exe_path, const PanStrList* args) {
  char exe_utf8[MAX_PATH * 3];
  wide_to_utf8(exe_path, exe_utf8, sizeof(exe_utf8));

  size_t cap = 16384;
  size_t len = 0;
  char* buf = (char*)malloc(cap);
  if (!buf) return NULL;

  len += (size_t)_snprintf(buf + len, cap - len, "\"%s\"", exe_utf8);
  for (size_t i = 0; i < args->count; i++) {
    const char* a = args->items[i];
    size_t alen = strlen(a);
    int needs_q = (strchr(a, ' ') != NULL || strchr(a, '"') != NULL || alen == 0);
    if (len + alen * 2 + 8 >= cap) {
      while (len + alen * 2 + 8 >= cap) cap *= 2;
      char* nb = (char*)realloc(buf, cap);
      if (!nb) {
        free(buf);
        return NULL;
      }
      buf = nb;
    }
    buf[len++] = ' ';
    if (needs_q) {
      buf[len++] = '"';
      for (size_t k = 0; k < alen; k++) {
        if (a[k] == '"') buf[len++] = '\\';
        buf[len++] = a[k];
      }
      buf[len++] = '"';
    } else {
      memcpy(buf + len, a, alen);
      len += alen;
    }
  }
  buf[len] = '\0';
  return buf;
}

/* =========================================================================
 * Main Minecraft Launcher Thread
 * ========================================================================= */

static const struct {
  const char* mod_id;
  const char* slug;
} MODRINTH_SLUGS[] = {
  {"fabric-api", "fabric-api"},
  {"sodium", "sodium"},
  {"lithium", "lithium"},
  {"immediatelyfast", "immediatelyfast"},
  {"ferritecore", "ferrite-core"},
  {"entityculling", "entityculling"},
  {"modernfix", "modernfix"},
  {"moreculling", "moreculling"},
  {"krypton", "krypton"},
  {"c2me", "c2me-fabric"},
  {"nvidium", "nvidium"},
  {"vulkanmod", "vulkanmod"},
  {NULL, NULL}
};

static const char* map_mod_slug(const char* mod_id) {
  for (int i = 0; MODRINTH_SLUGS[i].mod_id; i++) {
    if (strcmp(MODRINTH_SLUGS[i].mod_id, mod_id) == 0) return MODRINTH_SLUGS[i].slug;
  }
  return NULL;
}

static int download_maven_lib(
    HINTERNET hSession,
    const char* name,
    const char* url_base,
    const wchar_t* libs_dir,
    PanCpMap* cp_map,
    char* err_buf,
    size_t err_cap) {
  char rel[512];
  if (!maven_coord_to_rel_path(name, rel, sizeof(rel))) return 0;
  wchar_t wrel[MAX_PATH], dest[MAX_PATH];
  utf8_to_wide(rel, wrel, MAX_PATH);
  for (int k = 0; wrel[k]; k++) if (wrel[k] == L'/') wrel[k] = L'\\';
  _snwprintf(dest, MAX_PATH, L"%ls\\%ls", libs_dir, wrel);
  dest[MAX_PATH - 1] = L'\0';

  if (file_exists_nonempty_w(dest)) {
    char ga[256];
    split_ga_key(name, ga, sizeof(ga));
    cpmap_set(cp_map, ga, dest);
    return 1;
  }

  const char* repos[4] = {
    (url_base && url_base[0]) ? url_base : NULL,
    "https://maven.minecraftforge.net/",
    "https://libraries.minecraft.net/",
    "https://repo1.maven.org/maven2/"
  };
  for (int r = 0; r < 4; r++) {
    if (!repos[r]) continue;
    char full_url[768];
    size_t blen = strlen(repos[r]);
    snprintf(full_url, sizeof(full_url), "%s%s%s",
             repos[r], (blen > 0 && repos[r][blen - 1] == '/') ? "" : "/", rel);
    char local_err[256] = {0};
    if (http_download_file(hSession, full_url, dest, NULL, local_err, sizeof(local_err))) {
      char ga[256];
      split_ga_key(name, ga, sizeof(ga));
      cpmap_set(cp_map, ga, dest);
      return 1;
    }
  }
  if (err_buf) {
    _snprintf(err_buf, err_cap, "No se pudo descargar la librería %s", name);
  }
  return 0;
}

static int apply_loader_json_libs(
    HINTERNET hSession,
    const PanJsonValue* ljson,
    const wchar_t* libs_dir,
    PanCpMap* cp_map,
    char* main_class,
    size_t main_cap,
    char* version_name,
    size_t vn_cap,
    PanStrList* extra_jvm,
    PanStrList* extra_game,
    char* err_buf,
    size_t err_cap) {
  if (!ljson || ljson->type != PAN_JSON_OBJECT) return 0;
  const char* lid = pan_json_str(pan_json_get(ljson, "id"), NULL);
  if (lid && lid[0] && version_name && vn_cap > 0) {
    strncpy(version_name, lid, vn_cap - 1);
    version_name[vn_cap - 1] = '\0';
  }
  const char* mc = pan_json_str(pan_json_get(ljson, "mainClass"), NULL);
  if (mc && mc[0]) {
    strncpy(main_class, mc, main_cap - 1);
    main_class[main_cap - 1] = '\0';
  }

  const PanJsonValue* libs = pan_json_get(ljson, "libraries");
  if (libs && libs->type == PAN_JSON_ARRAY) {
    for (size_t i = 0; i < libs->u.arr.count; i++) {
      const PanJsonValue* lib = libs->u.arr.items[i];
      if (!test_mojang_rules(pan_json_get(lib, "rules"))) continue;
      const char* lname = pan_json_str(pan_json_get(lib, "name"), "");
      if (!lname[0]) continue;
      const PanJsonValue* art = pan_json_get(pan_json_get(lib, "downloads"), "artifact");
      if (art) {
        const char* aurl = pan_json_str(pan_json_get(art, "url"), "");
        const char* apath = pan_json_str(pan_json_get(art, "path"), "");
        const char* asha = pan_json_str(pan_json_get(art, "sha1"), "");
        if (apath[0] && is_safe_rel_path_a(apath)) {
          wchar_t wrel[MAX_PATH], dest[MAX_PATH];
          utf8_to_wide(apath, wrel, MAX_PATH);
          for (int k = 0; wrel[k]; k++) if (wrel[k] == L'/') wrel[k] = L'\\';
          _snwprintf(dest, MAX_PATH, L"%ls\\%ls", libs_dir, wrel);
          dest[MAX_PATH - 1] = L'\0';
          if (file_exists_nonempty_w(dest)) {
            char ga[256];
            split_ga_key(lname, ga, sizeof(ga));
            cpmap_set(cp_map, ga, dest);
            continue;
          }
          if (aurl[0] && http_download_file(hSession, aurl, dest, asha, err_buf, err_cap)) {
            char ga[256];
            split_ga_key(lname, ga, sizeof(ga));
            cpmap_set(cp_map, ga, dest);
            continue;
          }
        }
      }
      const char* base_url = pan_json_str(pan_json_get(lib, "url"), "");
      download_maven_lib(hSession, lname, base_url, libs_dir, cp_map, err_buf, err_cap);
    }
  }

  const PanJsonValue* args_obj = pan_json_get(ljson, "arguments");
  if (args_obj) {
    const PanJsonValue* ajvm = pan_json_get(args_obj, "jvm");
    if (ajvm && ajvm->type == PAN_JSON_ARRAY) {
      for (size_t i = 0; i < ajvm->u.arr.count; i++) {
        const PanJsonValue* item = ajvm->u.arr.items[i];
        if (item->type == PAN_JSON_STRING && item->u.str && item->u.str[0]) {
          strlist_add(extra_jvm, item->u.str);
        } else if (item->type == PAN_JSON_OBJECT && test_mojang_rules(pan_json_get(item, "rules"))) {
          const PanJsonValue* val = pan_json_get(item, "value");
          if (val && val->type == PAN_JSON_STRING && val->u.str && val->u.str[0]) {
            strlist_add(extra_jvm, val->u.str);
          } else if (val && val->type == PAN_JSON_ARRAY) {
            for (size_t k = 0; k < val->u.arr.count; k++) {
              const char* vs = pan_json_str(val->u.arr.items[k], NULL);
              if (vs && vs[0]) strlist_add(extra_jvm, vs);
            }
          }
        }
      }
    }
    const PanJsonValue* agame = pan_json_get(args_obj, "game");
    if (agame && agame->type == PAN_JSON_ARRAY) {
      for (size_t i = 0; i < agame->u.arr.count; i++) {
        const PanJsonValue* item = agame->u.arr.items[i];
        if (item->type == PAN_JSON_STRING && item->u.str && item->u.str[0]) {
          strlist_add(extra_game, item->u.str);
        } else if (item->type == PAN_JSON_OBJECT && test_mojang_rules(pan_json_get(item, "rules"))) {
          const PanJsonValue* val = pan_json_get(item, "value");
          if (val && val->type == PAN_JSON_STRING && val->u.str && val->u.str[0]) {
            strlist_add(extra_game, val->u.str);
          } else if (val && val->type == PAN_JSON_ARRAY) {
            for (size_t k = 0; k < val->u.arr.count; k++) {
              const char* vs = pan_json_str(val->u.arr.items[k], NULL);
              if (vs && vs[0]) strlist_add(extra_game, vs);
            }
          }
        }
      }
    }
  } else {
    const char* legacy_mc = pan_json_str(pan_json_get(ljson, "minecraftArguments"), NULL);
    if (legacy_mc && legacy_mc[0] && extra_game) {
      extra_game->count = 0; /* Replace Mojang legacy args when Forge overrides minecraftArguments */
      char* copy = xstrdup(legacy_mc);
      char* ctx = NULL;
      for (char* tok = strtok_s(copy, " ", &ctx); tok; tok = strtok_s(NULL, " ", &ctx)) {
        if (tok[0]) strlist_add(extra_game, tok);
      }
      free(copy);
    }
  }
  return 1;
}

typedef struct {
  char version_id[128];
  char* install_profile_json;
  size_t install_profile_len;
  uint8_t* universal_jar;
  size_t universal_len;
  int has_version_json;
} PanInstallerInspect;

static int inspect_forge_zip_cb(
    const char* name,
    const uint8_t* data,
    size_t data_len,
    size_t idx,
    size_t total,
    void* user) {
  (void)idx;
  (void)total;
  PanInstallerInspect* ins = (PanInstallerInspect*)user;
  if (strcmp(name, "version.json") == 0) {
    ins->has_version_json = 1;
    PanJsonValue* vj = pan_json_parse((const char*)data, data_len);
    if (vj) {
      const char* vid = pan_json_str(pan_json_get(vj, "id"), NULL);
      if (vid && vid[0]) {
        strncpy(ins->version_id, vid, sizeof(ins->version_id) - 1);
      }
      pan_json_free(vj);
    }
  } else if (strcmp(name, "install_profile.json") == 0 && !ins->install_profile_json) {
    ins->install_profile_json = (char*)malloc(data_len + 1);
    if (ins->install_profile_json) {
      memcpy(ins->install_profile_json, data, data_len);
      ins->install_profile_json[data_len] = '\0';
      ins->install_profile_len = data_len;
    }
  } else if (!ins->universal_jar && strstr(name, "forge-") && strstr(name, "-universal.jar")) {
    ins->universal_jar = (uint8_t*)malloc(data_len);
    if (ins->universal_jar) {
      memcpy(ins->universal_jar, data, data_len);
      ins->universal_len = data_len;
    }
  }
  return 1;
}

static int run_jar_install_client(const wchar_t* java_exe, const wchar_t* jar_path, const wchar_t* base_dir, char* err_out, size_t err_cap) {
  wchar_t prof_path[MAX_PATH];
  _snwprintf(prof_path, MAX_PATH, L"%ls\\launcher_profiles.json", base_dir);
  prof_path[MAX_PATH - 1] = L'\0';
  if (!file_exists_nonempty_w(prof_path)) {
    const char* empty_prof = "{\"profiles\":{}}";
    write_entire_file_w(prof_path, empty_prof, strlen(empty_prof));
  }

  wchar_t cmd[2048];
  _snwprintf(cmd, 2048, L"\"%ls\" -jar \"%ls\" --installClient \"%ls\"", java_exe, jar_path, base_dir);
  cmd[2047] = L'\0';

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);

  if (!CreateProcessW(java_exe, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, base_dir, &si, &pi)) {
    if (err_out) _snprintf(err_out, err_cap, "No se pudo ejecutar instalador Java (%lu).", GetLastError());
    return 0;
  }
  DWORD wr = WaitForSingleObject(pi.hProcess, 240000);
  DWORD exit_code = 1;
  if (wr == WAIT_OBJECT_0) {
    GetExitCodeProcess(pi.hProcess, &exit_code);
  } else {
    TerminateProcess(pi.hProcess, 1);
  }
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  if (exit_code != 0) {
    if (err_out) _snprintf(err_out, err_cap, "El instalador oficial devolvió error (código %lu).", (unsigned long)exit_code);
    return 0;
  }
  return 1;
}

static void normalize_loader_name(const char* raw, char* out, size_t cap) {
  char low[64] = {0};
  size_t i = 0;
  for (; raw && raw[i] && i + 1 < sizeof(low); i++) {
    low[i] = (char)tolower((unsigned char)raw[i]);
  }
  low[i] = '\0';
  if (strcmp(low, "fabric") == 0) strncpy(out, "Fabric", cap - 1);
  else if (strcmp(low, "forge") == 0) strncpy(out, "Forge", cap - 1);
  else if (strcmp(low, "neoforge") == 0) strncpy(out, "NeoForge", cap - 1);
  else if (strcmp(low, "quilt") == 0) strncpy(out, "Quilt", cap - 1);
  else strncpy(out, "Vanilla", cap - 1);
  out[cap - 1] = '\0';
}

static DWORD WINAPI LaunchWorkerThread(LPVOID param) {
  (void)param;
  HINTERNET hSession = NULL;
  PanJsonValue* req_json = NULL;
  PanJsonValue* mc_json = NULL;
  PanJsonValue* loader_json = NULL;
  PanJsonValue* asset_idx_json = NULL;
  PanCpMap cp_map = {0};
  PanStrList extra_jvm = {0};
  PanStrList loader_game = {0};
  PanStrList all_args = {0};

  char err_msg[1024] = {0};
  char mc_ver[64] = "1.21.4";
  char loader[64] = "Vanilla";
  char req_loader_ver[96] = {0};
  char version_name[128] = "1.21.4";
  char inst_dir_utf8[MAX_PATH * 3] = {0};

  char* raw_req = NULL;
  size_t raw_len = 0;
  EnterCriticalSection(&g_mc.cs);
  raw_req = g_mc.pending_req_json;
  raw_len = g_mc.pending_req_len;
  g_mc.pending_req_json = NULL;
  g_mc.pending_req_len = 0;
  LeaveCriticalSection(&g_mc.cs);

  if (!raw_req || raw_len == 0) {
    set_pan_status("error", 100, "No se pudo iniciar Minecraft Java", "Solicitud de lanzamiento vacía.", 0, mc_ver, "");
    InterlockedExchange(&g_mc.launching, 0);
    return 1;
  }

  req_json = pan_json_parse(raw_req, raw_len);
  free(raw_req);
  if (!req_json || req_json->type != PAN_JSON_OBJECT) {
    set_pan_status("error", 100, "No se pudo iniciar Minecraft Java", "JSON de lanzamiento inválido.", 0, mc_ver, "");
    InterlockedExchange(&g_mc.launching, 0);
    return 1;
  }

  const char* v_str = pan_json_str(pan_json_get(req_json, "mcVersion"), "1.21.4");
  if (!is_safe_version_token_a(v_str)) v_str = "1.21.4";
  strncpy(mc_ver, v_str, sizeof(mc_ver) - 1);
  mc_ver[sizeof(mc_ver) - 1] = '\0';
  strncpy(version_name, mc_ver, sizeof(version_name) - 1);
  version_name[sizeof(version_name) - 1] = '\0';
  normalize_loader_name(pan_json_str(pan_json_get(req_json, "loader"), "Vanilla"), loader, sizeof(loader));
  const char* lv_str = pan_json_str(pan_json_get(req_json, "loaderVersion"), "");
  if (lv_str && lv_str[0] && is_safe_version_token_a(lv_str)) {
    strncpy(req_loader_ver, lv_str, sizeof(req_loader_ver) - 1);
    req_loader_ver[sizeof(req_loader_ver) - 1] = '\0';
  } else {
    req_loader_ver[0] = '\0';
  }
  const char* close_beh = pan_json_str(pan_json_get(req_json, "closeBehavior"), "quit");
  int should_reopen = (_stricmp(close_beh, "quit") == 0);

  const char* raw_pid = pan_json_str(pan_json_get(req_json, "profileId"), "default");
  char safe_pid[128];
  size_t sp = 0;
  for (size_t i = 0; raw_pid[i] && sp + 1 < sizeof(safe_pid); i++) {
    unsigned char c = (unsigned char)raw_pid[i];
    safe_pid[sp++] = (isalnum(c) || c == '.' || c == '_' || c == '-') ? (char)c : '_';
  }
  if (sp == 0) {
    strcpy(safe_pid, "default");
  } else {
    safe_pid[sp] = '\0';
  }

  /* Isolate direct-mode instances per mcVersion + loader so natives/mods never collide */
  char inst_folder[192];
  if (strncmp(safe_pid, "inst-", 5) == 0) {
    _snprintf(inst_folder, sizeof(inst_folder), "%s", safe_pid);
  } else {
    char low_loader[32];
    size_t k = 0;
    for (; loader[k] && k + 1 < sizeof(low_loader); k++) low_loader[k] = (char)tolower((unsigned char)loader[k]);
    low_loader[k] = '\0';
    _snprintf(inst_folder, sizeof(inst_folder), "%s-%s-%s", safe_pid, mc_ver, low_loader);
  }
  inst_folder[sizeof(inst_folder) - 1] = '\0';

  wchar_t w_mc_ver[64], w_inst_folder[192];
  utf8_to_wide(mc_ver, w_mc_ver, 64);
  utf8_to_wide(inst_folder, w_inst_folder, 192);

  wchar_t versions_dir[MAX_PATH], libs_dir[MAX_PATH], assets_dir[MAX_PATH], runtime_dir[MAX_PATH];
  wchar_t instance_dir[MAX_PATH], natives_dir[MAX_PATH], mods_dir[MAX_PATH];
  _snwprintf(versions_dir, MAX_PATH, L"%ls\\versions", g_mc.base_dir);
  _snwprintf(libs_dir, MAX_PATH, L"%ls\\libraries", g_mc.base_dir);
  _snwprintf(assets_dir, MAX_PATH, L"%ls\\assets", g_mc.base_dir);
  _snwprintf(runtime_dir, MAX_PATH, L"%ls\\runtime", g_mc.base_dir);
  _snwprintf(instance_dir, MAX_PATH, L"%ls\\instances\\%ls", g_mc.base_dir, w_inst_folder);
  _snwprintf(natives_dir, MAX_PATH, L"%ls\\natives", instance_dir);
  _snwprintf(mods_dir, MAX_PATH, L"%ls\\mods", instance_dir);

  ensure_dir_w(versions_dir);
  ensure_dir_w(libs_dir);
  ensure_dir_w(assets_dir);
  ensure_dir_w(runtime_dir);
  ensure_dir_w(instance_dir);
  ensure_dir_w(natives_dir);
  clean_natives_dir_w(natives_dir);
  {
    wchar_t subnat[MAX_PATH];
    _snwprintf(subnat, MAX_PATH, L"%ls\\java", natives_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\jna", natives_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\lwjgl", natives_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\netty", natives_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\server-resource-packs", instance_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\downloads", instance_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\logs", instance_dir); ensure_dir_w(subnat);
    _snwprintf(subnat, MAX_PATH, L"%ls\\crash-reports", instance_dir); ensure_dir_w(subnat);
  }
  wchar_t shared_dir[MAX_PATH] = {0};
  ensure_dir_w(mods_dir);
  wide_to_utf8(instance_dir, inst_dir_utf8, sizeof(inst_dir_utf8));

  wchar_t libs_dir_w[MAX_PATH];
  wcscpy(libs_dir_w, libs_dir);
  char libs_utf8[MAX_PATH * 3], assets_utf8[MAX_PATH * 3], natives_utf8[MAX_PATH * 3];
  wide_to_utf8(libs_dir_w, libs_utf8, sizeof(libs_utf8));
  wide_to_utf8(assets_dir, assets_utf8, sizeof(assets_utf8));
  wide_to_utf8(natives_dir, natives_utf8, sizeof(natives_utf8));

  hSession = create_winhttp_session();
  if (!hSession) {
    snprintf(err_msg, sizeof(err_msg), "No se pudo inicializar WinHTTP en Windows.");
    goto on_error;
  }

  /* 1. Mojang Version Manifest */
  set_pan_status("downloading", 8, "Obteniendo manifiesto oficial de Mojang...", "", 0, mc_ver, inst_dir_utf8);
  wchar_t mc_json_path[MAX_PATH];
  _snwprintf(mc_json_path, MAX_PATH, L"%ls\\%ls\\%ls.json", versions_dir, w_mc_ver, w_mc_ver);

  if (!file_exists_nonempty_w(mc_json_path)) {
    PanJsonValue* manifest = http_get_json(hSession, "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
                                           err_msg, sizeof(err_msg));
    if (!manifest) goto on_error;
    const PanJsonValue* vers = pan_json_get(manifest, "versions");
    const char* ver_url = NULL;
    if (vers && vers->type == PAN_JSON_ARRAY) {
      for (size_t i = 0; i < vers->u.arr.count; i++) {
        const PanJsonValue* item = vers->u.arr.items[i];
        const char* id = pan_json_str(pan_json_get(item, "id"), "");
        if (strcmp(id, mc_ver) == 0) {
          ver_url = pan_json_str(pan_json_get(item, "url"), NULL);
          break;
        }
      }
    }
    if (!ver_url) {
      pan_json_free(manifest);
      snprintf(err_msg, sizeof(err_msg), "No se encontró Minecraft %s en Mojang Piston Meta.", mc_ver);
      goto on_error;
    }
    int dl_ok = http_download_file(hSession, ver_url, mc_json_path, NULL, err_msg, sizeof(err_msg));
    pan_json_free(manifest);
    if (!dl_ok) goto on_error;
  }

  {
    size_t jlen = 0;
    uint8_t* jraw = read_entire_file_w(mc_json_path, &jlen);
    if (!jraw) {
      snprintf(err_msg, sizeof(err_msg), "No se pudo leer %s.json", mc_ver);
      goto on_error;
    }
    mc_json = pan_json_parse((const char*)jraw, jlen);
    free(jraw);
    if (!mc_json) {
      snprintf(err_msg, sizeof(err_msg), "Manifiesto %s.json corrupto.", mc_ver);
      goto on_error;
    }
  }

  /* 2. Java Runtime (use existing user/system Java >= req_java before Adoptium download) */
  int req_java = 8;
  const PanJsonValue* jv = pan_json_get(mc_json, "javaVersion");
  if (jv) req_java = (int)pan_json_num(pan_json_get(jv, "majorVersion"), 8);
  int java_major = (req_java >= 25) ? req_java : (req_java >= 21 ? 21 : (req_java >= 17 ? 17 : 8));
  const char* custom_java = pan_json_str(pan_json_get(req_json, "javaPath"), "");

  wchar_t jre_dir[MAX_PATH], javaw_path[MAX_PATH];
  _snwprintf(jre_dir, MAX_PATH, L"%ls\\jre%d", runtime_dir, java_major);
  int have_java = find_matching_javaw_in_tree(jre_dir, java_major, 0, javaw_path, MAX_PATH);
  if (!have_java) {
    have_java = find_system_javaw(java_major, custom_java, javaw_path, MAX_PATH);
    if (have_java) {
      set_pan_statusf("downloading", 26, "Usando Java %d ya instalado en tu PC...", java_major);
    }
  }
  if (!have_java && !find_javaw_recursive(jre_dir, javaw_path, MAX_PATH)) {
    set_pan_statusf("downloading", 16, "Descargando Java %d (Eclipse Temurin JRE)...", java_major);
    wchar_t jre_zip[MAX_PATH];
    _snwprintf(jre_zip, MAX_PATH, L"%ls\\jre%d.zip", runtime_dir, java_major);
    char jre_url[256], jdk_url[256];
    snprintf(jre_url, sizeof(jre_url),
             "https://api.adoptium.net/v3/binary/latest/%d/ga/windows/x64/jre/hotspot/normal/eclipse",
             java_major);
    snprintf(jdk_url, sizeof(jdk_url),
             "https://api.adoptium.net/v3/binary/latest/%d/ga/windows/x64/jdk/hotspot/normal/eclipse",
             java_major);
    if (!http_download_file(hSession, jre_url, jre_zip, NULL, err_msg, sizeof(err_msg))) {
      err_msg[0] = '\0';
      if (!http_download_file(hSession, jdk_url, jre_zip, NULL, err_msg, sizeof(err_msg))) goto on_error;
    }

    set_pan_statusf("downloading", 24, "Extrayendo Java %d en tu PC...", java_major);
    ensure_dir_w(jre_dir);
    size_t zlen = 0;
    uint8_t* zbuf = read_entire_file_w(jre_zip, &zlen);
    if (!zbuf || !pan_zip_extract_memory(zbuf, zlen, extract_full_zip_cb, jre_dir)) {
      free(zbuf);
      snprintf(err_msg, sizeof(err_msg), "No se pudo extraer Java %d en AppData\\Local\\Pan-launcher\\runtime.", java_major);
      goto on_error;
    }
    free(zbuf);
    DeleteFileW(jre_zip);

    if (!find_javaw_recursive(jre_dir, javaw_path, MAX_PATH)) {
      snprintf(err_msg, sizeof(err_msg), "No se encontró javaw.exe tras instalar Java %d.", java_major);
      goto on_error;
    }
  }

  /* 3. Client JAR */
  set_pan_statusf("downloading", 30, "Descargando cliente oficial de Minecraft %s...", mc_ver);
  wchar_t client_jar[MAX_PATH];
  _snwprintf(client_jar, MAX_PATH, L"%ls\\%ls\\%ls.jar", versions_dir, w_mc_ver, w_mc_ver);
  {
    const PanJsonValue* dl_client = pan_json_get(pan_json_get(mc_json, "downloads"), "client");
    const char* c_url = pan_json_str(pan_json_get(dl_client, "url"), NULL);
    const char* c_sha = pan_json_str(pan_json_get(dl_client, "sha1"), "");
    if (!c_url) {
      snprintf(err_msg, sizeof(err_msg), "Falta URL de client.jar en manifiesto Mojang.");
      goto on_error;
    }
    if (!http_download_file(hSession, c_url, client_jar, c_sha, err_msg, sizeof(err_msg))) goto on_error;
  }

  /* 4. Mojang Libraries & Windows Natives (Parallel) */
  set_pan_status("downloading", 38, "Verificando librerías de Minecraft y natives Windows...", "", 0, NULL, NULL);
  {
    const PanJsonValue* libs = pan_json_get(mc_json, "libraries");
    size_t max_tasks = (libs && libs->type == PAN_JSON_ARRAY) ? libs->u.arr.count * 2 + 4 : 4;
    PanDlTask* tasks = (PanDlTask*)calloc(max_tasks, sizeof(PanDlTask));
    size_t tcnt = 0;

    if (libs && libs->type == PAN_JSON_ARRAY) {
      for (size_t i = 0; i < libs->u.arr.count; i++) {
        const PanJsonValue* lib = libs->u.arr.items[i];
        if (!test_mojang_rules(pan_json_get(lib, "rules"))) continue;
        const char* lname = pan_json_str(pan_json_get(lib, "name"), "");
        if (strstr(lname, ":natives-windows-arm64") || strstr(lname, ":natives-windows-x86")) continue;

        const PanJsonValue* dls = pan_json_get(lib, "downloads");
        const PanJsonValue* nat_obj = pan_json_get(lib, "natives");
        const PanJsonValue* art = pan_json_get(dls, "artifact");
        if (art) {
          const char* aurl = pan_json_str(pan_json_get(art, "url"), NULL);
          const char* apath = pan_json_str(pan_json_get(art, "path"), NULL);
          const char* asha = pan_json_str(pan_json_get(art, "sha1"), "");
          if (aurl && apath && is_safe_rel_path_a(apath) && tcnt < max_tasks) {
            wchar_t wrel[MAX_PATH];
            utf8_to_wide(apath, wrel, MAX_PATH);
            for (int k = 0; wrel[k]; k++) if (wrel[k] == L'/') wrel[k] = L'\\';
            PanDlTask* t = &tasks[tcnt++];
            strncpy(t->url, aurl, sizeof(t->url) - 1);
            _snwprintf(t->dest, MAX_PATH, L"%ls\\%ls", libs_dir, wrel);
            strncpy(t->sha1, asha, sizeof(t->sha1) - 1);
            if (strstr(lname, ":natives-windows")) {
              t->is_native_jar = 1;
            }
            {
              char ga[256];
              split_ga_key(lname, ga, sizeof(ga));
              cpmap_set(&cp_map, ga, t->dest);
            }
          }
        }

        const PanJsonValue* cls_obj = pan_json_get(dls, "classifiers");
        if (cls_obj) {
          char resolved_key[64] = "natives-windows";
          const char* win_key = pan_json_str(pan_json_get(nat_obj, "windows"), NULL);
          if (win_key) {
            str_replace_all(win_key, "${arch}", "64", resolved_key, sizeof(resolved_key));
          }
          const PanJsonValue* c_nat = pan_json_get(cls_obj, resolved_key);
          if (c_nat && tcnt < max_tasks) {
            const char* nurl = pan_json_str(pan_json_get(c_nat, "url"), NULL);
            const char* npath = pan_json_str(pan_json_get(c_nat, "path"), NULL);
            const char* nsha = pan_json_str(pan_json_get(c_nat, "sha1"), "");
            if (nurl && npath && is_safe_rel_path_a(npath)) {
              wchar_t wrel[MAX_PATH];
              utf8_to_wide(npath, wrel, MAX_PATH);
              for (int k = 0; wrel[k]; k++) if (wrel[k] == L'/') wrel[k] = L'\\';
              PanDlTask* t = &tasks[tcnt++];
              strncpy(t->url, nurl, sizeof(t->url) - 1);
              _snwprintf(t->dest, MAX_PATH, L"%ls\\%ls", libs_dir, wrel);
              strncpy(t->sha1, nsha, sizeof(t->sha1) - 1);
              t->is_native_jar = 1;
              {
                char ga_base[220], ga_nat[256];
                split_ga_key(lname, ga_base, sizeof(ga_base));
                _snprintf(ga_nat, sizeof(ga_nat), "%s:%s", ga_base, resolved_key);
                ga_nat[sizeof(ga_nat) - 1] = '\0';
                cpmap_set(&cp_map, ga_nat, t->dest);
              }
            }
          }
        }
      }
    }

    PanDlPool pool = {0};
    pool.tasks = tasks;
    pool.count = tcnt;
    pool.natives_dir = natives_dir;
    pool.base_pct = 38;
    pool.span_pct = 18;
    pool.label = "Verificando librerías";
    pool.fatal_on_fail = 1;
    int ok = run_dl_pool(&pool, 6);
    if (!ok) {
      strncpy(err_msg, pool.fail_msg, sizeof(err_msg) - 1);
      free(tasks);
      goto on_error;
    }
    free(tasks);
  }

  /* 5. Assets Index & Objects */
  set_pan_status("downloading", 58, "Verificando índice de assets (texturas y sonido)...", "", 0, NULL, NULL);
  const char* asset_id = pan_json_str(pan_json_get(pan_json_get(mc_json, "assetIndex"), "id"), "17");
  {
    const PanJsonValue* ai_meta = pan_json_get(mc_json, "assetIndex");
    const char* ai_url = pan_json_str(pan_json_get(ai_meta, "url"), NULL);
    const char* ai_sha = pan_json_str(pan_json_get(ai_meta, "sha1"), "");
    wchar_t w_aid[64], ai_path[MAX_PATH];
    utf8_to_wide(asset_id, w_aid, 64);
    _snwprintf(ai_path, MAX_PATH, L"%ls\\indexes\\%ls.json", assets_dir, w_aid);
    if (!ai_url || !http_download_file(hSession, ai_url, ai_path, ai_sha, err_msg, sizeof(err_msg))) {
      if (!err_msg[0]) snprintf(err_msg, sizeof(err_msg), "Falta índice de assets.");
      goto on_error;
    }
    size_t alen = 0;
    uint8_t* araw = read_entire_file_w(ai_path, &alen);
    asset_idx_json = araw ? pan_json_parse((const char*)araw, alen) : NULL;
    free(araw);
    if (!asset_idx_json) {
      snprintf(err_msg, sizeof(err_msg), "Índice de assets inválido.");
      goto on_error;
    }

    const PanJsonValue* objs = pan_json_get(asset_idx_json, "objects");
    if (objs && objs->type == PAN_JSON_OBJECT && objs->u.obj.count > 0) {
      wchar_t appdata[MAX_PATH] = {0};
      GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH);
      wchar_t mc_local_objs[MAX_PATH];
      _snwprintf(mc_local_objs, MAX_PATH, L"%ls\\.minecraft\\assets\\objects", appdata);

      PanDlTask* atasks = (PanDlTask*)calloc(objs->u.obj.count, sizeof(PanDlTask));
      size_t acnt = 0;
      for (size_t i = 0; i < objs->u.obj.count; i++) {
        const PanJsonValue* ov = objs->u.obj.pairs[i].val;
        const char* hash = pan_json_str(pan_json_get(ov, "hash"), "");
        if (strlen(hash) < 3) continue;
        wchar_t wpref[4], whash[128];
        wpref[0] = (wchar_t)hash[0];
        wpref[1] = (wchar_t)hash[1];
        wpref[2] = L'\0';
        utf8_to_wide(hash, whash, 128);
        wchar_t dest[MAX_PATH];
        _snwprintf(dest, MAX_PATH, L"%ls\\objects\\%ls\\%ls", assets_dir, wpref, whash);
        if (file_exists_nonempty_w(dest)) continue;

        PanDlTask* t = &atasks[acnt++];
        snprintf(t->url, sizeof(t->url), "https://resources.download.minecraft.net/%.2s/%s", hash, hash);
        wcscpy(t->dest, dest);
        wchar_t mc_src[MAX_PATH];
        _snwprintf(mc_src, MAX_PATH, L"%ls\\%ls\\%ls", mc_local_objs, wpref, whash);
        if (appdata[0] && file_exists_nonempty_w(mc_src)) {
          t->copy_mc_local = 1;
          wcscpy(t->mc_local_src, mc_src);
        }
      }

      if (acnt > 0) {
        set_pan_statusf("downloading", 62, "Descargando %llu assets en paralelo...", (unsigned long long)acnt);
        PanDlPool apool = {0};
        apool.tasks = atasks;
        apool.count = acnt;
        apool.base_pct = 62;
        apool.span_pct = 16;
        apool.label = "Assets descargados";
        apool.fatal_on_fail = 0;
        run_dl_pool(&apool, 8);
      }
      free(atasks);
    }
  }

  /* 6. Mod Loaders: Vanilla / Fabric / Quilt / Forge / NeoForge */
  char main_class[256];
  strncpy(main_class, pan_json_str(pan_json_get(mc_json, "mainClass"), "net.minecraft.client.main.Main"), sizeof(main_class) - 1);
  main_class[sizeof(main_class) - 1] = '\0';

  int modded_ready = 0;
  if (strcmp(loader, "Fabric") == 0) {
    set_pan_statusf("downloading", 80, "Instalando Fabric Loader para Minecraft %s...", mc_ver);
    char lurl[256];
    snprintf(lurl, sizeof(lurl), "https://meta.fabricmc.net/v2/versions/loader/%s", mc_ver);
    char tmp_err[256] = {0};
    PanJsonValue* loaders = http_get_json(hSession, lurl, tmp_err, sizeof(tmp_err));
    const char* f_ver = NULL;
    if (loaders && loaders->type == PAN_JSON_ARRAY && loaders->u.arr.count > 0) {
      if (req_loader_ver[0]) {
        for (size_t i = 0; i < loaders->u.arr.count; i++) {
          const char* v = pan_json_str(pan_json_get(pan_json_get(loaders->u.arr.items[i], "loader"), "version"), NULL);
          if (v && strcmp(v, req_loader_ver) == 0) { f_ver = v; break; }
        }
      }
      if (!f_ver) {
        for (size_t i = 0; i < loaders->u.arr.count; i++) {
          const PanJsonValue* lnode = pan_json_get(loaders->u.arr.items[i], "loader");
          if (pan_json_bool(pan_json_get(lnode, "stable"), 0)) {
            f_ver = pan_json_str(pan_json_get(lnode, "version"), NULL);
            break;
          }
        }
      }
      if (!f_ver) f_ver = pan_json_str(pan_json_get(pan_json_get(loaders->u.arr.items[0], "loader"), "version"), NULL);
    }
    if (!f_ver) {
      if (loaders) pan_json_free(loaders);
      snprintf(err_msg, sizeof(err_msg), "Fabric no está disponible para Minecraft %s. Cambia a Vanilla o Forge.", mc_ver);
      goto on_error;
    }
    char purl[320];
    snprintf(purl, sizeof(purl), "https://meta.fabricmc.net/v2/versions/loader/%s/%s/profile/json", mc_ver, f_ver);
    loader_json = http_get_json(hSession, purl, err_msg, sizeof(err_msg));
    pan_json_free(loaders);
    if (!loader_json) goto on_error;
    if (!apply_loader_json_libs(hSession, loader_json, libs_dir, &cp_map, main_class, sizeof(main_class),
                                version_name, sizeof(version_name), &extra_jvm, &loader_game, err_msg, sizeof(err_msg))) {
      goto on_error;
    }
    modded_ready = 1;
  } else if (strcmp(loader, "Quilt") == 0) {
    set_pan_statusf("downloading", 80, "Instalando Quilt Loader para Minecraft %s...", mc_ver);
    char qurl[256];
    snprintf(qurl, sizeof(qurl), "https://meta.quiltmc.org/v3/versions/loader/%s", mc_ver);
    char tmp_err[256] = {0};
    PanJsonValue* loaders = http_get_json(hSession, qurl, tmp_err, sizeof(tmp_err));
    const char* q_ver = NULL;
    if (loaders && loaders->type == PAN_JSON_ARRAY && loaders->u.arr.count > 0) {
      if (req_loader_ver[0]) {
        for (size_t i = 0; i < loaders->u.arr.count; i++) {
          const char* v = pan_json_str(pan_json_get(pan_json_get(loaders->u.arr.items[i], "loader"), "version"), NULL);
          if (v && strcmp(v, req_loader_ver) == 0) { q_ver = v; break; }
        }
      }
      if (!q_ver) {
        for (size_t i = 0; i < loaders->u.arr.count; i++) {
          const char* v = pan_json_str(pan_json_get(pan_json_get(loaders->u.arr.items[i], "loader"), "version"), NULL);
          if (v && !strstr(v, "-beta") && !strstr(v, "-alpha")) { q_ver = v; break; }
        }
      }
      if (!q_ver) q_ver = pan_json_str(pan_json_get(pan_json_get(loaders->u.arr.items[0], "loader"), "version"), NULL);
    }
    if (!q_ver) {
      if (loaders) pan_json_free(loaders);
      snprintf(err_msg, sizeof(err_msg), "Quilt no está disponible para Minecraft %s. Cambia a Vanilla o Fabric.", mc_ver);
      goto on_error;
    }
    char purl[320];
    snprintf(purl, sizeof(purl), "https://meta.quiltmc.org/v3/versions/loader/%s/%s/profile/json", mc_ver, q_ver);
    loader_json = http_get_json(hSession, purl, err_msg, sizeof(err_msg));
    pan_json_free(loaders);
    if (!loader_json) goto on_error;
    if (!apply_loader_json_libs(hSession, loader_json, libs_dir, &cp_map, main_class, sizeof(main_class),
                                version_name, sizeof(version_name), &extra_jvm, &loader_game, err_msg, sizeof(err_msg))) {
      goto on_error;
    }
    modded_ready = 1;
  } else if (strcmp(loader, "Forge") == 0) {
    set_pan_statusf("downloading", 80, "Resolviendo Forge oficial para Minecraft %s...", mc_ver);
    char forge_full[128] = {0};
    {
      char prefix[80];
      snprintf(prefix, sizeof(prefix), "%s-", mc_ver);
      size_t xlen = 0;
      char* xml = http_get_text(hSession, "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
                                &xlen, err_msg, sizeof(err_msg));
      if (!xml) goto on_error;
      const char* p = xml;
      char last_match[128] = {0};
      while ((p = strstr(p, "<version>")) != NULL) {
        p += 9;
        const char* end = strstr(p, "</version>");
        if (!end) break;
        size_t vlen = (size_t)(end - p);
        if (vlen > 0 && vlen < sizeof(last_match)) {
          char cand[128];
          memcpy(cand, p, vlen);
          cand[vlen] = '\0';
          if (strncmp(cand, prefix, strlen(prefix)) == 0) {
            const char* sub = cand + strlen(prefix);
            if (req_loader_ver[0] && strncmp(sub, req_loader_ver, strlen(req_loader_ver)) == 0 &&
                (sub[strlen(req_loader_ver)] == '\0' || sub[strlen(req_loader_ver)] == '-')) {
              strcpy(forge_full, cand);
              break;
            }
            strcpy(last_match, cand);
          }
        }
        p = end;
      }
      free(xml);
      if (!forge_full[0] && last_match[0]) strcpy(forge_full, last_match);
    }
    if (!forge_full[0]) {
      snprintf(err_msg, sizeof(err_msg), "Forge no publica versiones para Minecraft %s.", mc_ver);
      goto on_error;
    }

    wchar_t w_ff[128], inst_jar[MAX_PATH];
    utf8_to_wide(forge_full, w_ff, 128);
    _snwprintf(inst_jar, MAX_PATH, L"%ls\\forge-%ls-installer.jar", runtime_dir, w_ff);
    inst_jar[MAX_PATH - 1] = L'\0';
    char iurl[512];
    snprintf(iurl, sizeof(iurl),
             "https://maven.minecraftforge.net/net/minecraftforge/forge/%s/forge-%s-installer.jar",
             forge_full, forge_full);
    set_pan_statusf("downloading", 82, "Descargando instalador Forge %s...", forge_full);
    if (!http_download_file(hSession, iurl, inst_jar, NULL, err_msg, sizeof(err_msg))) goto on_error;

    size_t zlen = 0;
    uint8_t* zbuf = read_entire_file_w(inst_jar, &zlen);
    if (!zbuf) {
      snprintf(err_msg, sizeof(err_msg), "No se pudo leer el instalador Forge %s.", forge_full);
      goto on_error;
    }
    PanInstallerInspect ins = {0};
    pan_zip_extract_memory(zbuf, zlen, inspect_forge_zip_cb, &ins);
    free(zbuf);

    wchar_t ljson_path[MAX_PATH] = {0};
    if (ins.has_version_json && ins.version_id[0]) {
      wchar_t w_vid[128];
      utf8_to_wide(ins.version_id, w_vid, 128);
      _snwprintf(ljson_path, MAX_PATH, L"%ls\\%ls\\%ls.json", versions_dir, w_vid, w_vid);
      if (!file_exists_nonempty_w(ljson_path)) {
        wchar_t java_exe[MAX_PATH];
        javaw_to_java_exe(javaw_path, java_exe, MAX_PATH);
        set_pan_statusf("downloading", 84, "Instalando Forge %s en tu PC (puede tardar 15-40 s)...", forge_full);
        if (!run_jar_install_client(java_exe, inst_jar, g_mc.base_dir, err_msg, sizeof(err_msg))) {
          free(ins.install_profile_json);
          free(ins.universal_jar);
          goto on_error;
        }
      }
    } else if (ins.install_profile_json) {
      PanJsonValue* ip = pan_json_parse(ins.install_profile_json, ins.install_profile_len);
      const PanJsonValue* vi = ip ? pan_json_get(ip, "versionInfo") : NULL;
      const char* vi_id = vi ? pan_json_str(pan_json_get(vi, "id"), forge_full) : forge_full;
      wchar_t w_vid[128];
      utf8_to_wide(vi_id, w_vid, 128);
      _snwprintf(ljson_path, MAX_PATH, L"%ls\\%ls\\%ls.json", versions_dir, w_vid, w_vid);
      if (vi && !file_exists_nonempty_w(ljson_path)) {
        const char* vi_start = strstr(ins.install_profile_json, "\"versionInfo\"");
        const char* brace = vi_start ? strchr(vi_start, '{') : NULL;
        if (brace) {
          int depth = 0, in_s = 0, esc = 0;
          const char* endp = brace;
          for (; *endp; endp++) {
            char ch = *endp;
            if (esc) { esc = 0; continue; }
            if (ch == '\\' && in_s) { esc = 1; continue; }
            if (ch == '"') { in_s = !in_s; continue; }
            if (!in_s) {
              if (ch == '{') depth++;
              else if (ch == '}') { depth--; if (depth == 0) { endp++; break; } }
            }
          }
          if (depth == 0 && endp > brace) write_entire_file_w(ljson_path, brace, (size_t)(endp - brace));
        }
      }
      if (ins.universal_jar && ins.universal_len > 0) {
        wchar_t u_dest[MAX_PATH];
        _snwprintf(u_dest, MAX_PATH, L"%ls\\net\\minecraftforge\\forge\\%ls\\forge-%ls.jar", libs_dir, w_ff, w_ff);
        write_entire_file_w(u_dest, ins.universal_jar, ins.universal_len);
      }
      if (ip) pan_json_free(ip);
    }
    free(ins.install_profile_json);
    free(ins.universal_jar);

    if (!ljson_path[0] || !file_exists_nonempty_w(ljson_path)) {
      snprintf(err_msg, sizeof(err_msg), "No se generó el perfil de Forge %s.", forge_full);
      goto on_error;
    }
    size_t lj_len = 0;
    uint8_t* lj_raw = read_entire_file_w(ljson_path, &lj_len);
    loader_json = lj_raw ? pan_json_parse((const char*)lj_raw, lj_len) : NULL;
    free(lj_raw);
    if (!loader_json) {
      snprintf(err_msg, sizeof(err_msg), "Manifiesto de Forge inválido.");
      goto on_error;
    }
    if (!apply_loader_json_libs(hSession, loader_json, libs_dir, &cp_map, main_class, sizeof(main_class),
                                version_name, sizeof(version_name), &extra_jvm, &loader_game, err_msg, sizeof(err_msg))) {
      goto on_error;
    }
    modded_ready = 1;
  } else if (strcmp(loader, "NeoForge") == 0) {
    set_pan_statusf("downloading", 80, "Resolviendo NeoForge oficial para Minecraft %s...", mc_ver);
    char nf_ver[96] = {0};
    if (req_loader_ver[0]) {
      strncpy(nf_ver, req_loader_ver, sizeof(nf_ver) - 1);
    } else {
      char k1[64], k2[64];
      if (strncmp(mc_ver, "1.", 2) == 0) snprintf(k1, sizeof(k1), "%s.", mc_ver + 2);
      else snprintf(k1, sizeof(k1), "%s.", mc_ver);
      snprintf(k2, sizeof(k2), "%s.", mc_ver);
      size_t xlen = 0;
      char* xml = http_get_text(hSession, "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
                                &xlen, err_msg, sizeof(err_msg));
      if (!xml) goto on_error;
      const char* p = xml;
      char best_stable[96] = {0}, best_any[96] = {0};
      while ((p = strstr(p, "<version>")) != NULL) {
        p += 9;
        const char* end = strstr(p, "</version>");
        if (!end) break;
        size_t vlen = (size_t)(end - p);
        if (vlen > 0 && vlen < sizeof(nf_ver)) {
          char cand[96];
          memcpy(cand, p, vlen);
          cand[vlen] = '\0';
          if (strncmp(cand, k1, strlen(k1)) == 0 || strncmp(cand, k2, strlen(k2)) == 0) {
            strcpy(best_any, cand);
            if (!strstr(cand, "-beta") && !strstr(cand, "-alpha")) strcpy(best_stable, cand);
          }
        }
        p = end;
      }
      free(xml);
      if (best_stable[0]) strcpy(nf_ver, best_stable);
      else if (best_any[0]) strcpy(nf_ver, best_any);
    }
    if (!nf_ver[0]) {
      snprintf(err_msg, sizeof(err_msg), "NeoForge no publica versiones para Minecraft %s.", mc_ver);
      goto on_error;
    }

    wchar_t w_nf[96], inst_jar[MAX_PATH];
    utf8_to_wide(nf_ver, w_nf, 96);
    _snwprintf(inst_jar, MAX_PATH, L"%ls\\neoforge-%ls-installer.jar", runtime_dir, w_nf);
    char iurl[512];
    snprintf(iurl, sizeof(iurl),
             "https://maven.neoforged.net/releases/net/neoforged/neoforge/%s/neoforge-%s-installer.jar",
             nf_ver, nf_ver);
    set_pan_statusf("downloading", 82, "Descargando instalador NeoForge %s...", nf_ver);
    if (!http_download_file(hSession, iurl, inst_jar, NULL, err_msg, sizeof(err_msg))) goto on_error;

    size_t zlen = 0;
    uint8_t* zbuf = read_entire_file_w(inst_jar, &zlen);
    PanInstallerInspect ins = {0};
    if (zbuf) {
      pan_zip_extract_memory(zbuf, zlen, inspect_forge_zip_cb, &ins);
      free(zbuf);
    }
    if (!ins.version_id[0]) snprintf(ins.version_id, sizeof(ins.version_id), "neoforge-%s", nf_ver);
    wchar_t w_vid[128], ljson_path[MAX_PATH];
    utf8_to_wide(ins.version_id, w_vid, 128);
    _snwprintf(ljson_path, MAX_PATH, L"%ls\\%ls\\%ls.json", versions_dir, w_vid, w_vid);
    if (!file_exists_nonempty_w(ljson_path)) {
      wchar_t java_exe[MAX_PATH];
      javaw_to_java_exe(javaw_path, java_exe, MAX_PATH);
      set_pan_statusf("downloading", 84, "Instalando NeoForge %s en tu PC (puede tardar 15-40 s)...", nf_ver);
      if (!run_jar_install_client(java_exe, inst_jar, g_mc.base_dir, err_msg, sizeof(err_msg))) {
        free(ins.install_profile_json);
        free(ins.universal_jar);
        goto on_error;
      }
    }
    free(ins.install_profile_json);
    free(ins.universal_jar);

    size_t lj_len = 0;
    uint8_t* lj_raw = read_entire_file_w(ljson_path, &lj_len);
    loader_json = lj_raw ? pan_json_parse((const char*)lj_raw, lj_len) : NULL;
    free(lj_raw);
    if (!loader_json) {
      snprintf(err_msg, sizeof(err_msg), "No se encontró el manifiesto de NeoForge %s.", nf_ver);
      goto on_error;
    }
    if (!apply_loader_json_libs(hSession, loader_json, libs_dir, &cp_map, main_class, sizeof(main_class),
                                version_name, sizeof(version_name), &extra_jvm, &loader_game, err_msg, sizeof(err_msg))) {
      goto on_error;
    }
    modded_ready = 1;
  }

  /* 7. Modrinth FPS Mods & Dependencies (never install Fabric mods into Vanilla or other loaders) */
  {
    wchar_t managed_path[MAX_PATH];
    _snwprintf(managed_path, MAX_PATH, L"%ls\\pan-managed-mods.json", instance_dir);
    {
      size_t mlen = 0;
      uint8_t* mraw = read_entire_file_w(managed_path, &mlen);
      if (mraw) {
        PanJsonValue* prev = pan_json_parse((const char*)mraw, mlen);
        if (prev && prev->type == PAN_JSON_ARRAY) {
          for (size_t i = 0; i < prev->u.arr.count; i++) {
            const char* old_jar = pan_json_str(prev->u.arr.items[i], NULL);
            if (old_jar && old_jar[0]) {
              wchar_t wold[MAX_PATH], wfull[MAX_PATH];
              utf8_to_wide(old_jar, wold, MAX_PATH);
              _snwprintf(wfull, MAX_PATH, L"%ls\\%ls", mods_dir, wold);
              DeleteFileW(wfull);
            }
          }
        }
        pan_json_free(prev);
        free(mraw);
      }
    }

    const PanJsonValue* emods = pan_json_get(req_json, "enabledModIds");
    size_t mod_req_count = (emods && emods->type == PAN_JSON_ARRAY) ? emods->u.arr.count : 0;
    if (modded_ready && mod_req_count > 0) {
      set_pan_status("downloading", 88, "Descargando mods FPS y dependencias en Modrinth...", "", 0, NULL, NULL);
      const char* modrinth_loader =
          (strcmp(loader, "Forge") == 0) ? "forge"
          : (strcmp(loader, "NeoForge") == 0) ? "neoforge"
          : (strcmp(loader, "Quilt") == 0) ? "quilt"
          : "fabric";
      int has_sodium = 0;
      for (size_t i = 0; i < mod_req_count; i++) {
        if (strcmp(pan_json_str(emods->u.arr.items[i], ""), "sodium") == 0) has_sodium = 1;
      }

      PanStrList queue = {0};
      PanStrList visited = {0};
      PanStrList new_managed = {0};
      if (strcmp(loader, "Fabric") == 0) {
        strlist_add(&queue, "fabric-api");
      }
      for (size_t i = 0; i < mod_req_count; i++) {
        const char* mid = pan_json_str(emods->u.arr.items[i], "");
        if (strcmp(mid, "vulkanmod") == 0 && has_sodium) continue;
        const char* slug = map_mod_slug(mid);
        if (slug) strlist_add(&queue, slug);
      }

      for (size_t qidx = 0; qidx < queue.count; qidx++) {
        const char* proj = queue.items[qidx];
        if (strlist_contains(&visited, proj)) continue;
        strlist_add(&visited, proj);

        char murl[512];
        snprintf(murl, sizeof(murl),
                 "https://api.modrinth.com/v2/project/%s/version?game_versions=%%5B%%22%s%%22%%5D&loaders=%%5B%%22%s%%22%%5D",
                 proj, mc_ver, modrinth_loader);
        char tmp_err[256] = {0};
        PanJsonValue* mvers = http_get_json(hSession, murl, tmp_err, sizeof(tmp_err));
        if (mvers && mvers->type == PAN_JSON_ARRAY && mvers->u.arr.count > 0) {
          const PanJsonValue* chosen = mvers->u.arr.items[0];
          for (size_t mv = 0; mv < mvers->u.arr.count; mv++) {
            const char* vt = pan_json_str(pan_json_get(mvers->u.arr.items[mv], "version_type"), "");
            if (strcmp(vt, "release") == 0) {
              chosen = mvers->u.arr.items[mv];
              break;
            }
          }
          const PanJsonValue* files = pan_json_get(chosen, "files");
          const PanJsonValue* mfile = NULL;
          if (files && files->type == PAN_JSON_ARRAY && files->u.arr.count > 0) {
            for (size_t f = 0; f < files->u.arr.count; f++) {
              if (pan_json_bool(pan_json_get(files->u.arr.items[f], "primary"), 0)) {
                mfile = files->u.arr.items[f];
                break;
              }
            }
            if (!mfile) mfile = files->u.arr.items[0];
          }
          if (mfile) {
            const char* furl = pan_json_str(pan_json_get(mfile, "url"), NULL);
            const char* fname = pan_json_str(pan_json_get(mfile, "filename"), NULL);
            const char* fsha1 = pan_json_str(pan_json_get(pan_json_get(mfile, "hashes"), "sha1"), "");
            if (furl && fname) {
              wchar_t wfn[256], mdest[MAX_PATH];
              utf8_to_wide(fname, wfn, 256);
              _snwprintf(mdest, MAX_PATH, L"%ls\\%ls", mods_dir, wfn);
              if (http_download_file(hSession, furl, mdest, fsha1, tmp_err, sizeof(tmp_err))) {
                strlist_add(&new_managed, fname);
              }
            }
          }
          const PanJsonValue* deps = pan_json_get(chosen, "dependencies");
          if (deps && deps->type == PAN_JSON_ARRAY) {
            for (size_t d = 0; d < deps->u.arr.count; d++) {
              const PanJsonValue* dep = deps->u.arr.items[d];
              const char* dtype = pan_json_str(pan_json_get(dep, "dependency_type"), "");
              const char* dpid = pan_json_str(pan_json_get(dep, "project_id"), "");
              if (strcmp(dtype, "required") == 0 && dpid[0] && !strlist_contains(&visited, dpid)) {
                strlist_add(&queue, dpid);
              }
            }
          }
        }
        pan_json_free(mvers);
      }

      char* m_out = (char*)malloc(8192);
      if (m_out) {
        size_t p = 0;
        m_out[p++] = '[';
        for (size_t i = 0; i < new_managed.count && p + 300 < 8192; i++) {
          char sj[512];
          sanitize_json_str(new_managed.items[i], sj, sizeof(sj));
          p += (size_t)_snprintf(m_out + p, 8192 - p, "%s\"%s\"", (i > 0 ? "," : ""), sj);
        }
        m_out[p++] = ']';
        m_out[p] = '\0';
        write_entire_file_w(managed_path, m_out, p);
        free(m_out);
      }

      strlist_free(&queue);
      strlist_free(&visited);
      strlist_free(&new_managed);
    } else {
      DeleteFileW(managed_path);
    }

    /* Apply enabled user custom mods from <base_dir>\custom-mods cleanly per instance */
    wchar_t custom_managed_path[MAX_PATH];
    _snwprintf(custom_managed_path, MAX_PATH, L"%ls\\pan-custom-mods.json", instance_dir);
    {
      size_t cmlen = 0;
      uint8_t* cmraw = read_entire_file_w(custom_managed_path, &cmlen);
      if (cmraw) {
        PanJsonValue* prevc = pan_json_parse((const char*)cmraw, cmlen);
        if (prevc && prevc->type == PAN_JSON_ARRAY) {
          for (size_t i = 0; i < prevc->u.arr.count; i++) {
            const char* old_cjar = pan_json_str(prevc->u.arr.items[i], NULL);
            if (old_cjar && old_cjar[0]) {
              wchar_t wold[MAX_PATH], wfull[MAX_PATH];
              utf8_to_wide(old_cjar, wold, MAX_PATH);
              _snwprintf(wfull, MAX_PATH, L"%ls\\%ls", mods_dir, wold);
              DeleteFileW(wfull);
            }
          }
        }
        pan_json_free(prevc);
        free(cmraw);
      }
    }

    const PanJsonValue* cmods = pan_json_get(req_json, "customModFiles");
    size_t cmod_count = (cmods && cmods->type == PAN_JSON_ARRAY) ? cmods->u.arr.count : 0;
    if (modded_ready && cmod_count > 0) {
      wchar_t custom_mods_store[MAX_PATH];
      _snwprintf(custom_mods_store, MAX_PATH, L"%ls\\custom-mods", g_mc.base_dir);
      PanStrList applied_custom = {0};
      for (size_t i = 0; i < cmod_count; i++) {
        const char* raw_fn = pan_json_str(cmods->u.arr.items[i], NULL);
        if (!raw_fn || !raw_fn[0]) continue;
        if (strstr(raw_fn, "..") || strchr(raw_fn, '/') || strchr(raw_fn, '\\')) continue;
        wchar_t wfn[256], csrc[MAX_PATH], cdst[MAX_PATH];
        utf8_to_wide(raw_fn, wfn, 256);
        _snwprintf(csrc, MAX_PATH, L"%ls\\%ls", custom_mods_store, wfn);
        _snwprintf(cdst, MAX_PATH, L"%ls\\%ls", mods_dir, wfn);
        if (file_exists_nonempty_w(csrc) && CopyFileW(csrc, cdst, FALSE)) {
          strlist_add(&applied_custom, raw_fn);
        }
      }
      if (applied_custom.count > 0) {
        char* cm_out = (char*)malloc(16384);
        if (cm_out) {
          size_t p = 0;
          cm_out[p++] = '[';
          for (size_t i = 0; i < applied_custom.count && p + 320 < 16384; i++) {
            char sj[512];
            sanitize_json_str(applied_custom.items[i], sj, sizeof(sj));
            p += (size_t)_snprintf(cm_out + p, 16384 - p, "%s\"%s\"", (i > 0 ? "," : ""), sj);
          }
          cm_out[p++] = ']';
          cm_out[p] = '\0';
          write_entire_file_w(custom_managed_path, cm_out, p);
          free(cm_out);
        }
      } else {
        DeleteFileW(custom_managed_path);
      }
      strlist_free(&applied_custom);
    } else {
      DeleteFileW(custom_managed_path);
    }
  }

  /* 8. Sync shared player profile (servers, language, controls, worlds, resourcepacks) then merge video presets */
  sync_mc_state_to_instance_w(g_mc.base_dir, instance_dir, shared_dir);
  {
    wchar_t opt_path[MAX_PATH];
    _snwprintf(opt_path, MAX_PATH, L"%ls\\options.txt", instance_dir);
    opt_path[MAX_PATH - 1] = L'\0';
    const char* opt_txt = pan_json_str(pan_json_get(req_json, "optionsTxt"), NULL);
    if (opt_txt && opt_txt[0]) {
      merge_options_txt_w(opt_path, opt_txt);
    }
    const PanJsonValue* rpacks = pan_json_get(req_json, "enabledResourcePacks");
    if (rpacks && rpacks->type == PAN_JSON_ARRAY) {
      merge_resource_packs_w(opt_path, rpacks, mc_ver);
    }
  }

  /* 9. Build Classpath & JVM Arguments */
  set_pan_statusf("launching", 93, "Configurando JVM y argumentos de Minecraft %s (%s)...", mc_ver, loader);
  char* classpath = NULL;
  {
    char client_utf8[MAX_PATH * 3];
    wide_to_utf8(client_jar, client_utf8, sizeof(client_utf8));
    size_t cp_cap = 32768;
    size_t cp_len = 0;
    classpath = (char*)malloc(cp_cap);
    if (!classpath) {
      snprintf(err_msg, sizeof(err_msg), "Sin memoria para classpath.");
      goto on_error;
    }
    for (size_t i = 0; i < cp_map.count; i++) {
      char item_u8[MAX_PATH * 3];
      wide_to_utf8(cp_map.items[i].val, item_u8, sizeof(item_u8));
      size_t ilen = strlen(item_u8);
      if (cp_len + ilen + 8 >= cp_cap) {
        cp_cap *= 2;
        char* ncp = (char*)realloc(classpath, cp_cap);
        if (!ncp) {
          free(classpath);
          snprintf(err_msg, sizeof(err_msg), "Sin memoria ampliando classpath.");
          goto on_error;
        }
        classpath = ncp;
      }
      memcpy(classpath + cp_len, item_u8, ilen);
      cp_len += ilen;
      classpath[cp_len++] = ';';
    }
    int skip_vanilla_client_cp =
        (strstr(main_class, "BootstrapLauncher") != NULL) ||
        (strstr(main_class, "ForgeBootstrap") != NULL) ||
        (strstr(main_class, "fml.startup.") != NULL);
    if (!skip_vanilla_client_cp) {
      size_t clen = strlen(client_utf8);
      if (cp_len + clen + 4 >= cp_cap) {
        cp_cap = cp_len + clen + 16;
        char* ncp = (char*)realloc(classpath, cp_cap);
        if (!ncp) {
          free(classpath);
          snprintf(err_msg, sizeof(err_msg), "Sin memoria ampliando classpath.");
          goto on_error;
        }
        classpath = ncp;
      }
      memcpy(classpath + cp_len, client_utf8, clen);
      cp_len += clen;
    } else if (cp_len > 0 && classpath[cp_len - 1] == ';') {
      cp_len--;
    }
    classpath[cp_len] = '\0';
  }

  MEMORYSTATUSEX ms;
  ms.dwLength = sizeof(ms);
  int total_ram_mb = 8192;
  if (GlobalMemoryStatusEx(&ms)) {
    total_ram_mb = (int)(ms.ullTotalPhys / (1024ULL * 1024ULL));
  }
  int max_safe_mb = (total_ram_mb * 65) / 100;
  if (max_safe_mb < 1536) max_safe_mb = 1536;
  double req_gb = pan_json_num(pan_json_get(req_json, "ramGb"), 4.0);
  int req_mb = (int)(req_gb * 1024.0 + 0.5);
  if (req_mb < 1024) req_mb = 1024;
  int ram_mb = req_mb < max_safe_mb ? req_mb : max_safe_mb;
  int xms_mb = ram_mb < 1024 ? ram_mb : 1024;

  char xms_arg[64], xmx_arg[64];
  snprintf(xms_arg, sizeof(xms_arg), "-Xms%dM", xms_mb);
  snprintf(xmx_arg, sizeof(xmx_arg), "-Xmx%dM", ram_mb);
  strlist_add(&all_args, xms_arg);
  strlist_add(&all_args, xmx_arg);

  const char* gc_choice = pan_json_str(pan_json_get(req_json, "gc"), "ZGC");
  int using_zgc = (strcmp(gc_choice, "ZGC") == 0 && java_major >= 21);
  if (using_zgc) {
    strlist_add(&all_args, "-XX:+UseZGC");
    if (java_major < 24) {
      strlist_add(&all_args, "-XX:+ZGenerational");
    }
  } else if (strcmp(gc_choice, "Shenandoah") == 0 && java_major >= 17) {
    strlist_add(&all_args, "-XX:+UseShenandoahGC");
  } else {
    strlist_add(&all_args, "-XX:+UseG1GC");
    strlist_add(&all_args, "-XX:+UnlockExperimentalVMOptions");
    strlist_add(&all_args, "-XX:G1NewSizePercent=20");
    strlist_add(&all_args, "-XX:G1ReservePercent=20");
    strlist_add(&all_args, "-XX:MaxGCPauseMillis=35");
    strlist_add(&all_args, "-XX:G1HeapRegionSize=32M");
  }

  if (pan_json_bool(pan_json_get(req_json, "alwaysPreTouch"), 0) && !using_zgc) {
    strlist_add(&all_args, "-XX:+AlwaysPreTouch");
  }
  if (pan_json_bool(pan_json_get(req_json, "stringDeduplication"), 0) && !using_zgc) {
    strlist_add(&all_args, "-XX:+UseStringDeduplication");
  }
  int pthreads = (int)pan_json_num(pan_json_get(req_json, "parallelThreads"), 4);
  if (pthreads < 1) pthreads = 1;
  if (pthreads > 8) pthreads = 8;
  {
    char pt_arg[64];
    snprintf(pt_arg, sizeof(pt_arg), "-XX:ConcGCThreads=%d", pthreads);
    strlist_add(&all_args, pt_arg);
  }
  strlist_add(&all_args, "-XX:+ExplicitGCInvokesConcurrent");
  strlist_add(&all_args, "-XX:+PerfDisableSharedMem");
  strlist_add(&all_args, "-Djdk.nio.maxCachedBufferSize=262144");

  {
    char buf[2048];
    snprintf(buf, sizeof(buf), "-Djava.library.path=%s;%s\\java", natives_utf8, natives_utf8);
    strlist_add(&all_args, buf);
    snprintf(buf, sizeof(buf), "-Dorg.lwjgl.librarypath=%s", natives_utf8);
    strlist_add(&all_args, buf);
    snprintf(buf, sizeof(buf), "-Djna.tmpdir=%s\\jna", natives_utf8);
    strlist_add(&all_args, buf);
    snprintf(buf, sizeof(buf), "-Dorg.lwjgl.system.SharedLibraryExtractPath=%s\\lwjgl", natives_utf8);
    strlist_add(&all_args, buf);
    snprintf(buf, sizeof(buf), "-Dio.netty.native.workdir=%s\\netty", natives_utf8);
    strlist_add(&all_args, buf);
  }
  strlist_add(&all_args, "-Dminecraft.launcher.brand=Pan-launcher");
  strlist_add(&all_args, "-Dminecraft.launcher.version=2.3");

  const PanJsonValue* mc_jvm = pan_json_get(pan_json_get(mc_json, "arguments"), "jvm");
  if (mc_jvm && mc_jvm->type == PAN_JSON_ARRAY) {
    for (size_t i = 0; i < mc_jvm->u.arr.count; i++) {
      const PanJsonValue* node = mc_jvm->u.arr.items[i];
      const char* single = (node->type == PAN_JSON_STRING) ? node->u.str : NULL;
      const PanJsonValue* vals = NULL;
      if (!single && node->type == PAN_JSON_OBJECT && test_mojang_rules(pan_json_get(node, "rules"))) {
        vals = pan_json_get(node, "value");
        if (vals && vals->type == PAN_JSON_STRING) single = vals->u.str;
      }
      size_t vcount = (vals && vals->type == PAN_JSON_ARRAY) ? vals->u.arr.count : (single ? 1 : 0);
      for (size_t v = 0; v < vcount; v++) {
        const char* item = single ? single : pan_json_str(vals->u.arr.items[v], NULL);
        if (!item || !item[0]) continue;
        if (strcmp(item, "-cp") == 0 || strcmp(item, "${classpath}") == 0) continue;
        if (strncmp(item, "-Djava.library.path=", 20) == 0 ||
            strncmp(item, "-Djna.tmpdir=", 13) == 0 ||
            strncmp(item, "-Dorg.lwjgl.system.SharedLibraryExtractPath=", 44) == 0 ||
            strncmp(item, "-Dio.netty.native.workdir=", 26) == 0 ||
            strncmp(item, "-Dminecraft.launcher.", 21) == 0) continue;
        char* b1 = (char*)malloc(8192);
        char* b2 = (char*)malloc(8192);
        if (b1 && b2) {
          str_replace_all(item, "${natives_directory}", natives_utf8, b1, 8192);
          str_replace_all(b1, "${library_directory}", libs_utf8, b2, 8192);
          str_replace_all(b2, "${classpath_separator}", ";", b1, 8192);
          str_replace_all(b1, "${launcher_name}", "Pan-launcher", b2, 8192);
          str_replace_all(b2, "${launcher_version}", "2.3", b1, 8192);
          str_replace_all(b1, "${version_name}", version_name, b2, 8192);
          if (b2[0]) strlist_add(&all_args, b2);
        }
        free(b1);
        free(b2);
      }
    }
  }

  for (size_t i = 0; i < extra_jvm.count; i++) {
    const char* ej = extra_jvm.items[i];
    if (strcmp(ej, "-cp") == 0 || strcmp(ej, "${classpath}") == 0) continue;
    char* b1 = (char*)malloc(8192);
    char* b2 = (char*)malloc(8192);
    if (b1 && b2) {
      str_replace_all(ej, "${natives_directory}", natives_utf8, b1, 8192);
      str_replace_all(b1, "${library_directory}", libs_utf8, b2, 8192);
      str_replace_all(b2, "${classpath_separator}", ";", b1, 8192);
      str_replace_all(b1, "${launcher_name}", "Pan-launcher", b2, 8192);
      str_replace_all(b2, "${launcher_version}", "2.3", b1, 8192);
      str_replace_all(b1, "${version_name}", version_name, b2, 8192);
      if (b2[0]) strlist_add(&all_args, b2);
    }
    free(b1);
    free(b2);
  }

  const char* custom_args = pan_json_str(pan_json_get(req_json, "customArgs"), "");
  if (custom_args[0]) {
    char* copy = xstrdup(custom_args);
    char* ctx = NULL;
    for (char* tok = strtok_s(copy, " ", &ctx); tok; tok = strtok_s(NULL, " ", &ctx)) {
      if (tok[0]) strlist_add(&all_args, tok);
    }
    free(copy);
  }

  strlist_add(&all_args, "-cp");
  strlist_add(&all_args, classpath);
  free(classpath);
  classpath = NULL;

  strlist_add(&all_args, main_class);

  /* Game Arguments */
  const char* player_name = pan_json_str(pan_json_get(req_json, "username"), "PanWarrior");
  if (!player_name[0]) player_name = "PanWarrior";
  const char* acc_type = pan_json_str(pan_json_get(req_json, "accountType"), "offline");
  char player_uuid[48];
  if (strcmp(acc_type, "offline") == 0) {
    compute_offline_uuid(player_name, player_uuid);
  } else {
    const char* ruuid = pan_json_str(pan_json_get(req_json, "uuid"), "");
    size_t u = 0;
    for (size_t i = 0; ruuid[i] && u + 1 < sizeof(player_uuid); i++) {
      if (ruuid[i] != '-') player_uuid[u++] = ruuid[i];
    }
    player_uuid[u] = '\0';
    if (!player_uuid[0]) compute_offline_uuid(player_name, player_uuid);
  }

  PanStrList raw_tokens = {0};
  const PanJsonValue* mc_game = pan_json_get(pan_json_get(mc_json, "arguments"), "game");
  if (mc_game && mc_game->type == PAN_JSON_ARRAY) {
    for (size_t i = 0; i < mc_game->u.arr.count; i++) {
      const char* s = pan_json_str(mc_game->u.arr.items[i], NULL);
      if (s) strlist_add(&raw_tokens, s);
    }
    for (size_t i = 0; i < loader_game.count; i++) {
      strlist_add(&raw_tokens, loader_game.items[i]);
    }
  } else {
    if (loader_game.count > 0) {
      for (size_t i = 0; i < loader_game.count; i++) {
        strlist_add(&raw_tokens, loader_game.items[i]);
      }
    } else {
      const char* legacy = pan_json_str(pan_json_get(mc_json, "minecraftArguments"), NULL);
      if (legacy) {
        char* copy = xstrdup(legacy);
        char* ctx = NULL;
        for (char* tok = strtok_s(copy, " ", &ctx); tok; tok = strtok_s(NULL, " ", &ctx)) {
          if (tok[0]) strlist_add(&raw_tokens, tok);
        }
        free(copy);
      }
    }
  }

  for (size_t i = 0; i < raw_tokens.count; i++) {
    char a[1024], b[1024];
    strncpy(a, raw_tokens.items[i], sizeof(a) - 1);
    a[sizeof(a) - 1] = '\0';
    str_replace_all(a, "${auth_player_name}", player_name, b, sizeof(b));
    str_replace_all(b, "${version_name}", version_name, a, sizeof(a));
    str_replace_all(a, "${game_directory}", inst_dir_utf8, b, sizeof(b));
    str_replace_all(b, "${assets_root}", assets_utf8, a, sizeof(a));
    str_replace_all(a, "${assets_index_name}", asset_id, b, sizeof(b));
    str_replace_all(b, "${auth_uuid}", player_uuid, a, sizeof(a));
    str_replace_all(a, "${auth_access_token}", "0", b, sizeof(b));
    str_replace_all(b, "${clientid}", "0", a, sizeof(a));
    str_replace_all(a, "${auth_xuid}", "0", b, sizeof(b));
    str_replace_all(b, "${user_type}", "legacy", a, sizeof(a));
    str_replace_all(a, "${version_type}", "Pan-launcher", b, sizeof(b));
    str_replace_all(b, "${user_properties}", "{}", a, sizeof(a));
    strlist_add(&all_args, a);
  }
  strlist_free(&raw_tokens);

  const char* srv_addr = pan_json_str(pan_json_get(req_json, "serverAddress"), NULL);
  if (srv_addr && srv_addr[0]) {
    char shost[256] = {0}, sport[32] = "25565";
    const char* colon = strchr(srv_addr, ':');
    if (colon) {
      size_t hlen = (size_t)(colon - srv_addr);
      if (hlen >= sizeof(shost)) hlen = sizeof(shost) - 1;
      memcpy(shost, srv_addr, hlen);
      shost[hlen] = '\0';
      if (colon[1]) strncpy(sport, colon + 1, sizeof(sport) - 1);
    } else {
      strncpy(shost, srv_addr, sizeof(shost) - 1);
    }
    if (mc_game && mc_game->type == PAN_JSON_ARRAY) {
      char hp[300];
      snprintf(hp, sizeof(hp), "%s:%s", shost, sport);
      strlist_add(&all_args, "--quickPlayMultiplayer");
      strlist_add(&all_args, hp);
    } else {
      strlist_add(&all_args, "--server");
      strlist_add(&all_args, shost);
      strlist_add(&all_args, "--port");
      strlist_add(&all_args, sport);
    }
  }

  /* 10. Spawn javaw.exe cleanly with stdout/stderr log capture */
  set_pan_statusf("launching", 97, "Abriendo ventana real de Minecraft Java (%s)...", mc_ver);

  wchar_t out_log[MAX_PATH], err_log[MAX_PATH];
  _snwprintf(out_log, MAX_PATH, L"%ls\\latest-stdout.log", instance_dir);
  _snwprintf(err_log, MAX_PATH, L"%ls\\latest-stderr.log", instance_dir);
  DeleteFileW(out_log);
  DeleteFileW(err_log);

  SECURITY_ATTRIBUTES sa;
  ZeroMemory(&sa, sizeof(sa));
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;

  HANDLE hOut = CreateFileW(out_log, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            &sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  HANDLE hErr = CreateFileW(err_log, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            &sa, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);

  wchar_t w_cmdline[32768] = {0};
  if (java_major >= 17) {
    wchar_t arg_file[MAX_PATH];
    _snwprintf(arg_file, MAX_PATH, L"%ls\\jvm-args.txt", instance_dir);
    char* af_body = build_quoted_argfile(&all_args);
    if (!af_body || !write_entire_file_w(arg_file, af_body, strlen(af_body))) {
      free(af_body);
      if (hOut != INVALID_HANDLE_VALUE) CloseHandle(hOut);
      if (hErr != INVALID_HANDLE_VALUE) CloseHandle(hErr);
      snprintf(err_msg, sizeof(err_msg), "No se pudo escribir jvm-args.txt.");
      goto on_error;
    }
    free(af_body);
    _snwprintf(w_cmdline, 32768, L"\"%ls\" \"@%ls\"", javaw_path, arg_file);
  } else {
    char* cmd_u8 = build_win32_cmdline(javaw_path, &all_args);
    if (!cmd_u8) {
      if (hOut != INVALID_HANDLE_VALUE) CloseHandle(hOut);
      if (hErr != INVALID_HANDLE_VALUE) CloseHandle(hErr);
      snprintf(err_msg, sizeof(err_msg), "Sin memoria construyendo argumentos de Java.");
      goto on_error;
    }
    utf8_to_wide(cmd_u8, w_cmdline, 32768);
    free(cmd_u8);
  }

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = (hOut != INVALID_HANDLE_VALUE) ? hOut : GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = (hErr != INVALID_HANDLE_VALUE) ? hErr : GetStdHandle(STD_ERROR_HANDLE);
  si.hStdInput = INVALID_HANDLE_VALUE;

  BOOL created = CreateProcessW(
      javaw_path, w_cmdline, NULL, NULL, TRUE,
      CREATE_NO_WINDOW, NULL, instance_dir, &si, &pi);

  if (hOut != INVALID_HANDLE_VALUE) CloseHandle(hOut);
  if (hErr != INVALID_HANDLE_VALUE) CloseHandle(hErr);

  if (!created) {
    snprintf(err_msg, sizeof(err_msg), "Windows no pudo iniciar javaw.exe (código %lu).", GetLastError());
    goto on_error;
  }

  DWORD wait_res = WaitForSingleObject(pi.hProcess, 3500);
  if (wait_res == WAIT_OBJECT_0) {
    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    sync_mc_state_back_w(instance_dir, shared_dir);

    char tail[1500] = {0};
    read_log_tail_safe(err_log, tail, sizeof(tail));
    if (!tail[0]) read_log_tail_safe(out_log, tail, sizeof(tail));
    if (!tail[0]) {
      wchar_t mc_log[MAX_PATH];
      _snwprintf(mc_log, MAX_PATH, L"%ls\\logs\\latest.log", instance_dir);
      read_log_tail_safe(mc_log, tail, sizeof(tail));
    }
    snprintf(err_msg, sizeof(err_msg), "Minecraft se cerró al iniciar (código %lu). %s",
             (unsigned long)exit_code, tail);
    goto on_error;
  }

  EnterCriticalSection(&g_mc.cs);
  g_mc.child_process = pi.hProcess;
  LeaveCriticalSection(&g_mc.cs);

  set_pan_status("running", 100, "¡Minecraft Java ejecutándose en tu PC!", "", pi.dwProcessId, mc_ver, inst_dir_utf8);
  InterlockedExchange(&g_mc.launching, 0);

  /* Wait in background for game session completion */
  WaitForSingleObject(pi.hProcess, INFINITE);
  sync_mc_state_back_w(instance_dir, shared_dir);
  {
    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    EnterCriticalSection(&g_mc.cs);
    int still_same = (g_mc.pid == pi.dwProcessId);
    if (g_mc.child_process == pi.hProcess) g_mc.child_process = NULL;
    LeaveCriticalSection(&g_mc.cs);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    if (still_same && !g_mc.stop_requested && !g_mc.user_stopped) {
      if (exit_code != 0) {
        char crash_tail[1500] = {0};
        find_crash_tail_w(instance_dir, err_log, out_log, crash_tail, sizeof(crash_tail));
        char crash_msg[2048];
        snprintf(crash_msg, sizeof(crash_msg), "Minecraft se cerró inesperadamente (código %lu). %s",
                 (unsigned long)exit_code, crash_tail);
        set_pan_status("error", 100, "Minecraft se cerró inesperadamente", crash_msg, 0, mc_ver, inst_dir_utf8);
      } else {
        set_pan_status("finished", 100, "Sesión de Minecraft Java finalizada", "", 0, NULL, NULL);
      }
      if (should_reopen && g_mc.reopen_ui_cb) {
        g_mc.reopen_ui_cb();
      }
    }
  }
  goto cleanup;

on_error:
  set_pan_status("error", 100, "No se pudo iniciar Minecraft Java", err_msg, 0, mc_ver, inst_dir_utf8);
  InterlockedExchange(&g_mc.launching, 0);

cleanup:
  if (hSession) WinHttpCloseHandle(hSession);
  pan_json_free(req_json);
  pan_json_free(mc_json);
  pan_json_free(loader_json);
  pan_json_free(asset_idx_json);
  cpmap_free(&cp_map);
  strlist_free(&extra_jvm);
  strlist_free(&loader_game);
  strlist_free(&all_args);
  return 0;
}

int pan_mc_start_launch(const char* req_json, size_t req_len, char* err_out, size_t err_cap) {
  if (!req_json || req_len == 0) {
    if (err_out) _snprintf(err_out, err_cap, "Falta configuración de lanzamiento");
    return 0;
  }

  if (InterlockedCompareExchange(&g_mc.launching, 1, 0) != 0) {
    /* Already preparing/downloading */
    return 1;
  }

  InterlockedExchange(&g_mc.user_stopped, 0);

  char* copy = (char*)malloc(req_len + 1);
  if (!copy) {
    InterlockedExchange(&g_mc.launching, 0);
    if (err_out) _snprintf(err_out, err_cap, "Sin memoria disponible");
    return 0;
  }
  memcpy(copy, req_json, req_len);
  copy[req_len] = '\0';

  EnterCriticalSection(&g_mc.cs);
  g_mc.log_count = 0;
  free(g_mc.pending_req_json);
  g_mc.pending_req_json = copy;
  g_mc.pending_req_len = req_len;
  LeaveCriticalSection(&g_mc.cs);

  set_pan_status("preparing", 4, "Iniciando motor nativo de Minecraft Java...", "", 0, "", "");

  HANDLE hT = CreateThread(NULL, 0, LaunchWorkerThread, NULL, 0, NULL);
  if (!hT) {
    InterlockedExchange(&g_mc.launching, 0);
    if (err_out) _snprintf(err_out, err_cap, "No se pudo crear el hilo de lanzamiento");
    return 0;
  }
  CloseHandle(hT);
  return 1;
}

int pan_mc_stop(void) {
  if (!g_mc.initialized) return 0;
  InterlockedExchange(&g_mc.user_stopped, 1);
  EnterCriticalSection(&g_mc.cs);
  HANDLE hp = g_mc.child_process;
  if (hp) TerminateProcess(hp, 0);
  g_mc.child_process = NULL;
  LeaveCriticalSection(&g_mc.cs);
  set_pan_status("finished", 100, "Sesión detenida por el usuario", "", 0, NULL, NULL);
  InterlockedExchange(&g_mc.launching, 0);
  return 1;
}

void pan_mc_shutdown(void) {
  InterlockedExchange(&g_mc.stop_requested, 1);
}

int pan_mc_loader_catalog_json(const char* loader, const char* mc_ver, char* out_buf, size_t out_cap) {
  if (!out_buf || out_cap < 128) return 0;
  char low[32] = {0};
  for (size_t i = 0; loader && loader[i] && i + 1 < sizeof(low); i++) {
    low[i] = (char)tolower((unsigned char)loader[i]);
  }
  const char* gv = (mc_ver && mc_ver[0]) ? mc_ver : "1.21.4";
  char esc_ld[64], esc_gv[96];
  sanitize_json_str(low, esc_ld, sizeof(esc_ld));
  sanitize_json_str(gv, esc_gv, sizeof(esc_gv));

  HINTERNET hSession = create_winhttp_session();
  if (!hSession) {
    _snprintf(out_buf, out_cap, "{\"items\":[],\"loader\":\"%s\",\"gameVersion\":\"%s\",\"stale\":true}", esc_ld, esc_gv);
    return 0;
  }

  size_t pos = (size_t)_snprintf(out_buf, out_cap, "{\"items\":[");
  int count = 0;
  int ok = 0;
  char tmp_err[128] = {0};

  if (strcmp(low, "fabric") == 0 || strcmp(low, "quilt") == 0) {
    char url[320];
    if (strcmp(low, "fabric") == 0) {
      snprintf(url, sizeof(url), "https://meta.fabricmc.net/v2/versions/loader/%s", gv);
    } else {
      snprintf(url, sizeof(url), "https://meta.quiltmc.org/v3/versions/loader/%s", gv);
    }
    PanJsonValue* arr = http_get_json(hSession, url, tmp_err, sizeof(tmp_err));
    if (arr && arr->type == PAN_JSON_ARRAY) {
      ok = 1;
      for (size_t i = 0; i < arr->u.arr.count && count < 60 && pos + 256 < out_cap; i++) {
        const PanJsonValue* lnode = pan_json_get(arr->u.arr.items[i], "loader");
        const char* ver = pan_json_str(pan_json_get(lnode, "version"), "");
        if (!ver[0]) continue;
        int stable = (strcmp(low, "fabric") == 0)
            ? pan_json_bool(pan_json_get(lnode, "stable"), 0)
            : (!strstr(ver, "-beta") && !strstr(ver, "-alpha"));
        char ev[128];
        sanitize_json_str(ver, ev, sizeof(ev));
        pos += (size_t)_snprintf(
            out_buf + pos, out_cap - pos,
            "%s{\"id\":\"%s\",\"label\":\"%s\",\"stable\":%s}",
            count > 0 ? "," : "", ev, ev, stable ? "true" : "false");
        count++;
      }
    }
    pan_json_free(arr);
  } else if (strcmp(low, "forge") == 0) {
    size_t xlen = 0;
    char* xml = http_get_text(hSession, "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
                              &xlen, tmp_err, sizeof(tmp_err));
    if (xml) {
      ok = 1;
      char prefix[80];
      snprintf(prefix, sizeof(prefix), "%s-", gv);
      size_t plen = strlen(prefix);
      char* matches[128];
      int mcnt = 0;
      const char* p = xml;
      while ((p = strstr(p, "<version>")) != NULL) {
        p += 9;
        const char* end = strstr(p, "</version>");
        if (!end) break;
        size_t vlen = (size_t)(end - p);
        if (vlen > plen && vlen < 120 && strncmp(p, prefix, plen) == 0) {
          char sub[120];
          memcpy(sub, p + plen, vlen - plen);
          sub[vlen - plen] = '\0';
          if (mcnt < 128) matches[mcnt++] = xstrdup(sub);
        }
        p = end;
      }
      for (int i = mcnt - 1; i >= 0 && count < 60 && pos + 256 < out_cap; i--) {
        if (!matches[i]) continue;
        char ev[128];
        sanitize_json_str(matches[i], ev, sizeof(ev));
        pos += (size_t)_snprintf(
            out_buf + pos, out_cap - pos,
            "%s{\"id\":\"%s\",\"label\":\"%s\",\"stable\":%s}",
            count > 0 ? "," : "", ev, ev, (i == mcnt - 1) ? "true" : "false");
        count++;
      }
      for (int i = 0; i < mcnt; i++) free(matches[i]);
      free(xml);
    }
  } else if (strcmp(low, "neoforge") == 0) {
    size_t xlen = 0;
    char* xml = http_get_text(hSession, "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
                              &xlen, tmp_err, sizeof(tmp_err));
    if (xml) {
      ok = 1;
      char k1[64], k2[64];
      if (strncmp(gv, "1.", 2) == 0) snprintf(k1, sizeof(k1), "%s.", gv + 2);
      else snprintf(k1, sizeof(k1), "%s.", gv);
      snprintf(k2, sizeof(k2), "%s.", gv);
      char* matches[128];
      int mcnt = 0;
      const char* p = xml;
      while ((p = strstr(p, "<version>")) != NULL) {
        p += 9;
        const char* end = strstr(p, "</version>");
        if (!end) break;
        size_t vlen = (size_t)(end - p);
        if (vlen > 0 && vlen < 96) {
          char cand[96];
          memcpy(cand, p, vlen);
          cand[vlen] = '\0';
          if (strncmp(cand, k1, strlen(k1)) == 0 || strncmp(cand, k2, strlen(k2)) == 0) {
            if (mcnt < 128) matches[mcnt++] = xstrdup(cand);
          }
        }
        p = end;
      }
      for (int i = mcnt - 1; i >= 0 && count < 60 && pos + 256 < out_cap; i--) {
        if (!matches[i]) continue;
        int stable = !strstr(matches[i], "-beta") && !strstr(matches[i], "-alpha");
        char ev[128];
        sanitize_json_str(matches[i], ev, sizeof(ev));
        pos += (size_t)_snprintf(
            out_buf + pos, out_cap - pos,
            "%s{\"id\":\"%s\",\"label\":\"%s\",\"stable\":%s}",
            count > 0 ? "," : "", ev, ev, stable ? "true" : "false");
        count++;
      }
      for (int i = 0; i < mcnt; i++) free(matches[i]);
      free(xml);
    }
  }

  WinHttpCloseHandle(hSession);
  _snprintf(out_buf + pos, out_cap - pos,
            "],\"loader\":\"%s\",\"gameVersion\":\"%s\",\"stale\":%s,\"source\":\"native-host\"}",
            esc_ld, esc_gv, ok ? "false" : "true");
  out_buf[out_cap - 1] = '\0';
  return ok;
}

