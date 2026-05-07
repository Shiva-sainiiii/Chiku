/* ════════════════════════════════════════════════════════════════
   SHANU AI  v5.0  —  Style-RAG Architecture
   ════════════════════════════════════════════════════════════════

   CORE CONCEPT (v5.0):
   Dataset is NO LONGER used for direct replies.
   Dataset = Style Teacher only.

   Flow:
     User message
       → Find 2-3 similar dataset pairs  (style examples only)
       → Send examples + full context to AI
       → AI generates FRESH reply in her style
       → Never copy-paste from dataset again

   Modules:
     1.  CONFIG
     2.  HINGLISH NORMALIZER
     3.  DATASET LOADER + CLEANER
     4.  FUZZY MATCHER         (finds style examples, not direct answers)
     5.  STYLE EXAMPLE BUILDER (NEW — formats examples for AI prompt)
     6.  MOOD DETECTOR         (context-aware)
     7.  EMOTION ARC TRACKER
     8.  CONVERSATION STATE    (fight / makeup / sweet / normal)
     9.  MEMORY MANAGER
    10.  UI MANAGER
    11.  MAIN REPLY ENGINE     (always AI, dataset = style only)
    12.  AI CALLER             (sends styleExamples in payload)
    13.  EVENT WIRING + BOOTSTRAP

   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   1. CONFIG
   ─────────────────────────────────────────────────────────────── */
const CFG = {
  MEMORY_LIMIT:      20,
  MATCH_THRESHOLD:   0.22,   // lower than before — we want MORE style examples found
  TOP_K:             5,      // how many candidates to consider
  VARIATION_FLOOR:   0.72,
  ARC_LIMIT:         12,

  CHARS_PER_MS:      22,
  TYPE_DELAY_MIN:    400,
  TYPE_DELAY_MAX:    2200,
  TYPE_VARIANCE:     0.28,
  INTER_MSG_PAUSE:   300,
  AI_WARMUP_DELAY:   600,
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
  aa:'aao', aaja:'aao', ja:'jao', jaa:'jao', so:'soo', soja:'soo',
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
  ruk:'ruko', rukk:'ruko',
  chal:'chalo', chall:'chalo',
  mat:'mat',
};

function normalise(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => HMAP[w] || w)
    .join(' ');
}

/* ────────────────────────────────────────────────────────────────
   3. DATASET LOADER + CLEANER
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
    console.info(`✅ Style dataset loaded — ${dataset.length} entries`);
  } catch (err) {
    console.warn('⚠️ Dataset unavailable — AI uses base personality only:', err);
  } finally {
    dataReady = true;
  }
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
      if (t === q)                             { score += 1.0; continue; }
      if (t.startsWith(q) || q.startsWith(t)) { score += 0.72; continue; }
      const d = dice(q, t);
      if (d > 0.55) score += d * 0.6;
    }
  }
  return Math.min(score / qW.length, 1);
}

function similarity(a, b) {
  return 0.30 * dice(a, b)
       + 0.45 * jaccard(a, b)
       + 0.25 * partialMatch(a, b);
}

function findTopMatches(userText, memory) {
  const uNorm = normalise(userText);
  const ctxWords = new Set(
    memory.slice(-6)
      .filter(m => m.role === 'user')
      .flatMap(m => normalise(m.text).split(' '))
      .filter(w => w.length > 2)
  );

  const results = [];
  for (const item of dataset) {
    const cNorm = normalise(item.input.join(' '));
    let score   = similarity(uNorm, cNorm);

    for (const line of item.input) {
      const ls = similarity(uNorm, normalise(line));
      if (ls > score) score = score * 0.15 + ls * 0.85;
    }

    const itemWords = new Set(cNorm.split(' ').filter(w => w.length > 2));
    let ctxBoost = 0;
    for (const kw of ctxWords) if (itemWords.has(kw)) ctxBoost += 0.03;
    score += Math.min(ctxBoost, 0.10);

    if (score >= CFG.MATCH_THRESHOLD) results.push({ item, score });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, CFG.TOP_K);
}

/* ────────────────────────────────────────────────────────────────
   5. STYLE EXAMPLE BUILDER  (NEW in v5.0)
   Converts fuzzy matches into clean style reference objects.
   These are sent to the AI as "how she talks" examples —
   NOT as direct replies to copy.
   ─────────────────────────────────────────────────────────────── */

/**
 * Build style example pairs from dataset matches.
 * @param {string}   userText
 * @param {object[]} memory
 * @param {number}   count
 * @returns {{ userSaid: string, sheSaid: string[] }[]}
 */
