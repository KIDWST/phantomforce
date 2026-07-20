/* PhantomForce — ambient magic layer.
   A whisper of drifting spark motes behind the console so the environment
   reads as a living place, not a static terminal. Deliberately cheap: one
   small canvas, ~2 dozen particles, zero allocation in the steady-state
   frame loop, paused while the tab is hidden, skipped entirely under
   reduced motion. Purely decorative — never intercepts a pointer. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mountAmbient() {
  if (reduceMotion || document.querySelector("[data-ambient]")) return;
  const canvas = document.createElement("canvas");
  canvas.className = "ambient-motes";
  canvas.setAttribute("data-ambient", "");
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = innerWidth, h = innerHeight;
  const fit = () => {
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
  };
  fit();
  window.addEventListener("resize", fit, { passive: true });

  const small = window.matchMedia("(max-width: 720px)").matches;
  const COUNT = small ? 14 : 26;

  const spawn = (anywhere) => ({
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : h + 14,
    r: 0.8 + Math.random() * 1.7,
    vy: 5 + Math.random() * 13,            // px/s of upward drift
    sway: 6 + Math.random() * 18,
    phase: Math.random() * Math.PI * 2,
    tw: 0.5 + Math.random() * 1.2,         // twinkle speed
    cyan: Math.random() < 0.14,            // the occasional cold spark
    ember: Math.random() < 0.1,            // a few brighter, warmer motes
  });
  const motes = Array.from({ length: COUNT }, () => spawn(true));

  let last = performance.now();
  const frame = (now) => {
    if (!canvas.isConnected) return;
    if (document.hidden) { last = now; requestAnimationFrame(frame); return; }
    const dt = Math.min(0.06, (now - last) * 0.001); last = now;
    const t = now * 0.001;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.y -= m.vy * dt;
      if (m.y < -14) motes[i] = spawn(false);
      const x = m.x + Math.sin(t * 0.5 + m.phase) * m.sway;
      const glow = 0.5 + 0.5 * Math.sin(t * m.tw + m.phase);
      const a = (m.ember ? 0.32 : 0.15) * (0.35 + 0.65 * glow);
      ctx.beginPath();
      ctx.fillStyle = m.cyan ? `rgba(103,39,246,${a.toFixed(3)})` : `rgba(102,73,247,${a.toFixed(3)})`;
      ctx.shadowColor = m.cyan ? "rgba(103,39,246,0.7)" : "rgba(102,73,247,0.7)";
      ctx.shadowBlur = m.ember ? 10 : 5;
      ctx.arc(x, m.y, m.r * (m.ember ? 1.5 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
