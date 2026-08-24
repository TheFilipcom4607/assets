// sim/core.h: the simulated machine's shared internals.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <stdint.h>
#include "sim/simcore.h"

// the PIT / WDT ticks every 16 ms while awake, which is Anduril's clock
#define SIM_TICK_MS  16

void sim_burn_cycles(uint32_t cycles);   // spend cycles, running due interrupts
void sim_advance_to(uint64_t target);
void sim_publish_time(void);
void sim_fire_pending(void);
void sim_poll_button(void);
void sim_yield_to_host(void);
void sim_sei(void);
void sim_cli(void);
void sim_set_sleep_mode(int mode);
void sim_sleep_cpu(void);
uint8_t sim_switch_port(void);
uint8_t sim_eeprom_read(uint16_t addr);
void sim_eeprom_write(uint16_t addr, uint8_t value);

// supplied by whichever variant is in use
void sim_hw_poll(void);      // called whenever time moves; sweep the peripherals
void sim_adc_deliver(void);  // called just before the ADC interrupt fires

// interrupt handlers, defined later by the firmware via ISR()
void sim_wdt_isr(void);
void sim_adc_isr(void);
void sim_pcint_isr(void);

// clock and peripheral state, shared with the variant
extern uint64_t sim_now;
extern uint64_t sim_wdt_next;
extern uint32_t sim_wdt_period;
extern uint64_t sim_adc_next;
extern uint8_t  sim_adc_running;
extern uint8_t  sim_irq_on;
extern uint8_t  sim_pcint_armed;
extern uint16_t sim_noise;
