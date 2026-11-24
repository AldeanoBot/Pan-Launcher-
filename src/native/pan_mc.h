#ifndef PAN_MC_H
#define PAN_MC_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

void pan_mc_init(const wchar_t* base_dir);
int pan_mc_start_launch(const char* req_json, size_t req_len, char* err_out, size_t err_cap);
void pan_mc_get_status_json(char* out_buf, size_t out_cap);
void pan_mc_shutdown(void);

#ifdef __cplusplus
}
#endif

#endif /* PAN_MC_H */
