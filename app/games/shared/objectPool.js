// Generic object pool — the concrete implementation of the "no per-frame
// allocation in the hot loop" principle from PHANTOMPLAY-NEXT-STEP.md §6.
// Used by phantom-ages/game.js for units and projectiles; drop this into
// any PhantomPlay title's spawn-heavy hot loop (bullets, particles,
// enemies) the same way.
class ObjectPool {
  constructor(factory, reset, initialSize = 0) {
    this.factory = factory; // () => T — creates a brand-new instance
    this.reset = reset;     // (T) => void — restores an instance to a clean, reusable state
    this.free = [];
    for (let i = 0; i < initialSize; i++) this.free.push(factory());
  }

  acquire() {
    return this.free.length ? this.free.pop() : this.factory();
  }

  release(obj) {
    this.reset(obj);
    this.free.push(obj);
  }

  get pooledCount() {
    return this.free.length;
  }
}

if (typeof module !== "undefined" && module.exports) module.exports = { ObjectPool };
if (typeof window !== "undefined") window.ObjectPool = ObjectPool;
