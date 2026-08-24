// util/delay_basic.h: busy-wait loops, in virtual time.
// On AVR these burn CPU cycles; here they advance the simulated clock by the
// same number of cycles, so firmware timing comes out identical.
#pragma once

#include <stdint.h>

void sim_burn_cycles(uint32_t cycles);

// avr-libc: 3 cycles per iteration, count of 0 means 256
static inline void _delay_loop_1(uint8_t count) {
    sim_burn_cycles(3UL * (count ? count : 256));
}

// avr-libc: 4 cycles per iteration, count of 0 means 65536
static inline void _delay_loop_2(uint16_t count) {
    sim_burn_cycles(4UL * (count ? count : 65536));
}
