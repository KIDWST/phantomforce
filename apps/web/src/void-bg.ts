/* PhantomForce cockpit — ambient living entity behind the operations UI.
   Injects a fixed background canvas and runs a subtle breathing phantom so the
   private app feels like it's running inside PhantomForce. Defensive: no WebGL
   or reduced-motion -> it simply does nothing (the CSS void backdrop remains). */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

async function initVoidBg(): Promise<void> {
  if (reduceMotion) return;
  if (document.querySelector("[data-void-bg]")) return;

  let probe: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const p = document.createElement("canvas");
    probe = (p.getContext("webgl2") || p.getContext("webgl")) as never;
  } catch {
    return;
  }
  if (!probe) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("data-void-bg", "");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "0",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 2s ease",
  } as CSSStyleDeclaration);
  document.body.appendChild(canvas);

  let THREE: any;
  try {
    const url = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
    THREE = await import(/* @vite-ignore */ url);
  } catch {
    canvas.remove();
    return;
  }

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, smallScreen ? 1.1 : 1.4));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    const root = new THREE.Group();
    scene.add(root);

    const N = smallScreen ? 1100 : 1900;
    const base = new Float32Array(N * 3);
    const pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const y = 1 - (k / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = k * 2.399963229728653;
      const x = Math.cos(phi) * r;
      const z = Math.sin(phi) * r;
      base[k * 3] = x; base[k * 3 + 1] = y; base[k * 3 + 2] = z;
      pos[k * 3] = x * 2; pos[k * 3 + 1] = y * 2; pos[k * 3 + 2] = z * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const ent = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(0x39ff8b), size: 0.03, sizeAttenuation: true,
      transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(ent);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshBasicMaterial({ color: 0xb9ffe0, transparent: true, opacity: 0.32, wireframe: true }),
    );
    root.add(core);

    const SF = 500;
    const sf = new Float32Array(SF * 3);
    for (let k = 0; k < SF; k++) {
      sf[k * 3] = (Math.random() - 0.5) * 34;
      sf[k * 3 + 1] = (Math.random() - 0.5) * 22;
      sf[k * 3 + 2] = (Math.random() - 0.5) * 20 - 6;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(sf, 3));
    scene.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0x1ef0ff, size: 0.025, transparent: true, opacity: 0.3 })));

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    let px = 0, py = 0, cpx = 0, cpy = 0;
    window.addEventListener("pointermove", (e) => {
      px = e.clientX / window.innerWidth - 0.5;
      py = e.clientY / window.innerHeight - 0.5;
    }, { passive: true });

    let running = true;
    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running) requestAnimationFrame(frame);
    });

    const attr = geo.attributes.position;
    const t0 = performance.now();
    const frame = (now?: number) => {
      if (!running) return;
      const t = ((now || performance.now()) - t0) * 0.001;
      const breath = 1 + Math.sin(t * 0.8) * 0.04;
      for (let k = 0; k < N; k++) {
        const j = k * 3;
        const noise = Math.sin(base[j] * 3 + t * 1.2) * Math.cos(base[j + 1] * 3 - t) * 0.12;
        const s = (1.95 + noise) * breath;
        attr.array[j] = base[j] * s;
        attr.array[j + 1] = base[j + 1] * s;
        attr.array[j + 2] = base[j + 2] * s;
      }
      attr.needsUpdate = true;
      core.rotation.x += 0.0026;
      core.rotation.y += 0.0034;
      cpx = lerp(cpx, px, 0.03);
      cpy = lerp(cpy, py, 0.03);
      root.rotation.y = t * 0.04 + cpx * 0.5;
      root.rotation.x = cpy * 0.35;
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    canvas.style.opacity = "0.5";
  } catch {
    canvas.remove();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initVoidBg());
} else {
  void initVoidBg();
}
