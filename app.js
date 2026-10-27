// Recall: a free, no-account flashcard app with spaced repetition and blank-page testing.
// Decks live in /decks as JSON (listed in decks/index.json) or get imported locally by pasting.
// Progress is saved in this browser's localStorage. Use Export progress to back it up.

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const DAY = 86400000;
// Scheduling follows the studies listed in RESEARCH.md. No made-up intervals.

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

// ---------- scheduling (see RESEARCH.md) ----------
// Successive relearning (Rawson & Dunlosky 2011): recall each card correctly 3 times in its first session,
// then 1 time in each later session. Never drop a card after one correct recall (Karpicke & Roediger 2008).
// Gap between sessions scales with time left before the exam (Cepeda et al. 2008): about 30% of the time left
// at a 1-week horizon, falling to about 7.5% at a 1-year horizon (midpoints of the reported 20-40% and 5-10%).
function srs(deck) { return store.get('srs:' + deck.id, {}); }
function saveSrs(deck, s) { store.set('srs:' + deck.id, s); }
function examDate(deck) { const v = store.get('exam:' + deck.id, null); return v ? new Date(v + 'T09:00:00').getTime() : null; }
function dueCount(deck) {
  const s = srs(deck), now = Date.now();
  return deck.cards.filter((_, i) => { const c = s[i]; return !c || !c.due || c.due <= now; }).length;
}
function gapRatio(daysLeft) {
  const d = Math.min(365, Math.max(7, daysLeft));
  const t = (Math.log(d) - Math.log(7)) / (Math.log(365) - Math.log(7)); // log-linear between the two reported points
  return 0.30 + t * (0.075 - 0.30);
}
function nextDue(deck) {
  const now = Date.now(), exam = examDate(deck);
  const horizon = exam && exam > now ? (exam - now) / DAY : 30; // no exam set: plan for retention a month out
  let gap = Math.max(1, Math.round(gapRatio(horizon) * horizon));
  let due = now + gap * DAY;
  if (exam && exam > now && due > exam - DAY) due = Math.max(now + DAY / 2, exam - DAY); // last relearning the day before
  return due;
}
function criterion(deck, i) { const c = srs(deck)[i]; return c && c.sessions > 0 ? 1 : 3; }
function finishCard(deck, i) {
  const s = srs(deck); const c = s[i] || { sessions: 0 };
  c.sessions = (c.sessions || 0) + 1; c.due = nextDue(deck); c.last = Date.now();
  s[i] = c; saveSrs(deck, s);
}
function markMissed(deck, i) { const s = srs(deck); const c = s[i] || { sessions: 0 }; c.due = Date.now(); s[i] = c; saveSrs(deck, s); }

