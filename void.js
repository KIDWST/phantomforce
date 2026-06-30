/* PhantomForce — the void. A living AI entity you speak to. Defensive; never throws. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a, b, t) => a + (b - a) * t;

/* shared pulse signal the entity reads when it "speaks" */
const pulse = { v: 0 };
const flare = () => { pulse.v = 1; };

/* ---------------- conversation (no backend, guided) ---------------- */
function initConversation() {
  const say = document.querySelector("[data-say]");
  const orbits = document.querySelector("[data-orbits]");
  const form = document.querySelector("[data-speak]");
  const input = document.querySelector("[data-speak-input]");
  const summon = document.querySelector("[data-summon]");
  const hint = document.querySelector("[data-hint]");
  if (!say || !form) return;

  const steps = [
    { line: (a) => `A ${a.toLowerCase()}. I can run that. What should I take off your plate first?`, orbits: ["Lead response", "Scheduling & reminders", "Client communication", "Docs & reporting"] },
    { line: () => `Done. I've shaped an operator around how you work — private to your business, nothing leaves without you.`, orbits: [], final: true },
  ];
  const answers = [];
  let i = 0;

  const speak = (text, cls = "") => {
    const p = document.createElement("p");
    p.className = `say-line ${cls}`.trim();
    p.textContent = text;
    say.replaceChildren(p);
    if (!cls) flare();
  };
  const think = (then) => {
    speak("· · ·", "thinking");
    flare();
    window.setTimeout(then, reduceMotion ? 240 : 820);
  };
  const setOrbits = (list) => {
    orbits.replaceChildren(
      ...list.map((t) => { const b = document.createElement("button"); b.type = "button"; b.dataset.answer = t; b.textContent = t.toLowerCase(); return b; }),
    );
    orbits.hidden = list.length === 0;
  };

  const finish = () => {
    orbits.hidden = true;
    if (!summon) return;
    const body = [
      `Business: ${answers[0] || "Not provided"}`,
      `First priority: ${answers[1] || "Not provided"}`,
    ].join("\n");
    summon.href = `mailto:demo@phantomforce.online?subject=${encodeURIComponent("Build my PhantomForce operator")}&body=${encodeURIComponent(body)}`;
    summon.hidden = false;
  };

  const answer = (text) => {
    answers.push(text);
    hint?.classList.add("gone");
    speak(text, "user");
    const step = steps[i];
    i += 1;
    window.setTimeout(() => {
      think(() => {
        speak(step.line(text));
        if (step.final) finish();
        else setOrbits(step.orbits);
      });
    }, reduceMotion ? 120 : 520);
  };

  orbits?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-answer]");
    if (b) answer(b.dataset.answer);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (input?.value || "").trim();
    if (!v) return;
    input.value = "";
    if (i >= steps.length) { speak("Your operator is ready — summon it below and we'll take it from here."); return; }
    answer(v);
  });
}

/* ---------------- the entity (WebGL) ---------------- */
async function initEntity() {
  if (reduceMotion) return;
  const canvas = document.querySelector("[data-void]");
  if (!canvas) return;
  try { const p = document.createElement("canvas"); if (!(p.getContext("webgl2") || p.getContext("webgl"))) return; } catch { return; }
  let THREE;
  try { THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"); } catch { return; }
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, smallScreen ? 1.2 : 1.6));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    camera.position.set(0, 0, 7.4);
    const root = new THREE.Group();
    scene.add(root);

    // The phantom: points on a sphere that breathe with noise.
    const N = smallScreen ? 1400 : 2600;
    const base = new Float32Array(N * 3);
    const pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const y = 1 - (k / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = k * 2.399963229728653; // golden angle
      const x = Math.cos(phi) * r, z = Math.sin(phi) * r;
      base[k * 3] = x; base[k * 3 + 1] = y; base[k * 3 + 2] = z;
      pos[k * 3] = x * 2; pos[k * 3 + 1] = y * 2; pos[k * 3 + 2] = z * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const ent = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(0x41ffa1), size: 0.035, sizeAttenuation: true,
      transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    root.add(ent);

    // bright inner core
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshBasicMaterial({ color: 0xb9ffe0, transparent: true, opacity: 0.5, wireframe: true }),
    );
    root.add(core);

    // faint starfield
    const SF = 800; const sf = new Float32Array(SF * 3);
    for (let k = 0; k < SF; k++) {
      sf[k * 3] = (Math.random() - 0.5) * 30;
      sf[k * 3 + 1] = (Math.random() - 0.5) * 20;
      sf[k * 3 + 2] = (Math.random() - 0.5) * 20 - 6;
    }
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute("position", new THREE.BufferAttribute(sf, 3));
    scene.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0x1ef0ff, size: 0.03, transparent: true, opacity: 0.4 })));

    const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize(); window.addEventListener("resize", resize, { passive: true });

    let px = 0, py = 0, cpx = 0, cpy = 0;
    window.addEventListener("pointermove", (e) => { px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5; }, { passive: true });
    let running = true;
    document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });

    const attr = geo.attributes.position, t0 = performance.now();
    const frame = (now) => {
      if (!running) return;
      const t = ((now || performance.now()) - t0) * 0.001;
      pulse.v = Math.max(0, pulse.v - 0.02);
      const breath = 1 + Math.sin(t * 0.9) * 0.04 + pulse.v * 0.22;
      for (let k = 0; k < N; k++) {
        const j = k * 3;
        const n = Math.sin(base[j] * 3 + t * 1.4) * Math.cos(base[j + 1] * 3 - t) * 0.12;
        const s = (1.9 + n) * breath;
        attr.array[j] = base[j] * s; attr.array[j + 1] = base[j + 1] * s; attr.array[j + 2] = base[j + 2] * s;
      }
      attr.needsUpdate = true;
      ent.material.opacity = 0.8 + pulse.v * 0.2;
      ent.material.size = 0.035 + pulse.v * 0.02;
      core.rotation.x += 0.003; core.rotation.y += 0.004;
      core.scale.setScalar(1 + pulse.v * 0.5);
      core.material.opacity = 0.4 + pulse.v * 0.5;
      cpx = lerp(cpx, px, 0.04); cpy = lerp(cpy, py, 0.04);
      root.rotation.y = t * 0.05 + cpx * 0.6;
      root.rotation.x = cpy * 0.4;
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    canvas.classList.add("lit");
  } catch {}
}

function boot() { initConversation(); initEntity(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
