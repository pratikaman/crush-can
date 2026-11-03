import * as THREE from 'three';
import { buildProfile, R, YA, YB, LID_W, TOP_Y, RIM_R } from './profile.js';

const TAU = Math.PI * 2;
const K = 0.86;          // how far a fold can flatten (fraction of its length)
const BULGE = 0.46;      // outward flap of a collapsing row
const NOISE_AMP = 0.065; // crumple wrinkles, cm
const PILLOW = 0.11;     // facets bow in/out instead of staying flat, cm
const OVAL = 0.05;       // rim/shoulder ovalisation at full crush

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Ridged value noise, periodic around the can: sharp, branching crease networks
// (crumpled-foil look) instead of smooth bumps. Cells are wider than tall, so the
// wrinkles run roughly across the compression direction like they do in real metal.
function makeRidged(rand, L) {
  const oct = [
    { gx: 13, cell: 0.62, amp: 0.65 },
    { gx: 29, cell: 0.27, amp: 0.35 },
    { gx: 57, cell: 0.13, amp: 0.2 },
  ].map((o) => {
    const gy = Math.ceil(L / o.cell) + 2;
    const v = new Float32Array(o.gx * gy);
    for (let k = 0; k < v.length; k++) v[k] = rand() * 2 - 1;
    return { ...o, gy, v };
  });
  const sm = (t) => t * t * (3 - 2 * t);
  return (theta, s) => {
    let out = 0;
    for (const o of oct) {
      const x = (theta / TAU) * o.gx, y = s / o.cell;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = sm(x - x0), fy = sm(y - y0);
      const xa = ((x0 % o.gx) + o.gx) % o.gx, xb = (xa + 1) % o.gx;
      const ya = Math.min(o.gy - 1, y0), yb = Math.min(o.gy - 1, y0 + 1);
      const n = (o.v[ya * o.gx + xa] * (1 - fx) + o.v[ya * o.gx + xb] * fx) * (1 - fy) + (o.v[yb * o.gx + xa] * (1 - fx) + o.v[yb * o.gx + xb] * fx) * fy;
      const r = 1 - Math.abs(n);
      out += o.amp * (r * r - 0.45);
    }
    return out;
  };
}

export class CanBody {
  constructor(S = 256) {
    const prof = buildProfile();
    this.labelY0 = prof.labelY0;
    this.labelY1 = prof.labelY1;
    const rings = prof.rings;
    this.rings = rings;
    this.S = S;
    const J = rings.length;
    this.J = J;
    const cols = S + 1;
    this.cols = cols;
    const nV = J * cols;

    this.wallStart = rings.findIndex((g) => g.region === 1);
    this.wallEnd = rings.length - 1 - [...rings].reverse().findIndex((g) => g.region === 1);

    this.cos = new Float32Array(cols);
    this.sin = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      const t = (i / S) * TAU;
      this.cos[i] = Math.cos(t);
      this.sin[i] = Math.sin(t);
    }

    const rest = new Float32Array(nV * 3);
    const uv = new Float32Array(nV * 2);
    const ly = (y) => (y - this.labelY0) / (this.labelY1 - this.labelY0);
    for (let j = 0; j < J; j++) {
      const g = rings[j];
      for (let i = 0; i < cols; i++) {
        const v = j * cols + i;
        const x = g.r * this.cos[i], z = -g.r * this.sin[i];
        rest[v * 3] = x; rest[v * 3 + 1] = g.y; rest[v * 3 + 2] = z;
        if (g.group === 1) { uv[v * 2] = i / S; uv[v * 2 + 1] = ly(g.y); }
        else { uv[v * 2] = 0.5 + x / (2 * LID_W); uv[v * 2 + 1] = 0.5 - z / (2 * LID_W); }
      }
    }
    this.rest = rest;
    this.pos = new Float32Array(rest);
    this.nrm = new Float32Array(nV * 3);
    this.fold = new Float32Array(nV * 2);
    this.computeNormals(this.pos, this.nrm, 0, J - 1);
    this.restNrm = new Float32Array(this.nrm);

    // how much each wall/top vertex takes part in the rim ovalisation (inner lid panel stays round for the tab)
    const j0 = this.wallStart;
    this.ovalW = new Float32Array((J - j0) * cols);
    for (let j = j0; j < J; j++) {
      const g = rings[j];
      const w = sstep(YA, YB + 0.6, g.y) * sstep(1.9, 2.6, g.r);
      for (let i = 0; i < cols; i++) this.ovalW[(j - j0) * cols + i] = w;
    }

