// util/delay.h: avr-libc delay shim (Anduril normally uses its own, from
// arch/delay.h, but a few builds fall back to this one).
#pragma once

#include <util/delay_basic.h>
#include "sim/simcore.h"

static inline void _delay_us(double us) {
    sim_burn_cycles((uint32_t)(us * (double)F_CPU / 1000000.0));
}

static inline void _delay_ms(double ms) {
    sim_burn_cycles((uint32_t)(ms * (double)F_CPU / 1000.0));
}
