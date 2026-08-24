// avr/interrupt.h: interrupt shim for the web simulator.
#pragma once

#include <avr/io.h>

#include "sim/simcore.h"

// An "ISR" here is just a function the simulated peripheral clock calls.
#define ISR(vector)  void vector(void)
#define EMPTY_INTERRUPT(vector)  void vector(void) { }

void sim_sei(void);
void sim_cli(void);

#define sei()  sim_sei()
#define cli()  sim_cli()
