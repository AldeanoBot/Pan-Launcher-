#ifndef PAN_ZIP_H
#define PAN_ZIP_H

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* Minimal self-contained RFC-1951 Inflate + ZIP reader (STORE=0, DEFLATE=8) */

typedef struct {
  const uint8_t* src;
  size_t src_len;
  size_t byte_pos;
  uint32_t bit_buf;
  int bit_cnt;
} PanBitReader;

typedef struct {
  uint16_t counts[16];
  uint16_t symbols[320];
} PanHuffTable;

static inline uint32_t pan_rd16(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8);
}

static inline uint32_t pan_rd32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void pan_br_init(PanBitReader* br, const uint8_t* src, size_t len) {
  br->src = src;
  br->src_len = len;
  br->byte_pos = 0;
  br->bit_buf = 0;
  br->bit_cnt = 0;
}

static uint32_t pan_br_bits(PanBitReader* br, int n) {
  while (br->bit_cnt < n) {
    uint8_t b = (br->byte_pos < br->src_len) ? br->src[br->byte_pos++] : 0;
    br->bit_buf |= ((uint32_t)b) << br->bit_cnt;
    br->bit_cnt += 8;
  }
  uint32_t val = br->bit_buf & ((1u << n) - 1u);
  br->bit_buf >>= n;
  br->bit_cnt -= n;
  return val;
}

static void pan_br_align(PanBitReader* br) {
  int drop = br->bit_cnt & 7;
  if (drop) {
    br->bit_buf >>= drop;
    br->bit_cnt -= drop;
  }
  while (br->bit_cnt >= 8 && br->byte_pos > 0) {
    br->byte_pos--;
    br->bit_cnt -= 8;
  }
  br->bit_buf = 0;
  br->bit_cnt = 0;
}

static int pan_huff_build(PanHuffTable* tbl, const uint8_t* lengths, int num_syms) {
  int offs[16];
  memset(tbl->counts, 0, sizeof(tbl->counts));
  for (int i = 0; i < num_syms; i++) {
    if (lengths[i] > 15) return 0;
    tbl->counts[lengths[i]]++;
  }
  if (tbl->counts[0] == num_syms) return 1;

  int left = 1;
  for (int len = 1; len <= 15; len++) {
    left <<= 1;
    left -= tbl->counts[len];
    if (left < 0) return 0;
  }

  offs[1] = 0;
  for (int len = 1; len < 15; len++) {
    offs[len + 1] = offs[len] + tbl->counts[len];
  }
  for (int sym = 0; sym < num_syms; sym++) {
    int len = lengths[sym];
    if (len != 0) {
      tbl->symbols[offs[len]++] = (uint16_t)sym;
    }
  }
  return 1;
}

