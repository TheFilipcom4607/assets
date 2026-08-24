// sim/legacy.c: the peripherals Anduril 1 drives directly.
//
// Anduril 1 writes ADC, watchdog, pin-change and port registers itself, so
// instead of implementing an interface for it, this file watches those
// registers and behaves the way the silicon would: it starts and stops the
// ADC, sets the watchdog's tick rate, arms the pin-change interrupt, and reads
// each aux LED's brightness back off its pin.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include "sim/legacy.h"

// F_CPU comes from the firmware's own tk-attiny.h (8 MHz on these parts).
// The ADC runs at F_CPU/128 and takes 13 clocks per conversion.
#define SIM_F_CPU   F_CPU
#define SIM_ADC_HZ  (F_CPU / 128 / 13)

#include "sim/core.c"

volatile uint8_t  sim_ADMUX, sim_ADCSRA, sim_ADCSRB, sim_DIDR0, sim_DIDR1;
volatile uint16_t sim_ADCW;
volatile uint8_t  sim_GIMSK, sim_PCMSK, sim_PCMSK0, sim_PCMSK1, sim_PCMSK2;
volatile uint8_t  sim_WDTCR, sim_WDTCSR, sim_MCUSR, sim_MCUCR, sim_CLKPR, sim_CCP;
volatile uint8_t  sim_PORTA, sim_DDRA, sim_PUEA;
volatile uint8_t  sim_PORTB, sim_DDRB, sim_PUEB;
volatile uint8_t  sim_PORTC, sim_DDRC, sim_PUEC;
volatile uint8_t  sim_TCCR0A, sim_TCCR0B, sim_TCCR1, sim_GTCCR, sim_TIMSK, sim_TIFR;
volatile uint8_t  sim_OCR0A, sim_OCR0B, sim_OCR1A, sim_OCR1B, sim_OCR1C, sim_ACSR, sim_PRR;

// An LED pin resolves to off / dim / full the same way it does on the chip:
// driven low or high, or left as an input where the pull-up lights it faintly.
static uint8_t sim_pin_state(uint8_t ddr, uint8_t pue, uint8_t port, uint8_t pin) {
    uint8_t bit = (uint8_t)(1 << pin);
    if (ddr & bit) return (port & bit) ? 2 : 0;
    return (pue & bit) ? 1 : 0;
}

void sim_hw_poll(void) {
    // ---- ADC ----
    // free-running once enabled, with the interrupt armed per measurement
    uint8_t adc_on = (sim_ADCSRA & (1 << ADEN)) ? 1 : 0;
    uint8_t adc_go = adc_on && (sim_ADCSRA & (1 << ADIE));
    if (adc_go && (! sim_adc_running)) {
        sim_adc_running = 1;
        sim_adc_next = sim_now + SIM_ADC_PERIOD_CYCLES;
    } else if (! adc_go) {
        sim_adc_running = 0;
    }
    sim_io.adc_on = adc_on;

    // ---- watchdog, which is the clock tick in this era ----
    uint8_t wdt = (uint8_t)(sim_WDTCR | sim_WDTCSR);
    if (wdt & (1 << WDIE)) {
        uint8_t wdp = (uint8_t)((wdt & 0x07) | ((wdt & (1 << WDP3)) ? 8 : 0));
        uint32_t ms = 16u << wdp;
        uint32_t period = (uint32_t)(SIM_F_CPU / 1000) * ms;
        if (period != sim_wdt_period) {
            sim_wdt_period = period;
            sim_wdt_next = sim_now + period;
        }
        sim_io.wdt_period_ms = ms;
    } else {
        sim_wdt_period = 0;
        sim_io.wdt_period_ms = 0;
    }

    // ---- pin change interrupt on the e-switch ----
    sim_pcint_armed = sim_GIMSK ? 1 : 0;

    // ---- aux LEDs, read back off their pins ----
    #ifdef USE_INDICATOR_LED
    // this era drives the indicator straight from port B, with no PUE register
    sim_io.aux1 = sim_pin_state(sim_DDRB, sim_PORTB, sim_PORTB, AUXLED_PIN);
    #endif
    #ifdef USE_BUTTON_LED
    sim_io.aux1 = sim_pin_state(BUTTON_LED_DDR, BUTTON_LED_PUE,
                                BUTTON_LED_PORT, BUTTON_LED_PIN);
    #endif
    #ifdef USE_AUX_RGB_LEDS
    sim_io.auxrgb = (uint8_t)(
          sim_pin_state(AUXLED_RGB_DDR, AUXLED_RGB_PUE, AUXLED_RGB_PORT, AUXLED_R_PIN)
        | (sim_pin_state(AUXLED_RGB_DDR, AUXLED_RGB_PUE, AUXLED_RGB_PORT, AUXLED_G_PIN) << 2)
        | (sim_pin_state(AUXLED_RGB_DDR, AUXLED_RGB_PUE, AUXLED_RGB_PORT, AUXLED_B_PIN) << 4));
    #endif
}

// Fill the ADC result register the way a finished conversion would.
void sim_adc_deliver(void) {
    // the thermal channel is the one that switches the reference to 1.1V
    uint8_t therm = (sim_ADMUX & (1 << REFS1)) ? 1 : 0;
    uint16_t raw;  // 10-bit, right aligned

    if (therm) {
        // this sensor reads about one ADC step per Kelvin, and the firmware
        // treats 0 C as 275 K, so the step count is (Celsius + 275)
        raw = (uint16_t)(sim_io.env_decikelvin / 10);
    } else {
        // measuring the 1.1V bandgap against Vcc: 1024 * 1.1 / Vbat
        uint32_t mv = sim_io.env_millivolts;
        if (mv < 1500) mv = 1500;
        raw = (uint16_t)(1126400UL / mv);
    }
    if (raw > 1023) raw = 1023;
    sim_io.adc_channel_hw = therm;

    // left-aligned on the tiny25/45/85 (the flag lives in ADMUX) and on the
    // 1634 (same bit, but in ADCSRB); either way the firmware shifts it back
    uint8_t left = (sim_ADMUX & (1 << ADLAR)) || (sim_ADCSRB & (1 << ADLAR));
    sim_ADCW = left ? (uint16_t)(raw << 6) : raw;

    // a little noise in the low bits, which is where Anduril gets its entropy
    sim_noise = (uint16_t)((sim_noise >> 1) ^ (uint16_t)(-(sim_noise & 1u) & 0xB400u));
    if (left) sim_ADCW |= (sim_noise & 0x0003);
}
