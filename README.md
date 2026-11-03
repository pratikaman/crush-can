# Press Soda — Force Touch crush demo

Squeeze a 3D soda can with your MacBook's Force Touch trackpad. The harder you press, the more it crushes.

**Open `index.html` in Safari.** It's a single self-contained file (three.js + fonts inlined), works offline and from Finder.

- Real pressure comes from Safari's `webkitmouseforcechanged` / `MouseEvent.webkitForce` (1 = click, 2 = force click, ~3 max). Full crush is at 2.25 (just past the force click); the force click itself is ~80 %.
- Chrome/Firefox don't expose trackpad force, so they fall back to "hold to squeeze" (pressure ramps while held). Pens with pointer pressure also work.
- Needs System Settings → Trackpad → "Force Click and haptic feedback" on.

## Controls
- Click and hold anywhere, then press harder. Crossing the force-click line gives the haptic thunk.
- **Stays crushed** / **Springs back**: permanent metal vs. follows your finger.
- `R` fresh can · `1`–`4` flavours · `M` mode · `Space` hold-to-squeeze · scroll/swipe to spin.

## How the can is made
- `src/profile.js`: lathe profile of a real 12 oz can (dome, standing bead, necked shoulder, double seam, countersunk lid).
- `src/can.js`: the crush. A few uneven fold rows collapse on an irregular schedule. Each row folds into heavily jittered diamond facets laid out along wavy, tilted fold lines, deeper on one side, with a big outward flap on one side. Ridged-noise wrinkles concentrate along the creases, facets bow in and out, and random dents appear as it crushes. The rim goes slightly oval and the lid leans on a rigid transform. Everything independent of crush amount is baked per vertex when a can is made (about 4 ms per update).
- `src/textures.js`: label, roughness/metalness and lid normal maps, all drawn on canvas (original "press soda co." brand).
- `src/env.js`: studio softbox environment (PMREM). `src/shadow.js`: contact shadow. `src/audio.js`: synthesised crunch.

## Dev
```
npm install
node build.mjs                      # → index.html
node shot.mjs out.png "crush=0.5&flavor=lime&rot=1"   # QA screenshot (needs Playwright: npm i -D playwright, or PLAYWRIGHT=/path/to/playwright/index.mjs)
node test-press.mjs <outdir>        # drives mouse + synthetic Force Touch events
```
URL params: `crush`, `flavor` (cherry|lime|orange|grape), `seed`, `rot`, `still`, `mode=live`, `p` (fixed pressure).

## Credits
- [three.js](https://threejs.org) r170 (MIT, see `THIRD_PARTY_LICENSE-three.txt`), bundled into `index.html`.
- Fonts under the SIL Open Font License 1.1 (see `fonts/OFL-*.txt`): Instrument Serif and Instrument Sans (Instrument), Shrikhand (Jonny Pinhorn), JetBrains Mono (JetBrains).
- "press soda co." is a made-up brand for this demo.
