#!/usr/bin/env node
/**
 * Build a static ui-previews HTML report from deltas.json and its PNG pairs.
 * No dependencies. Node 18+.
 *
 *   node build-report.mjs <deltas.json> [--out report.html] [--allow-aspect-mismatch]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const USAGE = `Usage: build-report.mjs <deltas.json> [--out report.html] [--allow-aspect-mismatch]

Reads deltas.json, validates the pair screenshots and rects, and writes a static
report.html beside the JSON (or to --out). Screenshots must be viewport captures
whose aspect ratio matches viewport.width / viewport.height; pass
--allow-aspect-mismatch only when a scaled capture keeps the same framing.`;

function die(message) {
  console.error(`build-report: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(argv.length ? 0 : 2);
  }
  const options = { json: null, out: null, allowAspect: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      options.out = argv[i + 1];
      if (!options.out) die("--out needs a path");
      i += 1;
    } else if (arg === "--allow-aspect-mismatch") {
      options.allowAspect = true;
    } else if (arg.startsWith("-")) {
      die(`unknown option ${arg}`);
    } else if (!options.json) {
      options.json = arg;
    } else {
      die(`unexpected argument ${arg}`);
    }
  }
  if (!options.json) die("missing deltas.json");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const jsonAbs = resolve(process.cwd(), options.json);
if (!existsSync(jsonAbs)) die(`no such file: ${jsonAbs}`);

let data;
try {
  data = JSON.parse(readFileSync(jsonAbs, "utf8"));
} catch (error) {
  die(`invalid JSON in ${jsonAbs}: ${error.message}`);
}

const evidenceDir = dirname(jsonAbs);
const outAbs = options.out
  ? resolve(process.cwd(), options.out)
  : resolve(evidenceDir, "report.html");
const outDir = dirname(outAbs);

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const need = (condition, message) => {
  if (!condition) die(message);
};

need(isText(data.title), "title must be a non-empty string");
need(isText(data.summary), "summary must be a non-empty string");
need(data.base && isText(data.base.ref), "base.ref must be a non-empty string");
need(data.head && isText(data.head.ref), "head.ref must be a non-empty string");
need(isText(data.fixture), "fixture must be a non-empty string");
need(isText(data.theme), "theme must be a non-empty string");
need(data.date == null || isText(data.date), "date must be a non-empty string when present");
const viewWidth = data.viewport?.width;
const viewHeight = data.viewport?.height;
need(
  Number.isFinite(viewWidth) && viewWidth > 0 && Number.isFinite(viewHeight) && viewHeight > 0,
  "viewport must be { width, height } in CSS px",
);
need(Array.isArray(data.pairs) && data.pairs.length > 0, "pairs must be a non-empty array");
need(Array.isArray(data.deltas) && data.deltas.length > 0, "deltas must be a non-empty array");
need(
  data.verification && isText(data.verification.command) && typeof data.verification.result === "string",
  "verification must be { command, result }",
);

const date = isText(data.date) ? data.date : new Date().toISOString().slice(0, 10);
const viewAspect = viewWidth / viewHeight;

function pngSize(absPath) {
  const buffer = readFileSync(absPath);
  need(buffer.length >= 24, `not a PNG: ${absPath}`);
  const signature = buffer.subarray(0, 8);
  need(
    signature[0] === 0x89 && signature.subarray(1, 4).toString("latin1") === "PNG",
    `not a PNG: ${absPath}`,
  );
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function fileHash(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

function checkAspect(dimensions, label) {
  const aspect = dimensions.width / dimensions.height;
  if (Math.abs(aspect - viewAspect) / viewAspect <= 0.01) return;
  if (options.allowAspect) return;
  die(
    `${label} is ${dimensions.width}x${dimensions.height}; expected the ${viewWidth}x${viewHeight} ` +
      `viewport aspect. Capture the viewport only, not the full page (or pass --allow-aspect-mismatch).`,
  );
}

function imagePath(pathValue, label) {
  need(isText(pathValue), `${label} must be a relative path`);
  const absPath = resolve(evidenceDir, pathValue);
  need(existsSync(absPath), `${label}: missing file ${pathValue}`);
  return absPath;
}

function hrefFor(absPath) {
  return relative(outDir, absPath)
    .split(sep)
    .map((part) => (part === ".." ? part : encodeURIComponent(part)))
    .join("/");
}

const pairs = new Map();
for (const pair of data.pairs) {
  need(pair && isText(pair.id), "each pair needs an id");
  need(!pairs.has(pair.id), `duplicate pair id: ${pair.id}`);
  need(isText(pair.route), `pair ${pair.id}: route required`);
  need(isText(pair.state), `pair ${pair.id}: state required`);
  const beforeAbs = imagePath(pair.before, `pair ${pair.id} before`);
  const afterAbs = imagePath(pair.after, `pair ${pair.id} after`);
  const beforeDims = pngSize(beforeAbs);
  const afterDims = pngSize(afterAbs);
  checkAspect(beforeDims, `pair ${pair.id} before`);
  checkAspect(afterDims, `pair ${pair.id} after`);
  need(
    fileHash(beforeAbs) !== fileHash(afterAbs),
    `pair ${pair.id}: before and after are byte-identical; capture the state that shows the change or mark the delta notObserved`,
  );
  pairs.set(pair.id, {
    id: pair.id,
    route: pair.route,
    state: pair.state,
    beforeAbs,
    afterAbs,
    beforeDims,
    afterDims,
  });
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const percent = (value, total) => `${((value / total) * 100).toFixed(3)}%`;
const CALLOUT_PAD = 6;

function readRegions(list, label) {
  need(Array.isArray(list), `${label} must be an array of rects`);
  return list.map((rect, index) => {
    for (const key of ["x", "y", "w", "h"]) {
      need(Number.isFinite(rect?.[key]), `${label}[${index}].${key} must be a number`);
    }
    need(rect.w > 0 && rect.h > 0, `${label}[${index}] must have positive w and h`);
    return rect;
  });
}

function rectBox(rect, crop, label) {
  const left = clamp(rect.x - CALLOUT_PAD, crop.x, crop.x + crop.w);
  const top = clamp(rect.y - CALLOUT_PAD, crop.y, crop.y + crop.h);
  const right = clamp(rect.x + rect.w + CALLOUT_PAD, crop.x, crop.x + crop.w);
  const bottom = clamp(rect.y + rect.h + CALLOUT_PAD, crop.y, crop.y + crop.h);
  need(right > left && bottom > top, `${label} has no visible area inside the crop`);
  const clipped =
    rect.x < 0 || rect.y < 0 || rect.x + rect.w > viewWidth || rect.y + rect.h > viewHeight;
  return { left, top, right, bottom, clipped };
}

function mergeBoxes(boxes) {
  const merged = [];
  for (const box of boxes) {
    let current = { ...box };
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < merged.length; i += 1) {
        const other = merged[i];
        const overlap =
          current.left <= other.right &&
          current.right >= other.left &&
          current.top <= other.bottom &&
          current.bottom >= other.top;
        if (!overlap) continue;
        current = {
          left: Math.min(current.left, other.left),
          top: Math.min(current.top, other.top),
          right: Math.max(current.right, other.right),
          bottom: Math.max(current.bottom, other.bottom),
          clipped: current.clipped || other.clipped,
        };
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
    merged.push(current);
  }
  return merged;
}

function cropFor(delta) {
  const round2 = (value) => Math.round(value * 100) / 100;
  if (delta.crop) {
    need(
      delta.crop.x >= 0 &&
        delta.crop.y >= 0 &&
        delta.crop.x + delta.crop.w <= viewWidth &&
        delta.crop.y + delta.crop.h <= viewHeight,
      `delta ${delta.n}: crop must fit inside the ${viewWidth}x${viewHeight} viewport`,
    );
    for (const [index, rect] of [...delta.before, ...delta.after].entries()) {
      need(
        rect.x - CALLOUT_PAD >= delta.crop.x &&
          rect.y - CALLOUT_PAD >= delta.crop.y &&
          rect.x + rect.w + CALLOUT_PAD <= delta.crop.x + delta.crop.w &&
          rect.y + rect.h + CALLOUT_PAD <= delta.crop.y + delta.crop.h,
        `delta ${delta.n}: crop must leave at least ${CALLOUT_PAD}px around rect ${index}`,
      );
    }
    return {
      x: round2(delta.crop.x),
      y: round2(delta.crop.y),
      w: round2(delta.crop.w),
      h: round2(delta.crop.h),
    };
  }

  const rects = [...delta.before, ...delta.after];
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
  const pad = clamp(0.35 * Math.max(maxX - minX, maxY - minY), 64, 200);
  let x = minX - pad;
  let y = minY - pad;
  let width = maxX - minX + pad * 2;
  let height = maxY - minY + pad * 2;

  const minWidth = 320;
  const minHeight = 180;
  if (width < minWidth) {
    x -= (minWidth - width) / 2;
    width = minWidth;
  }
  if (height < minHeight) {
    y -= (minHeight - height) / 2;
    height = minHeight;
  }

  width = Math.min(width, viewWidth);
  height = Math.min(height, viewHeight);
  x = clamp(x, 0, viewWidth - width);
  y = clamp(y, 0, viewHeight - height);
  return { x: round2(x), y: round2(y), w: round2(width), h: round2(height) };
}

const deltas = [];
const usedNumbers = new Set();
for (const delta of data.deltas) {
  need(delta && Number.isInteger(delta.n) && delta.n > 0, "each delta needs a positive integer n");
  need(!usedNumbers.has(delta.n), `duplicate delta number: ${delta.n}`);
  usedNumbers.add(delta.n);
  need(isText(delta.title), `delta ${delta.n}: title required`);

  if (delta.notObserved != null) {
    need(isText(delta.notObserved), `delta ${delta.n}: notObserved must be a reason string`);
    need(
      !delta.pair && !delta.why && !delta.before && !delta.after && !delta.crop && delta.absent == null,
      `delta ${delta.n}: notObserved cannot be combined with pair, why, before, after, crop or absent`,
    );
    deltas.push({ kind: "missing", n: delta.n, title: delta.title, reason: delta.notObserved });
    continue;
  }

  need(isText(delta.why), `delta ${delta.n}: why required`);
  need(
    isText(delta.source),
    `delta ${delta.n}: source required (file:line) — prefix it with [inferred] when no source exists`,
  );
  const pair = pairs.get(delta.pair);
  need(pair, `delta ${delta.n}: unknown pair id ${JSON.stringify(delta.pair)}`);

  const before = readRegions(delta.before ?? [], `delta ${delta.n} before`);
  const after = readRegions(delta.after ?? [], `delta ${delta.n} after`);
  need(before.length || after.length, `delta ${delta.n}: needs at least one rect on before or after`);
  need(
    delta.absent == null,
    `delta ${delta.n}: absent is no longer supported; box the same component rect on both sides instead`,
  );

  let crop = null;
  if (delta.crop != null) {
    for (const key of ["x", "y", "w", "h"]) {
      need(Number.isFinite(delta.crop?.[key]), `delta ${delta.n}: crop.${key} must be a number`);
    }
    need(
      delta.crop.w > 0 && delta.crop.h > 0,
      `delta ${delta.n}: crop must have positive w and h`,
    );
    crop = { x: delta.crop.x, y: delta.crop.y, w: delta.crop.w, h: delta.crop.h };
  }

  deltas.push({
    kind: "delta",
    n: delta.n,
    title: delta.title,
    why: delta.why,
    source: delta.source,
    pair,
    before,
    after,
    crop,
  });
}
deltas.sort((a, b) => a.n - b.n);

function readList(value, label) {
  if (value == null) return [];
  need(Array.isArray(value) && value.every(isText), `${label} must be an array of strings`);
  return value;
}

const unchanged = readList(data.unchanged, "unchanged");
const notUI = readList(data.notUI, "notUI");
const notObserved = readList(data.notObserved, "notObserved");

function renderCallouts(regions, crop, number, side) {
  let clipped = false;
  const boxes = mergeBoxes(
    regions.map((rect, index) => {
      const box = rectBox(rect, crop, `delta ${number} ${side}[${index}]`);
      clipped = clipped || box.clipped;
      return box;
    }),
  );
  const html = boxes
    .map((box) => {
      const area = (box.right - box.left) * (box.bottom - box.top);
      const cropArea = crop.w * crop.h;
      need(
        area < cropArea * 0.95,
        `delta ${number} ${side}: box covers ≥95% of the crop; mark the changed component, not the viewport`,
      );
      const bare = area >= cropArea * 0.6;
      const className = bare ? "callout callout--bare" : "callout";
      const style =
        `left:${percent(box.left - crop.x, crop.w)};top:${percent(box.top - crop.y, crop.h)};` +
        `width:${percent(box.right - box.left, crop.w)};height:${percent(box.bottom - box.top, crop.h)}`;
      return `<div class="${className}" style="${style}"></div>`;
    })
    .join("");
  return { html, clipped };
}

function renderShot(side, delta, crop) {
  const { pair } = delta;
  const absPath = side === "before" ? pair.beforeAbs : pair.afterAbs;
  const dimensions = side === "before" ? pair.beforeDims : pair.afterDims;
  const regions = side === "before" ? delta.before : delta.after;
  const { html, clipped } = renderCallouts(regions, crop, delta.n, side);
  const label = side === "before" ? "Before" : "After";
  const href = esc(hrefFor(absPath));
  const alt = `${label}: ${delta.title} at ${pair.route}, state ${pair.state} (cropped to the changed component)`;
  const imageWidth = (viewWidth / crop.w) * 100;
  const imageLeft = -(crop.x / crop.w) * 100;
  const imageTop = -(crop.y / crop.h) * 100;
  return {
    clipped,
    html: `<figure class="shot">
  <a class="frame" href="${href}" target="_blank" rel="noopener" title="Open the full viewport capture">
    <div class="crop" style="aspect-ratio:${crop.w}/${crop.h}">
      <img src="${href}" alt="${esc(alt)}" width="${dimensions.width}" height="${dimensions.height}" style="width:${imageWidth.toFixed(3)}%;left:${imageLeft.toFixed(3)}%;top:${imageTop.toFixed(3)}%">
      ${html}
    </div>
  </a>
  <figcaption>${label} — <code>${esc(pair.route)}</code> · ${esc(pair.state)} · <a href="${href}" target="_blank" rel="noopener">full capture</a></figcaption>
</figure>`,
  };
}

function renderDelta(delta) {
  const head = (title) =>
    `<div class="delta-head"><h2><span class="n" aria-hidden="true">${delta.n}.</span> ` +
    `<span class="sr-only">Change ${delta.n}: </span>${esc(title)}</h2></div>`;

  if (delta.kind === "missing") {
    return `<article class="delta delta--missing" id="delta-${delta.n}">
  ${head(delta.title)}
  <p class="missing"><strong>Not observed.</strong> ${esc(delta.reason)}</p>
</article>`;
  }

  const crop = cropFor(delta);
  const before = renderShot("before", delta, crop);
  const after = renderShot("after", delta, crop);
  const note = before.clipped || after.clipped
    ? `<p class="note">A box is clipped at the viewport edge; the changed element extends beyond the capture.</p>`
    : "";
  return `<article class="delta" id="delta-${delta.n}">
  ${head(delta.title)}
  <p class="why">${esc(delta.why).replace(/\n/g, "<br>")}</p>
  <p class="source"><code>${esc(delta.source)}</code></p>
  <div class="pair">${before.html}${after.html}</div>
  ${note}
</article>`;
}

function renderEvidence(title, items, className = "") {
  const body = items.length
    ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
    : `<p class="none">None recorded.</p>`;
  return `<div class="evidence-block ${className}">
  <h2>${esc(title)}</h2>
  ${body}
</div>`;
}

const baseLabel = isText(data.base.label) ? `${data.base.label}@` : "";
const headLabel = isText(data.head.label) ? `${data.head.label}@` : "";
const verification = `<div class="evidence-block verification">
  <h2>Verification</h2>
  <p><code>${esc(data.verification.command)}</code> — ${esc(data.verification.result)}</p>
</div>`;

const evidence =
  renderEvidence("Unchanged", unchanged) +
  renderEvidence("Not UI", notUI) +
  renderEvidence("Not observed", notObserved) +
  verification;

const style = `:root{
  color-scheme: light;
  --bg:#FAFAF8;
  --card:#FDFCFA;
  --ink:#1E2836;
  --muted:#5A6472;
  --border:rgba(30,40,54,.12);
  --signal:#F97316;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg);
  color:var(--ink);
  font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.report{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:56px 0 72px;text-align:left}
.eyebrow{margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{margin:0;font-size:32px;line-height:1.2;letter-spacing:-.02em}
.refs{margin:14px 0 0;font-size:13px;color:var(--muted)}
.meta{margin:4px 0 0;font-size:13px;color:var(--muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:rgba(30,40,54,.06);padding:1px 5px;border-radius:5px}
.summary{max-width:70ch;margin:20px 0 0;font-size:18px;line-height:1.55}
.legend{max-width:64ch;margin:16px 0 0;font-size:13px;color:var(--muted)}
.deltas{margin-top:40px;display:grid;gap:24px}
.delta{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:18px;
  padding:32px 28px;
  text-align:left;
}
.delta--missing{border-style:dashed}
.delta-head{margin:0}
.delta-head h2{margin:0;font-size:20px;line-height:1.3}
.n{color:var(--signal);font-size:20px;line-height:1.3;font-weight:700;font-variant-numeric:tabular-nums}
.why{max-width:70ch;margin:14px 0 0}
.source{margin:10px 0 0;font-size:12px;color:var(--muted)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:26px 0 0;align-items:start}
.shot{margin:0}
.frame{position:relative;display:block;border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden}
.crop{position:relative;overflow:hidden;background:var(--card)}
.crop img{position:absolute;display:block;max-width:none;height:auto;border-radius:0}
figcaption{margin-top:8px;font-size:12px;color:var(--muted)}
figcaption a{color:var(--ink);text-decoration:underline;text-underline-offset:2px}
.callout{
  position:absolute;border:2px solid var(--signal);
  background:rgba(249,115,22,.08);border-radius:4px;
  pointer-events:none;
}
.callout--bare{background:transparent}
.note{margin:12px 0 0;font-size:12px;color:var(--muted)}
.missing{max-width:70ch;margin:14px 0 0;color:var(--muted)}
.evidence{margin-top:40px;display:grid;gap:20px;text-align:left}
.evidence h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.evidence ul{list-style:none;margin:0;padding:0}
.evidence li{margin:4px 0}
.evidence li::before{content:"— ";color:var(--muted)}
.none{margin:0;color:var(--muted)}
.verification code{overflow-wrap:anywhere}
.generated{margin-top:40px;font-size:12px;color:var(--muted)}
@media (max-width:760px){
  .report{width:calc(100% - 24px);padding:28px 0 48px}
  h1{font-size:24px}
  .delta{padding:22px 16px;border-radius:14px}
  .pair{grid-template-columns:1fr;gap:16px}
  .delta-head h2{font-size:18px}
}
@media print{
  .delta{break-inside:avoid}
  .pair{grid-template-columns:1fr 1fr}
}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI previews — ${esc(data.title)}</title>
<style>${style}</style>
</head>
<body>
<main class="report">
  <header class="masthead">
    <p class="eyebrow">UI previews</p>
    <h1>${esc(data.title)}</h1>
    <p class="refs"><code>${esc(baseLabel + data.base.ref)}</code> → <code>${esc(headLabel + data.head.ref)}</code></p>
    <p class="meta">${esc(data.fixture)} · ${viewWidth}×${viewHeight} · ${esc(data.theme)} · ${esc(date)}</p>
    <p class="summary">${esc(data.summary)}</p>
    <p class="legend">Screenshots are cropped around the changed component; the orange box marks it. Click a screenshot or “full capture” to open the full ${viewWidth}×${viewHeight} viewport.</p>
  </header>

  <section class="deltas">
${deltas.map(renderDelta).join("\n")}
  </section>

  <section class="evidence">
${evidence}
  </section>

  <p class="generated">Generated from <code>${esc(relative(outDir, jsonAbs).split(sep).join("/"))}</code> by ui-previews.</p>
</main>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outAbs, html);
console.log(`wrote ${outAbs}`);
console.log(`deltas: ${deltas.filter((delta) => delta.kind === "delta").length}, not observed: ${deltas.filter((delta) => delta.kind === "missing").length}`);
