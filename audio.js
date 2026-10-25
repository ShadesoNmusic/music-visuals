// audio.js — Synesthesia-style signals (01010).
// Keep: bass, mid, treble, beat, kick, bpm, peakHold, level, load, update
// New: high, bassHit, midHit, highHit, bassAtt, midAtt, highAtt, bassTime, spectrum
// hits = band − slowAvg (clamped 0..1); Att = attack/release envelopes; bassTime integrates bass for camera Z

export const audio = {
  bass: 0, mid: 0, treble: 0, high: 0,
  beat: false,
  kick: 0,
  peakHold: 0,
  level: 0,
  bpm: 0,
  // Synesthesia-ish
  bassHit: 0, midHit: 0, highHit: 0,
  bassAtt: 0, midAtt: 0, highAtt: 0,
  bassTime: 0,
  spectrum: null, // Float32Array 0..1, length = fft/2 — for GPU DataTexture later
  element: null, ctx: null, analyser: null,

  async load(src) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();

    if (this._src) { try { this._src.disconnect(); } catch (_) {} this._src = null; }
    if (this.element) {
      this.element.pause();
      if (this._blob) URL.revokeObjectURL(this._blob);
      this.element.removeAttribute('src');
      this.element.load();
    }

    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.loop = true;
    this._blob = typeof src === 'string' ? null : URL.createObjectURL(src);
    el.src = this._blob || src;
    this.element = el;

    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.45;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.analyser.connect(this.ctx.destination);
      this._f = new Uint8Array(this.analyser.frequencyBinCount);
      this._t = new Uint8Array(this.analyser.fftSize);
      this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    }

    this._src = this.ctx.createMediaElementSource(el);
    this._src.connect(this.analyser);

    this._hist = [];
    this._fluxHist = [];
    this._prevLow = null;
    this._last = 0;
    this._iv = [];
    this._slow = { bass: 0, mid: 0, high: 0 };
    this.bpm = 0;
    this.kick = 0;
    this.peakHold = 0;
    this.level = 0;
    this.beat = false;
    this.bassHit = this.midHit = this.highHit = 0;
    this.bassAtt = this.midAtt = this.highAtt = 0;
    this.bassTime = 0;
    this.high = 0;
    return el;
  },

  _band(lo, hi) {
    const n = this._f.length;
    const nyq = this.ctx.sampleRate / 2;
    const a = Math.max(1, Math.floor((lo / nyq) * n));
    const b = Math.min(n, Math.ceil((hi / nyq) * n));
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += this._f[i];
    return s / ((b - a) * 255);
  },

  // attack/release toward target (Synesthesia-style envelopes)
  _env(cur, target, dt, atk, rel) {
    const k = target > cur ? (1 - Math.exp(-dt / atk)) : (1 - Math.exp(-dt / rel));
    return cur + (target - cur) * k;
  },

  update(dt = 1 / 60) {
    this.beat = false;
    this.kick = Math.max(0, this.kick - dt * 4);
    this.peakHold = Math.max(this.kick, this.peakHold - dt * 2.5);
    if (!this.analyser || !this.element || this.element.paused) return this;

    this.analyser.getByteFrequencyData(this._f);
    this.analyser.getByteTimeDomainData(this._t);

    for (let i = 0; i < this._f.length; i++) this.spectrum[i] = this._f[i] / 255;

    const bassRaw = this._band(20, 250);
    const midRaw = this._band(250, 2000);
    const trebleRaw = this._band(2000, 6000);
    const highRaw = this._band(6000, 16000);
    const sub = this._band(30, 150);

    // fast bands (display)
    this.bass = Math.min(1, this._env(this.bass, Math.min(1, bassRaw * 1.15), dt, 0.02, 0.12));
    this.mid = Math.min(1, this._env(this.mid, midRaw, dt, 0.03, 0.15));
    this.treble = Math.min(1, this._env(this.treble, trebleRaw, dt, 0.025, 0.12));
    this.high = Math.min(1, this._env(this.high, highRaw, dt, 0.02, 0.1));

    // slow averages for hit detection
    this._slow.bass = this._env(this._slow.bass, this.bass, dt, 0.4, 0.4);
    this._slow.mid = this._env(this._slow.mid, this.mid, dt, 0.4, 0.4);
    this._slow.high = this._env(this._slow.high, this.high, dt, 0.35, 0.35);

    // tighter peaks for Shorts-style hit flash (owner ref CxkLss9Sg3Q)
    this.bassHit = Math.min(1, Math.max(0, this.bass - this._slow.bass) * 4.5);
    this.midHit = Math.min(1, Math.max(0, this.mid - this._slow.mid) * 4.5);
    this.highHit = Math.min(1, Math.max(0, this.high - this._slow.high) * 4.5);

    // attack/release driven by hits (for post: CA, glitch, bloom) — snappier release
    this.bassAtt = this._env(this.bassAtt, this.bassHit, dt, 0.008, 0.18);
    this.midAtt = this._env(this.midAtt, this.midHit, dt, 0.01, 0.22);
    this.highAtt = this._env(this.highAtt, this.highHit, dt, 0.008, 0.15);

    // integrated bass → camera Z / tunnel scroll
    this.bassTime += this.bass * dt * (1 + this.kick * 2);

    // kick onset (unchanged core)
    const lowBins = 24;
    let flux = 0;
    if (this._prevLow) {
      for (let i = 1; i < lowBins; i++) {
        const d = this._f[i] - this._prevLow[i];
        if (d > 0) flux += d;
      }
      flux /= lowBins * 255;
    } else {
      this._prevLow = new Uint8Array(lowBins);
    }
    for (let i = 0; i < lowBins; i++) this._prevLow[i] = this._f[i];

    const fh = this._fluxHist;
    fh.push(flux);
    if (fh.length > 48) fh.shift();
    const fluxAvg = fh.reduce((a, b) => a + b, 0) / fh.length || 0;

    const h = this._hist;
    h.push(sub);
    if (h.length > 43) h.shift();
    const avg = h.reduce((a, b) => a + b, 0) / h.length || 0;

    let rms = 0;
    for (let i = 0; i < this._t.length; i++) {
      const v = (this._t[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / this._t.length);

    const now = performance.now();
    this.level = sub;

    const energyHit = sub > avg * 1.28 && sub > 0.18;
    const fluxHit = flux > fluxAvg * 1.6 + 0.02 && flux > 0.04;
    const punch = rms > 0.08;

    if ((energyHit || fluxHit || (punch && sub > avg * 1.15 && sub > 0.15)) && now - this._last > 220) {
      if (this._last) {
        const iv = now - this._last;
        if (iv > 250 && iv < 1500) {
          this._iv.push(iv);
          if (this._iv.length > 16) this._iv.shift();
        }
      }
      this._last = now;
      this.beat = true;
      this.kick = 1;
      this.peakHold = 1;
      this.bassAtt = Math.max(this.bassAtt, 0.85);
      if (this._iv.length >= 4) {
        const s = [...this._iv].sort((a, b) => a - b);
        let bpm = 60000 / s[s.length >> 1];
        while (bpm < 75) bpm *= 2;
        while (bpm > 185) bpm /= 2;
        this.bpm = Math.round(bpm);
      }
    }
    return this;
  },
};
export default audio;
