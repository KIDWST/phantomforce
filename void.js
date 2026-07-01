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
// Email-gated demo: the visitor leaves their email and gets an automated email
// with the PhantomForce demo download. Submits to the backend /register route.
// On localhost it targets the local proxy so you can test end-to-end; in
// production it targets the Pangolin-exposed proxy.
const REGISTER_ENDPOINT =
  (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "http://127.0.0.1:8788/register"
    : "https://ai.phantomforce.online/register";
async function registerForDemo(name, email) {
  if (!REGISTER_ENDPOINT) return true; // no endpoint -> optimistic local preview
  try {
    const r = await fetch(REGISTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    return r.ok;
  } catch { return false; }
}
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
  const downloadCta = document.querySelector("[data-download-cta]");
  const downloadModal = document.querySelector("[data-download-modal]");
  const downloadForm = document.querySelector("[data-download-form]");
  const downloadName = document.querySelector("[data-download-name]");
  const downloadEmail = document.querySelector("[data-download-email]");
  const downloadStatus = document.querySelector("[data-download-status]");
  const hint = document.querySelector("[data-hint]");
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

  const showDownload = () => { if (downloadCta) downloadCta.hidden = false; };
  const finish = () => {
    setOrbits([]);
    showDownload();
  };

  const openDownload = () => {
    if (!downloadModal) return;
    downloadModal.hidden = false;
    document.body.classList.add("modal-open");
    if (downloadStatus) downloadStatus.hidden = true;
    window.setTimeout(() => downloadName?.focus(), 40);
  };
  const closeDownload = () => {
    if (!downloadModal) return;
    downloadModal.hidden = true;
    document.body.classList.remove("modal-open");
    downloadCta?.focus();
  };

  downloadCta?.addEventListener("click", openDownload);
  document.querySelectorAll("[data-download-close]").forEach((btn) => btn.addEventListener("click", closeDownload));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && downloadModal && !downloadModal.hidden) closeDownload();
  });

  // Name + email -> automated demo email. Paid access is still guarded by the
  // proxy's owner-only /upgrade route after subscription activation.
  downloadForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (downloadName?.value || "").trim();
    const email = (downloadEmail?.value || "").trim();
    if (name.length < 2) {
      if (downloadStatus) {
        downloadStatus.hidden = false;
        downloadStatus.className = "download-status err";
        downloadStatus.textContent = "Enter your name to unlock the download.";
      }
      downloadName?.focus();
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      if (downloadStatus) {
        downloadStatus.hidden = false;
        downloadStatus.className = "download-status err";
        downloadStatus.textContent = "Enter a valid email so I can send your download.";
      }
      downloadEmail?.focus();
      return;
    }
    const btn = downloadForm.querySelector("button[type='submit']");
    if (btn) btn.disabled = true;
    registerForDemo(name, email).then((ok) => {
      if (!downloadStatus) return;
      downloadStatus.hidden = false;
      downloadStatus.className = `download-status ${ok ? "ok" : "err"}`;
      downloadStatus.textContent = ok
        ? "Check your email — your PhantomForce download is on its way."
        : "Couldn't reach me just now. Try again in a moment.";
      if (ok) downloadForm.classList.add("sent");
    }).finally(() => {
      if (btn) btn.disabled = false;
    });
  });

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
          speak(ai.message || "That's your free questions for now — download PhantomForce to go deeper.");
          showDownload();
          return;
        }
        if (ai && ai.reply) { window.setTimeout(() => speak(ai.reply), reduceMotion ? 120 : 540); return; }
        // free local responder: reactive, then capped to pull them in
        window.setTimeout(() => {
          if (typed > FREE_LIMIT) {
            speak("That's a taste. The full version runs 24/7, privately, for your whole business — download PhantomForce to go deeper.");
            showDownload();
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

/* ---------------- the phantom (WebGL 3D entity) ---------------- */
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
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 7);

    const ghost = new THREE.Group(); scene.add(ghost);   // the whole phantom: tilts, floats, shakes

    // ===== phantom body: a ghost of light — dome head, flowing body, and a
    //       RAGGED tendrilled hem (not a closed egg), flattened to face you =====
    const N = smallScreen ? 3200 : 6000;
    const GA = 2.399963229728653;
    const NTEND = 7;                                   // hanging tendrils around the hem
    const base = new Float32Array(N * 3), pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const v = k / (N - 1);                           // 0 = crown, 1 = hem
      const ang = k * GA;
      const tend = Math.pow(0.5 + 0.5 * Math.cos(ang * NTEND), 1.7);   // 0 between tendrils .. 1 at a tip
      const hemY = -0.6 - tend * 1.05;                 // ragged bottom edge dips at each tendril
      let R, y;
      if (v < 0.3) { const u = v / 0.3; R = Math.sin(u * Math.PI / 2); y = 1.55 - u * 0.95; }         // head dome
      else if (v < 0.6) { const u = (v - 0.3) / 0.3; R = 1 - 0.05 * Math.sin(u * Math.PI); y = 0.6 - u; }  // shoulders/body
      else { const u = (v - 0.6) / 0.4; R = 1 - 0.16 * u; y = -0.4 + u * (hemY + 0.4); }               // body -> tendrils
      const rr = R * (0.9 + 0.1 * (((k * 9301) % 233) / 233));
      const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr * 0.58;    // flattened front-to-back
      base[k * 3] = x; base[k * 3 + 1] = y; base[k * 3 + 2] = z;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const posAttr = geo.attributes.position;
    const bodyMat = new THREE.PointsMaterial({ color: new THREE.Color(0x33ffa0), size: 0.03, sizeAttenuation: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
    ghost.add(new THREE.Points(geo, bodyMat));
    const glowMat = new THREE.PointsMaterial({ color: new THREE.Color(0x0d7d50), size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
    ghost.add(new THREE.Points(geo, glowMat));         // soft volume glow (shares the geometry)

    // ===== ominous glowing eyes (drawn on top of the body) — no cheery smile =====
    const onTop = (m) => { m.transparent = true; m.depthTest = false; return m; };
    const socketMat = onTop(new THREE.MeshBasicMaterial({ color: 0x00140c }));
    const barMat = onTop(new THREE.MeshBasicMaterial({ color: 0xeafff6, blending: THREE.AdditiveBlending }));
    const EYE_Y = 0.74, EYE_Z = 0.62;
    const makeEye = (sx, tilt) => {
      const g = new THREE.Group(); g.position.set(sx, EYE_Y, EYE_Z); g.rotation.z = tilt; g.renderOrder = 10;
      const socket = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), socketMat); socket.scale.set(0.84, 1.5, 1);
      const glowEyeMat = onTop(new THREE.MeshBasicMaterial({ color: 0xaeffda, opacity: 0.95, blending: THREE.AdditiveBlending }));
      const gcore = new THREE.Mesh(new THREE.CircleGeometry(0.12, 26), glowEyeMat); gcore.scale.set(0.8, 1.42, 1); gcore.position.z = 0.01;
      g.add(socket, gcore); g.userData.glow = gcore; g.userData.mat = glowEyeMat; return g;
    };
    const eyeL = makeEye(-0.3, -0.16), eyeR = makeEye(0.3, 0.16); ghost.add(eyeL, eyeR);   // inner corners down = fierce

    const makeX = (sx) => {
      const g = new THREE.Group(); g.position.set(sx, EYE_Y, EYE_Z + 0.02); g.visible = false; g.renderOrder = 11;
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), barMat); b1.rotation.z = Math.PI / 4;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), barMat); b2.rotation.z = -Math.PI / 4;
      g.add(b1, b2); return g;
    };
    const xL = makeX(-0.3), xR = makeX(0.3); ghost.add(xL, xR);
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), onTop(new THREE.MeshBasicMaterial({ color: 0xff86a6 })));
    tongue.position.set(0, 0.2, EYE_Z + 0.05); tongue.visible = false; tongue.renderOrder = 11; ghost.add(tongue);

    // starfield backdrop
    const SF = 700, sf = new Float32Array(SF * 3);
    for (let k = 0; k < SF; k++) { sf[k * 3] = (Math.random() - 0.5) * 34; sf[k * 3 + 1] = (Math.random() - 0.5) * 22; sf[k * 3 + 2] = (Math.random() - 0.5) * 20 - 6; }
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute("position", new THREE.BufferAttribute(sf, 3));
    scene.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0x1ef0ff, size: 0.03, transparent: true, opacity: 0.4 })));

    const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize(); window.addEventListener("resize", resize, { passive: true });

    // --- gestures: look at cursor + smile on move + play dead on click ---
    let px = 0, py = 0, cpx = 0, cpy = 0;
    let happy = 0, dead = 0, blink = 3;
    const DEAD_T = 0.9;   // how long it plays dead (seconds)
    window.addEventListener("pointermove", (e) => {
      px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5;
      if (dead <= 0) happy = 1.1;
    }, { passive: true });
    canvas.addEventListener("pointerdown", () => { if (dead <= 0) { dead = DEAD_T; flare(); } });

    const t0 = performance.now();
    let running = true;
    document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });
    const frame = (now) => {
      if (!running) return;
      const t = ((now || performance.now()) - t0) * 0.001, dt = 0.016;
      pulse.v = Math.max(0, pulse.v - 0.02);
      happy = Math.max(0, happy - dt * 1.1);
      dead = Math.max(0, dead - dt);
      const isDead = dead > 0;
      const breath = 1 + Math.sin(t * 0.9) * 0.025 + pulse.v * 0.12;

      // ragged flowing hem + gentle breathing across the whole body
      const pa = posAttr.array;
      for (let k = 0; k < N; k++) {
        const j = k * 3;
        const bx = base[j], by = base[j + 1], bz = base[j + 2];
        let ny = by;
        if (by < -0.2) {                              // tendrils drift and flow
          const m = Math.min(1, (-0.2 - by) / 1.2);
          ny = by + (Math.sin(bx * 4 + t * 2.4) * 0.09 + Math.sin(bz * 5 - t * 1.7) * 0.05) * m;
        }
        const n = Math.sin(bx * 3 + t * 1.3) * Math.cos(by * 3 - t) * 0.05;
        const s = (1 + n) * breath;
        pa[j] = bx * s; pa[j + 1] = ny * breath; pa[j + 2] = bz * s;
      }
      posAttr.needsUpdate = true;
      bodyMat.color.setHex(isDead ? 0xff2020 : 0x33ffa0);   // red when it plays dead
      bodyMat.opacity = 0.86 + pulse.v * 0.14;
      glowMat.color.setHex(isDead ? 0xb00d0d : 0x0d7d50);
      glowMat.opacity = 0.16 + pulse.v * 0.16;

      // float; slump when dead
      ghost.position.y = Math.sin(t * 1.1) * 0.1 - (isDead ? (1 - dead / DEAD_T) * 0.45 : 0);

      // look toward cursor + gentle drift; shake like pac-man when dead
      cpx = lerp(cpx, px, 0.06); cpy = lerp(cpy, py, 0.06);
      let rx = cpy * 0.36, ry = cpx * 0.66 + Math.sin(t * 0.15) * 0.05, rz = 0;
      if (isDead) { const sh = dead / DEAD_T; rz = Math.sin(t * 42) * 0.2 * sh; rx += Math.sin(t * 35) * 0.12 * sh; }
      ghost.rotation.set(rx, ry, rz);

      // eyes: the glow drifts toward the cursor and intensifies when you move
      const foc = happy > 0 ? 1 : 0;
      const gx = cpx * 0.05, gy = -cpy * 0.05;
      [eyeL, eyeR].forEach((e) => {
        e.userData.glow.position.x = gx; e.userData.glow.position.y = gy;
        e.userData.mat.opacity = 0.78 + foc * 0.22 + pulse.v * 0.3;
      });

      // blink
      blink -= dt; if (blink < -0.13) blink = 2.4 + Math.random() * 3.4;
      const eyeSy = (blink < 0 && !isDead) ? 0.12 : 1;
      eyeL.visible = eyeR.visible = !isDead;
      xL.visible = xR.visible = isDead;
      tongue.visible = isDead;
      eyeL.scale.y = eyeR.scale.y = eyeSy;

      renderer.render(scene, camera); requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    canvas.classList.add("lit");
  } catch {}
}

