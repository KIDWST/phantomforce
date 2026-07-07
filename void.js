/* PhantomForce — the void. Click-first cyber entity you can also speak to. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const smallScreen = window.matchMedia("(max-width: 720px)").matches;
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = { v: 0 };
const flare = () => { pulse.v = 1; };
let createPhantomCharacter;                     // loaded from ./app/js/character.js
const TAU_STAR = Math.PI * 2;
/* the character's conversational mood — speak() drives it, initEntity reads it */
const REST_EMOTION = "content";
/* EMOTION DIRECTOR — every stance change needs a cause the viewer just saw.
   Hard beats are user-caused and land immediately; soft beats are timer-caused
   and defer to whatever the human is doing. */
const MIN_HOLD_MS = 4500;   // a stance is a statement — hold it like a person would
const LINGER_MS = 6000;     // the body settles late after a mood ends, not instantly
const LAUGH_MS = 2300;      // a laugh is a burst, never a held grimace
const charState = { mood: "idle", emotion: REST_EMOTION, until: 0, pose: null, poseUntil: 0, holdUntil: 0, lastBeatPose: null, typing: false };
let beatSeq = 0;
const setCharMood = (mood, emotion, ms, pose = null) => {          // HARD beat
  const now = performance.now();
  beatSeq += 1;
  charState.mood = mood; charState.emotion = emotion;
  charState.until = ms ? now + ms : 0;
  charState.pose = pose;
  charState.poseUntil = pose ? (pose === "laugh" ? now + LAUGH_MS : now + Math.max(ms || 0, MIN_HOLD_MS) + LINGER_MS) : 0;
  charState.holdUntil = now + MIN_HOLD_MS;
  if (pose) charState.lastBeatPose = pose;
  return beatSeq;
};
const setCharBeat = (mood, emotion, ms, pose = null) => {          // SOFT beat
  if (charState.typing || performance.now() < charState.holdUntil) return false;
  if (pose && pose === charState.lastBeatPose) return false;       // never the same bit twice in a row
  setCharMood(mood, emotion, ms, pose);
  return true;
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
      "Hey there. I never sleep, never forget, and I can work by approval or autopilot under your rules. What do you need handled?",
    ]);
  if (/who are you|what are you|your name|who'?s this|what is this/.test(s))
    return pick([
      "I'm PhantomForce — a private AI that runs your operations. The operator you couldn't afford to hire.",
      "PhantomForce. I quietly run the day-to-day of a business — privately, for you alone.",
    ]);
  if (/what can you do|what do you do|how do you (help|work)|capabilit|feature/.test(s))
    return pick([
      "I chase leads, draft your replies, book the jobs, build proposals, even make content — approval when you want control, autopilot when the rules are clear.",
      "I handle the flood — messages, follow-ups, scheduling, quotes, content — so you do the work you love.",
    ]);
  if (/thank|thanks|cheers|appreciate/.test(s)) return "Anytime. And this is just a taste — imagine it running 24/7.";
  if (/how much|price|cost|pricing|expensive|afford|free/.test(s)) return "Less than the hours you're bleeding. Your operator works out the exact number with you.";
  if (/real|legit|trust|fake|believe|prove/.test(s)) return "Real, and private. Nothing trains anyone else, and autopilot only runs inside the rules you set.";
  if (/lead|inquir|prospect|follow.?up|chase/.test(s)) return pick(["Every lead captured, answered, and chased — nothing slips.", "Leads stop falling through. I catch them, reply, and keep following up."]);
  if (/sched|book|calendar|remind|appoint|reschedul/.test(s)) return pick(["Bookings, reminders, and changes — handled without the back-and-forth.", "Your calendar runs itself. I book, remind, and reshuffle."]);
  if (/repl|email|message|inbox|comm|\btext\b|\bdm\b|whatsapp|messenger/.test(s)) return pick(["Replies drafted the second they're needed — review them or let approved repeats run.", "I clear the inbox: answers ready for your tap or your autopilot rules."]);
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
  const speak = (text, cls = "", pose = null) => {
    window.clearTimeout(typeTimer);
    charState.typing = false;
    const p = document.createElement("p");
    p.className = `say-line ${cls}`.trim();
    say.replaceChildren(p);
    if (cls === "user" || cls === "thinking" || reduceMotion) {
      p.textContent = text;
    } else {
      // typewriter: the entity speaks — and holds his stance until he's done
      let i = 0;
      const step = text.length > 44 ? 2 : 1;
      charState.typing = true;
      const tick = () => {
        p.textContent = text.slice(0, i);
        if (i < text.length) { i += step; typeTimer = window.setTimeout(tick, 14 + Math.random() * 20); }
        else { p.textContent = text; charState.typing = false; }
      };
      tick();
    }
    if (cls === "user") {
      // he warms up when YOU do
      if (/thanks|thank you|haha|lol|love|nice|cool|awesome/i.test(text)) setCharMood("listening", "happy", 2200);
      else setCharMood("listening", "calm", 1600);
    }
    else if (cls === "thinking") setCharMood("thinking", "bright", 6000, pose);
    else {
      const hold = Math.max(1600, text.length * 42);
      if (/couldn'?t|limit|try again|that'?s your free|sorry/i.test(text)) {
        setCharMood("talking", "sad", hold, pose || "sheepish");           // caught out -> sheepish
      } else if (/\bhehe\b|vacation|take me with you/i.test(text)) {
        // delight: a laugh BURST, then he keeps talking with the mouth visible
        const myBeat = setCharMood("happy", "happy", Math.min(hold, LAUGH_MS), pose || "laugh");
        if (hold > LAUGH_MS + 200) window.setTimeout(() => {
          if (beatSeq === myBeat) setCharMood("talking", "happy", hold - LAUGH_MS);
        }, LAUGH_MS);
      } else if (/never sleeps|24\/7|worth every|handled|watch it (go|disappear)|stopped losing/i.test(text)) {
        setCharMood("talking", "excited", hold, pose);                     // boast -> assert
      } else {
        setCharMood("talking", "calm", hold, pose || (text.length < 45 ? "point" : null));
      }
    }
    if (cls !== "user") flare();
  };
  const showDownload = () => { if (downloadCta) downloadCta.hidden = false; };

  // ---- the power tour: the entity walks through everything it runs, unprompted ----
  // one line per chip, same order as the [data-power] buttons in the HTML
  const powerLines = [
    "Every new inquiry captured, organized, and answered — nothing slips.",
    "Replies drafted in your voice, ready for review or approved autopilot.",
    "Conversations become booked jobs, reminders, and next steps.",
    "Estimates and invoices prepared, payment follow-up tracked.",
    "Posts, reels, and campaigns planned, drafted, and packaged.",
    "Pages, offers, and client updates kept current.",
    "Old leads and quiet clients get warmed back up.",
    "Risky items and autopilot boundaries flagged before they cost you.",
  ];
  // after a full lap, the coda: every chip lit at once, the ask made plainly
  const codaLine = "Run it yourself, or take the vacation while your agents keep working.";
  /* each chip topic gets a stance that MEANS it — same order as the chips */
  const POWER_POSES = ["point", "chin", "present", "assert", "conjure", "welcome", "coy", "cross"];
  const TOUR_STEP_MS = 9000, TOUR_CODA_MS = 12000, TOUR_BOOT_MS = 6000, TOUR_RESUME_MS = 30000;
  let powerTimer = 0, powerIdx = -1, touring = true, beckonTimer = 0, lapN = 0;
  const showPower = (i) => {
    powerIdx = i;
    powerEls.forEach((el, j) => el.classList.toggle("on", j === i));
    speak(powerLines[i], "", POWER_POSES[i]);
    charState.poseUntil = performance.now() + TOUR_STEP_MS;   // the stance holds through the whole beat
  };
  const showCoda = () => {
    powerIdx = -1;                                  // next tour step starts the lap over
    powerEls.forEach((el) => el.classList.add("on"));
    // the punchline: a real laugh the first time, charm variations after —
    // an identical reaction every lap is the #1 tell of a robot
    speak(codaLine, "", lapN === 0 ? "laugh" : (lapN % 2 ? "coy" : "welcome"));
    if (lapN > 0) charState.poseUntil = performance.now() + TOUR_CODA_MS;
    lapN += 1;
    downloadCta?.classList.add("beckon");
    window.clearTimeout(beckonTimer);
    beckonTimer = window.setTimeout(() => downloadCta?.classList.remove("beckon"), 6200);
  };
  const scheduleTour = (ms) => {
    window.clearTimeout(powerTimer);
    powerTimer = window.setTimeout(() => {
      if (!touring) return;
      // never barge in mid-sentence or mid-beat — try again shortly
      if (charState.typing || performance.now() < charState.holdUntil) { scheduleTour(1500); return; }
      if (powerIdx === powerLines.length - 1) { showCoda(); scheduleTour(TOUR_CODA_MS); }
      else { showPower(powerIdx + 1); scheduleTour(TOUR_STEP_MS); }
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
    if (touring && powerIdx === i) { scheduleTour(TOUR_RESUME_MS); return; }   // already on it — just hold
    touring = true;
    showPower(i);
    scheduleTour(TOUR_RESUME_MS);   // a click means engagement: the tour yields for a good while
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
  document.querySelector("[data-download-cta-2]")?.addEventListener("click", openDownload);
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
      // the highest-emotion moment on the page gets a real reaction
      if (ok) setCharMood("happy", "happy", 2200, "laugh");
      else setCharMood("talking", "sad", 3000, "sheepish");
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

  // He reacts to YOU: keystrokes get his ear, hovering a power gets his eye.
  input?.addEventListener("input", () => {
    if (input.value.trim()) setCharMood("listening", "calm", 4000);
  });
  powerEls.forEach((el) => el.addEventListener("pointerenter", () => {
    // face perks up, body stays — a glance, not a lunge
    if (charState.mood === "idle") setCharMood("listening", "content", 1500, charState.pose);
  }));

  // Typed input = general live assistant (GLM 5.2 when configured; local responder otherwise).
  let typed = 0, askN = 0;
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
      askN += 1;
      // his beloved hand-on-chin "reading" pose alternates with the scheme stance
      speak("· · ·", "thinking", askN % 2 ? "chin" : null);
      flare();
      const thinkingAt = performance.now();
      // a pensive beat under a second never registers — let the thought land,
      // then a flare of "got it" a breath before he answers
      const deliver = (fn) => {
        const minThink = reduceMotion ? 120 : 1500;
        const wait = Math.max(0, minThink - (performance.now() - thinkingAt));
        window.setTimeout(() => {
          flare();
          window.setTimeout(fn, reduceMotion ? 0 : 350);
        }, wait);
      };
      askPhantom(v).then((ai) => {
        // live brain enforces its own per-day cap
        if (ai && ai.limited) {
          deliver(() => {
            speak(ai.message || "That's your free questions for now — download PhantomForce to go deeper.");
            showDownload();
          });
          return;
        }
        if (ai && ai.reply) {
          deliver(() => {
            speak(ai.reply);
            if (ai.remaining != null && input) {
              input.placeholder = ai.remaining > 0 ? `ask phantomforce… ${ai.remaining} left today` : "ask phantomforce…";
            }
          });
          return;
        }
        // free local responder: reactive, then capped to pull them in
        deliver(() => {
          if (typed > FREE_LIMIT) {
            speak("That's a taste. The full version runs 24/7, privately, for your whole business — download PhantomForce to go deeper.");
            showDownload();
          } else {
            speak(localReply(v));
          }
        });
      });
    }, reduceMotion ? 80 : 320);
  });

  // boot: the entity wakes, GREETS you (warm, not a sales face), then tours
  say.replaceChildren();
  window.setTimeout(() => {
    speak("Every lead captured. Every reply handled. Every job moving.");
    setCharMood("talking", "content", 4200, "welcome");   // a greeting is warmth — override the boast routing
    scheduleTour(TOUR_BOOT_MS);
  }, 650);

  // long-idle life: once the tour has yielded, rare gentle in-character bits —
  // he catches up on his reading, glances your way, plays with the flame.
  // Never while you're typing, never twice in a row, never sooner than 40s idle.
  let lastInteraction = performance.now();
  const noticeYou = () => { lastInteraction = performance.now(); };
  input?.addEventListener("input", noticeYou);
  form?.addEventListener("submit", noticeYou);
  window.addEventListener("pointerdown", noticeYou, { passive: true });
  const IDLE_BITS = [
    ["idle", "content", 5200, "chin"],
    ["idle", "content", 4800, "coy"],
    ["idle", "bright", 4600, "conjure"],
  ];
  let idleN = 0;
  window.setInterval(() => {
    if (touring || document.hidden || charState.typing) return;
    if (performance.now() - lastInteraction < 40000) return;
    const bit = IDLE_BITS[idleN++ % IDLE_BITS.length];
    setCharBeat(bit[0], bit[1], bit[2], bit[3]);
  }, 52000);
}

