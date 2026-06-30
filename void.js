/* PhantomForce — the void. Click-first cyber entity you can also speak to. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = { v: 0 };
const flare = () => { pulse.v = 1; };

/* Live brain: set this to your deployed proxy URL to switch the input from
   the local responder to live Claude (server-side key, 5-prompt daily cap +
   token limit enforced in the proxy). Empty = local responder. */
const AI_ENDPOINT = "";
async function askPhantom(message) {
  if (!AI_ENDPOINT) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(AI_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal: ctrl.signal });
    const d = await r.json();
    if (d && (d.error === "limit" || d.error === "busy")) return { limited: true, message: d.message };
    if (d && d.reply) return { reply: String(d.reply).slice(0, 320) };
  } catch { /* unreachable / timeout -> fall back to local responder */ }
  finally { clearTimeout(timer); }
  return null;
}
function localReply(text) {
  const s = (text || "").toLowerCase();
  if (/lead|inquir|prospect|follow/.test(s)) return "Leads get captured, answered, and chased automatically — nothing slips.";
  if (/sched|book|calendar|remind|appoint/.test(s)) return "Bookings, reminders, and changes get handled without the back-and-forth.";
  if (/repl|email|message|comm|text|dm/.test(s)) return "Replies are drafted the second they're needed — you approve, it sends.";
  if (/quote|price|money|invoice|pay|sales|deal/.test(s)) return "Quotes, follow-ups, and the money trail get drafted and tracked.";
  if (/content|video|post|deck|doc|social|website|site/.test(s)) return "Posts, docs, decks, and video get generated on command — private to you.";
  if (/privat|secure|safe|data|risk|malware|scam|phish/.test(s)) return "I watch the risks — scams, leaks, deadlines — and keep it all inside your business.";
  return "Tell me the task that's eating your hours and I'll take it off your plate.";
}

