# Popcorn Ear

A microphone-based "your popcorn is done" alarm, as a static PWA. Open it on
your phone, put the phone near the microwave, hit start, and it says out loud
when to stop the microwave.

Lives at `/popcorn/` on the site. No build step, no dependencies, no backend —
the audio never leaves the page.

**Asset URLs are absolute (`/popcorn/styles.css`, not `styles.css`) and have to
stay that way.** The host serves `/popcorn` without redirecting to `/popcorn/`,
so relative URLs resolve against the site root and every asset 404s — the page
renders as unstyled HTML with all four screens stacked on top of each other. If
this app ever moves to a different path, `index.html`, `manifest.json`, `sw.js`,
and the `serviceWorker.register` call in `app.js` all need updating together.

## The iOS rule that shapes the whole app

**iOS will not let a page capture and play at the same time.** The moment any
sound comes out of the speaker — a chime, a spoken phrase, anything — the
`MediaStreamAudioSourceNode` feeding the analyser goes silent, permanently.

Nothing in the API reports this. The track still reads `live`, the
`AudioContext` still reads `running`, and the analyser just returns digital
silence forever. Since "no pops" is indistinguishable from "the bag finished",
the app would then flash the alert with no sound behind it.

Three consequences run through the code:

- **Silent while listening.** Nothing that used to be announced mid-run is
  spoken; it's shown on screen instead. Output has its own `AudioContext`,
  separate from the capture one, and `tone()`/`speak()` refuse to run while
  capture is live — bumping `popcornDebug.audioWhileCapturing`, which the
  browser test asserts stays at zero.
- **The microphone is released before it speaks.** `triggerAlert` tears down
  capture first, so the voice comes out of a clean playback session.
- **A watchdog.** iOS still kills capture on its own — a notification, Siri, a
  route change. If the band goes exactly zero for 2 seconds (a real room never
  does), the graph is rebuilt from scratch. Because the dropout leaves a hole in
  the pop record that reads as "gone quiet", `suspendDecisions()` then blocks
  any stop call until the 8-second window has refilled. After three failed
  recoveries it raises the alert rather than sitting there deaf.

Speech synthesis is also unreliable in an iOS Home Screen web app: it accepts an
utterance and never speaks it, without firing `onerror`. So `speak()` starts a
900 ms timer and falls back to a loud alarm tone if `onstart` never arrives.

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
both ends of the patience slider, a 4-second microphone dropout mid-run, and
negative cases that must *never* fire — a microwave running with no popcorn, a
silent room, and a bag still popping hard when the recording ends.

`test-browser.mjs` runs the actual page in Chromium with that audio piped in as
a fake microphone, covering the parts the offline test can't: the getUserMedia
constraints, the analyser, the rAF loop, the screens, and the feedback loop.

Its server mirrors production rather than serving the folder as the site root:
the app is mounted at `/popcorn/`, requests outside that prefix 404, and
`/popcorn` is served *without* redirecting to `/popcorn/`. The test then asserts
that nothing 404s and that the stylesheet actually took effect — an unstyled
page still passes a naive smoke test, since without CSS every screen is visible
at once rather than hidden.

`tools/make-icons.mjs` regenerates the PWA icons (hand-rasterised and written
with `zlib`, since no image library is available here).

## iPhone notes

- **Ringer switch on, volume up.** Safari silences web audio when the phone is
  on silent. "Test the voice first" on the setup screen checks this before you
  commit a bag to it — it lives there, not on the listening screen, because
  playing anything mid-run is exactly what breaks capture.
- **Leave the screen open.** iOS cuts the microphone when you lock the phone or
  switch apps. The app takes a screen wake lock, and warns you on-screen if it
  detects it was throttled and may have missed pops.
- Add to Home Screen to run it full screen.
- The pop counter reads low on purpose — roughly 60–70% of real pops get
  counted, because overlapping pops merge. The decision is based on *relative*
  rate, so consistent under-counting doesn't affect the timing.
