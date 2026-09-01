/** Deterministic PRNG so a seed always regenerates the same exercise. */
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** Weighted pick. `weights[i]` corresponds to `arr[i]`. */
    weighted(arr, weights) {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) return arr[Math.floor(next() * arr.length)];
      let x = next() * total;
      for (let i = 0; i < arr.length; i++) {
        x -= weights[i];
        if (x <= 0) return arr[i];
      }
      return arr[arr.length - 1];
    },
  };
}

/** Short human-typeable seed strings, so exercises can be shared or reassigned. */
export function seedToCode(seed) {
  return (seed >>> 0).toString(36).toUpperCase().padStart(6, '0');
}

export function codeToSeed(code) {
  const n = parseInt(String(code).trim(), 36);
  return Number.isFinite(n) ? n >>> 0 : null;
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
