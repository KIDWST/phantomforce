/* PhantomBot file analysis — reads dropped/attached photos and documents on
   the client and produces a real, honest analysis with no external calls:
   images get a canvas-based visual read (size, palette, brightness, whether it
   looks like a document/receipt); text documents get extracted and run through
   a receipt/invoice parser that pulls out vendor, date, totals, and line items
   so PhantomBot can offer to turn them into an invoice or expense. When a
   vision model is connected server-side, the image data URL is also sent for a
   richer description (see phantomai.js) — this module is the always-works base. */

const TEXTUAL = /\.(txt|csv|tsv|md|markdown|json|log|html?|xml|yml|yaml|rtf|ics|vcf)$/i;
const TEXT_MIME = /^(text\/|application\/(json|xml|csv|x-yaml|rtf|xhtml))/i;

export function fileKind(file) {
  const type = file.type || "";
  const name = file.name || "";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (TEXT_MIME.test(type) || TEXTUAL.test(name)) return "text";
  if (/^video\//.test(type)) return "video";
  if (/\.(docx?|pages)$/i.test(name)) return "doc";
  if (/\.(xlsx?|numbers)$/i.test(name)) return "sheet";
  return "other";
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}
export function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsText(file);
  });
}
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsArrayBuffer(file);
  });
}

export function humanSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ---- image analysis (canvas) --------------------------------------------- */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}
function colorName(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 24) return max > 200 ? "white/light" : max < 60 ? "black/dark" : "gray";
  if (r >= g && r >= b) return g > 150 && b < 120 ? "orange/gold" : "red/warm";
  if (g >= r && g >= b) return "green";
  return r > 150 ? "purple/pink" : "blue/cool";
}
export async function analyzeImage(dataUrl) {
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const c = document.createElement("canvas");
  const s = 48;
  c.width = s; c.height = s;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, s, s);
  let data;
  try { data = ctx.getImageData(0, 0, s, s).data; } catch { data = null; }
  let brightness = 0, count = 0;
  const buckets = {};
  let darkPixels = 0, lightPixels = 0;
  if (data) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      brightness += lum; count++;
      if (lum < 70) darkPixels++; else if (lum > 190) lightPixels++;
      const key = `${Math.round(r / 48)}-${Math.round(g / 48)}-${Math.round(b / 48)}`;
      buckets[key] = (buckets[key] || { n: 0, r: 0, g: 0, b: 0 });
      buckets[key].n++; buckets[key].r += r; buckets[key].g += g; buckets[key].b += b;
    }
  }
  const avgLum = count ? brightness / count : 128;
  const palette = Object.values(buckets).sort((a, b) => b.n - a.n).slice(0, 4)
    .map((x) => colorName(Math.round(x.r / x.n), Math.round(x.g / x.n), Math.round(x.b / x.n)));
  const uniquePalette = [...new Set(palette)];
  // document heuristic: mostly light with pockets of dark (text) and low color variety
  const docLike = count ? (lightPixels / count > 0.5 && darkPixels / count > 0.04 && uniquePalette.length <= 3) : false;
  const orientation = W > H * 1.2 ? "landscape" : H > W * 1.2 ? "portrait" : "square";
  return {
    width: W, height: H, orientation,
    brightness: avgLum > 175 ? "bright" : avgLum < 80 ? "dark" : "balanced",
    palette: uniquePalette,
    docLike,
    megapixels: ((W * H) / 1e6).toFixed(1),
  };
}

/* ---- receipt / invoice text parser --------------------------------------- */
const AMOUNT_RE = /(?:(\$|€|£|usd|eur|gbp)\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})/gi;
const CURRENCY_MAP = { "$": "USD", "€": "EUR", "£": "GBP", usd: "USD", eur: "EUR", gbp: "GBP" };

export function parseDocument(text = "") {
  const clean = String(text).replace(/\r\n/g, "\n").trim();
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const lower = clean.toLowerCase();

  const amounts = [];
  let m; AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(clean))) {
    const val = Number(m[2].replace(/,/g, ""));
    if (val > 0) amounts.push({ val, currency: CURRENCY_MAP[(m[1] || "$").toLowerCase()] || "USD", index: m.index });
  }
  const currency = amounts[0]?.currency || "USD";

  // total: an amount on a line mentioning total/amount due/balance; else the max
  let total = 0;
  for (const line of lines) {
    if (/\b(total|amount due|balance due|grand total|amount payable)\b/i.test(line)) {
      const a = [...line.matchAll(AMOUNT_RE)].map((x) => Number(x[2].replace(/,/g, ""))).filter(Boolean);
      if (a.length) total = Math.max(total, Math.max(...a));
    }
  }
  if (!total && amounts.length) total = Math.max(...amounts.map((a) => a.val));

  // date
  const dateMatch = clean.match(/\b(\d{4}-\d{2}-\d{2})\b/) || clean.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/) ||
    clean.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i);
  const dateText = dateMatch ? dateMatch[0] : "";

  // vendor: first meaningful line (skip lines that are just numbers/dates)
  const vendor = lines.find((l) => l.length > 2 && !/^[\d\s$.,/-]+$/.test(l) && !AMOUNT_RE.test(l)) || lines[0] || "";
  AMOUNT_RE.lastIndex = 0;

  // line items: lines that contain an amount and some description
  const lineItems = [];
  for (const line of lines) {
    if (/\b(total|subtotal|tax|amount due|balance|change|cash|card|tip)\b/i.test(line)) continue;
    const a = [...line.matchAll(AMOUNT_RE)];
    if (!a.length) continue;
    const price = Number(a[a.length - 1][2].replace(/,/g, ""));
    const desc = line.replace(AMOUNT_RE, "").replace(/[x×@]\s*\d+/gi, "").replace(/\s{2,}/g, " ").replace(/[-–—:]+$/, "").trim();
    if (price > 0 && desc.length >= 2 && desc.length < 80) lineItems.push({ description: desc, quantity: 1, unitPrice: price });
    if (lineItems.length >= 20) break;
  }

  const isInvoiceLike = /\b(invoice|receipt|bill|total|subtotal|amount due|qty|quantity|unit price|balance due)\b/i.test(lower) && total > 0;
  const taxMatch = lower.match(/\b(?:tax|vat|gst)\b[^\n]*?(\d+(?:\.\d+)?)\s*%/);
  const taxRatePct = taxMatch ? Number(taxMatch[1]) : 0;

  return { vendor, dateText, total, currency, lineItems, isInvoiceLike, taxRatePct, lineCount: lines.length, charCount: clean.length };
}

