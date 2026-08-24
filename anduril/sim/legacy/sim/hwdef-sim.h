// hwdef-sim.h: driver layout for the simulated light, Anduril 1 edition.
// Part of the Anduril web simulator.  Not part of upstream Anduril.
//
// The same imaginary FET+1 e-switch light as the current-release builds, but
// described the way Anduril 1 expects: an attiny1634 with the aux LEDs hung
// off real port pins.
// SPDX-License-Identifier: GPL-3.0-or-later
#ifndef HWDEF_SIM_H
#define HWDEF_SIM_H

#ifdef ATTINY
#undef ATTINY
#endif
#define ATTINY 1634
#include <avr/io.h>

// ---- which hardware is fitted (set by the build script) ----
#ifndef SIM_AUX1
#define SIM_AUX1 0
#endif
#ifndef SIM_AUXRGB
#define SIM_AUXRGB 0
#endif
#ifndef SIM_AUX1_BUTTON
#define SIM_AUX1_BUTTON 0
#endif
#ifndef SIM_AUXRGB_BUTTON
#define SIM_AUXRGB_BUTTON 0
#endif

#define PWM_CHANNELS 2

// e-switch
#define SWITCH_PIN   PA2
#define SWITCH_PCINT PCINT2
#define SWITCH_PCIE  PCIE0
#define SWITCH_PCMSK PCMSK0
#define SWITCH_PORT  sim_switch_port()

// the two power channels; the host reads these to work out the brightness
#define PWM1_PIN PB3            // 1x7135
#define PWM1_LVL sim_io.pwm[0]
#define PWM2_PIN PA6            // direct-drive FET
#define PWM2_LVL sim_io.pwm[1]

#define ADC_PRSCL   0x07        // clk/128
#define TEMP_CHANNEL 0b00001111

#ifndef VOLTAGE_FUDGE_FACTOR
#define VOLTAGE_FUDGE_FACTOR 5  // add 0.25V
#endif

// ---- aux LEDs ----
// A single-colour group is either the indicator (which this era drives from
// port B) or the button LED (port A).  An RGB group always lives on port A.
#if SIM_AUX1
  #if SIM_AUX1_BUTTON
    #define USE_BUTTON_LED
    #define BUTTON_LED_PIN  PA1
    #define BUTTON_LED_PORT PORTA
    #define BUTTON_LED_DDR  DDRA
    #define BUTTON_LED_PUE  PUEA
  #else
    #define USE_INDICATOR_LED
    #define AUXLED_PIN      PB2
  #endif
#endif

#if SIM_AUXRGB
  #define USE_AUX_RGB_LEDS
  #define AUXLED_R_PIN    PA5
  #define AUXLED_G_PIN    PA4
  #define AUXLED_B_PIN    PA3
  #define AUXLED_RGB_PORT PORTA
  #define AUXLED_RGB_DDR  DDRA
  #define AUXLED_RGB_PUE  PUEA
#endif


inline void hwdef_setup() {
    sim_io.pwm_channels     = PWM_CHANNELS;
    sim_io.pwm_top          = 255;   // plain 8-bit PWM in this era
    sim_io.has_aux1         = SIM_AUX1;
    sim_io.has_auxrgb       = SIM_AUXRGB;
    sim_io.aux1_is_button   = SIM_AUX1_BUTTON;
    sim_io.auxrgb_is_button = SIM_AUXRGB_BUTTON;

    // enable output pins
    DDRB = (1 << PWM1_PIN);
    DDRA = (1 << PWM2_PIN)
      #if SIM_AUXRGB
         | (1 << AUXLED_R_PIN) | (1 << AUXLED_G_PIN) | (1 << AUXLED_B_PIN)
      #endif
      #ifdef USE_BUTTON_LED
         | (1 << BUTTON_LED_PIN)
      #endif
         ;

    // pull-up on the e-switch, and let it raise a pin change interrupt
    PUEA = (1 << SWITCH_PIN);
    SWITCH_PCMSK = (1 << SWITCH_PCINT);
}

#define LAYOUT_DEFINED
#endif
