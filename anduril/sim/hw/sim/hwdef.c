// hwdef.c: PWM helpers for the simulated light.
// Part of the Anduril web simulator.  Not part of upstream Anduril.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#if defined(SIM_AUX_CHANNELS_RGB) && SIM_RGB_PWM
#include "anduril/channel-modes.h"  // for circular_tint_3h()
#endif
#ifdef SIM_AUX_CHANNELS_RGB
#include "fsm/chan-rgbaux.c"
#elif defined(SIM_AUX_CHANNELS_1)
#include "fsm/chan-aux.c"
#endif

// stands in for the PWM counter register; writing 0 resets the phase
uint16_t sim_pwm_cnt = 0;

void set_level_zero();
void set_level_main(uint8_t level);
#ifdef USE_SET_LEVEL_GRADUALLY
bool gradual_tick_main(uint8_t gt);
#endif


#if SIM_RGB_PWM
void enable_auxrgb_pwm();
void disable_auxrgb_pwm();
rgb_uint_t get_level_auxrgb(uint8_t level);
void set_auxrgb_pwm(RGB8_t color);
#ifdef SIM_AUX_CHANNELS_RGB
void set_level_hsv(uint8_t level);
bool gradual_tick_hsv(uint8_t gt);
#endif
#endif


Channel channels[] = {
    {  // main LEDs
        .set_level    = set_level_main
        #ifdef USE_SET_LEVEL_GRADUALLY
        , .gradual_tick = gradual_tick_main
        #endif
        #if SIM_RGB_PWM && defined(SIM_AUX_CHANNELS_RGB)
        , .flags        = 0
        #endif
    }
    #if SIM_RGB_PWM && defined(SIM_AUX_CHANNELS_RGB)
    , {  // aux RGB LEDs, any colour
        .set_level    = set_level_hsv,
        .gradual_tick = gradual_tick_hsv,
        .flags        = CHANNEL_FLAG_IS_AUX | CHANNEL_FLAG_HAS_ARGS
    }
    #endif
    #ifdef SIM_AUX_CHANNELS_RGB
        #ifdef AUXRGB_CHANNELS
        , AUXRGB_CHANNELS
        #else
        , RGB_AUX_CHANNELS
        #endif
    #elif defined(SIM_AUX_CHANNELS_1)
    , AUX_CHANNELS
    #endif
};


#if SIM_RGB_PWM && defined(SIM_AUX_CHANNELS_RGB)
// HSV mode needs a different 3H handler
StatePtr channel_3H_modes[NUM_CHANNEL_MODES] = {
    NULL, circular_tint_3h,
};
#endif

void set_level_zero() {
    CH1_PWM = 0;
    CH2_PWM = 0;
    PWM_CNT = 0;  // reset phase
    #if SIM_RGB_PWM
    // turn off PWM for aux RGB
    disable_auxrgb_pwm();
    #endif
}

// one set of LEDs with two stacked power channels: 7135 + DD FET
void set_level_main(uint8_t level) {
    PWM_DATATYPE ch1_pwm = PWM_GET(pwm1_levels, level);
    PWM_DATATYPE ch2_pwm = PWM_GET(pwm2_levels, level);
    // pulse frequency modulation, a.k.a. dynamic PWM
    uint16_t top = PWM_GET16(pwm_tops, level);

    CH1_PWM = ch1_pwm;
    CH2_PWM = ch2_pwm;
    PWM_TOP = top;
    if (! actual_level) PWM_CNT = 0;  // reset phase when turning on from zero
}

#ifdef USE_SET_LEVEL_GRADUALLY
bool gradual_tick_main(uint8_t gt) {
    PWM_DATATYPE pwm1 = PWM_GET(pwm1_levels, gt);
    PWM_DATATYPE pwm2 = PWM_GET(pwm2_levels, gt);

    GRADUAL_ADJUST_STACKED(pwm1, CH1_PWM, PWM_TOP_INIT);
    GRADUAL_ADJUST_SIMPLE (pwm2, CH2_PWM);

    if (   (pwm1 == CH1_PWM)
        && (pwm2 == CH2_PWM)
       ) {
        return true;  // done
    }
    return false;  // not done yet
}
#endif


///// RGB aux PWM stuff
// The same shape as hw/hank/lume-x1/hwdef.c, with the timer replaced by three
// compare values the host can read.
#if SIM_RGB_PWM

void enable_auxrgb_pwm() {
    set_auxrgb_power(0);
    sim_io.rgb_pwm_on = 1;
}

void disable_auxrgb_pwm() {
    sim_io.rgb_pwm_on = 0;
    CH_R_PWM = 0;
    CH_G_PWM = 0;
    CH_B_PWM = 0;
    set_auxrgb_power(0);
}

rgb_uint_t get_level_auxrgb(uint8_t level) {
    // convert ramp level to raw PWM value
    if (level) level = PWM3_GET(level - 1);
    return level;
}

void set_auxrgb_pwm(RGB8_t color) {
    if (! sim_io.rgb_pwm_on) { enable_auxrgb_pwm(); }
    CH_R_PWM = color.r;
    CH_G_PWM = color.g;
    CH_B_PWM = color.b;
}

#ifdef SIM_AUX_CHANNELS_RGB
bool gradual_adjust_rgb(PWM3_DATATYPE r, PWM3_DATATYPE g, PWM3_DATATYPE b) {
    GRADUAL_ADJUST_SIMPLE(r, CH_R_PWM);
    GRADUAL_ADJUST_SIMPLE(g, CH_G_PWM);
    GRADUAL_ADJUST_SIMPLE(b, CH_B_PWM);

    if ((r == CH_R_PWM)
     && (g == CH_G_PWM)
     && (b == CH_B_PWM)) {
        return true;  // done
    }
    return false;  // not done yet
}

void set_level_hsv(uint8_t level) {
    RGB_t color;
    uint8_t h = cfg.channel_mode_args[channel_mode];
    uint8_t s = 255;
    PWM3_DATATYPE v = PWM3_GET(level);
    color = hsv2rgb(h, s, v);

    set_auxrgb_pwm(color);
}

bool gradual_tick_hsv(uint8_t gt) {
    // figure out what exact PWM levels we're aiming for
    RGB_t color;
    uint8_t h = cfg.channel_mode_args[channel_mode];
    uint8_t s = 255;
    PWM3_DATATYPE v = PWM3_GET(gt);
    color = hsv2rgb(h, s, v);

    return gradual_adjust_rgb(color.r, color.g, color.b);
}
#endif  // SIM_AUX_CHANNELS_RGB

#endif  // SIM_RGB_PWM
