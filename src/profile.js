// Lathe profile of a standard 12 oz / 355 ml aluminium can, in centimetres.
// Built from line segments with filleted corners, then split into three regions:
//   0 = bottom (dome, standing bead, tapered chime)  — rigid
//   1 = straight wall between YA and YB              — where the folds happen
//   2 = shoulder, neck, double seam and lid          — rigid, rides on top of the folds

export const R = 3.302;   // body radius (66 mm diameter)
export const YA = 1.45;   // start of the foldable wall
export const YB = 10.55;  // end of the foldable wall
export const LID_W = 2.9; // half-size of the planar UV square used on the ends
export const TOP_Y = 12.2;
export const RIM_R = 2.78;

function filletPath(pts, lineStep, arcStep) {
  const out = [[pts[0][0], pts[0][1]]];
  const lineTo = (x, y) => {
    const [px, py] = out[out.length - 1];
    const L = Math.hypot(x - px, y - py);
    if (L < 1e-6) return;
    const n = Math.max(1, Math.ceil(L / lineStep));
    for (let k = 1; k <= n; k++) out.push([px + ((x - px) * k) / n, py + ((y - py) * k) / n]);
  };
  for (let i = 1; i < pts.length; i++) {
    const [x, y, rad = 0] = pts[i];
    if (i === pts.length - 1 || rad <= 0) { lineTo(x, y); continue; }
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i + 1];
    let v1x = ax - x, v1y = ay - y; const l1 = Math.hypot(v1x, v1y); v1x /= l1; v1y /= l1;
    let v2x = bx - x, v2y = by - y; const l2 = Math.hypot(v2x, v2y); v2x /= l2; v2y /= l2;
    const ang = Math.acos(Math.max(-1, Math.min(1, v1x * v2x + v1y * v2y)));
    if (ang > Math.PI - 0.01) { lineTo(x, y); continue; }
    let t = rad / Math.tan(ang / 2);
    const tMax = Math.min(l1, l2) * 0.49;
    let r = rad;
    if (t > tMax) { t = tMax; r = t * Math.tan(ang / 2); }
    const t1x = x + v1x * t, t1y = y + v1y * t, t2x = x + v2x * t, t2y = y + v2y * t;
    let bx2 = v1x + v2x, by2 = v1y + v2y; const bl = Math.hypot(bx2, by2); bx2 /= bl; by2 /= bl;
    const cd = r / Math.sin(ang / 2);
    const cx = x + bx2 * cd, cy = y + by2 * cd;
    lineTo(t1x, t1y);
    const a1 = Math.atan2(t1y - cy, t1x - cx);
    let da = Math.atan2(t2y - cy, t2x - cx) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(da) / arcStep));
    for (let k = 1; k <= n; k++) {
      const a = a1 + (da * k) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

export function buildProfile() {
  // ---- bottom: spherical dome → standing bead → tapered chime → into the wall
  const Rd = 4.53, c = 1.02 - Rd;
  const bottomPts = [];
  for (let r = 0; r < 2.2; r += 0.11) bottomPts.push([r, c + Math.sqrt(Rd * Rd - r * r), 0]);
  bottomPts.push(
    [2.22, c + Math.sqrt(Rd * Rd - 2.22 * 2.22), 0.15],
    [2.46, 0.0, 0.08],
    [2.6, 0.0, 0.08],
    [3.06, 0.52, 0.45],
    [R, 1.15, 0.5],
    [R, YA, 0],
  );
  const bottom = filletPath(bottomPts, 0.07, 0.14);

  // ---- top: shoulder → neck → double seam → countersink → lid panel → centre
  const topPts = [
    [R, YB, 0],
    [R, 10.85, 0.6],
    [2.74, 11.7, 0.4],
    [2.74, 11.84, 0.02],
    [2.8, 11.88, 0.02],
    [2.8, 12.13, 0.05],
    [2.74, 12.2, 0.04],
    [2.65, 12.18, 0.04],
    [2.62, 11.95, 0.04],
    [2.54, 11.62, 0.04],
    [2.48, 11.56, 0.035],
    [2.43, 11.66, 0.05],
    [2.3, 11.8, 0.1],
    [1.6, 11.84, 0.4],
    [0.0, 11.87, 0],
  ];
  const top = filletPath(topPts, 0.07, 0.14);

  // ---- assemble rings
  const rings = [];
  for (let k = 0; k < bottom.length - 1; k++) rings.push({ r: bottom[k][0], y: bottom[k][1], region: 0 });
  const wallStep = 0.028;
  const nWall = Math.round((YB - YA) / wallStep);
  const wallStart = rings.length;
  for (let k = 0; k <= nWall; k++) rings.push({ r: R, y: YA + ((YB - YA) * k) / nWall, region: 1 });
  const wallEnd = rings.length - 1;
  for (let k = 1; k < top.length; k++) rings.push({ r: top[k][0], y: top[k][1], region: 2 });

  // material groups: 0 = bottom metal, 1 = printed label, 2 = lid metal
  let labelStart = rings.findIndex((g) => g.r >= 2.62);
  let labelEnd = rings.findIndex((g, i) => i > wallEnd && g.y >= 11.84);
  const out = [];
  rings.forEach((g, i) => {
    if (i === labelStart) out.push({ ...g, group: 0, dup: true }); // duplicate seam ring for UV split
    if (i === labelEnd) out.push({ ...g, group: 1, dup: true });
    out.push({ ...g, group: i < labelStart ? 0 : i < labelEnd ? 1 : 2 });
  });
  const labelY0 = rings[labelStart].y;
  const labelY1 = rings[labelEnd].y;
  return { rings: out, labelY0, labelY1 };
}
