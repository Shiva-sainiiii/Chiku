/* ════════════════════════════════════════════════════════════════
   CHIKU  v4.0  —  Chat Engine + Pro UI Features
   ════════════════════════════════════════════════════════════════
   Architecture:
     1.  CONFIG              — tuneable constants
     2.  HINGLISH NORMALIZER — text normalisation
     3.  DATASET CLEANER     — strip metadata from raw chat export
     4.  FUZZY MATCHER       — dice + jaccard + partial matching
     5.  MOOD DETECTOR       — 6-class mood detection
     6.  RESPONSE VARIATOR   — randomised selection & mood tweaks
     7.  MEMORY MANAGER      — rolling conversation context
     8.  UI MANAGER          — DOM rendering helpers
     9.  NEW FEATURES        — profile modal, quick replies, reactions,
                               seen ticks, scroll FAB, char counter
    10.  MAIN REPLY ENGINE   — orchestrates all modules
    11.  AI FALLBACK          — OpenRouter API call
    12.  EVENT WIRING         — input / send / clear + new events
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   1. CONFIG
   ─────────────────────────────────────────────────────────────── */
const CFG = {
  MEMORY_LIMIT:       15,
  MATCH_THRESHOLD:    0.16,
  TOP_K:              5,
  VARIATION_FLOOR:    0.72,

  CHARS_PER_MS:       22,
  TYPE_DELAY_MIN:     180,   // ↓ was 380
  TYPE_DELAY_MAX:     900,   // ↓ was 2100
  TYPE_VARIANCE:      0.20,  // ↓ was 0.28
  INTER_MSG_PAUSE:    180,   // ↓ was 300
  FALLBACK_DELAY:     400,   // ↓ was 800
};

/* ────────────────────────────────────────────────────────────────
   2. HINGLISH NORMALIZER
   ─────────────────────────────────────────────────────────────── */
const HMAP = {
  hn:'haan', hnn:'haan', hna:'haan', hmm:'haan', hm:'haan',
  ha:'haan', haa:'haan', haaa:'haan', han:'haan', haan:'haan',
  h:'hai', hai:'hai',
  nhi:'nahi', ni:'nahi', nai:'nahi', naa:'nahi', na:'nahi', nhn:'nahi',
  kr:'kar', kro:'karo', krna:'karna', krke:'karke', krega:'karega',
  krdunga:'karunga', kardena:'karna', karde:'karo',
  bta:'batao', bata:'batao', btao:'batao', bataao:'batao',
  bol:'bolo', bolde:'bolo', boldena:'bolo',
  de:'do', dede:'do', dena:'dena',
  le:'lo', lena:'lena', leke:'leke',
  sun:'suno', sunn:'suno', sunna:'sunna',
  aa:'aao', aaja:'aao',
  ja:'jao', jaa:'jao',
  so:'soo', soja:'soo',
  kyu:'kyun', kyun:'kyun', kyo:'kyun',
  kya:'kya', kia:'kya', kyaa:'kya',
  kab:'kab', kaha:'kahan', kahan:'kahan',
  kaun:'kaun', kon:'kaun',
  m:'main', mai:'main', me:'mein', main:'main', mein:'mein',
  tu:'tu', tum:'tum', aap:'aap',
  mera:'mera', tera:'tera', apna:'apna',
  kal:'kal', aaj:'aaj', abhi:'abhi',
  fr:'phir', fir:'phir', phir:'phir',
  vo:'woh', wo:'woh', woh:'woh',
  bhi:'bhi', ab:'ab',
  bohot:'bahut', bhot:'bahut', bht:'bahut', bahut:'bahut',
  yrr:'yaar', yar:'yaar', yr:'yaar',
  plz:'please', pls:'please',
  acha:'achha', accha:'achha', achha:'achha',
  thik:'theek', tik:'theek', thek:'theek',
  ok:'okay', okk:'okay', okay:'okay',
  sorry:'sorry', sorryy:'sorry', sorryyy:'sorry',
  lol:'lol', haha:'haha', hehe:'hehe',
  love:'love', miss:'miss',
};

function normalise(text) {
  if (!text) return '';
  const t = text.toLowerCase()
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.split(' ').map(w => HMAP[w] || w).join(' ');
}

/* ────────────────────────────────────────────────────────────────
   3. DATASET CLEANER
   ─────────────────────────────────────────────────────────────── */
