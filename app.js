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

let decks = [];  // every deck: {id, title, cards, source, topic}
let topics = []; // {id, title, kind, exam, decks:[deck]}

async function loadDecks() {
  decks = []; topics = [];
  let list = [];
  try { list = await (await fetch('topics.json', { cache: 'no-store' })).json(); } catch {}
  for (const t of list) {
    const topic = { id: t.id, title: t.title, kind: t.kind || 'Personal', exam: t.exam || null, decks: [] };
    for (const file of t.decks || []) {
      try {
        const d = await (await fetch('decks/' + file, { cache: 'no-store' })).json();
        const deck = { id: file.replace(/\.json$/, ''), title: d.title, cards: d.cards, source: 'repo', topic };
        topic.decks.push(deck); decks.push(deck);
      } catch {}
    }
    topics.push(topic);
  }
  const byName = {};
  for (const d of store.get('localDecks', [])) {
    const name = d.topic || 'Imported';
    let topic = topics.find(t => t.title === name) || byName[name];
    if (!topic) { topic = byName[name] = { id: 'local-' + name.toLowerCase().replace(/\W+/g, '-'), title: name, kind: 'Personal', exam: null, decks: [] }; topics.push(topic); }
    const deck = { ...d, source: 'local', topic }; topic.decks.push(deck); decks.push(deck);
  }
}

// ---------- scheduling (see RESEARCH.md) ----------
// Successive relearning (Rawson & Dunlosky 2011): recall each card correctly 3 times in its first session,
// then 1 time in each later session. Never drop a card after one correct recall (Karpicke & Roediger 2008).
// Gap between sessions scales with time left before the exam (Cepeda et al. 2008): about 30% of the time left
// at a 1-week horizon, falling to about 7.5% at a 1-year horizon (midpoints of the reported 20-40% and 5-10%).
function srs(deck) { return store.get('srs:' + deck.id, {}); }
function saveSrs(deck, s) { store.set('srs:' + deck.id, s); }
function examStr(topic) { const v = store.get('exam:' + topic.id, undefined); return v === undefined ? topic.exam : v; }
function examDate(deck) { const v = deck.topic ? examStr(deck.topic) : null; return v ? new Date(v + 'T09:00:00').getTime() : null; }
function learnedCount(deck) { const s = srs(deck); return deck.cards.filter((_, i) => s[i] && s[i].sessions > 0).length; }
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
  const extra = String(answer).split('\n').filter(l => !/^([A-Za-z][A-Za-z /]{1,24}):\s*(.+)$/.test(l) && l.trim());
  return { multi: true, html: `<div class="back"><p class="small muted">Check off only the parts you actually had. It counts as right only if you had every part.</p>` +
    p.map((x, k) => `<label class="part"><input type="checkbox" data-part="${k}"> <span><b>${esc(x.label)}:</b> ${esc(x.value)}</span></label>`).join('') +
    extra.map(l => `<p class="small muted" style="margin-top:10px">${esc(l)}</p>`).join('') + '</div>' };
}
function crumb(t) { $('#crumb').textContent = t || ''; }
function sides(deck, i, flip) {
  const c = deck.cards[i];
  const pic = (c.image || c.wiki || c.commons) ? art(deck, i) : '';
  return flip ? { q: c.back, a: c.front, img: '', aImg: pic } : { q: c.front, a: c.back, img: pic, aImg: '' };
}

