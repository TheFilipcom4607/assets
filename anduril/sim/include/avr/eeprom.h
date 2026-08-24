// avr/eeprom.h: EEPROM shim.  Backed by a byte array the JS host mirrors into
// localStorage, so saved config survives a page reload the way it survives a
// battery change on a real light.
#pragma once

#include <stdint.h>

uint8_t sim_eeprom_read(uint16_t addr);
void    sim_eeprom_write(uint16_t addr, uint8_t value);

// The firmware addresses EEPROM with (uint8_t *) casts of small integers;
// those values are offsets, never real pointers.
#define eeprom_read_byte(p)       sim_eeprom_read((uint16_t)(uintptr_t)(p))
#define eeprom_write_byte(p, v)   sim_eeprom_write((uint16_t)(uintptr_t)(p), (v))
#define eeprom_update_byte(p, v)  sim_eeprom_write((uint16_t)(uintptr_t)(p), (v))
#define eeprom_busy_wait()        ((void)0)
