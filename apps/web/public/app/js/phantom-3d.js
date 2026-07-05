import * as THREE from "../vendor/three.module.min.js";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const MOOD = {
  idle: { bob: 0.08, breathe: 0.018, ring: 0.42, pulse: 0.2, spin: 0.12 },
  listening: { bob: 0.055, breathe: 0.025, ring: 0.62, pulse: 0.34, spin: 0.16 },
  thinking: { bob: 0.045, breathe: 0.012, ring: 0.78, pulse: 0.56, spin: 0.22 },
  talking: { bob: 0.1, breathe: 0.034, ring: 0.88, pulse: 0.78, spin: 0.28 },
  menace: { bob: 0.035, breathe: 0.012, ring: 0.76, pulse: 0.62, spin: 0.18 },
};

const ACCENTS = {
  calm: 0x41ffa1,
  content: 0x60ffb4,
  happy: 0x84ffcf,
  bright: 0x60ff8c,
  alert: 0xff5c74,
  sad: 0x3ac89e,
  excited: 0x84ffcf,
};

export function createPhantomStage3D({ canvas, reduceMotion = false } = {}) {
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0.08, 5.4);

  const root = new THREE.Group();
  root.position.y = -0.1;
  scene.add(root);

  const planeGeo = new THREE.PlaneGeometry(2.7, 3.7, 12, 16);
  const shared = {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  };
  const bodyMat = new THREE.MeshBasicMaterial({
    ...shared,
    color: 0xffffff,
    opacity: 0.96,
  });

  const auraGroup = new THREE.Group();
  auraGroup.position.set(0, -0.08, -0.22);
  root.add(auraGroup);

  const auraRings = [];
  [
    { inner: 1.02, outer: 1.04, y: 0.16, z: -0.24, sx: 0.96, sy: 1.2, opacity: 0.12 },
    { inner: 1.23, outer: 1.245, y: 0.02, z: -0.3, sx: 1.02, sy: 1.34, opacity: 0.08 },
    { inner: 1.44, outer: 1.455, y: -0.18, z: -0.36, sx: 1.08, sy: 1.46, opacity: 0.055 },
  ].forEach((spec) => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x41ffa1,
      transparent: true,
      opacity: spec.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(spec.inner, spec.outer, 128), mat);
    ring.position.set(0, spec.y, spec.z);
    ring.scale.set(spec.sx, spec.sy, 1);
    ring.renderOrder = 1;
    auraGroup.add(ring);
    auraRings.push({ ring, baseOpacity: spec.opacity });
  });

  const body = new THREE.Mesh(planeGeo, bodyMat);
  body.position.set(0, 0.04, 0.04);
  body.renderOrder = 3;
  root.add(body);

  const ringGroup = new THREE.Group();
  ringGroup.position.y = -1.55;
  ringGroup.rotation.x = -1.21;
  scene.add(ringGroup);
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x41ffa1,
      transparent: true,
      opacity: 0.17 - i * 0.025,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.RingGeometry(0.72 + i * 0.16, 0.735 + i * 0.16, 96);
    const ring = new THREE.Mesh(geo, mat);
    ring.scale.y = 0.44;
    ringGroup.add(ring);
    rings.push(ring);
  }

  const particleCount = 180;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleSeeds = [];
  for (let i = 0; i < particleCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.55 + Math.random() * 1.45;
    const y = -1.45 + Math.random() * 3.15;
    particlePositions[i * 3] = Math.cos(a) * r;
    particlePositions[i * 3 + 1] = y;
    particlePositions[i * 3 + 2] = Math.sin(a) * r * 0.38 - 0.3;
    particleSeeds.push({ a, r, y, s: 0.35 + Math.random() * 1.4 });
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0x41ffa1,
    transparent: true,
    opacity: 0.55,
    size: 0.018,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  const textures = new Map();
  const loader = new THREE.TextureLoader();
  let activePose = null;
  let mood = "idle";
  let emotion = "calm";
  let pointerX = 0;
  let pointerY = 0;
  let smoothX = 0;
  let smoothY = 0;
  let alive = true;
  let started = false;

  function resolveAccent() {
    return ACCENTS[emotion] || ACCENTS.calm;
  }

  function applyAccent() {
    const color = resolveAccent();
    particleMat.color.setHex(color);
    for (const { ring } of auraRings) ring.material.color.setHex(color);
    for (const ring of rings) ring.material.color.setHex(color);
  }

  function fitPoseTexture(texture) {
    const img = texture?.image;
    if (!img?.width || !img?.height) return;
    const aspect = img.width / img.height;
    const h = 3.72;
    const w = h * aspect;
    const bodyScaleX = w / 2.7;
    body.scale.set(bodyScaleX, 1, 1);
    auraGroup.scale.set(Math.max(0.86, bodyScaleX * 0.92), 1, 1);
  }

  function getTexture(src) {
    if (textures.has(src)) return textures.get(src);
    const texture = loader.load(src, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;
      if (src === activePose?.src) fitPoseTexture(loaded);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.set(src, texture);
    return texture;
  }

  function setPose(pose) {
    if (!pose?.src) return;
    activePose = pose;
    const texture = getTexture(pose.src);
    bodyMat.map = texture;
    bodyMat.needsUpdate = true;
    fitPoseTexture(texture);
  }

  function setMood(nextMood = "idle", nextEmotion = "calm") {
    mood = nextMood || "idle";
    emotion = nextEmotion || "calm";
    applyAccent();
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  window.addEventListener("pointermove", (event) => {
    const box = canvas.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    pointerX = clamp((event.clientX - centerX) / Math.max(1, box.width), -0.22, 0.22);
    pointerY = clamp((event.clientY - centerY) / Math.max(1, box.height), -0.18, 0.18);
  }, { passive: true });

  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = now * 0.001;
    const m = MOOD[mood] || MOOD.idle;
    smoothX += (pointerX - smoothX) * 0.08;
    smoothY += (pointerY - smoothY) * 0.08;
    const talk = mood === "talking" ? Math.abs(Math.sin(t * 11.5)) : 0;
    const think = mood === "thinking" ? Math.abs(Math.sin(t * 4.8)) : 0;
    const pulse = m.pulse + talk * 0.24 + think * 0.12;

    root.position.y = -0.07 + Math.sin(t * 1.15) * m.bob + talk * 0.035;
    root.rotation.y = smoothX * 0.16 + Math.sin(t * 0.42) * 0.026;
    root.rotation.x = -smoothY * 0.034 + Math.sin(t * 0.52) * 0.008;
    root.rotation.z = smoothX * -0.012 + Math.sin(t * 0.35) * 0.005;
    const breathe = 1 + Math.sin(t * 1.6) * m.breathe + talk * 0.02;
    root.scale.set(breathe, breathe, 1);

    bodyMat.opacity = 0.93 + pulse * 0.04;
    auraGroup.position.x = -smoothX * 0.035;
    auraGroup.rotation.z = smoothX * -0.08 + Math.sin(t * 0.38) * 0.012;
    auraRings.forEach(({ ring, baseOpacity }, i) => {
      ring.rotation.z = t * (0.08 + i * 0.035);
      ring.material.opacity = baseOpacity + pulse * (0.018 + i * 0.004);
    });

    ringGroup.rotation.z += (0.002 + m.spin * 0.006) * (reduceMotion ? 0.2 : 1);
    ringGroup.scale.setScalar(1 + Math.sin(t * 1.25) * 0.025 + pulse * 0.04);
    rings.forEach((ring, i) => {
      ring.rotation.z = -t * (0.16 + i * 0.06);
      ring.material.opacity = (0.08 + m.ring * 0.16) * (1 - i * 0.13) + talk * 0.035;
    });

    const attr = particleGeo.getAttribute("position");
    for (let i = 0; i < particleCount; i++) {
      const seed = particleSeeds[i];
      const y = -1.55 + ((seed.y + t * seed.s * 0.18 + 1.55) % 3.35);
      const a = seed.a + t * (0.08 + m.spin * 0.18);
      attr.setXYZ(i, Math.cos(a) * seed.r, y, Math.sin(a) * seed.r * 0.38 - 0.28);
    }
    attr.needsUpdate = true;
    particles.rotation.y = root.rotation.y * 0.5;
    particleMat.opacity = 0.28 + pulse * 0.34;

    renderer.render(scene, camera);
  }

  function start() {
    if (started) return;
    started = true;
    requestAnimationFrame(frame);
  }

  function destroy() {
    alive = false;
    resizeObserver.disconnect();
    renderer.dispose();
    planeGeo.dispose();
    particleGeo.dispose();
    auraRings.forEach(({ ring }) => {
      ring.geometry.dispose();
      ring.material.dispose();
    });
    rings.forEach((ring) => ring.geometry.dispose());
  }

  applyAccent();
  start();
  return { setPose, setMood, resize, destroy };
}
