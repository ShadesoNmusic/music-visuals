import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const W = 540, H = 960;
const RINGS = 72, SPACING = 3.2, SEG = 128;
const CYAN = 0x00f5ff, MAGENTA = 0xff00aa, VIOLET = 0x7a00ff, BG = 0x030308;

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

  const cyan = new THREE.Color(CYAN), magenta = new THREE.Color(MAGENTA), violet = new THREE.Color(VIOLET);

  // --- dense thin rings (thin tube so additive stack doesn’t blow to white) ---
  const rings = [];
  const torusGeo = new THREE.TorusGeometry(1, 0.018, 6, SEG);
  for (let i = 0; i < RINGS; i++) {
    const u = (i % 14) / 13;
    const base = cyan.clone().lerp(magenta, u * 0.7).lerp(violet, u * 0.3);
    const m = new THREE.MeshBasicMaterial({
      color: base.clone(),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(torusGeo, m);
    mesh.position.z = -i * SPACING;
    mesh.userData.phase = (i / RINGS) * Math.PI * 2;
    mesh.userData.baseColor = base;
    mesh.userData.layer = i % 3; // stagger sizes for depth
    root.add(mesh); rings.push(mesh);
  }

  // --- inner helix ribbons (2) for Polyfjord-ish motion ---
  const ribbons = [];
  for (let h = 0; h < 2; h++) {
    const g = new THREE.BufferGeometry();
    const N = RINGS * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const col = h ? magenta.clone() : cyan.clone();
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: col, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(line);
    ribbons.push({ line, offset: h * Math.PI, baseColor: col, N });
  }

  // --- many longitudinal spokes ---
  const spokes = [];
  const SPOKE_N = 24;
  for (let k = 0; k < SPOKE_N; k++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * 3), 3));
    const base = (k % 3 === 0) ? violet.clone() : (k % 2 ? cyan.clone() : magenta.clone());
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: base.clone(), transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(l);
    spokes.push({ line: l, angle: (k / SPOKE_N) * Math.PI * 2, baseColor: base });
  }

  // --- star / spark particle field along the void ---
  const STAR_N = 400;
  const starPos = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 2.5 + Math.random() * 9;
    starPos[i * 3] = Math.cos(a) * rad;
    starPos[i * 3 + 1] = Math.sin(a) * rad;
    starPos[i * 3 + 2] = -Math.random() * RINGS * SPACING;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.08, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  root.add(stars);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(2); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  // deep cut: was washing ~157–223; target mid ~40–120
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.35, 0.55);
  composer.addPass(bloom);

  let t = 0, speed = 36;
  const tmp = new THREE.Color();
  function frame(dt) {
    t += dt;
    speed += ((24 + audio.bass * 90 + audio.kick * 55) - speed) * 0.12;
    const wave = 0.04 + audio.mid * 0.45;
    const trebleW = audio.treble * 0.2;
    const boost = 1 + Math.min(0.2, audio.bass * 0.3);

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
      r.rotation.z = t * 0.12 + r.userData.phase * 0.08;
      tmp.copy(r.userData.baseColor).multiplyScalar(boost);
      r.material.color.copy(tmp);
      // kick flash on opacity only (brief), not bloom
      r.material.opacity = 0.4 + audio.bass * 0.15 + audio.kick * 0.25;
    }

    const sorted = [...rings].sort((a, b) => a.position.z - b.position.z);

    ribbons.forEach(({ line, offset, baseColor, N }) => {
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
      line.material.color.copy(baseColor).multiplyScalar(boost);
      line.material.opacity = 0.35 + audio.treble * 0.3 + audio.kick * 0.2;
    });

    spokes.forEach(({ line, angle, baseColor }) => {
      const p = line.geometry.attributes.position.array;
      const twist = t * 0.25 + audio.mid * 0.4;
      sorted.forEach((r, i) => {
        const rad = r.scale.x * 0.98;
        p[i * 3] = Math.cos(angle + twist) * rad;
        p[i * 3 + 1] = Math.sin(angle + twist) * rad;
        p[i * 3 + 2] = r.position.z;
      });
      line.geometry.attributes.position.needsUpdate = true;
      line.material.color.copy(baseColor).multiplyScalar(boost);
    });

    // drift stars toward camera
    const sp = stars.geometry.attributes.position.array;
    for (let i = 0; i < STAR_N; i++) {
      sp[i * 3 + 2] += speed * dt * 0.85;
      if (sp[i * 3 + 2] > 5) {
        const a = Math.random() * Math.PI * 2;
        const rad = 2.5 + Math.random() * 9;
        sp[i * 3] = Math.cos(a) * rad;
        sp[i * 3 + 1] = Math.sin(a) * rad;
        sp[i * 3 + 2] -= RINGS * SPACING;
      }
    }
    stars.geometry.attributes.position.needsUpdate = true;
    stars.material.opacity = 0.45 + audio.treble * 0.4;

    const s = 1 + audio.kick * 0.18; root.scale.set(s, s, 1);
    camera.fov = 72 - audio.kick * 12; camera.updateProjectionMatrix();
    camera.rotation.z = Math.sin(t * 0.2) * 0.05;
    bloom.strength = 0.55 + Math.min(0.15, audio.bass * 0.2);
    composer.render();
  }
  return { frame, renderer };
}