/* ---------------- conversation ---------------- */
function initConversation() {
  const say = document.querySelector("[data-say]");
  const orbits = document.querySelector("[data-orbits]");
  const form = document.querySelector("[data-speak]");
  const input = document.querySelector("[data-speak-input]");
  const summon = document.querySelector("[data-summon]");
  const hint = document.querySelector("[data-hint]");
  const phantom = document.querySelector("[data-phantom]");
  if (!say || !orbits) return;

  const captured = [];
  let beat = 0;

  let typeTimer = 0;
  const speak = (text, cls = "") => {
    window.clearTimeout(typeTimer);
    const p = document.createElement("p");
    p.className = `say-line ${cls}`.trim();
    say.replaceChildren(p);
    if (cls === "user" || cls === "thinking" || reduceMotion) {
      p.textContent = text;
    } else {
      // typewriter: the entity speaks
      let i = 0;
      const tick = () => {
        p.textContent = text.slice(0, i);
        if (i++ < text.length) typeTimer = window.setTimeout(tick, 15 + Math.random() * 24);
      };
      tick();
    }
    if (cls !== "user") flare();
  };
  const setOrbits = (list) => {
    orbits.replaceChildren(...list.map((t, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.answer = t; b.textContent = t;
      b.style.animationDelay = `${i * 60}ms`;
      return b;
    }));
  };
  const think = (then) => { speak("· · ·", "thinking"); flare(); window.setTimeout(then, reduceMotion ? 220 : 760); };

  const finish = () => {
    setOrbits([]);
    if (!summon) return;
    summon.href = `mailto:demo@phantomforce.online?subject=${encodeURIComponent("Build my PhantomForce operator")}&body=${encodeURIComponent(captured.map((c, i) => `(${i + 1}) ${c}`).join("\n"))}`;
    summon.hidden = false;
  };

  // beat content
  const businessReply = (t) => {
    const s = t.toLowerCase();
    if (/serv|trade|clean|repair|contract|plumb|landsc/.test(s)) return "A service business. I'll capture every lead, book the work, and chase the follow-ups you forget.";
    if (/sport|team|league|coach|athlet|gym/.test(s)) return "A sports org. I'll run registrations, schedules, and parent comms so you stop living in your phone.";
    if (/media|content|creator|photo|video|film|market/.test(s)) return "Media. I'll keep shoots, clients, and deliverables moving — and spin up content and video on command.";
    if (/shop|store|ecom|commerce|product|brand/.test(s)) return "E-commerce. I'll handle orders, replies, and the busywork between sales.";
    return "Locked in. Now — what's the part that actually steals your hours?";
  };
  const drainReply = (t) => {
    const s = t.toLowerCase();
    if (/lead|inquir|prospect|follow/.test(s)) return "Done. Every lead captured, answered, and followed up — nothing slips.";
    if (/sched|book|calendar|remind|appoint/.test(s)) return "Done. Bookings, reminders, and changes handled without the back-and-forth.";
    if (/repl|email|message|comm|text|dm/.test(s)) return "Done. Drafted replies ready the second they're needed — you approve, I send.";
    if (/quote|price|money|invoice|pay|sales|deal/.test(s)) return "Done. Quotes, follow-ups, and the money trail — drafted and tracked.";
    if (/content|video|post|deck|doc|social|website|site/.test(s)) return "Done. Posts, docs, decks, video, even your site — generated on command, private to you.";
    return "Done. I'll fold that into your operator and handle it.";
  };

  const advance = (text) => {
    captured.push(text);
    hint?.classList.add("gone");
    speak(text, "user");
    const lower = text.toLowerCase();

    window.setTimeout(() => think(() => {
      if (beat === 0) {
        speak(businessReply(text));
        setOrbits(["Chasing leads", "Scheduling", "Replying to people", "Quotes & money", "Content & video"]);
        beat = 1;
      } else if (beat === 1) {
        speak(drainReply(text));
        setOrbits(["Build my operator", "How private is this?", "What can't it do?"]);
        beat = 2;
      } else {
        if (/privat|secure|safe|data/.test(lower)) {
          speak("Everything stays inside your business. It trains no one else. Nothing leaves without you.");
          setOrbits(["Build my operator", "What can't it do?"]);
        } else if (/can.?t|limit|won.?t|risk/.test(lower)) {
          speak("It won't send, post, spend, or sign without your say. You stay in control — always.");
          setOrbits(["Build my operator", "How private is this?"]);
        } else {
          speak("Then it's settled. I've shaped an operator around how you work.");
          finish();
        }
      }
    }), reduceMotion ? 100 : 480);
  };

  orbits.addEventListener("click", (e) => {
    const b = e.target.closest("[data-answer]");
    if (b) advance(b.dataset.answer);
  });
  // Typed input = general live assistant (GLM 5.2 when configured; local responder otherwise).
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (input?.value || "").trim();
    if (!v) return;
    input.value = "";
    hint?.classList.add("gone");
    speak(v, "user");
    window.setTimeout(() => {
      speak("· · ·", "thinking");
      flare();
      askPhantom(v).then((ai) => {
        if (ai && ai.limited) {
          speak(ai.message || "That's your free questions for now — summon an operator to go deeper.");
          if (summon) summon.hidden = false;
          return;
        }
        window.setTimeout(() => speak(ai && ai.reply ? ai.reply : localReply(v)), reduceMotion ? 120 : 540);
      });
    }, reduceMotion ? 80 : 320);
  });

  // boot: the entity wakes and speaks first
  say.replaceChildren();
  window.setTimeout(() => {
    speak("I'm a private cyber-AI that runs your business. Point me at what's eating your time.");
    window.setTimeout(() => setOrbits(["Service business", "Sports org", "Media / creator", "E-commerce", "Something else"]), 1600);
  }, 650);
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
    camera.position.set(0, 0, 7.6);
    const root = new THREE.Group(); scene.add(root);

    // a ghost made of light: dome head, body, scalloped bottom fringe (a 3D
    // surface of revolution so it reads as a ghost from any angle).
    const N = smallScreen ? 1800 : 3000;
    const base = new Float32Array(N * 3), pos = new Float32Array(N * 3);
    const GA = 2.399963229728653;
    for (let k = 0; k < N; k++) {
      const v = k / (N - 1);                 // 0 = top, 1 = bottom
      const ang = k * GA;
      const R = v < 0.34 ? Math.sin((v / 0.34) * (Math.PI / 2)) * 0.95 : 0.95;
      let y = 1.12 - v * 2.24;               // top ~+1.12 -> bottom ~-1.12
      if (v > 0.72) {                        // wavy fringe at the bottom
        const f = (v - 0.72) / 0.28;
        y += f * 0.44 * (0.5 + 0.5 * Math.sin(ang * 5));
      }
      const rr = R * (0.8 + 0.2 * (((k * 9301) % 233) / 233));   // a little volume
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr * 0.72;   // slightly flatter front-to-back
      base[k * 3] = x; base[k * 3 + 1] = y; base[k * 3 + 2] = z;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const ent = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(0x41ffa1), size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(ent);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({ color: 0xb9ffe0, transparent: true, opacity: 0.5, wireframe: true }));
    root.add(core);
    const SF = 800, sf = new Float32Array(SF * 3);
    for (let k = 0; k < SF; k++) { sf[k * 3] = (Math.random() - 0.5) * 30; sf[k * 3 + 1] = (Math.random() - 0.5) * 20; sf[k * 3 + 2] = (Math.random() - 0.5) * 20 - 6; }
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
      ent.material.opacity = 0.82 + pulse.v * 0.18; ent.material.size = 0.035 + pulse.v * 0.02;
      core.rotation.x += 0.003; core.rotation.y += 0.004;
      core.scale.setScalar(1 + pulse.v * 0.5); core.material.opacity = 0.4 + pulse.v * 0.5;
      cpx = lerp(cpx, px, 0.04); cpy = lerp(cpy, py, 0.04);
      root.rotation.y = t * 0.05 + cpx * 0.6; root.rotation.x = cpy * 0.4;
      renderer.render(scene, camera); requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    canvas.classList.add("lit");
  } catch {}
}

