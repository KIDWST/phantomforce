import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { freshEditState } = await import("../app/js/imagefilters.js?v=phantom-live-20260714-267");
const {
  alignSelectedLayers, applyLayerDragWithSnap, cloneImageEditState, distributeSelectedLayers, freshComposition,
  addImageLayer, addTextLayer, addColorLayer, layerBounds, moveLayerToIndex,
} = await import("../app/js/content-editor.js?v=phantom-live-20260714-267");

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

const composition = freshComposition();
const imageLayer = addImageLayer(composition, "memory://asset.webp");
const textLayer = addTextLayer(composition, "Launch");
const colorLayer = addColorLayer(composition, "#04120c");
for (const layer of [composition.layers.find((item) => item.id === "base"), imageLayer, textLayer, colorLayer]) {
  assert.equal(layer.blend, "source-over", `${layer.type} layers must default to normal blend mode`);
}
assert.equal(moveLayerToIndex(composition, imageLayer.id, 0), true, "layer drag helper must move a layer to a direct stack index");
assert.equal(composition.layers[0].id, imageLayer.id, "move-to-index must update the render stack order");
assert.deepEqual(composition.selectedIds, [imageLayer.id], "move-to-index must keep the moved layer selected");

const nearly = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.0001, `${label}: expected ${expected}, got ${actual}`);
const layout = freshComposition();
layout.width = 1000;
layout.height = 500;
const leftLayer = addImageLayer(layout, "memory://left.webp", "Left");
const middleLayer = addTextLayer(layout, "Middle");
const rightLayer = addTextLayer(layout, "Right");
Object.assign(leftLayer, { x: 0.16, y: 0.35, w: 0.18, h: 0.2 });
Object.assign(middleLayer, { x: 0.48, y: 0.55, w: 0.16, h: 0.18 });
Object.assign(rightLayer, { x: 0.82, y: 0.42, w: 0.14, h: 0.16 });
layout.selectedIds = [leftLayer.id];
assert.equal(alignSelectedLayers(layout, "hcenter"), true, "single selected layer should align against the canvas");
nearly(leftLayer.x, 0.5, "single layer horizontal center");
layout.selectedIds = [leftLayer.id, middleLayer.id, rightLayer.id];
assert.equal(alignSelectedLayers(layout, "top"), true, "multiple selected layers should align by selection bounds");
const topEdges = layout.selectedIds.map((id) => layerBounds(layout.layers.find((layer) => layer.id === id), layout.width, layout.height).top);
nearly(Math.max(...topEdges) - Math.min(...topEdges), 0, "aligned top edges");
Object.assign(leftLayer, { x: 0.12 });
Object.assign(middleLayer, { x: 0.36 });
Object.assign(rightLayer, { x: 0.91 });
assert.equal(distributeSelectedLayers(layout, "x"), true, "three selected layers should distribute horizontally");
const centers = [leftLayer, middleLayer, rightLayer]
  .map((layer) => layerBounds(layer, layout.width, layout.height))
  .map((bounds) => (bounds.left + bounds.right) / 2)
  .sort((a, b) => a - b);
nearly(centers[1] - centers[0], centers[2] - centers[1], "distributed center spacing");
const snapLayout = freshComposition();
snapLayout.width = 1000;
snapLayout.height = 500;
const snapLayer = addTextLayer(snapLayout, "Snap");
Object.assign(snapLayer, { x: 0.47, y: 0.33, w: 0.2, h: 0.2 });
snapLayout.selectedIds = [snapLayer.id];
const guides = applyLayerDragWithSnap(snapLayout, [{ layer: snapLayer, x: snapLayer.x, y: snapLayer.y }], 0.025, 0);
assert.deepEqual(guides, [{ axis: "x", at: 0.5 }], "dragging near canvas center should return a visible vertical snap guide");
nearly(snapLayer.x, 0.5, "dragged layer snaps to canvas center");

const mediaSrc = readFileSync(new URL("../app/js/medialab.js", import.meta.url), "utf8");
const cssSrc = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
const editorSrc = readFileSync(new URL("../app/js/content-editor.js", import.meta.url), "utf8");

