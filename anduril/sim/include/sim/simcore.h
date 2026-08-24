// simcore.h: shared state between the simulated MCU and the JS host.
// Part of the Anduril web simulator.  Not part of upstream Anduril.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <stdint.h>

// Every field is uint32_t so the struct layout is identical on wasm32 and on
// the host compiler used by tools/gen-layout.c, which emits the JS offsets.
typedef struct SimIO {
    uint32_t magic;             // 0x414e4453 "ANDS"

    // --- virtual clock ---
    uint32_t cycles_lo;         // virtual CPU cycles since boot (64-bit split)
    uint32_t cycles_hi;
    uint32_t f_cpu;

    // --- light output (written by the hwdef's PWM "registers") ---
    uint32_t pwm[4];            // raw compare values, per channel
    uint32_t pwm_top;           // PWM period (TOP), for dynamic PWM
    uint32_t pwm_channels;      // how many of pwm[] this build actually uses

    // --- aux LEDs ---
    uint32_t aux1;              // 0/1/2 = off/low/high
    uint32_t auxrgb;            // 0b00BBGGRR, each 0/1/2 = off/low/high
    uint32_t has_aux1;
    uint32_t has_auxrgb;
    uint32_t aux1_is_button;    // 1 if AUX1 is wired to the button LED
    uint32_t auxrgb_is_button;  // 1 if the RGB group is wired to the button

    // --- MCU status ---
    uint32_t sleeping;          // currently in sleep_cpu()
    uint32_t sleep_mode;        // 0=idle, 2=standby, 4=power-down
    uint32_t adc_on;            // ADC peripheral enabled
    uint32_t adc_channel_hw;    // 0 = voltage, 1 = temperature
    uint32_t irq_enabled;       // sei/cli
    uint32_t wdt_period_ms;     // 0 = WDT off

    // --- environment (written by the JS host, read by the fake ADC) ---
    uint32_t env_millivolts;    // battery voltage at the MCU pin, mV
    uint32_t env_decikelvin;    // die temperature the sensor reports, K*10
    uint32_t button_down;       // 1 while the e-switch is held

    // --- firmware state, copied out for the instrument panel ---
    uint32_t fw_actual_level;
    uint32_t fw_ramp_size;
    uint32_t fw_current_state;  // function pointer (table index)
    uint32_t fw_state_depth;
    uint32_t fw_state_stack[8];
    uint32_t fw_current_event;
    uint32_t fw_ticks_since_last_event;
    uint32_t fw_voltage;        // firmware's own reading, in fw_voltage_scale units per volt
    uint32_t fw_voltage_scale;  // 50 on current releases, 40 before r2024
    uint32_t fw_temperature;    // firmware's own reading, degrees C
    uint32_t fw_channel_mode;
    uint32_t fw_num_channel_modes;
    uint32_t fw_go_to_standby;

    // --- counters, so the host can tell things apart ---
    uint32_t n_ticks;           // WDT ticks since boot
    uint32_t n_reboots;
    uint32_t eeprom_writes;
    uint32_t eeprom_dirty;      // host should persist; host clears

    // --- host control ---
    uint32_t budget_cycles;     // virtual cycles the host has granted
    uint32_t reboot_requested;  // firmware called reboot(); host must reinstantiate
    uint32_t booted;            // main() reached its loop at least once
} SimIO;

#define SIM_MAGIC 0x414e4453

extern SimIO sim_io;
