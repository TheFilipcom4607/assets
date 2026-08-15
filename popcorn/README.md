# Popcorn Ear

A microphone-based "your popcorn is done" alarm, as a static PWA. Open it on
your phone, put the phone near the microwave, hit start, and it says out loud
when to stop the microwave.

Lives at `/popcorn/` on the site. No build step, no dependencies, no backend —
the audio never leaves the page.

## How it decides

**Hearing a pop.** A running microwave is loud, but it's loud in a steady,
low-frequency way: mains hum and harmonics, a cooling fan, the turntable motor.
A kernel going off is the opposite — a very short broadband transient with lots
of energy above 2 kHz. So the detector ignores loudness entirely and watches the
frame-to-frame *increase* of energy in a 2–9 kHz band (spectral flux), compared
against a running estimate of the noise floor. Being purely relative, it copes
with iOS applying gain control we can't fully switch off, and with microwaves of
wildly different loudness.

The noise floor is the **25th percentile** of recent flux rather than the median.
At peak popping, pops occupy nearly half of all frames, so a median gets dragged
upward by the pops themselves and the detector starts going deaf exactly when the
rate matters most. That one change took detection on the hardest test case from
27% of pops to 70%.

**Deciding it's done.** The folk rule is "stop when pops are 2 seconds apart".
That's a reasonable baseline but wrong in two ways:

1. It ignores how vigorous the bag was. A bag that peaked at 15 pops/second and
   dropped to 1 is finished; a bag that never got above 2 is still going. So the
   current rate is compared against *that bag's own peak*, not a fixed number.
2. Worse, pops are a random process. At 1.5 pops/second a 2-second silence
   happens **by chance**, repeatedly, in the middle of a bag that is nowhere near
   done. That is exactly how you end up stopping with a third of the bag
   unpopped.

So the stop decision runs on a deliberately long 8-second window that a chance
lull can't empty, and requires *both* a quiet window and a current gap before it
fires. A short 2.5-second window drives the on-screen number, where being
responsive matters and being wrong costs nothing.

There's also a heads-up announcement when the rate first starts to fall, so you
have time to walk over; if the bag was only pausing and picks back up, that
re-arms silently.

**Learning your taste.** After each bag you tap "too many unpopped" / "just
right" / "scorched", which slides a `patience` value stored in `localStorage`.
Everything else (gap length, fraction-of-peak) is derived from it.

## Testing

Two suites, both self-contained — no microwave required.

```
node tools/test-detector.mjs   # algorithm, offline and deterministic (~2 min)
node tools/test-browser.mjs    # the real page in Chromium (~1 min)
```

`tools/synth-audio.mjs` synthesises a microwave recording: hum harmonics, a
low-passed fan, turntable wobble, and pops scheduled from a Poisson process
driven by a realistic rate curve. Because it knows where every pop really was,
the tests can assert on things you can't measure in a kitchen — how many kernels
were still to come when the alarm fired.

`test-detector.mjs` replays that audio through a faithful stand-in for
`AnalyserNode` (same Blackman window, FFT size, and hop the browser uses) and
into the real `detector.js`. It covers a typical bag, quiet pops, a loud
microwave, a weak bag that never gets vigorous, a bag with a lull in the middle,
both ends of the patience slider, and negative cases that must *never* fire — a
microwave running with no popcorn, a silent room, and a bag still popping hard
when the recording ends.

`test-browser.mjs` runs the actual page in Chromium with that audio piped in as
a fake microphone, covering the parts the offline test can't: the getUserMedia
constraints, the analyser, the rAF loop, the screens, and the feedback loop.

`tools/make-icons.mjs` regenerates the PWA icons (hand-rasterised and written
with `zlib`, since no image library is available here).

## iPhone notes

- **Ringer switch on, volume up.** Safari silences web audio when the phone is
  on silent. The "Test the voice" button on the listening screen exists so you
  can check this with the mic already running.
- **Leave the screen open.** iOS cuts the microphone when you lock the phone or
  switch apps. The app takes a screen wake lock, and warns you on-screen if it
  detects it was throttled and may have missed pops.
- Add to Home Screen to run it full screen.
- The pop counter reads low on purpose — roughly 60–70% of real pops get
  counted, because overlapping pops merge. The decision is based on *relative*
  rate, so consistent under-counting doesn't affect the timing.
