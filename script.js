/* ════════════════════════════════════════════════════════════════
   SHANU AI  v4.0  —  Production Chatbot Engine
   ════════════════════════════════════════════════════════════════
   Architecture:
     1.  CONFIG                — tuneable constants
     2.  HINGLISH NORMALIZER   — text normalisation
     3.  DATASET CLEANER       — strip metadata from raw chat export
     4.  FUZZY MATCHER         — dice + jaccard + partial matching
     5.  MOOD DETECTOR         — 6-class mood detection (context-aware)
     6.  EMOTION ARC TRACKER   — NEW: conversation-level emotion state
     7.  CONVERSATION STATE    — NEW: fight/makeup/sweet/normal tracking
     8.  RESPONSE VARIATOR     — randomised selection & mood tweaks
     9.  MEMORY MANAGER        — rolling conversation context
    10.  UI MANAGER            — DOM rendering helpers
    11.  MAIN REPLY ENGINE     — orchestrates all modules
    12.  AI FALLBACK           — OpenRouter API call
    13.  EVENT WIRING          — input / send / clear

   v4.0 Changes:
   ─ MATCH_THRESHOLD raised 0.16 → 0.28 (stops wrong dataset hits)
   ─ Context continuity boost: last AI message used to score matches
   ─ Ambiguous single-word inputs penalised (fixes "Hm" false matches)
   ─ emotionArc[] tracker added (conversation-level emotion memory)
   ─ conversationState tracker added (fight/makeup/sweet/normal)
   ─ Last-reply dedup: dataset never picks same output twice in a row
   ─ Mood detection uses previous mood for context bias
   ─ emotionArc + conversationState sent to AI fallback
   ─ Parallel warmup: dataset + AI primed together at boot
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   1. CONFIG
   ─────────────────────────────────────────────────────────────── */
const CFG = {
  MEMORY_LIMIT:        20,    // max conversation turns stored (increased)
  MATCH_THRESHOLD:     0.28,  // ← was 0.16 — raised to stop wrong matches
  TOP_K:               5,     // candidate pool for random pick
  VARIATION_FLOOR:     0.72,  // fraction of top score; candidates above get into pool
  CONTEXT_BOOST_MAX:   0.15,  // max context-continuity score boost
  AMBIGUOUS_PENALTY:   0.65,  // multiplier for single-word input matches
  ARC_LIMIT:           12,    // max emotion arc entries kept

  // Typing simulation
  CHARS_PER_MS:        22,
  TYPE_DELAY_MIN:      380,
  TYPE_DELAY_MAX:      2100,
  TYPE_VARIANCE:       0.28,
  INTER_MSG_PAUSE:     280,
  FALLBACK_DELAY:      700,
};

/* ────────────────────────────────────────────────────────────────
   2. HINGLISH NORMALIZER
   ─────────────────────────────────────────────────────────────── */

const HMAP = {
  // Affirmations
  hn:'haan', hnn:'haan', hna:'haan', hmm:'haan', hm:'haan',
  ha:'haan', haa:'haan', haaa:'haan', han:'haan', haan:'haan',
  h:'hai', hai:'hai',
  // Negations
  nhi:'nahi', ni:'nahi', nai:'nahi', naa:'nahi', na:'nahi', nhn:'nahi',
  // Verbs
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
  // Questions
  kyu:'kyun', kyun:'kyun', kyo:'kyun',
  kya:'kya', kia:'kya', kyaa:'kya',
  kab:'kab', kaha:'kahan', kahan:'kahan',
  kaun:'kaun', kon:'kaun',
  // Pronouns
  m:'main', mai:'main', me:'mein', main:'main', mein:'mein',
  tu:'tu', tum:'tum', aap:'aap',
  mera:'mera', tera:'tera', apna:'apna',
  // Adverbs / time
  kal:'kal', aaj:'aaj', abhi:'abhi',
  fr:'phir', fir:'phir', phir:'phir',
  vo:'woh', wo:'woh', woh:'woh',
  bhi:'bhi', ab:'ab',
  // Qualifiers
  bohot:'bahut', bhot:'bahut', bht:'bahut', bahut:'bahut',
  // Common words
  yrr:'yaar', yar:'yaar', yr:'yaar',
  plz:'please', pls:'please',
  acha:'achha', accha:'achha', achha:'achha',
  thik:'theek', tik:'theek', thek:'theek',
  ok:'okay', okk:'okay', okay:'okay',
  sorry:'sorry', sorryy:'sorry', sorryyy:'sorry',
  lol:'lol', haha:'haha', hehe:'hehe',
  love:'love', miss:'miss',
  ruk:'ruko', rukk:'ruko',
  chal:'chalo', chall:'chalo',
  mat:'mat', nai:'nahi',
};

