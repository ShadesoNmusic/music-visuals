// PASS 12cl — trim idle bloom 0.14→0.11 (target ~80–110); keep after-card eat; threshold 0.72; no air paint; no extra card; scale freeze
import { audio } from './audio.12cl.js';
import { createVisual } from './visual.12cl.js';
import { createExporter } from './export.12cl.js';

const PASS = '12cl';
const tag = document.getElementById('pass-tag');
if (tag) tag.textContent = 'PASS ' + PASS;

const $ = (id) => document.getElementById(id);
const vis = createVisual($('c'), audio);
const exporter = createExporter({ glCanvas: $('c'), audio });
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  audio.update(dt); vis.frame(dt);
  exporter.tick();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

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
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
});

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
