// Recall: a free, no-account flashcard app with spaced repetition and blank-page testing.
// Decks live in /decks as JSON (listed in decks/index.json) or get imported locally by pasting.
// Progress is saved in this browser's localStorage. Use Export progress to back it up.

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // days per box

const store = {
  get(k, d) { try { const v = localStorage.getItem('recall:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('recall:' + k, JSON.stringify(v)); } catch {} },
};

let decks = []; // {id, title, cards:[{front,back,image}], source:'repo'|'local'}

async function loadDecks() {
  decks = [];
  try {
    const idx = await (await fetch('decks/index.json', { cache: 'no-store' })).json();
    for (const file of idx) {
      try {
        const d = await (await fetch('decks/' + file, { cache: 'no-store' })).json();
        decks.push({ id: file.replace(/\.json$/, ''), title: d.title, cards: d.cards, source: 'repo' });
      } catch {}
    }
  } catch {}
  for (const d of store.get('localDecks', [])) decks.push({ ...d, source: 'local' });
}

// ---------- spaced repetition state ----------
const key = (deck, i) => deck.id + '#' + i;
function srs(deck) { return store.get('srs:' + deck.id, {}); }
function saveSrs(deck, s) { store.set('srs:' + deck.id, s); }
function dueCount(deck) {
  const s = srs(deck), now = Date.now();
  return deck.cards.filter((_, i) => { const c = s[i]; return !c || c.due <= now; }).length;
}
function grade(deck, i, g) {
  const s = srs(deck); const c = s[i] || { box: 0, due: 0 };
  if (g === 'again') c.box = 0;
  else if (g === 'good') c.box = Math.min(c.box + 1, INTERVALS.length - 1);
  else c.box = Math.min(c.box + 2, INTERVALS.length - 1);
  c.due = g === 'again' ? Date.now() : Date.now() + INTERVALS[c.box] * DAY;
  s[i] = c; saveSrs(deck, s);
}

// ---------- helpers ----------
const esc = t => String(t ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function crumb(t) { $('#crumb').textContent = t || ''; }
function sides(deck, i, flip) {
  const c = deck.cards[i];
  return flip ? { q: c.back, a: c.front, img: null, aImg: c.image } : { q: c.front, a: c.back, img: c.image, aImg: null };
}

// ---------- home ----------
function home() {
  crumb('');
  const rows = decks.map((d, n) => `
    <div class="deck" data-n="${n}" tabindex="0" role="button">
      <div><b>${esc(d.title)}</b><span class="meta">${d.cards.length} cards · ${d.source === 'repo' ? 'repo' : 'imported here'}</span></div>
      <span class="due">${dueCount(d)} due</span>
    </div>`).join('');
  app.innerHTML = `
    <h1>Your decks</h1>
    <p class="muted small">Recall beats rereading. Every mode here makes you produce the answer before you see it.</p>
    ${rows || '<p class="muted">No decks yet. Import one below.</p>'}
    <div class="row">
      <button class="btn" id="imp">Import from Quizlet</button>
      <button class="btn" id="exp">Export progress</button>
    </div>`;
  app.querySelectorAll('.deck').forEach(el => {
    const go = () => deckView(decks[+el.dataset.n]);
    el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
  $('#imp').onclick = importView;
  $('#exp').onclick = exportProgress;
}

// ---------- deck page ----------
function deckView(deck) {
  crumb(deck.title);
  const tests = store.get('tests:' + deck.id, []);
  const hist = tests.slice(-8).reverse().map(t =>
    `<tr><td>${new Date(t.at).toLocaleDateString()}</td><td>${t.predicted}%</td><td>${t.actual}%</td><td>${t.actual - t.predicted > 0 ? '+' : ''}${t.actual - t.predicted}</td></tr>`).join('');
  app.innerHTML = `
    <h1>${esc(deck.title)}</h1>
    <p class="muted stat">${deck.cards.length} cards · ${dueCount(deck)} due today</p>
    <label class="opt"><input type="checkbox" id="flip"> Answer with the term (show definition first)</label>
    <div class="row">
      <button class="btn primary" id="learn">Learn (due cards)</button>
      <button class="btn" id="cram">Cram all</button>
      <button class="btn" id="test">Blank-page test</button>
      <button class="btn" id="cards">Flip cards</button>
    </div>
    <p class="small muted"><b>Learn</b>: spaced repetition, missed cards come back. <b>Cram</b>: every card, ignore the schedule. <b>Test</b>: predict your score, then prove it.</p>
    ${hist ? `<h2>Test history</h2><table><tr><th>Date</th><th>Predicted</th><th>Actual</th><th>Gap</th></tr>${hist}</table>` : ''}
    ${deck.source === 'local' ? '<div class="row"><button class="btn" id="dl">Copy deck file (to add to the repo)</button><button class="btn" id="del">Delete deck</button></div>' : ''}`;
  const flip = () => $('#flip').checked;
  $('#learn').onclick = () => learn(deck, flip(), false);
  $('#cram').onclick = () => learn(deck, flip(), true);
  $('#test').onclick = () => testView(deck, flip());
  $('#cards').onclick = () => flipCards(deck, flip());
  if (deck.source === 'local') {
    $('#dl').onclick = async () => {
      const txt = JSON.stringify({ title: deck.title, cards: deck.cards }, null, 2);
      try { await navigator.clipboard.writeText(txt); $('#dl').textContent = 'Copied'; } catch { prompt('Copy this', txt); }
    };
    $('#del').onclick = () => {
      if (!confirm('Delete this deck from this browser?')) return;
      store.set('localDecks', store.get('localDecks', []).filter(d => d.id !== deck.id));
      boot();
    };
  }
}

// ---------- learn / cram ----------
function learn(deck, flip, cram) {
  const s = srs(deck), now = Date.now();
  let queue = deck.cards.map((_, i) => i).filter(i => cram || !s[i] || s[i].due <= now);
  queue = shuffle(queue);
  if (!queue.length) { app.innerHTML = `<h1>Nothing due</h1><p class="muted">Every card is scheduled for later. Use Cram if an exam is close.</p><button class="btn" id="back">Back</button>`; $('#back').onclick = () => deckView(deck); return; }
  const total = queue.length; let done = 0, missed = new Set();
  const next = () => {
    if (!queue.length) {
      app.innerHTML = `<h1>Session done</h1><p class="stat">${total} cards · ${missed.size} needed a second try</p><button class="btn primary" id="back">Back to deck</button>`;
      $('#back').onclick = () => deckView(deck); return;
    }
    const i = queue.shift(); const { q, a, img, aImg } = sides(deck, i, flip);
    crumb(`${deck.title} · ${cram ? 'Cram' : 'Learn'}`);
    app.innerHTML = `
      <div class="progress"><i style="width:${(done / total) * 100}%"></i></div>
      <div class="card">
        ${img ? `<img src="${esc(img)}" alt="">` : ''}
        <div class="face">${esc(q)}</div>
        <textarea id="ans" placeholder="Type or say your answer first (optional), then reveal"></textarea>
        <button class="btn primary" id="show">Reveal <span class="kbd">space</span></button>
      </div>`;
    const ans = $('#ans'); ans.focus();
    const reveal = () => {
      const typed = ans.value.trim();
      app.querySelector('.card').innerHTML = `
        ${img ? `<img src="${esc(img)}" alt="">` : ''}
        <div class="face">${esc(q)}</div>
        ${typed ? `<div class="yours">You said: ${esc(typed)}</div>` : ''}
        <div class="back">${aImg ? `<img src="${esc(aImg)}" alt="">` : ''}${esc(a)}</div>
        <div class="row">
          <button class="btn again" data-g="again">Missed <span class="kbd">1</span></button>
          <button class="btn good" data-g="good">Got it <span class="kbd">2</span></button>
          <button class="btn easy" data-g="easy">Easy <span class="kbd">3</span></button>
        </div>`;
      const pick = g => {
        document.onkeydown = null;
        if (!cram) grade(deck, i, g);
        if (g === 'again') { missed.add(i); queue.splice(Math.min(3, queue.length), 0, i); } else done++;
        next();
      };
      app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => pick(b.dataset.g));
      document.onkeydown = e => { if (e.target.tagName === 'TEXTAREA') return; if (e.key === '1') pick('again'); if (e.key === '2') pick('good'); if (e.key === '3') pick('easy'); };
    };
    $('#show').onclick = reveal;
    document.onkeydown = e => { if (e.key === ' ' && document.activeElement !== ans) { e.preventDefault(); reveal(); } if (e.key === 'Enter' && e.metaKey) reveal(); };
  };
  next();
}

// ---------- blank-page test ----------
function testView(deck, flip) {
  crumb(deck.title + ' · Test');
  app.innerHTML = `
    <h1>Blank-page test</h1>
    <p>Before you start: what percent of these ${deck.cards.length} cards will you get fully right? Be honest. The gap between your guess and your score is the point.</p>
    <input type="number" id="pred" min="0" max="100" placeholder="Predicted %">
    <div class="row"><button class="btn primary" id="go">Start</button></div>`;
  $('#go').onclick = () => {
    const predicted = Math.max(0, Math.min(100, parseInt($('#pred').value, 10)));
    if (isNaN(predicted)) { $('#pred').focus(); return; }
    const order = shuffle(deck.cards.map((_, i) => i)); let k = 0, right = 0; const wrong = [];
    const step = () => {
      if (k >= order.length) {
        const actual = Math.round((right / order.length) * 100);
        const tests = store.get('tests:' + deck.id, []); tests.push({ at: Date.now(), predicted, actual }); store.set('tests:' + deck.id, tests);
        wrong.forEach(i => grade(deck, i, 'again'));
        app.innerHTML = `
          <h1>${actual}%</h1>
          <p class="stat">Predicted ${predicted}% · actual ${actual}% · gap ${actual - predicted > 0 ? '+' : ''}${actual - predicted}</p>
          <p>${actual < 80 ? 'Under 80%: not ready yet. Your missed cards are now due in Learn.' : 'Over 80%. Run it again tomorrow to make sure it sticks.'}</p>
          <div class="row"><button class="btn primary" id="miss">Learn the ${wrong.length} missed</button><button class="btn" id="back">Back</button></div>`;
        $('#back').onclick = () => deckView(deck);
        $('#miss').onclick = () => learn(deck, flip, false);
        return;
      }
      const i = order[k]; const { q, a, img, aImg } = sides(deck, i, flip);
      app.innerHTML = `
        <div class="progress"><i style="width:${(k / order.length) * 100}%"></i></div>
        <div class="card">
          ${img ? `<img src="${esc(img)}" alt="">` : ''}
          <div class="face">${esc(q)}</div>
          <textarea id="ans" placeholder="Write the full answer from memory"></textarea>
          <button class="btn primary" id="show">Check</button>
        </div>`;
      $('#ans').focus();
      $('#show').onclick = () => {
        const typed = $('#ans').value.trim();
        app.querySelector('.card').innerHTML = `
          ${img ? `<img src="${esc(img)}" alt="">` : ''}
          <div class="face">${esc(q)}</div>
          <div class="yours">You wrote: ${esc(typed || '(nothing)')}</div>
          <div class="back">${aImg ? `<img src="${esc(aImg)}" alt="">` : ''}${esc(a)}</div>
          <p class="small muted">Count it right only if you had all of it.</p>
          <div class="row"><button class="btn again" id="no">Wrong</button><button class="btn good" id="yes">Right</button></div>`;
        $('#yes').onclick = () => { right++; k++; step(); };
        $('#no').onclick = () => { wrong.push(i); k++; step(); };
      };
    };
    step();
  };
}

// ---------- flip cards ----------
function flipCards(deck, flip) {
  const order = deck.cards.map((_, i) => i); let k = 0, shown = false;
  const draw = () => {
    const { q, a, img, aImg } = sides(deck, order[k], flip);
    crumb(`${deck.title} · ${k + 1}/${order.length}`);
    app.innerHTML = `
      <div class="card" id="c" tabindex="0">
        ${img ? `<img src="${esc(img)}" alt="">` : ''}
        <div class="face">${esc(q)}</div>
        ${shown ? `<div class="back">${aImg ? `<img src="${esc(aImg)}" alt="">` : ''}${esc(a)}</div>` : ''}
      </div>
      <div class="row"><button class="btn" id="p">Prev</button><button class="btn primary" id="f">Flip <span class="kbd">space</span></button><button class="btn" id="n">Next</button><button class="btn" id="back">Done</button></div>
      <p class="small muted">Flip cards are recognition, the weakest mode. Use Learn or Test before an exam.</p>`;
    $('#f').onclick = () => { shown = !shown; draw(); };
    $('#n').onclick = () => { k = (k + 1) % order.length; shown = false; draw(); };
    $('#p').onclick = () => { k = (k - 1 + order.length) % order.length; shown = false; draw(); };
    $('#back').onclick = () => { document.onkeydown = null; deckView(deck); };
    document.onkeydown = e => { if (e.key === ' ') { e.preventDefault(); shown = !shown; draw(); } if (e.key === 'ArrowRight') $('#n').click(); if (e.key === 'ArrowLeft') $('#p').click(); };
  };
  draw();
}

// ---------- import ----------
function importView() {
  crumb('Import');
  app.innerHTML = `
    <h1>Import a deck</h1>
    <p class="small">In Quizlet: open the set, click <b>⋯</b> then <b>Export</b>, keep "Tab" between term and definition and "New line" between cards, then copy. Paste below.</p>
    <p class="small muted">Images: start a term with <code>img:URL |</code> to show a picture on the front, e.g. <code>img:https://.../olmec.jpg | Focus work 1</code>.</p>
    <input type="text" id="title" placeholder="Deck name">
    <p></p>
    <textarea id="raw" style="min-height:220px" placeholder="term&#9;definition"></textarea>
    <div class="row"><button class="btn primary" id="save">Save deck</button><button class="btn" id="back">Cancel</button></div>
    <p id="msg" class="small muted"></p>`;
  $('#back').onclick = home;
  $('#save').onclick = () => {
    const title = $('#title').value.trim() || 'Imported deck';
    const cards = parseImport($('#raw').value);
    if (!cards.length) { $('#msg').textContent = 'No cards found. Each line needs a term, a tab, then the definition.'; return; }
    const local = store.get('localDecks', []);
    local.push({ id: 'local-' + Date.now(), title, cards });
    store.set('localDecks', local);
    boot();
  };
}
function parseImport(raw) {
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    let [front, ...rest] = l.split('\t'); let back = rest.join('\t');
    if (!back && l.includes(' - ')) [front, back] = [l.slice(0, l.indexOf(' - ')), l.slice(l.indexOf(' - ') + 3)];
    let image;
    const m = front.match(/^img:(\S+)\s*\|\s*(.*)$/);
    if (m) { image = m[1]; front = m[2]; }
    return { front: front.trim(), back: (back || '').trim(), ...(image ? { image } : {}) };
  }).filter(c => c.front && c.back);
}

// ---------- export ----------
function exportProgress() {
  const out = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('recall:')) out[k] = localStorage.getItem(k); } } catch {}
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recall-progress.json'; a.click();
}

async function boot() { document.onkeydown = null; await loadDecks(); home(); }
$('#homeBtn').onclick = boot;
boot();
