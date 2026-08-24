// anduril.h: build configuration for the simulated light.
// Part of the Anduril web simulator.  Not part of upstream Anduril.
//
// A generic FET+1 e-switch light on an attiny1616-class MCU.  The ramp tables
// below are the ones Anduril ships for the Wurkkos TS10, which is a typical
// example of this driver layout, so the ramp shape and the thermal behaviour
// match a light that really exists.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#define HWDEF_H  sim/hwdef.h
#include "sim/hwdef.h"

// ---- optional hardware, chosen by the build script ----
#ifndef SIM_THERM
#define SIM_THERM 1
#endif
#if !SIM_THERM
    // no temperature sensor fitted: thermal regulation, the thermal config
    // menu and temp-check mode all disappear, exactly as on real hardware
    #ifdef USE_THERMAL_REGULATION
    #undef USE_THERMAL_REGULATION
    #endif
#endif

// allow Aux Config and Strobe Modes in Simple UI
#define USE_EXTENDED_SIMPLE_UI
// allow 3C in Simple UI for switching between smooth and stepped ramping
#define USE_SIMPLE_UI_RAMPING_TOGGLE
// 2 clicks goes to turbo (Anduril 1 style)
#define DEFAULT_2C_STYLE 1
// SOS, in the blinkies group
#define USE_SOS_MODE
#define USE_SOS_MODE_IN_BLINKY_GROUP
// factory reset on 13H, without loosening the tailcap
#define USE_SOFT_FACTORY_RESET

// Gradual level changes.  Anduril only enables this alongside thermal
// regulation, but the aux channel-mode tables reference it unconditionally, so
// define it here to keep every hardware combination buildable.  With no
// temperature sensor nothing ever calls it.
#define USE_SET_LEVEL_GRADUALLY

#define RAMP_SIZE 150

#define PWM1_LEVELS     1,   1,   2,   2,   3,   3,   4,   5,   6,   6,   8,   9,   9,  10,  10,  11,  12,  13,  14,  15,  16,  17,  18,  19,  19,  20,  21,  22,  23, 23, 24, 25, 26, 26, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32, 33, 33, 34, 35, 36, 37, 38, 40, 41, 43, 45, 47, 50, 53, 56, 60, 63, 67, 71, 75, 79, 84, 89, 94, 99,104,110,116,122,129,136,143,150,158,166,174,183,192,202,211,222,232,243,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,0
#define PWM2_LEVELS     0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  2,  3,  5,  7,  8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 29, 31, 34, 37, 39, 42, 45, 48, 51, 54, 58, 61, 65, 68, 72, 76, 80, 84, 88, 93, 97,102,107,112,117,122,127,133,139,145,151,157,163,170,177,183,191,198,205,213,221,229,238,246,255
#define PWM_TOPS     4095,2893,3917,2806,3252,2703,2684,2660,2640,2370,3000,2900,2630,2549,2246,2193,2030,1961,1889,1716,1642,1569,1497,1428,1290,1232,1176,1122,1070,976,932,890,849,779,745,685,656,605,579,536,514,476,457,424,407,379,364,340,327,314,302,291,280,276,266,262,257,253,253,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255
#define MAX_1x7135          90
#define MIN_THERM_STEPDOWN  60
#define HALFSPEED_LEVEL     11
#define QUARTERSPEED_LEVEL  5
#define DEFAULT_LEVEL       50

#define RAMP_SMOOTH_FLOOR    1
#define RAMP_SMOOTH_CEIL     130
// 10 30 50 70 [90] 110 130
#define RAMP_DISCRETE_FLOOR  10
#define RAMP_DISCRETE_CEIL   130
#define RAMP_DISCRETE_STEPS  7

#define SIMPLE_UI_FLOOR  10
#define SIMPLE_UI_CEIL   130
#define SIMPLE_UI_STEPS  7

// throttle back faster when high
#define THERM_FASTER_LEVEL 130

// ---- aux LED behaviour ----
#define USE_AUX_THRESHOLD_CONFIG
#define DEFAULT_AUX_WHILE_ON  0b00  // off unless the user enables it
// show each channel as it scrolls by in the menu
#define USE_CONFIG_COLORS

// smoother candle mode
#define CANDLE_AMPLITUDE 33

// don't blink mid-ramp
#ifdef BLINK_AT_RAMP_MIDDLE
#undef BLINK_AT_RAMP_MIDDLE
#endif
