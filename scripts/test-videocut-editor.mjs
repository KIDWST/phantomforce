import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const videoSrc = readFileSync(new URL("../app/js/videocut.js", import.meta.url), "utf8");
const cssSrc = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");

assert.match(videoSrc, /function splitPointForClip\(clip\)/u, "PhantomCut must calculate whether the playhead can split the selected clip.");
assert.match(videoSrc, /function splitClipAtPlayhead\(clip\)/u, "PhantomCut must implement a real split-at-playhead action.");
assert.match(videoSrc, /function containRect\(mw,\s*mh,\s*cw,\s*ch\)/u, "PhantomCut must be able to fit full media inside the export frame.");
assert.match(videoSrc, /function drawContainedMediaFrame\(source,\s*mw,\s*mh,\s*W,\s*H\)/u, "PhantomCut fit mode must render a full-media frame with a backdrop.");
assert.match(videoSrc, /fit:\s*"cover"/u, "New PhantomCut clips must default to social-video fill framing.");
assert.match(videoSrc, /clip\.fit === "contain"[\s\S]*drawContainedMediaFrame\(clip\.el,\s*clip\.w,\s*clip\.h,\s*W,\s*H\)/u, "Photo clips must support contain-fit drawing.");
assert.match(videoSrc, /clip\.fit === "contain"[\s\S]*drawContainedMediaFrame\(el,\s*el\.videoWidth,\s*el\.videoHeight,\s*W,\s*H\)/u, "Video clips must support contain-fit drawing.");
assert.match(videoSrc, /clip\.duration = split\.local[\s\S]*copy\.duration = Math\.max\(0\.5,\s*originalDuration - split\.local\)/u, "Splitting a photo clip must create two timeline durations.");
assert.match(videoSrc, /const cut = clip\.in \+ split\.local[\s\S]*copy\.in = cut[\s\S]*copy\.out = clip\.out[\s\S]*clip\.out = cut/u, "Splitting a video clip must divide in/out trim ranges.");
assert.match(videoSrc, /if \(clip\.owned\) clip\.owned = false/u, "Splitting a local object URL must not let one half revoke the other half's media.");
assert.match(videoSrc, /data-vc-ins-split/u, "PhantomCut inspector must expose a Split at playhead control.");
assert.match(videoSrc, /splitPointForClip\(clip\)[\s\S]*Move the playhead inside this clip/u, "The split control must explain why it is unavailable.");
assert.match(videoSrc, /data-vc-ins-fit/u, "PhantomCut inspector must expose per-clip framing controls.");
assert.match(videoSrc, /clip\.fit = e\.target\.value === "contain" \? "contain" : "cover"/u, "Framing controls must update the selected clip fit mode.");
assert.match(cssSrc, /\.vc-ins-tools\s*\{/u, "The split control needs a dedicated inspector layout.");
assert.match(cssSrc, /\.vc-ins-tools button:disabled/u, "Disabled split controls must have a visible unavailable state.");

console.log("PhantomCut editor checks passed");
