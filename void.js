/* PhantomForce — the void. Click-first cyber entity you can also speak to. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = { v: 0 };
const flare = () => { pulse.v = 1; };

/* Live brain: the public ai-proxy (server-side key only; per-visitor daily cap
   + burst throttle enforced there; read-only — it can only talk). Localhost
   targets the local proxy for end-to-end testing. If the proxy is down or
   unconfigured, askPhantom returns null and the built-in local responder
   answers instead — the page is never broken. */
const AI_ENDPOINT =
  (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "http://127.0.0.1:8788/chat"
    : "https://ai.phantomforce.online/chat";
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22000);
  try {
    const r = await fetch(REGISTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
      signal: ctrl.signal,
    });
    return r.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
async function askPhantom(message) {
  if (!AI_ENDPOINT) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 16000);   // reasoning models take a beat
  try {
    const r = await fetch(AI_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal: ctrl.signal });
    const d = await r.json();
    if (d && (d.error === "limit" || d.error === "busy")) return { limited: true, message: d.message };
    if (d && d.reply) return { reply: String(d.reply).slice(0, 600), remaining: typeof d.remaining === "number" ? d.remaining : null };
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
  const powerEls = Array.from(document.querySelectorAll("[data-power]"));
  const form = document.querySelector("[data-speak]");
  const input = document.querySelector("[data-speak-input]");
  const downloadCta = document.querySelector("[data-download-cta]");
  const downloadModal = document.querySelector("[data-download-modal]");
  const downloadForm = document.querySelector("[data-download-form]");
  const downloadName = document.querySelector("[data-download-name]");
  const downloadEmail = document.querySelector("[data-download-email]");
  const downloadStatus = document.querySelector("[data-download-status]");
  const hint = document.querySelector("[data-hint]");
  if (!say) return;

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
  const showDownload = () => { if (downloadCta) downloadCta.hidden = false; };

  // ---- the power tour: the entity walks through everything it runs, unprompted ----
  // one line per chip, same order as the [data-power] buttons in the HTML
  const powerLines = [
    "Every lead captured, answered, and chased — nothing slips.",
    "Your inbox, cleared — replies drafted and waiting on one tap.",
    "Your calendar runs itself: booked, reminded, reshuffled.",
    "Quotes sent, invoices chased, the money trail tracked.",
    "Posts, decks, docs, even video — created on command.",
    "Scams, leaks, and threats flagged before they cost you.",
  ];
  // after a full lap, the coda: every chip lit at once, the ask made plainly
  const codaLine = "The whole job — handled, around the clock. Take me with you.";
  let powerTimer = 0, powerIdx = -1, touring = true, beckonTimer = 0;
  const showPower = (i) => {
    powerIdx = i;
    powerEls.forEach((el, j) => el.classList.toggle("on", j === i));
    speak(powerLines[i]);
  };
  const showCoda = () => {
    powerIdx = -1;                                  // next tour step starts the lap over
    powerEls.forEach((el) => el.classList.add("on"));
    speak(codaLine);
    downloadCta?.classList.add("beckon");
    window.clearTimeout(beckonTimer);
    beckonTimer = window.setTimeout(() => downloadCta?.classList.remove("beckon"), 6200);
  };
  const scheduleTour = (ms) => {
    window.clearTimeout(powerTimer);
    powerTimer = window.setTimeout(() => {
      if (!touring) return;
      if (powerIdx === powerLines.length - 1) { showCoda(); scheduleTour(6600); }
      else { showPower(powerIdx + 1); scheduleTour(4600); }
    }, ms);
  };
  const stopTour = () => {
    touring = false;
    window.clearTimeout(powerTimer);
    window.clearTimeout(beckonTimer);
    powerEls.forEach((el) => el.classList.remove("on"));
    downloadCta?.classList.remove("beckon");
  };
  // a chip click jumps the tour straight to that power — a real answer, not a quiz step
  powerEls.forEach((el, i) => el.addEventListener("click", () => {
    touring = true;
    showPower(i);
    scheduleTour(7200);
  }));

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
    if (downloadStatus) {
      downloadStatus.hidden = false;
      downloadStatus.className = "download-status";
      downloadStatus.textContent = "Sending your PhantomForce download link...";
    }
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

  // Typed input = general live assistant (GLM 5.2 when configured; local responder otherwise).
  let typed = 0;
  const FREE_LIMIT = 5; // feel the power, then crave the full thing
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (input?.value || "").trim();
    if (!v) return;
    input.value = "";
    hint?.classList.add("gone");
    stopTour();                       // the visitor is talking now — the tour yields
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
        if (ai && ai.reply) {
          window.setTimeout(() => {
            speak(ai.reply);
            if (ai.remaining != null && input) {
              input.placeholder = ai.remaining > 0 ? `ask phantomforce… ${ai.remaining} left today` : "ask phantomforce…";
            }
          }, reduceMotion ? 120 : 540);
          return;
        }
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

  // boot: the entity wakes, introduces itself, then tours its powers on its own
  say.replaceChildren();
  window.setTimeout(() => {
    speak("I'm a private cyber-AI that runs your business. All of it.");
    scheduleTour(4300);
  }, 650);
}

