// avr/pgmspace.h: flash-memory shim.  wasm has one flat address space, so
// "program memory" is ordinary memory and the accessors are plain loads.
#pragma once

#include <stdint.h>

#define PROGMEM
#define PGM_P const char *
#define PSTR(s) (s)

#define pgm_read_byte(addr)   (*(const uint8_t  *)(addr))
#define pgm_read_word(addr)   (*(const uint16_t *)(addr))
#define pgm_read_dword(addr)  (*(const uint32_t *)(addr))
#define pgm_read_ptr(addr)    (*(void * const *)(addr))
#define memcpy_P  memcpy
