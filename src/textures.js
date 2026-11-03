import * as THREE from 'three';
import { LID_W } from './profile.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Draws every shape twice: once into the colour map, once into a
// roughness(G)/metalness(B) map, so ink and bare aluminium stay registered.
class Painter {
  constructor(W, H, mrScale = 0.5) {
    this.W = W; this.H = H;
    this.colorCanvas = canvas(W, H);
    this.mrCanvas = canvas(W * mrScale, H * mrScale);
    this.c = this.colorCanvas.getContext('2d');
    this.m = this.mrCanvas.getContext('2d');
    this.m.scale(mrScale, mrScale);
  }
  ink(ink) {
    this.c.fillStyle = this.c.strokeStyle = ink.color;
    const s = `rgb(0,${Math.round(ink.rough * 255)},${Math.round(ink.metal * 255)})`;
    this.m.fillStyle = this.m.strokeStyle = s;
    return this;
  }
  both(fn) { fn(this.c); fn(this.m); }
  save() { this.c.save(); this.m.save(); }
  restore() { this.c.restore(); this.m.restore(); }
  translate(x, y) { this.c.translate(x, y); this.m.translate(x, y); }
  rotate(a) { this.c.rotate(a); this.m.rotate(a); }
  rect(x, y, w, h) { this.both((g) => g.fillRect(x, y, w, h)); }
  circle(x, y, r, stroke = 0) {
    this.both((g) => {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      if (stroke) { g.lineWidth = stroke; g.stroke(); } else g.fill();
    });
  }
  text(str, x, y, font, { align = 'center', base = 'middle', spacing = 0, stroke = 0 } = {}) {
    this.both((g) => {
      g.font = font; g.textBaseline = base;
      if (!spacing) {
        g.textAlign = align;
        if (stroke) { g.lineWidth = stroke; g.lineJoin = 'round'; g.strokeText(str, x, y); } else g.fillText(str, x, y);
        return;
      }
      g.textAlign = 'left';
      const widths = [...str].map((ch) => g.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + spacing * (str.length - 1);
      let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
      [...str].forEach((ch, i) => { g.fillText(ch, cx, y); cx += widths[i] + spacing; });
    });
  }
  // draw fn at x-offsets -W, 0, +W so anything crossing the back seam wraps cleanly
  wrap(fn) { for (const dx of [-this.W, 0, this.W]) { this.save(); this.translate(dx, 0); fn(); this.restore(); } }
}

function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

export function makeLabel(fl, Y0, Y1, renderer) {
  const W = 4096, H = 2048;
  const P = new Painter(W, H, 0.5);
  const yOf = (y) => (1 - (y - Y0) / (Y1 - Y0)) * H;
  const PRINT = { color: fl.main, metal: 0.34, rough: 0.32 };
  const CREAM = { color: fl.cream, metal: 0.0, rough: 0.4 };
  const SILVER = { color: '#d5d8dc', metal: 1, rough: 0.14 };
  const INK = { color: fl.ink, metal: 0.0, rough: 0.5 };
  const DARK = { color: fl.dark, metal: 0.3, rough: 0.34 };
  const MID = { color: fl.mid, metal: 0.34, rough: 0.32 };
  const cx = W / 2;
  const r = rnd(fl.key.length * 7919 + fl.key.charCodeAt(0));

  // base print + bare-metal chime and neck
  P.ink(PRINT).rect(0, 0, W, H);
  P.ink(SILVER).rect(0, yOf(0.95), W, H - yOf(0.95));
  P.ink(SILVER).rect(0, 0, W, yOf(10.95));
  P.ink(DARK).rect(0, yOf(10.95), W, 10);
  P.ink(DARK).rect(0, yOf(0.95) - 10, W, 10);

  // giant tonal type wrapping the back half
  P.save();
  P.translate(1180, yOf(6.0));
  P.rotate(-Math.PI / 2);
  P.ink(MID).text('crush me', 0, 0, '400 330px Shrikhand');
  P.restore();

  // bubbles: tonal ink + unprinted silver dots (they sparkle under the clear coat)
  for (let k = 0; k < 520; k++) {
    const x = r() * W, y = yOf(2.5 + 7.0 * Math.pow(r(), 1.5));
    const rad = 4 + 30 * Math.pow(r(), 2.6);
    P.c.globalAlpha = 0.4;
    P.c.fillStyle = fl.light;
    P.c.strokeStyle = fl.light;
    for (const dx of [-W, 0, W]) {
      P.c.beginPath(); P.c.arc(x + dx, y, rad, 0, Math.PI * 2);
      if (rad > 14) { P.c.lineWidth = 4; P.c.stroke(); } else P.c.fill();
    }
    P.c.globalAlpha = 1;
  }
  for (let k = 0; k < 480; k++) {
    const x = r() * W, y = yOf(2.5 + 7.0 * Math.pow(r(), 1.8));
    const rad = 3 + 22 * Math.pow(r(), 3);
    P.wrap(() => P.ink(SILVER).circle(x, y, rad, rad > 11 ? 4.5 : 0));
  }

  // hairlines + wrap band
  P.ink(CREAM).rect(0, yOf(10.25), W, 6);
  P.ink(CREAM).rect(0, yOf(10.1), W, 3);
  P.ink(CREAM).rect(0, yOf(2.32), W, yOf(1.52) - yOf(2.32));
  {
    const phrase = 'PRESS SODA CO.   ✳   CRUSH AFTER USE   ✳   ';
    P.c.font = '700 54px "Instrument Sans"';
    const pw = P.c.measureText(phrase).width + 16 * phrase.length;
    const n = Math.max(1, Math.round(W / pw));
    const step = W / n;
    P.ink({ ...PRINT, color: fl.main });
    for (let k = 0; k < n; k++) P.text(phrase.trim(), step * k + step / 2, yOf(1.92), '700 54px "Instrument Sans"', { spacing: 16 });
  }

  // ---- front panel
  P.ink(CREAM).text('SPARKLING  SODA', cx, yOf(9.2), '600 64px "Instrument Sans"', { spacing: 22 });
  P.save();
  P.translate(cx, yOf(6.95));
  P.rotate(-0.12);
  const wordFont = '400 410px Shrikhand';
  P.c.font = wordFont;
  const ww = P.c.measureText('press').width;
  const sc = Math.min(1, 1120 / ww);
  P.c.scale(sc, sc); P.m.scale(sc, sc);
  for (let d = 22; d > 0; d -= 1.5) P.ink(DARK).text('press', d * 0.8, d, wordFont);
  P.ink(CREAM).text('press', 0, 0, wordFont);
  P.restore();
  P.ink(CREAM).text(fl.line, cx, yOf(4.45), 'italic 400 205px "Instrument Serif"');
  P.ink(CREAM).rect(cx - 210, yOf(3.62), 420, 4);
  P.ink(CREAM).text('12 FL OZ  ·  355 mL', cx, yOf(3.2), '600 48px "Instrument Sans"', { spacing: 10 });

  // badge
  {
    const bx = cx + 830, by = yOf(7.7), br = 150;
    P.ink(CREAM).circle(bx, by, br, 7);
    P.ink(CREAM).circle(bx, by, br - 22, 3);
    P.ink(CREAM).text('Nº1', bx, by + 6, 'italic 400 120px "Instrument Serif"');
    const msg = 'FORCE TOUCH READY • CRUSH ME • ';
    P.both((g) => {
      g.save(); g.translate(bx, by); g.font = '700 30px "Instrument Sans"'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const n = msg.length;
      for (let k = 0; k < n; k++) {
        g.save(); g.rotate((k / n) * Math.PI * 2); g.fillText(msg[k], 0, -(br - 48)); g.restore();
      }
      g.restore();
    });
  }

  // nutrition panel
  {
    const px = 3380, pw = 540, top = yOf(9.0), bot = yOf(3.0);
    P.ink(CREAM).rect(px - pw / 2, top, pw, bot - top);
    P.ink(INK);
    const L = px - pw / 2 + 28, Rr = px + pw / 2 - 28;
    let y = top + 70;
    P.text('Nutrition Facts', L, y, '700 64px "Instrument Sans"', { align: 'left' });
    y += 62; P.text('1 serving per container', L, y, '400 32px "Instrument Sans"', { align: 'left' });
    y += 42; P.text('Serving size', L, y, '700 34px "Instrument Sans"', { align: 'left' });
    P.text('1 can (355mL)', Rr, y, '700 34px "Instrument Sans"', { align: 'right' });
    y += 34; P.rect(L, y, Rr - L, 18);
    y += 50; P.text('Calories', L, y, '700 54px "Instrument Sans"', { align: 'left' });
    P.text('140', Rr, y, '700 70px "Instrument Sans"', { align: 'right' });
    y += 46; P.rect(L, y, Rr - L, 9);
    const rows = [['Total Fat 0g', '0%'], ['Sodium 45mg', '2%'], ['Total Carbohydrate 39g', '14%'], ['Total Sugars 39g', ''], ['Incl. 39g Added Sugars', '78%'], ['Protein 0g', ''], ['Pressure tolerance', 'low']];
    for (const [a, b] of rows) {
      y += 50; P.text(a, L, y, '500 32px "Instrument Sans"', { align: 'left' });
      if (b) P.text(b, Rr, y, '700 32px "Instrument Sans"', { align: 'right' });
      y += 26; P.rect(L, y, Rr - L, 3);
    }
    y += 50; P.text('Not a significant source of', L, y, '400 26px "Instrument Sans"', { align: 'left' });
    y += 32; P.text('structural integrity.', L, y, '400 26px "Instrument Sans"', { align: 'left' });
  }

  // back seam: ingredients (wrapped across the seam)
  P.wrap(() => {
    P.ink(CREAM);
    const lines = ['INGREDIENTS: CARBONATED', 'WATER, CANE SUGAR, NATURAL', `${fl.name.toUpperCase()} FLAVOR, CITRIC`, 'ACID, A LITTLE PRESSURE.', '', 'PRESS SODA CO.', 'MADE TO BE CRUSHED', 'BY FORCE TOUCH'];
    lines.forEach((t, k) => P.text(t, 0, yOf(8.6) + k * 58, '600 40px "Instrument Sans"', { spacing: 4 }));
  });

  // barcode + recycle
  {
    const bx = 700, by = yOf(4.6), bw = 380, bh = 250;
    P.ink({ color: '#fbfaf7', metal: 0, rough: 0.45 }).rect(bx - bw / 2, by - bh / 2, bw, bh);
    P.ink(INK);
    let x = bx - bw / 2 + 30;
    while (x < bx + bw / 2 - 34) { const wv = 3 + Math.floor(r() * 4) * 3; if (r() > 0.42) P.rect(x, by - bh / 2 + 24, wv, bh - 84); x += wv + 3 + Math.floor(r() * 3) * 3; }
    P.text('0 84720 01926 3', bx, by + bh / 2 - 32, '500 34px "JetBrains Mono"');
    P.ink(CREAM).text('PLEASE RECYCLE', bx, yOf(7.3), '700 48px "Instrument Sans"', { spacing: 8 });
    P.ink(CREAM).text('crush me flat', bx, yOf(6.65), 'italic 400 96px "Instrument Serif"');
    P.ink(CREAM).circle(bx, yOf(5.95), 34, 5);
    P.ink(CREAM).text('↓', bx, yOf(5.95) + 2, '700 40px "Instrument Sans"');
  }

  const map = new THREE.CanvasTexture(P.colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mr = new THREE.CanvasTexture(P.mrCanvas);
  mr.anisotropy = 8;
  return { map, mr };
}

// ---------- lid: height field → tangent-space normal map + roughness with lathe rings
export function makeLid() {
  const N = 1024;
  const ppc = N / (2 * LID_W);
  const hc = canvas(N, N);
  const g = hc.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  g.translate(N / 2, N / 2); g.scale(ppc, ppc); // draw in cm, x right, z down (+z = toward viewer)

  // panel stiffening bead
  g.strokeStyle = '#a4a4a4'; g.lineWidth = 0.07; g.beginPath(); g.arc(0, 0, 2.13, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#9a9a9a'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, 1.98, 0, Math.PI * 2); g.stroke();

  // finger well under the tab ring (+x side)
  const fw = g.createRadialGradient(1.1, 0, 0.05, 1.1, 0, 0.85);
  fw.addColorStop(0, '#5f5f5f'); fw.addColorStop(0.7, '#727272'); fw.addColorStop(1, 'rgba(128,128,128,0)');
  g.fillStyle = fw; g.beginPath(); g.ellipse(1.1, 0, 0.85, 0.7, 0, 0, Math.PI * 2); g.fill();

  // opening (on -x side): teardrop path in (a along -x, w across)
  const opening = (s = 1, c0 = 1.25) => {
    const p = (a, w) => [-(c0 + (a - c0) * s), w * s];
    g.beginPath();
    g.moveTo(...p(0.42, 0));
    g.bezierCurveTo(...p(0.42, 0.42), ...p(0.95, 0.8), ...p(1.45, 0.84));
    g.bezierCurveTo(...p(1.95, 0.86), ...p(2.08, 0.5), ...p(2.08, 0));
    g.bezierCurveTo(...p(2.08, -0.5), ...p(1.95, -0.86), ...p(1.45, -0.84));
    g.bezierCurveTo(...p(0.95, -0.8), ...p(0.42, -0.42), ...p(0.42, 0));
    g.closePath();
  };
  g.fillStyle = '#868686'; opening(0.92); g.fill();
  g.strokeStyle = '#a8a8a8'; g.lineWidth = 0.06; opening(1.1); g.stroke();
  g.strokeStyle = '#4c4c4c'; g.lineWidth = 0.025; opening(1.0); g.stroke();

  // rivet
  const rv = g.createRadialGradient(0, 0, 0, 0, 0, 0.26);
  rv.addColorStop(0, '#d8d8d8'); rv.addColorStop(0.6, '#b4b4b4'); rv.addColorStop(1, 'rgba(128,128,128,0)');
  g.fillStyle = rv; g.beginPath(); g.arc(0, 0, 0.26, 0, Math.PI * 2); g.fill();

  // embossed text around the rim
  g.fillStyle = '#a2a2a2'; g.font = '700 0.17px "Instrument Sans"'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const arcText = (str, mid, rad) => {
    const step = 0.105 / rad;
    [...str].forEach((ch, k) => {
      const ang = mid + (k - (str.length - 1) / 2) * step;
      g.save(); g.rotate(ang); g.translate(0, -rad); g.fillText(ch, 0, 0); g.restore();
    });
  };
  arcText('PRESS SODA CO.', 0, 1.8);
  arcText('RECYCLE ME', Math.PI, 1.8);

  // read back, blur, derive normals
  const img = g.getImageData(0, 0, N, N).data;
  let hgt = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) hgt[k] = img[k * 4] / 255;
  const blur = (src, rad) => {
    const tmp = new Float32Array(N * N), dst = new Float32Array(N * N);
    const w = 2 * rad + 1;
    for (let y = 0; y < N; y++) { let acc = 0; for (let x = -rad; x <= rad; x++) acc += src[y * N + Math.min(N - 1, Math.max(0, x))]; for (let x = 0; x < N; x++) { tmp[y * N + x] = acc / w; acc += src[y * N + Math.min(N - 1, x + rad + 1)] - src[y * N + Math.max(0, x - rad)]; } }
    for (let x = 0; x < N; x++) { let acc = 0; for (let y = -rad; y <= rad; y++) acc += tmp[Math.min(N - 1, Math.max(0, y)) * N + x]; for (let y = 0; y < N; y++) { dst[y * N + x] = acc / w; acc += tmp[Math.min(N - 1, y + rad + 1) * N + x] - tmp[Math.max(0, y - rad) * N + x]; } }
    return dst;
  };
  hgt = blur(blur(hgt, 1), 1);
  const nc = canvas(N, N);
  const ng = nc.getContext('2d');
  const out = ng.createImageData(N, N);
  const strength = 7.0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(N - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(N - 1, y + 1);
    const dx = (hgt[y * N + xr] - hgt[y * N + xl]) * strength;
    const dy = (hgt[yd * N + x] - hgt[yu * N + x]) * strength;
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * N + x) * 4;
    out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  ng.putImageData(out, 0, 0);

  // roughness: concentric lathe/turning marks
  const rc = canvas(N, N);
  const rg = rc.getContext('2d');
  rg.fillStyle = 'rgb(0,66,255)'; rg.fillRect(0, 0, N, N);
  const rr = rnd(42);
  for (let rad = 1; rad < N * 0.72; rad += 1.3) {
    const v = 50 + rr() * 40;
    rg.strokeStyle = `rgba(0,${v | 0},255,0.55)`; rg.lineWidth = 1;
    rg.beginPath(); rg.arc(N / 2, N / 2, rad, 0, Math.PI * 2); rg.stroke();
  }
  const normal = new THREE.CanvasTexture(nc);
  normal.anisotropy = 8;
  const rough = new THREE.CanvasTexture(rc);
  rough.anisotropy = 8;
  return { normal, rough };
}

// fine vertical "drawn aluminium" roughness streaks for the bottom
export function makeBrushed() {
  const W = 512;
  const c = canvas(W, W);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(0,70,255)'; g.fillRect(0, 0, W, W);
  const r = rnd(7);
  for (let k = 0; k < 900; k++) {
    const v = 45 + r() * 50;
    g.strokeStyle = `rgba(0,${v | 0},255,0.5)`;
    g.beginPath(); const rad = r() * W * 0.7; g.arc(W / 2, W / 2, rad, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
