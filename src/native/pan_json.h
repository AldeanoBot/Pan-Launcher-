#ifndef PAN_JSON_H
#define PAN_JSON_H

#include <ctype.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef enum {
  PAN_JSON_NULL = 0,
  PAN_JSON_BOOL = 1,
  PAN_JSON_NUMBER = 2,
  PAN_JSON_STRING = 3,
  PAN_JSON_ARRAY = 4,
  PAN_JSON_OBJECT = 5
} PanJsonType;

typedef struct PanJsonValue PanJsonValue;

typedef struct {
  char* key;
  PanJsonValue* val;
} PanJsonPair;

struct PanJsonValue {
  PanJsonType type;
  union {
    int boolean;
    double number;
    char* str;
    struct {
      PanJsonValue** items;
      size_t count;
      size_t cap;
    } arr;
    struct {
      PanJsonPair* pairs;
      size_t count;
      size_t cap;
    } obj;
  } u;
};

typedef struct {
  const char* p;
  const char* end;
  int depth;
} PanJsonParser;

static void pan_json_skip_ws(PanJsonParser* jp) {
  while (jp->p < jp->end) {
    unsigned char c = (unsigned char)*jp->p;
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
      jp->p++;
    } else {
      break;
    }
  }
}

static PanJsonValue* pan_json_alloc(PanJsonType t) {
  PanJsonValue* v = (PanJsonValue*)calloc(1, sizeof(PanJsonValue));
  if (v) v->type = t;
  return v;
}

static void pan_json_free(PanJsonValue* v) {
  if (!v) return;
  if (v->type == PAN_JSON_STRING) {
    free(v->u.str);
  } else if (v->type == PAN_JSON_ARRAY) {
    for (size_t i = 0; i < v->u.arr.count; i++) {
      pan_json_free(v->u.arr.items[i]);
    }
    free(v->u.arr.items);
  } else if (v->type == PAN_JSON_OBJECT) {
    for (size_t i = 0; i < v->u.obj.count; i++) {
      free(v->u.obj.pairs[i].key);
      pan_json_free(v->u.obj.pairs[i].val);
    }
    free(v->u.obj.pairs);
  }
  free(v);
}

static int pan_json_hex4(const char* p, uint32_t* out) {
  uint32_t v = 0;
  for (int i = 0; i < 4; i++) {
    unsigned char c = (unsigned char)p[i];
    v <<= 4;
    if (c >= '0' && c <= '9') v |= (uint32_t)(c - '0');
    else if (c >= 'a' && c <= 'f') v |= (uint32_t)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') v |= (uint32_t)(c - 'A' + 10);
    else return 0;
  }
  *out = v;
  return 1;
}

static size_t pan_json_emit_utf8(char* dst, uint32_t cp) {
  if (cp <= 0x7Fu) {
    dst[0] = (char)cp;
    return 1;
  } else if (cp <= 0x7FFu) {
    dst[0] = (char)(0xC0u | (cp >> 6));
    dst[1] = (char)(0x80u | (cp & 0x3Fu));
    return 2;
  } else if (cp <= 0xFFFFu) {
    dst[0] = (char)(0xE0u | (cp >> 12));
    dst[1] = (char)(0x80u | ((cp >> 6) & 0x3Fu));
    dst[2] = (char)(0x80u | (cp & 0x3Fu));
    return 3;
  } else {
    dst[0] = (char)(0xF0u | (cp >> 18));
    dst[1] = (char)(0x80u | ((cp >> 12) & 0x3Fu));
    dst[2] = (char)(0x80u | ((cp >> 6) & 0x3Fu));
    dst[3] = (char)(0x80u | (cp & 0x3Fu));
    return 4;
  }
}

