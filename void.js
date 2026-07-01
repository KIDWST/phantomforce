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

    // ===== sculpted phantom body: a lathed specter silhouette with a
    //       fresnel rim-glow (bright ethereal edge, translucent core) =====
    const prof = [
      [0.001, 1.56], [0.30, 1.46], [0.55, 1.27], [0.76, 1.00], [0.90, 0.63],
      [0.99, 0.21], [1.03, -0.24], [1.02, -0.64], [0.95, -0.98], [0.80, -1.22],
      [0.52, -1.36], [0.001, -1.44],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const bodyGeo = new THREE.LatheGeometry(prof, 84);
    bodyGeo.computeVertexNormals();
    const bpos = bodyGeo.attributes.position;
    const bbase = new Float32Array(bpos.array);         // rest positions for the flowing hem
    const bodyUniforms = {
      uColor: { value: new THREE.Color(0x1fd992) },     // translucent body
      uRim: { value: new THREE.Color(0xcafff0) },       // bright ethereal edge
      uOpacity: { value: 0.4 },
      uPulse: { value: 0 },
      uDead: { value: 0 },
    };
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: bodyUniforms, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform vec3 uRim; uniform float uOpacity; uniform float uPulse; uniform float uDead;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.3);
          vec3 base = mix(uColor, vec3(1.0, 0.34, 0.46), uDead);
          vec3 rim = mix(uRim, vec3(1.0, 0.68, 0.76), uDead);
          vec3 col = mix(base, rim, f) + uPulse * 0.35;
          float a = uOpacity * (0.22 + 0.9 * f) + uPulse * 0.2;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat); bodyMesh.renderOrder = 1; ghost.add(bodyMesh);

    // ===== energy aura: a shell of light points just outside the body =====
    const N = smallScreen ? 1500 : 3000;
    const abase = new Float32Array(N * 3), apos = new Float32Array(N * 3);
    const GA = 2.399963229728653;
    for (let k = 0; k < N; k++) {
      const v = k / (N - 1);
      const ang = k * GA;
      const R = v < 0.42 ? Math.sin((v / 0.42) * (Math.PI / 2)) : 1;
      const y = 1.52 - v * 2.98;
      const rr = R * (1.05 + 0.1 * (((k * 9301) % 233) / 233));   // just outside the shell
      abase[k * 3] = Math.cos(ang) * rr; abase[k * 3 + 1] = y; abase[k * 3 + 2] = Math.sin(ang) * rr;
      apos[k * 3] = abase[k * 3]; apos[k * 3 + 1] = y; apos[k * 3 + 2] = abase[k * 3 + 2];
    }
    const auraGeo = new THREE.BufferGeometry(); auraGeo.setAttribute("position", new THREE.BufferAttribute(apos, 3));
    const auraMat = new THREE.PointsMaterial({ color: new THREE.Color(0x6bffc0), size: 0.026, sizeAttenuation: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const aura = new THREE.Points(auraGeo, auraMat); aura.renderOrder = 2; ghost.add(aura);
    const aattr = auraGeo.attributes.position;

    // soul-core spark inside the body
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshBasicMaterial({ color: 0xdfffee, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    ghost.add(core);

    // ===== face (always drawn on top of the translucent body) =====
    const onTop = (m) => { m.transparent = true; m.depthTest = false; return m; };
    const eyeCore = onTop(new THREE.MeshBasicMaterial({ color: 0x02160e }));
    const eyeRimMat = onTop(new THREE.MeshBasicMaterial({ color: 0x86ffd0, opacity: 0.95, blending: THREE.AdditiveBlending }));
    const pupilMat = onTop(new THREE.MeshBasicMaterial({ color: 0xeafff6, blending: THREE.AdditiveBlending }));
    const barMat = onTop(new THREE.MeshBasicMaterial({ color: 0xeafff6, blending: THREE.AdditiveBlending }));
    const EYE_Y = 0.8, EYE_Z = 0.86;
    const makeEye = (sx, tilt) => {
      const g = new THREE.Group(); g.position.set(sx, EYE_Y, EYE_Z); g.rotation.z = tilt; g.scale.set(1.32, 0.8, 1); g.renderOrder = 10;
      const socket = new THREE.Mesh(new THREE.CircleGeometry(0.17, 30), eyeCore);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.155, 0.205, 30), eyeRimMat);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), pupilMat); pupil.position.z = 0.01;
      g.add(socket, rim, pupil); g.userData.pupil = pupil; return g;
    };
    const eyeL = makeEye(-0.33, -0.16), eyeR = makeEye(0.33, 0.16); ghost.add(eyeL, eyeR);   // inner corners down = fierce

    const makeX = (sx) => {
      const g = new THREE.Group(); g.position.set(sx, EYE_Y, EYE_Z + 0.02); g.visible = false; g.renderOrder = 11;
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.02), barMat); b1.rotation.z = Math.PI / 4;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.02), barMat); b2.rotation.z = -Math.PI / 4;
      g.add(b1, b2); return g;
    };
    const xL = makeX(-0.33), xR = makeX(0.33); ghost.add(xL, xR);

    const mouthMat = onTop(new THREE.MeshBasicMaterial({ color: 0x5bffb0, opacity: 0.92, blending: THREE.AdditiveBlending }));
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.032, 10, 30, Math.PI), mouthMat);
    mouth.position.set(0, 0.42, 0.9); mouth.rotation.z = Math.PI; mouth.renderOrder = 10; ghost.add(mouth);
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), onTop(new THREE.MeshBasicMaterial({ color: 0xff86a6 })));
    tongue.position.set(0, 0.3, 0.92); tongue.visible = false; tongue.renderOrder = 11; ghost.add(tongue);

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
    window.addEventListener("pointermove", (e) => {
      px = e.clientX / innerWidth - 0.5; py = e.clientY / innerHeight - 0.5;
      if (dead <= 0) happy = 1.1;
    }, { passive: true });
    canvas.addEventListener("pointerdown", () => { if (dead <= 0) { dead = 1.6; flare(); } });

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

      // flowing tattered hem on the solid body
      const ba = bpos.array;
      for (let i = 0; i < bbase.length; i += 3) {
        const bx = bbase[i], by = bbase[i + 1], bz = bbase[i + 2];
        let nx = bx, ny = by, nz = bz;
        if (by < -0.2) {
          const m = Math.min(1, (-0.2 - by) / 1.15);
          const ang = Math.atan2(bz, bx);
          ny = by + (Math.sin(ang * 5 + t * 2.2) * 0.11 + Math.sin(ang * 3 - t * 1.6) * 0.06) * m;
          const rp = 1 + 0.07 * m * Math.sin(ang * 5 + t * 2.2);
          nx = bx * rp; nz = bz * rp;
        }
        ba[i] = nx * breath; ba[i + 1] = ny * breath; ba[i + 2] = nz * breath;
      }
      bpos.needsUpdate = true;

      // aura shimmer
      for (let k = 0; k < N; k++) {
        const j = k * 3;
        const n = Math.sin(abase[j] * 3 + t * 1.2) * Math.cos(abase[j + 1] * 3 - t) * 0.06;
        const s = (1 + n) * breath;
        aattr.array[j] = abase[j] * s; aattr.array[j + 1] = abase[j + 1] * s; aattr.array[j + 2] = abase[j + 2] * s;
      }
      aattr.needsUpdate = true;

      bodyUniforms.uPulse.value = pulse.v;
      bodyUniforms.uDead.value = isDead ? Math.min(1, dead / 0.8) : 0;
      auraMat.color.setHex(isDead ? 0xff8fa6 : 0x6bffc0);
      auraMat.opacity = 0.5 + pulse.v * 0.25;

      // float; slump when dead
      ghost.position.y = Math.sin(t * 1.1) * 0.1 - (isDead ? (1 - dead / 1.6) * 0.45 : 0);

      // look toward cursor + gentle drift; shake like pac-man when dead
      cpx = lerp(cpx, px, 0.06); cpy = lerp(cpy, py, 0.06);
      let rx = cpy * 0.38, ry = cpx * 0.68 + Math.sin(t * 0.15) * 0.05, rz = 0;
      if (isDead) { const sh = dead / 1.6; rz = Math.sin(t * 42) * 0.2 * sh; rx += Math.sin(t * 35) * 0.12 * sh; }
      ghost.rotation.set(rx, ry, rz);

      // pupils track the cursor
      const lookX = cpx * 0.05, lookY = -cpy * 0.05;
      eyeL.userData.pupil.position.x = lookX; eyeL.userData.pupil.position.y = lookY;
      eyeR.userData.pupil.position.x = lookX; eyeR.userData.pupil.position.y = lookY;

      // blink
      blink -= dt; if (blink < -0.13) blink = 2.4 + Math.random() * 3.4;
      const eyeSy = (blink < 0 && !isDead) ? 0.14 : 0.8;

      // expressions
      eyeL.visible = eyeR.visible = !isDead;
      xL.visible = xR.visible = isDead;
      tongue.visible = isDead;
      eyeL.scale.y = eyeR.scale.y = eyeSy;
      mouth.visible = !isDead;
      const smiling = happy > 0;
      mouth.scale.set(smiling ? 1.3 : 1, smiling ? 1.4 : 0.68, 1);

      core.rotation.x += 0.004; core.rotation.y += 0.005;
      core.scale.setScalar((1 + pulse.v * 0.5) * breath); core.material.opacity = 0.3 + pulse.v * 0.4;

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
    requestAnimationFrame(() => ping.classList.add("on"));
    window.setTimeout(() => ping.classList.remove("on"), 3400);
    window.setTimeout(() => ping.remove(), 4400);
  };
  for (let i = 0; i < 4; i++) window.setTimeout(spawn, i * 650);
  window.setInterval(spawn, 1300);
}

function boot() { initConversation(); initEntity(); initRiskRadar(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
