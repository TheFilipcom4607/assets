// avr/sleep.h: sleep shim for the web simulator.
#pragma once

#include <avr/io.h>

#define SLEEP_MODE_IDLE        0
#define SLEEP_MODE_ADC         1
#define SLEEP_MODE_STANDBY     2
#define SLEEP_MODE_PWR_DOWN    4

void sim_set_sleep_mode(int mode);
void sim_sleep_cpu(void);

#define set_sleep_mode(m)  sim_set_sleep_mode(m)
#define sleep_enable()     ((void)0)
#define sleep_disable()    ((void)0)
#define sleep_bod_disable() ((void)0)
#define sleep_cpu()        sim_sleep_cpu()
#define sleep_mode()       sim_sleep_cpu()