/* ---------------- the phantom (animated character, 2D canvas) ---------------- */
async function initEntity() {
  if (reduceMotion) return;
  const canvas = document.querySelector("[data-void]");
  if (!canvas) return;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return;
  let character;
  try { ({ createPhantomCharacter } = await import("./app/js/character.js?v=phantom-live-20260707-61")); character = createPhantomCharacter({ small: smallScreen, preload: ["chin", "laugh", "point", "present"] }); }
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
    // document coords: address-bar resizes mid-scroll must never re-glide him
    ty = r.top + (window.scrollY || 0) + r.height * 0.5;
    ts = Math.max(42, Math.min(smallScreen ? 126 : 170, (r.height * (smallScreen ? 0.9 : 1.0)) / CHAR_H));   // desktop: he fills his stage — present, not distant
  };
  measureZone();
  let gx = tx, gy = ty + 56, gs = ts * 0.82;           // wakes low + small, drifts into place
  window.addEventListener("resize", measureZone, { passive: true });
  if (window.ResizeObserver && zone) {
    // the observer only helps layout settle at boot — after that his anchor is
    // HIS: text reflow below him must never drag the disc he lives on
    const ro = new ResizeObserver(measureZone);
    ro.observe(zone);
    setTimeout(() => ro.disconnect(), 3500);
  }

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
  // canvas is click-transparent (fixed overlay) — the hero stage takes the poke,
  // but buttons/inputs inside it keep their clicks to themselves
  const stage = document.querySelector(".hero-void") || canvas;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, input, a, form, [data-download-modal]")) return;
    if (menace <= 0) { menace = 1.1; flare(); }
  });

  const t0 = performance.now();
  let last = t0, running = true;
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(frame); });
  let lastFade = -1, shy = 1, shyPrev = 1, lastTele = null;
  const sayEl = document.querySelector("[data-say]");
  const frame = (now) => {
    if (!running) return;
    const t = ((now || performance.now()) - t0) * 0.001;
    const dtF = Math.min(0.05, (now - last) * 0.001);
    // he lives over his disc at the top of page one — scrolling dissolves him
    // fast, and a refresh mid-page starts him already invisible. He never
    // re-anchors to the viewport.
    const fade = Math.max(0, Math.min(1, 1 - (window.scrollY || 0) / (innerHeight * 0.26)));
    // polite hologram: when a long reply spills into his space, he goes
    // transparent and lets the words through — then steps back in
    let shyT = 1;
    if (sayEl) {
      const sr = sayEl.getBoundingClientRect();
      if (sr.height > 4) {
        const sTop = sr.top + (window.scrollY || 0);
        if (sTop < gy + gs * 1.5 && sTop + sr.height > gy - gs * 2.6) shyT = 0.04;   // his torso, not the space under his disc — the resting headline must never trigger this
      }
    }
    if (shyT === 1 && shyPrev < 1) {
      // the words cleared — a flare of light welcomes him back; no pose beat
      // (speak() empties the bubble for a frame, so a mood here would misfire
      // between every two lines — the exact "random pose" the owner hated)
      flare(); happy = 1.2;
    }
    shyPrev = shyT;
    shy += (shyT - shy) * Math.min(1, dtF * 7);
    const vis = fade * shy;
    if (vis < 0.999 || lastFade >= 0) {
      if (lastFade < 0) canvas.style.transition = "none";   // JS easing IS the smoothing — a CSS transition restarted every frame just lags
      if (Math.abs(vis - lastFade) > 0.002) {
        canvas.style.opacity = vis.toFixed(3);
        lastFade = vis;
      }
      if (vis <= 0.01) { requestAnimationFrame(frame); return; }   // invisible = free
    }
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
    const nowMs = performance.now();
    if (charState.until && nowMs > charState.until && !charState.typing) {
      charState.mood = "idle"; charState.emotion = REST_EMOTION; charState.until = 0;
      // a person doesn't reset their whole posture the instant they stop
      // talking: the body lingers in its stance, then one gentle settle.
      // Transients are excluded — never freeze a bridge flicker or a laugh.
      if (!charState.pose && lastTele && !lastTele.bridge && lastTele.pose && lastTele.pose !== "conjure" && lastTele.pose !== "laugh") {
        charState.pose = lastTele.pose;
        charState.poseUntil = nowMs + LINGER_MS;
      }
    }
    if (charState.pose && nowMs > charState.poseUntil) { charState.pose = null; charState.poseUntil = 0; }
    const booting = t < 2.65;
    const restingEmotion = !booting && charState.mood === "idle" ? REST_EMOTION : charState.emotion;
    const mood = menace > 0 ? "menace" : (attentive && charState.mood === "idle" ? "listening" : charState.mood);
    const emotion = menace > 0 ? "alert" : (happy > 0 && charState.mood === "idle" && !attentive ? REST_EMOTION : restingEmotion);

    lastTele = character.draw(ctx2, {
      t, dt,
      cx: gx, cy: gy, scale: gs,
      mood, emotion,
      pose: menace > 0 ? null : charState.pose,   // a provoked flash is a hard cause — it beats any pin
      startupOnly: booting,
      pulse: pulse.v + (menace > 0 ? 0.4 * (menace / 1.1) : 0),
      px: cpx, py: cpy,
    });
    if (lastTele && lastTele.pose !== canvas.dataset.pose) canvas.dataset.pose = lastTele.pose;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.classList.add("lit");

  // the living mark: the phantom IS the logo. He glows awake in the little
  // ring exactly like the chat companion boot, then breathes there — and once
  // settled he becomes the browser tab icon too.
  const markCanvas = document.querySelector("[data-mark-logo]");
  if (markCanvas) {
    const mctx = markCanvas.getContext("2d");
    const mchar = createPhantomCharacter({ small: true });
    const MS = markCanvas.width;
    const m0 = performance.now();
    let faviconSet = false;
    const mFrame = (now) => {
      if (!mctx || document.hidden) { setTimeout(() => requestAnimationFrame(mFrame), 400); return; }
      const mt = (now - m0) * 0.001;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, MS, MS);
      mchar.draw(mctx, {
        t: mt, dt: 0.016,
        cx: MS / 2, cy: MS * 0.58, scale: MS * 0.31,
        mood: "idle", emotion: "content",
        startupOnly: mt < 2.3,
        pulse: 0, px: 0, py: 0, moodAge: 2,
      });
      if (!faviconSet && mt > 3.6) {
        faviconSet = true;
        try {
          const link = document.querySelector("link[rel='icon']");
          if (link) { link.type = "image/png"; link.href = markCanvas.toDataURL("image/png"); }
        } catch { }
      }
      requestAnimationFrame(mFrame);
    };
    requestAnimationFrame(mFrame);
  }
}