static char* pan_json_parse_raw_str(PanJsonParser* jp) {
  if (jp->p >= jp->end || *jp->p != '"') return NULL;
  jp->p++;

  size_t cap = 64;
  size_t len = 0;
  char* buf = (char*)malloc(cap);
  if (!buf) return NULL;

  while (jp->p < jp->end) {
    unsigned char c = (unsigned char)*jp->p++;
    if (c == '"') {
      buf[len] = '\0';
      return buf;
    }
    if (len + 8 >= cap) {
      cap *= 2;
      char* nb = (char*)realloc(buf, cap);
      if (!nb) {
        free(buf);
        return NULL;
      }
      buf = nb;
    }
    if (c == '\\') {
      if (jp->p >= jp->end) {
        free(buf);
        return NULL;
      }
      char e = *jp->p++;
      switch (e) {
        case '"': buf[len++] = '"'; break;
        case '\\': buf[len++] = '\\'; break;
        case '/': buf[len++] = '/'; break;
        case 'b': buf[len++] = '\b'; break;
        case 'f': buf[len++] = '\f'; break;
        case 'n': buf[len++] = '\n'; break;
        case 'r': buf[len++] = '\r'; break;
        case 't': buf[len++] = '\t'; break;
        case 'u': {
          if (jp->p + 4 > jp->end) {
            free(buf);
            return NULL;
          }
          uint32_t cp = 0;
          if (!pan_json_hex4(jp->p, &cp)) {
            free(buf);
            return NULL;
          }
          jp->p += 4;
          if (cp >= 0xD800u && cp <= 0xDBFFu && jp->p + 6 <= jp->end && jp->p[0] == '\\' && jp->p[1] == 'u') {
            uint32_t lo = 0;
            if (pan_json_hex4(jp->p + 2, &lo) && lo >= 0xDC00u && lo <= 0xDFFFu) {
              jp->p += 6;
              cp = 0x10000u + (((cp - 0xD800u) << 10) | (lo - 0xDC00u));
            }
          }
          len += pan_json_emit_utf8(buf + len, cp);
          break;
        }
        default:
          buf[len++] = e;
          break;
      }
    } else {
      buf[len++] = (char)c;
    }
  }

  free(buf);
  return NULL;
}

static PanJsonValue* pan_json_parse_val(PanJsonParser* jp);

static PanJsonValue* pan_json_parse_arr(PanJsonParser* jp) {
  jp->p++; /* '[' */
  PanJsonValue* arr = pan_json_alloc(PAN_JSON_ARRAY);
  if (!arr) return NULL;

  pan_json_skip_ws(jp);
  if (jp->p < jp->end && *jp->p == ']') {
    jp->p++;
    return arr;
  }

  for (;;) {
    PanJsonValue* item = pan_json_parse_val(jp);
    if (!item) {
      pan_json_free(arr);
      return NULL;
    }
    if (arr->u.arr.count >= arr->u.arr.cap) {
      size_t ncap = arr->u.arr.cap ? arr->u.arr.cap * 2 : 8;
      PanJsonValue** ni = (PanJsonValue**)realloc(arr->u.arr.items, ncap * sizeof(PanJsonValue*));
      if (!ni) {
        pan_json_free(item);
        pan_json_free(arr);
        return NULL;
      }
      arr->u.arr.items = ni;
      arr->u.arr.cap = ncap;
    }
    arr->u.arr.items[arr->u.arr.count++] = item;

    pan_json_skip_ws(jp);
    if (jp->p < jp->end && *jp->p == ',') {
      jp->p++;
      continue;
    }
    if (jp->p < jp->end && *jp->p == ']') {
      jp->p++;
      return arr;
    }
    pan_json_free(arr);
    return NULL;
  }
}

static PanJsonValue* pan_json_parse_obj(PanJsonParser* jp) {
  jp->p++; /* '{' */
  PanJsonValue* obj = pan_json_alloc(PAN_JSON_OBJECT);
  if (!obj) return NULL;

  pan_json_skip_ws(jp);
  if (jp->p < jp->end && *jp->p == '}') {
    jp->p++;
    return obj;
  }

  for (;;) {
    pan_json_skip_ws(jp);
    char* key = pan_json_parse_raw_str(jp);
    if (!key) {
      pan_json_free(obj);
      return NULL;
    }
    pan_json_skip_ws(jp);
    if (jp->p >= jp->end || *jp->p != ':') {
      free(key);
      pan_json_free(obj);
      return NULL;
    }
    jp->p++;
    PanJsonValue* val = pan_json_parse_val(jp);
    if (!val) {
      free(key);
      pan_json_free(obj);
      return NULL;
    }

    if (obj->u.obj.count >= obj->u.obj.cap) {
      size_t ncap = obj->u.obj.cap ? obj->u.obj.cap * 2 : 8;
      PanJsonPair* np = (PanJsonPair*)realloc(obj->u.obj.pairs, ncap * sizeof(PanJsonPair));
      if (!np) {
        free(key);
        pan_json_free(val);
        pan_json_free(obj);
        return NULL;
      }
      obj->u.obj.pairs = np;
      obj->u.obj.cap = ncap;
    }
    obj->u.obj.pairs[obj->u.obj.count].key = key;
    obj->u.obj.pairs[obj->u.obj.count].val = val;
    obj->u.obj.count++;

    pan_json_skip_ws(jp);
    if (jp->p < jp->end && *jp->p == ',') {
      jp->p++;
      continue;
    }
    if (jp->p < jp->end && *jp->p == '}') {
      jp->p++;
      return obj;
    }
    pan_json_free(obj);
    return NULL;
  }
}

