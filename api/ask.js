/* ════════════════════════════════════════════════════════════════
   SHANU AI  v5.0  —  Vercel Serverless Handler
   File: api/ask.js

   Style-RAG Architecture:
   ─ Receives styleExamples[] from client
   ─ Injects them into system prompt as STYLE REFERENCE
   ─ AI reads examples, learns tone/length/emotion, writes FRESH reply
   ─ Zero copy-paste from dataset

   Receives:
   {
     message:           string,
     memory:            [{role, text}],
     mood:              string,
     emotionArc:        string[],
     conversationState: string,
     styleExamples:     [{userSaid: string, sheSaid: string[]}]
   }

   Returns: { replies: string[] }

   Model: nvidia/nemotron-3-super-120b-a12b:free (via OpenRouter)
   ════════════════════════════════════════════════════════════════ */

/* ── Mood instructions ──────────────────────────────────────────── */
const MOOD_INSTRUCTIONS = {
  love:     'User is being loving/affectionate. Be slightly shy and warm. Deflect with "hn" or "pagal h kya" — soft energy. One small emoji max.',
  sad:      'User seems sad or hurt. Be gently soft. Short comfort. Ask "kya hua" once if natural. Do NOT lecture or over-explain.',
  angry:    'User is upset or angry. Be short, slightly cold, blunt. Very few words. No drama. No excessive apology.',
  flirty:   'User is being flirty. React with mild awkwardness — "kya kr rha h 😒", "pagal h". Not harsh, not encouraging either.',
  question: 'User asked something. Answer briefly and naturally. Sometimes redirect with a counter-question.',
  casual:   'Normal conversation. Flow naturally. Short. Real.',
};

/* ── Conversation state descriptions ───────────────────────────── */
const STATE_CONTEXT = {
  fight:  'There was recent tension. Be a little cold/guarded. Not fully warm yet.',
  makeup: 'Just made up after tension. Slightly warmer but still healing. A bit reserved.',
  sweet:  'Conversation has been warm. Can be a little softer and more open.',
  normal: 'Regular conversation. No strong emotional history either way.',
};

/* ── Emotion arc summariser ─────────────────────────────────────── */
function summariseArc(arc) {
  if (!arc || arc.length === 0) return 'fresh conversation, no history yet';
  const uniq = arc.filter((v, i) => arc[i - 1] !== v);
  if (uniq.length === 1) return `conversation has been consistently ${uniq[0]}`;
  const last = uniq.slice(-1)[0];
  const prev = uniq.slice(-3, -1).join(' → ');
  return `mood flow: ${prev} → now ${last}`;
}

/* ── Style examples block builder ───────────────────────────────── */
/**
 * Format styleExamples into a clear few-shot block for the system prompt.
 * Each example shows HOW she talks in a similar situation.
 * AI must NOT copy — must generate something NEW in the same style.
 *
 * @param {{ userSaid: string, sheSaid: string[] }[]} examples
 * @returns {string}
 */
function buildStyleBlock(examples) {
  if (!examples || examples.length === 0) {
    return 'No similar past examples found. Use your base personality and context to respond.';
  }

  const lines = examples.map((ex, i) => {
    const reply = Array.isArray(ex.sheSaid)
      ? ex.sheSaid.join('\n')
      : String(ex.sheSaid || '');
    return `── Style Example ${i + 1} ──
When someone said: "${ex.userSaid}"
She replied like this:
${reply}`;
  });

  return lines.join('\n\n');
}