/**
 * Normalise text: lowercase → strip non-alpha/space/Hindi → map Hinglish variants
 * @param {string} text
 * @returns {string}
 */
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

/**
 * Strip embedded timestamps, reaction labels, and system text
 * from raw WhatsApp chat exports.
 * @param {string} text
 * @returns {string}
 */
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

/**
 * Dice coefficient on character bigrams.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
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

/**
 * Jaccard word overlap — good for Hinglish phrase matching.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function jaccard(a, b) {
  const aW = new Set(a.split(' ').filter(w => w.length > 1));
  const bW = new Set(b.split(' ').filter(w => w.length > 1));
  if (!aW.size || !bW.size) return 0;
  let common = 0;
  for (const w of aW) if (bW.has(w)) common++;
  return common / (aW.size + bW.size - common);
}

/**
 * Partial word match — handles single-word messages like "Hm", "?", "Ok".
 * @param {string} query
 * @param {string} target
 * @returns {number} 0–1
 */
function partialMatch(query, target) {
  const qW = query.split(' ').filter(w => w.length > 1);
  const tW = target.split(' ').filter(w => w.length > 1);
  if (!qW.length || !tW.length) return 0;
  let score = 0;
  for (const q of qW) {
    for (const t of tW) {
      if (t === q)                              { score += 1.0; continue; }
      if (t.startsWith(q) || q.startsWith(t))  { score += 0.72; continue; }
      const d = dice(q, t);
      if (d > 0.55) score += d * 0.6;
    }
  }
  return Math.min(score / qW.length, 1);
}

/**
 * Combined similarity: weights optimised for short Hinglish chat.
 * @param {string} userNorm
 * @param {string} targetNorm
 * @returns {number} 0–1
 */
function similarity(userNorm, targetNorm) {
  return 0.30 * dice(userNorm, targetNorm)
       + 0.45 * jaccard(userNorm, targetNorm)
       + 0.25 * partialMatch(userNorm, targetNorm);
}

/** Shared dataset state */
let dataset   = [];
let dataReady = false;

/**
 * Fetch, clean and index the dataset JSON.
 */
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

/**
 * Find the top-K best matching dataset entries for a user message.
 *
 * v4.0 upgrades:
 *  • Context continuity: last AI message boosts entries whose output chains naturally
 *  • Ambiguous short inputs (≤1 word) are penalised to reduce false matches
 *  • Recent context keywords still boost relevant entries
 *
 * @param {string}   userText
 * @param {object[]} memory   [{role, text}…]
 * @returns {{ item: object, score: number }[]}  sorted desc
 */