/* ---------------- the sentinel core (WebGL 3D entity) ---------------- */
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, smallScreen ? 1.5 : 1.75));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 7);

    const entity = new THREE.Group(); scene.add(entity);   // the whole sentinel: tilts, floats, reacts

    // ===== Sentinel Core: a holographic shell sphere of light. Serious,
    //       watchful cyber-tech — same particle language, no cartoon ghost. =====
    const GA = 2.399963229728653;
    const SR = 1.12, CY = 0.35;                        // shell radius, core center height
    const N = smallScreen ? 1800 : 3200;
    const base = new Float32Array(N * 3), pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const y = 1 - (2 * k) / (N - 1);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = k * GA;
      const x = Math.cos(a) * r * SR, z = Math.sin(a) * r * SR, yy = CY + y * SR;
      base[k * 3] = x; base[k * 3 + 1] = yy; base[k * 3 + 2] = z;
      pos[k * 3] = x; pos[k * 3 + 1] = yy; pos[k * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const posAttr = geo.attributes.position;
    const bodyMat = new THREE.PointsMaterial({ color: new THREE.Color(0x33ffa0), size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    entity.add(new THREE.Points(geo, bodyMat));
    const glowMat = new THREE.PointsMaterial({ color: new THREE.Color(0x0d7d50), size: 0.14, sizeAttenuation: true, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });
    entity.add(new THREE.Points(geo, glowMat));        // soft volume glow (shares the geometry)

    // ===== diamond heart: bright particles on an octahedron, counter-rotating =====
    const OCT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const FACES = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    const NH = smallScreen ? 260 : 420, HR = 0.42;
    const hp = new Float32Array(NH * 3);
    for (let k = 0; k < NH; k++) {
      const [ai, bi, ci] = FACES[k % 8];
      let u = ((k * 137) % 97) / 97, v = ((k * 71) % 89) / 89;
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w3 = 1 - u - v;
      hp[k * 3] = (OCT[ai][0] * u + OCT[bi][0] * v + OCT[ci][0] * w3) * HR;
      hp[k * 3 + 1] = (OCT[ai][1] * u + OCT[bi][1] * v + OCT[ci][1] * w3) * HR;
      hp[k * 3 + 2] = (OCT[ai][2] * u + OCT[bi][2] * v + OCT[ci][2] * w3) * HR;
    }
    const hgeo = new THREE.BufferGeometry(); hgeo.setAttribute("position", new THREE.BufferAttribute(hp, 3));
    const heartMat = new THREE.PointsMaterial({ color: new THREE.Color(0xbfffe0), size: 0.026, sizeAttenuation: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const heartGlowMat = new THREE.PointsMaterial({ color: new THREE.Color(0x2effa6), size: 0.11, sizeAttenuation: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    const heart = new THREE.Group(); heart.position.y = CY;
    heart.add(new THREE.Points(hgeo, heartMat), new THREE.Points(hgeo, heartGlowMat));
    entity.add(heart);

    // ===== gyro rings: two tilted counter-spinning particle orbits =====
    const makeRing = (radius, count, hex, opacity) => {
      const rp = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        rp[k * 3] = Math.cos(a) * radius; rp[k * 3 + 1] = 0; rp[k * 3 + 2] = Math.sin(a) * radius;
      }
      const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
      return new THREE.Points(rg, new THREE.PointsMaterial({ color: new THREE.Color(hex), size: 0.03, sizeAttenuation: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    };
    const ringSpin1 = new THREE.Group(); ringSpin1.add(makeRing(1.55, 200, 0x33ffa0, 0.6));
    const ringTilt1 = new THREE.Group(); ringTilt1.rotation.set(1.05, 0, 0.15); ringTilt1.position.y = CY; ringTilt1.add(ringSpin1);
    const ringSpin2 = new THREE.Group(); ringSpin2.add(makeRing(1.78, 220, 0x1ef0ff, 0.4));
    const ringTilt2 = new THREE.Group(); ringTilt2.rotation.set(-0.55, 0, -0.3); ringTilt2.position.y = CY; ringTilt2.add(ringSpin2);
    entity.add(ringTilt1, ringTilt2);

    // ===== scan ring: a thin latitude line sweeping the shell top to bottom =====
    const onTop = (m) => { m.transparent = true; m.depthTest = false; return m; };
    const scanMat = onTop(new THREE.MeshBasicMaterial({ color: 0x9fffd4, opacity: 0.55, blending: THREE.AdditiveBlending }));
    const scan = new THREE.Mesh(new THREE.TorusGeometry(SR, 0.01, 8, 96), scanMat);
    scan.rotation.x = Math.PI / 2; scan.renderOrder = 9;
    entity.add(scan);

    // ===== the visor: one glowing scan bar — a bright glint patrols it =====
    const visor = new THREE.Group(); visor.position.set(0, CY + 0.36, 1.0); visor.renderOrder = 10;
    const visorBaseMat = onTop(new THREE.MeshBasicMaterial({ color: 0x2effa6, opacity: 0.42, blending: THREE.AdditiveBlending }));
    visor.add(new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.062), visorBaseMat));
    const glintMat = onTop(new THREE.MeshBasicMaterial({ color: 0xeafff6, opacity: 0.95, blending: THREE.AdditiveBlending }));
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), glintMat); glint.position.z = 0.01;
    visor.add(glint);
    entity.add(visor);

    // ===== data rain: code streams falling beneath the core =====
    const RN = smallScreen ? 240 : 400;
    const rp = new Float32Array(RN * 3), rs = new Float32Array(RN);
    for (let k = 0; k < RN; k++) {
      const a = ((k * 61) % 113) / 113 * Math.PI * 2;
      const rr = 0.15 + ((k * 43) % 89) / 89 * 0.75;
      rp[k * 3] = Math.cos(a) * rr;
      rp[k * 3 + 1] = -0.5 - ((k * 29) % 97) / 97 * 1.7;
      rp[k * 3 + 2] = Math.sin(a) * rr * 0.7;
      rs[k] = 0.55 + ((k * 17) % 31) / 31 * 0.9;
    }
    const rgeo = new THREE.BufferGeometry(); rgeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    const rainAttr = rgeo.attributes.position;
    const rainMat = new THREE.PointsMaterial({ color: new THREE.Color(0x2bdd8c), size: 0.03, sizeAttenuation: true, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false });
    entity.add(new THREE.Points(rgeo, rainMat));

    // starfield backdrop
    const SF = 700, sf = new Float32Array(SF * 3);
    for (let k = 0; k < SF; k++) { sf[k * 3] = (Math.random() - 0.5) * 34; sf[k * 3 + 1] = (Math.random() - 0.5) * 22; sf[k * 3 + 2] = (Math.random() - 0.5) * 20 - 6; }
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute("position", new THREE.BufferAttribute(sf, 3));
    scene.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0x1ef0ff, size: 0.03, transparent: true, opacity: 0.4 })));

    const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize(); window.addEventListener("resize", resize, { passive: true });

    // the sentinel lives in the layout's reserved zone (.phantom-zone), above the
    // dialogue — measured in pixels, mapped to world units at the entity's depth
    const zone = document.querySelector("[data-phantom-zone]");
    const GHOST_H = 4.0;                                 // world-unit height, top ring to rain tail
    let targetY = 0.9, targetS = smallScreen ? 0.75 : 1;
    const measureZone = () => {
      if (!zone || !innerHeight) return;
      const r = zone.getBoundingClientRect();
      if (r.height < 60) return;
      const wpp = (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z) / innerHeight;
      targetY = (innerHeight / 2 - (r.top + r.height * 0.52)) * wpp;
      targetS = Math.min(1.15, Math.max(0.45, (r.height * 0.95 * wpp) / GHOST_H));
    };
    measureZone();
    let gy = targetY - 0.8, gs = targetS * 0.9;          // wakes low + small, drifts into place
    window.addEventListener("resize", measureZone, { passive: true });
    if (window.ResizeObserver && zone) new ResizeObserver(measureZone).observe(zone);

    // --- gestures: track cursor + focus on move + OVERLOAD on click ---
    let px = 0, py = 0, cpx = 0, cpy = 0;
    let happy = 0, surge = 0, blink = 3;
    const SURGE_T = 0.9;   // overload duration (seconds): red glitch lockdown, then reform
    window.addEventListener("pointermove", (e) => {
      px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5;
      if (surge <= 0) happy = 1.1;
    }, { passive: true });
    canvas.addEventListener("pointerdown", () => { if (surge <= 0) { surge = SURGE_T; flare(); } });

    const t0 = performance.now();
    let running = true;
    document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });
    const frame = (now) => {
      if (!running) return;
      const t = ((now || performance.now()) - t0) * 0.001, dt = 0.016;
      pulse.v = Math.max(0, pulse.v - 0.02);
      happy = Math.max(0, happy - dt * 1.1);
      surge = Math.max(0, surge - dt);
      const surging = surge > 0, surgeN = surge / SURGE_T;
      const breath = 1 + Math.sin(t * 0.9) * 0.022 + pulse.v * 0.12;

      // shell: continuous slow spin + living shimmer; scatters during overload
      const spin = t * 0.32, cosR = Math.cos(spin), sinR = Math.sin(spin);
      const pa = posAttr.array;
      for (let k = 0; k < N; k++) {
        const j = k * 3;
        const bx = base[j], by = base[j + 1], bz = base[j + 2];
        const rx = bx * cosR + bz * sinR;
        const rz = -bx * sinR + bz * cosR;
        const n = Math.sin(rx * 3 + t * 1.3) * Math.cos(by * 3 - t) * 0.04;
        const jag = surging ? Math.sin(k * 3.1 + t * 57) * 0.14 * surgeN : 0;
        const s = (1 + n + jag) * breath;
        pa[j] = rx * s; pa[j + 1] = CY + (by - CY) * s; pa[j + 2] = rz * s;
      }
      posAttr.needsUpdate = true;
      bodyMat.color.setHex(surging ? 0xff2020 : 0x33ffa0);   // red under overload
      bodyMat.opacity = 0.55 + pulse.v * 0.2;
      glowMat.color.setHex(surging ? 0xb00d0d : 0x0d7d50);
      glowMat.opacity = 0.07 + pulse.v * 0.12;
      rainMat.color.setHex(surging ? 0xff4040 : 0x2bdd8c);

      // heart: counter-rotate and beat
      heart.rotation.y = -t * 1.1;
      heart.rotation.x = Math.sin(t * 0.7) * 0.15;
      const hs = 1 + Math.sin(t * 2.2) * 0.05 + pulse.v * 0.22 + (surging ? 0.18 * surgeN : 0);
      heart.scale.setScalar(hs);
      heartMat.color.setHex(surging ? 0xffb0b0 : 0xbfffe0);
      heartGlowMat.opacity = 0.12 + pulse.v * 0.18 + (surging ? 0.14 : 0);

      // gyro rings: opposite spins, quickening with the pulse
      ringSpin1.rotation.y = t * (0.7 + pulse.v * 0.6);
      ringSpin2.rotation.y = -t * (0.5 + pulse.v * 0.6);

      // scan ring sweeps the shell, top to bottom, then restarts
      const cyc = (t * 0.42) % 1.3;
      const sy = 1 - cyc * 1.65;
      if (sy > -1 && sy < 1) {
        const rr = Math.sqrt(Math.max(0.02, 1 - sy * sy));
        scan.visible = true;
        scan.position.y = CY + sy * SR;
        scan.scale.set(rr, rr, 1);
        scanMat.opacity = (0.5 * (1 - cyc * 0.4) + pulse.v * 0.2);
        scanMat.color.setHex(surging ? 0xff6060 : 0x9fffd4);
      } else scan.visible = false;

      // data rain: streams fall, loop, and hurry when the entity is engaged
      const ra = rainAttr.array;
      const rv = dt * (1 + pulse.v * 1.2 + (surging ? 0.8 : 0));
      for (let k = 0; k < RN; k++) {
        let y = ra[k * 3 + 1] - rs[k] * rv;
        if (y < -2.25) y = -0.5;
        ra[k * 3 + 1] = y;
      }
      rainAttr.needsUpdate = true;

      // settle into the reserved zone, float; judder under overload
      gy = lerp(gy, targetY, 0.05); gs = lerp(gs, targetS, 0.08);
      entity.scale.setScalar(gs);
      entity.position.y = gy + Math.sin(t * 1.1) * 0.1 * gs;

      // face the cursor with slow drift; shake hard while overloaded
      cpx = lerp(cpx, px, 0.06); cpy = lerp(cpy, py, 0.06);
      let rx2 = cpy * 0.3, ry2 = cpx * 0.55 + Math.sin(t * 0.15) * 0.05, rz2 = 0;
      if (surging) { rz2 = Math.sin(t * 47) * 0.16 * surgeN; rx2 += Math.sin(t * 39) * 0.1 * surgeN; }
      entity.rotation.set(rx2, ry2, rz2);

      // visor: the glint patrols the bar, leans toward the cursor, flares on
      // focus, and strobes under overload
      const foc = happy > 0 ? 1 : 0;
      const flicker = surging ? (Math.sin(t * 60) > -0.2 ? 1 : 0.15) : 1;
      glint.position.x = Math.sin(t * (1.4 + pulse.v * 1.6)) * 0.3 + cpx * 0.18;
      glint.position.y = -cpy * 0.03;
      glintMat.opacity = (0.75 + foc * 0.25 + pulse.v * 0.3) * flicker;
      glintMat.color.setHex(surging ? 0xffc9c9 : 0xeafff6);
      visorBaseMat.opacity = (0.38 + foc * 0.16 + pulse.v * 0.2) * flicker;
      visorBaseMat.color.setHex(surging ? 0xff5050 : 0x2effa6);

      // blink: a fast shutter pass, kept from the phantom
      blink -= dt; if (blink < -0.13) blink = 2.4 + Math.random() * 3.4;
      visor.scale.y = (blink < 0 && !surging) ? 0.15 : 1;

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
  const uiSel = "[data-wordmark], [data-say], [data-powers], [data-speak], [data-download-cta], [data-download-modal]";
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
