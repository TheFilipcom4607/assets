// sim/legacy.h: the attiny register file, for Anduril 1.
//
// Anduril 1 predates the arch/ abstraction: the firmware talks to the ADC,
// watchdog, pin-change interrupt and I/O pins by writing registers directly.
// So this header gives it registers to write, and sim/legacy.c reads them back
// out and works out what the hardware would have done.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <stdint.h>
#include "sim/core.h"

// interrupt vectors, wired to the core's dispatcher
#define ADC_vect      sim_adc_isr
#define WDT_vect      sim_wdt_isr
#define PCINT0_vect   sim_pcint_isr

////////// the register file //////////

extern volatile uint8_t  sim_ADMUX, sim_ADCSRA, sim_ADCSRB, sim_DIDR0, sim_DIDR1;
extern volatile uint16_t sim_ADCW;
extern volatile uint8_t  sim_GIMSK, sim_PCMSK, sim_PCMSK0, sim_PCMSK1, sim_PCMSK2;
extern volatile uint8_t  sim_WDTCR, sim_WDTCSR, sim_MCUSR, sim_MCUCR, sim_CLKPR, sim_CCP;
extern volatile uint8_t  sim_PORTA, sim_DDRA, sim_PUEA;
extern volatile uint8_t  sim_PORTB, sim_DDRB, sim_PUEB;
extern volatile uint8_t  sim_PORTC, sim_DDRC, sim_PUEC;
extern volatile uint8_t  sim_TCCR0A, sim_TCCR0B, sim_TCCR1, sim_GTCCR, sim_TIMSK, sim_TIFR;
extern volatile uint8_t  sim_OCR0A, sim_OCR0B, sim_OCR1A, sim_OCR1B, sim_OCR1C, sim_ACSR, sim_PRR;

#define ADMUX   sim_ADMUX
#define ADCSRA  sim_ADCSRA
#define ADCSRB  sim_ADCSRB
#define DIDR0   sim_DIDR0
#define DIDR1   sim_DIDR1
#define ADC     sim_ADCW
#define ADCL    (*(volatile uint8_t *)&sim_ADCW)
#define ADCH    (*(((volatile uint8_t *)&sim_ADCW) + 1))
#define GIMSK   sim_GIMSK
#define PCMSK   sim_PCMSK
#define PCMSK0  sim_PCMSK0
#define PCMSK1  sim_PCMSK1
#define PCMSK2  sim_PCMSK2
#define WDTCR   sim_WDTCR
#define WDTCSR  sim_WDTCSR
#define MCUSR   sim_MCUSR
#define MCUCR   sim_MCUCR
#define CLKPR   sim_CLKPR
#define CCP     sim_CCP
#define PORTA   sim_PORTA
#define DDRA    sim_DDRA
#define PUEA    sim_PUEA
#define PORTB   sim_PORTB
#define DDRB    sim_DDRB
#define PUEB    sim_PUEB
#define PORTC   sim_PORTC
#define DDRC    sim_DDRC
#define PUEC    sim_PUEC
#define TCCR0A  sim_TCCR0A
#define TCCR0B  sim_TCCR0B
#define TCCR1   sim_TCCR1
#define GTCCR   sim_GTCCR
#define TIMSK   sim_TIMSK
#define TIFR    sim_TIFR
#define OCR0A   sim_OCR0A
#define OCR0B   sim_OCR0B
#define OCR1A   sim_OCR1A
#define OCR1B   sim_OCR1B
#define OCR1C   sim_OCR1C
#define ACSR    sim_ACSR
#define PRR     sim_PRR

// the e-switch pin is read through the core, so a spin-loop waiting on the
// button still moves the simulated clock forward
#define PINA    sim_switch_port()
#define PINB    sim_switch_port()
#define PINC    sim_switch_port()

////////// register bits //////////

#define ADEN 7
#define ADSC 6
#define ADATE 5
#define ADIF 4
#define ADIE 3
#define ADPS2 2
#define ADPS1 1
#define ADPS0 0
#define ADLAR 5      // in ADMUX on the tiny25/45/85, in ADCSRB on the 1634
#define REFS0 6
#define REFS1 7
#define MUX0 0
#define MUX1 1
#define MUX2 2
#define MUX3 3
#define MUX4 4

#define WDIE 6
#define WDCE 4
#define WDE  3
#define WDP0 0
#define WDP1 1
#define WDP2 2
#define WDP3 5
#define WDRF 3

#define PCIE  5
#define PCIE0 3
#define PCIE1 4
#define PCIE2 5
#define CLKPCE 7

#define CS10 0
#define CTC1 7
#define PWM1A 6
#define PWM1B 6
#define COM1A0 4
#define COM1A1 5
#define COM1B0 4
#define COM1B1 5
#define OCIE1A 6
#define TOIE1 2
#define TOV1 2

#define PA0 0
#define PA1 1
#define PA2 2
#define PA3 3
#define PA4 4
#define PA5 5
#define PA6 6
#define PA7 7
#define PB0 0
#define PB1 1
#define PB2 2
#define PB3 3
#define PC0 0
#define PC1 1
#define PC2 2
#define PC3 3
#define PC4 4
#define PC5 5

#define PCINT0 0
#define PCINT1 1
#define PCINT2 2
#define PCINT3 3
#define PCINT4 4
#define PCINT5 5
#define PCINT6 6
#define PCINT7 7
#define PCINT8 0
#define PCINT9 1
#define PCINT10 2
#define PCINT11 3

// attiny1634: 256 bytes of EEPROM
#define E2END 255
