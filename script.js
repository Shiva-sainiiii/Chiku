/* ════════════════════════════════════════════════════════════════
   SHANU AI  v3.0  —  Production Chatbot Engine
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
     9.  MAIN REPLY ENGINE   — orchestrates all modules
    10.  AI FALLBACK          — OpenRouter API call
    11.  EVENT WIRING         — input / send / clear
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────────
   1. CONFIG
   ─────────────────────────────────────────────────────────────── */
const CFG = {
  MEMORY_LIMIT:       15,    // max conversation turns stored
  MATCH_THRESHOLD:    0.16,  // min combined similarity score
  TOP_K:              5,     // candidate pool for random pick
  VARIATION_FLOOR:    0.72,  // fraction of top score; candidates above get into pool

  // Typing simulation
  CHARS_PER_MS:       22,    // typing speed (chars / second ≈ this * 1000)
  TYPE_DELAY_MIN:     380,   // ms — fastest a reply can appear
  TYPE_DELAY_MAX:     2100,  // ms — cap for very long messages
  TYPE_VARIANCE:      0.28,  // ±% randomness added to delay
  INTER_MSG_PAUSE:    300,   // ms gap between consecutive ai messages
  FALLBACK_DELAY:     800,   // extra base delay before AI API messages
};

/* ────────────────────────────────────────────────────────────────
   2. HINGLISH NORMALIZER
   ─────────────────────────────────────────────────────────────── */

/** Canonical forms for common Hinglish spelling variations */
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
};

/**
 * Normalise text: lowercase → strip non-alpha/space/Hindi → map Hinglish variants
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
  if (!text) return '';
  const t = text.toLowerCase()
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')  // keep Hindi unicode range + alphanums
    .replace(/\s+/g, ' ')
    .trim();
  return t.split(' ').map(w => HMAP[w] || w).join(' ');
}

/* ────────────────────────────────────────────────────────────────
   3. DATASET CLEANER
   ─────────────────────────────────────────────────────────────── */

/**
 * Strip embedded timestamps, reaction labels, and system text
 * that appear in raw WhatsApp chat exports.
 *
 * Patterns removed:
 *   ❤ꕶʜɪᴠᴀ ꕶᴀɪɴɪ (Jul 18, 2024 6:44 am)
 *   (edited)
 *   wasn't notified about this message…
 *   sent an attachment.
 *   मैसेज को लाइक किया है
 *   Standalone (Month DD, YYYY HH:MM am/pm)
 * @param {string} text
 * @returns {string}
 */
function cleanEntry(text) {
  if (!text) return '';
  return text
    .replace(/[❤♥ꕶ][^\(]{0,40}\([^)]{5,50}\)/g, '')          // name+timestamp
    .replace(/\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4}[^)]*\)/gi, '') // standalone timestamp
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
 * Tolerates typos, abbreviations, partial words.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  /** @param {string} s @returns {Set<string>} */
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
      if (t === q)            { score += 1.0; continue; }
      if (t.startsWith(q) || q.startsWith(t)) { score += 0.72; continue; }
      const d = dice(q, t);
      if (d > 0.55) score += d * 0.6;
    }
  }
  return Math.min(score / qW.length, 1);
}

/**
 * Combined similarity: weights optimised for short Hinglish chat.
 * @param {string} userNorm   normalised user text
 * @param {string} targetNorm normalised dataset text
 * @returns {number} 0–1
 */
function similarity(userNorm, targetNorm) {
  return 0.30 * dice(userNorm, targetNorm)
       + 0.45 * jaccard(userNorm, targetNorm)
       + 0.25 * partialMatch(userNorm, targetNorm);
}

/** Shared dataset state */
let dataset     = [];
let dataReady   = false;

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
 * Context memory provides a small boost to topically related items.
 *
 * @param {string}   userText
 * @param {object[]} memory   [{role, text}…]
 * @returns {{ item: object, score: number }[]}  sorted desc
 */
