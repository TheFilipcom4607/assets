// sim_main.c: translation unit for the Anduril web simulator.
//
// Anduril is built as one big translation unit (it uses -fwhole-program to fit
// in a tiny MCU), so the whole firmware arrives via this one #include.  Nothing
// above this line patches it: the simulator swaps out the hardware underneath
// (arch/sim.c and hw/sim/) and leaves the firmware itself untouched.
// SPDX-License-Identifier: GPL-3.0-or-later

#include "ui/anduril/anduril.c"

#include "sim/simcore.h"

// arch/sim.c hardcodes the voltage unit, because in older source layouts it is
// compiled before fsm/adc.h is read; check the two still agree
#ifdef dV
#if (dV * 10) != SIM_VOLT_SCALE
#error "Anduril's voltage unit changed; pass the right -DSIM_VOLT_SCALE"
#endif
#endif

// ---- freestanding runtime ----
// clang emits calls to these for struct copies and array init; there's no libc
// in a wasm freestanding build, so provide them.

void *memcpy(void *dst, const void *src, unsigned long n) {
    unsigned char *d = dst; const unsigned char *s = src;
    while (n--) *d++ = *s++;
    return dst;
}

void *memset(void *dst, int c, unsigned long n) {
    unsigned char *d = dst;
    while (n--) *d++ = (unsigned char)c;
    return dst;
}

void *memmove(void *dst, const void *src, unsigned long n) {
    unsigned char *d = dst; const unsigned char *s = src;
    if (d < s) { while (n--) *d++ = *s++; }
    else { d += n; s += n; while (n--) *--d = *--s; }
    return dst;
}

// ---- state readout ----
// Copies the firmware's own variables into the shared struct so the host can
// draw the instrument panel.  Read-only: it never writes to firmware state.

void sim_sync_state(void) {
    sim_io.fw_actual_level = actual_level;
    sim_io.fw_ramp_size    = RAMP_SIZE;

    sim_io.fw_current_state = (uint32_t)(uintptr_t)current_state;
    uint8_t depth = state_stack_len;
    if (depth > 8) depth = 8;
    sim_io.fw_state_depth = depth;
    for (uint8_t i = 0; i < 8; i++)
        sim_io.fw_state_stack[i] = (i < depth)
                                 ? (uint32_t)(uintptr_t)state_stack[i] : 0;

    sim_io.fw_current_event = current_event;
    sim_io.fw_ticks_since_last_event = ticks_since_last_event;

    #ifdef USE_LVP
    sim_io.fw_voltage = voltage;
    sim_io.fw_voltage_scale = SIM_VOLT_SCALE;
    #endif
    #ifdef USE_THERMAL_REGULATION
    sim_io.fw_temperature = (uint32_t)(int32_t)temperature;
    #endif

    sim_io.fw_channel_mode = channel_mode;
    sim_io.fw_num_channel_modes = NUM_CHANNEL_MODES;
    sim_io.fw_go_to_standby = go_to_standby;
    sim_io.booted = 1;
}

// ---- capability report ----
// Which optional features this particular build actually contains, so the host
// panel can only offer what the firmware really has.

#define SIM_CAP_THERMAL   (1u << 0)
#define SIM_CAP_LVP       (1u << 1)
#define SIM_CAP_AUX1      (1u << 2)
#define SIM_CAP_AUXRGB    (1u << 3)
#define SIM_CAP_TINT      (1u << 4)
#define SIM_CAP_SIMPLE_UI (1u << 5)
#define SIM_CAP_MOMENTARY (1u << 6)
#define SIM_CAP_TACTICAL  (1u << 7)
#define SIM_CAP_MUGGLE    (1u << 8)
#define SIM_CAP_SMOOTH_ST (1u << 9)
#define SIM_CAP_SOS       (1u << 10)
#define SIM_CAP_BEACON    (1u << 11)
#define SIM_CAP_STROBE    (1u << 12)
#define SIM_CAP_CANDLE    (1u << 13)
#define SIM_CAP_LIGHTNING (1u << 14)
#define SIM_CAP_BIKE      (1u << 15)
#define SIM_CAP_PARTY     (1u << 16)
#define SIM_CAP_BATTCHECK (1u << 17)
#define SIM_CAP_LOCKOUT   (1u << 18)
#define SIM_CAP_SUNSET    (1u << 19)
#define SIM_CAP_MANUAL_MEM (1u << 20)

