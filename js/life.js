// Sezione "Gioco": contatore vite + tracker partite e winrate dei comandanti.
(function () {
  const KEY = 'scanmtg.game.v1';      // partita in corso
  const HKEY = 'scanmtg.games.v1';    // storico partite
  const COLORS = ['#e2574c', '#5b8def', '#3fae6b', '#f0a830', '#9b59b6', '#16a3a3', '#e06ea0'];
  const root = () => document.getElementById('view-life');

  let game = load();
  let setupN = 4, setupLife = 40, setupPlayers = [];
  let turn = null;            // stato turni (in memoria, NON salvato): { active, dir, startTs, times:{}, count }
  const deltaState = {};      // anteprima vita: { id: variazione netta recente }
  const deltaTimers = {};
  let turnTick = null;        // intervallo che aggiorna il cronometro a schermo

  const fmtTime = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const turnElapsed = () => turn ? (Date.now() - turn.startTs) : 0;

  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
  function save() { localStorage.setItem(KEY, JSON.stringify(game)); }
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } }
  function saveHistory(h) { localStorage.setItem(HKEY, JSON.stringify(h)); }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function maxCmd(p) { const v = Object.values(p.cmd || {}); return v.length ? Math.max(...v) : 0; }
  function isDead(p) { return p.life <= 0 || p.poison >= 10 || maxCmd(p) >= 21; }
  function deadReason(p) { if (p.poison >= 10) return 'veleno'; if (maxCmd(p) >= 21) return 'danni commander'; if (p.life <= 0) return 'vite'; return ''; }

  // ---------- winrate ----------
  function winrates() {
    const h = loadHistory(), m = {};
    for (const g of h) {
      for (const p of g.players) { const c = (p.commander || '').trim(); if (!c) continue; (m[c] = m[c] || { played: 0, wins: 0 }).played++; }
      const w = (g.winnerCommander || '').trim(); if (w) { (m[w] = m[w] || { played: 0, wins: 0 }).wins++; }
    }
    return Object.entries(m).map(([c, v]) => ({ commander: c, played: v.played, wins: v.wins, rate: v.played ? v.wins / v.played : 0 }))
      .sort((a, b) => b.rate - a.rate || b.played - a.played);
  }

  // ---------- SETUP ----------
  function ensureSetupPlayers() {
    while (setupPlayers.length < setupN) setupPlayers.push({ name: 'Giocatore ' + (setupPlayers.length + 1), commander: '' });
    if (setupPlayers.length > setupN) setupPlayers.length = setupN;
  }

  function renderSetup() {
    ensureSetupPlayers();
    const segC = [2, 3, 4, 5, 6, 7].map(v => `<button class="seg-btn ${v === setupN ? 'on' : ''}" data-p="${v}">${v}</button>`).join('');
    const segL = [20, 30, 40].map(v => `<button class="seg-btn ${v === setupLife ? 'on' : ''}" data-l="${v}">${v}</button>`).join('');
    const rows = setupPlayers.map((p, i) => `
      <div class="lc-prow">
        <span class="lc-pdot" style="background:${COLORS[i % COLORS.length]}"></span>
        <input class="lc-pin" data-i="${i}" data-f="name" value="${esc(p.name)}" placeholder="Giocatore ${i + 1}" />
        <input class="lc-pin" data-i="${i}" data-f="commander" value="${esc(p.commander)}" placeholder="Comandante / mazzo" />
      </div>`).join('');

    root().innerHTML = `
      <div class="life-setup">
        <h2>🎮 Nuova partita</h2>
        <p class="muted">Quanti giocatori?</p>
        <div class="seg">${segC}</div>
        <p class="muted">Vite iniziali</p>
        <div class="seg">${segL}</div>
        <input id="lc-custom" type="number" inputmode="numeric" class="lc-custom" placeholder="…oppure personalizzate" />
        <p class="muted lc-lbl">Giocatori e comandanti</p>
        <div class="lc-prows">${rows}</div>
        <button id="lc-start" class="primary big">▶ Inizia partita</button>
        ${renderHistory()}
      </div>`;

    root().querySelectorAll('[data-p]').forEach(b => b.onclick = () => { setupN = +b.dataset.p; renderSetup(); });
    root().querySelectorAll('[data-l]').forEach(b => b.onclick = () => { setupLife = +b.dataset.l; const ci = document.getElementById('lc-custom'); if (ci) ci.value = ''; renderSetup(); });
    root().querySelectorAll('.lc-pin').forEach(inp => inp.oninput = () => { setupPlayers[+inp.dataset.i][inp.dataset.f] = inp.value; });
    document.getElementById('lc-start').onclick = () => { const c = parseInt(document.getElementById('lc-custom').value, 10); startGame(setupN, (c && c > 0) ? c : setupLife); };
    const ch = document.getElementById('lc-clearhist');
    if (ch) ch.onclick = () => { if (confirm('Cancellare tutto lo storico delle partite?')) { saveHistory([]); renderSetup(); } };
  }

  function renderHistory() {
    const h = loadHistory();
    if (!h.length) return '';
    const wr = winrates().map(w => `
      <div class="lc-wr">
        <span class="lc-wr-c"><b>${esc(w.commander)}</b><small>${w.played} partite</small></span>
        <span class="lc-wr-bar"><span style="width:${Math.round(w.rate * 100)}%"></span></span>
        <span class="lc-wr-v"><b>${Math.round(w.rate * 100)}%</b><small>${w.wins} vinte</small></span>
      </div>`).join('');
    const recent = h.slice(0, 6).map(g => `<div class="lc-gline">${g.date} — 🏆 ${esc(g.winnerCommander || g.winner || '—')}</div>`).join('');
    return `
      <div class="lc-hist">
        <h3 class="stat-h">📈 Winrate mazzi · ${h.length} partite</h3>
        ${wr || '<p class="muted">—</p>'}
        <h3 class="stat-h">Ultime partite</h3>
        ${recent}
        <button id="lc-clearhist" class="ghost danger lc-clear">Cancella storico</button>
      </div>`;
  }

  function startGame(n, life) {
    ensureSetupPlayers();
    const players = [];
    for (let i = 0; i < n; i++) {
      const sp = setupPlayers[i] || {};
      players.push({
        id: i, name: (sp.name || ('Giocatore ' + (i + 1))).slice(0, 24), commander: (sp.commander || '').slice(0, 40),
        color: COLORS[i % COLORS.length], life, poison: 0, energy: 0, experience: 0, cmd: {}, monarch: false
      });
    }
    game = { n, startLife: life, players };
    turn = null;
    Object.keys(deltaState).forEach(k => delete deltaState[k]);
    save();
    renderGame();
  }

  // ---------- GIOCO ----------
  function renderGame() {
    const alive = game.players.filter(p => !isDead(p));
    const won = game.players.length > 1 && alive.length === 1;
    let banner = '';
    if (won) {
      const w = alive[0];
      banner = `<div class="lc-winner">🏆 <b>${esc(w.name)}</b>${w.commander ? ' · ' + esc(w.commander) : ''}
        <button id="lc-save" class="primary lc-savebtn">💾 Salva</button></div>`;
      if (turn) {
        const tm = { ...turn.times }; tm[turn.active] = (tm[turn.active] || 0) + turnElapsed();
        banner += `<div class="lc-times">⏱ ${game.players.map(p => `${esc(p.name)} ${fmtTime(tm[p.id] || 0)}`).join(' · ')}</div>`;
      }
    }
    // Layout "a tavolo" col telefono in verticale:
    // 2 → sopra/sotto · pari>2 → sinistra/destra · dispari>2 → sinistra/destra + uno sotto.
    const ps = game.players;
    let table;
    if (game.n === 2) {
      table = `<div class="lc-area">${panelHtml(ps[0], 'r180')}</div>
               <div class="lc-area">${panelHtml(ps[1], '')}</div>`;
    } else {
      const odd = game.n % 2 === 1;
      const bottom = odd ? ps[ps.length - 1] : null;
      const side = odd ? (game.n - 1) / 2 : game.n / 2;
      const left = ps.slice(0, side), right = ps.slice(side, side * 2);
      table = `
        <div class="lc-mid">
          <div class="lc-col">${left.map(p => cellHtml(p, 's-left')).join('')}</div>
          <div class="lc-col">${right.map(p => cellHtml(p, 's-right')).join('')}</div>
        </div>
        ${bottom ? `<div class="lc-area lc-botarea">${panelHtml(bottom, '')}</div>` : ''}`;
    }

    const turnActive = turn && !won;
    root().innerHTML = `
      <div class="lc-game">
        <div class="lc-toolbar">
          <button id="lc-dice" class="secondary">🎲 Dadi</button>
          ${turnActive ? '<button id="lc-pass" class="primary">⏭️ Passa turno</button>'
                       : '<button id="lc-first" class="secondary">🎯 Primo</button>'}
          <button id="lc-reset" class="ghost danger">⟲ Nuova</button>
        </div>
        ${turnActive ? `<div class="lc-turnbar">Turno ${turn.count} · <b style="color:${game.players[turn.active].color}">${esc(game.players[turn.active].name)}</b> · <span id="lc-turntime">${fmtTime(turnElapsed())}</span></div>` : ''}
        ${banner}
        <div class="lc-table">${table}</div>
      </div>`;

    game.players.forEach(p => bindPanel(p.id));
    document.getElementById('lc-dice').onclick = rollDialog;
    const fb = document.getElementById('lc-first'); if (fb) fb.onclick = turnDialog;
    const pb = document.getElementById('lc-pass'); if (pb) pb.onclick = passTurn;
    document.getElementById('lc-reset').onclick = () => { if (confirm('Iniziare una nuova partita senza salvare? La partita attuale sarà persa.')) { turn = null; game = null; localStorage.removeItem(KEY); renderSetup(); } };
    const sb = document.getElementById('lc-save'); if (sb) sb.onclick = saveGame;

    // cronometro live del turno
    if (turnTick) { clearInterval(turnTick); turnTick = null; }
    if (turnActive) {
      turnTick = setInterval(() => {
        const el = document.getElementById('lc-turntime');
        if (el) el.textContent = fmtTime(turnElapsed());
        else { clearInterval(turnTick); turnTick = null; }
      }, 1000);
    }
  }

  function cellHtml(p, side) { return `<div class="lc-cell ${side}">${panelHtml(p, '')}</div>`; }

  function panelHtml(p, mode) {
    const dead = isDead(p), cmd = maxCmd(p), big5 = game.n <= 4;
    const r = mode === 'r180' ? ' r180' : '';
    const active = turn && turn.active === p.id ? ' lc-active' : '';
    const dv = deltaState[p.id];
    const deltaHtml = dv ? `<span class="lc-delta ${dv < 0 ? 'neg' : 'pos'}">${dv > 0 ? '+' : ''}${dv}</span>` : '';
    return `
      <div class="lc-pl${dead ? ' dead' : ''}${active}${r}" style="--c:${p.color}" data-id="${p.id}">
        <span class="lc-name" data-act="name">${p.monarch ? '👑 ' : ''}${esc(p.name)}</span>
        ${p.commander ? `<span class="lc-cmd">${esc(p.commander)}</span>` : ''}
        <div class="lc-lifewrap">
          ${big5 ? '<button class="lc-b big5" data-act="l-5">−5</button>' : ''}
          <button class="lc-b" data-act="l-1">−</button>
          <span class="lc-life">${p.life}</span>
          <button class="lc-b" data-act="l+1">+</button>
          ${big5 ? '<button class="lc-b big5" data-act="l+5">+5</button>' : ''}
        </div>
        ${deltaHtml}
        <div class="lc-chips">
          ${p.poison ? `<button class="lc-chip hot" data-act="more">☠ ${p.poison}</button>` : ''}
          ${cmd ? `<button class="lc-chip hot" data-act="more">⚔ ${cmd}</button>` : ''}
          <button class="lc-chip more" data-act="more">⋯</button>
        </div>
        ${dead ? `<div class="lc-deadtag" title="${deadReason(p)}">✖</div>` : ''}
      </div>`;
  }

  function bindPanel(id) {
    const el = root().querySelector(`.lc-pl[data-id="${id}"]`);
    if (!el) return;
    const p = game.players[id];
    el.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const a = b.dataset.act;
        if (a === 'l-1') chgLife(id, -1);
        else if (a === 'l+1') chgLife(id, 1);
        else if (a === 'l-5') chgLife(id, -5);
        else if (a === 'l+5') chgLife(id, 5);
        else if (a === 'name') { const n = prompt('Nome giocatore:', p.name); if (n) { p.name = n.slice(0, 24); save(); renderGame(); } }
        else if (a === 'more') openModal(id);
      };
    });
  }

  function chgLife(id, d) {
    game.players[id].life += d; save();
    // anteprima: accumula la variazione recente e la fa sparire dopo ~3s di inattività
    deltaState[id] = (deltaState[id] || 0) + d;
    clearTimeout(deltaTimers[id]);
    deltaTimers[id] = setTimeout(() => { delete deltaState[id]; renderGame(); }, 3000);
    renderGame();
  }

  function saveGame() {
    const alive = game.players.filter(p => !isDead(p));
    const w = alive.length === 1 ? alive[0] : null;
    const rec = {
      date: new Date().toLocaleDateString('it-IT'), life: game.startLife,
      players: game.players.map(p => ({ name: p.name, commander: p.commander })),
      winner: w ? w.name : '', winnerCommander: w ? w.commander : ''
    };
    const h = loadHistory(); h.unshift(rec); saveHistory(h);
    game = null; localStorage.removeItem(KEY);
    renderSetup();
    alert('Partita salvata! 🏆 ' + (rec.winnerCommander || rec.winner || ''));
  }

  // ---------- MODALE CONTATORI ----------
  function openModal(id) {
    let ov = document.getElementById('lc-modal');
    if (!ov) { ov = document.createElement('div'); ov.id = 'lc-modal'; ov.className = 'lc-overlay'; document.body.appendChild(ov); }
    renderModal(id, ov); ov.classList.add('show');
  }
  function closeModal() { const ov = document.getElementById('lc-modal'); if (ov) ov.classList.remove('show'); }

  function stepRow(label, val, key, id, max) {
    return `<div class="lc-row2${max && val >= max ? ' lc-warn' : ''}">
      <span class="lc-row-l">${label}</span>
      <button class="lc-b" data-k="${key}" data-id="${id}" data-d="-1">−</button>
      <span class="lc-row-v">${val}${max ? '/' + max : ''}</span>
      <button class="lc-b" data-k="${key}" data-id="${id}" data-d="1">+</button>
    </div>`;
  }

  function renderModal(id, ov) {
    const p = game.players[id];
    const cmdRows = game.players.filter(q => q.id !== id).map(q => {
      const v = p.cmd[q.id] || 0;
      return `<div class="lc-row2${v >= 21 ? ' lc-warn' : ''}">
        <span class="lc-row-l"><i class="dot" style="background:${q.color}"></i>${esc(q.name)}</span>
        <button class="lc-b" data-cmd="${q.id}" data-id="${id}" data-d="-1">−</button>
        <span class="lc-row-v">${v}/21</span>
        <button class="lc-b" data-cmd="${q.id}" data-id="${id}" data-d="1">+</button>
      </div>`;
    }).join('');

    ov.innerHTML = `
      <div class="lc-sheet" style="--c:${p.color}">
        <div class="lc-sheet-h"><b>${esc(p.name)}${p.commander ? ' · ' + esc(p.commander) : ''}</b><button class="lc-close" data-close>✕</button></div>
        <div class="lc-sec-t">Veleno · Energia · Esperienza</div>
        ${stepRow('☠ Veleno', p.poison, 'poison', id, 10)}
        ${stepRow('⚡ Energia', p.energy, 'energy', id, 0)}
        ${stepRow('✦ Esperienza', p.experience, 'experience', id, 0)}
        <div class="lc-sec-t">⚔ Danni da Commander (elim. a 21)</div>
        ${cmdRows || '<p class="muted">Nessun avversario.</p>'}
        <button class="lc-monarch ${p.monarch ? 'on' : ''}" data-monarch="${id}">👑 ${p.monarch ? 'È il monarca' : 'Rendi monarca'}</button>
        <button class="lc-concede" data-concede="${id}">🏳️ Concedi / elimina</button>
      </div>`;

    ov.onclick = (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) closeModal(); };
    // Aggiornamento IN LOCO del valore (niente ridisegno della finestra → lo scroll non salta).
    const MAXK = { poison: 10, energy: 0, experience: 0 };
    ov.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      p[k] = Math.max(0, (p[k] || 0) + (+b.dataset.d));
      save();
      const row = b.closest('.lc-row2'), max = MAXK[k] || 0;
      if (row) {
        row.querySelector('.lc-row-v').textContent = p[k] + (max ? '/' + max : '');
        row.classList.toggle('lc-warn', max ? p[k] >= max : false);
      }
      renderGame();
    });
    ov.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => {
      const o = b.dataset.cmd, before = p.cmd[o] || 0, after = Math.max(0, before + (+b.dataset.d));
      p.cmd[o] = after; p.life -= (after - before);
      save();
      const row = b.closest('.lc-row2');
      if (row) {
        row.querySelector('.lc-row-v').textContent = after + '/21';
        row.classList.toggle('lc-warn', after >= 21);
      }
      renderGame();
    });
    const mb = ov.querySelector('[data-monarch]');
    if (mb) mb.onclick = () => {
      const was = p.monarch;
      game.players.forEach(q => q.monarch = false);
      p.monarch = !was;
      save();
      mb.classList.toggle('on', p.monarch);
      mb.textContent = '👑 ' + (p.monarch ? 'È il monarca' : 'Rendi monarca');
      renderGame();
    };
    const cb = ov.querySelector('[data-concede]');
    if (cb) cb.onclick = () => { p.life = 0; save(); closeModal(); renderGame(); };
  }

  // ---------- STRUMENTI ----------
  function ensureOverlay() {
    let ov = document.getElementById('lc-modal');
    if (!ov) { ov = document.createElement('div'); ov.id = 'lc-modal'; ov.className = 'lc-overlay'; document.body.appendChild(ov); }
    return ov;
  }
  function rollDialog() {
    const ov = ensureOverlay();
    const draw = (txt) => {
      ov.innerHTML = `<div class="lc-sheet"><div class="lc-sheet-h"><b>🎲 Dadi & moneta</b><button class="lc-close" data-close>✕</button></div>
        <div class="lc-roll">${txt}</div>
        <div class="lc-roll-btns"><button class="secondary" data-roll="20">D20</button><button class="secondary" data-roll="6">D6</button><button class="secondary" data-roll="2">Moneta</button></div></div>`;
      ov.onclick = (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) closeModal(); };
      ov.querySelectorAll('[data-roll]').forEach(b => b.onclick = () => { const s = +b.dataset.roll; draw(s === 2 ? (Math.random() < 0.5 ? '🪙 Testa' : '🪙 Croce') : '🎲 ' + (1 + Math.floor(Math.random() * s))); });
    };
    draw('Tocca un pulsante'); ov.classList.add('show');
  }
  // "Primo": estrae il primo giocatore, poi scegli tu la direzione → parte il conteggio turni.
  function turnDialog() {
    const p = game.players[Math.floor(Math.random() * game.players.length)];
    const ov = ensureOverlay();
    ov.innerHTML = `<div class="lc-sheet"><div class="lc-sheet-h"><b>🎯 Primo di mano</b><button class="lc-close" data-close>✕</button></div>
      <div class="lc-roll" style="color:${p.color}">${esc(p.name)}</div>
      <div class="lc-sec-t">Direzione dei turni</div>
      <div class="lc-roll-btns"><button class="secondary" data-dir="1">↻ Orario</button><button class="secondary" data-dir="-1">↺ Antiorario</button></div></div>`;
    ov.onclick = (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) closeModal(); };
    ov.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => {
      turn = { active: p.id, dir: +b.dataset.dir, startTs: Date.now(), times: {}, count: 1 };
      closeModal(); renderGame();
    });
    ov.classList.add('show');
  }

  // Ordine dei posti in senso ORARIO attorno al tavolo (segue la disposizione a schermo).
  function seatOrder() {
    const n = game.n;
    if (n === 2) return [0, 1];
    const even = n % 2 === 0;
    const side = even ? n / 2 : (n - 1) / 2;
    const left = Array.from({ length: side }, (_, i) => i);        // colonna sinistra (dall'alto)
    const right = Array.from({ length: side }, (_, i) => side + i); // colonna destra (dall'alto)
    const tailLeft = left.slice(1).reverse();                       // sinistra dal basso verso l'alto (escl. il primo)
    // orario: alto-sx → alto-dx → giù a destra → (eventuale sotto) → su a sinistra
    return even ? [left[0], ...right, ...tailLeft]
                : [left[0], ...right, n - 1, ...tailLeft];
  }

  // Passa al prossimo giocatore vivo nella direzione scelta, accumulando il tempo del turno.
  function passTurn() {
    if (!turn) return;
    turn.times[turn.active] = (turn.times[turn.active] || 0) + turnElapsed();
    const order = seatOrder(), m = order.length, pos = order.indexOf(turn.active);
    for (let k = 1; k <= m; k++) {
      const cand = order[((pos + turn.dir * k) % m + m) % m];
      if (!isDead(game.players[cand])) { turn.active = cand; break; }
    }
    turn.startTs = Date.now(); turn.count++;
    renderGame();
  }

  function render() { if (game && game.players) renderGame(); else renderSetup(); }
  const tab = document.querySelector('[data-view="view-life"]');
  if (tab) tab.addEventListener('click', render);
  render();
})();