/* Best-effort text pull from a PDF: works for uncompressed text streams; many
   modern PDFs compress content, in which case we honestly report that. */
async function pdfText(file) {
  try {
    const buf = new Uint8Array(await readAsArrayBuffer(file));
    let ascii = "";
    for (let i = 0; i < buf.length; i++) { const c = buf[i]; ascii += c >= 32 && c < 127 ? String.fromCharCode(c) : c === 10 ? "\n" : " "; }
    // pull text between parentheses in BT/ET text objects, and Tj/TJ strings
    const chunks = [];
    const re = /\(((?:\\.|[^()\\])*)\)/g;
    let m;
    while ((m = re.exec(ascii))) { const t = m[1].replace(/\\([()\\])/g, "$1"); if (/[a-z0-9]/i.test(t)) chunks.push(t); }
    const text = chunks.join(" ").replace(/\s{2,}/g, " ").trim();
    return text.length > 40 ? text : "";
  } catch { return ""; }
}

/* ---- top-level analyze --------------------------------------------------- */
export async function analyzeFile(file) {
  const kind = fileKind(file);
  const base = { name: file.name || "file", mime: file.type || "", size: file.size || 0, kind };

  if (kind === "image") {
    const dataUrl = await readAsDataUrl(file);
    let vis = null;
    try { vis = await analyzeImage(dataUrl); } catch { vis = null; }
    const findings = [];
    if (vis) {
      findings.push(`${vis.width}×${vis.height} (${vis.megapixels} MP), ${vis.orientation}, ${vis.brightness}`);
      if (vis.palette.length) findings.push(`Dominant tones: ${vis.palette.join(", ")}`);
      if (vis.docLike) findings.push("Looks like a document or receipt — I can pull text from it if you connect a vision model, or type the details and I'll build the invoice.");
    }
    const summary = vis
      ? `Photo · ${vis.width}×${vis.height}, ${vis.orientation}, ${vis.brightness}${vis.docLike ? " · looks like a document/receipt" : ""}.`
      : "Image attached.";
    return { ...base, dataUrl, vision: vis, findings, summary, invoiceDraft: null };
  }

  if (kind === "text" || kind === "pdf") {
    let text = "";
    if (kind === "text") text = await readAsText(file);
    else text = await pdfText(file);
    const parsed = text ? parseDocument(text) : null;
    const findings = [];
    let invoiceDraft = null;
    let summary = "";
    if (parsed && parsed.charCount) {
      if (parsed.vendor) findings.push(`From: ${parsed.vendor}`);
      if (parsed.dateText) findings.push(`Date: ${parsed.dateText}`);
      if (parsed.total) findings.push(`Total: ${parsed.currency} ${parsed.total.toFixed(2)}`);
      if (parsed.lineItems.length) findings.push(`${parsed.lineItems.length} line item${parsed.lineItems.length === 1 ? "" : "s"} detected`);
      summary = parsed.isInvoiceLike
        ? `Document · looks like a bill/receipt from ${parsed.vendor || "an unknown vendor"}, total ${parsed.currency} ${parsed.total.toFixed(2)}.`
        : `Document · ${parsed.lineCount} lines, ${parsed.charCount} characters. Ask me anything about it.`;
      if (parsed.isInvoiceLike && parsed.lineItems.length) {
        invoiceDraft = {
          clientName: parsed.vendor || "",
          lineItems: parsed.lineItems,
          taxRatePct: parsed.taxRatePct,
          notes: `Imported from ${file.name}`,
        };
      }
    } else if (kind === "pdf") {
      summary = "PDF attached — its text is compressed so I couldn't read it directly. Connect a vision model for full extraction, or tell me the details.";
      findings.push("Compressed PDF · text not directly readable");
    } else {
      summary = "Empty or unreadable document.";
    }
    return { ...base, text: text.slice(0, 20000), parsed, findings, summary, invoiceDraft };
  }

  // other file kinds — metadata only
  return {
    ...base,
    findings: [`${humanSize(file.size)} · ${file.type || "unknown type"}`],
    summary: `${file.name} attached (${humanSize(file.size)}). I can reference it, but I can only analyze images and text-based documents in depth.`,
    invoiceDraft: null,
  };
}
