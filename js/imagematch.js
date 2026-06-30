// Riconoscimento per immagine: carica il DB delle impronte (cards-hashes.json,
// impacchettato nell'app) e trova la carta più simile alle impronte della foto.
(function () {
  window.SM = window.SM || {};

  let HI = null, LO = null, NAMES = null, COUNT = 0, ready = false, loadingPromise = null;

  async function load() {
    if (ready) return true;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const base = new URL('.', location.href).href;
        const res = await fetch(base + 'cards-hashes.json');
        if (!res.ok) return false;
        const db = await res.json();
        COUNT = db.n; NAMES = db.names;
        HI = new Uint32Array(COUNT); LO = new Uint32Array(COUNT);
        const h = db.h;
        for (let i = 0; i < COUNT; i++) {
          const s = i * 16;
          HI[i] = parseInt(h.substr(s, 8), 16) >>> 0;
          LO[i] = parseInt(h.substr(s + 8, 8), 16) >>> 0;
        }
        ready = true;
        return true;
      } catch (e) { return false; }
    })();
    return loadingPromise;
  }

  function popcount32(x) {
    x = x | 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >>> 24;
  }

  // queries: array di {hi,lo} (la foto a più rotazioni). Ritorna top-K {name, dist}.
  function match(queries, k) {
    k = k || 5;
    if (!ready || !queries.length) return [];
    const KEEP = 16;
    const bd = new Array(KEEP).fill(999), bi = new Array(KEEP).fill(-1);
    let worst = 999;
    for (let i = 0; i < COUNT; i++) {
      const hi = HI[i], lo = LO[i];
      let md = 999;
      for (let q = 0; q < queries.length; q++) {
        const d = popcount32(hi ^ queries[q].hi) + popcount32(lo ^ queries[q].lo);
        if (d < md) md = d;
      }
      if (md < worst) {
        // inserisci in classifica (KEEP elementi)
        let p = KEEP - 1;
        if (md < bd[p]) {
          while (p > 0 && bd[p - 1] > md) { bd[p] = bd[p - 1]; bi[p] = bi[p - 1]; p--; }
          bd[p] = md; bi[p] = i;
          worst = bd[KEEP - 1];
        }
      }
    }
    const out = [], seen = new Set();
    for (let i = 0; i < KEEP; i++) {
      if (bi[i] < 0) continue;
      const n = NAMES[bi[i]];
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({ name: n, dist: bd[i] });
      if (out.length >= k) break;
    }
    return out;
  }

  SM.imagematch = { load, match, isReady: () => ready, count: () => COUNT };
})();
