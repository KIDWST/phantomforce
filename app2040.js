/* PhantomForce 2040 — chat engine + 3D environment. Defensive; never throws. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouch = window.matchMedia("(hover: none)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- chat conversation ---------------- */
function initChat() {
  const thread = document.querySelector("[data-thread]");
  const chips = document.querySelector("[data-chips]");
  const form = document.querySelector("[data-chat-form]");
  const input = document.querySelector("[data-chat-text]");
  const plan = document.querySelector("[data-plan]");
  if (!thread || !form) return;

  const steps = [
    {
      q: "Got it. What eats the most time right now?",
      chips: ["Leads & follow-up", "Scheduling", "Customer updates", "Admin & paperwork"],
    },
    {
      q: "Makes sense. What should I take off your plate first?",
      chips: ["Lead response", "Scheduling & reminders", "Client communication", "Documents & reporting"],
    },
    {
      q: "Perfect — building your plan now.",
      chips: [],
      final: true,
    },
  ];
  const answers = [];
  let i = 0;

  const scroll = () => { thread.scrollTop = thread.scrollHeight; };
  const addMsg = (text, who) => {
    const m = document.createElement("div");
    m.className = `msg ${who}`;
    if (who === "ai") {
      const a = document.createElement("span"); a.className = "msg-avatar"; a.textContent = "👻";
      m.appendChild(a);
    }
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = text;
    m.appendChild(b);
    thread.appendChild(m); scroll();
    return m;
  };
  const typing = () => {
    const m = document.createElement("div");
    m.className = "msg ai";
    m.innerHTML = '<span class="msg-avatar">👻</span><div class="bubble typing"><i></i><i></i><i></i></div>';
    thread.appendChild(m); scroll();
    return m;
  };
  const renderChips = (list) => {
    chips.replaceChildren(
      ...list.map((text) => {
        const b = document.createElement("button");
        b.type = "button"; b.dataset.answer = text; b.textContent = text;
        return b;
      }),
    );
    chips.hidden = list.length === 0;
  };

  const aiSay = (text, after) => {
    const t = typing();
    const delay = reduceMotion ? 250 : 750;
    window.setTimeout(() => { t.remove(); addMsg(text, "ai"); after && after(); }, delay);
  };

  const advance = (answer) => {
    addMsg(answer, "user");
    answers.push(answer);
    chips.hidden = true;
    const step = steps[i];
    i += 1;
    aiSay(step.q, () => {
      if (step.final) { showPlan(); }
      else { renderChips(step.chips); }
    });
  };

  const showPlan = () => {
    if (!plan) return;
    chips.hidden = true;
    const focus = (answers[2] || answers[1] || "lead response and follow-up").toLowerCase();
    const titleEl = plan.querySelector("[data-plan-title]");
    if (titleEl) titleEl.textContent = `Start with ${focus}.`;
    const list = plan.querySelector("[data-plan-list]");
    if (list) {
      const items = [answers[1] || "Recover your time", answers[2] || "Protect every follow-up", "One clear daily brief"];
      list.replaceChildren(...items.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
    }
    const link = plan.querySelector("[data-plan-link]");
    if (link) {
      const body = [
        `Business: ${answers[0] || "Not provided"}`,
        `Biggest time drain: ${answers[1] || "Not provided"}`,
        `First priority: ${answers[2] || "Not provided"}`,
      ].join("\n");
      link.href = `mailto:demo@phantomforce.online?subject=${encodeURIComponent("My free PhantomForce plan")}&body=${encodeURIComponent(body)}`;
    }
    plan.hidden = false;
    scroll();
  };

  chips?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-answer]");
    if (btn) advance(btn.dataset.answer);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (input?.value || "").trim();
    if (!v) return;
    input.value = "";
    if (i >= steps.length) { aiSay("Noted — open the plan below or send it over and we'll take it from here."); return; }
    advance(v);
  });
}

