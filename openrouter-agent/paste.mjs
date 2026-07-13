// Mirrors what mission/paste.js sends: a bracketed-paste block
// (\x1b[200~...\x1b[201~) followed by a separate \r once the paste
// settles. A raw \r/\n byte can legitimately arrive as part of the pasted
// content itself (PTY data is chunked arbitrarily, so a paste can be
// fragmented across several feed() calls) — such bytes must never trigger
// submission. `scanFrom` tracks the boundary: everything before it is
// "protected" (already-seen paste content, immune to newline-triggered
// submission even though it contains real \n bytes); only bytes at or
// after `scanFrom` are scanned for a genuine submit trigger.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export function createPasteParser() {
  let buffer = "";
  let inPaste = false;
  let scanFrom = 0;

  return {
    feed(chunk) {
      buffer += chunk;

      if (!inPaste && buffer.slice(scanFrom).includes(PASTE_START)) {
        const startIdx = buffer.indexOf(PASTE_START, scanFrom);
        inPaste = true;
        buffer = buffer.slice(0, startIdx) + buffer.slice(startIdx + PASTE_START.length);
        scanFrom = startIdx;
      }

      if (inPaste) {
        const endIdx = buffer.indexOf(PASTE_END, scanFrom);
        if (endIdx === -1) return { type: "buffering" };
        buffer = buffer.slice(0, endIdx) + buffer.slice(endIdx + PASTE_END.length);
        inPaste = false;
        scanFrom = buffer.length; // protect everything up through the pasted content
      }

      const rest = buffer.slice(scanFrom);
      const submitIdx = rest.search(/[\r\n]/);
      if (submitIdx === -1) return { type: "buffering" };
      const text = buffer.slice(0, scanFrom + submitIdx);
      buffer = "";
      scanFrom = 0;
      return { type: "submitted", text };
    },
  };
}
