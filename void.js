/* PhantomForce — the void. Click-first cyber entity you can also speak to. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = { v: 0 };
const flare = () => { pulse.v = 1; };
let createPhantomCharacter;                     // loaded from ./app/js/character.js
const TAU_STAR = Math.PI * 2;
/* the character's conversational mood — speak() drives it, initEntity reads it */
const charState = { mood: "idle", emotion: "calm", until: 0 };
const setCharMood = (mood, emotion, ms) => {
  charState.mood = mood; charState.emotion = emotion;
  charState.until = ms ? performance.now() + ms : 0;
};

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
  if (/content|video|post|deck|\bdoc\b|social|website|\bsite\b|reel|tiktok|instagram|image|photo|ad|commercial/.test(s)) return pick(["Images, videos, posts, docs, and ads — generated through gated Media Lab workflows so credits stay protected.", "Yes, PhantomForce can make creative. Public demos stay capped; full image/video generation opens after signup and approval."]);
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
    if (cls === "user") setCharMood("listening", "calm", 1600);
    else if (cls === "thinking") setCharMood("thinking", "bright", 5000);
    else {
      const emo =
        /couldn'?t|limit|try again|that'?s your free|sorry/i.test(text) ? "sad" :
        /never sleeps|24\/7|worth every|handled|watch it (go|disappear)|stopped losing/i.test(text) ? "excited" :
        "calm";
      setCharMood("talking", emo, Math.max(1600, text.length * 42));
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
    "Posts, decks, docs, images, and video — created through gated Media Lab generation.",
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

/* ---------------- the phantom (animated character, 2D canvas) ---------------- */
async function initEntity() {
  if (reduceMotion) return;
  const canvas = document.querySelector("[data-void]");
  if (!canvas) return;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return;
  let character;
  try { ({ createPhantomCharacter } = await import("./app/js/character.js?v=phantom-live-20260705-21")); character = createPhantomCharacter({ small: smallScreen }); }
  catch { return; }

  let w = 0, h = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, smallScreen ? 1.75 : 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });

  // starfield backdrop (was three.js; now plain 2D)
  const stars = [];
  for (let k = 0; k < 110; k++) {
    stars.push({ x: ((k * 379) % 991) / 991, y: ((k * 613) % 997) / 997, tw: ((k * 131) % 89) / 89 * TAU_STAR, r: 0.6 + ((k * 47) % 31) / 31 });
  }

  // the phantom lives in the layout's reserved zone (.phantom-zone)
  const zone = document.querySelector("[data-phantom-zone]");
  const CHAR_H = 3.5;                                  // unit height, hood tip to tendrils
  let tx = w / 2, ty = h * 0.3, ts = 90;
  const measureZone = () => {
    if (!zone) return;
    const r = zone.getBoundingClientRect();
    if (r.height < 60) return;
    tx = r.left + r.width / 2;
    ty = r.top + r.height * 0.52;
    ts = Math.max(40, Math.min(150, (r.height * 0.95) / CHAR_H));
  };
  measureZone();
  let gx = tx, gy = ty + 90, gs = ts * 0.85;           // wakes low + small, drifts into place
  window.addEventListener("resize", measureZone, { passive: true });
  if (window.ResizeObserver && zone) new ResizeObserver(measureZone).observe(zone);

  // gestures: eyes follow the cursor; movement perks it up; a click provokes
  // a flash of MENACE — then it settles back to the smirk. When the cursor
  // drifts CLOSE, he notices you and turns attentive.
  let px = 0, py = 0, cpx = 0, cpy = 0, happy = 0, menace = 0;
  let pointerX = -9999, pointerY = -9999, attentive = false;
  window.addEventListener("pointermove", (e) => {
    px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5;
    pointerX = e.clientX; pointerY = e.clientY;
    if (menace <= 0) happy = 1.2;
  }, { passive: true });
  canvas.addEventListener("pointerdown", () => { if (menace <= 0) { menace = 1.1; flare(); } });

  const t0 = performance.now();
  let last = t0, running = true;
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });
  const frame = (now) => {
    if (!running) return;
    const t = ((now || performance.now()) - t0) * 0.001;
    const dt = Math.min(0.05, (now - last) * 0.001); last = now;
    pulse.v = Math.max(0, pulse.v - 0.02);
    happy = Math.max(0, happy - dt * 1.1);
    menace = Math.max(0, menace - dt);
    cpx += (px - cpx) * 0.07; cpy += (py - cpy) * 0.07;
    gx += (tx - gx) * 0.06; gy += (ty - gy) * 0.05; gs += (ts - gs) * 0.08;

    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);

    // drifting, twinkling stars
    for (const s of stars) {
      const a = 0.12 + 0.3 * Math.abs(Math.sin(t * 0.6 + s.tw));
      ctx2.fillStyle = `rgba(80,230,170,${a})`;
      const sx = (s.x + t * 0.004) % 1;
      ctx2.fillRect(sx * w, s.y * h, s.r, s.r);
    }

    // presence: hysteresis so he calmly notices the cursor entering his space
    const pdist = Math.hypot(pointerX - gx, pointerY - (gy - gs * 1.4));
    if (!attentive && pdist < gs * 2.0) attentive = true;
    else if (attentive && pdist > gs * 2.7) attentive = false;

    // mood: the conversation drives it; a click overrides with menace;
    // a close visitor gets his full attention
    if (charState.until && performance.now() > charState.until) { charState.mood = "idle"; charState.emotion = "calm"; charState.until = 0; }
    const mood = menace > 0 ? "menace" : (attentive && charState.mood === "idle" ? "listening" : charState.mood);
    const emotion = menace > 0 ? "alert" : (happy > 0 && charState.mood === "idle" && !attentive ? "bright" : charState.emotion);

    character.draw(ctx2, {
      t, dt,
      cx: gx, cy: gy, scale: gs,
      mood, emotion,
      pulse: pulse.v + (menace > 0 ? 0.4 * (menace / 1.1) : 0),
      px: cpx, py: cpy,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.classList.add("lit");
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

/* ---------------- ops feed: the night shift, reporting in ---------------- */
/* One quiet line above the creed — the phantom's desks working while you watch.
   Staged like the rest of the page's demo theater (the risk radar sets the
   precedent); each line names a real desk the product ships. */
function initOpsFeed() {
  const el = document.querySelector("[data-ops]");
  if (!el) return;
  const FEED = [
    ["Lead Hunter", "captured a new inquiry and drafted the reply"],
    ["Booking Desk", "confirmed Saturday 3pm — reminder queued"],
    ["Proposal Forge", "prepared quote #114 — waiting on your approval"],
    ["Review Engine", "requested 2 reviews from happy clients"],
    ["Media Factory", "rendered a 30s vertical cut for approval"],
    ["Threat Watch", "blocked a phishing attempt on the inbox"],
    ["Money Desk", "flagged an overdue invoice for follow-up"],
    ["Night Shift", "cleared the inbox while you slept"],
    ["Memory Keeper", "filed today's decisions — nothing forgotten"],
  ];
  let i = Math.floor(Math.random() * FEED.length);
  const paint = () => {
    const [who, what] = FEED[i % FEED.length];
    i += 1;
    el.innerHTML = `<i></i><b>${who}</b><span>${what}</span>`;
    el.classList.remove("swap");
    void el.offsetWidth;
    el.classList.add("swap");
  };
  paint();
  if (!reduceMotion) window.setInterval(() => { if (!document.hidden) paint(); }, 4400);
}

function boot() { initConversation(); initEntity(); initRiskRadar(); initOpsFeed(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
