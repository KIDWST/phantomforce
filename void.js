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
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function localReply(text) {
  const s = (text || "").toLowerCase().trim();
  if (/^(hi|hey|hello|yo|sup|howdy|hiya|wassup|good (morning|evening|afternoon))\b/.test(s) || /^(what'?s up|hey phantom|hello phantom)/.test(s))
    return pick([
      "Hey. I'm PhantomForce — I run the boring half of your business so you don't. What's eating your time?",
      "Hello. Point me at the chaos — leads, messages, scheduling — and watch it go quiet.",
      "Hey there. I never sleep, never forget, and nothing leaves without you. What do you need handled?",
    ]);
  if (/who are you|what are you|your name|who'?s this|what is this/.test(s))
    return pick([
      "I'm PhantomForce — a private AI that runs your operations. The operator you couldn't afford to hire.",
      "PhantomForce. I quietly run the day-to-day of a business — privately, for you alone.",
    ]);
  if (/what can you do|what do you do|how do you (help|work)|capabilit|feature/.test(s))
    return pick([
      "I chase leads, draft your replies, book the jobs, build proposals, even make content — all approved by you.",
      "I handle the flood — messages, follow-ups, scheduling, quotes, content — so you do the work you love.",
    ]);
  if (/thank|thanks|cheers|appreciate/.test(s)) return "Anytime. And this is just a taste — imagine it running 24/7.";
  if (/how much|price|cost|pricing|expensive|afford|free/.test(s)) return "Less than the hours you're bleeding. Your operator works out the exact number with you.";
  if (/real|legit|trust|fake|believe|prove/.test(s)) return "Real, and private. Nothing trains anyone else, nothing sends without you.";
  if (/lead|inquir|prospect|follow.?up|chase/.test(s)) return pick(["Every lead captured, answered, and chased — nothing slips.", "Leads stop falling through. I catch them, reply, and keep following up."]);
  if (/sched|book|calendar|remind|appoint|reschedul/.test(s)) return pick(["Bookings, reminders, and changes — handled without the back-and-forth.", "Your calendar runs itself. I book, remind, and reshuffle."]);
  if (/repl|email|message|inbox|comm|\btext\b|\bdm\b|whatsapp|messenger/.test(s)) return pick(["Replies drafted the second they're needed — you approve, I send.", "I clear the inbox: answers waiting for one tap from you."]);
  if (/quote|invoic|money|\bpay\b|sales|deal|proposal/.test(s)) return pick(["Quotes, proposals, and the money trail — drafted and tracked.", "I turn an inquiry into a quote and chase the payment."]);
  if (/content|video|post|deck|\bdoc\b|social|website|\bsite\b|reel|tiktok|instagram/.test(s)) return pick(["Posts, docs, decks, and video — generated on command, private to you.", "Need content? I'll draft the post, the doc, even the video concept."]);
  if (/privat|secure|protect|data|risk|malware|phish|threat|hack|scam/.test(s)) return pick(["I watch the risks — scams, leaks, deadlines — and keep it locked inside your business.", "Protection's built in: I flag the scams and threats before they cost you."]);
  if (/help|stuck|overwhelm|too much|\bbusy\b|stress|no time|drowning/.test(s)) return pick(["That's exactly what I'm for. Tell me the one thing stealing your hours.", "Breathe. Hand me the part you dread and it's handled."]);
  return pick([
    "I hear you. Tell me the part of your business that never stops — that's where I start.",
    "Got it. Point me at the task you keep putting off and watch it disappear.",
    "Say the thing eating your day — leads, messages, money, content — and I'll take it.",
  ]);
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
  let typed = 0;
  const FREE_LIMIT = 5; // feel the power, then crave the full thing
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (input?.value || "").trim();
    if (!v) return;
    input.value = "";
    hint?.classList.add("gone");
    speak(v, "user");
    typed += 1;
    window.setTimeout(() => {
      speak("· · ·", "thinking");
      flare();
      askPhantom(v).then((ai) => {
        // live brain enforces its own per-day cap
        if (ai && ai.limited) {
          speak(ai.message || "That's your free questions for now — summon an operator to go deeper.");
          if (summon) summon.hidden = false;
          return;
        }
        if (ai && ai.reply) { window.setTimeout(() => speak(ai.reply), reduceMotion ? 120 : 540); return; }
        // free local responder: reactive, then capped to pull them in
        window.setTimeout(() => {
          if (typed > FREE_LIMIT) {
            speak("That's a taste of what I do. The full version runs 24/7, privately, for your whole business — summon your operator.");
            if (summon) summon.hidden = false;
          } else {
            speak(localReply(v));
          }
        }, reduceMotion ? 120 : 540);
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
  // red = threats they face. blue = the everyday flood of real notifications
  // (a face, the app, a real question) — the burdens PhantomForce absorbs.
  const threats = ["malware", "scam", "data leak", "phishing", "chargeback", "law update", "spam", "fraud", "compliance", "deadline", "downtime", "bad review"];
  const stream = [
    { face: "👩", app: "Instagram", msg: "how much for a shoot?" },
    { face: "🧔", app: "Messenger", msg: "you free Saturday?" },
    { face: "👨", app: "Email", msg: "Re: your quote" },
    { face: "👱‍♀️", app: "WhatsApp", msg: "can you call me back?" },
    { face: "🧑", app: "Text", msg: "still on for 3pm?" },
    { face: "👩‍🦰", app: "Facebook", msg: "do you do weddings?" },
    { face: "👨‍🦱", app: "Missed call", msg: "called twice" },
    { face: "🧑‍💼", app: "New lead", msg: "wants a callback today" },
    { face: "👩‍🦱", app: "TikTok", msg: "commented on your post" },
    { face: "👨‍🦳", app: "Voicemail", msg: "left you a message" },
    { face: "⭐", app: "New review", msg: "left you 5 stars" },
    { face: "🧾", app: "Invoice", msg: "payment is overdue" },
    { face: "👩", app: "Booking", msg: "needs to reschedule" },
    { face: "🧓", app: "Email", msg: "where's my order?" },
  ];
  const spawn = () => {
    if (document.hidden) return;
    const threat = Math.random() < 0.34;
    const ping = document.createElement("div");
    const right = Math.random() < 0.5;
    ping.style.left = (right ? 72 + Math.random() * 22 : 6 + Math.random() * 22) + "%";
    ping.style.top = 12 + Math.random() * 76 + "%";
    if (threat) {
      ping.className = "risk-ping threat";
      const dot = document.createElement("span"); dot.className = "risk-dot";
      const label = document.createElement("span"); label.className = "risk-label";
      label.textContent = threats[Math.floor(Math.random() * threats.length)];
      ping.append(dot, label);
    } else {
      const n = stream[Math.floor(Math.random() * stream.length)];
      ping.className = "risk-ping stream notif";
      const av = document.createElement("span"); av.className = "notif-av"; av.textContent = n.face;
      const body = document.createElement("span"); body.className = "notif-body";
      const app = document.createElement("b"); app.className = "notif-app"; app.textContent = n.app;
      const msg = document.createElement("span"); msg.className = "notif-msg"; msg.textContent = n.msg;
      body.append(app, msg);
      ping.append(av, body);
    }
    field.appendChild(ping);
    requestAnimationFrame(() => ping.classList.add("on"));
    window.setTimeout(() => ping.classList.remove("on"), 3400);
    window.setTimeout(() => ping.remove(), 4400);
  };
  for (let i = 0; i < 4; i++) window.setTimeout(spawn, i * 650);
  window.setInterval(spawn, 1300);
}

function boot() { initConversation(); initEntity(); initPhantomMoods(); initRiskRadar(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
