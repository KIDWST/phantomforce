/* PhantomForce Media Lab image artifacts.
   Local-first visual generator/editor primitives. No provider calls. */

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function hashText(text = "") {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hueSet(prompt = "") {
  const h = hashText(prompt);
  return {
    a: h % 360,
    b: (h >>> 8) % 360,
    c: (h >>> 16) % 360,
  };
}

function promptShape(prompt = "") {
  const s = prompt.toLowerCase();
  if (/coffee|food|drink|retail|product|sale|shop|store/.test(s)) return "product";
  if (/sports|athlete|team|game|reel|highlight/.test(s)) return "motion";
  if (/luxury|premium|brand|launch|cinematic/.test(s)) return "cinema";
  return "signal";
}

function escapeSvg(text = "") {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function svgDataUrl(svg = "") {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function removeSvgBackground(svg = "") {
  return String(svg)
    .replace(/<rect width="1200" height="1200" fill="url\(#bg\)"\/>\n?/g, "")
    .replace(/<rect width="1200" height="1200" fill="url\(#grid\)"\/>\n?/g, "");
}

function imageSizeForCrop(crop = "1:1") {
  if (crop === "4:5") return { width: 1200, height: 1500 };
  if (crop === "9:16") return { width: 1080, height: 1920 };
  if (crop === "16:9") return { width: 1920, height: 1080 };
  return { width: 1400, height: 1400 };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be loaded for export."));
    img.src = src;
  });
}

export function makeImageArtifact(prompt = "", title = "Media Lab image", options = {}) {
  const hues = hueSet(`${prompt} ${title} ${options.style || ""}`);
  const shape = promptShape(prompt);
  const id = `pf-${hashText(`${prompt}${title}${Date.now()}`).toString(36)}`;
  const accent = `hsl(${hues.a} 95% 60%)`;
  const accent2 = `hsl(${hues.b} 100% 62%)`;
  const accent3 = `hsl(${hues.c} 88% 72%)`;
  const product = shape === "product";
  const motion = shape === "motion";
  const cinema = shape === "cinema";

  const particles = Array.from({ length: 90 }, (_, i) => {
    const x = (hashText(`${prompt}-x-${i}`) % 1080) + 60;
    const y = (hashText(`${prompt}-y-${i}`) % 1080) + 60;
    const r = 1.8 + (hashText(`${prompt}-r-${i}`) % 52) / 20;
    const o = 0.18 + (hashText(`${prompt}-o-${i}`) % 60) / 100;
    return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${i % 5 === 0 ? accent2 : accent}" opacity="${o.toFixed(2)}"/>`;
  }).join("");

  const visual = product
    ? `<g filter="url(#glow)"><rect x="342" y="286" width="516" height="628" rx="72" fill="url(#glass)" stroke="${accent3}" stroke-opacity=".7" stroke-width="4"/><ellipse cx="600" cy="810" rx="250" ry="44" fill="${accent}" opacity=".2"/><path d="M438 414 C540 352 684 352 762 420 C840 488 835 638 738 705 C643 770 476 750 421 642 C382 565 373 459 438 414Z" fill="url(#core)" opacity=".88"/></g>`
    : motion
      ? `<g filter="url(#glow)"><path d="M164 728 C322 430 520 310 764 343 C906 363 1004 447 1062 558" fill="none" stroke="${accent}" stroke-width="28" stroke-linecap="round" opacity=".38"/><path d="M129 814 C354 596 583 536 894 656" fill="none" stroke="${accent2}" stroke-width="12" stroke-linecap="round" opacity=".8"/><circle cx="565" cy="575" r="168" fill="url(#core)" opacity=".84"/><polygon points="636,453 814,575 636,697" fill="${accent3}" opacity=".82"/></g>`
      : cinema
        ? `<g filter="url(#glow)"><rect x="164" y="242" width="872" height="612" rx="58" fill="url(#glass)" stroke="${accent}" stroke-opacity=".72" stroke-width="4"/><path d="M196 740 C365 596 527 542 716 565 C859 582 942 648 1014 741" fill="none" stroke="${accent2}" stroke-width="22" opacity=".45"/><circle cx="600" cy="548" r="186" fill="url(#core)" opacity=".76"/></g>`
        : `<g filter="url(#glow)"><path d="M600 225 C844 225 1042 423 1042 667 C1042 911 844 1109 600 1109 C356 1109 158 911 158 667 C158 423 356 225 600 225Z" fill="url(#glass)" stroke="${accent}" stroke-opacity=".45" stroke-width="3"/><path d="M358 675 C446 516 596 460 751 532 C862 584 910 711 846 816 C764 950 526 946 405 820 C364 778 336 730 358 675Z" fill="url(#core)" opacity=".86"/></g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200" role="img" aria-label="${escapeSvg(title)}">
<defs>
  <radialGradient id="bg" cx="50%" cy="42%" r="72%"><stop offset="0" stop-color="#123c2b"/><stop offset=".46" stop-color="#061512"/><stop offset="1" stop-color="#010405"/></radialGradient>
  <radialGradient id="core" cx="48%" cy="38%" r="62%"><stop offset="0" stop-color="${accent3}"/><stop offset=".42" stop-color="${accent2}"/><stop offset="1" stop-color="${accent}"/></radialGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eefbf7" stop-opacity=".14"/><stop offset=".45" stop-color="${accent}" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" result="blur"/><feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.22 0 0 0 0 1 0 0 0 0 0.62 0 0 0 .85 0" result="glow"/><feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="${accent}" stroke-opacity=".08" stroke-width="1"/></pattern>
</defs>
<rect width="1200" height="1200" fill="url(#bg)"/>
<rect width="1200" height="1200" fill="url(#grid)"/>
<circle cx="600" cy="600" r="455" fill="none" stroke="${accent}" stroke-opacity=".22"/>
<circle cx="600" cy="600" r="325" fill="none" stroke="${accent2}" stroke-opacity=".16"/>
${particles}
${visual}
<path d="M105 1045 C338 987 674 970 1095 1045" fill="none" stroke="${accent}" stroke-opacity=".24" stroke-width="4"/>
<metadata>${escapeSvg(JSON.stringify({ id, prompt, shape, engine: "PhantomForce local image artifact" }))}</metadata>
</svg>`;

  const src = svgDataUrl(svg);
  return {
    kind: "image",
    src,
    originalSrc: src,
    originalSvg: svg,
    prompt,
    style: options.style || shape,
    crop: options.crop || "1:1",
    filter: options.filter || "studio",
    bgRemoved: false,
    edits: ["generated-local-artifact"],
    toolchain: ["Phantom local image generator", "Canvas/SVG editor", "rembg-ready local background removal"],
    updated: new Date().toISOString(),
  };
}

export const IMAGE_FILTERS = {
  studio: "contrast(1.05) saturate(1.12)",
  punch: "contrast(1.22) saturate(1.42) brightness(1.05)",
  cinematic: "contrast(1.16) saturate(0.96) brightness(0.94)",
  neon: "contrast(1.12) saturate(1.7) hue-rotate(12deg)",
  clean: "contrast(1.02) saturate(0.92) brightness(1.06)",
  mono: "grayscale(1) contrast(1.18)",
};

export const IMAGE_CROPS = {
  "1:1": "1 / 1",
  "4:5": "4 / 5",
  "9:16": "9 / 16",
  "16:9": "16 / 9",
};

export function editImageArtifact(asset = {}, edit = {}) {
  const bgRemoved = typeof edit.bgRemoved === "boolean" ? edit.bgRemoved : !!asset.bgRemoved;
  const svg = asset.originalSvg
    ? bgRemoved ? removeSvgBackground(asset.originalSvg) : asset.originalSvg
    : null;
  const next = {
    ...asset,
    src: svg ? svgDataUrl(svg) : asset.src,
    crop: edit.crop || asset.crop || "1:1",
    filter: edit.filter || asset.filter || "studio",
    bgRemoved,
    edits: [...(asset.edits || []), edit.label || "edited"],
    updated: new Date().toISOString(),
  };
  next.cssFilter = IMAGE_FILTERS[next.filter] || IMAGE_FILTERS.studio;
  return next;
}

export function imageStyle(asset = {}) {
  const filter = IMAGE_FILTERS[asset.filter || "studio"] || IMAGE_FILTERS.studio;
  return `aspect-ratio:${IMAGE_CROPS[asset.crop || "1:1"] || IMAGE_CROPS["1:1"]};--image-filter:${filter};`;
}

export async function renderEditedImageDataUrl(asset = {}) {
  const { width, height } = imageSizeForCrop(asset.crop);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is unavailable in this browser.");

  if (!asset.bgRemoved) {
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#061512");
    bg.addColorStop(1, "#010405");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }

  const img = await loadImage(asset.src || asset.originalSrc);
  const sourceWidth = img.naturalWidth || img.width || 1200;
  const sourceHeight = img.naturalHeight || img.height || 1200;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;

  ctx.filter = IMAGE_FILTERS[asset.filter || "studio"] || IMAGE_FILTERS.studio;
  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
  ctx.filter = "none";

  return canvas.toDataURL("image/png");
}

export async function downloadImage(asset = {}, title = "phantomforce-image") {
  const href = await renderEditedImageDataUrl(asset);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${String(title).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "phantomforce-image"}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
