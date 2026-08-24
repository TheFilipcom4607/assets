// avr/io.h: stand-in for the AVR device header, for the web simulator.
// The simulated hwdef declares its own "registers" as plain variables, so
// nothing here describes real silicon.
#pragma once

#include <stdint.h>
#include <stddef.h>
#include "sim/simcore.h"

#ifndef _BV
#define _BV(bit)  (1 << (bit))
#endif

#ifdef SIM_LEGACY
// Anduril 1 talks to the chip's registers directly, so it gets a register file
#include "sim/legacy.h"
#define EEPROM_SIZE  256      // attiny1634
#else

// bit positions / masks, in the style the AVR headers use
#define PIN0_bp 0
#define PIN1_bp 1
#define PIN2_bp 2
#define PIN3_bp 3
#define PIN4_bp 4
#define PIN5_bp 5
#define PIN6_bp 6
#define PIN7_bp 7
#define PIN0_bm 0x01
#define PIN1_bm 0x02
#define PIN2_bm 0x04
#define PIN3_bm 0x08
#define PIN4_bm 0x10
#define PIN5_bm 0x20
#define PIN6_bm 0x40
#define PIN7_bm 0x80

// port register bits used by the aux LED code
#define PORT_PULLUPEN_bm  0x08
#define PORT_ISC_gm       0x07
#define PORT_ISC_BOTHEDGES_gc  0x01

// memory sizes the firmware asks about
#define PROGMEM_SIZE  16384
#define EEPROM_SIZE     256

// avr-libc spells this out for locking down protected registers
#define _PROTECTED_WRITE(reg, value)  ((reg) = (value))

#endif  // SIM_LEGACY