function findMatches(userText, memory) {
  const uNorm = normalise(userText);

  // Is this an ambiguous short message? (e.g. "Hm", "Ok", "?")
  const isAmbiguous = uNorm.split(' ').filter(w => w.length > 1).length <= 1;

  // Recent context keywords for boosting topically related entries
  const ctxWords = new Set(
    memory.slice(-8)
      .filter(m => m.role === 'user')
      .flatMap(m => normalise(m.text).split(' '))
      .filter(w => w.length > 2)
  );

  // Last AI message — used for continuity scoring
  const lastAiText = memory.filter(m => m.role === 'ai').slice(-1)[0]?.text || '';
  const lastAiNorm = normalise(lastAiText);

  // Last dataset output used — to prevent exact repeat
  const lastOutputKey = memory.filter(m => m.role === 'ai').slice(-1)[0]?.text?.trim() || '';

  const results = [];

  for (const item of dataset) {
    // ── Base score: combined input similarity ──
    const combined = item.input.join(' ');
    const cNorm    = normalise(combined);
    let   score    = similarity(uNorm, cNorm);

    // Also score each individual input line; keep the best
    for (const line of item.input) {
      const lNorm = normalise(line);
      const ls    = similarity(uNorm, lNorm);
      if (ls > score) score = score * 0.15 + ls * 0.85;
    }

    // ── Context keyword boost (max +0.12) ──
    const itemWords = new Set(cNorm.split(' ').filter(w => w.length > 2));
    let ctxBoost = 0;
    for (const kw of ctxWords) {
      if (itemWords.has(kw)) ctxBoost += 0.035;
    }
    score += Math.min(ctxBoost, 0.12);

    // ── NEW: Context continuity boost ──
    // If the last AI message is similar to this entry's first output line,
    // it means this entry "follows on" naturally → give a small boost
    if (lastAiNorm && item.output.length > 0) {
      const outNorm      = normalise(item.output[0]);
      const continuity   = similarity(lastAiNorm, outNorm);
      score += continuity * 0.15;           // max +0.15 for perfect chain
      score = Math.min(score, 1.0);         // cap at 1
    }

    // ── NEW: Ambiguous input penalty ──
    // Single-word messages like "Hm" match too many entries falsely
    if (isAmbiguous && item.input.length === 1) {
      score *= CFG.AMBIGUOUS_PENALTY;       // was 1.0 → now 0.65
    }

    // ── NEW: Anti-repeat: skip if first output line is identical to last AI reply ──
    if (item.output[0]?.trim() === lastOutputKey) continue;

    if (score >= CFG.MATCH_THRESHOLD) results.push({ item, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, CFG.TOP_K);
}

/* ────────────────────────────────────────────────────────────────
   5. MOOD DETECTOR
   ─────────────────────────────────────────────────────────────── */

const MOODS = {
  love:    { keys: ['love','pyaar','pyar','miss','ilu','cute','baby','jaan','babu','❤️','🥰','😍','i love you','tujhse pyaar','mujhe yaad','I love'], emoji:'❤️',  w:3 },
  sad:     { keys: ['sad','dukhi','rona','ro raha','akela','lonely','hurt','bura lag','dard','cry','😢','🥲','😭','rone','bura feel','kuch nahi'],       emoji:'🥲',  w:3 },
  angry:   { keys: ['gussa','bura','mat bol','shut up','chup','bakwaas','stupid','idiot','😡','😤','😠','nhi karta','chodna','pagal','bekar','jhooth'],  emoji:'😡',  w:3 },
  flirty:  { keys: ['kiss','hug','cuddle','pretty','beautiful','handsome','sexy','hot','tum acha','gorgeous','cute lag','acha lagta'],                  emoji:'😳',  w:3 },
  question:{ keys: ['?','kyun','kyu','kya','kaisa','kab','kaha','kaun','batao','samjhao','why','what','when','how','bata','bolo','suno'],               emoji:'🤔',  w:1 },
};

/**
 * Return the dominant mood, with a bias toward the previous mood
 * to prevent wild swings on ambiguous single-word messages.
 *
 * @param {string} text
 * @param {string} [prevMood]  last detected mood
 * @returns {string}
 */
function detectMood(text, prevMood = 'casual') {
  const low = text.toLowerCase();
  let best = 'casual', top = 0;

  for (const [mood, cfg] of Object.entries(MOODS)) {
    let score = 0;
    for (const k of cfg.keys) if (low.includes(k)) score += cfg.w;
    if (score > top) { top = score; best = mood; }
  }

  // If message is very short (≤3 chars) and no strong signal → inherit previous mood
  if (top === 0 && text.trim().length <= 3 && prevMood !== 'casual') {
    return prevMood;
  }

  return best;
}

/* ────────────────────────────────────────────────────────────────
   6. EMOTION ARC TRACKER  (NEW in v4.0)
   ─────────────────────────────────────────────────────────────── */

/**
 * emotionArc stores the per-message mood over the conversation.
 * Used to give the AI awareness of how the convo has evolved.
 * e.g. ['casual','casual','sad','angry'] = started casual, now angry
 */
let emotionArc = [];

/**
 * Add current mood to the arc.
 * @param {string} mood
 */
function arcPush(mood) {
  emotionArc.push(mood);
  if (emotionArc.length > CFG.ARC_LIMIT) emotionArc.shift();
}

/* ────────────────────────────────────────────────────────────────
   7. CONVERSATION STATE TRACKER  (NEW in v4.0)
   ─────────────────────────────────────────────────────────────── */

/**
 * conversationState is a single label capturing the overall
 * emotional relationship state of this chat session.
 * Values: 'normal' | 'fight' | 'makeup' | 'sweet'
 */
let conversationState = 'normal';

/**
 * Update conversation state based on recent arc.
 * Called after each message is processed.
 */
function updateConversationState() {
  const recent = emotionArc.slice(-4);

  const hasAngry  = recent.includes('angry');
  const hasSad    = recent.includes('sad');
  const hasLove   = recent.some(m => m === 'love' || m === 'flirty');
  const allCasual = recent.every(m => m === 'casual');

  if (hasAngry) {
    // If angry recently but now calming → makeup phase
    const last = emotionArc.slice(-1)[0];
    conversationState = (last === 'angry') ? 'fight' : 'makeup';
  } else if (hasSad && !hasAngry) {
    conversationState = 'normal'; // sad but not angry = normal comfort mode
  } else if (hasLove && !hasAngry && !hasSad) {
    conversationState = 'sweet';
  } else if (allCasual) {
    conversationState = 'normal';
  }
}

/* ────────────────────────────────────────────────────────────────
   8. RESPONSE VARIATOR
   ─────────────────────────────────────────────────────────────── */

const MOOD_INJECTIONS = {
  love:    { pre: ['', 'Hn to 😒', '', 'Pagal h 😌'], suf: ['😊', '', 'Hmm 😌', '', '❤️'] },
  sad:     { pre: ['Kya hua', 'Arre', '', 'Sun'], suf: ['Mat ro yaar 🥲', 'Theek ho jaega', '', 'Bata'] },
  angry:   { pre: ['Hn to 😒', '', 'Acha'], suf: ['😑', 'Seedha baat kr', '', 'Chal ab'] },
  flirty:  { pre: ['Kya kr rha h 😒', 'Pagal h', '', 'Sun'], suf: ['😅', '🙄', '', 'Hmm'] },
  question:{ pre: [], suf: ['', 'Hmm?', 'Bata na', ''] },
  casual:  { pre: [], suf: [] },
};

/** Return random element from arr, or '' if empty */
function rnd(arr) {
  if (!arr || !arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Optionally prepend/append mood-tuned short messages.
 * @param {string[]} msgs
 * @param {string}   mood
 * @returns {string[]}
 */
function injectMoodFlair(msgs, mood) {
  const inj = MOOD_INJECTIONS[mood] || MOOD_INJECTIONS.casual;
  const out  = [...msgs];
  const pre  = rnd(inj.pre || []);
  const suf  = rnd(inj.suf || []);
  if (pre && Math.random() < 0.40) out.unshift(pre);
  if (suf && Math.random() < 0.35) out.push(suf);
  return out.filter(m => m && m.trim().length > 0).slice(0, 5);
}

/**
 * Pick a dataset match with controlled randomness.
 * @param {{ item: object, score: number }[]} scored
 * @returns {object | null}
 */
function selectBest(scored) {
  if (!scored.length) return null;
  if (scored.length === 1) return scored[0].item;
  const threshold = scored[0].score * CFG.VARIATION_FLOOR;
  const pool = scored.filter(s => s.score >= threshold);
  return rnd(pool).item;
}

/* ────────────────────────────────────────────────────────────────
   9. MEMORY MANAGER
   ─────────────────────────────────────────────────────────────── */

let memory = []; // [{role:'user'|'ai', text:string, ts:number}]

function memAdd(role, text) {
  memory.push({ role, text, ts: Date.now() });
  if (memory.length > CFG.MEMORY_LIMIT) memory.shift();
}

/** Return last N turns for API context */
function memContext(n = 10) {
  return memory.slice(-n);
}

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

/**
 * Format a Date object as H:MM AM/PM.
 * @param {Date} [d]
 * @returns {string}
 */
function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
}

/**
 * Render a chat bubble into #chat-box.
 * @param {string}        text
 * @param {'user'|'ai'}   sender
 * @param {string}        [source]      'dataset' | 'ai'
 * @param {boolean}       [showAvatar]
 * @param {string|null}   [mood]
 */
function renderBubble(text, sender, source = 'dataset', showAvatar = true, mood = null) {
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

  // Mood emoji pip (only on first ai message in a group)
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

  if (sender === 'ai') {
    const badge = document.createElement('span');
    badge.className = `source-badge ${source === 'ai' ? 'badge-ai' : 'badge-real'}`;
    badge.textContent = source === 'ai' ? '✦ AI' : '● Real';
    meta.appendChild(badge);
  }

  bubble.appendChild(meta);
  row.appendChild(bubble);
  chatBox.appendChild(row);

  requestAnimationFrame(() => scrollDown());
  return row;
}

/** Smooth-scroll chat to bottom */
function scrollDown() {
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
}

/**
 * Show / hide the typing indicator.
 * @param {boolean} on
 */
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

/**
 * Compute a realistic typing delay for a given string.
 * @param {string} text
 * @returns {number} milliseconds
 */
function typingMs(text) {
  const base = Math.min(
    CFG.TYPE_DELAY_MIN + (text.length / CFG.CHARS_PER_MS) * 1000,
    CFG.TYPE_DELAY_MAX
  );
  return base * (1 - CFG.TYPE_VARIANCE / 2 + Math.random() * CFG.TYPE_VARIANCE);
}

/** Simple promise delay */
const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * Deliver multiple AI messages with per-message typing simulation.
 * @param {string[]} messages
 * @param {string}   source   'dataset' | 'ai'
 * @param {string}   mood
 */
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

/** Lock / unlock input during reply generation */
let busy = false;
function lock(on) {
  busy = on;
  sendBtn.disabled = on || !msgInput.value.trim();
  msgInput.disabled = on;
  if (!on) msgInput.focus();
}

/* ────────────────────────────────────────────────────────────────
   11. MAIN REPLY ENGINE
   ─────────────────────────────────────────────────────────────── */

/** Track last known mood to bias short-message detection */
let lastMood = 'casual';

/**
 * Orchestrates: mood detection → arc update → dataset match → delivery → AI fallback.
 * @param {string} userText
 */
async function generateReply(userText) {
  lock(true);

  // ── Detect mood with context bias ──
  const mood = detectMood(userText, lastMood);
  lastMood   = mood;

  // ── Update emotion arc and conversation state ──
  arcPush(mood);
  updateConversationState();

  // ── Try dataset first ──
  const matches = findMatches(userText, memory);

  if (matches.length > 0) {
    const selected  = selectBest(matches);
    const responses = injectMoodFlair([...selected.output], mood);
    await wait(240 + Math.random() * 320);
    await deliver(responses, 'dataset', mood);
  } else {
    await callAI(userText, mood);
  }

  lock(false);
}

/* ────────────────────────────────────────────────────────────────
   12. AI FALLBACK
   ─────────────────────────────────────────────────────────────── */

const FALLBACK_SHRUG = [
  ['Hn 😑'],
  ['Hmm'],
  ['Hn', 'Ruk'],
  ['😒'],
  ['Hn bhai'],
  ['Acha'],
];

/**
 * Call /api/ask with full context: memory + emotionArc + conversationState.
 * @param {string} userText
 * @param {string} mood
 */
async function callAI(userText, mood) {
  try {
    setTyping(true);
    await wait(CFG.FALLBACK_DELAY + Math.random() * 350);

    const res = await fetch('/api/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:           userText,
        memory:            memContext(),
        mood,
        emotionArc,              // ← NEW: full emotion history
        conversationState,       // ← NEW: fight/makeup/sweet/normal
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
    console.error('[ShanuAI] AI callout failed:', err);
    setTyping(false);
    await deliver(rnd(FALLBACK_SHRUG), 'dataset', null);
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

  // Wait for dataset if still loading
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
});

clearBtn.addEventListener('click', () => {
  const dateDivider = chatBox.querySelector('.date-chip');
  chatBox.innerHTML = '';
  if (dateDivider) chatBox.appendChild(dateDivider);
  // Reset all state
  memory            = [];
  emotionArc        = [];
  conversationState = 'normal';
  lastMood          = 'casual';
  lastSenderRole    = null;
});

/* ────────────────────────────────────────────────────────────────
   BOOTSTRAP
   ─────────────────────────────────────────────────────────────── */

// Parallel warmup: load dataset + pre-warm AI connection together
Promise.all([
  loadDataset(),
  // Silent AI warmup ping (reduces cold-start latency on first real message)
  fetch('/api/ask', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: '', memory: [], mood: 'casual', emotionArc: [], conversationState: 'normal' }),
  }).catch(() => {}),
]);

msgInput.focus();
