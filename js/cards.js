// Scheda "Carte": Collezione (inventario cumulativo) e Mazzi (Commander).
// Riusa SM.store (persistenza), SM.scryfall (ricerca per nome) e SM.moxfield (export).
(function () {
  const { store, scryfall, moxfield } = SM;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => (typeof n === 'number') ? '€' + n.toFixed(2).replace('.', ',') : 'n/d';
  const idOf = store.idOf;
  const Plugins = (window.Capacitor && window.Capacitor.Plugins) || {};

  // ---------- sotto-navigazione (Lista / Collezione / Mazzi) ----------
  document.querySelectorAll('.subtab').forEach(t => t.onclick = () => switchSub(t.dataset.sub));
  function switchSub(sub) {
    document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    document.querySelectorAll('.subview').forEach(v => v.classList.toggle('active', v.id === sub));
    if (sub === 'sub-coll') renderCollection();
    if (sub === 'sub-decks') renderDecks();
  }

  // ---------- overlay/utility condivisi ----------
  function overlay() {
    let ov = document.getElementById('cards-modal');
    if (!ov) { ov = document.createElement('div'); ov.id = 'cards-modal'; ov.className = 'lc-overlay'; document.body.appendChild(ov); }
    return ov;
  }
  function flashBtn(btn, msg) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = old; }, 1500); }
  async function copyText(text) {
    try { if (Plugins.Clipboard) await Plugins.Clipboard.write({ string: text }); else await navigator.clipboard.writeText(text); }
    catch { prompt('Copia:', text); }
  }
  // Mostra la carta intera in un overlay centrato (scarica l'immagine se manca).
  async function openViewer(c) {
    let ov = document.getElementById('cards-viewer');
    if (!ov) { ov = document.createElement('div'); ov.id = 'cards-viewer'; ov.className = 'lc-overlay'; document.body.appendChild(ov); }
    const cap = c.set ? `${c.name} · ${c.set}${c.collector ? ' #' + c.collector : ''}` : c.name;
    ov.innerHTML = `<div class="cv-box"><img class="cv-img" alt=""><div class="cv-cap">⏳ ${esc(cap)}</div></div>`;
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

  // ================= COLLEZIONE =================
  let collFilter = '';

  // Barre orizzontali per le statistiche (colore/rarità/set).
  function bars(entries) {
    if (!entries.length) return '<p class="muted">—</p>';
    const max = Math.max(...entries.map(e => e[1]));
    return entries.map(([label, n]) => `<div class="bar-row">
      <span class="bar-lbl">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round(n / max * 100)}%"></span></span>
      <span class="bar-val">${n}</span></div>`).join('');
  }

  function renderCollection() {
    const coll = store.loadCollection();
    const total = coll.reduce((n, c) => n + (c.qty || 0), 0);
    const value = coll.reduce((s, c) => s + (typeof c.priceEur === 'number' ? c.priceEur * (c.qty || 0) : 0), 0);
    const st = store.stats(coll);

    $('sub-coll').innerHTML = `
      <div class="list-header">
        <span class="muted">${coll.length} diverse · ${total} totali · ${eur(value)}</span>
        <button id="coll-clear" class="ghost danger">Svuota</button>
      </div>
      <div class="list-actions">
        <label class="secondary btn-file">📥 Importa CSV (Moxfield)<input id="coll-file" type="file" accept=".csv,text/csv" hidden></label>
      </div>
      <details class="stats-block">
        <summary>📊 Statistiche della collezione</summary>
        <div class="stat-cards">
          <div class="stat-box"><span class="stat-num">${st.total}</span><span class="stat-lbl">carte totali</span></div>
          <div class="stat-box"><span class="stat-num">${st.distinct}</span><span class="stat-lbl">carte diverse</span></div>
          <div class="stat-box wide"><span class="stat-num">${eur(st.value)}</span><span class="stat-lbl">${st.unpriced ? 'valore stimato · ' + st.unpriced + ' senza prezzo' : 'valore stimato (Cardmarket)'}</span></div>
        </div>
        <h3 class="stat-h">Per colore</h3><div class="bars">${bars(st.byColor)}</div>
        <h3 class="stat-h">Per rarità</h3><div class="bars">${bars(st.byRarity)}</div>
        <h3 class="stat-h">Per set (top 8)</h3><div class="bars">${bars(st.bySet.slice(0, 8))}</div>
      </details>
      <input id="coll-q" class="search-in" placeholder="🔍 Filtra per nome…" value="${esc(collFilter)}" autocomplete="off">
      <ul id="coll-ul" class="card-list"></ul>`;

    $('coll-clear').onclick = () => { if (store.loadCollection().length && confirm('Svuotare tutta la collezione?')) { store.saveCollection([]); renderCollection(); } };
    $('coll-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { const res = importCsv(String(rd.result)); renderCollection(); alert(res.err ? ('Errore import: ' + res.err) : ('✅ Importate ' + res.added + ' carte in collezione.')); };
      rd.readAsText(f);
    };
    // la ricerca aggiorna SOLO la lista → l'input non perde il focus mentre scrivi
    $('coll-q').oninput = (e) => { collFilter = e.target.value; drawCollList(); };

    drawCollList();
  }

  // Disegna/aggiorna solo l'elenco carte in base al filtro corrente.
  function drawCollList() {
    const coll = store.loadCollection();
    const q = collFilter.trim().toLowerCase();
    const shown = q ? coll.filter(c => c.name.toLowerCase().includes(q) || (c.printedName || '').toLowerCase().includes(q)) : coll;
    const ul = $('coll-ul'); if (!ul) return;
    ul.innerHTML = shown.map(collRow).join('') ||
      `<li class="empty">${coll.length ? 'Nessun risultato.' : 'Collezione vuota. Importa un CSV (Moxfield) o aggiungi dalla Lista.'}</li>`;
    ul.querySelectorAll('li[data-id]').forEach(li => {
      const id = li.dataset.id;
      // dopo una modifica di quantità ridisegno tutto (aggiorna anche header e statistiche)
      const mut = fn => { const c2 = store.loadCollection(); const c = c2.find(x => idOf(x) === id); if (!c) return; fn(c2, c); store.saveCollection(c2); renderCollection(); };
      li.querySelector('[data-inc]').onclick = () => mut((_, c) => c.qty++);
      li.querySelector('[data-dec]').onclick = () => mut((cc, c) => { c.qty--; if (c.qty <= 0) cc.splice(cc.indexOf(c), 1); });
      li.querySelector('[data-del]').onclick = () => mut((cc, c) => cc.splice(cc.indexOf(c), 1));
      li.querySelector('[data-view]').onclick = () => { const c = store.loadCollection().find(x => idOf(x) === id); if (c) openViewer(c); };
    });
  }

  function collRow(c) {
    const id = idOf(c);
    const sub = [c.set ? c.set + (c.collector ? ' · #' + c.collector : '') : '', typeof c.priceEur === 'number' ? eur(c.priceEur) : ''].filter(Boolean).join(' · ');
    return `<li data-id="${esc(id)}">
      <button class="vcard" data-view title="Vedi carta">🔍</button>
      <span class="name">${esc(c.name)}<small>${esc(sub)}</small></span>
      <span class="q"><button data-dec>−</button><strong>${c.qty}</strong><button data-inc>+</button></span>
      <button class="del" data-del title="Rimuovi">🗑</button></li>`;
  }

  // Parser CSV minimale (gestisce virgolette e virgole nei campi).
  function parseCsv(text) {
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Importa un CSV in stile "Collezione" di Moxfield (Count, Name, Edition, Collector Number…).
  function importCsv(text) {
    const rows = parseCsv(text).filter(r => r.some(c => c.trim() !== ''));
    if (rows.length < 2) return { added: 0, err: 'File vuoto o senza righe.' };
    const header = rows[0].map(h => h.trim().toLowerCase());
    const idx = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
    const ni = idx('name'), ci = idx('count', 'quantity', 'qty'), ei = idx('edition', 'set'), coli = idx('collector number', 'collector_number', 'collector');
    if (ni < 0) return { added: 0, err: 'Colonna "Name" non trovata.' };
    const coll = store.loadCollection();
    let added = 0;
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const name = (cells[ni] || '').trim(); if (!name) continue;
      const qty = Math.max(1, parseInt((ci >= 0 ? cells[ci] : '1') || '1', 10) || 1);
      const set = ei >= 0 ? (cells[ei] || '').trim().toUpperCase() : '';
      const collector = coli >= 0 ? (cells[coli] || '').trim() : '';
      store.mergeCard(coll, { name, set, setName: '', collector, colors: [], colorIdentity: [], priceEur: null, image: null, type: '' }, qty);
      added += qty;
    }
    store.saveCollection(coll);
    return { added };
  }

  // ================= MAZZI (Commander) =================
  let openDeckId = null;   // id del mazzo aperto nell'editor (null = elenco)
  let deckFilter = 'all';  // filtro per tipo nell'editor

  const loadDeck = id => store.loadDecks().find(d => d.id === id);
  function updateDeck(d) { const all = store.loadDecks(); const i = all.findIndex(x => x.id === d.id); if (i >= 0) all[i] = d; else all.push(d); store.saveDecks(all); }
  function commanderName(d) { const c = d.cards.find(x => idOf(x) === d.commander); return c ? c.name : ''; }

  const TYPE_ORDER = ['Creature', 'Planeswalker', 'Istantanei', 'Stregonerie', 'Artefatti', 'Incantesimi', 'Battaglie', 'Terre', 'Altro'];
  function typeGroup(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('land')) return 'Terre';
    if (t.includes('creature')) return 'Creature';
    if (t.includes('planeswalker')) return 'Planeswalker';
    if (t.includes('instant')) return 'Istantanei';
    if (t.includes('sorcery')) return 'Stregonerie';
    if (t.includes('artifact')) return 'Artefatti';
    if (t.includes('enchantment')) return 'Incantesimi';
    if (t.includes('battle')) return 'Battaglie';
    return 'Altro';
  }

  function renderDecks() {
    if (openDeckId != null) { const d = loadDeck(openDeckId); if (d) return renderDeckEditor(d); openDeckId = null; }
    const decks = store.loadDecks();
    const rows = decks.map(d => {
      const n = d.cards.reduce((s, c) => s + (c.qty || 0), 0);
      const cn = commanderName(d);
      return `<li data-deck="${esc(d.id)}">
        <span class="name">${esc(d.name)}<small>${n} carte${cn ? ' · 👑 ' + esc(cn) : ''}</small></span>
        <button class="del" data-del="${esc(d.id)}" title="Elimina">🗑</button></li>`;
    }).join('') || '<li class="empty">Nessun mazzo. Creane uno!</li>';

    $('sub-decks').innerHTML = `
      <div class="list-actions"><button id="deck-new" class="secondary">➕ Nuovo mazzo (Commander)</button></div>
      <ul class="card-list deck-list">${rows}</ul>`;

    $('deck-new').onclick = newDeck;
    $('sub-decks').querySelectorAll('li[data-deck]').forEach(li => {
      li.onclick = (e) => { if (e.target.closest('[data-del]')) return; openDeckId = li.dataset.deck; deckFilter = 'all'; renderDecks(); };
    });
    $('sub-decks').querySelectorAll('[data-del]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      if (confirm('Eliminare questo mazzo?')) { store.saveDecks(store.loadDecks().filter(d => d.id !== b.dataset.del)); renderDecks(); }
    });
  }

  function newDeck() {
    const name = prompt('Nome del mazzo:');
    if (!name || !name.trim()) return;
    const d = { id: 'd' + Date.now(), name: name.trim().slice(0, 40), commander: null, cards: [] };
    const all = store.loadDecks(); all.push(d); store.saveDecks(all);
    openDeckId = d.id; deckFilter = 'all'; renderDecks();
  }

  // Muta il mazzo in modo sicuro (ricarica → modifica → salva → ridisegna l'editor).
  function deckMutate(deckId, fn) { const d = loadDeck(deckId); if (!d) return; fn(d); updateDeck(d); renderDeckEditor(loadDeck(deckId)); }
  function changeQty(deckId, id, delta) { deckMutate(deckId, d => { const c = d.cards.find(x => idOf(x) === id); if (!c) return; c.qty = (c.qty || 1) + delta; if (c.qty <= 0) { d.cards = d.cards.filter(x => idOf(x) !== id); if (d.commander === id) d.commander = null; } }); }
  function delCard(deckId, id) { deckMutate(deckId, d => { d.cards = d.cards.filter(x => idOf(x) !== id); if (d.commander === id) d.commander = null; }); }
  function setCommander(deckId, id) { deckMutate(deckId, d => { d.commander = d.commander === id ? null : id; }); }

  // Aggiunge una carta al mazzo; se manca tipo/immagine (es. da CSV) prova ad arricchirla via Scryfall.
  async function addCardToDeck(deckId, card) {
    let c = card;
    if (!c.type || !c.image) {
      try {
        let full = (c.set && c.collector) ? await scryfall.cardBySetNumber(c.set, c.collector) : null;
        if (!full) full = await scryfall.cardByName(c.name);
        if (full) c = full;
      } catch { /* offline: si aggiunge com'è */ }
    }
    deckMutate(deckId, d => { store.mergeCard(d.cards, c, 1); });
  }

  function renderDeckEditor(d) {
    const collNames = new Set(store.loadCollection().map(c => (c.name || '').toLowerCase()));
    const owned = c => collNames.has((c.name || '').toLowerCase());
    const cmd = d.cards.find(c => idOf(c) === d.commander) || null;
    const nonCmd = d.cards.filter(c => idOf(c) !== d.commander);
    const total = d.cards.reduce((s, c) => s + (c.qty || 0), 0);

    const counts = {};
    for (const c of nonCmd) { const g = typeGroup(c.type); counts[g] = (counts[g] || 0) + (c.qty || 0); }
    const chips = ['all', ...TYPE_ORDER.filter(g => counts[g])].map(g =>
      `<button class="tchip ${deckFilter === g ? 'on' : ''}" data-filter="${g}">${g === 'all' ? 'Tutti ' + (total - (cmd ? (cmd.qty || 1) : 0)) : g + ' ' + counts[g]}</button>`).join('');

    let body;
    if (deckFilter === 'all') {
      body = TYPE_ORDER.filter(g => counts[g]).map(g => {
        const items = nonCmd.filter(c => typeGroup(c.type) === g);
        return `<div class="dk-group"><div class="dk-gh">${g} · ${counts[g]}</div>${items.map(c => deckRow(c, owned(c))).join('')}</div>`;
      }).join('') || '<p class="muted">Nessuna carta. Cercane una qui sopra o aggiungila dalla collezione.</p>';
    } else {
      const items = nonCmd.filter(c => typeGroup(c.type) === deckFilter);
      body = `<div class="dk-grid">${items.map(c => deckTile(c, owned(c))).join('')}</div>`;
    }

    const cmdSlot = cmd
      ? `${cmd.image ? `<img class="dk-cmd-img" src="${esc(cmd.image)}" alt="">` : ''}
         <div class="dk-cmd-info"><span class="muted">Comandante</span><b>${esc(cmd.name)}</b></div>
         <button class="ghost" id="dk-cmd-clear" title="Togli comandante">✕</button>`
      : `<span class="muted">👑 Nessun comandante — aggiungi una carta e tocca 👑 per designarla.</span>`;

    $('sub-decks').innerHTML = `
      <div class="dk-top">
        <button id="dk-back" class="ghost">‹ Mazzi</button>
        <b class="dk-title" id="dk-title" title="Rinomina">${esc(d.name)}</b>
        <span class="dk-count">${total}/100</span>
      </div>
      <div class="dk-cmd">${cmdSlot}</div>
      <div class="dk-add">
        <div class="manual-row">
          <input id="dk-search" placeholder="🔍 Cerca carta da aggiungere…">
          <button id="dk-search-btn" class="secondary">Aggiungi</button>
        </div>
        <div id="dk-sugg" class="chips"></div>
        <div class="dk-add-btns">
          <button id="dk-from-coll" class="ghost">📚 Dalla collezione</button>
          <button id="dk-import" class="ghost">📥 Importa (Moxfield)</button>
        </div>
      </div>
      <div class="tchips">${chips}</div>
      <div id="dk-body">${body}</div>
      <p class="muted export-title">Esporta il mazzo:</p>
      <div class="export-bar">
        <button id="dk-copy" class="primary">📋 Copia lista</button>
        <button id="dk-cm" class="secondary">🛒 Cardmarket</button>
      </div>`;

    bindDeckEditor(d);
  }

  function deckRow(c, isOwned) {
    const id = idOf(c);
    const sub = c.set ? c.set + (c.collector ? ' · #' + c.collector : '') : (c.type || '');
    return `<div class="dk-row" data-id="${esc(id)}">
      <span class="tick ${isOwned ? 'yes' : 'no'}" title="${isOwned ? 'In collezione' : 'Non in collezione'}">${isOwned ? '✓' : '○'}</span>
      <span class="name" data-view>${esc(c.name)}<small>${esc(sub)}</small></span>
      <button class="crown" data-cmd title="Rendi comandante">👑</button>
      <span class="q"><button data-dec>−</button><strong>${c.qty}</strong><button data-inc>+</button></span>
      <button class="del" data-del title="Rimuovi">🗑</button>
    </div>`;
  }

  function deckTile(c, isOwned) {
    const id = idOf(c);
    return `<div class="dk-tile" data-id="${esc(id)}" title="${esc(c.name)}">
      ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}">` : `<div class="dk-noimg">${esc(c.name)}</div>`}
      <span class="tick ${isOwned ? 'yes' : 'no'}">${isOwned ? '✓' : '○'}</span>
      ${c.qty > 1 ? `<span class="dk-qty">×${c.qty}</span>` : ''}
    </div>`;
  }

  function bindDeckEditor(d) {
    $('dk-back').onclick = () => { openDeckId = null; renderDecks(); };
    $('dk-title').onclick = () => { const n = prompt('Nome del mazzo:', d.name); if (n && n.trim()) deckMutate(d.id, dd => dd.name = n.trim().slice(0, 40)); };
    const cc = $('dk-cmd-clear'); if (cc) cc.onclick = () => deckMutate(d.id, dd => dd.commander = null);

    $('sub-decks').querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { deckFilter = b.dataset.filter; renderDeckEditor(loadDeck(d.id)); });

    $('sub-decks').querySelectorAll('.dk-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-inc]').onclick = () => changeQty(d.id, id, +1);
      row.querySelector('[data-dec]').onclick = () => changeQty(d.id, id, -1);
      row.querySelector('[data-del]').onclick = () => delCard(d.id, id);
      row.querySelector('[data-cmd]').onclick = () => setCommander(d.id, id);
      row.querySelector('[data-view]').onclick = () => { const c = loadDeck(d.id).cards.find(x => idOf(x) === id); if (c) openViewer(c); };
    });
    $('sub-decks').querySelectorAll('.dk-tile').forEach(t => {
      const id = t.dataset.id;
      t.onclick = () => { const c = loadDeck(d.id).cards.find(x => idOf(x) === id); if (c) openViewer(c); };
    });

    const inp = $('dk-search'), sugg = $('dk-sugg');
    let tmr = null;
    inp.oninput = () => {
      clearTimeout(tmr); const q = inp.value.trim(); if (q.length < 3) { sugg.innerHTML = ''; return; }
      tmr = setTimeout(async () => {
        const names = await scryfall.autocompleteNames(q);
        if ($('dk-search') !== inp) return; // editor ridisegnato nel frattempo
        sugg.innerHTML = (names || []).slice(0, 8).map(n => `<button class="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('');
        sugg.querySelectorAll('[data-name]').forEach(b => b.onclick = () => pickName(d.id, b.dataset.name));
      }, 250);
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearchAdd(d.id, inp.value.trim()); } };
    $('dk-search-btn').onclick = () => doSearchAdd(d.id, inp.value.trim());
    $('dk-from-coll').onclick = () => openCollPicker(d.id);
    $('dk-import').onclick = () => openDeckImport(d.id);

    $('dk-copy').onclick = async (e) => { await copyText(orderedList(loadDeck(d.id))); flashBtn(e.currentTarget, '✅ Copiata!'); };
    $('dk-cm').onclick = () => cardmarketDeck(loadDeck(d.id));
  }

  async function pickName(deckId, name) { const c = await scryfall.cardByName(name); if (c) addCardToDeck(deckId, c); }
  async function doSearchAdd(deckId, q) {
    if (q.length < 3) return;
    let c = await scryfall.fuzzyEnglish(q); if (!c) c = await scryfall.searchMultilingual(q);
    if (c) addCardToDeck(deckId, c); else alert('Nessuna carta trovata per "' + q + '".');
  }

  function openCollPicker(deckId) {
    const coll = store.loadCollection();
    const ov = overlay();
    ov.innerHTML = `<div class="lc-sheet">
      <div class="lc-sheet-h"><b>📚 Aggiungi dalla collezione</b><button class="lc-close" data-close>✕</button></div>
      <input id="cp-q" class="search-in" placeholder="🔍 Cerca nella collezione…" autocomplete="off">
      <div id="cp-list" class="dk-pick"></div></div>`;
    ov.classList.add('show');
    ov.onclick = (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) ov.classList.remove('show'); };
    const listEl = ov.querySelector('#cp-list'), qEl = ov.querySelector('#cp-q');
    // ridisegno solo la lista (non l'input) → il focus e il testo di ricerca restano
    function draw() {
      const q = qEl.value.trim().toLowerCase();
      const shown = q ? coll.filter(c => c.name.toLowerCase().includes(q) || (c.printedName || '').toLowerCase().includes(q)) : coll;
      listEl.innerHTML = shown.length
        ? shown.map(c => { const i = coll.indexOf(c);
            return `<div class="lc-row2">
              <button class="cp-view" data-view="${i}" title="Vedi carta">🔍</button>
              <span class="lc-row-l">${esc(c.name)}${c.set ? ' <small class="muted">' + esc(c.set) + '</small>' : ''}</span>
              <button class="lc-b" data-add="${i}" title="Aggiungi al mazzo">＋</button></div>`; }).join('')
        : `<p class="muted">${coll.length ? 'Nessun risultato.' : 'Collezione vuota.'}</p>`;
      listEl.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => { b.textContent = '…'; await addCardToDeck(deckId, coll[+b.dataset.add]); b.textContent = '✓'; });
      listEl.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openViewer(coll[+b.dataset.view]));
    }
    qEl.oninput = draw;
    draw();
  }

  // Importa un mazzo in formato Moxfield (una carta per riga) nel mazzo aperto.
  function openDeckImport(deckId) {
    const ov = overlay();
    ov.innerHTML = `<div class="lc-sheet"><div class="lc-sheet-h"><b>📥 Importa mazzo (Moxfield)</b><button class="lc-close" data-close>✕</button></div>
      <p class="muted">Incolla la lista, una carta per riga (es. <code>1 Sol Ring (C21) 263</code>). Il comandante lo designi dopo con 👑.</p>
      <textarea id="di-text" class="imp-text" rows="8" placeholder="1 Atraxa, Praetors' Voice&#10;1 Sol Ring&#10;8 Forest"></textarea>
      <button id="di-go" class="primary" style="margin-top:10px">Importa nel mazzo</button>
      <div id="di-status" class="muted" style="margin-top:8px"></div></div>`;
    ov.classList.add('show');
    ov.onclick = (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) ov.classList.remove('show'); };
    ov.querySelector('#di-go').onclick = () => runDeckImport(deckId, ov.querySelector('#di-text').value, ov.querySelector('#di-status'), ov.querySelector('#di-go'));
  }

  async function runDeckImport(deckId, text, statusEl, btn) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { statusEl.textContent = 'Incolla prima una lista.'; return; }
    const d = loadDeck(deckId); if (!d) return;
    btn.disabled = true;
    let added = 0, failed = 0, i = 0;
    for (const line of lines) {
      i++;
      const m = line.match(/^(\d+)\s*[xX]?\s+(.+?)\s*(?:\(([^)]+)\)\s*([^\s]+)?)?\s*$/);
      if (!m) { failed++; continue; }
      const qty = parseInt(m[1], 10) || 1, name = m[2].trim(), set = m[3], num = m[4];
      statusEl.textContent = `Importo ${i}/${lines.length}… (${added} ok)`;
      let card = null;
      if (set && num) card = await scryfall.cardBySetNumber(set, num);
      if (!card) card = await scryfall.cardByName(name);
      if (card) { store.mergeCard(d.cards, card, qty); added++; } else failed++;
      await new Promise(r => setTimeout(r, 90));
    }
    updateDeck(d);
    statusEl.textContent = `✅ Aggiunte ${added} carte${failed ? `, ${failed} non trovate/righe ignorate` : ''}.`;
    btn.disabled = false;
    renderDeckEditor(loadDeck(deckId)); // aggiorna l'editor dietro; l'overlay resta aperto
  }

  // Lista Moxfield del mazzo, comandante in cima.
  function orderedList(d) {
    const cmd = d.cards.filter(c => idOf(c) === d.commander);
    const rest = d.cards.filter(c => idOf(c) !== d.commander);
    return moxfield.toMoxfield([...cmd, ...rest]);
  }
  async function cardmarketDeck(d) {
    await copyText(moxfield.toCardmarketWants(d.cards));
    alert('Lista copiata! ✅\n\nSu Cardmarket:\n1) crea/apri una Wants List (Magic)\n2) imposta "Condizione minima" = Near Mint (NM)\n3) "Aggiungi una decklist" → incolla → conferma.');
    const url = 'https://www.cardmarket.com/it/Magic/Wants';
    try { if (Plugins.Browser) await Plugins.Browser.open({ url }); else window.open(url, '_blank'); }
    catch { window.open(url, '_blank'); }
  }

  // Hook per app.js: aggiorna le viste aperte quando cambia la collezione (dalla Lista).
  SM.cards = {
    onCollectionChanged: () => {
      if ($('sub-coll') && $('sub-coll').classList.contains('active')) renderCollection();
      if ($('sub-decks') && $('sub-decks').classList.contains('active')) renderDecks();
    }
  };
})();
