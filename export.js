// export.js — MediaRecorder 9:16 export with hook/BPM burned in + audio track.
// TikTok lane: 1080×1920 webm, center-third text, safe of top 10% / bottom 20%.

const W = 1080, H = 1920;

function pickMime() {
  for (const t of [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ]) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.replace(/\n/g, ' \n ').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (w === '\n') { lines.push(line); line = ''; continue; }
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

export function createExporter({ glCanvas, hookEl, bpmEl, showBpmEl, audio }) {
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  let recorder = null, chunks = [], dest = null, recording = false;

  function paint() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // Three.js canvas backing store is already 1080×1920
    ctx.drawImage(glCanvas, 0, 0, W, H);

    const text = (hookEl.innerText || '').trim();
    const kick = audio.kick || 0;
    const scale = 1 + kick * 0.08;

    if (text) {
      ctx.save();
      ctx.translate(W / 2, H * 0.5);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 24;
      // Long hooks (≤250 chars) need smaller type; short hooks stay big
      const fontSize = text.length > 130 ? 48 : text.length > 80 ? 60 : text.length > 40 ? 76 : 96;
      ctx.font = `900 ${fontSize}px system-ui,-apple-system,sans-serif`;
      const lines = wrapLines(ctx, text.toUpperCase(), W * 0.82);
      const lh = fontSize * 1.05;
      const startY = -((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        ctx.shadowColor = '#ff00cc';
        ctx.shadowBlur = 36;
        ctx.fillText(ln, 0, startY + i * lh);
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 18;
        ctx.fillText(ln, 0, startY + i * lh);
      });
      ctx.restore();
    }

    if (showBpmEl?.checked && audio.bpm) {
      ctx.save();
      ctx.fillStyle = '#00ffff';
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 12;
      ctx.font = '700 36px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.letterSpacing = '8px';
      ctx.fillText(`${audio.bpm} BPM`, W / 2, H * 0.5 + 120);
      ctx.restore();
    }
  }

  function tick() {
    if (recording) paint();
  }

  async function start() {
    if (recording) return;
    if (!audio.ctx || !audio.analyser || !audio.element) {
      throw new Error('Load a track first');
    }
    const mime = pickMime();
    if (!mime) throw new Error('MediaRecorder not supported in this browser');

    await audio.ctx.resume();
    paint();

    dest = audio.ctx.createMediaStreamDestination();
    try { audio.analyser.connect(dest); } catch (_) { /* already connected */ }

    const vStream = out.captureStream(30);
    const mixed = new MediaStream([
      ...vStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    chunks = [];
    recorder = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = URL.createObjectURL(blob);
      a.download = `shadeson-visual-${stamp}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      try { audio.analyser.disconnect(dest); } catch (_) {}
      dest = null;
      recorder = null;
      chunks = [];
      recording = false;
      vStream.getTracks().forEach((t) => t.stop());
    };
    recorder.start(250);
    recording = true;
  }

  function stop() {
    if (!recorder || recorder.state === 'inactive') {
      recording = false;
      return;
    }
    recorder.stop();
  }

  return {
    start,
    stop,
    tick,
    get recording() { return recording; },
  };
}