function cleanEntry(text) {
  if (!text) return '';
  return text
    .replace(/[❤♥ꕶ][^\(]{0,40}\([^)]{5,50}\)/g, '')
    .replace(/\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4}[^)]*\)/gi, '')
    .replace(/wasn[''`]t notified[^.]*\./gi, '')
    .replace(/sent an attachment\.?/gi, '')
    .replace(/\(edited\)/gi, '')
    .replace(/मैसेज को लाइक किया है/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ────────────────────────────────────────────────────────────────
   4. FUZZY MATCHER
   ─────────────────────────────────────────────────────────────── */
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = s => {
    const bg = new Set();
    for (let i = 0; i < s.length - 1; i++) bg.add(s[i] + s[i + 1]);
    return bg;
  };
  const A = bigrams(a), B = bigrams(b);
  let common = 0;
  for (const bg of A) if (B.has(bg)) common++;
  return (2 * common) / (A.size + B.size);
}

function jaccard(a, b) {
  const aW = new Set(a.split(' ').filter(w => w.length > 1));
  const bW = new Set(b.split(' ').filter(w => w.length > 1));
  if (!aW.size || !bW.size) return 0;
  let common = 0;
  for (const w of aW) if (bW.has(w)) common++;
  return common / (aW.size + bW.size - common);
}

function partialMatch(query, target) {
  const qW = query.split(' ').filter(w => w.length > 1);
  const tW = target.split(' ').filter(w => w.length > 1);
  if (!qW.length || !tW.length) return 0;
  let score = 0;
  for (const q of qW) {
    for (const t of tW) {
      if (t === q)                            { score += 1.0;       continue; }
      if (t.startsWith(q) || q.startsWith(t)) { score += 0.72;      continue; }
      const d = dice(q, t);
      if (d > 0.55) score += d * 0.6;
    }
  }
  return Math.min(score / qW.length, 1);
}

function similarity(userNorm, targetNorm) {
  return 0.30 * dice(userNorm, targetNorm)
       + 0.45 * jaccard(userNorm, targetNorm)
       + 0.25 * partialMatch(userNorm, targetNorm);
}

let dataset   = [];
let dataReady = false;

async function loadDataset() {
  try {
    const res = await fetch('dataset.json');
    const raw = await res.json();
    dataset = raw
      .map(item => ({
        input:  item.input.map(cleanEntry).filter(Boolean),
        output: item.output.map(cleanEntry).filter(Boolean),
      }))
      .filter(item => item.input.length > 0 && item.output.length > 0);
    console.info(`✅ Dataset loaded — ${dataset.length} entries`);
  } catch (err) {
    console.warn('⚠️ Dataset unavailable, AI fallback only:', err);
  } finally {
    dataReady = true;
  }
}

function findMatches(userText, memory) {
  const uNorm = normalise(userText);
  const ctxWords = new Set(
    memory.slice(-8)
      .filter(m => m.role === 'user')
      .flatMap(m => normalise(m.text).split(' '))
      .filter(w => w.length > 2)
  );
  const results = [];
  for (const item of dataset) {
    const combined = item.input.join(' ');
    const cNorm    = normalise(combined);
    let   score    = similarity(uNorm, cNorm);

    for (const line of item.input) {
      const lNorm = normalise(line);
      const ls    = similarity(uNorm, lNorm);
      if (ls > score) score = score * 0.15 + ls * 0.85;
    }

    const itemWords = new Set(cNorm.split(' ').filter(w => w.length > 2));
    let ctxBoost = 0;
    for (const kw of ctxWords) {
      if (itemWords.has(kw)) ctxBoost += 0.035;
    }
    score += Math.min(ctxBoost, 0.12);

    if (score >= CFG.MATCH_THRESHOLD) results.push({ item, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, CFG.TOP_K);
}

/* ────────────────────────────────────────────────────────────────
   5. MOOD DETECTOR
   ─────────────────────────────────────────────────────────────── */
const MOODS = {
  love:    { keys: ['love','pyaar','pyar','miss','ilu','cute','baby','jaan','babu','❤️','🥰','😍','i love you','tujhse pyaar'], emoji:'❤️',  w:3 },
  sad:     { keys: ['sad','dukhi','rona','ro raha','akela','lonely','hurt','bura lag','dard','cry','😢','🥲','😭','rone'],       emoji:'🥲',  w:3 },
  angry:   { keys: ['gussa','bura','mat bol','shut up','chup','bakwaas','stupid','idiot','😡','😤','😠','nhi karta','chodna'],  emoji:'😡',  w:3 },
  flirty:  { keys: ['kiss','hug','cuddle','pretty','beautiful','handsome','sexy','hot','tum acha','gorgeous'],                  emoji:'😳',  w:3 },
  question:{ keys: ['?','kyun','kyu','kya','kaisa','kab','kaha','kaun','batao','samjhao','why','what','when','how','bata'],     emoji:'🤔',  w:1 },
};

function detectMood(text) {
  const low = text.toLowerCase();
  let best = 'casual', top = 0;
  for (const [mood, cfg] of Object.entries(MOODS)) {
    let score = 0;
    for (const k of cfg.keys) if (low.includes(k)) score += cfg.w;
    if (score > top) { top = score; best = mood; }
  }
  return best;
}

/* ────────────────────────────────────────────────────────────────
   6. RESPONSE VARIATOR
   ─────────────────────────────────────────────────────────────── */
const MOOD_INJECTIONS = {
  love:    { pre: ['', 'Hn to 😒', ''], suf: ['😊', '', 'Hmm 😌', ''] },
  sad:     { pre: ['Kya hua', 'Arre', ''], suf: ['Mat ro yaar 🥲', 'Theek ho jaega', ''] },
  angry:   { pre: ['Hn to 😒', ''], suf: ['😑', 'Seedha baat kr', ''] },
  flirty:  { pre: ['Kya kr rha h 😒', 'Pagal h', ''], suf: ['😅', '🙄', ''] },
  question:{ pre: [], suf: ['', 'Hmm?', 'Bata na'] },
  casual:  { pre: [], suf: [] },
};

function rnd(arr) {
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function injectMoodFlair(msgs, mood) {
  const inj = MOOD_INJECTIONS[mood] || MOOD_INJECTIONS.casual;
  const out  = [...msgs];
  const pre = rnd(inj.pre || []);
  const suf = rnd(inj.suf || []);
  if (pre && Math.random() < 0.45) out.unshift(pre);
  if (suf && Math.random() < 0.38) out.push(suf);
  return out.filter(m => m.trim().length > 0);
}

function selectBest(scored) {
  if (!scored.length) return null;
  if (scored.length === 1) return scored[0].item;
  const threshold = scored[0].score * CFG.VARIATION_FLOOR;
  const pool = scored.filter(s => s.score >= threshold);
  return rnd(pool).item;
}

/* ────────────────────────────────────────────────────────────────
   7. MEMORY MANAGER
   ─────────────────────────────────────────────────────────────── */
let memory = [];

function memAdd(role, text) {
  memory.push({ role, text, ts: Date.now() });
  if (memory.length > CFG.MEMORY_LIMIT) memory.shift();
}

function memContext(n = 12) {
  return memory.slice(-n);
}

/* ────────────────────────────────────────────────────────────────
   8. UI MANAGER  (core DOM helpers)
   ─────────────────────────────────────────────────────────────── */

/* ── DOM refs ── */
const chatBox    = document.getElementById('chat-box');
const msgInput   = document.getElementById('msg-input');
const sendBtn    = document.getElementById('send-btn');
const typingWrap = document.getElementById('typing-wrap');
const headerStat = document.getElementById('header-status');
const clearBtn   = document.getElementById('clear-btn');

let lastSenderRole = null;

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Render a chat bubble into #chat-box.
 * Extended: user bubbles get a seen-tick; double-tap fires reaction.
 */
function renderBubble(text, sender, source = 'dataset', showAvatar = true, mood = null) {
  const row = document.createElement('div');
  row.className = `msg-row ${sender}`;
  if (sender === 'ai' && !showAvatar) row.classList.add('hide-avatar');

  /* small avatar (AI side) */
  if (sender === 'ai') {
    const av = document.createElement('div');
    av.className = 'row-avatar';
    av.textContent = '🦋';
    row.appendChild(av);
  }

  /* bubble */
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  /* mood pip (first AI bubble in a group only) */
  if (sender === 'ai' && mood && mood !== 'casual' && showAvatar) {
    const pip = document.createElement('span');
    pip.className = 'mood-pip';
    pip.textContent = MOODS[mood]?.emoji ?? '';
    bubble.appendChild(pip);
  }

  /* meta row */
  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  const time = document.createElement('span');
  time.className = 'bubble-time';
  time.textContent = fmtTime();
  meta.appendChild(time);

  /* source badge (AI side) */
  if (sender === 'ai') {
    const badge = document.createElement('span');
    badge.className = `source-badge ${source === 'ai' ? 'badge-ai' : 'badge-real'}`;
    badge.textContent = source === 'ai' ? '✦ AI' : '● Real';
    meta.appendChild(badge);
  }

  /* seen tick (user side) */
  if (sender === 'user') {
    const tick = document.createElement('span');
    tick.className = 'msg-tick';
    tick.textContent = '✓✓';
    tick.setAttribute('aria-hidden', 'true');
    meta.appendChild(tick);
    lastUserTickEl = tick;   // track for markSeen()
  }

  bubble.appendChild(meta);
  row.appendChild(bubble);
  chatBox.appendChild(row);

  /* double-tap reaction */
  attachReactionListener(row, bubble);

  /* increment message counter */
  totalMessages++;
  statMsgsEl && (statMsgsEl.textContent = totalMessages);

  requestAnimationFrame(() => scrollDown());
  return row;
}

function scrollDown() {
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
}

function setTyping(on) {
  if (on) {
    typingWrap.classList.remove('hidden');
    headerStat.innerHTML = '<span class="status-pulse"></span>typing…';
    headerStat.classList.add('is-typing');
    requestAnimationFrame(() => scrollDown());
  } else {
    typingWrap.classList.add('hidden');
    headerStat.innerHTML = '<span class="status-pulse"></span>Online';
    headerStat.classList.remove('is-typing');
  }
}

function typingMs(text) {
  const base = Math.min(
    CFG.TYPE_DELAY_MIN + (text.length / CFG.CHARS_PER_MS) * 1000,
    CFG.TYPE_DELAY_MAX
  );
  return base * (1 - CFG.TYPE_VARIANCE / 2 + Math.random() * CFG.TYPE_VARIANCE);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function deliver(messages, source = 'dataset', mood = null) {
  for (let i = 0; i < messages.length; i++) {
    const msg     = messages[i];
    const isFirst = i === 0;
    const isLast  = i === messages.length - 1;

    setTyping(true);
    await wait(typingMs(msg));
    setTyping(false);

    renderBubble(msg, 'ai', source, isFirst, isFirst ? mood : null);
    memAdd('ai', msg);

    if (!isLast) await wait(CFG.INTER_MSG_PAUSE);
  }
  setTyping(false);
}

let busy = false;
function lock(on) {
  busy = on;
  sendBtn.disabled = on || !msgInput.value.trim();
  // Do NOT disable the input — disabling it closes the mobile keyboard
  msgInput.readOnly = on;
  if (!on) msgInput.focus();
}

/* ────────────────────────────────────────────────────────────────
   9. NEW FEATURES
   ─────────────────────────────────────────────────────────────── */

/* ── DOM refs (new) ── */
const profileOverlay  = document.getElementById('profile-overlay');
const profileCloseBtn = document.getElementById('profile-close');
const avatarBtn       = document.getElementById('avatar-btn');
const quickRepliesEl  = document.getElementById('quick-replies');
const scrollFab       = document.getElementById('scroll-fab');
const charCounter     = document.getElementById('char-counter');
const profileMoodLbl  = document.getElementById('profile-mood-label');
const statMsgsEl      = document.getElementById('stat-msgs');
const statDaysEl      = document.getElementById('stat-days');

/* ── State ── */
let totalMessages  = 0;
let currentMood    = 'casual';
let lastUserTickEl = null;   // tick element of the last user bubble

/* ── Mood label map ── */
const MOOD_LABELS = {
  love:     'Feeling loved today ❤️',
  sad:      'A little down rn 🥲',
  angry:    'Thodi gussa mood mein 😠',
  flirty:   'Feeling flirty 😳',
  question: 'Curious mode on 🤔',
  casual:   'Feeling good today ✨',
};

/* ── Quick reply presets ── */
const QUICK_REPLIES = {
  love:     ['Tum bhi ❤️', 'Aww 🥺', 'Haha pagal h', 'Miss kar rha tha'],
  sad:      ['Kya hua? 🥺', 'Baat karo na', "I'm here", 'Mat roo yaar'],
  angry:    ['Sorry yaar 🙏', 'Gussa mat ho', 'Galti ho gayi', 'Sunn to…'],
  flirty:   ['Haha 😂', 'Kya kr rha h 😒', 'Pagal h', 'Acha acha'],
  question: ['Haan', 'Nahi yaar', 'Pata nahi', 'Tum batao?'],
  casual:   ['Hn', 'Acha 😊', 'Theek h', 'Haha 😅'],
};

/* ── Days counter via localStorage ── */
function getDaysCount() {
  const KEY = 'chiku_first_visit';
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) { localStorage.setItem(KEY, Date.now().toString()); return 1; }
    return Math.max(1, Math.floor((Date.now() - parseInt(stored)) / 86400000) + 1);
  } catch { return 1; }
}

/* ── Profile modal ── */
function openProfile() {
  statDaysEl && (statDaysEl.textContent = getDaysCount());
  statMsgsEl && (statMsgsEl.textContent = totalMessages);
  profileMoodLbl && (profileMoodLbl.textContent = MOOD_LABELS[currentMood] || MOOD_LABELS.casual);
  profileOverlay.removeAttribute('aria-hidden');
  profileOverlay.removeAttribute('hidden');
  // next frame so display:none → display:flex transition fires
  requestAnimationFrame(() => {
    requestAnimationFrame(() => profileOverlay.classList.add('visible'));
  });
  document.body.style.overflow = 'hidden';
}

function closeProfile() {
  profileOverlay.classList.remove('visible');
  profileOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  // re-hide after transition
  profileOverlay.addEventListener('transitionend', () => {
    if (!profileOverlay.classList.contains('visible')) {
      profileOverlay.style.display = 'none';
      profileOverlay.style.display = '';
    }
  }, { once: true });
}

/* ── Update mood everywhere ── */
function updateProfileMood(mood) {
  currentMood = mood;
  if (profileMoodLbl) {
    profileMoodLbl.textContent = MOOD_LABELS[mood] || MOOD_LABELS.casual;
  }
}

/* ── Quick replies ── */
function showQuickReplies(mood) {
  const chips = QUICK_REPLIES[mood] || QUICK_REPLIES.casual;
  quickRepliesEl.innerHTML = '';
  chips.forEach(text => {
    const chip = document.createElement('button');
    chip.className = 'qr-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      hideQuickReplies();
      msgInput.value = text;
      sendBtn.disabled = false;
      msgInput.focus();
      // small delay so UI updates first
      setTimeout(onSend, 60);
    });
    quickRepliesEl.appendChild(chip);
  });
  quickRepliesEl.classList.remove('hidden');
}

function hideQuickReplies() {
  quickRepliesEl.classList.add('hidden');
  quickRepliesEl.innerHTML = '';
}

/* ── Seen ticks ── */
function markSeen() {
  if (lastUserTickEl) {
    lastUserTickEl.classList.add('seen');
    lastUserTickEl = null;
  }
}

/* ── Double-tap reaction ── */
const tapTracker = new WeakMap(); // row → { count, timer }

function attachReactionListener(row, bubble) {
  bubble.addEventListener('click', () => {
    const now = Date.now();
    const entry = tapTracker.get(row) || { count: 0, lastTime: 0 };

    if (now - entry.lastTime < 350) {
      // Double-tap!
      toggleReaction(row);
      tapTracker.set(row, { count: 0, lastTime: 0 });
    } else {
      tapTracker.set(row, { count: 1, lastTime: now });
    }
  });
}

function toggleReaction(row) {
  const existing = row.querySelector('.reaction-badge');
  if (existing) {
    existing.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }],
      { duration: 180, easing: 'ease-in', fill: 'forwards' })
      .onfinish = () => existing.remove();
  } else {
    const badge = document.createElement('div');
    badge.className = 'reaction-badge';
    badge.textContent = '❤️';
    badge.setAttribute('title', 'Double-tap to remove');
    row.querySelector('.bubble').appendChild(badge);
    vibrate(25);
  }
}

/* ── Haptic feedback helper ── */
function vibrate(ms = 20) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}

/* ── Scroll FAB ── */
function updateScrollFab() {
  const threshold = 80;
  const atBottom  = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < threshold;
  scrollFab.hidden = atBottom;
}

/* ── Character counter ── */
function updateCharCounter() {
  const len = msgInput.value.length;
  if (len > 400) {
    charCounter.textContent = `${len}/500`;
    charCounter.classList.add('visible');
    charCounter.classList.toggle('warning', len > 460);
  } else {
    charCounter.classList.remove('visible', 'warning');
  }
}

/* ────────────────────────────────────────────────────────────────
   10. MAIN REPLY ENGINE
   ─────────────────────────────────────────────────────────────── */
async function generateReply(userText) {
  lock(true);
  hideQuickReplies();

  const mood    = detectMood(userText);
  const matches = findMatches(userText, memory);

  // 60% real dataset, 40% AI — even when dataset matches exist
  const useDataset = matches.length > 0 && Math.random() < 0.60;

  if (useDataset) {
    const selected  = selectBest(matches);
    const responses = injectMoodFlair([...selected.output], mood);
    await wait(80 + Math.random() * 120);
    await deliver(responses, 'dataset', mood);
  } else {
    await callAI(userText, mood);
  }

  /* post-delivery hooks */
  markSeen();
  updateProfileMood(mood);
  showQuickReplies(mood);

  lock(false);
}

/* ────────────────────────────────────────────────────────────────
   11. AI FALLBACK
   ─────────────────────────────────────────────────────────────── */
const FALLBACK_SHRUG = [
  ['Hn 😑'], ['Hmm'], ['Hn', 'Ruk'], ['😒'], ['Hn bhai'],
];

async function callAI(userText, mood) {
  try {
    setTyping(true);
    await wait(CFG.FALLBACK_DELAY + Math.random() * 400);

    const res = await fetch('/api/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        memory:  memContext(),
        mood,
      }),
    });

    setTyping(false);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const messages = Array.isArray(data.replies)
      ? data.replies
      : String(data.reply ?? 'Hn 😑').split('\n').map(s => s.trim()).filter(Boolean);

    await deliver(messages, 'ai', mood);

  } catch (err) {
    console.error('AI callout failed:', err);
    setTyping(false);
    await deliver(rnd(FALLBACK_SHRUG), 'dataset', null);
  }
}

/* ────────────────────────────────────────────────────────────────
   12. EVENT WIRING
   ─────────────────────────────────────────────────────────────── */

/* ── Send ── */
async function onSend() {
  if (busy) return;
  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value = '';
  sendBtn.disabled = true;
  updateCharCounter();
  vibrate(15);
  msgInput.focus(); // keep mobile keyboard open

  renderBubble(text, 'user');
  memAdd('user', text);

  if (!dataReady) {
    await new Promise(resolve => {
      const t = setInterval(() => { if (dataReady) { clearInterval(t); resolve(); } }, 80);
    });
  }
  await generateReply(text);
}

sendBtn.addEventListener('click', onSend);

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

msgInput.addEventListener('input', () => {
  sendBtn.disabled = busy || !msgInput.value.trim();
  updateCharCounter();
  if (msgInput.value.length > 0) hideQuickReplies();
});

/* ── Clear chat ── */
clearBtn.addEventListener('click', () => {
  vibrate(30);
  const dateDivider = chatBox.querySelector('.date-chip');
  chatBox.innerHTML = '';
  if (dateDivider) chatBox.appendChild(dateDivider);
  memory          = [];
  lastSenderRole  = null;
  lastUserTickEl  = null;
  totalMessages   = 0;
  statMsgsEl && (statMsgsEl.textContent = 0);
  hideQuickReplies();
});

/* ── Profile modal ── */
avatarBtn.addEventListener('click', openProfile);
profileCloseBtn.addEventListener('click', closeProfile);
profileOverlay.addEventListener('click', e => {
  if (e.target === profileOverlay) closeProfile();
});
// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && profileOverlay.classList.contains('visible')) closeProfile();
});

/* ── Scroll FAB ── */
chatBox.addEventListener('scroll', updateScrollFab, { passive: true });
scrollFab.addEventListener('click', () => {
  scrollDown();
  vibrate(15);
});

/* ────────────────────────────────────────────────────────────────
   BOOTSTRAP
   ─────────────────────────────────────────────────────────────── */
loadDataset();
msgInput.focus();
statDaysEl && (statDaysEl.textContent = getDaysCount());
