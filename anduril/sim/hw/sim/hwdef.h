// hwdef.h: driver layout for the simulated light.
// Part of the Anduril web simulator.  Not part of upstream Anduril.
//
// This is a real Anduril hardware definition, the same kind every physical
// light has -- it just describes a light that exists in a browser instead of
// in aluminium.  The layout is a common one: an FET+1 driver with two PWM
// channels, an e-switch, and up to two groups of aux LEDs.
//
// Which parts exist is chosen at build time by the simulator's build script,
// exactly like the differences between two real models.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#define HWDEF_C  sim/hwdef.c

// ---- which hardware is fitted (set by the build script) ----
#ifndef SIM_AUX1
#define SIM_AUX1 0            // a single-color LED group
#endif
#ifndef SIM_AUXRGB
#define SIM_AUXRGB 0          // an RGB LED group
#endif
#ifndef SIM_AUX1_BUTTON
#define SIM_AUX1_BUTTON 0     // the single-color group sits in the button
#endif
#ifndef SIM_AUXRGB_BUTTON
#define SIM_AUXRGB_BUTTON 0   // the RGB group sits in the button
#endif

// Anduril moved its aux LED drivers from fsm/misc.c into the arch layer, and
// renamed the feature flags along the way.  SIM_LED_API says which vocabulary
// the selected version speaks; the build script works it out from the sources.
#ifndef SIM_LED_API
#define SIM_LED_API 1
#endif
#define SIM_LED_VIA_PORTS  (! SIM_LED_API)

#if SIM_LED_API   // r2026 and later: the arch drives the LEDs

    #if SIM_AUX1
    #define USE_AUX1_LED
    #endif
    #if SIM_AUXRGB
    #define USE_AUXRGB_LEDS
    #endif

#else             // older releases: the firmware pokes port registers itself

    #if SIM_AUX1
        #if SIM_AUX1_BUTTON
            #define USE_BUTTON_LED
            #define BUTTON_LED_PIN   SIM_LED_1_PIN
            #define BUTTON_LED_PORT  SIM_LED_1_PORT
        #else
            #define USE_INDICATOR_LED
            #define AUXLED_PIN       SIM_LED_1_PIN
            #define AUXLED_PORT      SIM_LED_1_PORT
        #endif
    #endif
    #if SIM_AUXRGB
        #define USE_AUX_RGB_LEDS
        #define AUXLED_R_PIN     SIM_LED_R_PIN
        #define AUXLED_G_PIN     SIM_LED_G_PIN
        #define AUXLED_B_PIN     SIM_LED_B_PIN
        #define AUXLED_RGB_PORT  SIM_LED_R_PORT
    #endif

#endif

// Aux LEDs which face forward can also be used as light channels; ones inside
// the button cannot, same as on real hardware.
#if SIM_AUXRGB && !SIM_AUXRGB_BUTTON
    #define SIM_AUX_CHANNELS_RGB 1
    #include "fsm/chan-rgbaux.h"
#elif SIM_AUX1 && !SIM_AUX1_BUTTON
    #define SIM_AUX_CHANNELS_1 1
    #include "fsm/chan-aux.h"
#endif

#ifdef SIM_AUX_CHANNELS_RGB
    // the RGB channel-mode macros were renamed between releases
    #ifdef NUM_AUXRGB_CHANNEL_MODES
    #define NUM_CHANNEL_MODES  (1 + NUM_AUXRGB_CHANNEL_MODES)
    enum channel_modes_e {
        CM_MAIN = 0,
        AUXRGB_CM_ENUMS
    };
    #else
    #define NUM_CHANNEL_MODES  (1 + NUM_RGB_AUX_CHANNEL_MODES)
    enum channel_modes_e {
        CM_MAIN = 0,
        RGB_AUX_ENUMS
    };
    #endif
    #define CHANNEL_MODES_ENABLED  0b0000000000000001
#elif defined(SIM_AUX_CHANNELS_1)
    #define NUM_CHANNEL_MODES  2
    enum channel_modes_e {
        CM_MAIN = 0,
        CM_AUX
    };
    #define CHANNEL_MODES_ENABLED  0b00000001
#else
    #define NUM_CHANNEL_MODES  1
    enum channel_modes_e {
        CM_MAIN = 0
    };
    #define CHANNEL_MODES_ENABLED  0b00000001
#endif

#define DEFAULT_CHANNEL_MODE  CM_MAIN


// ---- PWM ----
// Dynamic (variable-TOP) PWM on two stacked channels, like most modern
// FET+1 drivers built around the attiny1616.

#define PWM_CHANNELS  2

#define PWM_BITS      16
#define PWM_GET       PWM_GET8
#define PWM_DATATYPE  uint16_t
#define PWM_DATATYPE2 uint16_t
#define PWM1_DATATYPE uint8_t   // 7135 ramp
#define PWM2_DATATYPE uint8_t   // DD FET ramp

// "registers": the host reads these to work out how bright the light is
extern uint16_t sim_pwm_cnt;
#define PWM_TOP       sim_io.pwm_top
#define PWM_TOP_INIT  255
#define PWM_CNT       sim_pwm_cnt

#define CH1_PWM       sim_io.pwm[0]   // 7135 (regulated) channel
#define CH2_PWM       sim_io.pwm[1]   // direct-drive FET channel

// ---- e-switch ----
#define SWITCH_PIN   0
#define SWITCH_PORT  sim_switch_port()
#define SWITCH_VECT  sim_pcint_isr

// average drop across the reverse-polarity protection
#ifndef VOLTAGE_FUDGE_FACTOR
#define VOLTAGE_FUDGE_FACTOR 5  // add 0.20V
#endif


inline void hwdef_setup() {
    sim_io.pwm_channels = PWM_CHANNELS;
    sim_io.has_aux1     = SIM_AUX1;
    sim_io.has_auxrgb   = SIM_AUXRGB;
    sim_io.aux1_is_button   = SIM_AUX1_BUTTON;
    sim_io.auxrgb_is_button = SIM_AUXRGB_BUTTON;
    PWM_TOP = PWM_TOP_INIT;
}

#define LAYOUT_DEFINED
