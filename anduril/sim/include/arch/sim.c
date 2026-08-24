// arch/sim.c: virtual MCU for current Anduril releases.
//
// Implements the same interface as arch/attiny1616.c, backed by the shared
// simulator core.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include "arch/sim.h"

// this MCU's ADC finishes a 12-bit conversion with 4x accumulate about
// every 83 us
#define SIM_F_CPU   F_CPU
#define SIM_ADC_HZ  12000

#include "sim/core.c"

SimPort sim_porta;
SimPort sim_portb;

// Apply the pending set/clear register writes, then read each LED's pin back.
static void sim_port_apply(SimPort *p) {
    p->DIR |= p->DIRSET;  p->DIR &= (uint8_t)~p->DIRCLR;
    p->OUT |= p->OUTSET;  p->OUT &= (uint8_t)~p->OUTCLR;
    p->DIRSET = 0; p->DIRCLR = 0; p->OUTSET = 0; p->OUTCLR = 0;
}

static uint8_t sim_pin_level(SimPort *p, uint8_t pin) {
    uint8_t bit = (uint8_t)(1 << pin);
    if (p->DIR & bit) return (p->OUT & bit) ? 2 : 0;   // driven high or low
    // input: the internal pull-up lights the LED dimly, which is how Anduril
    // gets a "low" brightness out of a pin with no PWM on it
    return ((&p->PIN0CTRL)[pin] & PORT_PULLUPEN_bm) ? 1 : 0;
}

void sim_ports_update(void) {
    sim_port_apply(&sim_porta);
    sim_port_apply(&sim_portb);
    #if SIM_LED_VIA_PORTS
        #if SIM_AUX1
        sim_io.aux1 = sim_pin_level(&SIM_LED_1_PORT, SIM_LED_1_PIN);
        #endif
        #if SIM_AUXRGB
        sim_io.auxrgb = (uint8_t)( sim_pin_level(&SIM_LED_R_PORT, SIM_LED_R_PIN)
                       | (sim_pin_level(&SIM_LED_G_PORT, SIM_LED_G_PIN) << 2)
                       | (sim_pin_level(&SIM_LED_B_PORT, SIM_LED_B_PIN) << 4));
        #endif
    #endif
}

// the core's hooks
void sim_hw_poll(void) { sim_ports_update(); }
void sim_adc_deliver(void) { }   // this era reads the ADC through mcu_adc_result_*

////////// clock speed //////////

inline void mcu_clock_speed() { }
inline void clock_prescale_set(uint8_t n) { (void)n; }

////////// ADC //////////

inline void mcu_set_admux_therm() {
    sim_io.adc_channel_hw = 1;
    sim_io.adc_on = 1;
}

inline void mcu_set_admux_voltage() {
    sim_io.adc_channel_hw = 0;
    sim_io.adc_on = 1;
}

inline void mcu_adc_sleep_mode() { set_sleep_mode(SLEEP_MODE_STANDBY); }

inline void mcu_adc_start_measurement() {
    TRACE(6, 0);
    sim_io.adc_on = 1;
    if (! sim_adc_running) {
        sim_adc_running = 1;
        sim_adc_next = sim_now + SIM_ADC_PERIOD_CYCLES;
    }
}

inline void mcu_adc_off() {
    sim_adc_running = 0;
    sim_io.adc_on = 0;
}

inline void mcu_adc_vect_clear() { }

// The simulated sensor reports Kelvin << 6 directly (the firmware's own
// convention, where 0 C is 275 K), so the host can set an exact temperature
// and an exact calibration error and watch the firmware react to both.
inline uint16_t mcu_adc_result_temp() {
    uint32_t dk = sim_io.env_decikelvin;       // (C + 275) * 10
    return (uint16_t)((dk * 64u) / 10u);
}

inline uint16_t mcu_adc_result_volts() {
    uint32_t mv = sim_io.env_millivolts;
    if (mv < 1500) mv = 1500;                  // below this the MCU is in reset
    uint32_t raw = 98304000UL / mv;            // 65536 * 1.5V / Vbat
    if (raw > 65535) raw = 65535;
    return (uint16_t)(raw & 0xFFF0);           // 12-bit ADC, left-aligned
}

inline uint8_t mcu_vdd_raw2cooked(uint16_t measurement) {
    // scale * 1.5V * 4096, the same expression the AVR arch files use.
    // The unit is spelled out rather than taken from the firmware's own dV,
    // because in older source layouts this file is compiled before fsm/adc.h;
    // sim_main.c checks the two agree.
    uint16_t m = measurement >> 4;
    if (! m) m = 1;
    return (uint8_t)((uint32_t)(SIM_VOLT_SCALE * 6144UL) / m);
}

inline uint16_t mcu_temp_raw2cooked(uint16_t measurement) {
    return measurement;  // already Kelvin << 6
}

inline uint8_t mcu_adc_lsb() {
    // real ADC noise, which is where the firmware's RNG gets its entropy
    sim_noise = (sim_noise >> 1) ^ (uint16_t)(-(sim_noise & 1u) & 0xB400u);
    return (uint8_t)sim_noise;
}

////////// WDT / periodic interrupt timer //////////

inline void mcu_wdt_active() {
    TRACE(5, 0);
    sim_wdt_period = SIM_TICK_CYCLES;
    sim_wdt_next = sim_now + sim_wdt_period;
    sim_io.wdt_period_ms = SIM_TICK_MS;
}

inline void mcu_wdt_standby() {
    sim_wdt_period = SIM_TICK_CYCLES << STANDBY_TICK_SPEED;
    sim_wdt_next = sim_now + sim_wdt_period;
    sim_io.wdt_period_ms = SIM_TICK_MS << STANDBY_TICK_SPEED;
}

inline void mcu_wdt_stop() {
    sim_wdt_period = 0;
    sim_io.wdt_period_ms = 0;
}

inline void mcu_wdt_vect_clear() { }

////////// PCINT //////////

inline void mcu_switch_vect_clear() { }
inline void mcu_pcint_on()  { sim_pcint_armed = 1; }
inline void mcu_pcint_off() { sim_pcint_armed = 0; }

////////// aux LEDs //////////

#ifdef USE_AUX1_LED
void mcu_set_aux1_power(uint8_t power) {
    sim_io.aux1 = (power > 2) ? 2 : power;
}
#endif

#ifdef USE_AUXRGB_LEDS
void mcu_set_auxrgb_power(uint8_t value) {
    sim_io.auxrgb = value;
}
#endif

////////// misc //////////

void reboot() {
    sim_io.reboot_requested = 1;
    sim_io.n_reboots++;
    while (1) sim_yield_to_host();  // the host throws this instance away
}

inline void prevent_reboot_loop() { }

// called by the host before main()
