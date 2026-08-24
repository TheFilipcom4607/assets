// arch/sim.h: "MCU" support header for the Anduril web simulator.
// Implements the same interface as arch/attiny1616.h and friends, but backed
// by a virtual clock and a shared state struct instead of silicon.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include "sim/simcore.h"

// Anduril's internal voltage unit: 50 per volt on current releases, 40 on
// releases before r2024.  The build script detects which one applies.
#ifndef SIM_VOLT_SCALE
#define SIM_VOLT_SCALE 50
#endif

// modelled on the attiny1616 running at 10 MHz
// the AVR 1-series thermal sensor is factory calibrated; Anduril checks for
// this to decide how to handle calibration on a factory reset
#define AVRXMEGA3

#define F_CPU  10000000UL
#define BOGOMIPS  (F_CPU/4350)
#define DELAY_ZERO_TIME  1020

// the PIT ticks every 16 ms while awake
#define SIM_TICK_MS  16

////////// I/O ports //////////
// Older Anduril versions drive the aux LEDs by poking port registers directly,
// so the simulator emulates the pins themselves: set/clear registers are
// applied to the pin state, and each LED's brightness is read back out of it
// exactly the way the hardware would resolve it (driven high, driven low, or
// input with the pull-up on, which is the "dim" state Anduril relies on).

typedef struct SimPort {
    volatile uint8_t DIR, DIRSET, DIRCLR, DIRTGL;
    volatile uint8_t OUT, OUTSET, OUTCLR, OUTTGL;
    volatile uint8_t IN, INTFLAGS, PORTCTRL, _reserved[5];
    volatile uint8_t PIN0CTRL, PIN1CTRL, PIN2CTRL, PIN3CTRL,
                     PIN4CTRL, PIN5CTRL, PIN6CTRL, PIN7CTRL;
} SimPort;

extern SimPort sim_porta;
extern SimPort sim_portb;

void sim_ports_update(void);

// where the simulated light wires its LEDs
#define SIM_LED_1_PORT    sim_portb
#define SIM_LED_1_PIN     5
#define SIM_LED_R_PORT    sim_porta
#define SIM_LED_R_PIN     5
#define SIM_LED_G_PORT    sim_porta
#define SIM_LED_G_PIN     4
#define SIM_LED_B_PORT    sim_porta
#define SIM_LED_B_PIN     3

////////// virtual clock //////////

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

// interrupt handlers, defined later by the firmware via ISR()
void sim_wdt_isr(void);
void sim_adc_isr(void);
void sim_pcint_isr(void);

////////// clock speed //////////

inline void mcu_clock_speed();

typedef enum {
    clock_div_1 = 0, clock_div_2, clock_div_4, clock_div_8,
    clock_div_16, clock_div_32, clock_div_64, clock_div_128, clock_div_256
} clock_div_t;

inline void clock_prescale_set(uint8_t n);

////////// ADC voltage / temperature //////////

#define hwdef_set_admux_therm  mcu_set_admux_therm
inline void mcu_set_admux_therm();

#define hwdef_set_admux_voltage mcu_set_admux_voltage
inline void mcu_set_admux_voltage();

inline void mcu_adc_sleep_mode();
inline void mcu_adc_start_measurement();
inline void mcu_adc_off();

#define ADC_vect  sim_adc_isr
inline void mcu_adc_vect_clear();

// separate conversions for the two channels, like the newer AVRs
#define MCU_ADC_RESULT_PER_TYPE
inline uint16_t mcu_adc_result_temp();
inline uint16_t mcu_adc_result_volts();

// raw -> Volts * 50
#define voltage_raw2cooked  mcu_vdd_raw2cooked
inline uint8_t mcu_vdd_raw2cooked(uint16_t measurement);

// raw -> Kelvin << 6.  The simulated sensor reports in those units already,
// so the host can dial in an exact temperature and an exact calibration error.
#define temp_raw2cooked  mcu_temp_raw2cooked
inline uint16_t mcu_temp_raw2cooked(uint16_t measurement);

inline uint8_t mcu_adc_lsb();

////////// WDT (periodic interrupt timer) //////////

inline void mcu_wdt_active();
inline void mcu_wdt_standby();
inline void mcu_wdt_stop();

#define WDT_vect  sim_wdt_isr
inline void mcu_wdt_vect_clear();

////////// PCINT - pin change interrupt (e-switch) //////////

inline void mcu_switch_vect_clear();
inline void mcu_pcint_on();
inline void mcu_pcint_off();

////////// aux LEDs //////////

#define set_aux1_power  mcu_set_aux1_power
void mcu_set_aux1_power(uint8_t power);

#define set_auxrgb_power  mcu_set_auxrgb_power
void mcu_set_auxrgb_power(uint8_t value);

////////// misc //////////

void reboot();
inline void prevent_reboot_loop();
