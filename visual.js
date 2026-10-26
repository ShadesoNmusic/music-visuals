import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Pass 11a: looks A concrete colonnade -> B neon spectrum beams -> C mandala spokes (instanced lerp crossfade); near-plane 1.0 + sightline clamp (min radial dist, size caps), onset-locked punch/flash. Was 10a: foot light-leak fix (neon lights high+deep, low idle) + hypnagogic morph colonnade<->mandala<->abstract spiral (~6s). Was 9c: solid opaque Box colonnade (one InstancedMesh, grey only), neon as lights only, half-res Reflector + wet plane floor in lower third; no afterimage/kaleido/additive. Was 9b: opaque mid-grey concrete mass, wet floor raised into view (Reflector half-res + shiny wet plane + neon strips), kaleido/afterimage cut for sharp stills; 9a kick violence + void clamp kept. Was 9a: concrete/stone weight (grain map, rough+wet spec), neon backlight bleed, dense gates, full-res wet Reflector floor, harder kick violence; void clamp kept
const W = 540, H = 960;
const RINGS = 16, PER_RING = 5, SPACING = 3.0; // 9c solid colonnade // sparse fat pillars; flats beat ring density
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
  scene.fog = new THREE.FogExp2(BG, 0.03); // 5b: less fog wash
  const camera = new THREE.PerspectiveCamera(72, W / H, 1.0, 200); // 11a near clip — slabs clip before filling lens
  camera.position.set(0, 0, 3);
  const root = new THREE.Group(); scene.add(root);

  scene.add(new THREE.AmbientLight(0xd8d4e0, 1.1));
  const camLight = new THREE.PointLight(0xffffff, 40, 30, 1.6);
  scene.add(camLight);

  // 9c concrete grain (tiny CanvasTexture)
  const grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 128;
  { const gx = grainCv.getContext('2d'); const id = gx.createImageData(128, 128);
    for (let i = 0; i < id.data.length; i += 4) { const v = 170 + Math.random() * 70 - ((i >> 2) % 37 === 0 ? 50 : 0); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    gx.putImageData(id, 0, 0); }
  const grainTex = new THREE.CanvasTexture(grainCv); grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping; grainTex.colorSpace = THREE.SRGBColorSpace;
  // Pass 9c — ONE opaque InstancedMesh of solid concrete boxes: colonnade rings (2 inner + 2 outer pillars + lintel)
  const FLOOR_Y = -1.3, CEIL_Y = 3.4;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a94a8, map: grainTex, roughnessMap: grainTex, roughness: 0.92, metalness: 0.08, emissive: 0x16141c, flatShading: true, transparent: false, opacity: 1 });
  const pillars = new THREE.InstancedMesh(geo, mat, COUNT);
  pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(pillars);
  const gateMat = mat;
  // 11a neon beam set (opaque MeshBasic, no additive) — visible only in morph phase B
  const beams = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), COUNT);
  beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
  root.add(beams);
  const beamCol = new THREE.Color();
  const GATE_SPACING = SPACING;
  let gateLurch = 0;
  // Neon = LIGHTS only, deep in tunnel behind pillars
  const backLight = new THREE.SpotLight(0xff1a9c, 120, 60, 0.7, 0.6, 1.2);
  backLight.position.set(0, 1, -40); backLight.target.position.set(0, 0, 3);
  scene.add(backLight); scene.add(backLight.target);
  const keyDir = new THREE.DirectionalLight(0xfff1e6, 3.2); keyDir.position.set(4, 3, 2); scene.add(keyDir); // side key — shaded faces
  const backDir = new THREE.DirectionalLight(0x2a6bff, 1.0); backDir.position.set(0, 0.4, -1); scene.add(backDir);
  const NL = [];
  const MAG = new THREE.Color(0xff00cc), CYAN = new THREE.Color(0x00fff2), HOTPINK = new THREE.Color(0xff2a8a), EBLUE = new THREE.Color(0x1a4dff);
  const NEONS = [MAG, CYAN, HOTPINK, EBLUE];
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(NEONS[i], 40, 18, 1.4); l.distance = 10; l.decay = 2; l.position.set(i % 2 ? 2.6 : -2.6, 2.6, -24 - i * 8) /* 10a high+deep: no foot blobs */; scene.add(l); NL.push(l); }
  // Reflector floor (half-res) + high-opacity wet Standard plane on top
  const floorRef = new Reflector(new THREE.PlaneGeometry(14, 100), {
    clipBias: 0.003, textureWidth: W >> 1, textureHeight: H >> 1, color: 0x9a90b0,
  });
  floorRef.rotation.x = -Math.PI / 2; floorRef.position.set(0, FLOOR_Y, -45); scene.add(floorRef);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 100), new THREE.MeshStandardMaterial({ color: 0x121018, roughness: 0.12, metalness: 0.85, transparent: true, opacity: 0.55, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR_Y + 0.01, -45); scene.add(floor);

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
  // 9c: stars not added (additive)

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
  glob.visible = false; scene.add(glob); // 9c hidden (read as pink blob) // not under root kick-scale — keeps hook framing stable
  const shellGeo = new THREE.IcosahedronGeometry(1.08, 2);
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  // 9c: shell not added (additive wire)
  const globCol = new THREE.Color();
  let globScale = 0.55;

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(2); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const after = new AfterimagePass(0.42); // 5b: much less blur — hits must read in stills
  // 9c: AfterimagePass not added (trails = ribbons)
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

  let t = 0, speed = 10, scroll = 0, morphT = 0;
  function frame(dt) {
    dt = Math.min(dt, 0.05);
    t += dt;
    const bass = audio.bass || 0, mid = audio.mid || 0, treble = audio.treble || 0;
    const kick = audio.kick || 0, bassAtt = audio.bassAtt || 0, midAtt = audio.midAtt || 0;
    const bassHit = audio.bassHit || 0, midHit = audio.midHit || 0, highHit = audio.highHit || 0;
    const bassTime = audio.bassTime || 0;

    speed += ((12 + bass * 34 + kick * 26 + Math.min(6, bassTime * 0.02)) - speed) * 0.45; // 9a harder snap // 7a fly-through // 5b: snappier rhythm
    scroll += speed * dt;
    const radius = 2.4 + bass * 0.85 + bassAtt * 0.5 + kick * 0.55;
    const thick = 1.25 + bass * 0.35 + bassHit * 0.28 + kick * 0.2;
    const palDrive = mid * 0.55 + midHit * 0.45 + bassHit * 0.25 + kick * 0.2 + bassTime * 0.03;
    const twist = t * 0.08 + bassTime * 0.03;
    const sp = spec();

    // 10a morph clock: ~6s per layout, mid hits nudge forward
    morphT += dt / 6 + (audio.onset ? 0.06 : 0); // 11a onset nudges morph (bar feel)
    const mPh = morphT % 3, morphI = Math.floor(mPh);
    const mf = Math.min(1, Math.max(0, (mPh - morphI - 0.45) / 0.55)); const morphF = mf * mf * (3 - 2 * mf);
    root.rotation.y = Math.sin(t * 0.07) * 0.08;
    // 9c solid colonnade: per ring [inner L, inner R, outer L, outer R, lintel]
    let idx = 0;
    gateLurch *= 0.6;
    for (let r = 0; r < RINGS; r++) {
      ringZ[r] += speed * dt + gateLurch * 0.3;
      if (ringZ[r] > 4) { ringZ[r] -= DEPTH; }
      const z = ringZ[r];
      const wob = Math.sin(t * 0.5 + ringPhase[r]) * 0.05;
      const hw = 2.1 + bass * 0.25, w = 0.95 + bassHit * 0.15, H2 = CEIL_Y - FLOOR_Y;
      const P = [ // A colonnade
        [-hw, FLOOR_Y + H2 / 2, w, H2, 1.0], [hw, FLOOR_Y + H2 / 2, w, H2, 1.0],
        [-hw - 1.7, FLOOR_Y + H2 / 2 - 0.2, 1.3, H2 - 0.4, 1.3], [hw + 1.7, FLOOR_Y + H2 / 2 - 0.2, 1.3, H2 - 0.4, 1.3],
        [0, CEIL_Y - 0.3, hw * 2 + w, 0.75, 1.0],
      ];
      for (let k = 0; k < PER_RING; k++, idx++) {
        const d = P[k];
        // 10a hypnagogic morph: A colonnade -> B mandala spokes -> C abstract spiral (~6s each)
        const sd = seed[idx];
        // 11a B: neon spectrum beams (thin tall bars along walls + top rail, height from spectrum)
        let bnd = 0; if (sp) bnd = sp[Math.floor(((k + r * PER_RING) % 32) * sp.length / 96)] || 0;
        const bx = [-2.3, 2.3, -3.4, 3.4, 0][k], bh = 1.2 + bnd * 3.4 + treble * 0.8;
        const B = k < 4 ? [bx, FLOOR_Y + bh / 2, 0.16, bh, 0.16, 0] : [0, CEIL_Y - 0.2, 4.6, 0.12, 0.16, 0];
        // 11a C: mandala/fractal spokes — two-level radial (spoke + sub-spoke), rotating per ring
        const aC = k * 2 * Math.PI / PER_RING + r * 0.4 + t * 0.3, rC = 2.4 + (r % 3) * 0.45 + (sd > 0.5 ? 0.9 : 0);
        const C = [Math.cos(aC) * rC, 0.6 + Math.sin(aC) * rC, 0.45 + (r % 2) * 0.3, 1.4 + (r % 3) * 0.5, 0.45, aC - Math.PI / 2 + Math.sin(t * 0.4 + r) * 0.3];
        const Aa = [d[0], d[1], d[2], d[3], d[4], wob * (k < 4 ? 0.2 : 0)];
        const L0 = morphI === 0 ? Aa : morphI === 1 ? B : C, L1 = morphI === 0 ? B : morphI === 1 ? C : Aa;
        const mx = (i) => L0[i] + (L1[i] - L0[i]) * morphF;
        // 11a sightline clamp: min radial distance from axis, cap near/non-colonnade sizes
        let sx = mx(2), sy = mx(3), sz = mx(4);
        const wA = morphI === 0 ? 1 - morphF : morphI === 2 ? morphF : 0;
        const wB = morphI === 0 ? morphF : morphI === 1 ? 1 - morphF : 0;
        const cap = (z > -6 ? 1.6 : 2.4) + wA * 4;
        sx = Math.min(sx, cap); sy = Math.min(sy, cap + wB * 4); sz = Math.min(sz, cap);
        let px = mx(0), py = mx(1) - 0.6;
        const minR = 1.7 + 0.5 * Math.min(sx, sy) + (z > -3 ? 0.6 : 0);
        const rr = Math.hypot(px, py) || 1e-3;
        if (rr < minR) { px *= minR / rr; py *= minR / rr; }
        pos.set(px, Math.max(FLOOR_Y + sy * 0.15, py + 0.6), z); q.setFromAxisAngle(zAxis, mx(5));
        const conc = Math.max(0.001, 1 - wB); // concrete dissolves into beams
        scl.set(sx * conc, sy * conc, sz * conc); m4.compose(pos, q, scl); pillars.setMatrixAt(idx, m4);
        scl.set(sx * Math.max(0.001, wB), sy * Math.max(0.001, wB), sz * Math.max(0.001, wB)); m4.compose(pos, q, scl); beams.setMatrixAt(idx, m4);
        beamCol.copy(NEONS[(k + r) % 4]).multiplyScalar(1.2 + bnd * 1.5 + kick * 1.5); beams.setColorAt(idx, beamCol);
        const v = 0.85 + seed[idx] * 0.3; col.setRGB(v, v * 0.98, v * (0.97 + seed[idx] * 0.06));
        pillars.setColorAt(idx, col);
      }
    }
    pillars.instanceMatrix.needsUpdate = true; pillars.instanceColor.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true; beams.instanceColor.needsUpdate = true;
    for (let i = 0; i < NL.length; i++) NL[i].intensity = 0.5 + bass * 1 + kick * 60; // 10a low idle



    for (let i = 0; i < STAR_N; i++) {
      starPos[i * 3 + 2] += speed * dt * 1.3;
      if (starPos[i * 3 + 2] > 4) resetStar(i, starPos[i * 3 + 2] - DEPTH);
    }
    starGeo.attributes.position.needsUpdate = true;
    stars.material.opacity = 0.15 + treble * 0.25;

    // Pass 3a Glob morph — bass size, kick punch, mid palette, treble ripples
    // keep radius modest so centre-third stays dark for TikTok hook text
    const targetGlob = Math.min(0.35, 0.2 + bass * 0.1 + kick * 0.1); // 9c small dark
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
    globMat.color.copy(globCol).multiplyScalar(0.15);
    globMat.emissive.copy(globCol).multiplyScalar(0.02 + kick * 0.1);
    shellMat.color.copy(globCol);
    shellMat.opacity = 0.06 + mid * 0.12 + kick * 0.15;
    shell.rotation.y = -t * 0.55;

    // organic corkscrew camera
    const drift = 0.08 + mid * 0.1; // 9c calm so floor reads // 7a committed corkscrew
    camera.position.x = Math.sin(t * 0.6 + bassTime * 0.12) * drift;
    camera.position.y = 0.6 + Math.cos(t * 0.6 + bassTime * 0.12) * drift * 0.8;
    
    // 7b: shake jitter + aggressive Z punch (decay fast)
    camera.position.x += (Math.random() * 2 - 1) * shakeA;
    camera.position.y += (Math.random() * 2 - 1) * shakeA;
    camera.position.z = 3 - zPunch;
    camera.lookAt((Math.random() * 2 - 1) * shakeA * 2, 0.6 + (Math.random() * 2 - 1) * shakeA * 2, -40 + zPunch * 6); // lookAt snap
    camera.rotateX(-0.2); // 9c look-down: floor ≈ lower third
    camera.rotation.z += (Math.random() * 2 - 1) * shakeA * 0.1;
    camera.fov = 72 - kick * 22 - (flashLeft > 0 ? 8 : 0); camera.updateProjectionMatrix();
    const ks = 1 + kick * 0.03 + popS * 0.35; // 11a small pop — no lens shove root.scale.set(ks, ks, 1);
    camLight.position.copy(camera.position);
    camLight.intensity = 26 + bass * 35 + kick * 25;
    backLight.intensity = 25 + bass * 30 + kick * 260; backLight.color.copy(NEONS[hueSnap % 4]);
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
    kaleido.uniforms.mixAmt.value = 0; // 9c off // light edge only

    // Kick flash / snatch — 1–3f, ≤3/s, from kick + bassAtt (not continuous bass)
    // 6e: fewer false opens that spiked idle ~185
    const onset = !!audio.onset; // 11a punches only on real onsets
    if (onset) { popS = 0.22; shakeA = 0.45; zPunch = 1.6; gateLurch = GATE_SPACING * 0.5; afterCool = Math.max(afterCool, 18); }
    if (onset && (t - lastFlashT) > 0.3) { // flash ≤3.3/s
      lastFlashT = t;
      flashLeft = 2 + (peak > 0.8 ? 1 : 0); // 2–3 frames
      flashMode = peak > 0.75 ? 1 : (kick > 0.6 ? (Math.random() > 0.5 ? 2 : 3) : 4);
      gateLurch = GATE_SPACING * 1.0; // gate lurch one step
      afterCool = Math.max(afterCool, 30);
      glitchLeft = Math.max(glitchLeft, 8);
      popS = 0.22 + kick * 0.05; shakeA = 0.5; zPunch = 2.3; hueSnap = (hueSnap + 1) % 5;
      flashMode = [2, 3, 5, 6, 7][hueSnap]; if (peak > 0.85) flashMode = 1; // 7b hue snap mag/cyan/white
    }
    if (false) { zPunch = Math.max(zPunch, 1.4 * Math.max(kick, bassHit)); shakeA = Math.max(shakeA, 0.22 * kick); popS = Math.max(popS, 0.12 * kick); }
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
    bloom.strength = flashLeft > 0 ? 1.5 + kick * 0.3 : (settleKill > 0 || (afterCool > 0 && flashLeft <= 0) ? 0.05 : 0.12) + Math.min(0.3, kick * 0.35 + (kick > 0.3 ? bass * 0.1 + bassAtt * 0.08 : bass * 0.03));
    voidGate.uniforms.open.value = flashLeft > 0 ? 1 : 0; // only the 1–3f snatch escapes the clamp
    // 6d: tighter settle clamp (idle floor) after snatch
    voidGate.uniforms.cap.value = settleKill > 0 ? 0.36 : 0.40;
    voidGate.uniforms.radius.value = settleKill > 0 ? 0.46 : 0.42;
    scene.background.setHex(flashLeft > 0 ? BG : 0x000000); // blackout between hits
    renderer.toneMappingExposure = flashLeft > 0 ? 2.8 : (settleKill > 0 ? 0.62 : (afterCool > 0 ? 0.85 : 1.0));
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
