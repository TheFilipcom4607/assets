// gen-layout.c: emits the byte offsets of every SimIO field as JSON, so the
// JavaScript host and the wasm firmware can never disagree about the layout.
// Built and run on the host during the build; not part of the firmware.
#include <stdio.h>
#include <stddef.h>
#include "sim/simcore.h"

#define F(name) printf("%s  \"%s\": %u", first ? (first = 0, "\n ") : ",\n ", #name, (unsigned)offsetof(SimIO, name))

int main(void) {
    int first = 1;
    printf("{\n \"__size\": %u,", (unsigned)sizeof(SimIO));
    F(magic); F(cycles_lo); F(cycles_hi); F(f_cpu);
    F(pwm); F(pwm_top); F(pwm_channels);
    F(aux1); F(auxrgb); F(has_aux1); F(has_auxrgb);
    F(aux1_is_button); F(auxrgb_is_button);
    F(sleeping); F(sleep_mode); F(adc_on); F(adc_channel_hw);
    F(irq_enabled); F(wdt_period_ms);
    F(env_millivolts); F(env_decikelvin); F(button_down);
    F(fw_actual_level); F(fw_ramp_size); F(fw_current_state);
    F(fw_state_depth); F(fw_state_stack); F(fw_current_event);
    F(fw_ticks_since_last_event); F(fw_voltage); F(fw_voltage_scale); F(fw_temperature);
    F(fw_channel_mode); F(fw_num_channel_modes); F(fw_go_to_standby);
    F(n_ticks); F(n_reboots); F(eeprom_writes); F(eeprom_dirty);
    F(budget_cycles); F(reboot_requested); F(booted);
    printf("\n}\n");
    return 0;
}