function buildStyleExamples(userText, memory, count = 3) {
  const matches = findTopMatches(userText, memory);
  if (!matches.length) return [];

  // Deduplicate by first output line
  const seen   = new Set();
  const unique = [];
  for (const { item } of matches) {
    const key = item.output[0]?.trim() || '';
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= count) break;
  }

  return unique.map(item => ({
    userSaid: item.input[0] || '',
    sheSaid:  item.output.slice(0, 3),  // max 3 output lines per example
  }));
}

/* ────────────────────────────────────────────────────────────────
   6. MOOD DETECTOR
   ─────────────────────────────────────────────────────────────── */
const MOODS = {
  love:    { keys: ['love','pyaar','pyar','miss','ilu','cute','baby','jaan','babu','❤️','🥰','😍','i love you','tujhse pyaar','mujhe yaad'], emoji:'❤️', w:3 },
  sad:     { keys: ['sad','dukhi','rona','ro raha','akela','lonely','hurt','bura lag','dard','cry','😢','🥲','😭','rone','bura feel'],      emoji:'🥲', w:3 },
  angry:   { keys: ['gussa','bura','mat bol','shut up','chup','bakwaas','stupid','idiot','😡','😤','😠','nhi karta','chodna','jhooth'],     emoji:'😡', w:3 },
  flirty:  { keys: ['kiss','hug','cuddle','pretty','beautiful','handsome','sexy','hot','tum acha','gorgeous','cute lag'],                   emoji:'😳', w:3 },
  question:{ keys: ['?','kyun','kyu','kya','kaisa','kab','kaha','kaun','batao','samjhao','why','what','when','how','bata','suno'],          emoji:'🤔', w:1 },
};

function detectMood(text, prevMood = 'casual') {
  const low = text.toLowerCase();
  let best = 'casual', top = 0;
  for (const [mood, cfg] of Object.entries(MOODS)) {
    let score = 0;
    for (const k of cfg.keys) if (low.includes(k)) score += cfg.w;
    if (score > top) { top = score; best = mood; }
  }
  if (top === 0 && text.trim().length <= 3 && prevMood !== 'casual') return prevMood;
  return best;
}

/* ────────────────────────────────────────────────────────────────
   7. EMOTION ARC TRACKER
   ─────────────────────────────────────────────────────────────── */
let emotionArc = [];
function arcPush(mood) {
  emotionArc.push(mood);
  if (emotionArc.length > CFG.ARC_LIMIT) emotionArc.shift();
}

/* ────────────────────────────────────────────────────────────────
   8. CONVERSATION STATE TRACKER
   ─────────────────────────────────────────────────────────────── */
let conversationState = 'normal';
function updateConversationState() {
  const recent   = emotionArc.slice(-4);
  const hasAngry = recent.includes('angry');
  const hasLove  = recent.some(m => m === 'love' || m === 'flirty');
  const last     = emotionArc.slice(-1)[0];
  if (hasAngry)              conversationState = (last === 'angry') ? 'fight' : 'makeup';
  else if (hasLove)          conversationState = 'sweet';
  else                       conversationState = 'normal';
}

/* ────────────────────────────────────────────────────────────────
   9. MEMORY MANAGER
   ─────────────────────────────────────────────────────────────── */
let memory = [];
function memAdd(role, text) {
  memory.push({ role, text, ts: Date.now() });
  if (memory.length > CFG.MEMORY_LIMIT) memory.shift();
}
function memContext(n = 10) { return memory.slice(-n); }

/* ────────────────────────────────────────────────────────────────
   10. UI MANAGER
   ─────────────────────────────────────────────────────────────── */
const chatBox    = document.getElementById('chat-box');
const msgInput   = document.getElementById('msg-input');
const sendBtn    = document.getElementById('send-btn');
const typingWrap = document.getElementById('typing-wrap');
const headerStat = document.getElementById('header-status');
const clearBtn   = document.getElementById('clear-btn');

let lastSenderRole = null;

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
}