assert.match(mediaSrc, /ctx\.globalCompositeOperation\s*=\s*erase\s*\?\s*"destination-out"/, "eraser must use destination-out compositing");
assert.match(mediaSrc, /ctx\.globalAlpha\s*=\s*erase\s*\?\s*1\s*:/, "eraser must cut fully transparent pixels");
assert.match(mediaSrc, /opacity:\s*mlPaintMode === "erase"\s*\?\s*100\s*:/, "new eraser strokes must record full opacity");
assert.match(mediaSrc, /updateEditHistoryControls\(body\)/, "undo/redo controls must refresh without a full remount");
assert.match(mediaSrc, /freshComposition\(\)/, "Media Lab edit must keep a real layer composition, not a flattened Canva-style editor");
assert.doesNotMatch(mediaSrc, /class="ml-back"|data-ml-back|← Back/u, "Media Lab main tab bar must not render a generic Back button.");
assert.doesNotMatch(cssSrc, /\.ml-back\b/u, "Media Lab must not keep stale styling for a generic top-level Back button.");
assert.match(mediaSrc, /data-ml-edit-back/u, "Media Lab may keep scoped editor back controls for real edit subflows.");
assert.match(mediaSrc, /data-ml-layer-order/, "Media Lab edit must expose layer up/down controls");
assert.match(mediaSrc, /draggable="\$\{layer\.locked \? "false" : "true"\}"/u, "Media Lab layer rows must be draggable unless locked");
assert.match(mediaSrc, /data-ml-layer-index="\$\{realIndex\}"/u, "Media Lab layer rows must carry their real stack index for drag/drop ordering");
assert.match(mediaSrc, /dataTransfer\?\.setData\("text\/x-phantom-layer",\s*layer\.id\)/u, "Media Lab layer drag must write the dragged layer id.");
assert.match(mediaSrc, /moveLayerToIndex\(mlComposition,\s*draggedId,\s*targetIndex\)/u, "Media Lab layer drop must reorder through the shared move-to-index helper.");
assert.match(mediaSrc, /addImageLayer\(mlComposition,\s*row\.url/u, "Asset Cloud selections must add image layers instead of replacing the current image");
assert.match(mediaSrc, /data-ml-layer-overlay/u, "Media Lab edit must draw a selectable transform overlay over the image canvas");
assert.match(mediaSrc, /hitTestResizeHandle\(mlComposition,\s*point,\s*canvas/u, "Media Lab edit must support direct corner-handle resizing on the canvas");
assert.match(mediaSrc, /drawCompositionOverlay\(overlay,\s*canvas,\s*mlComposition/u, "Media Lab edit must show layer bounds and resize handles while editing");
assert.match(mediaSrc, /let mlEditKeyHandler = null/u, "Media Lab photo editor must keep a single scoped keyboard handler.");
assert.match(mediaSrc, /const isEditorTypingTarget = \(target\)[\s\S]*input, textarea, select, button, \[contenteditable\]/u, "Media Lab keyboard shortcuts must ignore typing fields.");
assert.match(mediaSrc, /const undoPhotoEdit = \(\) =>[\s\S]*restoreEdit\(mlEditHistory\.pop\(\)\)/u, "Media Lab must expose undo through the shared editor shortcut path.");
assert.match(mediaSrc, /const redoPhotoEdit = \(\) =>[\s\S]*restoreEdit\(mlEditFuture\.pop\(\)\)/u, "Media Lab must expose redo through the shared editor shortcut path.");
assert.match(mediaSrc, /const duplicateActiveLayer = \(\) =>[\s\S]*duplicateLayer\(mlComposition,\s*active\.id\)/u, "Media Lab must expose layer duplication through the shared shortcut path.");
assert.match(mediaSrc, /selectAllLayers,\s*selectLayer,\s*selectedLayers/u, "Media Lab must import the shared select-all layer helper.");
assert.match(mediaSrc, /data-ml-layer-select-all/u, "Media Lab layer actions must expose Select all.");
assert.match(mediaSrc, /const selectAllEditableLayers = \(\) =>[\s\S]*selectAllLayers\(mlComposition\)[\s\S]*layer\.id !== "base"[\s\S]*!layer\.locked/u, "Media Lab select-all must select only editable non-base layers.");
assert.match(mediaSrc, /let mlLayerClipboard = \[\]/u, "Media Lab must keep an editor layer clipboard.");
assert.match(mediaSrc, /const copySelectedEditableLayers = \(\) =>[\s\S]*selectedLayers\(mlComposition\)\.filter\(\(layer\) => layer\.id !== "base"[\s\S]*mlLayerClipboard = targets\.map/u, "Media Lab must support copying selected non-base layers.");
assert.match(mediaSrc, /const pasteLayerClipboard = \(\) =>[\s\S]*rememberEdit\(\)[\s\S]*mlComposition\.layers\.push\(copy\)[\s\S]*mlComposition\.selectedIds = pastedIds/u, "Media Lab must support pasting copied layers back into the editable stack.");
assert.match(mediaSrc, /cloneImageEditState\(item\.effect,\s*\{ includeMask: false \}\)/u, "Pasted Media Lab image layers must keep their per-layer edit effects.");
assert.match(mediaSrc, /const deleteSelectedEditableLayers = \(\) =>[\s\S]*removeSelectedLayers\(mlComposition\)/u, "Media Lab must expose selected-layer deletion through the shared shortcut path.");
assert.match(mediaSrc, /const nudgeSelectedLayers = \(dx,\s*dy\) =>[\s\S]*layer\.x = Math\.max\(0,\s*Math\.min\(1[\s\S]*layer\.y = Math\.max\(0,\s*Math\.min\(1/u, "Media Lab must support arrow-key layer nudging with canvas-safe bounds.");
assert.match(mediaSrc, /document\.addEventListener\("keydown",\s*mlEditKeyHandler\)/u, "Media Lab must wire the photo editor keyboard handler.");
assert.match(mediaSrc, /key === "a"\) handled = selectAllEditableLayers\(\)/u, "Ctrl/Cmd+A must select editable layers.");
assert.match(mediaSrc, /key === "c"\)[\s\S]*copySelectedEditableLayers\(\)/u, "Ctrl/Cmd+C must copy selected layers.");
assert.match(mediaSrc, /key === "v"\)[\s\S]*pasteLayerClipboard\(\)/u, "Ctrl/Cmd+V must paste copied layers.");
assert.match(mediaSrc, /key === "arrowleft"[\s\S]*nudgeSelectedLayers\(event\.shiftKey \? -0\.025 : -0\.005/u, "Arrow keys must nudge selected layers, with Shift for larger moves.");
assert.match(mediaSrc, /data-ml-layer-lock="\$\{esc\(layer\.id\)\}"/u, "Media Lab layer rows must expose lock/unlock controls.");
assert.match(mediaSrc, /data-ml-layer-copy/u, "Media Lab layer actions must expose Copy.");
assert.match(mediaSrc, /data-ml-layer-paste/u, "Media Lab layer actions must expose Paste.");
assert.match(mediaSrc, /layer\.locked \? "is-locked" : ""/u, "Locked Media Lab layers must render a visible locked state.");
assert.match(mediaSrc, /layer\.locked \|\| realIndex <= 0 \? "disabled"/u, "Locked layers must not be movable down.");
assert.match(mediaSrc, /layer\.locked \|\| realIndex >= mlComposition\.layers\.length - 1 \? "disabled"/u, "Locked layers must not be movable up.");
assert.match(mediaSrc, /activeLocked \? "disabled" : ""/u, "Locked selected layers must disable inspector controls.");
assert.match(mediaSrc, /body\.querySelectorAll\("\[data-ml-layer-lock\]"\)[\s\S]*layer\.locked = !layer\.locked/u, "Media Lab must wire the lock/unlock layer toggle.");
assert.match(mediaSrc, /data-ml-layer-field="blend"/u, "Media Lab layers must expose blend mode controls in the inspector.");
assert.match(mediaSrc, /"multiply",\s*"Multiply"[\s\S]*"screen",\s*"Screen"[\s\S]*"overlay",\s*"Overlay"/u, "Media Lab blend mode controls must include standard compositing modes.");
assert.match(editorSrc, /const BLEND_MODES = new Set\(\["source-over", "multiply", "screen", "overlay", "soft-light"/u, "Layer renderer must whitelist supported blend modes.");
assert.match(editorSrc, /ctx\.globalCompositeOperation = blendMode\(layer\.blend\)/u, "Layer renderer must apply per-layer blend modes to the export canvas.");
assert.match(editorSrc, /export function applyLayerDragWithSnap\(composition,\s*starts,\s*dx,\s*dy/u, "Layer editor must expose reusable snap-aware drag geometry.");
assert.match(editorSrc, /guides\.push\(\{ axis: "x", at: snapX\.guide \}\)/u, "Snap helper must report vertical snap guides for the overlay.");
assert.match(mediaSrc, /let mlSnapGuides = \[\]/u, "Media Lab must keep transient snap-guide state during layer drags.");
assert.match(mediaSrc, /drawCompositionOverlay\(overlay,\s*canvas,\s*mlComposition,\s*mlSnapGuides\)/u, "Media Lab overlay must render snap guides while dragging.");
assert.match(mediaSrc, /mlSnapGuides = applyLayerDragWithSnap\(mlComposition,\s*starts,\s*dx,\s*dy\)/u, "Media Lab drag movement must use snap-aware layer geometry.");
assert.match(mediaSrc, /mlSnapGuides = \[\][\s\S]*overlay\.onpointermove = null/u, "Media Lab must clear snap guides when layer dragging ends.");
assert.match(mediaSrc, /data-ml-layer-center/u, "Media Lab layer inspector must expose a one-click center action.");
assert.match(mediaSrc, /data-ml-layer-fit-canvas/u, "Media Lab layer inspector must expose a one-click fill-canvas action.");
assert.match(mediaSrc, /data-ml-layer-reset-transform/u, "Media Lab layer inspector must expose a one-click transform reset action.");
assert.match(mediaSrc, /data-ml-layer-align="\$\{esc\(mode\)\}"/u, "Media Lab layer inspector must expose alignment controls.");
assert.match(mediaSrc, /data-ml-layer-distribute="x"/u, "Media Lab layer inspector must expose horizontal distribution.");
assert.match(mediaSrc, /alignSelectedLayers\(mlComposition,\s*button\.dataset\.mlLayerAlign\)/u, "Media Lab alignment buttons must use the shared composition helper.");
assert.match(mediaSrc, /distributeSelectedLayers\(mlComposition,\s*button\.dataset\.mlLayerDistribute\)/u, "Media Lab distribution buttons must use the shared composition helper.");
assert.match(mediaSrc, /const resetLayerTransformDefaults = \(layer\) =>[\s\S]*layer\.blend = "source-over"[\s\S]*layer\.type === "text"[\s\S]*layer\.type === "image"/u, "Media Lab transform reset must restore sensible per-layer defaults.");
assert.match(mediaSrc, /querySelector\("\[data-ml-layer-center\]"\)[\s\S]*layer\.x = 0\.5[\s\S]*layer\.y = 0\.5/u, "Media Lab center action must recenter the selected layer.");
assert.match(mediaSrc, /querySelector\("\[data-ml-layer-fit-canvas\]"\)[\s\S]*layer\.w = 1[\s\S]*layer\.h = 1[\s\S]*layer\.fit = "cover"/u, "Media Lab fill-canvas action must expand image/base layers to the canvas.");
assert.match(mediaSrc, /data-ml-layer-prop="fontSize"/u, "Text layers must expose type-size controls in the Media Lab inspector");
assert.match(mediaSrc, /data-ml-layer-field="color"/u, "Text layers must expose foreground color controls in the Media Lab inspector");
assert.match(mediaSrc, /data-ml-layer-toggle="shadow"/u, "Text layers must expose shadow toggles in the Media Lab inspector");
assert.match(mediaSrc, /data-ml-layer-field="fit"/u, "Image layers must expose contain/cover fit controls in the Media Lab inspector");
assert.match(mediaSrc, /let fieldRemembered = false[\s\S]*const rememberLayerFieldEdit = \(\) =>[\s\S]*rememberEdit\(\)[\s\S]*updateEditHistoryControls\(body\)/u, "Layer field edits must create an undo checkpoint.");
assert.match(mediaSrc, /field\.onfocus = rememberLayerFieldEdit[\s\S]*field\.onpointerdown = rememberLayerFieldEdit/u, "Layer field edits must remember history before typing, selecting, or color picking.");
assert.match(mediaSrc, /if \(!layer \|\| layer\.locked\) return;[\s\S]*layer\[field\.dataset\.mlLayerField\] = field\.value/u, "Layer field handlers must not mutate locked layers.");
assert.match(mediaSrc, /renderComposition\(canvas,\s*canvas\._img,\s*editState,\s*mlComposition,\s*mlLayerEffects\)/u, "Save/download canvas must render the composed layer stack");
assert.doesNotMatch(mediaSrc, /data-ml-duplicate-edit>Duplicate image/, "Media Lab should not show a flattened duplicate-image action in the editor footer");
assert.match(cssSrc, /\.ml-canvas\s*\{[\s\S]*background-image:/, "transparent erased pixels need a visible checkerboard backdrop");
assert.match(cssSrc, /\.ml-layer-overlay\.is-active\s*\{[\s\S]*pointer-events:\s*auto/u, "Media Lab transform overlay must receive pointer events in Select mode");
assert.match(cssSrc, /\.ml-layer-row\.is-selected/u, "Layer rows need a visible selected state");
assert.match(cssSrc, /\.ml-layer-row\[draggable="true"\]/u, "Draggable layer rows need a visible grab affordance");
assert.match(cssSrc, /\.ml-layer-row\.is-drop-target/u, "Layer drag/drop must show a visible drop target");
assert.match(cssSrc, /\.ml-layer-row\.is-locked\s*\{/u, "Locked layer rows need a visible locked state");
assert.match(cssSrc, /\.ml-layer-transform-actions\s*\{/u, "Layer transform actions need compact editor styling");
assert.match(cssSrc, /\.ml-layer-align-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(68px,\s*1fr\)\)/u, "Layer align/distribute actions need compact responsive styling");
assert.match(cssSrc, /\.ml-layer-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(76px,\s*1fr\)\)/u, "Layer action controls must wrap cleanly as editor actions grow.");
assert.match(cssSrc, /\.ml-layer-text-grid\s*\{/u, "Text layer controls need a compact inspector grid");
assert.match(cssSrc, /\.ml-layer-toggle-row button\.is-on/u, "Text layer toggles need a visible enabled state");
assert.match(cssSrc, /\.ml-grid-lib\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(170px,\s*220px\)\)/u, "Media Pool must use capped thumbnail columns instead of stretching a few assets across the screen");
assert.match(cssSrc, /\.ml-grid-lib\s+\.ml-tile\s*\{[\s\S]*max-width:\s*220px[\s\S]*aspect-ratio:\s*4\s*\/\s*5/u, "Media Pool tiles must stay library-sized");
assert.match(cssSrc, /\.ml-grid-lib\s+\.ml-tile\s+img\s*\{[\s\S]*object-fit:\s*contain/u, "Media Pool images must fit inside thumbnails without cropping huge previews");
assert.match(cssSrc, /\.ml-body:has\(\.ml-grid-lib\)\s*\{[\s\S]*overflow:\s*auto/u, "Media Pool needs its own scroll area inside the fixed Media Lab shell");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.workspace-page-body\s*\{[\s\S]*overflow:\s*auto/u, "Media Lab page body must scroll when controls extend below the viewport");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.workspace-page-body\s*\{[\s\S]*padding-bottom:\s*calc\(96px/u, "Media Lab needs bottom scroll padding so hidden lower controls stay reachable");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.ml-body\s*\{[\s\S]*overflow:\s*auto/u, "Media Lab internal body must be scrollable for dense create/edit states");
assert.match(cssSrc, /app-main:has\(\.workspace-page\[data-workspace-page="media"\]\)[\s\S]*overflow:\s*hidden\s*!important/u, "Media Lab must override the global natural-scroll rescue and keep its app workbench from flattening.");
assert.match(cssSrc, /\.workspace-page\[data-workspace-page="media"\]\s+\.media-suite-body[\s\S]*overflow:\s*auto\s*!important/u, "Media Lab suite body must remain a reachable scroll container after global page overrides.");
assert.match(mediaSrc, /const editPreviewUrl = \(\) =>[\s\S]*toDataURL\("image\/webp", 0\.68\)/u, "Edited Media Lab images must save a lightweight persistent preview thumbnail.");
assert.match(mediaSrc, /previewUrl:\s*editPreviewUrl\(\)[\s\S]*title: "Edited image"/u, "Save to Media Pool must persist a previewUrl for edited images so trimmed originals still display.");

console.log("medialab editor tests passed");
