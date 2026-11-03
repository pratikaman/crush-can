import * as THREE from 'three';
import { buildProfile, R, YA, YB, LID_W, TOP_Y, RIM_R } from './profile.js';

const TAU = Math.PI * 2;
const K = 0.86;          // how far a fold can flatten (fraction of its length)
const OVERLAP = 0.8;     // next fold starts when the previous is 80 % done
const BULGE = 0.34;      // outward puff of a collapsing row
const NOISE_AMP = 0.045; // crumple noise, cm

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

// Smooth periodic value noise on (θ, s) for the crumple field.
function makeNoise(rand) {
  const waves = [];
  for (let k = 0; k < 14; k++) {
    const m = 2 + Math.floor(rand() * (k < 6 ? 9 : 26));        // circumferential frequency (integer → seamless)
    const f = (k < 6 ? 1.2 : 4.5) + rand() * (k < 6 ? 2.5 : 7); // axial frequency, rad/cm
    waves.push({ m, f, p: rand() * TAU, q: rand() * TAU, a: k < 6 ? 1 : 0.45 });
  }
  return (theta, s) => {
    let v = 0;
    for (const w of waves) v += w.a * Math.sin(w.m * theta + w.p) * Math.sin(w.f * s + w.q);
    return v / 4.2;
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
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-4.5, -0.5, -4.5), new THREE.Vector3(4.5, 12.6, 4.5));
    this.geometry = geo;

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

  // Lay out a fresh, randomised fold pattern for a new can.
  newCan(seed) {
    const rand = rng(seed * 9301 + 49297);
    this.seed = seed;
    const L = YB - YA;
    const F = rand() < 0.5 ? 5 : 6;
    const N = rand() < 0.65 ? 5 : 4;
    this.F = F; this.N = N;
    let lam = [];
    for (let i = 0; i < F; i++) lam.push(1 + (rand() - 0.5) * 0.3);
    const sum = lam.reduce((a, b) => a + b, 0);
    lam = lam.map((x) => (x / sum) * L);
    this.lam = lam;
    const sb = [0];
    for (let i = 0; i < F; i++) sb.push(sb[i] + lam[i]);
    this.sb = sb;

    // collapse order: one end first, folds propagating along the can
    let order = [...Array(F).keys()];
    if (rand() < 0.62) order.reverse();
    for (let k = 0; k < F - 1; k++) if (rand() < 0.22) [order[k], order[k + 1]] = [order[k + 1], order[k]];
    this.order = order;
    this.caps = lam.map((l) => l * K);
    let start = 0;
    this.starts = new Array(F);
    for (let m = 0; m < F; m++) { this.starts[order[m]] = start; start += this.caps[order[m]] * (m < F - 1 ? OVERLAP : 1); }
    this.Dmax = start;

    this.tiltFrac = lam.map(() => rand() * 0.13 - 0.03);
    this.bulgeK = lam.map(() => 0.6 + rand() * 0.7);
    // lobed, irregular outward lip per row so flattened folds are not perfect discs
    this.lip = new Float32Array(F * (this.S + 1));
    for (let i = 0; i < F; i++) {
      const p2 = rand() * TAU, p3 = rand() * TAU, p5 = rand() * TAU, a2 = 0.3 + rand() * 0.35, a3 = 0.2 + rand() * 0.3;
      for (let c = 0; c <= this.S; c++) {
        const th = (c / this.S) * TAU;
        this.lip[i * (this.S + 1) + c] = 1 + a2 * Math.sin(2 * th + p2) + a3 * Math.sin(3 * th + p3) + 0.18 * Math.sin(7 * th + p5);
      }
    }
    this.beta = rand() * TAU;
    this.psi0 = rand() * TAU;
    const nb = (F + 1) * N;
    this.jT = new Float32Array(nb); this.jR = new Float32Array(nb); this.jY = new Float32Array(nb);
    for (let k = 0; k < nb; k++) {
      this.jT[k] = (rand() - 0.5) * 0.34 * (Math.PI / N);
      this.jR[k] = (rand() - 0.5) * 0.09;
      this.jY[k] = (rand() - 0.5) * 0.22;
    }
    // ring → (row, u)
    const { wallStart, wallEnd, rings } = this;
    this.ringRow = new Int16Array(rings.length).fill(-1);
    this.ringU = new Float32Array(rings.length);
    for (let j = wallStart; j <= wallEnd; j++) {
      const s = rings[j].y - YA;
      let i = 0;
      while (i < F - 1 && s >= sb[i + 1]) i++;
      this.ringRow[j] = i;
      this.ringU[j] = Math.min(1, Math.max(0, (s - sb[i]) / lam[i]));
    }
    // crumple field
    const noise = makeNoise(rand);
    const cols = this.cols;
    this.noise = new Float32Array((wallEnd - wallStart + 1) * cols);
    for (let j = wallStart; j <= wallEnd; j++) {
      const s = rings[j].y - YA;
      for (let i = 0; i < cols; i++) this.noise[(j - wallStart) * cols + i] = noise((i / this.S) * TAU, s);
    }
    this.a = new Float32Array(F);
    this.bx = new Float32Array(nb); this.by = new Float32Array(nb); this.bz = new Float32Array(nb);
    this.D = -1;
    this.update(0);
  }

  // D = axial crush displacement in cm (0 … Dmax)
  update(D) {
    D = Math.max(0, Math.min(this.Dmax, D));
    if (Math.abs(D - this.D) < 1e-5) return false;
    this.D = D;
    const { F, N, lam, a, S, cols, rings, wallStart, wallEnd, pos, rest, fold } = this;
    for (let i = 0; i < F; i++) a[i] = Math.min(1, Math.max(0, (D - this.starts[i]) / this.caps[i]));

    const h = new Float32Array(F), w = new Float32Array(F), bul = new Float32Array(F);
    const Yb = new Float32Array(F + 1), Tb = new Float32Array(F + 1), al = new Float32Array(F + 1), wB = new Float32Array(F + 1);
    Yb[0] = YA;
    for (let i = 0; i < F; i++) {
      h[i] = lam[i] * (1 - K * a[i]);
      Yb[i + 1] = Yb[i] + h[i];
      Tb[i + 1] = Tb[i] + this.tiltFrac[i] * lam[i] * a[i];
      w[i] = sstep(0, 0.32, a[i]);
      const c = 1 - K * a[i];
      bul[i] = BULGE * this.bulgeK[i] * (lam[i] / 2) * Math.sqrt(Math.max(0, 1 - c * c));
    }
    for (let b = 1; b < F; b++) { al[b] = Math.max(a[b - 1], a[b]); wB[b] = sstep(0, 0.32, al[b]); }

    const beta = this.beta, psi0 = this.psi0;
    const expand = (Math.PI / N) / Math.sin(Math.PI / N);
    const { bx, by, bz, jT, jR, jY } = this;
    for (let b = 0; b <= F; b++) {
      for (let k = 0; k < N; k++) {
        const q = b * N + k;
        const th = psi0 + (b * Math.PI) / N + (k * TAU) / N + jT[q] * al[b];
        const r = R * (1 + (expand - 1 + jR[q]) * al[b]);
        bx[q] = r * Math.cos(th);
        bz[q] = -r * Math.sin(th);
        by[q] = Yb[b] + Tb[b] * Math.cos(th - beta) + jY[q] * al[b];
      }
    }

    const sector = TAU / N;
    const arcLen = (TAU * R) / N;
    const cosB = Math.cos(beta), sinB = Math.sin(beta);
    for (let j = wallStart; j <= wallEnd; j++) {
      const row = this.ringRow[j], u = this.ringU[j];
      const taper = row === 0 ? sstep(0, 0.45, u) : row === F - 1 ? sstep(0, 0.45, 1 - u) : 1;
      const W = Math.max(w[row], wB[row] * (1 - u) + wB[row + 1] * u) * taper;
      const push = bul[row] * Math.sin(Math.PI * u) * (row === 0 || row === F - 1 ? 0.3 + 0.5 * taper : 1);
      const lipOff = row * cols;
      const crumple = NOISE_AMP * (0.7 + 1.8 * a[row] * a[row]);
      const y0 = Yb[row], y1 = Yb[row + 1], t0 = Tb[row], t1 = Tb[row + 1];
      const psiL = psi0 + (row * Math.PI) / N;
      const lowB = row * N, upB = (row + 1) * N;
      const valley = W * Math.exp(-Math.pow((Math.min(u, 1 - u) * lam[row]) / 0.2, 2));
      const nOff = (j - wallStart) * cols;
      for (let i = 0; i < S; i++) {
        const c = this.cos[i], s = this.sin[i];
        const ct = c * cosB + s * sinB; // cos(θ - β)
        let px = R * c, pz = -R * s;
        let py = y0 + t0 * ct + u * (y1 + t1 * ct - y0 - t0 * ct);
        let ridge = 0;
        if (W > 1e-4) {
          const theta = (i / S) * TAU;
          let t = (theta - psiL) / sector;
          const jj = Math.floor(t);
          const f = t - jj;
          const k0 = ((jj % N) + N) % N, k1 = (k0 + 1) % N, km = (k0 + N - 1) % N;
          let fx, fy, fz;
          const hu = 0.5 * u;
          if (f >= hu && f <= 1 - hu) {
            const g = u < 0.999 ? (f - hu) / (1 - u) : 0.5;
            const wa0 = (1 - u) * (1 - g), wa1 = (1 - u) * g;
            const A0 = lowB + k0, A1 = lowB + k1, B0 = upB + k0;
            fx = wa0 * bx[A0] + wa1 * bx[A1] + u * bx[B0];
            fy = wa0 * by[A0] + wa1 * by[A1] + u * by[B0];
            fz = wa0 * bz[A0] + wa1 * bz[A1] + u * bz[B0];
          } else if (f < hu) {
            const A0 = lowB + k0, B0 = upB + k0, Bm = upB + km;
            const w0 = f + hu, wm = hu - f, wa = 1 - u;
            fx = wa * bx[A0] + w0 * bx[B0] + wm * bx[Bm];
            fy = wa * by[A0] + w0 * by[B0] + wm * by[Bm];
            fz = wa * bz[A0] + w0 * bz[B0] + wm * bz[Bm];
          } else {
            const A1 = lowB + k1, B0 = upB + k0, B1 = upB + k1;
            const w0 = 1 + hu - f, w1 = f - 1 + hu, wa = 1 - u;
            fx = wa * bx[A1] + w0 * bx[B0] + w1 * bx[B1];
            fy = wa * by[A1] + w0 * by[B0] + w1 * by[B1];
            fz = wa * bz[A1] + w0 * bz[B0] + w1 * bz[B1];
          }
          px += (fx - px) * W; py += (fy - py) * W; pz += (fz - pz) * W;
          const dd = Math.min(Math.abs(f - hu), Math.abs(f - 1 + hu), Math.abs(f + hu), Math.abs(f - 1 - hu)) * arcLen;
          ridge = W * Math.exp(-Math.pow(dd / 0.13, 2));
        }
        const rad = push * this.lip[lipOff + i] + this.noise[nOff + i] * crumple * W;
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
    this.computeNormals(pos, nrm, wallStart, wallEnd + 1);
    this.topY = Yb[F] + (TOP_Y - YB) * Math.cos(gamma) + RIM_R * Math.abs(Math.sin(gamma));
    this.crush = D / this.Dmax;
    this.collapse = a.reduce((x, y) => x + y, 0);

    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.foldAttr.needsUpdate = true;
    return true;
  }
}
