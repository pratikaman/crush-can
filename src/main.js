import * as THREE from 'three';
import { CanBody } from './can.js';
import { makeLabel, makeLid, makeBrushed } from './textures.js';
import { makeStudioEnv } from './env.js';
import { ContactShadow } from './shadow.js';
import { Crunch } from './audio.js';
import { PressureInput, FULL_FORCE_SPAN } from './input.js';
import { FLAVORS } from './flavors.js';
import { TOP_Y } from './profile.js';

const qs = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const FORCE_CLICK_P = 1 / FULL_FORCE_SPAN; // pressure at webkitForce = 2 (force click)

async function boot() {
  await Promise.all(
    ['400 100px Shrikhand', 'italic 400 100px "Instrument Serif"', '400 100px "Instrument Serif"', '600 100px "Instrument Sans"', '700 100px "Instrument Sans"', '500 100px "JetBrains Mono"']
      .map((f) => document.fonts.load(f).catch(() => {})),
  );

  // ---------- renderer / scene
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: qs.has('shot') });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 400);
  scene.environmentIntensity = 1.2;
  const key = new THREE.DirectionalLight('#fff4e8', 1.5);
  key.position.set(-7, 11, 9);
  scene.add(key);

  // ---------- can
  const body = new CanBody(qs.get('seg') ? +qs.get('seg') : 256);
  const brushed = makeBrushed();
  const lid = makeLid();
  const bottomMat = new THREE.MeshPhysicalMaterial({ color: '#cfd3d7', metalness: 1, roughness: 1, roughnessMap: brushed });
  const lidMat = new THREE.MeshPhysicalMaterial({
    color: '#d6d9dd', metalness: 1, roughness: 1, roughnessMap: lid.rough, normalMap: lid.normal, normalScale: new THREE.Vector2(1, 1),
  });
  const labelMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 1, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.07 });
  labelMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFold;\nvarying vec2 vFold;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFold = aFold;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFold;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // paint stretched over a ridge cracks and shows the aluminium; valleys are shadowed
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.83, 0.85), clamp(vFold.y, 0.0, 1.0) * 0.5);
        diffuseColor.rgb *= 1.0 - clamp(vFold.x, 0.0, 1.0) * 0.3;`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, clamp(vFold.y,0.0,1.0) * 0.55);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, clamp(vFold.y,0.0,1.0) * 0.5);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float occ = 1.0 - clamp(vFold.x, 0.0, 1.0) * 0.7;
          reflectedLight.indirectDiffuse *= occ; reflectedLight.indirectSpecular *= occ;
          #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= occ;
          #endif
        }`);
  };
  const canMesh = new THREE.Mesh(body.geometry, [bottomMat, labelMat, lidMat]);

  // pull tab (anodised, flavour-tinted) + rivet, carried by the lid's rigid transform
  const tabMat = new THREE.MeshPhysicalMaterial({ color: '#c8414f', metalness: 1, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  const tabGroup = new THREE.Group();
  tabGroup.matrixAutoUpdate = false;
  {
    const s = new THREE.Shape();
    s.moveTo(-0.15, 0.42);
    s.absarc(-0.15, 0, 0.42, Math.PI / 2, (3 * Math.PI) / 2, false); // rounded nose toward -x (over the opening)
    s.lineTo(0.8, -0.58);
    const a0 = Math.atan2(-0.58, 0.8 - 1.07);
    s.absarc(1.07, 0, 0.62, a0, -a0, false);
    s.lineTo(-0.15, 0.42);
    const hole = new THREE.Path();
    hole.absellipse(1.1, 0, 0.4, 0.37, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const slot = new THREE.Path();
    slot.absarc(0, 0, 0.27, -2.1, 2.1, false);
    slot.absarc(0, 0, 0.21, 2.1, -2.1, true);
    s.holes.push(slot);
    const tg = new THREE.ExtrudeGeometry(s, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 3, curveSegments: 64 });
    tg.rotateX(-Math.PI / 2);
    const tab = new THREE.Mesh(tg, tabMat);
    tab.position.set(0, 11.885, 0);
    tab.rotation.z = -0.025;
    tabGroup.add(tab);
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
    rivet.scale.y = 0.45;
    rivet.position.set(0, 11.94, 0);
    tabGroup.add(rivet);
  }
  const canGroup = new THREE.Group();
  canGroup.add(canMesh, tabGroup);
  const canRoot = new THREE.Group();
  canRoot.add(canGroup);
  scene.add(canRoot);

  // ---------- hydraulic press head
  const press = new THREE.Group();
  {
    const steel = new THREE.MeshPhysicalMaterial({ color: '#a7adb4', metalness: 1, roughness: 1, roughnessMap: brushed });
    const chrome = new THREE.MeshPhysicalMaterial({ color: '#eceef1', metalness: 1, roughness: 0.07 });
    const prof = [
      [0, 0], [4.25, 0], [4.42, 0.05], [4.5, 0.17], [4.5, 1.15], [4.42, 1.3], [4.25, 1.36], [1.9, 1.36], [1.75, 1.5], [1.75, 2.1], [1.6, 2.2], [0, 2.2],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const plate = new THREE.Mesh(new THREE.LatheGeometry(prof, 128), steel);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 70, 96, 1, true), chrome);
    rod.position.y = 2.2 + 35;
    press.add(plate, rod);
  }
  scene.add(press);

  // ---------- shadow
  const shadow = new ContactShadow(renderer, { size: 24, res: 512, height: 13, darkness: 1.5, blur: 2.4, opacity: 0.85 });
  shadow.group.position.y = 0.002;
  scene.add(shadow.group);

  // ---------- flavour switching
  const labelCache = {};
  const envCache = {};
  let flavor = FLAVORS[qs.get('flavor')] || FLAVORS.cherry;
  function applyFlavor(fl) {
    flavor = fl;
    if (!labelCache[fl.key]) labelCache[fl.key] = makeLabel(fl, body.labelY0, body.labelY1, renderer);
    if (!envCache[fl.key]) envCache[fl.key] = makeStudioEnv(renderer, fl.env);
    const L = labelCache[fl.key];
    labelMat.map = L.map; labelMat.roughnessMap = L.mr; labelMat.metalnessMap = L.mr;
    labelMat.needsUpdate = true;
    scene.environment = envCache[fl.key];
    tabMat.color.set(fl.tab);
    shadow.color.set(fl.bgB).multiplyScalar(0.25);
    const root = document.documentElement.style;
    root.setProperty('--bgA', fl.bgA);
    root.setProperty('--bgB', fl.bgB);
    root.setProperty('--accent', fl.main);
    document.querySelectorAll('[data-flavor]').forEach((b) => b.classList.toggle('on', b.dataset.flavor === fl.key));
  }
  applyFlavor(flavor);

  // ---------- state
  const st = {
    plastic: 0, D: 0, plateY: TOP_Y + 8, mode: qs.get('mode') === 'live' ? 'live' : 'permanent',
    spin: qs.has('rot') ? +qs.get('rot') : 0, spinVel: 0, autoSpin: !qs.has('still'),
    shake: 0, peak: 0, lastCollapse: 0, lastFolds: 0, transition: null, interacted: false,
  };
  let seed = qs.has('seed') ? +qs.get('seed') : (Math.random() * 1e6) | 0;
  body.newCan(seed);
  if (qs.has('crush')) { st.plastic = body.Dmax * +qs.get('crush'); st.D = st.plastic; body.update(st.D); }

  const sound = new Crunch();
  const hint = $('#hint');
  const srcLabel = { force: 'Force Touch', pointer: 'Pointer pressure', hold: 'Hold to squeeze' };
  const input = new PressureInput($('#stage'), {
    onDown: () => {
      sound.ensure();
      if (!st.interacted) { st.interacted = true; document.body.classList.add('interacted'); }
    },
    onUp: () => { st.peak = 0; },
    onForceClick: () => { st.shake = Math.max(st.shake, 0.5); },
    onSource: (s) => {
      $('#src').textContent = srcLabel[s] || '—';
      document.body.dataset.source = s;
      if (s === 'hold') hint.innerHTML = 'No trackpad force in this browser. Holding ramps it up. <b>Open in Safari</b> for real Force Touch.';
      if (s === 'force') hint.textContent = 'Force Touch detected. Press harder to crush.';
    },
  });
  if (qs.has('p')) input.override = +qs.get('p');

  window.__can = {
    body, st, input,
    setPressure: (p) => { input.override = p; if (p === null) input.end(); else input.begin(); },
  };

  // ---------- UI wiring
  function freshCan(fl = flavor) {
    if (st.transition) return;
    sound.whoosh();
    st.transition = { t: 0, phase: 'out', next: fl };
  }
  document.querySelectorAll('[data-flavor]').forEach((b) => b.addEventListener('click', () => freshCan(FLAVORS[b.dataset.flavor])));
  $('#fresh').addEventListener('click', () => freshCan());
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function setMode(m) {
    st.mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  }
  setMode(st.mode);
  $('#sound').addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    $('#sound').classList.toggle('off', !sound.enabled);
    $('#sound').querySelector('span').textContent = sound.enabled ? 'Sound on' : 'Sound off';
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') freshCan();
    if (e.code === 'KeyM') setMode(st.mode === 'live' ? 'permanent' : 'live');
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (idx >= 0) freshCan(Object.values(FLAVORS)[idx]);
  });
  window.addEventListener('wheel', (e) => { e.preventDefault(); st.spinVel += (e.deltaX + e.deltaY * 0.6) * -0.0009; }, { passive: false });

  // ---------- framing
  const target = new THREE.Vector3(0, 6.4, 0);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  const elev = 0.2;
  function placeCamera(crush, shake) {
    const fv = THREE.MathUtils.degToRad(camera.fov);
    const tall = camera.aspect < 1.05;
    const needH = tall ? 27 : 21, needW = 15;
    const dH = needH / 2 / Math.tan(fv / 2);
    const fh = 2 * Math.atan(Math.tan(fv / 2) * camera.aspect);
    const dW = needW / 2 / Math.tan(fh / 2);
    const d = Math.max(dH, dW);
    const ty = target.y - crush * 1.2 - (tall ? 2.6 : 0);
    const sx = (Math.random() - 0.5) * shake * 0.25, sy = (Math.random() - 0.5) * shake * 0.25;
    camera.position.set(sx, ty + d * Math.sin(elev) + sy, d * Math.cos(elev));
    camera.lookAt(sx * 0.5, ty + sy * 0.5, 0);
  }

  // ---------- loop
  const giant = $('.giant');
  const barEl = $('#bar'), peakEl = $('#peak'), forceEl = $('#forceVal'), crushEl = $('#crushVal');
  $('#tick').style.left = `${FORCE_CLICK_P * 100}%`;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let last = performance.now();
  let frames = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    input.tick(dt);
    const pressing = input.pressing || input.override !== null;
    const p = input.override !== null ? input.override : input.pressure;

    // transition between cans
    if (st.transition) {
      const tr = st.transition;
      tr.t += dt / (tr.phase === 'out' ? 0.32 : 0.5);
      if (tr.phase === 'out') {
        canRoot.position.x = ease(Math.min(1, tr.t)) * 26;
        if (tr.t >= 1) {
          if (tr.next !== flavor) applyFlavor(tr.next);
          seed = (Math.random() * 1e6) | 0;
          body.newCan(seed);
          st.plastic = 0; st.D = 0; st.lastCollapse = 0; st.lastFolds = 0;
          tr.phase = 'in'; tr.t = 0;
        }
      } else {
        canRoot.position.x = -26 * (1 - ease(Math.min(1, tr.t)));
        if (tr.t >= 1) { canRoot.position.x = 0; st.transition = null; }
      }
    }

    // press head: drop onto the lid while pressing, float above otherwise
    const contactY = body.topY;
    const plateTarget = pressing && !st.transition ? contactY : contactY + 8;
    st.plateY += (plateTarget - st.plateY) * (1 - Math.exp(-dt * (pressing ? 26 : 7)));
    if (st.plateY < contactY) st.plateY = contactY;
    // once the head touches the lid it stays on it until release (otherwise it can lag the
    // shortening can, lose contact for a frame and make Springs-back mode oscillate)
    if (!pressing || st.transition) st.contact = false;
    else if (st.plateY - contactY < 0.25) st.contact = true;
    const inContact = st.contact;

    // crush target from pressure
    const curve = (x) => Math.max(0, (x - 0.03) / 0.97);
    const want = inContact ? body.Dmax * curve(p) : 0;
    if (st.mode === 'permanent') st.plastic = Math.max(st.plastic, want);
    else st.plastic = want;
    const k = st.mode === 'permanent' ? 16 : 20;
    st.D += (st.plastic - st.D) * (1 - Math.exp(-dt * k));
    if (Math.abs(st.plastic - st.D) < 1e-4) st.D = st.plastic;
    body.update(st.D);
    tabGroup.matrix.copy(body.topMatrix);
    tabGroup.matrixWorldNeedsUpdate = true;
    if (st.plateY < body.topY || st.contact) st.plateY = body.topY;
    press.position.y = st.plateY;

    // sounds + shake from fold progress
    const folds = body.a.reduce((n, a) => n + (a > 0.04 ? 1 : 0), 0);
    if (folds > st.lastFolds) { sound.crunch(0.9, true); st.shake = Math.max(st.shake, 0.8); }
    st.lastFolds = folds;
    if (body.collapse - st.lastCollapse > 0.06) {
      sound.crunch(Math.min(1, (body.collapse - st.lastCollapse) * 6), false);
      st.lastCollapse = body.collapse;
    } else if (body.collapse < st.lastCollapse - 0.12) {
      sound.tick();
      st.lastCollapse = body.collapse;
    }
    st.shake *= Math.exp(-dt * 9);

    // turntable
    if (st.autoSpin && !pressing) st.spinVel += (0.22 - st.spinVel) * (1 - Math.exp(-dt * 0.8));
    else st.spinVel *= Math.exp(-dt * (pressing ? 10 : 3));
    st.spin += st.spinVel * dt;
    canGroup.rotation.y = Math.PI / 2 + st.spin;

    placeCamera(body.crush, st.shake);
    shadow.update(scene, [press]);
    renderer.render(scene, camera);

    // HUD
    st.peak = Math.max(st.peak, pressing ? p : 0);
    barEl.style.transform = `scaleX(${p.toFixed(4)})`;
    peakEl.style.left = `${st.peak * 100}%`;
    peakEl.style.opacity = st.peak > 0.01 ? 1 : 0;
    forceEl.textContent = input.source === 'force' && pressing ? input.raw.toFixed(2) : `${Math.round(p * 100)}%`;
    crushEl.textContent = `${Math.round(body.crush * 100)}%`;
    giant.style.transform = `scaleY(${(1 - body.crush * 0.45).toFixed(4)})`;
    document.body.classList.toggle('pressing', pressing);
    const flat = body.crush > 0.97 && !pressing && !st.transition;
    if (flat !== st.flat) {
      st.flat = flat;
      if (flat) { st.hintBefore = hint.innerHTML; hint.innerHTML = 'Flat as it gets. Grab a <b>Fresh can</b> (R)'; }
      else if (st.hintBefore) hint.innerHTML = st.hintBefore;
    }

    frames++;
    if (frames === 3) document.body.classList.add('ready');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('hint');
  if (el) el.textContent = `Error: ${e.message}`;
});
