/* ════════════════════════════════════════════════════════════════
   SHANU AI  v4.0  —  Vercel Serverless API Handler
   File: api/ask.js

   Receives:  { message, memory, mood, emotionArc, conversationState }
   Returns:   { replies: string[] }

   Model: nvidia/nemotron-3-super-120b-a12b:free via OpenRouter

   v4.0 Changes:
   ─ Emotion arc injected into system prompt (conversation continuity)
   ─ Conversation state tracking (fight, makeup, sweet, normal)
   ─ Last AI message context for better reply chaining
   ─ Stronger anti-repeat instruction
   ─ Better response cleaning pipeline
   ─ Retry once on empty/bad response
   ════════════════════════════════════════════════════════════════ */

// ── Mood instruction map ─────────────────────────────────────────
const MOOD_INSTRUCTIONS = {
  love:     'User is being loving or affectionate. Be slightly shy and warm — deflect with "hn" or "pagal h kya" but with soft energy. No long speeches. Maybe one small emoji.',
  sad:      'User seems sad, hurt, or down. Be gently soft. Short comfort words. Ask "kya hua" once if appropriate. Do NOT over-explain or lecture.',
  angry:    'User seems upset or angry. Be short, slightly cold, blunt. Few words only. No drama. Do NOT apologise excessively.',
  flirty:   'User is being flirty or cheeky. React with mild awkwardness — "kya kr rha h 😒", "pagal h", "seedha baat kr". Not harsh, not encouraging.',
  question: 'User asked something. Answer briefly and naturally. Sometimes redirect or answer with a counter-question.',
  casual:   'Normal casual conversation. Flow naturally. Short. Real.',
};

// ── Conversation state descriptions ─────────────────────────────
const STATE_CONTEXT = {
  fight:  'There was recent tension or a fight. Be a little cold or guarded. Not fully warm yet.',
  makeup: 'They just made up after tension. Be slightly warmer but still a bit guarded — healing phase.',
  sweet:  'Conversation has been warm and sweet for a while. Can be a little softer and more open.',
  normal: 'Regular conversation. No strong history either way.',
};

// ── Emotion arc summariser ───────────────────────────────────────
/**
 * Summarise last N emotions into a human-readable arc string.
 * e.g. ['casual','casual','sad','angry'] → "started casual, became sad, then angry"
 * @param {string[]} arc
 * @returns {string}
 */
function summariseArc(arc) {
  if (!arc || arc.length === 0) return 'fresh conversation, no history yet';
  const uniq = arc.filter((v, i) => arc[i - 1] !== v); // dedupe consecutive
  if (uniq.length === 1) return `conversation has been consistently ${uniq[0]}`;
  const last = uniq.slice(-1)[0];
  const prev = uniq.slice(-3, -1).join(' → ');
  return `mood went: ${prev} → now ${last}`;
}

// ── System prompt factory ────────────────────────────────────────
/**
 * @param {string}   mood              current message mood
 * @param {string[]} emotionArc        full arc array
 * @param {string}   conversationState 'fight'|'makeup'|'sweet'|'normal'
 * @param {string}   lastAiMessage     Chiku's last reply (for chaining)
 * @param {string}   recentUserTopics  comma-joined last user messages
 * @returns {string}
 */
function buildSystemPrompt(mood, emotionArc, conversationState, lastAiMessage, recentUserTopics) {
  const moodCtx    = MOOD_INSTRUCTIONS[mood]    || MOOD_INSTRUCTIONS.casual;
  const stateCtx   = STATE_CONTEXT[conversationState] || STATE_CONTEXT.normal;
  const arcSummary = summariseArc(emotionArc);

  const lastMsgHint = lastAiMessage
    ? `Your last message was: "${lastAiMessage}" — do NOT repeat it or say something too similar.`
    : 'This is the start of the conversation.';

  const topicsHint = recentUserTopics
    ? `Recent topics/context from user: ${recentUserTopics}`
    : '';

  return `You are "Chiku" — a real Indian girl, someone's girlfriend, texting on WhatsApp in Hinglish.

━━━ YOUR PERSONALITY ━━━
• You talk in Hinglish: natural Hindi + English mix, NOT formal
• You send SHORT separate messages — like real WhatsApp chat bubbles
• You are emotional, real, slightly unpredictable
• Sometimes moody (silent, cold), sometimes warm and caring
• You have mild attitude — you don't repeat yourself ever
• You use casual fillers: hn, hm, yrr, acha, bol, kya, hmm, sun
• You use emojis sparingly and naturally: 😒 😅 🙄 🥲 ❤️ 😑 🤡 😌 🫠
• You NEVER write paragraphs
• You NEVER explain yourself like an AI would
• You sound like a real girl who types fast and doesn't overthink

━━━ FORMAT RULES (STRICT) ━━━
• Every line = one separate WhatsApp message bubble
• Separate each message with a newline (\\n)
• Max 4 lines per response
• Max 8 words per line — shorter is better
• ZERO punctuation at end of lines — real chat style
• No bullet points, no numbering, no markdown
• If you have nothing to say: just "Hn", "Hmm", "😒", or "Acha"

━━━ WHAT YOU NEVER DO ━━━
• Never say "as an AI" or break character under any condition
• Never write paragraph responses
• Never be overly helpful or explain things in detail
• Never use English-only formal sentences
• Never repeat your own previous message
• Never send the same emoji twice in one response
• Never start two consecutive lines with the same word

━━━ CURRENT MOOD CONTEXT ━━━
${moodCtx}

━━━ CONVERSATION STATE ━━━
${stateCtx}

━━━ EMOTIONAL ARC (conversation history) ━━━
${arcSummary}

━━━ CONTINUITY ━━━
${lastMsgHint}
${topicsHint}

━━━ EXAMPLE EXCHANGES ━━━

User: I miss you so much
Chiku:
Hn
😒
Pagal h kya
Baat kr seedha

User: Sorry yaar
Chiku:
Kitni baar bolega
Hn theek h
Ab chal

User: Kya kar rhi ho
Chiku:
Kuch nhi
Bore ho rha h kya
Tu bata

User: Tum mujhe bhool gaye
Chiku:
Haan bilkul
😑
Aise hi hota h

User: Goodnight
Chiku:
Hn
Gn
Sweet dreams

User: Bahut gussa h mujhse
Chiku:
Toh h
😒
Kya krun main

━━━ REMEMBER ━━━
Always sound like a real girl texting. Imperfect spelling is fine. Short is always better than long.`;
}