__attribute__((export_name("sim_capabilities")))
uint32_t sim_capabilities(void) {
    uint32_t c = 0;
    #ifdef USE_THERMAL_REGULATION
    c |= SIM_CAP_THERMAL;
    #endif
    #ifdef USE_LVP
    c |= SIM_CAP_LVP;
    #endif
    #ifdef USE_AUX1_LED
    c |= SIM_CAP_AUX1;
    #endif
    #ifdef USE_AUXRGB_LEDS
    c |= SIM_CAP_AUXRGB;
    #endif
    #ifdef USE_TINT_RAMPING
    c |= SIM_CAP_TINT;
    #endif
    #ifdef USE_SIMPLE_UI
    c |= SIM_CAP_SIMPLE_UI;
    #endif
    #ifdef USE_MOMENTARY_MODE
    c |= SIM_CAP_MOMENTARY;
    #endif
    #ifdef USE_TACTICAL_MODE
    c |= SIM_CAP_TACTICAL;
    #endif
    #ifdef USE_MUGGLE_MODE
    c |= SIM_CAP_MUGGLE;
    #endif
    #ifdef USE_SMOOTH_STEPS
    c |= SIM_CAP_SMOOTH_ST;
    #endif
    #ifdef USE_SOS_MODE
    c |= SIM_CAP_SOS;
    #endif
    #ifdef USE_BEACON_MODE
    c |= SIM_CAP_BEACON;
    #endif
    #ifdef USE_STROBE_STATE
    c |= SIM_CAP_STROBE;
    #endif
    #ifdef USE_CANDLE_MODE
    c |= SIM_CAP_CANDLE;
    #endif
    #ifdef USE_LIGHTNING_MODE
    c |= SIM_CAP_LIGHTNING;
    #endif
    #ifdef USE_BIKE_FLASHER_MODE
    c |= SIM_CAP_BIKE;
    #endif
    #ifdef USE_PARTY_STROBE_MODE
    c |= SIM_CAP_PARTY;
    #endif
    #ifdef USE_BATTCHECK_MODE
    c |= SIM_CAP_BATTCHECK;
    #endif
    #ifdef USE_LOCKOUT_MODE
    c |= SIM_CAP_LOCKOUT;
    #endif
    #ifdef USE_SUNSET_TIMER
    c |= SIM_CAP_SUNSET;
    #endif
    #ifdef USE_MANUAL_MEMORY
    c |= SIM_CAP_MANUAL_MEM;
    #endif
    return c;
}

// ---- ramp table readout, for the host's brightness model ----

__attribute__((export_name("sim_ramp_pwm")))
uint32_t sim_ramp_pwm(uint32_t channel, uint32_t level) {
    if (level > RAMP_SIZE) return 0;
    if (channel == 0) return PWM_GET(pwm1_levels, level);
    if (channel == 1) return PWM_GET(pwm2_levels, level);
    return 0;
}

__attribute__((export_name("sim_ramp_top")))
uint32_t sim_ramp_top(uint32_t level) {
    if (level > RAMP_SIZE) return 0;
    return PWM_GET16(pwm_tops, level);
}

// ---- asyncify ----
// Binaryen's asyncify transform unwinds the wasm stack into this buffer when
// the firmware waits, and rewinds out of it on the next animation frame.

static uint8_t sim_asyncify_stack[8192];

__attribute__((export_name("sim_asyncify_stack_ptr")))
uint32_t sim_asyncify_stack_ptr(void) { return (uint32_t)(uintptr_t)sim_asyncify_stack; }

__attribute__((export_name("sim_asyncify_stack_size")))
uint32_t sim_asyncify_stack_size(void) { return sizeof(sim_asyncify_stack); }

// ---- entry point ----

__attribute__((export_name("sim_main")))
void sim_main(void) {
    main();
}
