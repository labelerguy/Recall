// Coach: the black dot in the top right. It watches how you study and jingles when you drift from what the
// research in RESEARCH.md supports. It adds no new study rules: every tip points back to a study already in
// RESEARCH.md, and a tip without one doesn't ship (see CLAUDE.md).
//
// app.js calls coachSee(ctx) on every screen, and Coach.push(tip) for in-session nudges.
// ctx = { view: 'home'|'topic'|'deck'|'learn'|'nothing'|'done'|'flip'|'testdone', topic, deck, cram, ... }

(() => {
  const SRC = {
    mix: 'Kornell & Bjork 2008, Psychological Science',
    test: 'Roediger & Karpicke 2006, Psychological Science',
    keep: 'Karpicke & Roediger 2008, Science',
    space: 'Cepeda et al. 2008, Psychological Science',
    judge: 'Karpicke & Roediger 2008; Dunlosky & Rawson 2012',
    guess: 'Richland, Kornell & Kao 2009, JEP: Applied',
    elab: 'Pressley et al. 1988; Rogers, Kuiper & Kirker 1977',
  };
  const HOUR = 3600000;
  const fmtDay = ms => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  // whole days from today to the exam date (0 = today, negative = past), using local calendar days
  const examDays = t => { const ex = examStr(t); return ex ? Math.round((new Date(ex + 'T00:00:00').getTime() - today0()) / DAY) : null; };
  const evs = () => store.get('coach:ev', []);
  const topicDue = t => t.decks.reduce((n, d) => n + dueCount(d), 0);
  const topicLearned = t => t.decks.reduce((n, d) => n + learnedCount(d), 0);
  const topicTotal = t => t.decks.reduce((n, d) => n + d.cards.length, 0);
  const allRefs = t => t.decks.flatMap(d => refsOf(d));
  const studyDue = t => () => learn(allRefs(t), false, false, t.title, () => topicView(t), 'topic:' + t.id);
  const short = s => String(s).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+and which works.*$/i, '').trim();

  // ---------- rules: each returns tips for one topic in the current context ----------
  const rules = [
    // Blocked practice: the last sessions in this topic were one deck at a time while other decks wait.
    (ctx, t) => {
      if (t.decks.length < 2 || !['home', 'topic', 'deck', 'done'].includes(ctx.view)) return [];
      const s = evs().filter(e => e.type === 'study' && e.topic === t.id && !e.cram && e.at > Date.now() - 10 * DAY);
      const last = s[s.length - 1], prev = s[s.length - 2];
      if (!last || last.mixed) return [];
      if (!(ctx.view === 'deck' || (prev && !prev.mixed))) return [];
      const focus = t.decks.find(d => d.id === last.deck);
      const others = t.decks.filter(d => d.id !== last.deck && dueCount(d) > 0);
      if (!focus || !others.length) return [];
      const waiting = others.reduce((n, d) => n + dueCount(d), 0);
      return [{
        key: `mix:${t.id}:${last.at}`, prio: 80,
        title: `You keep drilling ${short(focus.title)} on its own`,
        body: `${others.map(d => short(d.title)).join(', ')} ${others.length === 1 ? 'has' : 'have'} ${plural(waiting, 'card')} waiting. Your exam won't hand you one deck at a time, so don't study that way. Mixing decks beat grouping them: .61 vs .35 on new examples.`,
        src: SRC.mix, action: { label: `Mix all ${t.decks.length} decks`, run: studyDue(t) },
      }];
    },
    // Lopsided coverage: one deck well under way, another never started, exam coming.
    (ctx, t) => {
      const d = examDays(t);
      if (t.decks.length < 2 || d === null || d < 1 || d > 21 || !['home', 'topic', 'deck'].includes(ctx.view)) return [];
      const lead = t.decks.map(x => ({ x, l: learnedCount(x) })).sort((a, b) => b.l / b.x.cards.length - a.l / a.x.cards.length)[0];
      const cold = t.decks.filter(x => x.cards.length >= 4 && learnedCount(x) === 0);
      if (!lead || lead.l < 5 || !cold.length) return [];
      return [{
        key: `cover:${t.id}:${cold.map(x => x.id).join(',')}`, prio: 75,
        title: `${short(cold[0].title)} hasn't been touched`,
        body: `${short(lead.x.title)}: ${lead.l}/${lead.x.cards.length} learned. ${cold.map(x => `${short(x.title)}: 0/${x.cards.length}`).join('. ')}. Exam in ${plural(d, 'day')}. Bring the cold deck into the mix now so it gets more than one session before the test.`,
        src: `${SRC.mix}; ${SRC.space}`, action: { label: 'Study everything due', run: studyDue(t) },
      }];
    },
    // Exam today, tomorrow, or just past.
    (ctx, t) => {
      const d = examDays(t);
      if (d === null || !['home', 'topic', 'deck'].includes(ctx.view)) return [];
      if (d === 0) return [{
        key: `examday:${t.id}:${examStr(t)}`, prio: 95,
        title: `${t.title} is today`,
        body: `Not the day for new material. One Cram pass runs every card once and leaves your schedule alone. Testing yourself beats rereading even this late, so answer before you look.`,
        src: SRC.test, action: { label: 'Cram the whole topic', run: () => learn(allRefs(t), false, true, t.title, () => topicView(t), 'topic:' + t.id) },
      }];
      if (d === 1 && topicDue(t)) return [{
        key: `eve:${t.id}:${examStr(t)}`, prio: 90,
        title: 'Exam tomorrow: this is your last spaced session',
        body: `${plural(topicDue(t), 'card')} due. Recall timed this session for the day before on purpose. Clear it mixed, then stop.`,
        src: SRC.space, action: { label: `Study ${topicDue(t)} due`, run: studyDue(t) },
      }];
      if (d < 0 && d >= -21) return [{
        key: `past:${t.id}:${examStr(t)}`, prio: 40,
        title: `${t.title} is behind you`,
        body: `The date passed, so these cards are spacing for an exam that already happened. Give it the next date that tests this material (a final, say) and the gaps stretch to fit.`,
        src: SRC.space, action: { label: 'Set the next date', run: () => { topicView(t); const i = document.getElementById('exam'); i && (i.focus(), i.showPicker && i.showPicker()); } },
      }];
      return [];
    },
    // Overconfidence on the last blank-page test.
    (ctx, t) => {
      if (!['home', 'topic', 'deck', 'testdone'].includes(ctx.view)) return [];
      let last = null;
      for (const dk of t.decks) for (const r of store.get('tests:' + dk.id, [])) if (r.at > Date.now() - 14 * DAY && (!last || r.at > last.at)) last = { ...r, dk };
      if (!last || last.predicted - last.actual < 15) return [];
      return [{
        key: `over:${last.dk.id}:${last.at}`, prio: 70,
        title: `You guessed ${last.predicted}%. You scored ${last.actual}%.`,
        body: `That gap is normal and it's the trap: feeling ready isn't being ready. Trust the test, not the feeling. The cards you missed are due now.`,
        src: SRC.judge, action: { label: `Learn ${short(last.dk.title)}`, run: () => learn(refsOf(last.dk), false, false, last.dk.title, () => deckView(last.dk), last.dk.id) },
      }];
    },
    // Close to the exam, real progress, no test yet.
    (ctx, t) => {
      const d = examDays(t);
      if (d === null || d < 1 || d > 4 || !['home', 'topic', 'deck'].includes(ctx.view)) return [];
      if (topicLearned(t) < topicTotal(t) * 0.5) return [];
      const tested = t.decks.some(dk => store.get('tests:' + dk.id, []).some(r => r.at > Date.now() - 4 * DAY));
      if (tested) return [];
      const dk = t.decks.slice().sort((a, b) => learnedCount(b) - learnedCount(a))[0];
      return [{
        key: `check:${t.id}:${examStr(t)}`, prio: 60,
        title: `Find out what you know before ${t.title} does`,
        body: `${topicLearned(t)}/${topicTotal(t)} learned and no blank-page test yet. In the studies, students' predictions didn't track what they'd learned. Predict, test, then fix the misses.`,
        src: SRC.keep, action: { label: `Test ${short(dk.title)}`, run: () => testView(dk, false) },
      }];
    },
  ];

  // Single-screen rules that don't loop over topics.
  const screenRules = [
    ctx => ctx.view !== 'flip' ? [] : [{
      key: `flip:${ctx.deck.id}:${new Date().toDateString()}`, prio: 85,
      title: 'Flipping feels like studying. It mostly isn\'t.',
      body: 'Reading the answer is restudy. Restudy won at 5 minutes and lost at 2 days and 1 week, and it made students more confident without helping them remember. Make yourself produce the answer first.',
      src: SRC.test, action: { label: 'Switch to Learn', run: () => { document.onkeydown = null; learn(refsOf(ctx.deck), false, false, ctx.deck.title, () => deckView(ctx.deck), ctx.deck.id); } },
    }],
    ctx => {
      if (ctx.view !== 'learn' || !ctx.cram) return [];
      const d = ctx.topic ? examDays(ctx.topic) : null;
      if (d !== null && d <= 2) return [];
      const deck = ctx.deck;
      return [{
        key: `cram:${ctx.key}:${new Date().toDateString()}`, prio: 80,
        title: d === null ? 'Cram with no exam date set' : `Cramming ${plural(d, 'day')} out`,
        body: 'Cram is for the last day. It skips your schedule, so nothing you do here sets up the spaced sessions that carry you to exam day. Learn does.',
        src: SRC.space, action: deck ? { label: 'Switch to Learn', run: () => learn(refsOf(deck), false, false, deck.title, () => deckView(deck), deck.id) }
          : ctx.topic ? { label: 'Study what\'s due instead', run: studyDue(ctx.topic) } : null,
      }];
    },
    ctx => {
      if (ctx.view !== 'nothing') return [];
      const alt = topics.map(t => ({ t, n: topicDue(t) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)[0];
      return [{
        key: `nothing:${ctx.key}:${new Date().toDateString()}`, prio: 50,
        title: 'Nothing due here. Good.',
        body: alt ? `Leave these alone until their date: the gap is what makes them stick. ${alt.t.title} has ${plural(alt.n, 'card')} due if you want to keep going.`
          : 'Leave these alone until their date: the gap is what makes them stick. If you want to work, a blank-page test is retrieval, not rereading.',
        src: SRC.space, action: alt ? { label: `Go to ${alt.t.title}`, run: studyDue(alt.t) } : ctx.deck ? { label: 'Take a blank-page test', run: () => testView(ctx.deck, false) } : null,
      }];
    },
    ctx => {
      if (ctx.view !== 'done' || ctx.cram || !ctx.next) return [];
      return [{
        key: `done:${ctx.key}:${ctx.at}`, prio: 30, quiet: true,
        title: `Done. These come back ${fmtDay(ctx.next)}.`,
        body: 'Going over them again before then feels productive and buys you little. The spacing is set to your exam date. Spend the time on another topic.',
        src: SRC.space,
      }];
    },
  ];

  // ---------- state ----------
  let ctx = null, tips = [], live = [], idx = 0, announced = new Set(), ac = null, open = false;
  const seen = () => store.get('coach:seen', {});
  const snoozed = k => (store.get('coach:snooze', {})[k] || 0) > Date.now();
  function snooze(k, hours) { const s = store.get('coach:snooze', {}); s[k] = Date.now() + hours * HOUR; for (const x in s) if (s[x] < Date.now()) delete s[x]; store.set('coach:snooze', s); }
  function markSeen() { const s = seen(); tips.forEach(t => s[t.key] = Date.now()); store.set('coach:seen', s); }

  function evaluate() {
    if (!ctx) return [];
    const ts = ctx.view === 'home' ? topics : ctx.topic ? [ctx.topic] : [];
    let out = [];
    for (const t of ts) for (const r of rules) { try { out.push(...r(ctx, t)); } catch {} }
    for (const r of screenRules) { try { out.push(...r(ctx)); } catch {} }
    out.push(...live);
    const keys = new Set();
    return out.filter(t => !snoozed(t.key) && !keys.has(t.key) && keys.add(t.key)).sort((a, b) => b.prio - a.prio);
  }

  // ---------- orb ----------
  const btn = document.getElementById('coachBtn');
  const panel = document.getElementById('coachPanel');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  function chime() {
    if (!store.get('coach:sound', true)) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime;
      [[1318.5, 0], [1975.5, 0.08], [2637, 0.16]].forEach(([f, dt]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.05, t0 + dt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
        o.connect(g).connect(ac.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.65);
      });
    } catch {}
  }
  function jingle() {
    btn.classList.remove('jingle'); void btn.offsetWidth; btn.classList.add('jingle');
    chime();
  }
  function paintOrb() {
    const s = seen();
    const unread = tips.filter(t => !s[t.key]);
    btn.classList.toggle('has', tips.length > 0);
    btn.classList.toggle('unread', unread.length > 0);
    btn.setAttribute('aria-label', unread.length ? `Study coach: ${plural(unread.length, 'new tip')}` : 'Study coach');
    const fresh = unread.filter(t => !announced.has(t.key) && !t.quiet);
    unread.forEach(t => announced.add(t.key));
    if (fresh.length && !open) setTimeout(jingle, 450);
  }

  function paintPanel() {
    if (!open) return;
    if (idx >= tips.length) idx = 0;
    const t = tips[idx];
    const on = store.get('coach:sound', true);
    panel.innerHTML = !t ? `
      <div class="cp-head"><span class="eyebrow">Coach</span><button class="cp-x" data-x aria-label="Close">×</button></div>
      <h3>Nothing to flag.</h3>
      <p>${(() => { const n = decks.reduce((a, d) => a + dueCount(d), 0); return n ? `${plural(n, 'card')} due across your topics. Study what's due, mixed, and I'll speak up if you drift.` : 'Nothing due anywhere. The gap is doing the work right now.'; })()}</p>
      <div class="cp-foot"><a class="small" href="RESEARCH.md" target="_blank" rel="noopener">What I go by</a><button class="link small" data-sound>Sound ${on ? 'on' : 'off'}</button></div>`
      : `
      <div class="cp-head"><span class="eyebrow">Coach${tips.length > 1 ? ` · <span class="mono">${idx + 1}/${tips.length}</span>` : ''}</span><button class="cp-x" data-x aria-label="Close">×</button></div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.body)}</p>
      <p class="cp-src">Source: ${esc(t.src)} · <a href="RESEARCH.md" target="_blank" rel="noopener">details</a></p>
      <div class="cp-acts">
        ${t.action ? `<button class="btn primary" data-go>${esc(t.action.label)}</button>` : ''}
        <button class="btn" data-later>${t.action ? 'Not now' : 'Got it'}</button>
        ${tips.length > 1 ? `<button class="btn ghost" data-next>Next tip</button>` : ''}
      </div>
      <div class="cp-foot"><span class="small muted">${t.action ? '"Not now" hides this for 12 hours.' : ''}</span><button class="link small" data-sound>Sound ${on ? 'on' : 'off'}</button></div>`;
    panel.classList.remove('swap'); void panel.offsetWidth; panel.classList.add('swap');
    panel.querySelector('[data-x]').onclick = close;
    panel.querySelector('[data-sound]').onclick = () => { store.set('coach:sound', !on); if (!on) chime(); paintPanel(); };
    const go = panel.querySelector('[data-go]'), later = panel.querySelector('[data-later]'), nx = panel.querySelector('[data-next]');
    if (go) go.onclick = () => { snooze(t.key, 12); close(); t.action.run(); };
    if (later) later.onclick = () => { snooze(t.key, t.action ? 12 : 24 * 30); live = live.filter(x => x.key !== t.key); tips = evaluate(); paintOrb(); if (tips.length) paintPanel(); else close(); };
    if (nx) nx.onclick = () => { idx = (idx + 1) % tips.length; paintPanel(); };
  }
  function openPanel() {
    open = true; idx = 0; tips = evaluate();
    panel.hidden = false; btn.setAttribute('aria-expanded', 'true');
    btn.classList.remove('jingle');
    markSeen(); paintOrb(); paintPanel();
    requestAnimationFrame(() => panel.classList.add('in'));
    (panel.querySelector('[data-go]') || panel.querySelector('[data-x]'))?.focus({ preventScroll: true });
  }
  function close() {
    if (!open) return;
    open = false; btn.setAttribute('aria-expanded', 'false');
    panel.classList.remove('in');
    setTimeout(() => { if (!open) panel.hidden = true; }, reduce.matches ? 0 : 220);
  }
  btn.onclick = e => { e.stopPropagation(); open ? close() : openPanel(); };
  document.addEventListener('pointerdown', e => { if (open && !panel.contains(e.target) && !btn.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { close(); btn.focus(); } }, true);
  // the dot's pupil follows the pointer a little
  addEventListener('pointermove', e => {
    if (reduce.matches) return;
    const r = btn.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy) || 1, k = Math.min(1, m / 300) * 4;
    btn.style.setProperty('--px', `${(dx / m) * k}px`); btn.style.setProperty('--py', `${(dy / m) * k}px`);
  }, { passive: true });

  window.Coach = {
    see(c) {
      if (!c) return;
      if (!ctx || c.view !== 'learn' || ctx.view !== 'learn' || c.key !== ctx.key) live = [];
      ctx = c; tips = evaluate(); paintOrb(); if (open) paintPanel();
    },
    push(tip) {
      if (live.some(t => t.key === tip.key) || snoozed(tip.key)) return;
      live.push(tip); tips = evaluate(); paintOrb(); if (open) paintPanel();
    },
    SRC,
  };
  if (window.__coachCtx) Coach.see(window.__coachCtx);
})();
