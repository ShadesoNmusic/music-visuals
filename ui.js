import { audio } from './audio.js?v=7b1';
import { createVisual } from './visual.js?v=7b1';
import { createExporter } from './export.js?v=7b1';

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
