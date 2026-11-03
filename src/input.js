// Pressure sources, best first:
//  1. Safari Force Touch: webkitmouseforcechanged → MouseEvent.webkitForce (1 = click, 2 = force click, ~3 max)
//  2. Pointer Events pressure (pens, and any browser that reports real trackpad force)
//  3. Fallback: hold to ramp pressure up (mouse, Chrome/Firefox trackpads, Space key)
export const FULL_FORCE_SPAN = 1.25; // webkitForce 1 → 2.25

export class PressureInput {
  constructor(el, { onDown, onUp, onForceClick, onSource } = {}) {
    this.el = el;
    this.pressing = false;
    this.pressure = 0;
    this.raw = 0;
    this.source = null;
    this.forceSeen = false;
    this.cb = { onDown, onUp, onForceClick, onSource };
    this.holdTimer = 0;
    this.keyHold = false;
    this.override = null;

    const isUI = (e) => e.target.closest && e.target.closest('[data-ui]');

    el.addEventListener('webkitmouseforcewillbegin', (e) => { if (!isUI(e)) e.preventDefault(); });
    el.addEventListener('webkitmouseforcedown', (e) => { if (!isUI(e)) this.cb.onForceClick?.(); });
    el.addEventListener('webkitmouseforcechanged', (e) => {
      if (!this.pressing) return;
      this.raw = e.webkitForce;
      this.forceSeen = true;
      this.setSource('force');
      // webkitForce: 1 at click, 2 at force click, ~3 at hardest. Values near 3 need a very hard
      // press, so full crush sits just past the force click (2.25): force click ≈ 80 % crushed.
      this.pressure = clamp01((e.webkitForce - 1) / FULL_FORCE_SPAN);
    });
    el.addEventListener('mousedown', (e) => {
      if (isUI(e) || e.button !== 0) return;
      if (typeof e.webkitForce === 'number' && e.webkitForce > 0) this.raw = e.webkitForce;
    });

    // NB: no preventDefault on pointerdown — that would suppress the compatibility
    // mouse events, and Safari's webkitmouseforce* events ride on those.
    el.addEventListener('pointerdown', (e) => {
      if (isUI(e) || e.button !== 0) return;
      this.begin();
      this.readPointer(e);
    });
    window.addEventListener('pointermove', (e) => { if (this.pressing) this.readPointer(e); });
    const end = () => { if (this.pressing && !this.keyHold) this.end(); };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dragstart', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) { e.preventDefault(); this.keyHold = true; this.begin(); this.setSource('hold'); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.keyHold = false; this.end(); }
    });
    window.addEventListener('blur', () => { this.keyHold = false; if (this.pressing) this.end(); });
  }

  readPointer(e) {
    const p = e.pressure;
    if (e.pointerType === 'pen' || (p > 0 && Math.abs(p - 0.5) > 1e-3 && !this.forceSeen)) {
      this.setSource('pointer');
      this.pressure = clamp01(p);
      this.raw = p;
    }
  }

  setSource(s) {
    if (this.source === s) return;
    this.source = s;
    this.cb.onSource?.(s);
  }

  begin() {
    if (this.pressing) return;
    this.pressing = true;
    this.pressure = 0;
    this.holdTimer = 0;
    this.cb.onDown?.();
  }

  end() {
    if (!this.pressing) return;
    this.pressing = false;
    this.pressure = 0;
    this.raw = 0;
    this.cb.onUp?.();
  }

  // called every frame
  tick(dt) {
    if (this.override !== null) { this.pressure = this.override; return; }
    if (!this.pressing) return;
    this.holdTimer += dt;
    // no real pressure data arrived shortly after the click → ramp instead
    if (!this.forceSeen && this.source !== 'pointer' && this.holdTimer > 0.16) this.setSource('hold');
    if (this.source === 'hold') {
      this.pressure = clamp01(this.pressure + dt * 0.42); // full squeeze in ~2.4 s
      this.raw = this.pressure;
    }
  }
}

function clamp01(x) { return Math.min(1, Math.max(0, x)); }
