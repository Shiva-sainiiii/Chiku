/* ════════════════════════════════════════════════════════════════
   SHANU AI  v5.2  —  Minimal Prompt Fix
   
   ROOT CAUSE FIX:
   Free models dump system prompt content as reply when the prompt
   contains meta-language like "Rules:", "max 4 lines", "8 words".
   
   Solution: System prompt = ~2 sentences only (character + mood).
   Format/style taught ENTIRELY via few-shot conversation turns.
   Zero rules, zero instructions in system prompt.
   ════════════════════════════════════════════════════════════════ */

/* ── Hardcoded few-shot examples ─────────────────────────────────
   These teach format implicitly — no rules needed.
   Model sees pattern and follows it naturally.
   ────────────────────────────────────────────────────────────── */
const BASE_EXAMPLES = [
  { u: 'Hi',            a: 'Hn' },
  { u: 'Kya kar rhi ho', a: 'Kuch nhi\nTu bata' },
  { u: 'Miss kar rha hun tujhe', a: 'Hn to\nPagal h kya\n😒' },
  { u: 'Khana khaya?',  a: 'Haan\nTune?' },
  { u: 'Gussa ho?',     a: 'Nahi\nBs aise hi' },
  { u: 'Good morning',  a: 'Hmm\nUth gaya?' },
  { u: 'I love you',    a: 'Hn\n😒\nPagal h' },
  { u: 'Kaha ho?',      a: 'Ghar pe\nKyun' },
  { u: 'Baat karo na',  a: 'Bol na\nKya h' },
  { u: 'Sorry yaar',    a: 'Hn theek h\nAb chal' },
];

/* ── Mood → character hint (1 line only) ─────────────────────── */
const MOOD_HINT = {
  love:     'She is warm but shy right now.',
  sad:      'She is being soft and gentle right now.',
  angry:    'She is cold and short right now.',
  flirty:   'She is mildly awkward and deflecting right now.',
  question: 'She answers briefly, sometimes with counter-question.',
  casual:   'Normal mood.',
};

/* ── System prompt — intentionally tiny ─────────────────────── */
function buildSystemPrompt(mood, conversationState, emotionArc) {
  const hint = MOOD_HINT[mood] || MOOD_HINT.casual;

  // State hint — one word max
  const stateHint = conversationState === 'fight'  ? 'Slightly guarded.' :
                    conversationState === 'makeup' ? 'Warming up slowly.' :
                    conversationState === 'sweet'  ? 'A bit more open.' : '';

  return `You are Chiku, an Indian girl texting her boyfriend in Hinglish on WhatsApp. ${hint} ${stateHint}`.trim();
}

/* ── Pick relevant base examples by keyword overlap ─────────── */
function pickBaseExamples(userText, count = 3) {
  const low = userText.toLowerCase();
  // Score each example by overlap with user text
  const scored = BASE_EXAMPLES.map(ex => {
    const words = ex.u.toLowerCase().split(' ');
    const hits  = words.filter(w => low.includes(w) || low.includes(w.slice(0, 3))).length;
    return { ex, hits };
  }).sort((a, b) => b.hits - a.hits);

  // Always include top match + 2 random others for variety
  const top    = scored[0].ex;
  const others = BASE_EXAMPLES.filter(e => e !== top);
  const rndTwo = others.sort(() => Math.random() - 0.5).slice(0, count - 1);
  return [top, ...rndTwo];
}

/* ── Style examples from dataset → conversation turns ────────── */
function styleExamplesToTurns(examples) {
  if (!examples || examples.length === 0) return [];
  const turns = [];
  for (const ex of examples.slice(0, 2)) {
    const input  = (ex.userSaid || '').trim();
    const output = Array.isArray(ex.sheSaid)
      ? ex.sheSaid.join('\n').trim()
      : String(ex.sheSaid || '').trim();
    if (!input || !output) continue;
    turns.push({ role: 'user',      content: input  });
    turns.push({ role: 'assistant', content: output });
  }
  return turns;
}

/* ── Response cleaner ────────────────────────────────────────── */
function parseReplies(raw) {
  return raw
    .split('\n')
    .map(line =>
      line
        .trim()
        .replace(/^(chiku|ai|assistant|bot|gf)\s*[:\-–]\s*/i, '')
        .replace(/^[-•*►]\s*/, '')
        .replace(/^["'](.+)["']$/, '$1')
        // Remove lines that are clearly rule/meta text
        .replace(/^(the rules|rules say|according to|note:|remember:).*/i, '')
        .trim()
    )
    .filter(line => {
      if (!line) return false;
      if (line.length > 80) return false;
      if (/\b(rules|instructions|system|prompt|lines|words per|format)\b/i.test(line)) return false;
      if (/^(sure|okay here|alright|as an ai|i am an)/i.test(line)) return false;
      return true;
    })
    .slice(0, 4);
}

/* ── Main handler ────────────────────────────────────────────── */
export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!req.body?.message?.trim()) {
    return res.status(200).json({ replies: [] });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(200).json({ replies: ['Hn'] });
  }

  try {
    const {
      message           = '',
      memory            = [],
      mood              = 'casual',
      emotionArc        = [],
      conversationState = 'normal',
      styleExamples     = [],
    } = req.body ?? {};

    // 1. Tiny system prompt (2 sentences max)
    const systemPrompt = buildSystemPrompt(mood, conversationState, emotionArc);

    // 2. Base few-shot examples (hardcoded, always reliable)
    const baseExamples = pickBaseExamples(message, 3);
    const baseTurns = baseExamples.flatMap(ex => [
      { role: 'user',      content: ex.u },
      { role: 'assistant', content: ex.a },
    ]);

    // 3. Dataset style examples as turns (if found)
    const styleTurns = styleExamplesToTurns(styleExamples);

    // 4. Real memory (last 4 turns only — keep total tokens low)
    const memTurns = memory
      .slice(-4)
      .filter(m => m.text?.trim())
      .map(m => ({
        role:    m.role === 'user' ? 'user' : 'assistant',
        content: m.text.trim(),
      }));

    // 5. Final messages array
    // Order: system → base examples → dataset examples → memory → real message
    const messages = [
      { role: 'system', content: systemPrompt },
      ...baseTurns,    // hardcoded style examples — always there
      ...styleTurns,   // dataset style examples — when found
      ...memTurns,     // real conversation history
      { role: 'user',  content: message.trim() },
    ];

    // 6. API call
    async function callModel() {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  process.env.SITE_URL || 'https://chiku-iota.vercel.app/',
          'X-Title':       'Shanu AI',
        },
        body: JSON.stringify({
          model:             'nvidia/nemotron-3-super-120b-a12b:free',
          messages,
          temperature:       0.88,
          max_tokens:        80,        // tight limit — 4 short lines max
          presence_penalty:  0.4,
          frequency_penalty: 0.4,
        }),
      });

      if (!apiRes.ok) {
        console.error(`[ShanuAI] ${apiRes.status}:`, await apiRes.text().catch(() => ''));
        return null;
      }

      const data = await apiRes.json();
      return data.choices?.[0]?.message?.content ?? '';
    }

    let raw = await callModel();

    if (!raw || raw.trim().length < 1) {
      await new Promise(r => setTimeout(r, 800));
      raw = await callModel();
    }

    if (!raw) return res.status(200).json({ replies: ['Hn'] });

    const replies = parseReplies(raw);
    return res.status(200).json({ replies: replies.length ? replies : ['Hn'] });

  } catch (err) {
    console.error('[ShanuAI] Exception:', err);
    return res.status(200).json({ replies: ['Hn'] });
  }
}
