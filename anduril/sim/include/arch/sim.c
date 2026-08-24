// arch/sim.c: virtual MCU for the Anduril web simulator.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include "arch/sim.h"

// The one blocking call into the host.  Binaryen's asyncify transform unwinds
// the wasm stack here and rewinds it on the next animation frame, which is how
// firmware busy-waits and sleeps turn into real elapsed wall-clock time.
__attribute__((import_module("env"), import_name("sim_host_yield")))
extern void sim_host_yield(void);

// Optional build-time tracing hook.  The host supplies a no-op unless it is
// debugging a build.
__attribute__((import_module("env"), import_name("sim_host_trace")))
extern void sim_host_trace(uint32_t id, uint32_t arg);

#ifdef SIM_TRACE
#define TRACE(id, arg)  sim_host_trace((id), (uint32_t)(arg))
#else
#define TRACE(id, arg)  ((void)0)
#endif

// defined after the firmware, in sim/sim_post.c
void sim_sync_state(void);

// one ADC conversion: 12-bit + 4x accumulate at CLK/16, about 83 us
#define SIM_ADC_PERIOD_CYCLES  ((uint32_t)(F_CPU / 12000))
#define SIM_TICK_CYCLES        ((uint32_t)(F_CPU / 1000 * SIM_TICK_MS))

SimIO sim_io;
SimPort sim_porta;
SimPort sim_portb;

uint64_t sim_now;          // virtual cycles since power-on
uint64_t sim_wdt_next;
uint32_t sim_wdt_period;   // cycles between PIT interrupts, 0 = off
uint64_t sim_adc_next;
uint8_t  sim_adc_running;
uint8_t  sim_irq_on;
uint8_t  sim_pcint_armed;
uint8_t  sim_button_prev;
uint8_t  sim_pend_wdt, sim_pend_adc, sim_pend_pcint;
uint8_t  sim_in_sleep, sim_woke;
uint16_t sim_noise = 0xACE1;
uint8_t  sim_eeprom_data[EEPROM_SIZE];

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

void sim_publish_time(void) {
    sim_io.cycles_lo = (uint32_t)sim_now;
    sim_io.cycles_hi = (uint32_t)(sim_now >> 32);
}

void sim_fire_pending(void) {
    TRACE(8, (sim_pend_wdt<<2)|(sim_pend_adc<<1)|sim_pend_pcint);
    if (! sim_irq_on) return;
    while (sim_pend_pcint || sim_pend_adc || sim_pend_wdt) {
        if (sim_pend_pcint) { sim_pend_pcint = 0; sim_woke = 1; sim_pcint_isr(); }
        else if (sim_pend_adc) { sim_pend_adc = 0; sim_woke = 1; sim_adc_isr(); }
        else if (sim_pend_wdt) { sim_pend_wdt = 0; sim_woke = 1; sim_wdt_isr(); }
    }
}

void sim_poll_button(void) {
    uint8_t down = sim_io.button_down ? 1 : 0;
    if (down != sim_button_prev) {
        sim_button_prev = down;
        // the e-switch pin is configured for both edges
        if (sim_pcint_armed) { sim_pend_pcint = 1; sim_fire_pending(); }
    }
}

void sim_yield_to_host(void) {
    sim_ports_update();
    sim_publish_time();
    sim_sync_state();
    sim_host_yield();
    sim_poll_button();
}