function findMatches(userText, memory) {
  const uNorm = normalise(userText);

  // Build a set of recent context keywords for boosting
  const ctxWords = new Set(
    memory.slice(-8)
      .filter(m => m.role === 'user')
      .flatMap(m => normalise(m.text).split(' '))
      .filter(w => w.length > 2)
  );

  const results = [];

  for (const item of dataset) {
    // Score against combined input text
    const combined = item.input.join(' ');
    const cNorm    = normalise(combined);
    let   score    = similarity(uNorm, cNorm);

    // Also score each individual input line; keep the best boost
    for (const line of item.input) {
      const lNorm = normalise(line);
      const ls    = similarity(uNorm, lNorm);
      if (ls > score) score = score * 0.15 + ls * 0.85;
    }

    // Context relevance boost (max +0.12)
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

/**
 * Return the dominant mood string from user text.
 * @param {string} text
 * @returns {string} 'love' | 'sad' | 'angry' | 'flirty' | 'question' | 'casual'
 */
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

/**
 * Mood-specific prefix / suffix snippets to inject into dataset replies.
 * Each value is an array — one is randomly chosen (can be '' for silence).
 */
const MOOD_INJECTIONS = {
  love:    { pre: ['', 'Hn to 😒', ''], suf: ['😊', '', 'Hmm 😌', ''] },
  sad:     { pre: ['Kya hua', 'Arre', ''], suf: ['Mat ro yaar 🥲', 'Theek ho jaega', ''] },
  angry:   { pre: ['Hn to 😒', ''], suf: ['😑', 'Seedha baat kr', ''] },
  flirty:  { pre: ['Kya kr rha h 😒', 'Pagal h', ''], suf: ['😅', '🙄', ''] },
  question:{ pre: [], suf: ['', 'Hmm?', 'Bata na'] },
  casual:  { pre: [], suf: [] },
};

/** Return random element from arr, or '' if empty */
function rnd(arr) {
  if (!arr.length) return '';
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

  const pre = rnd(inj.pre || []);
  const suf = rnd(inj.suf || []);

  if (pre && Math.random() < 0.45) out.unshift(pre);
  if (suf && Math.random() < 0.38) out.push(suf);

  return out.filter(m => m.trim().length > 0);
}

/**
 * Pick a dataset match with controlled randomness:
 * any candidate within VARIATION_FLOOR% of the top score is eligible.
 * @param {{ item: object, score: number }[]} scored
 * @returns {object | null}  dataset item
 */
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

let memory = [];  // [{role:'user'|'ai', text:string, ts:number}]

function memAdd(role, text) {
  memory.push({ role, text, ts: Date.now() });
  if (memory.length > CFG.MEMORY_LIMIT) memory.shift();
}

/** Return last N turns for API context */
function memContext(n = 12) {
  return memory.slice(-n);
}

/* ────────────────────────────────────────────────────────────────
   8. UI MANAGER
   ─────────────────────────────────────────────────────────────── */

const chatBox     = document.getElementById('chat-box');
const msgInput    = document.getElementById('msg-input');
const sendBtn     = document.getElementById('send-btn');
const typingWrap  = document.getElementById('typing-wrap');
const headerStat  = document.getElementById('header-status');
const clearBtn    = document.getElementById('clear-btn');

/** @type {DOMHighResTimeStamp} Tracks last user message time for avatar grouping */
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
 * Does NOT insert source text into the message content — badge is CSS-only.
 *
 * @param {string}  text
 * @param {'user'|'ai'} sender
 * @param {string}  [source]   'dataset' | 'ai'
 * @param {boolean} [showAvatar]  show small avatar on ai bubbles
 * @param {string}  [mood]     show mood pip on first ai bubble in group
 */
function renderBubble(text, sender, source = 'dataset', showAvatar = true, mood = null) {
  const row = document.createElement('div');
  row.className = `msg-row ${sender}`;
  if (sender === 'ai' && !showAvatar) row.classList.add('hide-avatar');

  // Tiny avatar (ai side only)
  if (sender === 'ai') {
    const av = document.createElement('div');
    av.className = 'row-avatar';
    av.textContent = '🦋';
    row.appendChild(av);
  }

  // Bubble wrapper
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;   // ← plain text only, no injected labels

  // Mood emoji pip (only on first ai message in a group)
  if (sender === 'ai' && mood && mood !== 'casual' && showAvatar) {
    const pip = document.createElement('span');
    pip.className = 'mood-pip';
    pip.textContent = MOODS[mood]?.emoji ?? '';
    bubble.appendChild(pip);
  }

  // Meta row: timestamp + source badge
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

  // Smooth scroll after render
  requestAnimationFrame(() => scrollDown());
  return row;
}

/** Smooth-scroll chat to bottom */
function scrollDown() {
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
}

/**
 * Show / hide the typing indicator and update header status.
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
 * Shorter texts are faster; there's random ±variance.
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
   9. MAIN REPLY ENGINE
   ─────────────────────────────────────────────────────────────── */

/**
 * Orchestrates dataset matching → mood flair → delivery → AI fallback.
 * @param {string} userText
 */
async function generateReply(userText) {
  lock(true);

  const mood    = detectMood(userText);
  const matches = findMatches(userText, memory);

  if (matches.length > 0) {
    // ── Dataset hit ──
    const selected  = selectBest(matches);
    const responses = injectMoodFlair([...selected.output], mood);

    // Brief pause before first reply (feels human)
    await wait(260 + Math.random() * 340);
    await deliver(responses, 'dataset', mood);

  } else {
    // ── AI fallback ──
    await callAI(userText, mood);
  }

  lock(false);
}

/* ────────────────────────────────────────────────────────────────
   10. AI FALLBACK
   ─────────────────────────────────────────────────────────────── */

/** Fallback messages if the API is completely unreachable */
const FALLBACK_SHRUG = [
  ['Hn 😑'],
  ['Hmm'],
  ['Hn', 'Ruk'],
  ['😒'],
  ['Hn bhai'],
];

/**
 * Call /api/ask with memory context and receive multi-message array.
 * @param {string} userText
 * @param {string} mood
 */
async function callAI(userText, mood) {
  try {
    setTyping(true);
    await wait(CFG.FALLBACK_DELAY + Math.random() * 400);

    const res = await fetch('/api/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message: userText,
        memory:  memContext(),
        mood,
      }),
    });

    setTyping(false);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // API returns { replies: string[] } — fall back to legacy { reply: string }
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
   11. EVENT WIRING
   ─────────────────────────────────────────────────────────────── */

/** Handle send action */
async function onSend() {
  if (busy) return;

  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value = '';
  sendBtn.disabled = true;

  // Render user bubble immediately
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

// Send button click
sendBtn.addEventListener('click', onSend);

// Enter key (no shift)
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

// Enable / disable send button based on input
msgInput.addEventListener('input', () => {
  sendBtn.disabled = busy || !msgInput.value.trim();
});

// Clear chat
clearBtn.addEventListener('click', () => {
  const dateDivider = chatBox.querySelector('.date-chip');
  chatBox.innerHTML = '';
  if (dateDivider) chatBox.appendChild(dateDivider);
  memory = [];
  lastSenderRole = null;
});

/* ────────────────────────────────────────────────────────────────
   BOOTSTRAP
   ─────────────────────────────────────────────────────────────── */
loadDataset();
msgInput.focus();
