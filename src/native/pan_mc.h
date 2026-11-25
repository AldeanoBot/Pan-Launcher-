#ifndef PAN_MC_H
#define PAN_MC_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*PanMcReopenUiFn)(void);

void pan_mc_init(const wchar_t* base_dir);
void pan_mc_set_reopen_ui_cb(PanMcReopenUiFn cb);
int pan_mc_start_launch(const char* req_json, size_t req_len, char* err_out, size_t err_cap);
int pan_mc_stop(void);
int pan_mc_loader_catalog_json(const char* loader, const char* mc_ver, char* out_buf, size_t out_cap);
void pan_mc_get_status_json(char* out_buf, size_t out_cap);
void pan_mc_shutdown(void);

#ifdef __cplusplus
}
#endif

#endif /* PAN_MC_H */