// Run the virtual clock forward to `target`, servicing interrupts on the way.
// Run the virtual clock forward to `target`, servicing interrupts on the way.
// Interrupts which are already due fire first, so a caller may pass a target
// equal to (or behind) the current time to mean "service what is pending".
void sim_advance_to(uint64_t target) {
    sim_ports_update();
    for (;;) {
        uint8_t due = 0;
        if (sim_wdt_period && (sim_wdt_next <= sim_now)) {
            sim_wdt_next = sim_now + sim_wdt_period;
            sim_pend_wdt = 1;
            sim_io.n_ticks++;
            due = 1;
        }
        if (sim_adc_running && (sim_adc_next <= sim_now)) {
            sim_adc_next = sim_now + SIM_ADC_PERIOD_CYCLES;
            sim_pend_adc = 1;
            due = 1;
        }
        if (due) {
            sim_fire_pending();
            if (sim_in_sleep && sim_woke) break;
        }
        if (sim_now >= target) break;

        // run up to whichever comes first: the next interrupt, or the target
        uint64_t next = target;
        if (sim_wdt_period && (sim_wdt_next < next)) next = sim_wdt_next;
        if (sim_adc_running && (sim_adc_next < next)) next = sim_adc_next;

        uint64_t want = next - sim_now;
        while (want) {
            if (! sim_io.budget_cycles) {
                sim_yield_to_host();
                if (sim_in_sleep && sim_woke) goto done;
                continue;
            }
            uint32_t step = (want > (uint64_t)sim_io.budget_cycles)
                          ? sim_io.budget_cycles : (uint32_t)want;
            sim_io.budget_cycles -= step;
            sim_now += step;
            want -= step;
        }
    }
done:
    sim_publish_time();
}

void sim_burn_cycles(uint32_t cycles) {
    TRACE(1, cycles);
    sim_advance_to(sim_now + cycles);
}

void sim_sei(void) { TRACE(2, 0); sim_irq_on = 1; sim_io.irq_enabled = 1; sim_fire_pending(); }
void sim_cli(void) { sim_irq_on = 0; sim_io.irq_enabled = 0; }

void sim_set_sleep_mode(int mode) { sim_io.sleep_mode = mode; }

void sim_sleep_cpu(void) {
    TRACE(3, sim_io.sleep_mode);
    sim_io.sleeping = 1;
    sim_in_sleep = 1;
    sim_woke = 0;
    sim_fire_pending();  // anything already waiting wakes us straight away
    if (! sim_woke) {
        uint64_t next = 0;
        if (sim_wdt_period) next = sim_wdt_next;
        if (sim_adc_running && ((! next) || (sim_adc_next < next))) next = sim_adc_next;
        // nothing scheduled: only the e-switch can wake us, so idle in
        // host-sized slices until it does
        if (! next) next = sim_now + (F_CPU / 4);
        sim_advance_to(next);
    }
    sim_in_sleep = 0;
    sim_io.sleeping = 0;
}

uint8_t sim_switch_port(void) {
    TRACE(4, sim_io.button_down);
    // reading a pin costs a couple of cycles, which keeps firmware spin-loops
    // (like "wait until the button is released") moving through virtual time
    sim_burn_cycles(2);
    return sim_io.button_down ? 0 : 1;  // active low, with a pull-up
}

////////// EEPROM //////////

uint8_t sim_eeprom_read(uint16_t addr) {
    if (addr >= EEPROM_SIZE) return 0xFF;
    return sim_eeprom_data[addr];
}

void sim_eeprom_write(uint16_t addr, uint8_t value) {
    TRACE(7, addr);
    if (addr >= EEPROM_SIZE) return;
    if (sim_eeprom_data[addr] != value) {
        sim_eeprom_data[addr] = value;
        sim_io.eeprom_writes++;
        sim_io.eeprom_dirty = 1;
    }
    sim_burn_cycles(F_CPU / 250);  // a real EEPROM byte write takes ~4 ms
}

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
__attribute__((export_name("sim_init")))
void sim_init(void) {
    sim_io.magic = SIM_MAGIC;
    sim_io.f_cpu = F_CPU;
    for (uint16_t i = 0; i < EEPROM_SIZE; i++) sim_eeprom_data[i] = 0xFF;
}

__attribute__((export_name("sim_io_ptr")))
uint32_t sim_io_ptr(void) { return (uint32_t)(uintptr_t)&sim_io; }

__attribute__((export_name("sim_eeprom_ptr")))
uint32_t sim_eeprom_ptr(void) { return (uint32_t)(uintptr_t)sim_eeprom_data; }

__attribute__((export_name("sim_eeprom_size")))
uint32_t sim_eeprom_size(void) { return EEPROM_SIZE; }