/* ---------------- threat radar: risks a business faces ---------------- */
function initRiskRadar() {
  const field = document.querySelector("[data-riskfield]");
  if (!field || reduceMotion) return;
  // red = threats they face. blue = the everyday flood of real notifications
  // (a face, the app, a real question) — the burdens PhantomForce absorbs.
  const threats = ["malware", "scam", "data leak", "phishing", "chargeback", "law update", "spam", "fraud", "compliance", "deadline", "downtime", "bad review"];
  // real portraits + diverse names so the flood feels like actual people
  const rmu = (g, i) => `https://randomuser.me/api/portraits/${g}/${i}.jpg`;
  const stream = [
    { name: "Aaliyah Johnson", photo: rmu("women", 68), app: "Instagram", msg: "how much for a shoot?" },
    { name: "Diego Martínez", photo: rmu("men", 32), app: "Messenger", msg: "you free Saturday?" },
    { name: "Mei Chen", photo: rmu("women", 79), app: "Email", msg: "Re: your quote" },
    { name: "Liam O'Brien", photo: rmu("men", 45), app: "WhatsApp", msg: "can you call me back?" },
    { name: "Priya Patel", photo: rmu("women", 12), app: "Text", msg: "still on for 3pm?" },
    { name: "Marcus Williams", photo: rmu("men", 11), app: "Facebook", msg: "do you do weddings?" },
    { name: "Sofia Rossi", photo: rmu("women", 90), app: "Missed call", msg: "called twice" },
    { name: "Omar Hassan", photo: rmu("men", 64), app: "New lead", msg: "wants a callback today" },
    { name: "Nia Okafor", photo: rmu("women", 87), app: "TikTok", msg: "commented on your post" },
    { name: "Kenji Tanaka", photo: rmu("men", 76), app: "Voicemail", msg: "left you a message" },
    { name: "Chloe Dubois", photo: rmu("women", 54), app: "New review", msg: "left you 5 stars" },
    { name: "Rajesh Kumar", photo: rmu("men", 83), app: "Invoice", msg: "payment is overdue" },
    { name: "Fatima Al-Sayed", photo: rmu("women", 33), app: "Booking", msg: "needs to reschedule" },
    { name: "Lucas Silva", photo: rmu("men", 9), app: "Email", msg: "where's my order?" },
    { name: "Zara Ahmed", photo: rmu("women", 41), app: "Comment", msg: "is this available?" },
    { name: "Andre Thompson", photo: rmu("men", 51), app: "New DM", msg: "sent you the details" },
  ];
  // keep pings from overlapping each other OR the text UI in the middle
  const active = [];
  const overlaps = (a, b, pad) =>
    a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;
  const uiSel = "[data-wordmark], [data-say], [data-orbits], [data-speak], [data-download-cta], [data-download-modal]";
  const place = (ping) => {
    const W = innerWidth, H = innerHeight;
    const obstacles = active.map((e) => e.getBoundingClientRect())
      .concat(Array.from(document.querySelectorAll(uiSel)).map((el) => el.getBoundingClientRect()));
    for (let tries = 0; tries < 26; tries++) {
      const right = Math.random() < 0.5;                    // left or right band, fully random within
      const lp = right ? 76 + Math.random() * 21 : 3 + Math.random() * 21;
      const tp = 8 + Math.random() * 84;
      ping.style.left = lp + "%"; ping.style.top = tp + "%";
      const r = ping.getBoundingClientRect();
      if (r.width < 2 || r.left < 8 || r.right > W - 8 || r.top < 8 || r.bottom > H - 8) continue;   // keep on-screen
      let clash = false;
      for (const o of obstacles) { if (overlaps(r, o, 16)) { clash = true; break; } }
      if (!clash) return true;
    }
    return false;                                           // no clear spot -> skip this one
  };
  let lastThreat = -1;
  const spawn = () => {
    if (document.hidden) return;
    const threat = smallScreen ? true : Math.random() < 0.6;   // red threat dots outnumber the bubbles
    const ping = document.createElement("div");
    ping.style.visibility = "hidden";
    if (threat) {
      ping.className = "risk-ping threat";
      let ti; do { ti = Math.floor(Math.random() * threats.length); } while (threats.length > 1 && ti === lastThreat);
      lastThreat = ti;
      const dot = document.createElement("span"); dot.className = "risk-dot";
      const label = document.createElement("span"); label.className = "risk-label"; label.textContent = threats[ti];
      ping.append(dot, label);
    } else {
      const n = stream[Math.floor(Math.random() * stream.length)];
      ping.className = "risk-ping stream notif";
      const av = document.createElement("img");
      av.className = "notif-av"; av.src = n.photo; av.alt = ""; av.loading = "lazy"; av.referrerPolicy = "no-referrer";
      av.addEventListener("error", () => { av.classList.add("notif-av-blank"); av.removeAttribute("src"); });
      const body = document.createElement("span"); body.className = "notif-body";
      const name = document.createElement("b"); name.className = "notif-name"; name.textContent = n.name;
      const app = document.createElement("span"); app.className = "notif-app"; app.textContent = n.app;
      const msg = document.createElement("span"); msg.className = "notif-msg"; msg.textContent = n.msg;
      body.append(name, app, msg);
      ping.append(av, body);
    }
    field.appendChild(ping);
    if (!place(ping)) { ping.remove(); return; }            // couldn't fit without overlap -> skip
    ping.style.visibility = "";
    active.push(ping);
    requestAnimationFrame(() => ping.classList.add("on"));
    window.setTimeout(() => ping.classList.remove("on"), 3400);
    window.setTimeout(() => { ping.remove(); const i = active.indexOf(ping); if (i >= 0) active.splice(i, 1); }, 4400);
  };
  const tick = () => { spawn(); window.setTimeout(tick, 800 + Math.random() * 1300); };   // random 0.8-2.1s gap
  tick();
}

function boot() { initConversation(); initEntity(); initRiskRadar(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
