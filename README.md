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
- `src/can.js`: the crush. The wall folds row by row in a Yoshimura diamond pattern (flat triangular facets between alternating N-gon rings), with a random fold order, lobed outward lips, crumple noise and tilt per can. Normals come from finite differences, and the lid rides on a rigid transform.
- `src/textures.js`: label, roughness/metalness and lid normal maps, all drawn on canvas (original "press soda co." brand).
- `src/env.js`: studio softbox environment (PMREM). `src/shadow.js`: contact shadow. `src/audio.js`: synthesised crunch.

## Dev
```
npm install
node build.mjs                      # → index.html
node shot.mjs out.png "crush=0.5&flavor=lime&rot=1"   # QA screenshot (Playwright Chromium)
node test-press.mjs <outdir>        # drives mouse + synthetic Force Touch events
```
URL params: `crush`, `flavor` (cherry|lime|orange|grape), `seed`, `rot`, `still`, `mode=live`, `p` (fixed pressure).
