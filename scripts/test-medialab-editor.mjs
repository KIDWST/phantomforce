import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { freshEditState } = await import("../app/js/imagefilters.js?v=phantom-live-20260712-216");
const { cloneImageEditState } = await import("../app/js/content-editor.js?v=phantom-live-20260712-216");

const source = freshEditState();
source.paint = {
  size: 44,
  opacity: 62,
  strokes: [
    { mode: "erase", color: "#ffffff", size: 30, opacity: 100, points: [{ x: 0.2, y: 0.3 }, { x: 0.25, y: 0.35 }] },
    { mode: "paint", color: "#41ffa1", size: 18, opacity: 72, points: [{ x: 0.5, y: 0.5 }] },
  ],
};

const snapshot = cloneImageEditState(source);
source.paint.strokes[0].points[0].x = 0.99;
source.paint.strokes.push({ mode: "paint", color: "#000000", size: 1, opacity: 1, points: [] });

assert.equal(snapshot.paint.strokes.length, 2, "paint history snapshots must not share the live strokes array");
assert.equal(snapshot.paint.strokes[0].points[0].x, 0.2, "paint stroke points must be deep-cloned for undo");
assert.equal(snapshot.paint.strokes[0].mode, "erase", "eraser strokes must survive history clone");

const restored = cloneImageEditState(snapshot);
restored.paint.strokes[0].points[0].y = 0.88;
assert.equal(snapshot.paint.strokes[0].points[0].y, 0.3, "redo snapshots must not share nested point objects");

const mediaSrc = readFileSync(new URL("../app/js/medialab.js", import.meta.url), "utf8");
const backendSrc = readFileSync(new URL("../app/js/mediabackend.js", import.meta.url), "utf8");
const editorSrc = readFileSync(new URL("../app/js/content-editor.js", import.meta.url), "utf8");
const cssSrc = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
const mediaPoolGridBlock = cssSrc.match(/\.ml-grid-lib\s*\{[^}]*\}/u)?.[0] || "";

