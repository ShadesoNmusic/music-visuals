// audio.js — real analyser (01010). Keep exports: audio { bass, mid, treble, beat, kick, bpm, load, update }.
// Bass/mid/treble: smoothed 0..1. beat: true on kick onset frame. kick: 1→0 envelope. bpm: estimated or 0.

export const audio = {
  bass: 0, mid: 0, treble: 0,
  beat: false,
  kick: 0,
  peakHold: 0,   // max kick seen recently (~1s) for debug / playtest
  level: 0,      // raw low-band energy 0..1 — if this stays ~0, analyser isn't getting audio
  bpm: 0,
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
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.analyser.connect(this.ctx.destination);
      this._f = new Uint8Array(this.analyser.frequencyBinCount);
      this._t = new Uint8Array(this.analyser.fftSize);
    }

    this._src = this.ctx.createMediaElementSource(el);
    this._src.connect(this.analyser);

    this._hist = [];
    this._fluxHist = [];
    this._prevLow = null;
    this._last = 0;
    this._iv = [];
    this.bpm = 0;
    this.kick = 0;
    this.peakHold = 0;
    this.level = 0;
    this.beat = false;
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

  update(dt = 1 / 60) {
    this.beat = false;
    // kick decays ~250ms (4/s); snappy for tunnel zoom
    this.kick = Math.max(0, this.kick - dt * 4);
    this.peakHold = Math.max(this.kick, this.peakHold - dt * 2.5); // ~400ms hold — can dip between kicks at ~180 BPM
    if (!this.analyser || !this.element || this.element.paused) return this;

    this.analyser.getByteFrequencyData(this._f);
    this.analyser.getByteTimeDomainData(this._t);

    const lerp = (o, n, k) => o + (n - o) * k;
    const sub = this._band(30, 150);
    const bassRaw = this._band(20, 250);
    const midRaw = this._band(250, 2000);
    const trebleRaw = this._band(2000, 12000);

    this.bass = Math.min(1, lerp(this.bass, bassRaw * 1.15, 0.55));
    this.mid = Math.min(1, lerp(this.mid, midRaw, 0.4));
    this.treble = Math.min(1, lerp(this.treble, trebleRaw, 0.4));

    // Spectral flux on low bins (onset) + energy vs rolling mean
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

    // time-domain punch (helps soft-compressed tracks)
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
    // RMS helps on real devices; don't hard-require it (headless often has flat time-domain)
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