// ---------- artwork images ----------
// A card can carry "image": URL, or "wiki": [Wikipedia titles]. Wiki images load live from Wikipedia;
// if the first one is the wrong view, "Next image" cycles through that article's pictures and remembers the pick.
const mediaCache = {};
function art(deck, i) {
  const c = deck.cards[i];
  const q = encodeURIComponent((c.search || '') + ' artwork');
  return `<figure class="art" data-deck="${esc(deck.id)}" data-i="${i}"><img alt="Artwork to identify" referrerpolicy="no-referrer">
    <figcaption>${(c.wiki || c.commons) ? '<button class="link" data-next>Wrong image? Next</button> · ' : ''}<a href="https://www.google.com/search?tbm=isch&q=${q}" target="_blank" rel="noopener">Search images</a></figcaption></figure>`;
}
// Image sources, tried in order: Wikimedia Commons file search (best for a specific view), the Wikipedia
// article's images, then a Wikipedia search. All are public APIs that allow browser requests (origin=*).
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw 0; return r.json(); }
const big = s => s && !/\.svg/i.test(s) && !/icon|logo|map|flag|symbol|location/i.test(s);
async function fromCommons(q) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200&gsrsearch=' + encodeURIComponent(q);
  const j = await getJSON(u); const pages = Object.values((j.query || {}).pages || {}).sort((a, b) => a.index - b.index);
  return pages.map(p => p.imageinfo && p.imageinfo[0]).filter(i => i && /jpeg|png/.test(i.mime)).map(i => i.thumburl || i.url).filter(big);
}
async function fromArticle(t) {
  const j = await getJSON('https://en.wikipedia.org/api/rest_v1/page/media-list/' + encodeURIComponent(t));
  return (j.items || []).filter(it => it.type === 'image' && it.srcset && it.srcset.length)
    .map(it => { let s = it.srcset[it.srcset.length - 1].src; return s.startsWith('//') ? 'https:' + s : s; }).filter(big);
}
async function fromSearch(q) {
  const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3&prop=pageimages&piprop=original&gsrsearch=' + encodeURIComponent(q);
  const j = await getJSON(u); return Object.values((j.query || {}).pages || {}).sort((a, b) => a.index - b.index).map(p => p.original && p.original.source).filter(big);
}
async function mediaList(c) {
  const k = 'v2|' + (c.commons || '') + '|' + (c.wiki || []).join('|');
  if (mediaCache[k]) return mediaCache[k];
  const saved = store.get('media:' + k, null);
  if (saved && saved.length) return (mediaCache[k] = saved);
  let out = [];
  if (c.commons) { try { out.push(...await fromCommons(c.commons)); } catch {} }
  for (const t of c.wiki || []) { try { out.push(...await fromArticle(t)); } catch {} }
  if (!out.length && c.search) { try { out.push(...await fromSearch(c.search)); } catch {} }
  out = [...new Set(out)];
  if (out.length) store.set('media:' + k, out);
  return (mediaCache[k] = out);
}
async function hydrate(fig) {
  const deck = decks.find(d => d.id === fig.dataset.deck); if (!deck) return;
  const i = +fig.dataset.i, c = deck.cards[i], img = fig.querySelector('img');
  if (c.image && !(c.wiki || c.commons)) { img.src = c.image; return; }
  const list = c.image ? [c.image, ...(await mediaList(c)).filter(u => u !== c.image)] : await mediaList(c);
  if (!list.length) { img.remove(); fig.querySelector('[data-next]')?.remove(); fig.insertAdjacentHTML('afterbegin', '<p class="small muted">No picture found. Use Search images.</p>'); return; }
  const pick = store.get('pick:' + deck.id + ':' + i, 0) % list.length;
  img.src = list[pick];
  img.onerror = () => { const n = (pick + 1) % list.length; if (n !== pick && !img.dataset.tried) { img.dataset.tried = 1; store.set('pick:' + deck.id + ':' + i, n); img.src = list[n]; } };
  const nb = fig.querySelector('[data-next]');
  if (nb) nb.onclick = e => { e.preventDefault(); store.set('pick:' + deck.id + ':' + i, (pick + 1) % list.length); hydrate(fig); };
}
new MutationObserver(() => {
  document.querySelectorAll('figure.art:not([data-done])').forEach(f => { f.dataset.done = '1'; hydrate(f); });
}).observe(document.getElementById('app'), { childList: true, subtree: true });