static PanJsonValue* pan_json_parse_val(PanJsonParser* jp) {
  if (jp->depth > 64) return NULL;
  pan_json_skip_ws(jp);
  if (jp->p >= jp->end) return NULL;

  char c = *jp->p;
  if (c == '{') {
    jp->depth++;
    PanJsonValue* v = pan_json_parse_obj(jp);
    jp->depth--;
    return v;
  }
  if (c == '[') {
    jp->depth++;
    PanJsonValue* v = pan_json_parse_arr(jp);
    jp->depth--;
    return v;
  }
  if (c == '"') {
    char* s = pan_json_parse_raw_str(jp);
    if (!s) return NULL;
    PanJsonValue* v = pan_json_alloc(PAN_JSON_STRING);
    if (!v) {
      free(s);
      return NULL;
    }
    v->u.str = s;
    return v;
  }
  if (c == 't' && jp->p + 4 <= jp->end && memcmp(jp->p, "true", 4) == 0) {
    jp->p += 4;
    PanJsonValue* v = pan_json_alloc(PAN_JSON_BOOL);
    if (v) v->u.boolean = 1;
    return v;
  }
  if (c == 'f' && jp->p + 5 <= jp->end && memcmp(jp->p, "false", 5) == 0) {
    jp->p += 5;
    PanJsonValue* v = pan_json_alloc(PAN_JSON_BOOL);
    if (v) v->u.boolean = 0;
    return v;
  }
  if (c == 'n' && jp->p + 4 <= jp->end && memcmp(jp->p, "null", 4) == 0) {
    jp->p += 4;
    return pan_json_alloc(PAN_JSON_NULL);
  }
  if (c == '-' || (c >= '0' && c <= '9')) {
    const char* start = jp->p;
    if (*jp->p == '-') jp->p++;
    while (jp->p < jp->end && isdigit((unsigned char)*jp->p)) jp->p++;
    if (jp->p < jp->end && *jp->p == '.') {
      jp->p++;
      while (jp->p < jp->end && isdigit((unsigned char)*jp->p)) jp->p++;
    }
    if (jp->p < jp->end && (*jp->p == 'e' || *jp->p == 'E')) {
      jp->p++;
      if (jp->p < jp->end && (*jp->p == '+' || *jp->p == '-')) jp->p++;
      while (jp->p < jp->end && isdigit((unsigned char)*jp->p)) jp->p++;
    }
    size_t nlen = (size_t)(jp->p - start);
    if (nlen == 0 || nlen >= 64) return NULL;
    char tmp[64];
    memcpy(tmp, start, nlen);
    tmp[nlen] = '\0';
    PanJsonValue* v = pan_json_alloc(PAN_JSON_NUMBER);
    if (v) v->u.number = strtod(tmp, NULL);
    return v;
  }
  return NULL;
}

static inline PanJsonValue* pan_json_parse(const char* text, size_t len) {
  if (!text) return NULL;
  /* Strip optional UTF-8 BOM */
  if (len >= 3 && (unsigned char)text[0] == 0xEF && (unsigned char)text[1] == 0xBB && (unsigned char)text[2] == 0xBF) {
    text += 3;
    len -= 3;
  }
  PanJsonParser jp;
  jp.p = text;
  jp.end = text + len;
  jp.depth = 0;
  return pan_json_parse_val(&jp);
}

static inline const PanJsonValue* pan_json_get(const PanJsonValue* obj, const char* key) {
  if (!obj || obj->type != PAN_JSON_OBJECT || !key) return NULL;
  for (size_t i = 0; i < obj->u.obj.count; i++) {
    if (strcmp(obj->u.obj.pairs[i].key, key) == 0) {
      return obj->u.obj.pairs[i].val;
    }
  }
  return NULL;
}

static inline const char* pan_json_str(const PanJsonValue* v, const char* def_val) {
  if (v && v->type == PAN_JSON_STRING && v->u.str) return v->u.str;
  return def_val;
}

static inline int pan_json_bool(const PanJsonValue* v, int def_val) {
  if (v && v->type == PAN_JSON_BOOL) return v->u.boolean;
  return def_val;
}

static inline double pan_json_num(const PanJsonValue* v, double def_val) {
  if (v && v->type == PAN_JSON_NUMBER) return v->u.number;
  return def_val;
}

#endif /* PAN_JSON_H */
