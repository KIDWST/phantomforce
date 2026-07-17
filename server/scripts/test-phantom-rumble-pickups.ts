function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// applyPickupEffect is defined inline in app/games/phantom-rumble.html (a
// browser-only file with no module exports — this codebase's games are
// single self-contained HTML files by design, per every other game under
// app/games/). This test re-implements the function verbatim from the plan
// so its pure-logic contract is pinned down and regress-checkable outside
// a browser; Task 3 Step 3 asserts (by manual read-through, since the
// browser file can't import this test) that the shipped function matches
// this reference implementation exactly.
function applyPickupEffect(kind: string, fighter: { pct: number; power: boolean; shurikenArmed: boolean; speedBuff: number }) {
  if (kind === "heart") fighter.pct = Math.max(0, fighter.pct - 30);
  if (kind === "spark") fighter.power = true;
  if (kind === "shuriken") fighter.shurikenArmed = true;
  if (kind === "speed") fighter.speedBuff = 6;
  return fighter;
}

const healed = applyPickupEffect("heart", { pct: 50, power: false, shurikenArmed: false, speedBuff: 0 });
assert(healed.pct === 20, "Heart pickup should reduce pct by 30.");

const healedAtZero = applyPickupEffect("heart", { pct: 10, power: false, shurikenArmed: false, speedBuff: 0 });
assert(healedAtZero.pct === 0, "Heart pickup should clamp pct at 0, never negative.");

const sparked = applyPickupEffect("spark", { pct: 0, power: false, shurikenArmed: false, speedBuff: 0 });
assert(sparked.power === true, "Spark pickup should arm the power flag.");

const armed = applyPickupEffect("shuriken", { pct: 0, power: false, shurikenArmed: false, speedBuff: 0 });
assert(armed.shurikenArmed === true, "Shuriken pickup should arm the throw flag.");

const sped = applyPickupEffect("speed", { pct: 0, power: false, shurikenArmed: false, speedBuff: 0 });
assert(sped.speedBuff === 6, "Speed scroll should grant 6 seconds of buff.");

console.log("PASS: pickup effect reference implementation");
