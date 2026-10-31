// export.js — MediaRecorder 9:16 export + audio track (5b: no hook/BPM burn-in).

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

export function createExporter({ glCanvas, audio }) {
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  let recorder = null, chunks = [], dest = null, recording = false;

  function paint() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(glCanvas, 0, 0, W, H);
    // 5b: no hook/BPM burn-in — centre-third is pure visual
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
