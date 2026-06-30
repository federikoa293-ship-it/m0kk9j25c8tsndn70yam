// Perceptual hash (pHash) a 64 bit basato su DCT.
// Modulo "doppio": usabile sia nel browser (window.SM.phash) sia in Node (require).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.SM = window.SM || {}; window.SM.phash = api; }
})(this, function () {
  const N = 32; // l'immagine viene ridotta a 32x32

  // Tabella dei coseni per la DCT-II (precalcolata).
  const COS = (function () {
    const c = [];
    for (let k = 0; k < N; k++) {
      c[k] = new Float64Array(N);
      for (let n = 0; n < N; n++) c[k][n] = Math.cos(Math.PI * (2 * n + 1) * k / (2 * N));
    }
    return c;
  })();

  // gray: array length 1024 (32x32, valori 0..255). Ritorna hash esadecimale (16 char).
  function phashFromGray(gray) {
    // DCT sulle righe, tengo solo le prime 8 frequenze -> matrice 32x8
    const R = new Float64Array(32 * 8);
    for (let r = 0; r < 32; r++) {
      const base = r * 32;
      for (let k = 0; k < 8; k++) {
        let s = 0; const ck = COS[k];
        for (let n = 0; n < 32; n++) s += gray[base + n] * ck[n];
        R[r * 8 + k] = s;
      }
    }
    // DCT sulle colonne -> blocco 8x8
    const C = new Float64Array(64);
    for (let k = 0; k < 8; k++) {
      for (let j = 0; j < 8; j++) {
        let s = 0; const cj = COS[j];
        for (let r = 0; r < 32; r++) s += R[r * 8 + k] * cj[r];
        C[j * 8 + k] = s;
      }
    }
    // mediana escludendo il termine DC (C[0])
    const vals = [];
    for (let i = 1; i < 64; i++) vals.push(C[i]);
    vals.sort((a, b) => a - b);
    const med = (vals[30] + vals[31]) / 2;
    // 64 bit -> due interi a 32 bit -> hex
    let hi = 0, lo = 0;
    for (let i = 0; i < 64; i++) {
      const bit = C[i] > med ? 1 : 0;
      if (i < 32) hi = hi * 2 + bit; else lo = lo * 2 + bit;
    }
    return u32hex(hi) + u32hex(lo);
  }

  function u32hex(n) { return (n >>> 0).toString(16).padStart(8, '0'); }

  function popcount32(x) {
    x = x | 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >>> 24;
  }

  // Distanza di Hamming tra due hash esadecimali (0..64). Più basso = più simile.
  function hammingHex(a, b) {
    const ah = parseInt(a.slice(0, 8), 16) >>> 0, al = parseInt(a.slice(8), 16) >>> 0;
    const bh = parseInt(b.slice(0, 8), 16) >>> 0, bl = parseInt(b.slice(8), 16) >>> 0;
    return popcount32(ah ^ bh) + popcount32(al ^ bl);
  }

  // Converte hex in {hi,lo} per confronti veloci ripetuti.
  function hexToWords(h) { return { hi: parseInt(h.slice(0, 8), 16) >>> 0, lo: parseInt(h.slice(8), 16) >>> 0 }; }
  function hammingWords(a, b) { return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo); }

  return { phashFromGray, hammingHex, hexToWords, hammingWords, popcount32 };
});
