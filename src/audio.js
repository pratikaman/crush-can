// Synthesised aluminium crunch: bursts of band-passed noise clicks, a few
// metallic pings and a low thump. No samples, so it works offline.
export class Crunch {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  click(t, gain, freq, decay) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2 + Math.random() * 3;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    src.connect(bp).connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.8, decay + 0.02);
  }
  ping(t, gain, freq, decay) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine'; o.frequency.value = freq;
    o.frequency.exponentialRampToValueAtTime(freq * 0.97, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0002, t + decay);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + decay + 0.02);
  }
  thump(t, gain) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }
  // intensity 0..1
  crunch(intensity = 0.5, big = false) {
    if (!this.enabled || !this.ctx || !this.ensure()) return; // only after a user gesture created the context
    const t0 = this.ctx.currentTime + 0.005;
    const n = Math.round(3 + intensity * (big ? 22 : 10));
    const span = 0.03 + intensity * (big ? 0.16 : 0.07);
    for (let k = 0; k < n; k++) {
      const t = t0 + Math.pow(Math.random(), 1.4) * span;
      this.click(t, (0.12 + Math.random() * 0.35) * (0.5 + intensity), 1400 + Math.random() * 5200, 0.004 + Math.random() * 0.018);
    }
    const pings = big ? 3 : Math.random() < 0.5 ? 1 : 0;
    for (let k = 0; k < pings; k++) this.ping(t0 + Math.random() * span, 0.025 + 0.03 * intensity, 2400 + Math.random() * 3600, 0.05 + Math.random() * 0.08);
    if (big) this.thump(t0, 0.35 + 0.35 * intensity);
  }
  tick() {
    if (!this.enabled || !this.ctx || !this.ensure()) return;
    const t = this.ctx.currentTime + 0.003;
    this.click(t, 0.12, 3200 + Math.random() * 2000, 0.006);
  }
  whoosh() {
    if (!this.enabled || !this.ensure()) return;
    const c = this.ctx, t = c.currentTime + 0.005;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, 0, 0.4);
  }
}
