// hwdef.c: PWM helpers for the simulated light.
// Part of the Anduril web simulator.  Not part of upstream Anduril.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

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


Channel channels[] = {
    {  // main LEDs
        .set_level    = set_level_main
        #ifdef USE_SET_LEVEL_GRADUALLY
        , .gradual_tick = gradual_tick_main
        #endif
    }
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


void set_level_zero() {
    CH1_PWM = 0;
    CH2_PWM = 0;
    PWM_CNT = 0;  // reset phase
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
