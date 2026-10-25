import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { GlitchPass } from 'three/addons/postprocessing/GlitchPass.js';

// Pass 4b: longer/stronger hit Glitch (readable in TikTok stills) + 3a Glob + 2f hex
const W = 540, H = 960;
const RINGS = 20, PER_RING = 8, SPACING = 3.2; // sparse fat pillars; flats beat ring density
const COUNT = RINGS * PER_RING;
const DEPTH = RINGS * SPACING;
const BG = 0x020205;

function cosPalette(t, a, b, c, d, out) {
  const f = (i) => Math.min(1, Math.max(0, a[i] + b[i] * Math.cos(6.28318 * (c[i] * t + d[i]))));
  out.r = f(0); out.g = f(1); out.b = f(2);
  return out;
}
const PAL_A = [0.5, 0.5, 0.5], PAL_B = [0.5, 0.5, 0.5], PAL_C = [1, 1, 1], PAL_D = [0.0, 0.33, 0.67];

export function createVisual(canvas, audio) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(2); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.07);
  const camera = new THREE.PerspectiveCamera(72, W / H, 0.1, 200);
  camera.position.set(0, 0, 3);
  const root = new THREE.Group(); scene.add(root);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const camLight = new THREE.PointLight(0xffffff, 40, 30, 1.6);
  scene.add(camLight);

  // Hex pillar: 6-sided prism along Y; rotateY so a flat faces the tunnel axis
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
  geo.rotateY(Math.PI / 6);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x111122, flatShading: true });
  const pillars = new THREE.InstancedMesh(geo, mat, COUNT);
  pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(pillars);

  // Thin emissive caps (inner faces) — additive neon edge read
  const capGeo = new THREE.CircleGeometry(1, 6);
  capGeo.rotateZ(Math.PI / 6); // flat-top hex, matches pillar
  const capMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const caps = new THREE.InstancedMesh(capGeo, capMat, COUNT);
  caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(caps);

  const ringZ = new Float32Array(RINGS);
  const ringPhase = new Float32Array(RINGS);
  const seed = new Float32Array(COUNT);
  for (let r = 0; r < RINGS; r++) { ringZ[r] = -r * SPACING; ringPhase[r] = Math.random() * 6.28; }
  for (let i = 0; i < COUNT; i++) seed[i] = Math.random();

  // very dim spark field
  const STAR_N = 300;
  const starPos = new Float32Array(STAR_N * 3);
  const resetStar = (i, z) => {
    const a = Math.random() * 6.28, rad = 0.5 + Math.random() * 3;
    starPos[i * 3] = Math.cos(a) * rad; starPos[i * 3 + 1] = Math.sin(a) * rad; starPos[i * 3 + 2] = z;
  };
  for (let i = 0; i < STAR_N; i++) resetStar(i, -Math.random() * DEPTH);
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.04, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  root.add(stars);

  // Pass 3a Glob — centre orb for hook space (small, dark core, soft shell)
  const GLOB_DETAIL = 3;
  const globGeo = new THREE.IcosahedronGeometry(1, GLOB_DETAIL);
  const globBase = Float32Array.from(globGeo.attributes.position.array);
  const globMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, emissive: 0x151528, flatShading: true,
    transparent: true, opacity: 0.88, depthWrite: true,
  });
  const glob = new THREE.Mesh(globGeo, globMat);
  glob.position.set(0, 0, -5);
  scene.add(glob); // not under root kick-scale — keeps hook framing stable
  const shellGeo = new THREE.IcosahedronGeometry(1.08, 2);
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  glob.add(shell);
  const globCol = new THREE.Color();
  let globScale = 0.55;

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(2); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const after = new AfterimagePass(0.60); // 2f: less smear so hex edges survive stills
  composer.addPass(after);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.42, 0.3, 0.65);
  composer.addPass(bloom);
  // Pass 4a — DigitalGlitch only on hits (kick/high), not constant noise
  const glitch = new GlitchPass(32);
  glitch.goWild = false;
  composer.addPass(glitch);
  let glitchLeft = 0;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1), xAxis = new THREE.Vector3(1, 0, 0);
  const qCap = new THREE.Quaternion().setFromAxisAngle(xAxis, Math.PI / 2);
  const qTmp = new THREE.Quaternion();
  const col = new THREE.Color(), capCol = new THREE.Color();
  const spec = () => audio.spectrum && audio.spectrum.length ? audio.spectrum : null;

  let t = 0, speed = 10, scroll = 0;
  function frame(dt) {
    dt = Math.min(dt, 0.05);
    t += dt;
    const bass = audio.bass || 0, mid = audio.mid || 0, treble = audio.treble || 0;
    const kick = audio.kick || 0, bassAtt = audio.bassAtt || 0, midAtt = audio.midAtt || 0;
    const bassHit = audio.bassHit || 0, midHit = audio.midHit || 0, highHit = audio.highHit || 0;
    const bassTime = audio.bassTime || 0;

    speed += ((7 + bass * 22 + kick * 14) - speed) * 0.1;
    scroll += speed * dt;
    const radius = 2.4 + bass * 0.5 + bassAtt * 0.35 + kick * 0.25;
    const thick = 0.95 + bass * 0.22 + bassHit * 0.15; // fat hex cross-section — silhouette first
    const palDrive = mid * 0.4 + midHit * 0.25 + bassTime * 0.02;
    const twist = t * 0.08 + bassTime * 0.03;
    const sp = spec();

    let idx = 0;
    for (let r = 0; r < RINGS; r++) {
      ringZ[r] += speed * dt;
      if (ringZ[r] > 4) { ringZ[r] -= DEPTH; ringPhase[r] = Math.random() * 6.28; }
      const z = ringZ[r];
      const depthT = (-z + 4) / DEPTH;
      const ringOff = (r % 2) * (Math.PI / PER_RING) + twist;
      for (let k = 0; k < PER_RING; k++, idx++) {
        const a = (k / PER_RING) * Math.PI * 2 + ringOff;
        const s = seed[idx];
        let band = 0;
        if (sp) band = (sp[Math.floor((k / PER_RING) * sp.length * 0.6)] || 0);
        // inner face pushes in with spectrum/treble → organic relief
        const inward = s * 0.5 + band * 0.9 + Math.sin(t * 1.3 + ringPhase[r] + k) * (0.08 + midAtt * 0.25) + highHit * s * 0.3;
        const inner = Math.max(0.9, radius - inward);
        const len = 1.35 + inward * 0.55; // shorter radial so end-on reads as hex, not a streak
        const ca = Math.cos(a), sa = Math.sin(a);
        pos.set(ca * inner, sa * inner, z);
        q.setFromAxisAngle(zAxis, a - Math.PI / 2); // local +Y points outward
        scl.set(thick, len, thick);
        m4.compose(pos, q, scl);
        pillars.setMatrixAt(idx, m4);

        cosPalette(s * 0.35 + depthT * 0.6 + palDrive, PAL_A, PAL_B, PAL_C, PAL_D, col);
        col.multiplyScalar(0.42);
        pillars.setColorAt(idx, col);

        // cap on inner face, facing the axis
        pos.set(ca * (inner - 0.01), sa * (inner - 0.01), z);
        qTmp.copy(q).multiply(qCap);
        scl.set(thick * 1.4, thick * 1.4, 1); // oversized hex caps — dominate the frame
        m4.compose(pos, qTmp, scl);
        caps.setMatrixAt(idx, m4);
        const glow = 0.25 + band * 0.6 + (s > 0.85 ? midHit * 0.8 : 0);
        capCol.copy(col).multiplyScalar(glow * 1.6);
        caps.setColorAt(idx, capCol);
      }
    }
    pillars.instanceMatrix.needsUpdate = true; pillars.instanceColor.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true; caps.instanceColor.needsUpdate = true;
    capMat.opacity = 0.55 + kick * 0.3;

    for (let i = 0; i < STAR_N; i++) {
      starPos[i * 3 + 2] += speed * dt * 1.3;
      if (starPos[i * 3 + 2] > 4) resetStar(i, starPos[i * 3 + 2] - DEPTH);
    }
    starGeo.attributes.position.needsUpdate = true;
    stars.material.opacity = 0.15 + treble * 0.25;

    // Pass 3a Glob morph — bass size, kick punch, mid palette, treble ripples
    // keep radius modest so centre-third stays dark for TikTok hook text
    const targetGlob = 0.48 + bass * 0.22 + bassAtt * 0.12 + kick * 0.18;
    globScale += (targetGlob - globScale) * 0.18;
    const posArr = globGeo.attributes.position.array;
    for (let i = 0; i < posArr.length; i += 3) {
      const bx = globBase[i], by = globBase[i + 1], bz = globBase[i + 2];
      const n = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const nx = bx / n, ny = by / n, nz = bz / n;
      const w =
        Math.sin(nx * 4.2 + t * 1.7 + bassTime) * (0.06 + mid * 0.08) +
        Math.sin(ny * 5.1 - t * 2.1 + midHit) * (0.05 + treble * 0.1) +
        Math.sin(nz * 3.4 + t * 1.3) * (0.04 + highHit * 0.08) +
        kick * 0.07 * Math.sin(n * 9 + t * 8);
      const r = 1 + w;
      posArr[i] = nx * r; posArr[i + 1] = ny * r; posArr[i + 2] = nz * r;
    }
    globGeo.attributes.position.needsUpdate = true;
    globGeo.computeVertexNormals();
    glob.scale.setScalar(globScale);
    glob.rotation.y = t * 0.35 + bassTime * 0.05;
    glob.rotation.x = Math.sin(t * 0.4) * 0.25 + mid * 0.15;
    cosPalette(0.55 + palDrive * 0.5 + kick * 0.1, PAL_A, PAL_B, PAL_C, PAL_D, globCol);
    globMat.color.copy(globCol).multiplyScalar(0.55);
    globMat.emissive.copy(globCol).multiplyScalar(0.12 + kick * 0.15);
    shellMat.color.copy(globCol);
    shellMat.opacity = 0.12 + mid * 0.12 + kick * 0.15;
    shell.rotation.y = -t * 0.55;

    // organic corkscrew camera
    const drift = 0.25 + mid * 0.5;
    camera.position.x = Math.sin(t * 0.37 + bassTime * 0.05) * drift;
    camera.position.y = Math.cos(t * 0.29) * drift * 0.8;
    camera.rotation.z = Math.sin(t * 0.15) * 0.35 + bassTime * 0.01 + mid * 0.08;
    camera.lookAt(0, 0, -20);
    camera.rotation.z += Math.sin(t * 0.15) * 0.35;
    camera.fov = 72 - kick * 10; camera.updateProjectionMatrix();
    const ks = 1 + kick * 0.08; root.scale.set(ks, ks, 1);
    camLight.position.copy(camera.position);
    camLight.intensity = 30 + bass * 20;
    // glob tracks camera lightly — stays in centre-third for hook overlay
    glob.position.x = camera.position.x * 0.35;
    glob.position.y = camera.position.y * 0.35;
    glob.position.z = -5 + Math.sin(t * 0.5) * 0.15;

    // frame-rate independent trails: pow so large dt (low fps) shortens persistence
    const dampBase = 0.60 + Math.min(0.05, bass * 0.03);
    after.uniforms.damp.value = Math.pow(dampBase, Math.max(0.5, dt * 60));
    bloom.strength = 0.40 + Math.min(0.10, bass * 0.08 + bassAtt * 0.05); // parked hard: 0.40–0.50
    // 4b: longer bursts so CA/block tear reads in stills/exports (~8–12 frames @60)
    if (kick > 0.4 || highHit > 0.35 || bassHit > 0.55) glitchLeft = Math.max(glitchLeft, 10);
    glitch.goWild = glitchLeft > 0;
    if (glitchLeft > 0) {
      glitchLeft--;
      // punch amount while wild so a single export frame still shows tear
      glitch.uniforms.amount.value = 0.08 + kick * 0.12 + highHit * 0.1;
      glitch.uniforms.byp.value = 0;
    } else {
      glitch.uniforms.byp.value = 1;
    }
    composer.render();
  }
  return { frame, renderer };
}
