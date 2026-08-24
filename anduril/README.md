# Anduril simulator

A flashlight simulator that runs the real [Anduril](https://github.com/ToyKeeper/anduril)
firmware. The C sources are compiled unmodified to WebAssembly; everything
around them — MCU, e-switch, LEDs, battery, temperature sensor — is simulated.

Live at `/anduril/`. See `notes.html` for how it works and where it differs
from real hardware.

## Layout

    index.html, app.js, sim.js, style.css   the simulator page
    notes.html                              how it works
    builds/                                 compiled firmware + manifest
    sim/                                    the simulated hardware (C)
      include/sim/core.{h,c}                clock, interrupts, EEPROM, host hand-off
      include/arch/sim.{h,c}                MCU for current releases (mirrors arch/attiny1616.c)
      include/sim/legacy.{h,c}              register-level hardware for Anduril 1
      include/avr/*, include/util/*         stand-ins for avr-libc headers
      hw/sim/                               hardware definition, current releases
      legacy/sim/                           hardware definition, Anduril 1
      sim_main.c, sim_main_legacy.c         the two translation units
      tools/build.mjs                       the build
      build-config.json                     versions and hardware matrix

## Rebuilding

Needs `clang` (with the wasm32 target), `gcc`, node, and a checkout of upstream
Anduril in `.upstream/`:

    git clone --filter=blob:none https://github.com/ToyKeeper/anduril .upstream
    npm --prefix .tools install binaryen
    node sim/tools/build.mjs                     # everything
    node sim/tools/build.mjs --versions=r2026-08-12 --quick

Each artifact is booted and clicked before it is written to the manifest, so a
build that does not run never reaches the site. To add a release, add a tag to
`sim/build-config.json` (`layout: "legacy"` for anything before the 2023 source
reorganisation) and rebuild.

To try a single build outside the browser:

    node sim/tools/smoke.mjs builds/r2026-08-12/btn-auxrgb-therm.wasm builds/layout.json

## Licence

Anduril is GPL-3.0-or-later, by Selene ToyKeeper and contributors. The
simulated hardware here is under the same licence.
