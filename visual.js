import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Pass 9b: opaque mid-grey concrete mass, wet floor raised into view (Reflector half-res + shiny wet plane + neon strips), kaleido/afterimage cut for sharp stills; 9a kick violence + void clamp kept. Was 9a: concrete/stone weight (grain map, rough+wet spec), neon backlight bleed, dense gates, full-res wet Reflector floor, harder kick violence; void clamp kept
const W = 540, H = 960;
const RINGS = 24, PER_RING = 8, SPACING = 2.7; // 9a denser pillars // sparse fat pillars; flats beat ring density
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
  renderer.toneMappingExposure = 0.95; // 5b: snappier contrast
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.045); // 5b: less fog wash
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
  // 9a concrete grain (tiny CanvasTexture, mobile-light)
  const grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 128;
  { const gx = grainCv.getContext('2d'); const id = gx.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) { const v = 150 + Math.random() * 90 - ((i >> 2) % 37 === 0 ? 60 : 0); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    gx.putImageData(id, 0, 0); }
  const grainTex = new THREE.CanvasTexture(grainCv); grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping; grainTex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grainTex, roughnessMap: grainTex, emissive: 0x050508, roughness: 0.9, metalness: 0.1, flatShading: true });
  const pillars = new THREE.InstancedMesh(geo, mat, COUNT);
  pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(pillars);

  // Thin emissive caps (inner faces) — additive neon edge read
  const capGeo = new THREE.CircleGeometry(1, 6);
  capGeo.rotateZ(Math.PI / 6); // flat-top hex, matches pillar
  const capMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false, // 9b: no additive shards
  });
  const caps = new THREE.InstancedMesh(capGeo, capMat, COUNT);
  caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(caps);

  // Pass 6a — nested neon portal gates (hex frames → vanishing point)
  const GATES = 32, GATE_SPACING = 1.15, GATE_DEPTH = GATES * GATE_SPACING;
  // Pass 8a — hex frames of thick boxes (solid StandardMaterial) + thin neon rim
  function hexFrame(r, th, dp) {
    const parts = [];
    const side = 2 * r * Math.tan(Math.PI / 6);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      const b = new THREE.BoxGeometry(side + th * 0.6, th, dp);
      b.translate(0, r, 0); b.rotateZ(a); parts.push(b);
    }
    return mergeGeometries(parts);
  }
  const gateGeo = hexFrame(0.95, 0.3, 0.6); // 9b thick opaque stone
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x3a3545, map: grainTex, roughnessMap: grainTex, roughness: 0.9, metalness: 0.12 });
  // 9a deep-tunnel neon backlight (behind gates) — bleeds through gaps, rims wet spec
  const backLight = new THREE.SpotLight(0xff1a9c, 120, 60, 0.7, 0.6, 1.2);
  backLight.position.set(0, 0, -40); backLight.target.position.set(0, 0, 3);
  scene.add(backLight); scene.add(backLight.target);
  const keyDir = new THREE.DirectionalLight(0xfff1e6, 2.2); keyDir.position.set(3, 2.5, 2); scene.add(keyDir); // 9b side key — shaded faces
  const backDir = new THREE.DirectionalLight(0x2a6bff, 1.4); backDir.position.set(0, 0.4, -1); scene.add(backDir);
  const gates = new THREE.InstancedMesh(gateGeo, gateMat, GATES);
  gates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(gates);
  const rimGeo = hexFrame(0.80, 0.014, 0.4); // 9b thin accent // inner edge neon
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const rims = new THREE.InstancedMesh(rimGeo, rimMat, GATES);
  rims.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rims.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GATES * 3), 3);
  root.add(rims);
  // 8a Reflector floor (half res) + dark rough overlay for depth
  const floorRef = new Reflector(new THREE.PlaneGeometry(11, 120), {
    clipBias: 0.003, textureWidth: W >> 1, textureHeight: H >> 1, color: 0x8a7aa0, // 9b half-res
  });
  floorRef.rotation.x = -Math.PI / 2; floorRef.position.set(0, -1.5, -55); root.add(floorRef);
  // 9b wet sheen plane (reads even if Reflector misses in composer) + scrolling neon mirror strips
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 120), new THREE.MeshStandardMaterial({ color: 0x0a0812, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -1.48, -55); root.add(floor);
  const stripCv = document.createElement('canvas'); stripCv.width = 64; stripCv.height = 256;
  { const sx = stripCv.getContext('2d'); sx.fillStyle = '#000'; sx.fillRect(0, 0, 64, 256);
    const cols = ['#ff00cc', '#00fff2', '#ff2a8a', '#1a4dff'];
    for (let i = 0; i < 8; i++) { sx.fillStyle = cols[i % 4]; sx.fillRect(0, i * 32, 64, 6); }
    const g = sx.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    sx.fillStyle = g; sx.fillRect(0, 0, 64, 256); }
  const stripTex = new THREE.CanvasTexture(stripCv); stripTex.wrapS = stripTex.wrapT = THREE.RepeatWrapping; stripTex.repeat.set(1, 10);
  const stripMat = new THREE.MeshBasicMaterial({ map: stripTex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
  const strips = new THREE.Mesh(new THREE.PlaneGeometry(11, 120), stripMat);
  strips.rotation.x = -Math.PI / 2; strips.position.set(0, -1.46, -55); root.add(strips);
  const floorL1 = new THREE.PointLight(0xff00cc, 30, 14, 1.5); floorL1.position.set(-2.5, -0.9, -6); scene.add(floorL1);
  const floorL2 = new THREE.PointLight(0x00fff2, 30, 14, 1.5); floorL2.position.set(2.5, -0.9, -12); scene.add(floorL2);
  const gateZ = new Float32Array(GATES);
  for (let g = 0; g < GATES; g++) gateZ[g] = -g * GATE_SPACING;
  const MAG = new THREE.Color(0xff00cc), CYAN = new THREE.Color(0x00fff2), HOTPINK = new THREE.Color(0xff2a8a), EBLUE = new THREE.Color(0x1a4dff);
  const NEONS = [MAG, CYAN, HOTPINK, EBLUE];
  const gateCol = new THREE.Color();
  let gateLurch = 0;

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
  const after = new AfterimagePass(0.42); // 5b: much less blur — hits must read in stills
  composer.addPass(after);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.28, 0.2, 0.72); // 5b: tighter bloom
  composer.addPass(bloom);
  // Pass 5a — polar kaleido; soft radius keeps centre-third identity for hook/void
  const KaleidoShader = {
    uniforms: {
      tDiffuse: { value: null },
      segments: { value: 6 },
      offset: { value: 0 },
      mixAmt: { value: 0.85 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float segments;
      uniform float offset;
      uniform float mixAmt;
      varying vec2 vUv;
      const float PI = 3.14159265;
      void main() {
        vec2 p = vUv - 0.5;
        // compensate 9:16 aspect so wedges are round, not oval
        p.x *= 540.0 / 960.0;
        float r = length(p);
        float a = atan(p.y, p.x) + offset;
        float seg = max(segments, 2.0);
        float tau = PI * 2.0 / seg;
        a = mod(a, tau);
        a = abs(a - tau * 0.5);
        vec2 q = vec2(cos(a), sin(a)) * r;
        q.x /= 540.0 / 960.0;
        vec2 uvK = q + 0.5;
        // soft radius: identity in centre (hook/void), full kaleido outside
        float k = smoothstep(0.14, 0.22, r); // 5b2: harder mirror edge
        vec3 base = texture2D(tDiffuse, vUv).rgb;
        vec3 kal = texture2D(tDiffuse, clamp(uvK, 0.0, 1.0)).rgb;
        gl_FragColor = vec4(mix(base, kal, k * mixAmt), 1.0);
      }`,
  };
  const kaleido = new ShaderPass(KaleidoShader);
  composer.addPass(kaleido);
  let kaleidoN = 6, kaleidoOff = 0;

  // Pass 6a — kick flash / invert / colour-snatch (1–3f, rate-limited ≤3/s)
  const KickFlash = {
    uniforms: {
      tDiffuse: { value: null },
      mode: { value: 0 }, // 0 off, 1 invert, 2 magenta, 3 cyan, 4 rgb-split, 5 white, 6 hot pink, 7 red
      amt: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float mode;
      uniform float amt;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        if (amt < 0.001 || mode < 0.5) { gl_FragColor = c; return; }
        if (mode < 1.5) {
          gl_FragColor = vec4(mix(c.rgb, 1.0 - c.rgb, amt), 1.0);
        } else if (mode < 2.5) {
          gl_FragColor = vec4(mix(c.rgb, vec3(1.0, 0.0, 0.8), amt), 1.0);
        } else if (mode < 3.5) {
          gl_FragColor = vec4(mix(c.rgb, vec3(0.15, 0.85, 1.0), amt) + vec3(0.25,0.0,0.35)*amt, 1.0);
        } else if (mode > 6.5) {
          gl_FragColor = vec4(mix(c.rgb, vec3(1.0, 0.05, 0.1), amt) * (1.0 + 0.6*amt), 1.0); // 9a red
        } else if (mode > 5.5) {
          gl_FragColor = vec4(mix(c.rgb, vec3(1.0, 0.25, 0.6), amt) * (1.0 + 0.6*amt), 1.0); // 9a hot pink
        } else if (mode > 4.5) {
          gl_FragColor = vec4(mix(c.rgb, vec3(1.0), amt) * (1.0 + amt), 1.0); // 7b white burst
        } else {
          float s = 0.012 * amt;
          float r = texture2D(tDiffuse, vUv + vec2(s, 0.0)).r;
          float g = c.g;
          float b = texture2D(tDiffuse, vUv - vec2(s, 0.0)).b;
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      }`,
  };
  const kickFlash = new ShaderPass(KickFlash);
  composer.addPass(kickFlash);
  let popS = 0, shakeA = 0, zPunch = 0, hueSnap = 0; // 7b beat violence
  let flashLeft = 0, flashMode = 0, lastFlashT = -1, dampBase_force = 0;

      // Pass 4c — edge-biased RGB/block tear; centre-third (hook/void) stays clean
  const EdgeGlitch = {
    uniforms: {
      tDiffuse: { value: null },
      amount: { value: 0 },
      angle: { value: 0 },
      seed: { value: 0 },
      colShift: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float amount;
      uniform float angle;
      uniform float seed;
      uniform float colShift;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // 0 in centre-third, 1 toward top/bottom — protects hook + void pocket
        float edge = smoothstep(0.18, 0.34, abs(vUv.y - 0.5)); // full centre-third dead
        float amp = amount * edge;
        if (amp < 0.001) {
          gl_FragColor = texture2D(tDiffuse, vUv);
          return;
        }
        float band = step(0.92, hash(vec2(floor(vUv.y * 28.0), seed)));
        vec2 dir = vec2(cos(angle), sin(angle));
        vec2 off = dir * amp * (0.35 + band * 1.8);
        float cs = colShift * amp * 2.2;
        vec3 base = texture2D(tDiffuse, vUv).rgb;
        float r = texture2D(tDiffuse, vUv + off + vec2(cs, 0.0)).r;
        float g = texture2D(tDiffuse, vUv + off).g;
        float b = texture2D(tDiffuse, vUv + off - vec2(cs, 0.0)).b;
        vec3 torn = min(vec3(r, g, b), base * 1.02); // dark offsets — no bright wash
        gl_FragColor = vec4(mix(base, torn, edge), 1.0);
      }`,
  };
  const glitch = new ShaderPass(EdgeGlitch);
  composer.addPass(glitch);
  let glitchLeft = 0, afterCool = 0, settleKill = 0;
  // 6b: radial void gate + centre luma clamp (LAST pass) — caps pocket ≤120/255 outside snatch
  const VoidGate = {
    uniforms: { tDiffuse: { value: null }, cap: { value: 0.40 }, radius: { value: 0.42 }, aspect: { value: W / H }, open: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float cap; uniform float radius; uniform float aspect; uniform float open;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5; d.x *= aspect;
        float g = 1.0 - smoothstep(radius * 0.85, radius, length(d)); // 6e: harder pocket edge
        float useCap = mix(cap, 0.92, open); // snatch may punch; never fully unclamp
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        float k = l > useCap ? useCap / l : 1.0;
        c.rgb *= mix(1.0, k * 0.90, g); // clamp + darken in pocket
        gl_FragColor = vec4(c.rgb, 1.0);
      }`,
  };
  const voidGate = new ShaderPass(VoidGate);
  composer.addPass(voidGate);

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

    speed += ((12 + bass * 34 + kick * 26 + Math.min(6, bassTime * 0.02)) - speed) * 0.45; // 9a harder snap // 7a fly-through // 5b: snappier rhythm
    scroll += speed * dt; stripTex.offset.y = (scroll * 0.08) % 1; stripMat.opacity = 0.28 + kick * 0.4;
    const radius = 2.4 + bass * 0.85 + bassAtt * 0.5 + kick * 0.55;
    const thick = 1.25 + bass * 0.35 + bassHit * 0.28 + kick * 0.2;
    const palDrive = mid * 0.55 + midHit * 0.45 + bassHit * 0.25 + kick * 0.2 + bassTime * 0.03;
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
        const len = 1.6 + inward * 0.55; // shorter radial so end-on reads as hex, not a streak
        const ca = Math.cos(a), sa = Math.sin(a);
        pos.set(ca * inner, sa * inner, z);
        q.setFromAxisAngle(zAxis, a - Math.PI / 2); // local +Y points outward
        scl.set(thick, len, thick);
        m4.compose(pos, q, scl);
        pillars.setMatrixAt(idx, m4);

        cosPalette(s * 0.35 + depthT * 0.6 + palDrive, PAL_A, PAL_B, PAL_C, PAL_D, col);
        col.lerp(gateMat.color, 0.75).multiplyScalar(1.4 + kick * 0.4 + band * 0.2); // 9b grey concrete, faint tint // 6a: dim — gates are hero
        pillars.setColorAt(idx, col);

        // cap on inner face, facing the axis
        pos.set(ca * (inner - 0.01), sa * (inner - 0.01), z);
        qTmp.copy(q).multiply(qCap);
        scl.set(thick * 1.4, thick * 1.4, 1); // oversized hex caps — dominate the frame
        m4.compose(pos, qTmp, scl);
        caps.setMatrixAt(idx, m4);
        const glow = 0.2 + band * 0.85 + midHit * 0.55 + kick * 0.4 + (s > 0.85 ? highHit * 0.9 : 0);
        capCol.copy(col).multiplyScalar(glow * 0.6);
        caps.setColorAt(idx, capCol);
      }
    }
    pillars.instanceMatrix.needsUpdate = true; pillars.instanceColor.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true; caps.instanceColor.needsUpdate = true;
    capMat.opacity = 0.04 + kick * 0.08; // 9b ≤0.12
    // Pass 6a portal gates — magenta↔cyan alternate, twist per depth, kick lurch
    gateLurch *= 0.85;
    for (let g = 0; g < GATES; g++) {
      gateZ[g] += speed * dt * 1.6 + gateLurch;
      if (gateZ[g] > 5) gateZ[g] -= GATE_DEPTH;
      const z = gateZ[g];
      const depthT = (-z + 5) / GATE_DEPTH;
      const rad = 1.4 + depthT * 3.6 + bass * 0.45 + bassAtt * 0.3; // 7a: near rings fill frame
      const twist = g * 0.11 + depthT * 1.6 + t * 0.35 + bassTime * 0.18; // 7a per-ring twist + spiral
      pos.set(0, 0, z);
      q.setFromAxisAngle(zAxis, twist);
      scl.set(rad, rad, 1);
      m4.compose(pos, q, scl);
      gates.setMatrixAt(g, m4);
      rims.setMatrixAt(g, m4);
      gateCol.copy(NEONS[g % 4]);
      // 6e: near-camera gates dimmer so idle centre stays ≤120
      const near = Math.max(0, 1 - depthT);
      gateCol.multiplyScalar(0.5 + kick * 1.6 + near * 0.1); // 9b rims = accent // 7a hot MAG/CYAN
      rims.setColorAt(g, gateCol);
    }
    gates.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true; rims.instanceColor.needsUpdate = true;



    for (let i = 0; i < STAR_N; i++) {
      starPos[i * 3 + 2] += speed * dt * 1.3;
      if (starPos[i * 3 + 2] > 4) resetStar(i, starPos[i * 3 + 2] - DEPTH);
    }
    starGeo.attributes.position.needsUpdate = true;
    stars.material.opacity = 0.15 + treble * 0.25;

    // Pass 3a Glob morph — bass size, kick punch, mid palette, treble ripples
    // keep radius modest so centre-third stays dark for TikTok hook text
    const targetGlob = 0.42 + bass * 0.35 + bassAtt * 0.18 + kick * 0.32;
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
        kick * 0.14 * Math.sin(n * 9 + t * 8) + bassHit * 0.08 * Math.sin(n * 5 + t * 4);
      const r = 1 + w;
      posArr[i] = nx * r; posArr[i + 1] = ny * r; posArr[i + 2] = nz * r;
    }
    globGeo.attributes.position.needsUpdate = true;
    globGeo.computeVertexNormals();
    glob.scale.setScalar(globScale);
    glob.rotation.y = t * 0.35 + bassTime * 0.05;
    glob.rotation.x = Math.sin(t * 0.4) * 0.25 + mid * 0.15;
    cosPalette(0.55 + palDrive * 0.5 + kick * 0.1, PAL_A, PAL_B, PAL_C, PAL_D, globCol);
    globMat.color.copy(globCol).multiplyScalar(0.42);
    globMat.emissive.copy(globCol).multiplyScalar(0.03 + kick * 0.35 + bassHit * 0.2);
    shellMat.color.copy(globCol);
    shellMat.opacity = 0.06 + mid * 0.12 + kick * 0.15;
    shell.rotation.y = -t * 0.55;

    // organic corkscrew camera
    const drift = 0.45 + mid * 0.6 + bass * 0.3; // 7a committed corkscrew
    camera.position.x = Math.sin(t * 0.6 + bassTime * 0.12) * drift;
    camera.position.y = Math.cos(t * 0.6 + bassTime * 0.12) * drift * 0.8;
    camera.rotation.z = Math.sin(t * 0.15) * 0.35 + bassTime * 0.01 + mid * 0.08;
    // 7b: shake jitter + aggressive Z punch (decay fast)
    camera.position.x += (Math.random() * 2 - 1) * shakeA;
    camera.position.y += (Math.random() * 2 - 1) * shakeA;
    camera.position.z = 3 - zPunch;
    camera.lookAt((Math.random() * 2 - 1) * shakeA * 2, (Math.random() * 2 - 1) * shakeA * 2, -40 + zPunch * 6); // lookAt snap
    camera.rotateX(-0.18); // 9b look-down so wet floor is in frame
    camera.rotation.z += Math.sin(t * 0.15) * 0.35 + bassTime * 0.04;
    camera.fov = 72 - kick * 22 - (flashLeft > 0 ? 8 : 0); camera.updateProjectionMatrix();
    const ks = 1 + kick * 0.14 + popS; root.scale.set(ks, ks, 1);
    camLight.position.copy(camera.position);
    camLight.intensity = 26 + bass * 35 + kick * 25;
    backLight.intensity = 90 + bass * 120 + kick * 260; backLight.color.copy(NEONS[hueSnap % 4]);
    // glob tracks camera lightly — stays in centre-third for hook overlay
    glob.position.x = camera.position.x * 0.35;
    glob.position.y = camera.position.y * 0.35;
    glob.position.z = -5 + Math.sin(t * 0.5) * 0.15;

    // frame-rate independent trails: pow so large dt (low fps) shortens pers    // 6a: kaleido demoted to light edge accent
    const peak = audio.peakHold || kick;
    const targetN = 6 + Math.round(mid * 2) + (peak > 0.55 ? 2 : 0);
    kaleidoN += (targetN - kaleidoN) * 0.2;
    kaleidoOff += dt * (0.12 + mid * 0.35 + bassTime * 0.02) + peak * 0.12;
    kaleido.uniforms.segments.value = Math.max(4, Math.min(10, kaleidoN));
    kaleido.uniforms.offset.value = kaleidoOff;
    kaleido.uniforms.mixAmt.value = flashLeft > 0 ? 0.2 : 0.04 + midAtt * 0.03; // 9b no ribbon shred // light edge only

    // Kick flash / snatch — 1–3f, ≤3/s, from kick + bassAtt (not continuous bass)
    // 6e: fewer false opens that spiked idle ~185
    const wantFlash = (kick > 0.62 || (bassAtt > 0.78 && peak > 0.6) || bassHit > 0.84); // 9a more kicks fire
    if (wantFlash && (t - lastFlashT) > 0.34) {
      lastFlashT = t;
      flashLeft = 2 + (peak > 0.8 ? 1 : 0); // 2–3 frames
      flashMode = peak > 0.75 ? 1 : (kick > 0.6 ? (Math.random() > 0.5 ? 2 : 3) : 4);
      gateLurch = GATE_SPACING * 1.0; // gate lurch one step
      afterCool = Math.max(afterCool, 30);
      glitchLeft = Math.max(glitchLeft, 8);
      popS = 0.22 + kick * 0.05; shakeA = 0.5; zPunch = 2.3; hueSnap = (hueSnap + 1) % 5;
      flashMode = [2, 3, 5, 6, 7][hueSnap]; if (peak > 0.85) flashMode = 1; // 7b hue snap mag/cyan/white
    }
    if (bassHit > 0.6 || kick > 0.5) { zPunch = Math.max(zPunch, 1.4 * Math.max(kick, bassHit)); shakeA = Math.max(shakeA, 0.22 * kick); popS = Math.max(popS, 0.12 * kick); }
    const vd = Math.pow(0.78, Math.max(0.5, dt * 60));
    popS *= vd; shakeA *= vd; zPunch *= Math.pow(0.85, Math.max(0.5, dt * 60));
    if (flashLeft > 0) {
      kickFlash.uniforms.mode.value = flashMode;
      kickFlash.uniforms.amt.value = 1.0; // 7b near-full burst
      flashLeft--;
      dampBase_force = 0.05;
      if (flashLeft === 0) settleKill = Math.max(settleKill, 18); // 6d: snap pocket dark after hard cut
    } else {
      // 6c: hard cut after 2–3f — no magenta fade tail
      kickFlash.uniforms.mode.value = 0;
      kickFlash.uniforms.amt.value = 0;
      dampBase_force = 0;
    }

    // kill Afterimage on kick/peak so hits stay sharp in stills
    if (kick > 0.4 || peak > 0.6 || highHit > 0.35 || bassHit > 0.55) {
      glitchLeft = Math.max(glitchLeft, 10);
      afterCool = Math.max(afterCool, 18);
    }
    let dampBase = 0.1 + Math.min(0.03, bass * 0.02); // 9b sharper
    if (dampBase_force) dampBase = dampBase_force;
    if (peak > 0.5) dampBase = Math.min(dampBase, 0.08);
    if (afterCool > 0) { dampBase = Math.min(dampBase, 0.04); afterCool--; }
    // 6d: wipe afterimage trail that kept settle ~146 after hard-cut snatch
    if (settleKill > 0) { dampBase = 0; settleKill--; }
    after.uniforms.damp.value = Math.pow(dampBase, Math.max(0.5, dt * 60));
    bloom.strength = flashLeft > 0 ? 1.5 + kick * 0.3 : (settleKill > 0 || (afterCool > 0 && flashLeft <= 0) ? 0.05 : 0.32) + Math.min(0.45, kick * 0.35 + (kick > 0.3 ? bass * 0.1 + bassAtt * 0.08 : bass * 0.03));
    voidGate.uniforms.open.value = flashLeft > 0 ? 1 : 0; // only the 1–3f snatch escapes the clamp
    // 6d: tighter settle clamp (idle floor) after snatch
    voidGate.uniforms.cap.value = settleKill > 0 ? 0.36 : 0.40;
    voidGate.uniforms.radius.value = settleKill > 0 ? 0.46 : 0.42;
    scene.background.setHex(flashLeft > 0 ? BG : 0x000000); // blackout between hits
    renderer.toneMappingExposure = flashLeft > 0 ? 2.8 : (settleKill > 0 ? 0.62 : (afterCool > 0 ? 0.72 : 0.82));
    if (glitchLeft > 0) {
      glitch.uniforms.amount.value = 0.035 + kick * 0.03 + highHit * 0.025;
      glitch.uniforms.angle.value = (Math.random() * 2 - 1) * Math.PI;
      glitch.uniforms.seed.value = Math.random() * 10;
      glitch.uniforms.colShift.value = 0.012 + highHit * 0.01;
      glitchLeft--;
    } else {
      glitch.uniforms.amount.value = 0;
    }
    composer.render();
  }
  return { frame, renderer };
}