/* ---------------- reveal / appbar / tilt / cursor ---------------- */
function initReveal() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("in")); return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
  targets.forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 80}ms`; io.observe(el); });
}
function initAppbar() {
  const bar = document.querySelector("[data-appbar]");
  if (!bar) return;
  const sync = () => bar.classList.toggle("scrolled", window.scrollY > 10);
  sync(); window.addEventListener("scroll", sync, { passive: true });
}
function initTilt() {
  if (reduceMotion || isTouch) return;
  const title = document.querySelector("[data-tilt]");
  if (!title) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  window.addEventListener("pointermove", (e) => {
    tx = e.clientX / window.innerWidth - 0.5; ty = e.clientY / window.innerHeight - 0.5;
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
  const tick = () => {
    cx = lerp(cx, tx, 0.08); cy = lerp(cy, ty, 0.08);
    title.style.transform = `rotateY(${cx * 7}deg) rotateX(${-cy * 6}deg)`;
    if (Math.abs(cx - tx) > 0.001 || Math.abs(cy - ty) > 0.001) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
}
function initCursor() {
  if (isTouch || reduceMotion) return;
  const glow = document.querySelector("[data-cursor]");
  if (!glow) return;
  let gx = -100, gy = -100, x = -100, y = -100, raf = 0;
  window.addEventListener("pointermove", (e) => {
    x = e.clientX; y = e.clientY; glow.classList.add("active");
    if (!raf) raf = requestAnimationFrame(function loop() {
      gx = lerp(gx, x, 0.2); gy = lerp(gy, y, 0.2);
      glow.style.transform = `translate3d(${gx}px,${gy}px,0)`; raf = requestAnimationFrame(loop);
    });
  }, { passive: true });
  document.querySelectorAll(".pill-cta, .chat-input button, .chat-chips button").forEach((el) => {
    el.addEventListener("pointerenter", () => glow.classList.add("big"));
    el.addEventListener("pointerleave", () => glow.classList.remove("big"));
  });
}

/* ---------------- 3D neon environment ---------------- */
async function initWebGL() {
  if (reduceMotion || smallScreen) return;
  const canvas = document.querySelector("[data-bg-canvas]");
  if (!canvas) return;
  try { const p = document.createElement("canvas"); if (!(p.getContext("webgl2") || p.getContext("webgl"))) return; } catch { return; }
  let THREE;
  try { THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"); } catch { return; }
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 14);
    const group = new THREE.Group(); scene.add(group);

    const COLS = 72, ROWS = 48, GAP = 0.5, count = COLS * ROWS;
    const positions = new Float32Array(count * 3);
    let n = 0;
    for (let x = 0; x < COLS; x++) for (let z = 0; z < ROWS; z++) {
      positions[n++] = (x - COLS / 2) * GAP; positions[n++] = 0; positions[n++] = (z - ROWS / 2) * GAP;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(0x39ff8b), size: 0.05, sizeAttenuation: true,
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    points.rotation.x = -0.9; points.position.y = -3.4; group.add(points);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.2, 1),
      new THREE.MeshBasicMaterial({ color: 0x39ff8b, wireframe: true, transparent: true, opacity: 0.22 }),
    );
    core.position.set(3.4, 1.8, -1); group.add(core);

    const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize(); window.addEventListener("resize", resize, { passive: true });

    let px = 0, py = 0, cpx = 0, cpy = 0;
    window.addEventListener("pointermove", (e) => { px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5; }, { passive: true });
    let running = true;
    document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });

    const pos = geo.attributes.position, t0 = performance.now();
    const frame = (now) => {
      if (!running) return;
      const t = ((now || performance.now()) - t0) * 0.001;
      let k = 1;
      for (let x = 0; x < COLS; x++) for (let z = 0; z < ROWS; z++) {
        pos.array[k] = Math.sin(x * 0.35 + t) * 0.5 + Math.cos(z * 0.4 + t * 0.8) * 0.5; k += 3;
      }
      pos.needsUpdate = true;
      core.rotation.x += 0.0024; core.rotation.y += 0.0032;
      cpx = lerp(cpx, px, 0.04); cpy = lerp(cpy, py, 0.04);
      group.rotation.y = cpx * 0.5; group.rotation.x = cpy * 0.3;
      renderer.render(scene, camera); requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    canvas.classList.add("ready");
  } catch {}
}

function boot() { initChat(); initReveal(); initAppbar(); initTilt(); initCursor(); initWebGL(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
