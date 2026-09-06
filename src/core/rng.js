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
    /** A deterministic shuffle, for choosing several items without bias. */
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
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
  const clean = String(code).trim();
  // New codes are six characters. Accept the seven-character codes older
  // builds could create, but never accept a partially valid string such as
  // "ABC123!" (parseInt would silently do that).
  if (!/^[0-9a-z]{1,7}$/i.test(clean)) return null;
  const n = Number.parseInt(clean, 36);
  return Number.isSafeInteger(n) && n <= 0xffffffff ? n >>> 0 : null;
}

export function randomSeed() {
  // 36^6 gives more than two billion exercises while keeping every newly
  // generated code at the promised six characters. Historical 32-bit seeds
  // still decode above for backwards compatibility.
  return Math.floor(Math.random() * (36 ** 6));
}