// ---------- helpers ----------
const esc = t => String(t ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function parts(text) {
  const rows = String(text).split('\n').map(l => l.match(/^([A-Za-z][A-Za-z /]{1,24}):\s*(.+)$/)).filter(Boolean);
  return rows.length >= 2 ? rows.map(m => ({ label: m[1], value: m[2] })) : null;
}
function judgeHTML(answer) {
  const p = parts(answer);
  if (!p) return { html: `<div class="back">${esc(answer)}</div>`, multi: false };
  return { multi: true, html: `<div class="back"><p class="small muted">Check off only the parts you actually had. It counts as right only if you had every part.</p>` +
    p.map((x, k) => `<label class="part"><input type="checkbox" data-part="${k}"> <b>${esc(x.label)}:</b> ${esc(x.value)}</label>`).join('') + '</div>' };
}
function crumb(t) { $('#crumb').textContent = t || ''; }
function sides(deck, i, flip) {
  const c = deck.cards[i];
  const pic = (c.image || c.wiki) ? art(deck, i) : '';
  return flip ? { q: c.back, a: c.front, img: '', aImg: pic } : { q: c.front, a: c.back, img: pic, aImg: '' };
}

// ---------- artwork images ----------
// A card can carry "image": URL, or "wiki": [Wikipedia titles]. Wiki images load live from Wikipedia;
// if the first one is the wrong view, "Next image" cycles through that article's pictures and remembers the pick.
const mediaCache = {};
function art(deck, i) {
  const c = deck.cards[i];
  const q = encodeURIComponent((c.search || '') + ' artwork');
  return `<figure class="art" data-deck="${esc(deck.id)}" data-i="${i}"><img alt="Artwork to identify">
    <figcaption>${c.wiki ? '<button class="link" data-next>Wrong image? Next</button> · ' : ''}<a href="https://www.google.com/search?tbm=isch&q=${q}" target="_blank" rel="noopener">Search images</a></figcaption></figure>`;
}
async function mediaList(titles) {
  const k = titles.join('|');
  if (mediaCache[k]) return mediaCache[k];
  const saved = store.get('media:' + k, null);
  if (saved && saved.length) return (mediaCache[k] = saved);
  const out = [];
  for (const t of titles) {
    try {
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/media-list/' + encodeURIComponent(t));
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of j.items || []) {
        if (it.type !== 'image' || !it.srcset || !it.srcset.length) continue;
        let src = it.srcset[it.srcset.length - 1].src;
        if (/\.svg/i.test(src)) continue;
        if (src.startsWith('//')) src = 'https:' + src;
        out.push(src);
      }
    } catch {}
  }
  if (out.length) store.set('media:' + k, out);
  return (mediaCache[k] = out);
}
async function hydrate(fig) {
  const deck = decks.find(d => d.id === fig.dataset.deck); if (!deck) return;
  const i = +fig.dataset.i, c = deck.cards[i], img = fig.querySelector('img');
  if (c.image) { img.src = c.image; return; }
  const list = await mediaList(c.wiki);
  if (!list.length) { img.remove(); fig.querySelector('[data-next]')?.remove(); return; }
  const pick = store.get('pick:' + deck.id + ':' + i, 0) % list.length;
  img.src = list[pick];
  const nb = fig.querySelector('[data-next]');
  if (nb) nb.onclick = e => { e.preventDefault(); store.set('pick:' + deck.id + ':' + i, (pick + 1) % list.length); hydrate(fig); };
}
new MutationObserver(() => {
  document.querySelectorAll('figure.art:not([data-done])').forEach(f => { f.dataset.done = '1'; hydrate(f); });
}).observe(document.getElementById('app'), { childList: true, subtree: true });

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
    <label class="opt">Exam date <input type="date" id="exam" value="${store.get('exam:' + deck.id, '') || ''}" style="width:auto"></label>
    <p class="small muted">${examDate(deck) ? 'Sessions are spaced to your exam date.' : 'Set your exam date so sessions are spaced to it.'}</p>
    <label class="opt"><input type="checkbox" id="flip"> Answer with the term (show definition first)</label>
    <div class="row">
      <button class="btn primary" id="learn">Learn (due cards)</button>
      <button class="btn" id="cram">Cram all</button>
      <button class="btn" id="test">Blank-page test</button>
      <button class="btn" id="cards">Flip cards</button>
    </div>
    <p class="small muted"><b>Learn</b>: recall each card to criterion, then it comes back on a schedule set by your exam date. <b>Cram</b>: every card once, last day only. <b>Test</b>: predict, then prove it. <a href="RESEARCH.md" target="_blank" rel="noopener">Why it works this way</a></p>
    ${hist ? `<h2>Test history</h2><table><tr><th>Date</th><th>Predicted</th><th>Actual</th><th>Gap</th></tr>${hist}</table>` : ''}
    ${deck.source === 'local' ? '<div class="row"><button class="btn" id="dl">Copy deck file (to add to the repo)</button><button class="btn" id="del">Delete deck</button></div>' : ''}`;
  const flip = () => $('#flip').checked;
  $('#exam').onchange = e => { store.set('exam:' + deck.id, e.target.value || null); deckView(deck); };
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
// Learn: due cards, each must reach its recall criterion (3 correct the first time, 1 after). Correct-but-not-done
// and missed cards come back later in the same session, after other cards (spaced, interleaved).
// Cram: every card once to criterion 1, schedule untouched. Use it only in the last day or two.
function learn(deck, flip, cram) {
  const s = srs(deck), now = Date.now();
  let ids = deck.cards.map((_, i) => i).filter(i => cram || !s[i] || !s[i].due || s[i].due <= now);
  if (!ids.length) { app.innerHTML = `<h1>Nothing due</h1><p class="muted">Every card is scheduled for later. Recall it then, not now: the gap is what makes it stick.</p><button class="btn" id="back">Back</button>`; $('#back').onclick = () => deckView(deck); return; }
  const need = {}, got = {};
  ids.forEach(i => { need[i] = cram ? 1 : criterion(deck, i); got[i] = 0; });
  let queue = shuffle(ids);
  const totalNeed = ids.reduce((t, i) => t + need[i], 0); let progress = 0, misses = 0;
  const later = (i, gap) => queue.splice(Math.min(gap, queue.length), 0, i);
  const next = () => {
    if (!queue.length) {
      app.innerHTML = `<h1>Session done</h1><p class="stat">${ids.length} cards to criterion · ${misses} misses along the way</p>
        <p class="small muted">${cram ? 'Cram does not change the schedule.' : 'Each card is now scheduled for its next relearning session.'}</p>
        <button class="btn primary" id="back">Back to deck</button>`;
      $('#back').onclick = () => deckView(deck); return;
    }
    const i = queue.shift(); const { q, a, img, aImg } = sides(deck, i, flip);
    crumb(`${deck.title} · ${cram ? 'Cram' : 'Learn'} · ${got[i]}/${need[i]} correct`);
    app.innerHTML = `
      <div class="progress"><i style="width:${(progress / totalNeed) * 100}%"></i></div>
      <div class="card">${img}<div class="face">${esc(q)}</div>
        <textarea id="ans" placeholder="Answer from memory first. Type it or say it out loud."></textarea>
        <button class="btn primary" id="show">Reveal</button></div>`;
    const ans = $('#ans'); ans.focus();
    $('#show').onclick = () => {
      const typed = ans.value.trim(); const j = judgeHTML(a);
      app.querySelector('.card').innerHTML = `${img}<div class="face">${esc(q)}</div>
        ${typed ? `<div class="yours">You said: ${esc(typed)}</div>` : ''}${aImg}${j.html}
        <div class="row"><button class="btn again" id="no">Missed</button><button class="btn good" id="yes">Got it all</button></div>`;
      const yes = $('#yes');
      if (j.multi) {
        const boxes = [...app.querySelectorAll('[data-part]')];
        const sync = () => { yes.disabled = !boxes.every(b => b.checked); yes.style.opacity = yes.disabled ? .4 : 1; };
        boxes.forEach(b => b.onchange = sync); sync();
      }
      $('#no').onclick = () => { misses++; if (!cram) markMissed(deck, i); later(i, 3); next(); };
      yes.onclick = () => {
        got[i]++; progress++;
        if (got[i] >= need[i]) { if (!cram) finishCard(deck, i); }
        else later(i, 5);
        next();
      };
    };
  };
  next();
}

// ---------- blank-page test ----------
// Predict first, then answer every card cold. Students' predictions don't track how much they've learned
// (Karpicke & Roediger 2008; Kornell & Bjork 2008), so the gap is shown and kept.
function testView(deck, flip) {
  crumb(deck.title + ' · Test');
  app.innerHTML = `
    <h1>Blank-page test</h1>
    <p>Before you start: what percent of these ${deck.cards.length} cards will you get fully right? Your guess goes next to your real score.</p>
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
        wrong.forEach(i => markMissed(deck, i));
        app.innerHTML = `
          <h1>${actual}%</h1>
          <p class="stat">Predicted ${predicted}% · actual ${actual}% · gap ${actual - predicted > 0 ? '+' : ''}${actual - predicted}</p>
          <p>${actual < 80 ? 'Under 80%: not ready yet. The cards you missed are due now in Learn.' : 'Over 80%. Keep your relearning sessions until the exam.'}</p>
          <div class="row"><button class="btn primary" id="miss">Learn the ${wrong.length} missed</button><button class="btn" id="back">Back</button></div>`;
        $('#back').onclick = () => deckView(deck);
        $('#miss').onclick = () => learn(deck, flip, false);
        return;
      }
      const i = order[k]; const { q, a, img, aImg } = sides(deck, i, flip);
      app.innerHTML = `
        <div class="progress"><i style="width:${(k / order.length) * 100}%"></i></div>
        <div class="card">${img}<div class="face">${esc(q)}</div>
          <textarea id="ans" placeholder="Write the full answer from memory"></textarea>
          <button class="btn primary" id="show">Check</button></div>`;
      $('#ans').focus();
      $('#show').onclick = () => {
        const typed = $('#ans').value.trim(); const j = judgeHTML(a);
        app.querySelector('.card').innerHTML = `${img}<div class="face">${esc(q)}</div>
          <div class="yours">You wrote: ${esc(typed || '(nothing)')}</div>${aImg}${j.html}
          <div class="row"><button class="btn again" id="no">Wrong</button><button class="btn good" id="yes">Right</button></div>`;
        const yes = $('#yes');
        if (j.multi) { const boxes = [...app.querySelectorAll('[data-part]')]; const sync = () => { yes.disabled = !boxes.every(b => b.checked); yes.style.opacity = yes.disabled ? .4 : 1; }; boxes.forEach(b => b.onchange = sync); sync(); }
        yes.onclick = () => { right++; k++; step(); };
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
        ${img}
        <div class="face">${esc(q)}</div>
        ${shown ? `<div class="back">${aImg}${esc(a)}</div>` : ''}
      </div>
      <div class="row"><button class="btn" id="p">Prev</button><button class="btn primary" id="f">Flip <span class="kbd">space</span></button><button class="btn" id="n">Next</button><button class="btn" id="back">Done</button></div>
      <p class="small muted">Flipping is closer to rereading than to recall. In Roediger & Karpicke (2006), restudying won at 5 minutes and lost at 2 days and 1 week. Use Learn or Test before an exam.</p>`;
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
  // Quizlet exports can put line breaks inside a definition: a line with no tab continues the previous card.
  const rows = [];
  for (const l of raw.split(/\r?\n/)) {
    if (!l.trim()) continue;
    if (l.includes('\t') || !rows.length) rows.push(l); else rows[rows.length - 1] += '\n' + l.trim();
  }
  return rows.map(l => {
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
