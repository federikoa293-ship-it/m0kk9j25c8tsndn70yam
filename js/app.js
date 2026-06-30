// ScanMtg — logica UI.
(function () {
  const { scryfall, ocr, moxfield, store } = SM;

  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};

  let cards = store.load();
  let pending = null; // { name, printedName, editions:[], sel:0, qty:1, scannedLang }

  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  const eur = (n) => (typeof n === 'number') ? '€' + n.toFixed(2).replace('.', ',') : 'n/d';

  function setStatus(msg, isError = false) {
    const s = $('scan-status');
    if (!msg) { hide(s); return; }
    s.textContent = msg;
    s.classList.toggle('error', isError);
    show(s);
  }

  // ---- Navigazione tab ----
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;
      $(view).classList.add('active');
      if (view === 'view-list') renderList();
      if (view === 'view-stats') renderStats();
      // La fotocamera non parte da sola: si accende col pulsante. Uscendo si spegne.
      if (view !== 'view-scan') { $('auto-mode').checked = false; stopCamera(); setCamUI(false); resumePreview(); }
    });
  });

  // ================= SCANNER (anteprima dal vivo) =================
  let stream = null;       // MediaStream della fotocamera
  let scanning = false;    // un OCR è in corso
  let autoTimer = null;    // timer della modalità Auto
  let lastTriedTop = '';   // ultima riga OCR provata (anti-spam in Auto)
  let scanToken = 0;       // identità della scansione corrente (per annullarla a piacere)

  // Reset TOTALE dello stato di scansione: sblocca qualsiasi situazione.
  function resetScanState() {
    scanToken++;           // invalida eventuali scansioni ancora in corso
    scanning = false;
    pending = null;
    stopAuto();
    hide($('scan-result'));
    setStatus('');
    lastTriedTop = '';
  }

  // Avvia l'anteprima della fotocamera (camera posteriore).
  async function startCamera() {
    if (stream) return;
    resetScanState();      // parte sempre da uno stato pulito
    try {
      // Assicura il permesso fotocamera a livello di sistema.
      if (Plugins.Camera && Plugins.Camera.requestPermissions) {
        try { await Plugins.Camera.requestPermissions({ permissions: ['camera'] }); } catch (e) { /* ignora */ }
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      const v = $('cam');
      v.srcObject = stream;
      v.setAttribute('playsinline', '');
      await v.play();
      setCamUI(true);
      setStatus('');
    } catch (e) {
      stream = null;
      setStatus('Fotocamera non disponibile (' + (e.name || e.message || e) + '). Usa la ricerca manuale qui sotto.', true);
    }
  }

  function stopCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    const v = $('cam'); if (v) v.srcObject = null;
    resetScanState();      // spegnere = sbloccare tutto
  }

  // Aggiorna i controlli in base allo stato acceso/spento della fotocamera.
  function setCamUI(on) {
    const shot = $('btn-shot');
    if (on) { show($('cam-wrap')); hide($('cam-off')); shot.textContent = '📷 Scansiona'; show($('btn-stop')); }
    else { hide($('cam-wrap')); show($('cam-off')); shot.textContent = '📷 Avvia scanner'; hide($('btn-stop')); }
  }

  // Frazioni del riquadro guida (a forma di carta) — combaciano con .cam-guide nel CSS.
  const GUIDE = { x: 0.08, y: 0.05, w: 0.84, h: 0.90 };
  // Zone DENTRO la carta (frazioni del riquadro guida):
  const NAME_REGION = { x: 0.00, y: 0.00, w: 1.00, h: 0.30 }; // parte alta ampia (tollerante al centraggio)
  const TEXT_REGION = { x: 0.07, y: 0.575, w: 0.86, h: 0.30 }; // tipo + testo regole
  const ART_REGION = { x: 0.080, y: 0.110, w: 0.840, h: 0.430 }; // illustrazione (DEVE combaciare con build-hashdb.js)
  const NAME_REGION_RECT = { x: 0.040, y: 0.035, w: 0.800, h: 0.090 }; // barra del titolo (su carta RADDRIZZATA, precisa)

  // Rettangolo del riquadro guida in coordinate SORGENTE (gestisce object-fit:cover).
  function guideSourceRect() {
    const v = $('cam');
    if (!v || !v.videoWidth) return null;
    const Ws = v.videoWidth, Hs = v.videoHeight, Wd = v.clientWidth, Hd = v.clientHeight;
    const s = Math.max(Wd / Ws, Hd / Hs);
    const offX = (Ws - Wd / s) / 2, offY = (Hs - Hd / s) / 2;
    return { gx: offX + GUIDE.x * Wd / s, gy: offY + GUIDE.y * Hd / s, gw: GUIDE.w * Wd / s, gh: GUIDE.h * Hd / s };
  }

  // Rettangolo della CARTA usato per i ritagli: il rilevamento bordi se trova la carta,
  // altrimenti il riquadro guida. Impostato a ogni scansione.
  let scanRect = null;

  // Rilevamento automatico dei bordi: trova il rettangolo della carta nel fotogramma
  // (gestisce carte non centrate / più piccole del riquadro). Ritorna rect sorgente o null.
  function detectCardBox() {
    const v = $('cam');
    if (!v || !v.videoWidth) return null;
    const Ws = v.videoWidth, Hs = v.videoHeight;
    const dw = 220, dh = Math.round(dw * Hs / Ws);
    const cv = document.createElement('canvas'); cv.width = dw; cv.height = dh;
    const ctx = cv.getContext('2d');
    ctx.drawImage(v, 0, 0, dw, dh);
    const d = ctx.getImageData(0, 0, dw, dh).data;
    const gray = new Float32Array(dw * dh);
    for (let i = 0; i < dw * dh; i++) gray[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    const edge = new Float32Array(dw * dh);
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
      const i = y * dw + x;
      const gx = -gray[i - dw - 1] - 2 * gray[i - 1] - gray[i + dw - 1] + gray[i - dw + 1] + 2 * gray[i + 1] + gray[i + dw + 1];
      const gy = -gray[i - dw - 1] - 2 * gray[i - dw] - gray[i - dw + 1] + gray[i + dw - 1] + 2 * gray[i + dw] + gray[i + dw + 1];
      const m = Math.abs(gx) + Math.abs(gy);
      edge[i] = m; sum += m; sum2 += m * m; n++;
    }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const thr = mean + 0.7 * std;
    const colE = new Float32Array(dw), rowE = new Float32Array(dh);
    for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
      if (edge[y * dw + x] > thr) { colE[x]++; rowE[y]++; }
    }
    const span = (arr, len) => {
      let tot = 0; for (let i = 0; i < len; i++) tot += arr[i];
      if (tot <= 0) return null;
      const t = (tot / len) * 0.6;
      let a = -1, b = -1;
      for (let i = 0; i < len; i++) if (arr[i] > t) { if (a < 0) a = i; b = i; }
      return a < 0 ? null : [a, b];
    };
    const cs = span(colE, dw), rs = span(rowE, dh);
    if (!cs || !rs) return null;
    let [x1, x2] = cs, [y1, y2] = rs;
    const mx = (x2 - x1) * 0.03, my = (y2 - y1) * 0.03;
    x1 = Math.max(0, x1 - mx); x2 = Math.min(dw - 1, x2 + mx);
    y1 = Math.max(0, y1 - my); y2 = Math.min(dh - 1, y2 + my);
    const bw = x2 - x1, bh = y2 - y1;
    if (bw < dw * 0.25 || bh < dh * 0.25) return null;       // troppo piccolo
    const aspect = bw / bh;
    if (aspect < 0.45 || aspect > 1.05) return null;          // non sembra una carta (verticale ~0.72)
    const sx = Ws / dw, sy = Hs / dh;
    return { gx: x1 * sx, gy: y1 * sy, gw: bw * sx, gh: bh * sy };
  }

  // ---- OpenCV: raddrizzamento prospettico della carta ----
  let cvReady = false;
  let rectCanvas = null; // canvas della carta "raddrizzata" per la scansione corrente

  function initOpenCV() {
    if (window.cv && window.cv.Mat && typeof window.cv.matFromArray === 'function') { cvReady = true; return; }
    if (window.cv && typeof window.cv.then === 'function') { window.cv.then(m => { window.cv = m; cvReady = true; }); return; }
    setTimeout(initOpenCV, 250);
  }

  function orderCorners(p) {
    const sum = a => a.x + a.y, dif = a => a.x - a.y;
    const tl = p.reduce((m, a) => sum(a) < sum(m) ? a : m);
    const br = p.reduce((m, a) => sum(a) > sum(m) ? a : m);
    const tr = p.reduce((m, a) => dif(a) > dif(m) ? a : m);
    const bl = p.reduce((m, a) => dif(a) < dif(m) ? a : m);
    return { tl, tr, br, bl };
  }

  // Trova i 4 angoli della carta e la "stira" dritta (correzione prospettica). Ritorna un canvas o null.
  function rectifyCard() {
    if (!cvReady || !window.cv) return null;
    const v = $('cam'); if (!v || !v.videoWidth) return null;
    const cv = window.cv;
    const W = 720, H = Math.round(W * v.videoHeight / v.videoWidth);
    const work = document.createElement('canvas'); work.width = W; work.height = H;
    work.getContext('2d').drawImage(v, 0, 0, W, H);
    let src, gray, edges, contours, hier, best = null, outCanvas = null;
    try {
      src = cv.imread(work);
      gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      edges = new cv.Mat(); cv.Canny(gray, edges, 50, 150);
      const ker = cv.Mat.ones(3, 3, cv.CV_8U); cv.dilate(edges, edges, ker); ker.delete();
      contours = new cv.MatVector(); hier = new cv.Mat();
      cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let bestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area > W * H * 0.12) {
          const peri = cv.arcLength(cnt, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx) && area > bestArea) {
            if (best) best.delete();
            best = approx; bestArea = area;
          } else approx.delete();
        }
        cnt.delete();
      }
      if (best) {
        const pts = [];
        for (let i = 0; i < 4; i++) pts.push({ x: best.intPtr(i, 0)[0], y: best.intPtr(i, 0)[1] });
        const o = orderCorners(pts);
        const outW = 600, outH = Math.round(outW * 88 / 63);
        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [o.tl.x, o.tl.y, o.tr.x, o.tr.y, o.br.x, o.br.y, o.bl.x, o.bl.y]);
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const warped = new cv.Mat();
        cv.warpPerspective(src, warped, M, new cv.Size(outW, outH));
        outCanvas = document.createElement('canvas'); outCanvas.width = outW; outCanvas.height = outH;
        cv.imshow(outCanvas, warped);
        srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
      }
    } catch (e) { outCanvas = null; }
    if (src) src.delete(); if (gray) gray.delete(); if (edges) edges.delete();
    if (contours) contours.delete(); if (hier) hier.delete(); if (best) best.delete();
    return outCanvas;
  }

  // Ritaglia una zona della carta: dalla carta raddrizzata se disponibile, altrimenti
  // dal fotogramma (bordi rilevati o riquadro guida). Ritorna un canvas.
  function cropSource(region, outW) {
    let src, sx, sy, sw, sh;
    if (rectCanvas) {
      src = rectCanvas;
      sx = region.x * rectCanvas.width; sy = region.y * rectCanvas.height;
      sw = region.w * rectCanvas.width; sh = region.h * rectCanvas.height;
    } else {
      const g = scanRect || guideSourceRect();
      if (!g) return null;
      src = $('cam');
      sx = g.gx + region.x * g.gw; sy = g.gy + region.y * g.gh;
      sw = region.w * g.gw; sh = region.h * g.gh;
    }
    const k = (outW || 760) / sw;
    const cnv = document.createElement('canvas');
    cnv.width = Math.max(1, Math.round(sw * k)); cnv.height = Math.max(1, Math.round(sh * k));
    cnv.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, cnv.width, cnv.height);
    return cnv;
  }

  // Ritaglio del nome/testo come dataURL (grigio + contrasto per l'OCR).
  function captureRegion(region, outW) {
    const cnv = cropSource(region, outW);
    if (!cnv) return null;
    const ctx = cnv.getContext('2d');
    preprocess(ctx, cnv.width, cnv.height);
    return cnv.toDataURL('image/png');
  }

  // Scala di grigi + aumento del contrasto (aiuta l'OCR su foto con luce non perfetta).
  function preprocess(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const C = 1.45; // contrasto
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      g = (g - 128) * C + 128;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Impronte (pHash) dell'illustrazione a più piccole rotazioni: compensa la
  // foto leggermente storta. Ritorna un array di {hi,lo} per il riconoscimento immagine.
  function artHashes() {
    if (!SM.phash) return null;
    const base = cropSource(ART_REGION, 160);
    if (!base) return null;
    const rots = [-4, -2, 0, 2, 4], out = [];
    for (const deg of rots) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.translate(16, 16); ctx.rotate(deg * Math.PI / 180);
      ctx.drawImage(base, -16, -16, 32, 32); // schiaccia a 32x32 (come il builder)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      const gray = new Array(1024);
      // Stessa formula di grigio del builder del DB (jimp, Rec.709) per impronte coerenti.
      for (let i = 0; i < 1024; i++) gray[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      out.push(SM.phash.hexToWords(SM.phash.phashFromGray(gray)));
    }
    return out;
  }

  function flashEffect() {
    const f = $('cam-flash');
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 180);
  }

  async function resolveName(name) {
    const c = await scryfall.cardByName(name);
    if (c) return c;
    // offline: carta minima col solo nome (edizioni/prezzo si caricheranno con la rete)
    return { name, printedName: null, set: '', setName: '', collector: '', rarity: '', colors: [], colorIdentity: [], priceEur: null, image: null };
  }

  // Una scansione IBRIDA: riconoscimento per immagine (offline) + OCR del nome,
  // che si confermano a vicenda. `silent` (Auto) non mostra errori rumorosi.
  async function scanOnce(silent) {
    if (scanning || pending) return;
    if (!stream) { if (!silent) setStatus('Avvio fotocamera…'); await startCamera(); if (!stream) return; }
    const myToken = ++scanToken;          // identità di questa scansione
    scanning = true;
    if (!silent) flashEffect();
    const alive = () => myToken === scanToken && !!stream;  // falso se la fotocamera è stata spenta/riavviata
    try {
      // Raddrizzamento prospettico (OpenCV) se pronto; altrimenti rilevamento bordi / riquadro guida.
      rectCanvas = rectifyCard();
      scanRect = rectCanvas ? null : detectCardBox();
      const usedRectify = !!rectCanvas;

      // (A) Riconoscimento per immagine (locale, veloce, offline)
      let imgCands = [];
      if (SM.imagematch && SM.imagematch.isReady()) {
        const qh = artHashes();
        if (qh) imgCands = SM.imagematch.match(qh, 5);
      }
      const imgTop = imgCands[0] || null;

      // (B) OCR del nome — sulla carta raddrizzata uso la fascia precisa del titolo (più nitida).
      if (!silent) setStatus('🔎 Leggo la carta…');
      const nameReg = rectCanvas ? NAME_REGION_RECT : NAME_REGION;
      const nameImg = captureRegion(nameReg, rectCanvas ? 1000 : 760);
      let candidates = nameImg ? await ocr.ocrImage(nameImg) : [];
      if (!alive()) return;
      const ocrTop = candidates[0] || '';

      // anti-spam in Auto
      const key = (imgTop ? imgTop.name + '|' : '') + ocrTop;
      if (silent && key === lastTriedTop) return;
      lastTriedTop = key;

      if (!imgTop && !scanRect && ocrTop.replace(/[^a-zA-ZÀ-ÿ]/g, '').length < 4) {
        if (!silent) setStatus('Carta non leggibile: avvicina e illumina meglio.', true);
        return;
      }

      if (!silent) setStatus('🃏 Cerco…');
      let ocrCard = candidates.length ? await scryfall.identifyFromCandidates(candidates) : null;
      if (!alive()) return;

      // 2° tentativo: se col ritaglio (raddrizzato o rilevato) non aggancia, riprova col riquadro guida.
      if (!ocrCard && (rectCanvas || scanRect)) {
        rectCanvas = null; scanRect = null;
        const ni = captureRegion(NAME_REGION);
        const c2 = ni ? await ocr.ocrImage(ni) : [];
        if (!alive()) return;
        const oc2 = c2.length ? await scryfall.identifyFromCandidates(c2) : null;
        if (!alive()) return;
        if (oc2) { candidates = c2; ocrCard = oc2; }
      }

      const inImg = (n) => imgCands.find(c => c.name.toLowerCase() === (n || '').toLowerCase());

      // Decisione: OCR principale; l'immagine conferma o fa da ripiego se sicura.
      // Sulla carta raddrizzata (ritaglio preciso) mi fido un po' di più dell'immagine.
      const imgThr = usedRectify ? 12 : 9;
      const imgConfident = imgTop && imgTop.dist <= imgThr && (!imgCands[1] || (imgCands[1].dist - imgTop.dist) >= 3);
      let chosenCard = null, chosenName = null;
      if (ocrCard && imgTop && inImg(ocrCard.name)) chosenCard = ocrCard;        // immagine + OCR concordano (max fiducia)
      else if (ocrCard) chosenCard = ocrCard;                                     // OCR affidabile → primario
      else if (imgConfident) chosenName = imgTop.name;                            // OCR ha fallito, immagine molto sicura
      else {
        const textImg = captureRegion(TEXT_REGION);
        const { tokens } = textImg ? await ocr.ocrCard(textImg) : { tokens: [] };
        if (!alive()) return;
        chosenCard = await scryfall.identify(candidates, tokens);
        if (!alive()) return;
      }

      if (!chosenCard && chosenName) { chosenCard = await resolveName(chosenName); if (!alive()) return; }

      if (!chosenCard) {
        if (!silent && imgCands.length) {
          const guess = await resolveName(imgCands[0].name);
          if (!alive()) return;
          stopAuto(); flashEffect();
          await presentMatch(guess, candidates[0] || '', { altNames: imgCands.slice(1, 6).map(c => c.name), uncertain: true });
        } else if (!silent) {
          setStatus('Non riconosciuta. Avvicina, illumina meglio, o cerca a mano qui sotto.', true);
        }
        return;
      }

      stopAuto();
      flashEffect();
      setStatus('');
      await presentMatch(chosenCard, candidates[0] || chosenCard.name);
    } catch (e) {
      if (!silent) setStatus('Errore: ' + (e.message || e), true);
    } finally {
      if (myToken === scanToken) scanning = false; // libera solo se non superata da reset/nuova scansione
    }
  }

  // Primo tocco: accende la fotocamera (per inquadrare). Tocchi successivi: scansiona.
  $('btn-shot').addEventListener('click', async () => {
    if (!stream) await startCamera();
    else scanOnce(false);
  });

  $('btn-stop').addEventListener('click', () => {
    $('auto-mode').checked = false;
    stopCamera();
    setCamUI(false);
    resumePreview();
    setStatus('');
  });

  // ---- Modalità Auto (scansione continua) ----
  function startAuto() {
    if (autoTimer) return;
    const tick = async () => {
      if (!$('auto-mode').checked) { autoTimer = null; return; }
      if (!pending && !scanning && stream) await scanOnce(true);
      autoTimer = setTimeout(tick, 1300);
    };
    autoTimer = setTimeout(tick, 700);
  }
  function stopAuto() { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } }

  $('auto-mode').addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (!stream) await startCamera();
      if (stream) { setStatus('Auto attivo: inquadra le carte una dopo l\'altra.'); startAuto(); }
      else e.target.checked = false;
    } else { stopAuto(); setStatus(''); }
  });

  // Mostra la carta riconosciuta. Appare SUBITO con l'edizione riconosciuta;
  // l'elenco completo delle edizioni e le alternative si caricano in background.
  async function presentMatch(card, rawQuery, opts) {
    opts = opts || {};
    pending = { name: card.name, printedName: card.printedName, editions: [card], sel: 0, qty: 1 };

    $('result-name').textContent = card.name;
    const pr = $('result-printed');
    if (card.printedName) { pr.textContent = '🇮🇹 ' + card.printedName; show(pr); } else hide(pr);

    fillEditions([card], 0, true);
    $('result-qty').textContent = '1';
    hide($('cam-wrap'));               // nascondi l'anteprima mentre confermi
    hide($('alts'));
    show($('scan-result'));
    setStatus(opts.uncertain ? '🤔 Non sono sicuro: controlla nome ed edizione, o scegli un\'alternativa qui sotto.' : '');

    // Carica tutte le edizioni (con prezzi) in background.
    scryfall.printingsByName(card.name).then(editions => {
      if (!pending || pending.name !== card.name || !editions.length) return;
      let sel = editions.findIndex(e => e.set === card.set && e.collector === card.collector);
      if (sel < 0) sel = editions.findIndex(e => e.set === card.set);
      if (sel < 0) sel = 0;
      pending.editions = editions; pending.sel = sel;
      fillEditions(editions, sel, false);
    });

    const renderAlts = (names) => {
      const altBox = $('alts'), chips = $('alts-chips');
      chips.innerHTML = '';
      if (names && names.length) {
        names.forEach(name => {
          const b = document.createElement('button');
          b.className = 'chip'; b.textContent = name;
          b.onclick = () => switchToName(name);
          chips.appendChild(b);
        });
        show(altBox);
      } else hide(altBox);
    };
    // Se ho candidati espliciti (es. dall'immagine quando incerto) li mostro, altrimenti autocomplete.
    if (opts.altNames) renderAlts(opts.altNames);
    else scryfall.autocompleteNames(rawQuery || card.name, card.name).then(alts => { if (!pending || pending.name !== card.name) return; renderAlts(alts); });
  }

  function fillEditions(editions, sel, loading) {
    const sb = $('edition-select');
    sb.innerHTML = '';
    editions.forEach((e, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${e.set} · ${e.setName || ''} · #${e.collector} — ${eur(e.priceEur)}`;
      sb.appendChild(opt);
    });
    if (loading && editions.length === 1) {
      const opt = document.createElement('option');
      opt.disabled = true; opt.textContent = '… carico altre edizioni';
      sb.appendChild(opt);
    }
    sb.value = sel;
    applyEdition();
  }

  async function switchToName(name) {
    setStatus('🔄 Carico ' + name + '…');
    const card = await scryfall.cardByName(name);
    if (!card) { setStatus('Non trovata: ' + name, true); return; }
    await presentMatch(card, name);
  }

  // Aggiorna prezzo + miniatura in base all'edizione selezionata.
  function applyEdition() {
    if (!pending) return;
    const e = pending.editions[pending.sel];
    $('result-price').textContent = eur(e.priceEur);
    const th = $('result-thumb');
    if (e.image) { th.src = e.image; show(th); } else hide(th);
  }

  $('edition-select').addEventListener('change', (ev) => {
    if (!pending) return;
    pending.sel = parseInt(ev.target.value, 10) || 0;
    applyEdition();
  });

  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pending) return;
      pending.qty = Math.max(1, pending.qty + (btn.dataset.act === 'inc' ? 1 : -1));
      $('result-qty').textContent = pending.qty;
    });
  });

  $('btn-add').addEventListener('click', async () => {
    if (!pending) return;
    const e = pending.editions[pending.sel];
    const card = {
      name: pending.name, printedName: pending.printedName,
      set: e.set, setName: e.setName, collector: e.collector,
      rarity: e.rarity, colors: e.colors, colorIdentity: e.colorIdentity,
      priceEur: e.priceEur, image: e.image
    };
    cards = store.addCard(cards, card, pending.qty);
    const added = `${pending.qty}× ${pending.name}`;
    pending = null;
    lastTriedTop = '';
    updateBadge();
    resumePreview();
    setStatus(`✅ Aggiunta: ${added}` + ($('auto-mode').checked ? ' · inquadra la prossima…' : ''));
    if ($('auto-mode').checked) startAuto();
  });

  $('btn-discard').addEventListener('click', () => {
    pending = null;
    lastTriedTop = '';
    resumePreview();
    setStatus('');
    if ($('auto-mode').checked) startAuto();
  });

  // Torna all'anteprima dopo aver gestito una carta (se la fotocamera è accesa).
  function resumePreview() {
    hide($('scan-result'));
    if (stream) show($('cam-wrap')); else setCamUI(false);
  }

  // ---- Ricerca manuale ----
  $('btn-manual').addEventListener('click', manualSearch);
  $('manual-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') manualSearch(); });

  async function manualSearch() {
    const q = $('manual-input').value.trim();
    if (q.length < 3) return;
    setStatus('🔎 Ricerca…');
    let card = await scryfall.fuzzyEnglish(q);
    if (!card) card = await scryfall.searchMultilingual(q);
    if (!card) { setStatus('Nessuna carta trovata per "' + q + '".', true); return; }
    $('manual-input').value = '';
    await presentMatch(card, q);
  }

  // ================= LISTA =================
  function renderList() {
    const ul = $('card-list');
    ul.innerHTML = '';
    if (!cards.length) {
      ul.innerHTML = '<li class="empty">Nessuna carta. Scansiona la prima!</li>';
    }
    for (const c of cards) {
      const id = store.idOf(c);
      const sub = [c.set ? c.set + ' · #' + c.collector : '', eur(c.priceEur)].filter(Boolean).join(' · ');
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="vcard" title="Vedi carta">🔍</button>
        <span class="name">${escapeHtml(c.name)}<small>${escapeHtml(sub)}</small></span>
        <span class="q">
          <button data-act="dec">−</button><strong>${c.qty}</strong><button data-act="inc">+</button>
        </span>
        <button class="del" title="Rimuovi">🗑</button>`;
      li.querySelector('.vcard').onclick = () => openCardViewer(c);
      li.querySelector('[data-act="dec"]').onclick = () => { cards = store.setQty(cards, id, c.qty - 1); renderList(); updateBadge(); };
      li.querySelector('[data-act="inc"]').onclick = () => { cards = store.setQty(cards, id, c.qty + 1); renderList(); updateBadge(); };
      li.querySelector('.del').onclick = () => { cards = store.removeCard(cards, id); renderList(); updateBadge(); };
      ul.appendChild(li);
    }
    $('list-count').textContent = `${cards.length} diverse · ${store.totalCount(cards)} totali`;
  }

  // Mostra la carta per intero (quella edizione specifica) in un overlay.
  async function openCardViewer(c) {
    let ov = document.getElementById('card-viewer');
    if (!ov) { ov = document.createElement('div'); ov.id = 'card-viewer'; ov.className = 'lc-overlay'; document.body.appendChild(ov); }
    const cap = c.set ? `${c.name} · ${c.set} #${c.collector}` : c.name;
    ov.innerHTML = `<div class="cv-box"><img class="cv-img" alt="${escapeHtml(c.name)}" /><div class="cv-cap">⏳ ${escapeHtml(cap)}</div></div>`;
    ov.classList.add('show');
    ov.onclick = () => ov.classList.remove('show');
    let url = c.image;
    if (!url) {
      let card = (c.set && c.collector) ? await scryfall.cardBySetNumber(c.set, c.collector) : null;
      if (!card) card = await scryfall.cardByName(c.name);
      url = card && card.image;
    }
    const img = ov.querySelector('.cv-img'), capEl = ov.querySelector('.cv-cap');
    if (url) { img.src = url; capEl.textContent = cap; }
    else capEl.textContent = cap + ' — immagine non disponibile (serve internet)';
  }

  $('btn-clear').addEventListener('click', () => {
    if (!cards.length) return;
    if (confirm('Svuotare tutta la lista?')) {
      cards = []; store.save(cards); renderList(); updateBadge();
    }
  });

  // ================= EXPORT =================
  $('btn-copy').addEventListener('click', async () => {
    if (!cards.length) return;
    const text = moxfield.toMoxfield(cards);
    try {
      if (Plugins.Clipboard) await Plugins.Clipboard.write({ string: text });
      else await navigator.clipboard.writeText(text);
      flash($('btn-copy'), '✅ Copiata!');
    } catch { prompt('Copia la lista:', text); }
  });

  $('btn-share').addEventListener('click', async () => {
    if (!cards.length) return;
    const text = moxfield.toMoxfield(cards);
    try {
      if (Plugins.Share) await Plugins.Share.share({ title: 'Lista ScanMtg', text });
      else if (navigator.share) await navigator.share({ title: 'Lista ScanMtg', text });
      else prompt('Lista:', text);
    } catch { /* annullato */ }
  });

  $('btn-csv').addEventListener('click', async () => {
    if (!cards.length) return;
    const csv = moxfield.toCollectionCsv(cards);
    const fileName = 'scanmtg-collezione.csv';
    try {
      if (Plugins.Filesystem && Plugins.Share) {
        await Plugins.Filesystem.writeFile({ path: fileName, data: csv, directory: 'CACHE', encoding: 'utf8' });
        const { uri } = await Plugins.Filesystem.getUri({ path: fileName, directory: 'CACHE' });
        await Plugins.Share.share({ title: 'Collezione ScanMtg', text: 'Collezione Magic (CSV per Moxfield)', files: [uri] });
        flash($('btn-csv'), '✅ CSV creato!');
      } else {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    } catch (e) { alert('Errore export CSV: ' + (e.message || e)); }
  });

  // Copia la lista in formato Cardmarket e apre la sezione Wants del sito.
  $('btn-cardmarket').addEventListener('click', async () => {
    if (!cards.length) return;
    const text = moxfield.toCardmarketWants(cards);
    try {
      if (Plugins.Clipboard) await Plugins.Clipboard.write({ string: text });
      else await navigator.clipboard.writeText(text);
    } catch { /* ignora */ }
    alert('Lista copiata! ✅\n\nSu Cardmarket:\n1) crea una nuova Wants List (Magic)\n2) scegli "Aggiungi una decklist"\n3) incolla e conferma.');
    const url = 'https://www.cardmarket.com/it/Magic/Wants';
    try {
      if (Plugins.Browser) await Plugins.Browser.open({ url });
      else window.open(url, '_blank');
    } catch { window.open(url, '_blank'); }
  });

  // ================= STATISTICHE =================
  function renderStats() {
    const s = store.stats(cards);
    $('st-total').textContent = s.total;
    $('st-distinct').textContent = s.distinct;
    $('st-value').textContent = eur(s.value);
    $('st-value-lbl').textContent = s.unpriced
      ? `valore stimato (Cardmarket) · ${s.unpriced} senza prezzo`
      : 'valore stimato (Cardmarket)';
    renderBars('st-colors', s.byColor);
    renderBars('st-rarity', s.byRarity);
    renderBars('st-sets', s.bySet.slice(0, 8));
  }

  function renderBars(id, entries) {
    const box = $(id);
    box.innerHTML = '';
    if (!entries.length) { box.innerHTML = '<p class="muted">—</p>'; return; }
    const max = Math.max(...entries.map(e => e[1]));
    for (const [label, n] of entries) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `
        <span class="bar-lbl">${escapeHtml(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.round(n / max * 100)}%"></span></span>
        <span class="bar-val">${n}</span>`;
      box.appendChild(row);
    }
  }

  // ---- util ----
  function flash(btn, msg) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = old; }, 1500);
  }
  function updateBadge() {
    const badge = $('tab-badge');
    const n = store.totalCount(cards);
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // Toggle lingua italiana (persistente). Default OFF = solo inglese (più veloce).
  const itOn = localStorage.getItem('scanmtg.italian') === '1';
  $('it-mode').checked = itOn;
  ocr.setLanguages(itOn ? 'eng+ita' : 'eng');
  $('it-mode').addEventListener('change', (e) => {
    const on = e.target.checked;
    localStorage.setItem('scanmtg.italian', on ? '1' : '0');
    ocr.setLanguages(on ? 'eng+ita' : 'eng');
    setStatus(on ? '🇮🇹 Italiano attivo (lettura un po\' più lenta).' : '');
  });

  initOpenCV(); // avvia (in background) il raddrizzamento prospettico OpenCV

  // Carica il database delle impronte (riconoscimento per immagine), se presente.
  if (SM.imagematch) SM.imagematch.load().then(ok => {
    if (ok) console.log('Riconoscimento immagine pronto: ' + SM.imagematch.count() + ' carte.');
  });

  updateBadge();
  setCamUI(false); // fotocamera spenta all'avvio: si accende col pulsante

  // Service worker SOLO nella versione web (PWA), per l'uso offline.
  // Nell'app nativa Android non viene registrato (eviterebbe problemi di cache).
  const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if ('serviceWorker' in navigator && !isNative) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