    // indices + groups
    const idx = [];
    const groups = [];
    let cur = null;
    for (let j = 0; j < J - 1; j++) {
      const g0 = rings[j].group, g1 = rings[j + 1].group;
      if (g0 !== g1) continue; // degenerate strip between duplicated seam rings
      if (!cur || cur.mat !== g0) { cur = { start: idx.length, count: 0, mat: g0 }; groups.push(cur); }
      for (let i = 0; i < S; i++) {
        const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, b, c, b, d, c);
        cur.count += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(nV > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.foldAttr = new THREE.BufferAttribute(this.fold, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aFold', this.foldAttr);
    for (const g of groups) geo.addGroup(g.start, g.count, g.mat);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), 9.5);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-5, -0.5, -5), new THREE.Vector3(5, 12.6, 5));
    this.geometry = geo;

    const nW = (this.wallEnd - this.wallStart + 1) * cols;
    this.vRow = new Uint8Array(nW);
    this.vU = new Float32Array(nW);
    this.vTaper = new Float32Array(nW);
    this.vI = new Uint16Array(nW * 3);
    this.vW = new Float32Array(nW * 3);
    this.vWarp = new Float32Array(nW);
    this.vPush = new Float32Array(nW);
    this.vNoise = new Float32Array(nW);
    this.vBub = new Float32Array(nW);
    this.vValley = new Float32Array(nW);
    this.vRidge = new Float32Array(nW);
    this.vDentI = new Int8Array(nW * 2);
    this.vDentW = new Float32Array(nW * 2);

    this.topMatrix = new THREE.Matrix4();
    this.topRot = new THREE.Matrix3();
    this.topY = TOP_Y;
    this.D = 0;
    this.newCan(1);
  }

  computeNormals(P, out, j0, j1) {
    const { S, cols, J, rings } = this;
    for (let j = j0; j <= j1; j++) {
      const jd = Math.max(0, j - 1), ju = Math.min(J - 1, j + 1);
      for (let i = 0; i < S; i++) {
        const il = (i - 1 + S) % S, ir = (i + 1) % S;
        const vl = (j * cols + il) * 3, vr = (j * cols + ir) * 3;
        const vd = (jd * cols + i) * 3, vu = (ju * cols + i) * 3;
        const ax = P[vr] - P[vl], ay = P[vr + 1] - P[vl + 1], az = P[vr + 2] - P[vl + 2];
        const bx = P[vu] - P[vd], by = P[vu + 1] - P[vd + 1], bz = P[vu + 2] - P[vd + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        let l = Math.hypot(nx, ny, nz);
        const o = (j * cols + i) * 3;
        if (l < 1e-9) { nx = 0; ny = rings[j].region === 0 ? -1 : 1; nz = 0; l = 1; }
        out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
      }
      const a = (j * cols) * 3, b = (j * cols + S) * 3;
      out[b] = out[a]; out[b + 1] = out[a + 1]; out[b + 2] = out[a + 2];
    }
  }

  // Lay out a fresh, randomised fold structure for a new can. Everything that does not
  // depend on how far the can is crushed is baked here, per vertex.
  newCan(seed) {
    const rand = rng(seed * 9301 + 49297);
    this.seed = seed;
    const L = YB - YA;
    const F = [3, 4, 4, 5][Math.floor(rand() * 4)];
    const N = rand() < 0.6 ? 4 : 5;
    this.F = F; this.N = N;

    // uneven fold rows
    let lam = [];
    for (let i = 0; i < F; i++) lam.push(1 + (rand() - 0.5) * 0.75);
    const sum = lam.reduce((a, b) => a + b, 0);
    lam = lam.map((x) => (x / sum) * L);
    this.lam = lam;
    const sb = [0];
    for (let i = 0; i < F; i++) sb.push(sb[i] + lam[i]);
    this.sb = sb;
    const lamAvg = L / F;

    // irregular collapse schedule: rows start at uneven times and fold at uneven speeds
    let order = [...Array(F).keys()];
    const r0 = rand();
    if (r0 < 0.45) order.reverse();
    else if (r0 > 0.8) { const mid = 1 + Math.floor(rand() * (F - 2)); order = [mid, ...order.filter((x) => x !== mid)]; }
    for (let k = 0; k < F - 1; k++) if (rand() < 0.3) [order[k], order[k + 1]] = [order[k + 1], order[k]];
    this.caps = lam.map((l) => l * K);
    this.starts = new Array(F);
    this.durs = new Array(F);
    let t = 0, end = 0;
    for (let m = 0; m < F; m++) {
      const i = order[m];
      this.starts[i] = t;
      this.durs[i] = this.caps[i] * (1 + rand() * 0.7);
      end = Math.max(end, t + this.durs[i]);
      t += this.caps[i] * (0.4 + rand() * 0.5);
    }
    this.Dmax = end;

    // asymmetry: the can leans, and folds go deeper on one side than the other
    this.beta = rand() * TAU;
    this.tiltFrac = lam.map(() => rand() * 0.16 - 0.03);
    this.kap = new Float32Array(F + 1);
    this.betaB = new Float32Array(F + 1);
    for (let b = 0; b <= F; b++) { this.kap[b] = 0.35 + rand() * 0.45; this.betaB[b] = this.beta + (rand() - 0.5) * 1.6; }
    this.bulgeK = lam.map(() => 0.55 + rand() * 0.8);
    this.ovalAxis = rand() * Math.PI;

    // fold vertices: heavily jittered so diamonds come out uneven
    this.psi0 = rand() * TAU;
    const nb = (F + 1) * N;
    this.jT = new Float32Array(nb); this.jR = new Float32Array(nb); this.jY = new Float32Array(nb);
    for (let k = 0; k < nb; k++) {
      this.jT[k] = (rand() - 0.5) * 0.9 * (Math.PI / N);
      this.jR[k] = (rand() - 0.5) * 0.26;
      this.jY[k] = (rand() - 0.5) * 0.36;
    }
    const facetRand = new Float32Array(F * N * 3);
    for (let k = 0; k < facetRand.length; k++) facetRand[k] = rand() * 2 - 1;

    // smooth warp of the fold layout: wavy, tilted fold lines and slightly bent creases
    const wp = Array.from({ length: 8 }, () => rand() * TAU);
    const wa = [0.2 + rand() * 0.14, 0.08 + rand() * 0.1, 0.04 + rand() * 0.06];
    const rowPh = lam.map(() => rand() * TAU), rowPh2 = lam.map(() => rand() * TAU), rowPh3 = lam.map(() => rand() * TAU);
    const rowK = lam.map(() => 0.45 + rand() * 0.45);
    const ridged = makeRidged(rand, L);
    // random dents that appear at different points of the crush (breaks up any leftover regularity)
    const nd = 6 + Math.floor(rand() * 4);
    this.dents = Array.from({ length: nd }, () => ({
      th: rand() * TAU, s: 0.6 + rand() * (L - 1.2), rad: 0.55 + rand() * 1.0, depth: 0.08 + rand() * 0.2,
      t0: rand() * 0.75, stretch: 0.6 + rand() * 0.9,
    }));

    const { wallStart, wallEnd, rings, cols, S } = this;
    const sector = TAU / N;
    const arcLen = (TAU * R) / N;
    for (let j = wallStart; j <= wallEnd; j++) {
      const s = rings[j].y - YA;
      const g = Math.sin((Math.PI * s) / L);
      for (let c = 0; c < S; c++) {
        const v = (j - wallStart) * cols + c;
        const th = (c / S) * TAU;
        const ws = g * lamAvg * (wa[0] * Math.sin(th + wp[0] + s * 0.35) + wa[1] * Math.sin(2 * th + wp[1] - s * 0.5) + wa[2] * Math.sin(3 * th + wp[2] + s * 0.7));
        const sp = Math.min(L, Math.max(0, s + ws));
        let row = 0;
        while (row < F - 1 && sp >= sb[row + 1]) row++;
        const u = Math.min(1, Math.max(0, (sp - sb[row]) / lam[row]));
        this.vRow[v] = row;
        this.vU[v] = u;
        this.vWarp[v] = s - sp;
        this.vTaper[v] = row === 0 && row === F - 1 ? 1 : row === 0 ? sstep(0, 0.45, u) : row === F - 1 ? sstep(0, 0.45, 1 - u) : 1;
        // pattern position (slightly bent creases)
        const thp = th + (Math.PI / N) * g * (0.2 * Math.sin(2 * th + wp[3] + s * 0.9) + 0.12 * Math.sin(5 * th + wp[4] - s * 1.7));
        const tt = (thp - (this.psi0 + (row * Math.PI) / N)) / sector;
        const jj = Math.floor(tt);
        const f = tt - jj;
        const k0 = ((jj % N) + N) % N, k1 = (k0 + 1) % N, km = (k0 + N - 1) % N;
        const lowB = row * N, upB = (row + 1) * N;
        const hu = 0.5 * u;
        let i0, i1, i2, w0, w1, w2, reg;
        if (f >= hu && f <= 1 - hu) {
          const gg = u < 0.999 ? (f - hu) / (1 - u) : 0.5;
          i0 = lowB + k0; i1 = lowB + k1; i2 = upB + k0; w0 = (1 - u) * (1 - gg); w1 = (1 - u) * gg; w2 = u; reg = 0;
        } else if (f < hu) {
          i0 = lowB + k0; i1 = upB + k0; i2 = upB + km; w0 = 1 - u; w1 = f + hu; w2 = hu - f; reg = 1;
        } else {
          i0 = lowB + k1; i1 = upB + k0; i2 = upB + k1; w0 = 1 - u; w1 = 1 + hu - f; w2 = f - 1 + hu; reg = 2;
        }
        this.vI[v * 3] = i0; this.vI[v * 3 + 1] = i1; this.vI[v * 3 + 2] = i2;
        this.vW[v * 3] = w0; this.vW[v * 3 + 1] = w1; this.vW[v * 3 + 2] = w2;
        this.vBub[v] = 27 * w0 * w1 * w2 * facetRand[(row * N + k0) * 3 + reg];
        const dd = Math.min(Math.abs(f - hu), Math.abs(f - 1 + hu), Math.abs(f + hu), Math.abs(f - 1 - hu)) * arcLen;
        this.vRidge[v] = Math.exp(-Math.pow(dd / 0.13, 2));
        this.vValley[v] = Math.exp(-Math.pow((Math.min(u, 1 - u) * lam[row]) / 0.2, 2));
        // outward flap: off-centre crease, much bigger on one side of the can
        const uc = 0.5 + 0.17 * Math.sin(th + rowPh[row]);
        const tri = u < uc ? u / uc : (1 - u) / (1 - uc);
        const prof = 0.45 * Math.sin(Math.PI * u) + 0.55 * tri;
        const lip = Math.max(0.12, 1 + rowK[row] * Math.cos(th - this.beta - 0.6 * Math.sin(rowPh3[row])) + 0.3 * Math.sin(2 * th + rowPh2[row]) + 0.13 * Math.sin(5 * th + rowPh3[row]));
        const endF = row === 0 || row === F - 1 ? 0.3 + 0.5 * this.vTaper[v] : 1;
        this.vPush[v] = prof * lip * endF;
        this.vNoise[v] = ridged(th, s);
        // two strongest dents for this vertex
        let d1 = -1, g1 = 0, d2 = -1, g2 = 0;
        this.dents.forEach((d, k) => {
          let dth = th - d.th; dth -= TAU * Math.round(dth / TAU);
          const dx = dth * R, dy = (s - d.s) * d.stretch;
          const gg = Math.exp(-(dx * dx + dy * dy) / (d.rad * d.rad));
          if (gg > g1) { d2 = d1; g2 = g1; d1 = k; g1 = gg; } else if (gg > g2) { d2 = k; g2 = gg; }
        });
        this.vDentI[v * 2] = g1 > 0.01 ? d1 : -1; this.vDentW[v * 2] = g1;
        this.vDentI[v * 2 + 1] = g2 > 0.01 ? d2 : -1; this.vDentW[v * 2 + 1] = g2;
      }
      // seam column duplicates column 0
      const a = (j - wallStart) * cols, b = a + S;
      this.vRow[b] = this.vRow[a]; this.vU[b] = this.vU[a]; this.vWarp[b] = this.vWarp[a]; this.vTaper[b] = this.vTaper[a];
      for (let q = 0; q < 3; q++) { this.vI[b * 3 + q] = this.vI[a * 3 + q]; this.vW[b * 3 + q] = this.vW[a * 3 + q]; }
      this.vBub[b] = this.vBub[a]; this.vRidge[b] = this.vRidge[a]; this.vValley[b] = this.vValley[a];
      this.vPush[b] = this.vPush[a]; this.vNoise[b] = this.vNoise[a];
      this.vDentI[b * 2] = this.vDentI[a * 2]; this.vDentI[b * 2 + 1] = this.vDentI[a * 2 + 1];
      this.vDentW[b * 2] = this.vDentW[a * 2]; this.vDentW[b * 2 + 1] = this.vDentW[a * 2 + 1];
    }

    this.a = new Float32Array(F);
    this.bx = new Float32Array(nb); this.by = new Float32Array(nb); this.bz = new Float32Array(nb);
    this.D = -1;
    this.update(0);
  }

  // D = crush progress in cm-ish units (0 … Dmax)
  update(D) {
    D = Math.max(0, Math.min(this.Dmax, D));
    if (Math.abs(D - this.D) < 1e-5) return false;
    this.D = D;
    const { F, N, lam, a, S, cols, rings, wallStart, wallEnd, pos, rest, fold } = this;
    for (let i = 0; i < F; i++) a[i] = Math.min(1, Math.max(0, (D - this.starts[i]) / this.durs[i]));

    const h = new Float32Array(F), w = new Float32Array(F), bul = new Float32Array(F), crum = new Float32Array(F);
    const Yb = new Float32Array(F + 1), Tb = new Float32Array(F + 1), al = new Float32Array(F + 1), wB = new Float32Array(F + 1), cr = new Float32Array(F + 1);
    Yb[0] = YA;
    for (let i = 0; i < F; i++) {
      h[i] = lam[i] * (1 - K * a[i]);
      Yb[i + 1] = Yb[i] + h[i];
      Tb[i + 1] = Tb[i] + this.tiltFrac[i] * lam[i] * a[i];
      w[i] = sstep(0, 0.32, a[i]);
      const c = 1 - K * a[i];
      bul[i] = BULGE * this.bulgeK[i] * (lam[i] / 2) * Math.sqrt(Math.max(0, 1 - c * c));
      crum[i] = NOISE_AMP * (0.6 + 2.2 * a[i] * a[i]);
    }
    for (let b = 1; b < F; b++) { al[b] = Math.max(a[b - 1], a[b]); wB[b] = sstep(0, 0.32, al[b]); }
    cr[0] = h[0] / lam[0]; cr[F] = h[F - 1] / lam[F - 1];
    for (let b = 1; b < F; b++) cr[b] = 0.5 * (h[b - 1] / lam[b - 1] + h[b] / lam[b]);

    const beta = this.beta, psi0 = this.psi0;
    const expand = (Math.PI / N) / Math.sin(Math.PI / N);
    const { bx, by, bz, jT, jR, jY } = this;
    for (let b = 0; b <= F; b++) {
      for (let k = 0; k < N; k++) {
        const q = b * N + k;
        const th0 = psi0 + (b * Math.PI) / N + (k * TAU) / N;
        const ab = Math.min(1, al[b] * (1 + this.kap[b] * Math.cos(th0 - this.betaB[b])));
        const th = th0 + jT[q] * ab;
        const r = R * (1 + (expand - 1 + jR[q]) * ab);
        bx[q] = r * Math.cos(th);
        bz[q] = -r * Math.sin(th);
        by[q] = Yb[b] + Tb[b] * Math.cos(th - beta) + jY[q] * ab;
      }
    }

    const crush = D / this.Dmax;
    const dentD = this.dents.map((d) => d.depth * sstep(d.t0, d.t0 + 0.3, crush));
    const { vDentI, vDentW } = this;
    const cosB = Math.cos(beta), sinB = Math.sin(beta);
    const { vRow, vU, vTaper, vI, vW, vWarp, vPush, vNoise, vBub, vValley, vRidge } = this;
    for (let j = wallStart; j <= wallEnd; j++) {
      for (let i = 0; i < S; i++) {
        const v = (j - wallStart) * cols + i;
        const row = vRow[v], u = vU[v];
        const W = Math.max(w[row], wB[row] * (1 - u) + wB[row + 1] * u) * vTaper[v];
        const c = this.cos[i], s = this.sin[i];
        const ct = c * cosB + s * sinB; // cos(θ − β)
        let px = R * c, pz = -R * s;
        let py = Yb[row] + u * h[row] + vWarp[v] * (cr[row] * (1 - u) + cr[row + 1] * u) + (Tb[row] + u * (Tb[row + 1] - Tb[row])) * ct;
        let valley = 0, ridge = 0;
        if (W > 1e-4) {
          const i0 = vI[v * 3], i1 = vI[v * 3 + 1], i2 = vI[v * 3 + 2];
          const w0 = vW[v * 3], w1 = vW[v * 3 + 1], w2 = vW[v * 3 + 2];
          const fx = w0 * bx[i0] + w1 * bx[i1] + w2 * bx[i2];
          const fy = w0 * by[i0] + w1 * by[i1] + w2 * by[i2];
          const fz = w0 * bz[i0] + w1 * bz[i1] + w2 * bz[i2];
          px += (fx - px) * W; py += (fy - py) * W; pz += (fz - pz) * W;
          valley = vValley[v] * W; ridge = vRidge[v] * W;
        }
        const di0 = vDentI[v * 2], di1 = vDentI[v * 2 + 1];
        const dent = (di0 >= 0 ? dentD[di0] * vDentW[v * 2] : 0) + (di1 >= 0 ? dentD[di1] * vDentW[v * 2 + 1] : 0);
        const crease = valley + ridge;
        const rad = bul[row] * vPush[v] + vNoise[v] * crum[row] * (W * (0.5 + 1.6 * crease) + 0.25 * crush) + vBub[v] * PILLOW * W - dent;
        // paint cracks only in patches along the creases, not as clean lines
        ridge *= Math.min(1, Math.max(0, 0.45 + vNoise[v] * 2.2));
        px += c * rad; pz -= s * rad;
        const o = (j * cols + i) * 3;
        pos[o] = px; pos[o + 1] = py; pos[o + 2] = pz;
        const fo = (j * cols + i) * 2;
        fold[fo] = valley; fold[fo + 1] = ridge;
      }
      const a0 = (j * cols) * 3, b0 = (j * cols + S) * 3;
      pos[b0] = pos[a0]; pos[b0 + 1] = pos[a0 + 1]; pos[b0 + 2] = pos[a0 + 2];
      fold[(j * cols + S) * 2] = fold[j * cols * 2]; fold[(j * cols + S) * 2 + 1] = fold[j * cols * 2 + 1];
    }

    // rigid top: rotate (tilt) + translate down onto the folded wall
    const T = Tb[F];
    const gamma = Math.asin(Math.max(-0.3, Math.min(0.3, T / R)));
    const dir = new THREE.Vector3(Math.cos(beta), 0, -Math.sin(beta));
    const axis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const M = this.topMatrix;
    M.makeTranslation(0, Yb[F], 0)
      .multiply(new THREE.Matrix4().makeRotationAxis(axis, gamma))
      .multiply(new THREE.Matrix4().makeTranslation(0, -YB, 0));
    this.topRot.setFromMatrix4(M);
    const e = M.elements, rn = this.topRot.elements, nrm = this.nrm, rnm = this.restNrm;
    for (let j = wallEnd + 1; j < rings.length; j++) {
      for (let i = 0; i < cols; i++) {
        const o = (j * cols + i) * 3;
        const x = rest[o], y = rest[o + 1], z = rest[o + 2];
        pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const nx = rnm[o], ny = rnm[o + 1], nz = rnm[o + 2];
        nrm[o] = rn[0] * nx + rn[3] * ny + rn[6] * nz;
        nrm[o + 1] = rn[1] * nx + rn[4] * ny + rn[7] * nz;
        nrm[o + 2] = rn[2] * nx + rn[5] * ny + rn[8] * nz;
      }
    }

    // the crushed body squashes out of round (the rim goes slightly oval, like real crushed cans)
    const eps = OVAL * Math.pow(crush, 1.3);
    if (eps > 1e-5) {
      const ca = Math.cos(this.ovalAxis), sa = Math.sin(this.ovalAxis);
      const ov = this.ovalW;
      for (let j = wallStart; j < rings.length; j++) {
        for (let i = 0; i < cols; i++) {
          const f = eps * ov[(j - wallStart) * cols + i];
          if (f === 0) continue;
          const o = (j * cols + i) * 3;
          const x = pos[o], z = pos[o + 2];
          const p = (x * ca + z * sa) * (1 + f), q = (-x * sa + z * ca) * (1 - f);
          pos[o] = p * ca - q * sa; pos[o + 2] = p * sa + q * ca;
        }
      }
    }

    this.computeNormals(pos, nrm, wallStart, wallEnd + 1);
    this.topY = Yb[F] + (TOP_Y - YB) * Math.cos(gamma) + RIM_R * Math.abs(Math.sin(gamma));
    this.crush = crush;
    this.collapse = a.reduce((x, y) => x + y, 0);

    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.foldAttr.needsUpdate = true;
    return true;
  }
}