/* ---------------- phantom moods + play dead ---------------- */
function initPhantomMoods() {
  const phantom = document.querySelector("[data-phantom]");
  if (!phantom) return;
  const eyes = phantom.querySelector(".eyes-live");
  let idle = 0;
  // eyes that track the cursor (smoothed)
  let ex = 0, ey = 0, tex = 0, tey = 0, eraf = 0;
  const animateEyes = () => {
    ex = lerp(ex, tex, 0.2); ey = lerp(ey, tey, 0.2);
    if (eyes) eyes.setAttribute("transform", `translate(${ex.toFixed(2)} ${ey.toFixed(2)})`);
    eraf = (Math.abs(ex - tex) > 0.01 || Math.abs(ey - tey) > 0.01) ? requestAnimationFrame(animateEyes) : 0;
  };
  window.addEventListener("pointermove", (e) => {
    if (phantom.classList.contains("dead")) return;
    phantom.classList.add("happy");
    window.clearTimeout(idle);
    idle = window.setTimeout(() => phantom.classList.remove("happy"), 1100);
    const r = phantom.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    tex = Math.max(-3.6, Math.min(3.6, ((e.clientX - cx) / (r.width / 2 || 1)) * 3.6));
    tey = Math.max(-2.6, Math.min(2.6, ((e.clientY - cy) / (r.height / 2 || 1)) * 3.0));
    if (!eraf) eraf = requestAnimationFrame(animateEyes);
  }, { passive: true });
  phantom.addEventListener("click", () => {
    if (phantom.classList.contains("dead")) return;
    phantom.classList.remove("happy");
    phantom.classList.add("dead");
    flare();
    tex = 0; tey = 0;
    if (!eraf) eraf = requestAnimationFrame(animateEyes);
    window.setTimeout(() => phantom.classList.remove("dead"), 1500);
  });

  // touch devices have no cursor — give the entity its own idle life
  if (window.matchMedia("(hover: none)").matches && !reduceMotion) {
    window.setInterval(() => {
      if (phantom.classList.contains("dead")) return;
      tex = (Math.random() - 0.5) * 5; tey = (Math.random() - 0.5) * 3.4;
      if (!eraf) eraf = requestAnimationFrame(animateEyes);
      phantom.classList.add("happy");
      window.setTimeout(() => phantom.classList.remove("happy"), 1500);
    }, 3600);
  }
}

/* ---------------- threat radar: risks a business faces ---------------- */
function initRiskRadar() {
  const field = document.querySelector("[data-riskfield]");
  if (!field || reduceMotion) return;
  // red = threats they face; cyan = the everyday flood PhantomForce absorbs
  const threats = ["malware", "scam", "data leak", "phishing", "chargeback", "law update", "spam", "fraud", "compliance", "deadline", "downtime", "bad review"];
  const stream = ["new email", "instagram dm", "missed call", "new booking", "5★ review", "invoice due", "follow-up", "facebook msg", "new lead", "tiktok comment", "voicemail", "appointment", "renewal", "support ticket", "late payment", "quote request"];
  const spawn = () => {
    if (document.hidden) return;
    const threat = Math.random() < 0.38;
    const pool = threat ? threats : stream;
    const ping = document.createElement("div");
    ping.className = "risk-ping " + (threat ? "threat" : "stream");
    const right = Math.random() < 0.5;
    ping.style.left = (right ? 72 + Math.random() * 22 : 6 + Math.random() * 22) + "%";
    ping.style.top = 12 + Math.random() * 76 + "%";
    const dot = document.createElement("span"); dot.className = "risk-dot";
    const label = document.createElement("span"); label.className = "risk-label";
    label.textContent = pool[Math.floor(Math.random() * pool.length)];
    ping.append(dot, label);
    field.appendChild(ping);
    requestAnimationFrame(() => ping.classList.add("on"));
    window.setTimeout(() => ping.classList.remove("on"), 3200);
    window.setTimeout(() => ping.remove(), 4200);
  };
  for (let i = 0; i < 4; i++) window.setTimeout(spawn, i * 650);
  window.setInterval(spawn, 1300);
}

function boot() { initConversation(); initEntity(); initPhantomMoods(); initRiskRadar(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