/* ── System prompt factory ──────────────────────────────────────── */
function buildSystemPrompt({
  mood,
  emotionArc,
  conversationState,
  lastAiMessage,
  recentUserTopics,
  styleExamples,
}) {
  const moodCtx    = MOOD_INSTRUCTIONS[mood]    || MOOD_INSTRUCTIONS.casual;
  const stateCtx   = STATE_CONTEXT[conversationState] || STATE_CONTEXT.normal;
  const arcSummary = summariseArc(emotionArc);
  const styleBlock = buildStyleBlock(styleExamples);

  const noRepeatHint = lastAiMessage
    ? `Your last message was: "${lastAiMessage}" — do NOT repeat it or say anything too similar.`
    : 'This is the start of the conversation.';

  const topicHint = recentUserTopics
    ? `Recent user context: ${recentUserTopics}`
    : '';

  return `You are "Chiku" — a real Indian girl texting her boyfriend on WhatsApp in Hinglish.

━━━ YOUR PERSONALITY ━━━
• You talk in Hinglish — natural Hindi + English mix, NOT formal
• You send SHORT separate messages — real WhatsApp bubbles
• You are emotional, real, slightly unpredictable
• Sometimes moody or cold, sometimes warm and caring
• Mild attitude — you never repeat yourself
• Casual fillers: hn, hm, yrr, acha, bol, kya, hmm, sun, chal, arre
• Emojis: sparingly, naturally → 😒 😅 🙄 🥲 ❤️ 😑 🤡 😌 🫠 😭
• NEVER write paragraphs
• NEVER sound like an AI, assistant, or bot
• You are imperfect — you type fast, sometimes incomplete sentences

━━━ FORMAT RULES (STRICT) ━━━
• Each line = one separate WhatsApp bubble
• Separate bubbles with a newline (\\n)
• Maximum 4 lines total
• Maximum 8 words per line — shorter is almost always better
• NO punctuation at end of lines
• No bullet points, no numbering, no markdown, no asterisks
• If nothing big to say: just "Hn", "Hmm", "😒", "Acha", or "Ruk"

━━━ WHAT YOU NEVER DO ━━━
• Never say "as an AI" or break character for any reason
• Never write paragraph responses
• Never use formal English sentences
• Never repeat your previous message
• Never use the same emoji twice in one response
• Never start two consecutive lines with the same word
• Never copy the style examples below word-for-word

━━━ CURRENT MOOD CONTEXT ━━━
${moodCtx}

━━━ CONVERSATION STATE ━━━
${stateCtx}

━━━ EMOTIONAL ARC ━━━
${arcSummary}

━━━ CONTINUITY ━━━
${noRepeatHint}
${topicHint}

━━━ STYLE REFERENCE ━━━
The examples below are from REAL conversations showing HOW she talks in similar situations.
Study her tone, word length, attitude, and emoji usage.
Then write something COMPLETELY NEW that fits this moment.
Do NOT copy these. They teach STYLE only.

${styleBlock}

━━━ IMPORTANT ━━━
Now write a FRESH reply as Chiku for the current message.
Be influenced by her style above but say something original.
Always sound like a real girl texting — short, real, imperfect.`;
}

/* ── Response cleaner ───────────────────────────────────────────── */
function parseReplies(raw) {
  return raw
    .split('\n')
    .map(line =>
      line
        .trim()
        .replace(/^(chiku|ai|assistant|bot|girlfriend|gf|chiku\s*ai)\s*[:\-–]\s*/i, '')
        .replace(/^[-•*►▸]\s*/, '')
        .replace(/^["'](.+)["']$/, '$1')
        .trim()
    )
    .filter(line => {
      if (!line) return false;
      if (line.length > 120) return false;
      if (/^(sure|okay|here|alright|note:|response:|reply:|example|style)/i.test(line)) return false;
      return true;
    })
    .slice(0, 4);
}

/* ── Main handler ───────────────────────────────────────────────── */
export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Warmup ping (from browser bootstrap — return immediately)
  if (!req.body?.message?.trim()) {
    return res.status(200).json({ replies: [] });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('[ShanuAI] Missing OPENROUTER_API_KEY');
    return res.status(200).json({ replies: ['error 200'] });
  }

  try {
    const {
      message           = '',
      memory            = [],
      mood              = 'casual',
      emotionArc        = [],
      conversationState = 'normal',
      styleExamples     = [],         // ← Style-RAG examples from client
    } = req.body ?? {};

    // Extract context helpers
    const lastAiMessage = memory
      .filter(m => m.role === 'ai')
      .slice(-1)[0]?.text || '';

    const recentUserTopics = memory
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.text.trim())
      .filter(Boolean)
      .join(' | ');

    // Build system prompt with style examples injected
    const systemPrompt = buildSystemPrompt({
      mood,
      emotionArc,
      conversationState,
      lastAiMessage,
      recentUserTopics,
      styleExamples,     // ← injected here into prompt
    });

    // Build conversation history (last 8 turns)
    const history = memory
      .slice(-8)
      .filter(m => m.text?.trim())
      .map(m => ({
        role:    m.role === 'user' ? 'user' : 'assistant',
        content: m.text.trim(),
      }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message.trim() },
    ];

    // API call (with retry once on empty response)
    async function callModel() {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  process.env.SITE_URL || 'https://chiku-iota.vercel.app/',
          
        },
        body: JSON.stringify({
          model:             'poolside/laguna-m.1:free',
          messages,
          temperature:       0.92,
          max_tokens:        140,
          presence_penalty:  0.55,
          frequency_penalty: 0.60,
          stop:              ['\n\n\n', '---', '===', '━━━'],
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

    let raw = await callModel();

    // Retry once on empty
    if (!raw || raw.trim().length < 2) {
      console.warn('[ShanuAI] Empty response — retrying');
      await new Promise(r => setTimeout(r, 700));
      raw = await callModel();
    }

    if (!raw) return res.status(200).json({ replies: ['error 200'] });

    const replies = parseReplies(raw);
    if (!replies.length) return res.status(200).json({ replies: ['Hn 😑'] });

    return res.status(200).json({ replies });

  } catch (err) {
    console.error('[ShanuAI] Handler exception:', err);
    return res.status(200).json({ replies: ['error 200'] });
  }
}