// ---------- dashboard ----------
const daysTo = ms => Math.ceil((ms - Date.now()) / DAY);
function topicStats(t) {
  const total = t.decks.reduce((n, d) => n + d.cards.length, 0);
  const learned = t.decks.reduce((n, d) => n + learnedCount(d), 0);
  const due = t.decks.reduce((n, d) => n + dueCount(d), 0);
  const ex = examStr(t); const exMs = ex ? new Date(ex + 'T09:00:00').getTime() : null;
  return { total, learned, due, exMs };
}
function home() {
  crumb('');
  const stats = topics.map(t => ({ t, ...topicStats(t) }));
  const upcoming = stats.filter(x => x.exMs && x.exMs > Date.now()).sort((a, b) => a.exMs - b.exMs);
  const rows = stats.slice().sort((a, b) => (a.exMs && a.exMs > Date.now() ? a.exMs : 9e15) - (b.exMs && b.exMs > Date.now() ? b.exMs : 9e15));
  const dueAll = stats.reduce((n, x) => n + x.due, 0);
  const learnedAll = stats.reduce((n, x) => n + x.learned, 0), totalAll = stats.reduce((n, x) => n + x.total, 0);
  let last = null;
  for (const d of decks) for (const r of store.get('tests:' + d.id, [])) if (!last || r.at > last.at) last = { ...r, deck: d };
  const nx = upcoming[0];
  app.innerHTML = `
    <section class="hero"><p class="eyebrow">Learning headquarters</p><h1>What you're learning</h1></section>
    <div class="dash">
      <div class="col">
        ${rows.map((x, n) => `
          <div class="topic" data-n="${topics.indexOf(x.t)}" tabindex="0" role="button">
            <div class="topic-top"><span class="pill">${esc(x.t.kind)}</span>${x.exMs && x.exMs > Date.now() ? `<span class="mono muted">${daysTo(x.exMs)} days to exam</span>` : ''}</div>
            <h2>${esc(x.t.title)}</h2>
            <div class="bar" aria-label="${x.learned} of ${x.total} learned"><i style="width:${x.total ? (x.learned / x.total) * 100 : 0}%"></i></div>
            <div class="topic-foot mono"><span>${x.learned}/${x.total} learned</span><span>${x.due} due today</span></div>
          </div>`).join('') || '<div class="empty"><h2>Nothing here yet</h2><p class="muted">Tell Claude "I want to learn ___" and it builds the topic, or import a Quizlet set.</p></div>'}
        <div class="row"><button class="btn" id="imp">Import a set</button><button class="btn ghost" id="exp">Back up progress</button></div>
      </div>
      <aside class="glance">
        <p class="eyebrow">At a glance</p>
        <div class="stat-row"><span>Due today</span><b class="mono ${dueAll ? 'gold' : ''}">${dueAll}</b></div>
        <div class="stat-row"><span>Next exam</span><b class="mono">${nx ? `${daysTo(nx.exMs)}d` : '—'}</b></div>
        ${nx ? `<p class="small muted">${esc(nx.t.title)}</p>` : ''}
        <div class="stat-row"><span>This week</span><b class="mono">${(() => { const w = store.get('log', []).filter(x => x.at > Date.now() - 7 * DAY); return `${w.length} · ${w.reduce((n, x) => n + x.mins, 0)}m`; })()}</b></div>
        <div class="stat-row"><span>Cards learned</span><b class="mono">${learnedAll}/${totalAll}</b></div>
        <div class="stat-row"><span>Last test</span><b class="mono">${last ? `${last.actual}%` : '—'}</b></div>
        ${last ? `<p class="small muted">You predicted ${last.predicted}%. Gap ${last.actual - last.predicted > 0 ? '+' : ''}${last.actual - last.predicted}.</p>` : '<p class="small muted">Run a blank-page test to see how your guess compares to your score.</p>'}
        <a class="small muted" href="RESEARCH.md" target="_blank" rel="noopener">Why Recall works this way</a>
      </aside>
    </div>`;
  app.querySelectorAll('.topic').forEach(el => {
    const go = () => topicView(topics[+el.dataset.n]);
    el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
  $('#imp').onclick = importView;
  $('#exp').onclick = exportProgress;
}

function topicView(t) {
  crumb(t.title);
  const st = topicStats(t);
  app.innerHTML = `
    <p class="eyebrow"><button class="link" id="up">All topics</button> / ${esc(t.kind)}</p>
    <h1>${esc(t.title)}</h1>
    <p class="mono muted">${st.learned}/${st.total} learned · ${st.due} due today${st.exMs && st.exMs > Date.now() ? ` · exam in ${daysTo(st.exMs)} days` : ''}</p>
    <label class="opt">Exam or goal date <input type="date" id="exam" value="${examStr(t) || ''}"></label>
    <p class="small muted">${examStr(t) ? 'Every deck here is spaced to this date.' : 'No date: Recall spaces for retention a month out.'}</p>
    <div class="row">${(() => { const sv = savedSession('topic:' + t.id, false); return sv ? `<button class="btn primary" id="all">Resume session (${sv.queue.length} left)</button>` : `<button class="btn primary" id="all" ${st.due ? '' : 'disabled'}>Study everything due (${st.due})</button>`; })()}</div>
    <p class="small muted">Mixes cards from every deck in this topic. Mixed practice beat grouped practice for telling artists apart (Kornell & Bjork 2008).</p>
    <h2 class="section">Decks</h2>
    ${t.decks.map((d, n) => `
      <div class="deck" data-n="${n}" tabindex="0" role="button">
        <div><b>${esc(d.title)}</b><span class="meta mono">${d.cards.length} cards · ${learnedCount(d)} learned</span></div>
        <span class="due mono">${dueCount(d)} due</span>
      </div>`).join('')}`;
  $('#up').onclick = home;
  $('#exam').onchange = e => { store.set('exam:' + t.id, e.target.value || null); topicView(t); };
  $('#all').onclick = () => learn(t.decks.flatMap(d => d.cards.map((_, i) => ({ deck: d, i }))), false, false, t.title, () => topicView(t), 'topic:' + t.id);
  app.querySelectorAll('.deck').forEach(el => {
    const go = () => deckView(t.decks[+el.dataset.n]);
    el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}

// ---------- deck page ----------
function deckView(deck) {
  crumb(deck.title);
  const tests = store.get('tests:' + deck.id, []);
  const hist = tests.slice(-8).reverse().map(t =>
    `<tr><td>${new Date(t.at).toLocaleDateString()}</td><td>${t.predicted}%</td><td>${t.actual}%</td><td>${t.actual - t.predicted > 0 ? '+' : ''}${t.actual - t.predicted}</td></tr>`).join('');
  app.innerHTML = `
    <p class="eyebrow"><button class="link" id="up">${esc(deck.topic.title)}</button></p>
    <h1>${esc(deck.title)}</h1>
    <p class="muted stat">${deck.cards.length} cards · ${dueCount(deck)} due today</p>
    <label class="opt"><input type="checkbox" id="flip"> Answer with the term (show definition first)</label>
    <div class="row">
      <button class="btn primary" id="learn">${savedSession(deck.id, false) ? `Resume Learn (${savedSession(deck.id, false).queue.length} left)` : 'Learn (due cards)'}</button>
      <button class="btn" id="cram">${savedSession(deck.id, true) ? `Resume Cram (${savedSession(deck.id, true).queue.length} left)` : 'Cram all'}</button>
      <button class="btn" id="test">Blank-page test</button>
      <button class="btn" id="cards">Flip cards</button>
    </div>
    <p class="small muted"><b>Learn</b>: recall each card to criterion, then it comes back on a schedule set by your exam date. <b>Cram</b>: every card once, last day only. <b>Test</b>: predict, then prove it. <a href="RESEARCH.md" target="_blank" rel="noopener">Why it works this way</a></p>
    ${(() => { const L = store.get('log', []).filter(x => x.title === deck.title).slice(-6).reverse(); return L.length ? `<h2>Study sessions</h2><table><tr><th>Date</th><th>Cards</th><th>Misses</th><th>Min</th></tr>${L.map(x => `<tr><td>${new Date(x.at).toLocaleDateString()}</td><td>${x.cards}</td><td>${x.misses}</td><td>${x.mins}</td></tr>`).join('')}</table>` : ''; })()}
    ${hist ? `<h2>Test history</h2><table><tr><th>Date</th><th>Predicted</th><th>Actual</th><th>Gap</th></tr>${hist}</table>` : ''}
    ${deck.source === 'local' ? '<div class="row"><button class="btn" id="dl">Copy deck file (to add to the repo)</button><button class="btn" id="del">Delete deck</button></div>' : ''}`;
  const flip = () => $('#flip').checked;
  $('#up').onclick = () => topicView(deck.topic);
  $('#learn').onclick = () => learn(refsOf(deck), flip(), false, deck.title, () => deckView(deck), deck.id);
  $('#cram').onclick = () => learn(refsOf(deck), flip(), true, deck.title, () => deckView(deck), deck.id);
  $('#test').onclick = () => testView(deck, flip());
  $('#cards').onclick = () => flipCards(deck, flip());
  if (deck.source === 'local') {
    $('#dl').onclick = async () => {
      const txt = JSON.stringify({ title: deck.title, cards: deck.cards }, null, 2);
      try { await navigator.clipboard.writeText(txt); $('#dl').textContent = 'Copied'; } catch { prompt('Copy this', txt); }
    };
    $('#del').onclick = () => {
      store.set('localDecks', store.get('localDecks', []).filter(d => d.id !== deck.id));
      boot();
    };
  }
}

// ---------- learn / cram ----------
// Learn: due cards, each must reach its recall criterion (3 correct the first time, 1 after). Correct-but-not-done
// and missed cards come back later in the same session, after other cards (spaced, interleaved).
// Cram: every card once to criterion 1, schedule untouched. Use it only in the last day or two.
function refsOf(deck) { return deck.cards.map((_, i) => ({ deck, i })); }
function sessionKey(key, cram) { return 'session:' + (cram ? 'cram:' : 'learn:') + key; }
function savedSession(key, cram) { return store.get(sessionKey(key, cram), null); }
function logSession(entry) { const log = store.get('log', []); log.push(entry); store.set('log', log.slice(-500)); }
function learn(refs, flip, cram, title, back, key) {
  key = key || title;
  const sk = sessionKey(key, cram);
  const saved = store.get(sk, null);
  let items, need = new Map(), got = new Map(), queue, progress = 0, misses = 0, active = 0, started = Date.now();
  const byId = (d, i) => refs.find(r => r.deck.id === d && r.i === i);
  if (saved && saved.items) {
    // resume exactly where you left off
    items = saved.items.map(([d, i]) => byId(d, i)).filter(Boolean);
    items.forEach((r, n) => { need.set(r, saved.need[n]); got.set(r, saved.got[n]); });
    queue = saved.queue.map(n => items[n]).filter(Boolean);
    progress = saved.progress; misses = saved.misses; active = saved.active || 0; started = saved.started; flip = saved.flip;
  } else {
    const now = Date.now();
    items = refs.filter(r => { if (cram) return true; const c = srs(r.deck)[r.i]; return !c || !c.due || c.due <= now; });
    if (!items.length) { app.innerHTML = `<h1>Nothing due</h1><p class="muted">Every card is scheduled for later. Recall it then, not now: the gap is what makes it stick.</p><button class="btn" id="back">Back</button>`; $('#back').onclick = back; return; }
    items.forEach(r => { need.set(r, cram ? 1 : criterion(r.deck, r.i)); got.set(r, 0); });
    queue = shuffle(items);
  }
  const totalNeed = items.reduce((t, r) => t + need.get(r), 0);
  let lastAct = Date.now();
  const tick = () => { const n = Date.now(); active += Math.min(n - lastAct, 5 * 60000); lastAct = n; };
  const save = () => store.set(sk, {
    items: items.map(r => [r.deck.id, r.i]), need: items.map(r => need.get(r)), got: items.map(r => got.get(r)),
    queue: queue.map(r => items.indexOf(r)), progress, misses, active, started, flip, title, at: Date.now() });
  const later = (r, gap) => queue.splice(Math.min(gap, queue.length), 0, r);
  const next = () => {
    if (!queue.length) {
      try { localStorage.removeItem('recall:' + sk); } catch {}
      const mins = Math.max(1, Math.round(active / 60000));
      logSession({ at: Date.now(), title, cards: items.length, misses, mins, cram: !!cram });
      app.innerHTML = `<h1>Session done</h1><p class="stat mono">${items.length} cards to criterion · ${misses} misses · ${mins} min</p>
        <p class="small muted">${cram ? 'Cram does not change the schedule.' : 'Each card is now scheduled for its next relearning session.'} Saved to your history.</p>
        <button class="btn primary" id="back">Back</button>`;
      $('#back').onclick = back; return;
    }
    save();
    const r = queue[0]; const { deck, i } = r; const { q, a, img, aImg } = sides(deck, i, flip);
    crumb(`${title} · ${cram ? 'Cram' : 'Learn'} · ${got.get(r)}/${need.get(r)} correct`);
    app.innerHTML = `
      <div class="progress"><i style="width:${(progress / totalNeed) * 100}%"></i></div>
      <div class="card">${img}<div class="face">${esc(q)}</div>
        <textarea id="ans" placeholder="Answer from memory first. Type it or say it out loud."></textarea>
        <button class="btn primary" id="show">Reveal</button></div>
      <div class="row"><button class="btn ghost" id="pause">Save and exit</button><span class="small muted" style="align-self:center">Progress saves after every card.</span></div>`;
    $('#pause').onclick = () => { tick(); save(); back(); };
    const ans = $('#ans'); ans.focus();
    $('#show').onclick = () => {
      const typed = ans.value.trim(); const j = judgeHTML(a);
      app.querySelector('.card').innerHTML = `${img}<div class="face">${esc(q)}</div>
        ${typed ? `<div class="yours">You said: ${esc(typed)}</div>` : ''}${aImg}${j.html}
        <div class="row"><button class="btn again" id="no">Missed</button><button class="btn good" id="yes">Got it all</button></div>`;
      const yes = $('#yes');
      if (j.multi) {
        const boxes = [...app.querySelectorAll('[data-part]')];
        const sync = () => { yes.disabled = !boxes.every(b => b.checked); };
        boxes.forEach(b => b.onchange = sync); sync();
      }
      $('#no').onclick = () => { tick(); queue.shift(); misses++; if (!cram) markMissed(deck, i); later(r, 3); next(); };
      yes.onclick = () => {
        tick(); queue.shift();
        got.set(r, got.get(r) + 1); progress++;
        if (got.get(r) >= need.get(r)) { if (!cram) finishCard(deck, i); }
        else later(r, 5);
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
        $('#miss').onclick = () => { try { localStorage.removeItem('recall:' + sessionKey(deck.id, false)); } catch {} learn(refsOf(deck), flip, false, deck.title, () => deckView(deck), deck.id); };
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
    <input type="text" id="topic" placeholder="Topic (e.g. Countries, ACCT Exam 3)">
    <p></p>
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
    local.push({ id: 'local-' + Date.now(), title, cards, topic: $('#topic').value.trim() || 'Imported' });
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