static int pan_huff_decode(PanBitReader* br, const PanHuffTable* tbl) {
  int code = 0;
  int first = 0;
  int index = 0;
  for (int len = 1; len <= 15; len++) {
    code |= (int)pan_br_bits(br, 1);
    int count = tbl->counts[len];
    if (code - count < first) {
      return tbl->symbols[index + (code - first)];
    }
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  return -1;
}

static int pan_inflate(const uint8_t* src, size_t src_len, uint8_t* dst, size_t dst_len) {
  static const uint16_t len_base[29] = {
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
      35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258};
  static const uint8_t len_extra[29] = {
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
      3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
  static const uint16_t dist_base[30] = {
      1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
      257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
  static const uint8_t dist_extra[30] = {
      0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
      7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};
  static const uint8_t cl_order[19] = {
      16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15};

  PanBitReader br;
  pan_br_init(&br, src, src_len);

  size_t out_pos = 0;
  int bfinal = 0;

  while (!bfinal) {
    bfinal = (int)pan_br_bits(&br, 1);
    uint32_t btype = pan_br_bits(&br, 2);

    if (btype == 0) {
      pan_br_align(&br);
      if (br.byte_pos + 4 > br.src_len) return 0;
      uint16_t len = (uint16_t)pan_rd16(br.src + br.byte_pos);
      uint16_t nlen = (uint16_t)pan_rd16(br.src + br.byte_pos + 2);
      br.byte_pos += 4;
      if (((unsigned)(len ^ 0xFFFFu) & 0xFFFFu) != (unsigned)nlen) return 0;
      if (br.byte_pos + len > br.src_len || out_pos + len > dst_len) return 0;
      memcpy(dst + out_pos, br.src + br.byte_pos, len);
      br.byte_pos += len;
      out_pos += len;
    } else if (btype == 1 || btype == 2) {
      PanHuffTable lit_tbl, dist_tbl;
      uint8_t lengths[320];

      if (btype == 1) {
        int i = 0;
        for (; i <= 143; i++) lengths[i] = 8;
        for (; i <= 255; i++) lengths[i] = 9;
        for (; i <= 279; i++) lengths[i] = 7;
        for (; i <= 287; i++) lengths[i] = 8;
        if (!pan_huff_build(&lit_tbl, lengths, 288)) return 0;
        for (i = 0; i < 32; i++) lengths[i] = 5;
        if (!pan_huff_build(&dist_tbl, lengths, 32)) return 0;
      } else {
        int hlit = (int)pan_br_bits(&br, 5) + 257;
        int hdist = (int)pan_br_bits(&br, 5) + 1;
        int hclen = (int)pan_br_bits(&br, 4) + 4;
        if (hlit > 286 || hdist > 30) return 0;

        uint8_t cl_lens[19];
        memset(cl_lens, 0, sizeof(cl_lens));
        for (int i = 0; i < hclen; i++) {
          cl_lens[cl_order[i]] = (uint8_t)pan_br_bits(&br, 3);
        }
        PanHuffTable cl_tbl;
        if (!pan_huff_build(&cl_tbl, cl_lens, 19)) return 0;

        int total = hlit + hdist;
        int idx = 0;
        while (idx < total) {
          int sym = pan_huff_decode(&br, &cl_tbl);
          if (sym < 0) return 0;
          if (sym < 16) {
            lengths[idx++] = (uint8_t)sym;
          } else {
            uint8_t val = 0;
            int rep = 0;
            if (sym == 16) {
              if (idx == 0) return 0;
              val = lengths[idx - 1];
              rep = 3 + (int)pan_br_bits(&br, 2);
            } else if (sym == 17) {
              rep = 3 + (int)pan_br_bits(&br, 3);
            } else {
              rep = 11 + (int)pan_br_bits(&br, 7);
            }
            if (idx + rep > total) return 0;
            while (rep-- > 0) lengths[idx++] = val;
          }
        }
        if (!pan_huff_build(&lit_tbl, lengths, hlit)) return 0;
        if (!pan_huff_build(&dist_tbl, lengths + hlit, hdist)) return 0;
      }

      for (;;) {
        int sym = pan_huff_decode(&br, &lit_tbl);
        if (sym < 0) return 0;
        if (sym < 256) {
          if (out_pos >= dst_len) return 0;
          dst[out_pos++] = (uint8_t)sym;
        } else if (sym == 256) {
          break;
        } else {
          int lidx = sym - 257;
          if (lidx < 0 || lidx >= 29) return 0;
          size_t match_len = (size_t)len_base[lidx] + (size_t)pan_br_bits(&br, len_extra[lidx]);
          int dsym = pan_huff_decode(&br, &dist_tbl);
          if (dsym < 0 || dsym >= 30) return 0;
          size_t match_dist = (size_t)dist_base[dsym] + (size_t)pan_br_bits(&br, dist_extra[dsym]);
          if (match_dist == 0 || match_dist > out_pos || out_pos + match_len > dst_len) return 0;
          for (size_t k = 0; k < match_len; k++) {
            dst[out_pos] = dst[out_pos - match_dist];
            out_pos++;
          }
        }
      }
    } else {
      return 0;
    }
  }

  return out_pos == dst_len;
}

typedef int (*PanZipEntryCallback)(
    const char* name,
    const uint8_t* data,
    size_t data_len,
    size_t index,
    size_t total,
    void* user);

static int pan_zip_extract_memory(
    const uint8_t* zip_buf,
    size_t zip_len,
    PanZipEntryCallback cb,
    void* user) {
  if (!zip_buf || zip_len < 22) return 0;

  /* Locate End of Central Directory (PK\x05\x06) */
  size_t max_search = zip_len < 65558 ? zip_len : 65558;
  size_t eocd_off = 0;
  int found = 0;
  for (size_t back = 22; back <= max_search; back++) {
    size_t pos = zip_len - back;
    if (zip_buf[pos] == 0x50 && zip_buf[pos + 1] == 0x4B &&
        zip_buf[pos + 2] == 0x05 && zip_buf[pos + 3] == 0x06) {
      eocd_off = pos;
      found = 1;
      break;
    }
  }
  if (!found) return 0;

  uint16_t entry_count = (uint16_t)pan_rd16(zip_buf + eocd_off + 10);
  uint32_t cd_size = pan_rd32(zip_buf + eocd_off + 12);
  uint32_t cd_off = pan_rd32(zip_buf + eocd_off + 16);
  if ((uint64_t)cd_off + cd_size > eocd_off) return 0;

  size_t cursor = cd_off;
  for (size_t idx = 0; idx < entry_count; idx++) {
    if (cursor + 46 > eocd_off) return 0;
    if (pan_rd32(zip_buf + cursor) != 0x02014B50u) return 0;

    uint16_t method = (uint16_t)pan_rd16(zip_buf + cursor + 10);
    uint32_t comp_size = pan_rd32(zip_buf + cursor + 20);
    uint32_t uncomp_size = pan_rd32(zip_buf + cursor + 24);
    uint16_t name_len = (uint16_t)pan_rd16(zip_buf + cursor + 28);
    uint16_t extra_len = (uint16_t)pan_rd16(zip_buf + cursor + 30);
    uint16_t comment_len = (uint16_t)pan_rd16(zip_buf + cursor + 32);
    uint32_t lfh_off = pan_rd32(zip_buf + cursor + 42);

    if (cursor + 46 + name_len + extra_len + comment_len > eocd_off) return 0;
    if (name_len == 0 || name_len >= 512) return 0;

    char name[512];
    memcpy(name, zip_buf + cursor + 46, name_len);
    name[name_len] = '\0';
    cursor += 46 + name_len + extra_len + comment_len;

    if (name[name_len - 1] == '/') continue;
    if (strstr(name, "..") != NULL) continue;

    if ((uint64_t)lfh_off + 30 > cd_off) return 0;
    if (pan_rd32(zip_buf + lfh_off) != 0x04034B50u) return 0;
    uint16_t lfh_name_len = (uint16_t)pan_rd16(zip_buf + lfh_off + 26);
    uint16_t lfh_extra_len = (uint16_t)pan_rd16(zip_buf + lfh_off + 28);
    size_t data_off = (size_t)lfh_off + 30 + lfh_name_len + lfh_extra_len;
    if (data_off + comp_size > cd_off) return 0;

    if (method == 0) {
      if (comp_size != uncomp_size) return 0;
      if (!cb(name, zip_buf + data_off, uncomp_size, idx, entry_count, user)) return 0;
    } else if (method == 8) {
      if (uncomp_size > 256u * 1024u * 1024u) return 0;
      uint8_t* out = (uint8_t*)malloc(uncomp_size ? uncomp_size : 1);
      if (!out) return 0;
      int ok = pan_inflate(zip_buf + data_off, comp_size, out, uncomp_size);
      if (!ok) {
        free(out);
        return 0;
      }
      int cb_ok = cb(name, out, uncomp_size, idx, entry_count, user);
      free(out);
      if (!cb_ok) return 0;
    } else {
      return 0;
    }
  }

  return 1;
}

#endif /* PAN_ZIP_H */
