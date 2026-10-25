import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';

const W = 540, H = 960;
const RINGS = 72, SPACING = 3.2, SEG = 128;
const BG = 0x030308;

// Quilez cosine palette: a + b*cos(2π(c*t+d))
function cosPalette(t, a, b, c, d, out) {
  out.r = a.x + b.x * Math.cos(6.28318 * (c.x * t + d.x));
  out.g = a.y + b.y * Math.cos(6.28318 * (c.y * t + d.y));
  out.b = a.z + b.z * Math.cos(6.28318 * (c.z * t + d.z));
  out.r = Math.min(1, Math.max(0, out.r));
  out.g = Math.min(1, Math.max(0, out.g));
  out.b = Math.min(1, Math.max(0, out.b));
  return out;
}
const PAL_A = new THREE.Vector3(0.5, 0.5, 0.5);
const PAL_B = new THREE.Vector3(0.5, 0.5, 0.5);
const PAL_C = new THREE.Vector3(1.0, 1.0, 1.0);
const PAL_D = new THREE.Vector3(0.00, 0.33, 0.67); // cyan→magenta neon

export function createVisual(canvas, audio) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(2); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.018);
  const camera = new THREE.PerspectiveCamera(72, W / H, 0.1, 400);
  camera.position.z = 2.5;
  const root = new THREE.Group(); scene.add(root);

  const rings = [];
  const torusGeo = new THREE.TorusGeometry(1, 0.018, 6, SEG);
  for (let i = 0; i < RINGS; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(torusGeo, m);
    mesh.position.z = -i * SPACING;
    mesh.userData.phase = (i / RINGS) * Math.PI * 2;
    mesh.userData.layer = i % 3;
    mesh.userData.palT = (i / RINGS);
    root.add(mesh); rings.push(mesh);
  }

  const ribbons = [];
  for (let h = 0; h < 2; h++) {
    const g = new THREE.BufferGeometry();
    const N = RINGS * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(line);
    ribbons.push({ line, offset: h * Math.PI, N, palOff: h * 0.5 });
  }

  const spokes = [];
  const SPOKE_N = 24;
  for (let k = 0; k < SPOKE_N; k++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(l);
    spokes.push({ line: l, angle: (k / SPOKE_N) * Math.PI * 2, palOff: k / SPOKE_N });
  }

  const STAR_N = 600;
  const starPos = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 2.2 + Math.random() * 10;
    starPos[i * 3] = Math.cos(a) * rad;
    starPos[i * 3 + 1] = Math.sin(a) * rad;
    starPos[i * 3 + 2] = -Math.random() * RINGS * SPACING;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.07, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  root.add(stars);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(2); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  // Synesthesia-style trails (damp ~0.88 — not so sticky it washes)
  const after = new AfterimagePass(0.88);
  composer.addPass(after);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.35, 0.55);
  composer.addPass(bloom);

  let t = 0, speed = 36;
  const tmp = new THREE.Color();
  function frame(dt) {
    t += dt;
    speed += ((24 + audio.bass * 90 + audio.kick * 55) - speed) * 0.12;
    const wave = 0.04 + audio.mid * 0.45;
    const trebleW = audio.treble * 0.2;
    // palette phase: mids + BPM-ish sine (use kick pulse if bpm unknown)
    const bpmHz = audio.bpm > 0 ? audio.bpm / 60 : 2;
    const palDrive = audio.mid * 0.45 + (audio.midHit || 0) * 0.25 + 0.08 * Math.sin(t * bpmHz * Math.PI * 2) + audio.bassTime * 0.015;

    for (const r of rings) {
      r.position.z += speed * dt;
      if (r.position.z > 5) {
        r.position.z -= RINGS * SPACING;
        r.userData.phase = Math.random() * 6.28;
      }
      const layerScale = 1 + r.userData.layer * 0.08;
      const rad = (6.2 + audio.bass * 2.8) * layerScale
        + Math.sin(t * 1.1 + r.userData.phase) * wave
        + Math.sin(t * 3.2 + r.userData.phase * 2) * trebleW;
      r.scale.set(rad, rad, 1);
      r.rotation.z = t * 0.12 + r.userData.phase * 0.08 + audio.bassTime * 0.02;
      cosPalette(r.userData.palT + palDrive, PAL_A, PAL_B, PAL_C, PAL_D, tmp);
      r.material.color.copy(tmp);
      r.material.opacity = 0.38 + audio.bass * 0.12 + audio.kick * 0.2 + (audio.bassAtt || 0) * 0.25;
    }

    const sorted = [...rings].sort((a, b) => a.position.z - b.position.z);

    ribbons.forEach(({ line, offset, N, palOff }) => {
      const p = line.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const z = -i * (SPACING * 0.5) + ((t * speed * 0.15) % (SPACING * 0.5));
        const a = offset + i * 0.35 + t * 1.4;
        const rad = 4.5 + audio.bass * 2 + Math.sin(i * 0.2 + t) * (0.3 + audio.mid * 0.8);
        p[i * 3] = Math.cos(a) * rad;
        p[i * 3 + 1] = Math.sin(a) * rad;
        p[i * 3 + 2] = z - 10;
      }
      line.geometry.attributes.position.needsUpdate = true;
      cosPalette(palOff + palDrive * 1.2, PAL_A, PAL_B, PAL_C, PAL_D, tmp);
      line.material.color.copy(tmp);
      line.material.opacity = 0.32 + audio.treble * 0.3 + audio.kick * 0.2;
    });

    spokes.forEach(({ line, angle, palOff }) => {
      const p = line.geometry.attributes.position.array;
      const twist = t * 0.25 + audio.mid * 0.4 + audio.bassTime * 0.05;
      sorted.forEach((r, i) => {
        const rad = r.scale.x * 0.98;
        p[i * 3] = Math.cos(angle + twist) * rad;
        p[i * 3 + 1] = Math.sin(angle + twist) * rad;
        p[i * 3 + 2] = r.position.z;
      });
      line.geometry.attributes.position.needsUpdate = true;
      cosPalette(palOff + palDrive, PAL_A, PAL_B, PAL_C, PAL_D, tmp);
      line.material.color.copy(tmp);
    });

    const sp = stars.geometry.attributes.position.array;
    const kickPush = audio.kick * 0.35;
    for (let i = 0; i < STAR_N; i++) {
      sp[i * 3] *= 1 + kickPush * 0.02;
      sp[i * 3 + 1] *= 1 + kickPush * 0.02;
      sp[i * 3 + 2] += speed * dt * 0.85;
      if (sp[i * 3 + 2] > 5) {
        const a = Math.random() * Math.PI * 2;
        const rad = 2.2 + Math.random() * 10;
        sp[i * 3] = Math.cos(a) * rad;
        sp[i * 3 + 1] = Math.sin(a) * rad;
        sp[i * 3 + 2] -= RINGS * SPACING;
      }
    }
    stars.geometry.attributes.position.needsUpdate = true;
    stars.material.opacity = 0.4 + audio.treble * 0.45;

    const s = 1 + audio.kick * 0.18; root.scale.set(s, s, 1);
    camera.fov = 72 - audio.kick * 12; camera.updateProjectionMatrix();
    camera.position.z = 2.5 + Math.sin(audio.bassTime * 0.7) * 0.35;
    camera.rotation.z = Math.sin(t * 0.2) * 0.05 + audio.mid * 0.03;
    // trails stick a bit more on bass; bloom stays parked (no white-out)
    after.uniforms.damp.value = 0.86 + Math.min(0.06, audio.bass * 0.06) + Math.min(0.04, (audio.bassAtt || 0) * 0.05);
    bloom.strength = 0.45 + Math.min(0.2, audio.bass * 0.15 + (audio.bassAtt || 0) * 0.12);
    composer.render();
  }
  return { frame, renderer };
}
