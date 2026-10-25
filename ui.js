import { audio } from './audio.js';
import { createVisual } from './visual.js';
import { createExporter } from './export.js';

const $ = (id) => document.getElementById(id);
const vis = createVisual($('c'), audio);
const hook = $('hook'), bpmEl = $('bpm');
// Match export.js: >40 → medium, >80 → small (live preview was overflowing ~130-char hooks)
function fitHook() {
  // Same length bands as export.js; floor keeps long Did-you-know hooks readable on phone (~22px+)
  const n = (hook.innerText || '').trim().length;
  hook.classList.toggle('long', n > 40 && n <= 80);
  hook.classList.toggle('xl', n > 80);
  let vh, vw;
  if (n <= 40) { vh = 7; vw = 12; }
  else if (n <= 80) { vh = 4.8; vw = 8; }
  else if (n <= 130) { vh = 3.8; vw = 6.5; }
  else { vh = 3.2; vw = 5.5; }
  hook.style.fontSize = `max(22px, min(${vh}vh, ${vw}vw))`;
}
fitHook();
hook.addEventListener('input', fitHook);
hook.addEventListener('blur', fitHook);
const exporter = createExporter({
  glCanvas: $('c'),
  hookEl: hook,
  bpmEl,
  showBpmEl: $('showbpm'),
  audio,
});
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  audio.update(dt); vis.frame(dt);
  hook.style.transform = `scale(${1 + audio.kick * 0.08})`;
  bpmEl.textContent = $('showbpm').checked && audio.bpm ? `${audio.bpm} BPM` : '';
  exporter.tick();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop); // idle tunnel animates behind the start screen


$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const el = await audio.load(f);
  await el.play();
  $('start').classList.add('hidden'); $('bar').classList.remove('hidden');
});
function toggle() {
  const el = audio.element; if (!el) return;
  if (el.paused) { el.play(); $('toggle').textContent = '❚❚ tap to pause'; }
  else { el.pause(); $('toggle').textContent = '▶ tap to play'; }
}
$('toggle').addEventListener('click', toggle);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement !== hook) { e.preventDefault(); toggle(); }
});
hook.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hook.blur(); } });
// Avoid accidental edits on phone taps during watch/REC — double-tap to unlock
hook.contentEditable = 'false';
hook.title = 'Double-tap to edit hook';
function unlockHook() {
  hook.contentEditable = 'true';
  hook.focus();
}
hook.addEventListener('dblclick', unlockHook);
let lastTap = 0;
hook.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTap < 350) { e.preventDefault(); unlockHook(); }
  lastTap = now;
});
hook.addEventListener('blur', () => { hook.contentEditable = 'false'; fitHook(); });


const recBtn = $('rec');
recBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    if (exporter.recording) {
      exporter.stop();
      recBtn.textContent = '● REC';
      recBtn.classList.remove('live');
    } else {
      await exporter.start();
      recBtn.textContent = '■ STOP';
      recBtn.classList.add('live');
    }
  } catch (err) {
    alert(err.message || String(err));
  }
});