/* ---------------- threat radar: risks a business faces ---------------- */
function initRiskRadar() {
  const field = document.querySelector("[data-riskfield]");
  if (!field || reduceMotion) return;
  // red = threats they face. blue = the everyday flood of real notifications
  // (a face, the app, a real question) — the burdens PhantomForce absorbs.
  /* red = everything slipping through a busy owner's fingers — mostly the
     quiet losses (missed calls, cold leads, hours burned on admin), plus a
     few real threats. This is the problem PhantomForce eats. */
  const threats = [
    "missed call", "unread email", "text not answered", "lead going cold",
    "quote never sent", "follow-up forgotten", "invoice unpaid 14 days",
    "double-booked", "no-show risk", "3 hrs lost to admin",
    "same email typed twice", "review never requested", "stale website",
    "phishing", "scam attempt", "data leak", "chargeback", "bad review", "deadline",
  ];
  // real portraits + diverse names so the flood feels like actual people
  const rmu = (g, i) => `https://randomuser.me/api/portraits/${g}/${i}.jpg`;
  const stream = [
    { name: "Jasmine Carter", photo: rmu("women", 68), app: "Instagram", msg: "what are your rates?" },
    { name: "Mike Sullivan", photo: rmu("men", 32), app: "Messenger", msg: "you open Friday?" },
    { name: "Grace Kim", photo: rmu("women", 79), app: "Email", msg: "Re: your quote" },
    { name: "Liam O'Brien", photo: rmu("men", 45), app: "iMessage", msg: "can you call me back?" },
    { name: "Emily Harper", photo: rmu("women", 12), app: "Text", msg: "still on for 3pm?" },
    { name: "Marcus Williams", photo: rmu("men", 11), app: "Facebook", msg: "can I get an estimate?" },
    { name: "Sarah Mitchell", photo: rmu("women", 90), app: "Missed call", msg: "called twice" },
    { name: "Tyrone Jackson", photo: rmu("men", 64), app: "New lead", msg: "wants a callback today" },
    { name: "Destiny Brooks", photo: rmu("women", 87), app: "Google", msg: "do you offer payment plans?" },
    { name: "Kenji Tanaka", photo: rmu("men", 76), app: "Voicemail", msg: "left you a message" },
    { name: "Megan Foster", photo: rmu("women", 54), app: "New review", msg: "left you 5 stars" },
    { name: "James Whitfield", photo: rmu("men", 83), app: "Invoice", msg: "payment is overdue" },
    { name: "Leilani Akana", photo: rmu("women", 33), app: "Booking", msg: "needs to reschedule" },
    { name: "Carlos Rivera", photo: rmu("men", 9), app: "Email", msg: "where's my order?" },
    { name: "Amy Nguyen", photo: rmu("women", 41), app: "Website form", msg: "requested a quote" },
    { name: "Keanu Kealoha", photo: rmu("men", 51), app: "X", msg: "is this still available?" },
  ];
  // keep pings from overlapping each other OR the text UI in the middle
  const active = [];
  const overlaps = (a, b, pad) =>
    a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;
  const uiSel = "[data-wordmark], [data-phantom-zone], [data-say], [data-hero-sub], [data-powers], [data-speak], [data-cta-block], [data-ops], [data-download-modal]";
  /* slot grid: 6 vertical slots per side band. A ping takes a FREE slot, so
     they spread evenly down both edges instead of huddling in the corners. */
  const SLOTS = 12;                                          // 0-5 left, 6-11 right
  const slotOwner = new Array(SLOTS).fill(null);
  const place = (ping) => {
    const W = innerWidth, H = innerHeight;
    const obstacles = active.map((e) => e.getBoundingClientRect())
      .concat(Array.from(document.querySelectorAll(uiSel)).map((el) => el.getBoundingClientRect()));
    const free = [];
    for (let i = 0; i < SLOTS; i++) if (!slotOwner[i]) free.push(i);
    for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
    for (const slot of free) {
      const rightSide = slot >= 6;
      const row = slot % 6;
      const lp = rightSide ? 78 + Math.random() * 15 : 4 + Math.random() * 15;
      const tp = 9 + row * 13.5 + Math.random() * 5;
      ping.style.left = lp + "%"; ping.style.top = tp + "%";
      const r = ping.getBoundingClientRect();
      if (r.width < 2 || r.left < 8 || r.right > W - 8 || r.top < 8 || r.bottom > H - 8) continue;
      let clash = false;
      for (const o of obstacles) { if (overlaps(r, o, 16)) { clash = true; break; } }
      if (!clash) { slotOwner[slot] = ping; ping._slot = slot; return true; }
    }
    return false;                                           // no clear slot -> skip this one
  };
  /* deck sampling: walk a shuffled deck so nothing repeats until the whole
     deck has played, and never show a label that is already on screen */
  const makeDeck = (n) => { const d = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
  let threatDeck = makeDeck(threats.length), streamDeck = makeDeck(stream.length);
  const onScreen = () => new Set(active.map((el) => el.dataset.key));
  const drawCard = (deckRef, items, keyOf) => {
    const showing = onScreen();
    for (let guard = 0; guard < items.length + 2; guard++) {
      if (!deckRef.deck.length) deckRef.deck = makeDeck(items.length);
      const idx = deckRef.deck.shift();
      if (!showing.has(keyOf(items[idx]))) return items[idx];
    }
    return null;
  };
  const threatRef = { deck: threatDeck }, streamRef = { deck: streamDeck };
  const spawn = () => {
    if (document.hidden) return;
    const threat = smallScreen ? true : Math.random() < 0.6;   // red dots outnumber the bubbles
    const ping = document.createElement("div");
    ping.style.visibility = "hidden";
    if (threat) {
      const label0 = drawCard(threatRef, threats, (x) => x);
      if (!label0) return;
      ping.className = "risk-ping threat";
      ping.dataset.key = label0;
      const dot = document.createElement("span"); dot.className = "risk-dot";
      const label = document.createElement("span"); label.className = "risk-label"; label.textContent = label0;
      ping.append(dot, label);
    } else {
      const n = drawCard(streamRef, stream, (x) => x.name);
      if (!n) return;
      ping.className = "risk-ping stream notif";
      ping.dataset.key = n.name;
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
    window.setTimeout(() => {
      ping.remove();
      const i = active.indexOf(ping); if (i >= 0) active.splice(i, 1);
      if (ping._slot != null && slotOwner[ping._slot] === ping) slotOwner[ping._slot] = null;
    }, 4400);
  };
  const tick = () => { spawn(); window.setTimeout(tick, 1500 + Math.random() * 900); };   // a calm 1.5-2.4s pulse
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
    ["Review Engine", "requested 2 reviews from happy clients"],
    ["Media Factory", "rendered a 30s vertical cut for review"],
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
  // the mobile card is fixed to the viewport — it belongs to the hero scene,
  // so it slips away once the visitor scrolls into the selling sections
  const hero = document.querySelector(".hero-void");
  if (hero && window.IntersectionObserver) {
    new IntersectionObserver(([entry]) => {
      el.classList.toggle("ops-away", !entry.isIntersecting);
    }, { threshold: 0.12 }).observe(hero);
  }
}

function initPromptExamples() {
  const input = document.querySelector("[data-speak-input]");
  if (!input) return;
  const EXAMPLES = [
    "Ask PhantomForce to follow up with every new lead…",
    "Ask PhantomForce to prepare today's content plan…",
    "Ask PhantomForce to draft a quote and booking reply…",
    "Ask PhantomForce to warm up last month's quiet leads…",
  ];
  if (reduceMotion) { input.placeholder = EXAMPLES[0]; return; }
  let i = 0;
  window.setInterval(() => {
    if (document.hidden || input.value || document.activeElement === input) return;
    i = (i + 1) % EXAMPLES.length;
    input.placeholder = EXAMPLES[i];
  }, 3600);
}

/* the AI workforce — centralized seed data; swap for a backend feed later */
const WORKFORCE = [
  { name: "Danielle Carter", role: "Client Success",         status: "Preparing reply",       tone: "on",   photo: "https://randomuser.me/api/portraits/women/44.jpg" },
  { name: "Marcus Reed",     role: "Lead Research",          status: "Organizing new leads",  tone: "on",   photo: "https://randomuser.me/api/portraits/men/32.jpg" },
  { name: "Sofia Ramirez",   role: "Content Producer",       status: "Building content plan", tone: "on",   photo: "https://randomuser.me/api/portraits/women/68.jpg" },
  { name: "James O'Neal",    role: "Website Technician",     status: "Reviewing page update", tone: "idle", photo: "https://randomuser.me/api/portraits/men/76.jpg" },
  { name: "Priya Shah",      role: "Scheduling Coordinator", status: "Checking schedule",     tone: "on",   photo: "https://randomuser.me/api/portraits/women/65.jpg" },
  { name: "David Kim",       role: "Finance Assistant",      status: "Rule check ready",      tone: "warn", photo: "https://randomuser.me/api/portraits/men/52.jpg" },
];
const WORKFORCE_POOL_FACES = [
  "https://randomuser.me/api/portraits/women/12.jpg",
  "https://randomuser.me/api/portraits/men/12.jpg",
  "https://randomuser.me/api/portraits/women/28.jpg",
  "https://randomuser.me/api/portraits/men/24.jpg",
  "https://randomuser.me/api/portraits/women/36.jpg",
  "https://randomuser.me/api/portraits/men/36.jpg",
  "https://randomuser.me/api/portraits/women/49.jpg",
  "https://randomuser.me/api/portraits/men/48.jpg",
  "https://randomuser.me/api/portraits/women/58.jpg",
  "https://randomuser.me/api/portraits/men/62.jpg",
  "https://randomuser.me/api/portraits/women/73.jpg",
  "https://randomuser.me/api/portraits/men/71.jpg",
];
function initWorkforce() {
  const grid = document.querySelector("[data-workforce-grid]");
  if (!grid) return;
  grid.innerHTML = WORKFORCE.map((w, i) => {
    const initials = w.name.split(" ").map((p) => p[0]).join("");
    return `<article class="wf-card">
      <span class="wf-avatar wf-photo wf-hue-${i % 6}">
        <img src="${w.photo}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';" />
        <i>${initials}</i>
      </span>
      <span class="wf-main"><b>${w.name}</b><i>${w.role}</i></span>
      <span class="wf-status wf-${w.tone}"><em></em>${w.status}</span>
    </article>`;
  }).join("") + `<article class="wf-card wf-more">
      <span class="wf-face-cloud" aria-label="Over one thousand routed AI specialist personas">
        ${WORKFORCE_POOL_FACES.map((src) => `<img src="${src}" alt="" loading="lazy" decoding="async" />`).join("")}
        <b>1K+</b>
      </span>
      <span class="wf-main"><b>…and over a thousand more</b><i>Specialists spin up the moment work needs them — the possibilities are endless.</i></span>
      <span class="wf-status wf-on"><em></em>On call</span>
    </article>`;
}

function initReveal() {
  const els = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!els.length) return;
  if (reduceMotion || !("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { threshold: 0.12 });
  els.forEach((el) => io.observe(el));
}

function boot() { initConversation(); initEntity(); initRiskRadar(); initOpsFeed(); initPromptExamples(); initWorkforce(); initReveal(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
