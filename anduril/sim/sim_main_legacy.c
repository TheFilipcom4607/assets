// sim_main_legacy.c: translation unit for Anduril 1 builds.
//
// Same idea as sim_main.c, but Anduril 1 has no arch/ layer, so the simulated
// peripherals are included alongside the firmware rather than inside it.
// SPDX-License-Identifier: GPL-3.0-or-later

#include "spaghetti-monster/anduril/anduril.c"

// the hardware the firmware was writing to all along
#include "sim/legacy.c"

// ---- freestanding runtime ----

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
    #endif
    // Anduril 1 counts voltage in tenths of a volt
    sim_io.fw_voltage_scale = 10;
    #ifdef USE_THERMAL_REGULATION
    sim_io.fw_temperature = (uint32_t)(int32_t)temperature;
    #endif

    sim_io.fw_channel_mode = 0;
    sim_io.fw_num_channel_modes = 1;
    sim_io.fw_go_to_standby = go_to_standby;
    sim_io.booted = 1;
}

// ---- capability report (same bit meanings as the current-release builds) ----

__attribute__((export_name("sim_capabilities")))
uint32_t sim_capabilities(void) {
    uint32_t c = 0;
    #ifdef USE_THERMAL_REGULATION
    c |= 1u << 0;
    #endif
    #ifdef USE_LVP
    c |= 1u << 1;
    #endif
    #if defined(USE_INDICATOR_LED) || defined(USE_BUTTON_LED)
    c |= 1u << 2;
    #endif
    #ifdef USE_AUX_RGB_LEDS
    c |= 1u << 3;
    #endif
    #ifdef USE_TINT_RAMPING
    c |= 1u << 4;
    #endif
    #ifdef USE_SIMPLE_UI
    c |= 1u << 5;
    #endif
    #ifdef USE_MOMENTARY_MODE
    c |= 1u << 6;
    #endif
    #ifdef USE_TACTICAL_MODE
    c |= 1u << 7;
    #endif
    #ifdef USE_MUGGLE_MODE
    c |= 1u << 8;
    #endif
    #ifdef USE_SOS_MODE
    c |= 1u << 10;
    #endif
    #ifdef USE_BEACON_MODE
    c |= 1u << 11;
    #endif
    #ifdef USE_STROBE_STATE
    c |= 1u << 12;
    #endif
    #ifdef USE_CANDLE_MODE
    c |= 1u << 13;
    #endif
    #ifdef USE_LIGHTNING_MODE
    c |= 1u << 14;
    #endif
    #ifdef USE_BIKE_FLASHER_MODE
    c |= 1u << 15;
    #endif
    #ifdef USE_PARTY_STROBE_MODE
    c |= 1u << 16;
    #endif
    #ifdef USE_BATTCHECK_MODE
    c |= 1u << 17;
    #endif
    #ifdef USE_LOCKOUT_MODE
    c |= 1u << 18;
    #endif
    #ifdef USE_MANUAL_MEMORY
    c |= 1u << 20;
    #endif
    return c;
}

// ---- ramp table readout, for the host's brightness model ----

__attribute__((export_name("sim_ramp_pwm")))
uint32_t sim_ramp_pwm(uint32_t channel, uint32_t level) {
    if (level > RAMP_SIZE) return 0;
    if (channel == 0) return pgm_read_byte(pwm1_levels + level);
    #if PWM_CHANNELS >= 2
    if (channel == 1) return pgm_read_byte(pwm2_levels + level);
    #endif
    return 0;
}

__attribute__((export_name("sim_ramp_top")))
uint32_t sim_ramp_top(uint32_t level) { (void)level; return 255; }

// ---- asyncify ----

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