// ── Response cleaner ─────────────────────────────────────────────
/**
 * Parse raw model output into clean message array.
 * @param {string} raw
 * @returns {string[]}
 */
function parseReplies(raw) {
  return raw
    .split('\n')
    .map(line =>
      line
        .trim()
        // Remove "Chiku:" / "AI:" / "Assistant:" prefixes model sometimes adds
        .replace(/^(chiku|chiku\s*ai|ai|assistant|bot|girlfriend|gf)\s*[:\-–]\s*/i, '')
        // Remove leading bullets / dashes
        .replace(/^[-•*►▸]\s*/, '')
        // Remove wrapping quotes
        .replace(/^["'](.+)["']$/, '$1')
        .trim()
    )
    .filter(line => {
      if (!line) return false;
      if (line.length > 120) return false;
      // Filter meta-commentary the model sometimes outputs
      if (/^(sure|okay|here|alright|note:|response:|reply:)/i.test(line)) return false;
      return true;
    })
    .slice(0, 4); // Max 4 bubbles
}

// ── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('[ShanuAI] Missing OPENROUTER_API_KEY');
    return res.status(200).json({ replies: ['Hn 😑'] });
  }

  try {
    const {
      message           = '',
      memory            = [],
      mood              = 'casual',
      emotionArc        = [],
      conversationState = 'normal',
    } = req.body ?? {};

    if (!message.trim()) {
      return res.status(400).json({ replies: ['Hn'] });
    }

    // ── Extract context helpers ──────────────────────────────────

    // Last thing Chiku said (for anti-repeat)
    const lastAiMessage = memory
      .filter(m => m.role === 'ai')
      .slice(-1)[0]?.text || '';

    // Recent user topics (last 3 user messages joined)
    const recentUserTopics = memory
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.text.trim())
      .filter(Boolean)
      .join(' | ');

    // ── Build messages array ─────────────────────────────────────
    const systemPrompt = buildSystemPrompt(
      mood,
      emotionArc,
      conversationState,
      lastAiMessage,
      recentUserTopics,
    );

    // Use last 8 turns (focused context — not too long for free model)
    const history = memory
      .slice(-8)
      .filter(m => m.text && m.text.trim())
      .map(m => ({
        role:    m.role === 'user' ? 'user' : 'assistant',
        content: m.text.trim(),
      }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message.trim() },
    ];

    // ── API call helper (used for retry) ────────────────────────
    async function callModel() {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  process.env.SITE_URL || 'https://chiku-iota.vercel.app/',
          
        },
        body: JSON.stringify({
          model:             'nvidia/nemotron-3-super-120b-a12b:free',
          messages,
          temperature:       0.92,          // slightly tuned for expression
          max_tokens:        140,           // slightly more room
          presence_penalty:  0.55,          // stronger — avoid stale replies
          frequency_penalty: 0.60,          // stronger — reduce repetition
          stop:              ['\n\n\n', '---', '==='],
        }),
      });

      if (!apiRes.ok) {
        const errBody = await apiRes.text().catch(() => '');
        console.error(`[ShanuAI] OpenRouter ${apiRes.status}:`, errBody);
        return null;
      }

      const data = await apiRes.json();
      return data.choices?.[0]?.message?.content ?? '';
    }

    // ── First attempt ────────────────────────────────────────────
    let raw = await callModel();

    // ── Retry once if empty / very short ────────────────────────
    if (!raw || raw.trim().length < 2) {
      console.warn('[ShanuAI] Empty response — retrying once');
      await new Promise(r => setTimeout(r, 600)); // small pause before retry
      raw = await callModel();
    }

    if (!raw) {
      return res.status(200).json({ replies: ['Hn 😑'] });
    }

    // ── Parse into bubbles ───────────────────────────────────────
    const replies = parseReplies(raw);

    if (!replies.length) {
      return res.status(200).json({ replies: ['Hn 😑'] });
    }

    return res.status(200).json({ replies });

  } catch (err) {
    console.error('[ShanuAI] Handler exception:', err);
    return res.status(200).json({ replies: ['Hn 😑'] });
  }
}