assert.match(mediaSrc, /ctx\.globalCompositeOperation\s*=\s*erase\s*\?\s*"destination-out"/, "eraser must use destination-out compositing");
assert.match(mediaSrc, /ctx\.globalAlpha\s*=\s*erase\s*\?\s*1\s*:/, "eraser must cut fully transparent pixels");
assert.match(mediaSrc, /opacity:\s*mlPaintMode === "erase"\s*\?\s*100\s*:/, "new eraser strokes must record full opacity");
assert.match(editorSrc, /function\s+drawLayerPaintStrokes[\s\S]*globalCompositeOperation\s*=\s*erase\s*\?\s*"destination-out"/u, "composition rendering must apply eraser strokes as transparent pixels");
assert.match(editorSrc, /paintEdit\(rendered,\s*image,\s*layerState\);[\s\S]*drawLayerPaintStrokes\(rendered,\s*layerState\)/u, "composition preview/export must include paint strokes after image filters");
assert.match(mediaSrc, /async function exportCurrentEdit[\s\S]*await renderEditorCanvas\(canvas\._img\);[\s\S]*return exportCanvas\(canvas,\s*repaintWithImg/u, "save/download/AI handoff must repaint the full edit before export");
assert.match(mediaSrc, /canvas\._img\s*=\s*img;[\s\S]*repaint\(\)/u, "loaded edit images must be assigned to the canvas before first repaint");
assert.match(mediaSrc, /canvas\._img !== img/u, "async editor renders must not overwrite the canvas after the selected image changes");
assert.match(backendSrc, /await repaintFn\(rescued\)/, "tainted-canvas rescue must wait for repaint before retrying export");
assert.match(backendSrc, /friendlyBackendError[\s\S]*Sign in to sync Media Pool assets[\s\S]*Sign in to load synced Media Pool assets[\s\S]*Sign in to load this Media Pool asset/u, "Media backend sync helpers must hide raw auth transport errors.");
assert.match(mediaSrc, /updateEditHistoryControls\(body\)/, "undo/redo controls must refresh without a full remount");
assert.match(mediaSrc, /freshComposition\(\)/, "Media Lab edit must keep a real layer composition, not a flattened Canva-style editor");
assert.match(mediaSrc, /data-ml-layer-order/, "Media Lab edit must expose layer up/down controls");
assert.match(mediaSrc, /addImageLayer\(mlComposition,\s*row\.url/u, "Asset Cloud selections must add image layers instead of replacing the current image");
assert.match(mediaSrc, /renderComposition\(canvas,\s*img,\s*editState,\s*mlComposition,\s*mlLayerEffects\)/u, "Save/download canvas must render the composed layer stack");
assert.doesNotMatch(mediaSrc, /data-ml-duplicate-edit>Duplicate image/, "Media Lab should not show a flattened duplicate-image action in the editor footer");
assert.match(cssSrc, /\.ml-canvas\s*\{[\s\S]*background-image:/, "transparent erased pixels need a visible checkerboard backdrop");
assert.match(cssSrc, /\.ml-layer-row\.is-selected/u, "Layer rows need a visible selected state");
assert.ok(mediaPoolGridBlock, "Media Pool grid CSS block must be present");
assert.match(mediaPoolGridBlock, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(150px,\s*190px\)\)[\s\S]*padding-bottom:\s*14px/u, "Media Pool must use capped thumbnail columns instead of stretching a few assets across the screen");
assert.match(cssSrc, /\.ml-grid-lib\s+\.ml-tile\s*\{[\s\S]*max-width:\s*190px[\s\S]*aspect-ratio:\s*4\s*\/\s*5/u, "Media Pool tiles must stay library-sized");
assert.match(cssSrc, /\.ml-grid-lib\s+\.ml-tile\s+img\s*\{[\s\S]*object-fit:\s*contain/u, "Media Pool images must fit inside thumbnails without cropping huge previews");
assert.doesNotMatch(mediaPoolGridBlock, /overflow:\s*auto/u, "Media Pool grid must not add a second scrollbar inside the Media Lab body scroll area");
assert.match(cssSrc, /\.ml-body:has\(\.ml-grid-lib\)\s*\{[\s\S]*overflow:\s*auto/u, "Media Pool needs its own scroll area inside the fixed Media Lab shell");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.workspace-page-body\s*\{[\s\S]*overflow:\s*auto/u, "Media Lab page body must scroll when controls extend below the viewport");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.workspace-page-body\s*\{[\s\S]*padding-bottom:\s*calc\(96px/u, "Media Lab needs bottom scroll padding so hidden lower controls stay reachable");
assert.match(cssSrc, /\.workspace-page-first\[data-workspace-page="media"\]\s+\.workspace-page-body,[\s\S]*\.workspace-page\[data-workspace-page="media"\]\s+\.workspace-page-body\s*\{[\s\S]*overflow-y:\s*auto\s*!important/u, "Media Lab scroll rules must win late cascade overrides.");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.ml-body\s*\{[\s\S]*overflow:\s*auto/u, "Media Lab internal body must be scrollable for dense create/edit states");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.ml-editor\s*\{[\s\S]*max-height:\s*min\(100%,\s*calc\(100dvh\s*-\s*220px\)\)/u, "Media Lab editor must stay capped to the desktop viewport");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.ml-tools\s*\{[\s\S]*max-height:\s*min\(100%,\s*calc\(100dvh\s*-\s*220px\)\)[\s\S]*overscroll-behavior:\s*contain[\s\S]*scrollbar-gutter:\s*stable/u, "Media Lab editor sidebar must own scroll instead of disappearing below the viewport");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.ml-canvas-wrap\s*\{[\s\S]*max-height:\s*min\(100%,\s*calc\(100dvh\s*-\s*220px\)\)/u, "Media Lab canvas rail must stay viewport-capped beside the editor sidebar");

console.log("medialab editor tests passed");