function renderBubble(text, sender, showAvatar = true, mood = null) {
  const row = document.createElement('div');
  row.className = `msg-row ${sender}`;
  if (sender === 'ai' && !showAvatar) row.classList.add('hide-avatar');

  if (sender === 'ai') {
    const av = document.createElement('div');
    av.className = 'row-avatar';
    av.textContent = '🦋';
    row.appendChild(av);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  if (sender === 'ai' && mood && mood !== 'casual' && showAvatar) {
    const pip = document.createElement('span');
    pip.className = 'mood-pip';
    pip.textContent = MOODS[mood]?.emoji ?? '';
    bubble.appendChild(pip);
  }

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  const time = document.createElement('span');
  time.className = 'bubble-time';
  time.textContent = fmtTime();
  meta.appendChild(time);
  bubble.appendChild(meta);
  row.appendChild(bubble);
  chatBox.appendChild(row);
  requestAnimationFrame(() => scrollDown());
  return row;
}

function scrollDown() {
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
}

function setTyping(on) {
  if (on) {
    typingWrap.classList.remove('hidden');
    headerStat.textContent = 'typing…';
    headerStat.classList.add('is-typing');
    requestAnimationFrame(() => scrollDown());
  } else {
    typingWrap.classList.add('hidden');
    headerStat.textContent = 'Online';
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

async function deliver(messages, mood = null) {
  for (let i = 0; i < messages.length; i++) {
    const msg     = messages[i];
    const isFirst = i === 0;
    const isLast  = i === messages.length - 1;

    setTyping(true);
    await wait(typingMs(msg));
    setTyping(false);

    renderBubble(msg, 'ai', isFirst, isFirst ? mood : null);
    memAdd('ai', msg);

    if (!isLast) await wait(CFG.INTER_MSG_PAUSE);
  }
  setTyping(false);
}

let busy = false;
function lock(on) {
  busy = on;
  sendBtn.disabled  = on || !msgInput.value.trim();
  msgInput.disabled = on;
  if (!on) msgInput.focus();
}

/* ────────────────────────────────────────────────────────────────
   11. MAIN REPLY ENGINE  (v5.0 — Style-RAG)
   ─────────────────────────────────────────────────────────────── */
let lastMood = 'casual';

async function generateReply(userText) {
  lock(true);

  // 1. Mood
  const mood = detectMood(userText, lastMood);
  lastMood   = mood;

  // 2. Arc + state
  arcPush(mood);
  updateConversationState();

  // 3. Style examples from dataset (NOT direct replies)
  const styleExamples = buildStyleExamples(userText, memory, 3);
  console.debug(`[StyleRAG] ${styleExamples.length} style examples found for: "${userText}"`);

  // 4. Always go to AI
  await callAI(userText, mood, styleExamples);

  lock(false);
}

/* ────────────────────────────────────────────────────────────────
   12. AI CALLER
   ─────────────────────────────────────────────────────────────── */
const FALLBACK_SHRUG = [
  ['Hn 😑'], ['Hmm'], ['Hn', 'Ruk'], ['😒'], ['Acha'],
];

function rnd(arr) {
  if (!arr || !arr.length) return arr;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function callAI(userText, mood, styleExamples = []) {
  try {
    setTyping(true);
    await wait(CFG.AI_WARMUP_DELAY + Math.random() * 350);

    const res = await fetch('/api/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:           userText,
        memory:            memContext(),
        mood,
        emotionArc,
        conversationState,
        styleExamples,       // ← KEY: dataset style pairs for AI to learn from
      }),
    });

    setTyping(false);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data     = await res.json();
    const messages = Array.isArray(data.replies)
      ? data.replies
      : String(data.reply ?? 'Hn 😑').split('\n').map(s => s.trim()).filter(Boolean);

    await deliver(messages, mood);

  } catch (err) {
    console.error('[ShanuAI] callAI failed:', err);
    setTyping(false);
    await deliver(rnd(FALLBACK_SHRUG), null);
  }
}

/* ────────────────────────────────────────────────────────────────
   13. EVENT WIRING
   ─────────────────────────────────────────────────────────────── */
async function onSend() {
  if (busy) return;
  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value   = '';
  sendBtn.disabled = true;

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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
});
msgInput.addEventListener('input', () => {
  sendBtn.disabled = busy || !msgInput.value.trim();
});
clearBtn.addEventListener('click', () => {
  const chip = chatBox.querySelector('.date-chip');
  chatBox.innerHTML = '';
  if (chip) chatBox.appendChild(chip);
  memory = []; emotionArc = [];
  conversationState = 'normal'; lastMood = 'casual'; lastSenderRole = null;
});

/* ── BOOTSTRAP ── */
Promise.all([
  loadDataset(),
  fetch('/api/ask', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:'', memory:[], mood:'casual',
      emotionArc:[], conversationState:'normal', styleExamples:[],
    }),
  }).catch(() => {}),
]);

msgInput.focus();
