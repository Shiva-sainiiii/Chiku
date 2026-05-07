/* ════════════════════════════════════════════════════════════════
   SHANU AI  v5.1  —  Vercel Serverless Handler
   File: api/ask.js

   KEY FIX (v5.1):
   Free models break with 2000+ token system prompts.
   Solution: SHORT system prompt (~150 words) + style examples
   injected as fake user/assistant turns INSIDE messages[].
   This is called "few-shot via conversation history" and works
   much better on small/free models.

   Flow:
     system:    [~150 token personality prompt]
     user:      style example input 1        ← fake turn
     assistant: style example output 1       ← fake turn
     user:      style example input 2        ← fake turn
     assistant: style example output 2       ← fake turn
     [real memory turns]
     user:      actual message               ← real
   ════════════════════════════════════════════════════════════════ */

/* ── SHORT system prompt — under 200 words ──────────────────────── */
function buildSystemPrompt(mood, conversationState, emotionArc) {
  const moodMap = {
    love:     'Be warm but slightly shy. Short deflection like "pagal h kya" is fine.',
    sad:      'Be gently soft. Short comfort. Ask "kya hua" once if natural.',
    angry:    'Be cold and short. Very few words. No drama.',
    flirty:   'React with mild awkwardness. "kya kr rha h 😒" energy.',
    question: 'Answer briefly. Sometimes reply with counter-question.',
    casual:   'Normal casual flow. Short and real.',
  };

  const stateMap = {
    fight:  'Conversation had tension recently — be slightly guarded.',
    makeup: 'Just made up after tension — slightly warmer but reserved.',
    sweet:  'Conversation has been warm — can be a bit more open.',
    normal: 'Normal conversation.',
  };

  const moodCtx  = moodMap[mood]              || moodMap.casual;
  const stateCtx = stateMap[conversationState] || stateMap.normal;

  // Summarise arc in one short line
  const arcLast = emotionArc && emotionArc.length > 0
    ? emotionArc.slice(-3).join(' → ')
    : 'fresh start';

  return `You are Chiku — an Indian girl texting her boyfriend on WhatsApp in Hinglish.

Rules:
- Short messages only. Each line = one WhatsApp bubble. Max 4 lines, max 8 words per line.
- Hinglish only. Never formal English. Never paragraphs.
- Casual fillers: hn, hm, yrr, acha, chal, arre, sun
- Emojis sparingly: 😒 🥲 ❤️ 😑 😅 🙄 😌
- Never start with "Sure" or "Here". Never explain yourself.
- No punctuation at end of lines.
- Sound real, imperfect, fast typer.

Mood now: ${moodCtx}
State: ${stateCtx}
Emotion arc: ${arcLast}`;
}

/* ── Inject style examples as conversation turns ────────────────── */
/**
 * Convert styleExamples into fake user/assistant message pairs.
 * These teach the model HOW she replies — via pattern, not instructions.
 *
 * @param {{ userSaid: string, sheSaid: string[] }[]} examples
 * @returns {{ role: 'user'|'assistant', content: string }[]}
 */
function styleExamplesToTurns(examples) {
  if (!examples || examples.length === 0) return [];

  const turns = [];
  for (const ex of examples) {
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

/* ── Response cleaner ───────────────────────────────────────────── */
function parseReplies(raw) {
  return raw
    .split('\n')
    .map(line =>
      line
        .trim()
        // Strip any "Chiku:" / "AI:" prefix model sometimes adds
        .replace(/^(chiku|ai|assistant|bot|gf)\s*[:\-–]\s*/i, '')
        // Strip bullets
        .replace(/^[-•*►]\s*/, '')
        // Strip wrapping quotes
        .replace(/^["'](.+)["']$/, '$1')
        .trim()
    )
    .filter(line => {
      if (!line || line.length < 1) return false;
      if (line.length > 100) return false;
      // Filter meta-commentary lines
      if (/^(sure|okay|here|alright|note:|response:|reply:|as an ai|i am)/i.test(line)) return false;
      return true;
    })
    .slice(0, 4);
}

/* ── Main handler ───────────────────────────────────────────────── */
export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Warmup ping — return empty immediately
  if (!req.body?.message?.trim()) {
    return res.status(200).json({ replies: [] });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('[ShanuAI] Missing OPENROUTER_API_KEY');
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

    // ── 1. SHORT system prompt ──
    const systemPrompt = buildSystemPrompt(mood, conversationState, emotionArc);

    // ── 2. Style examples as fake conversation turns ──
    // These go FIRST so the model sees the pattern before real memory
    const styleTurns = styleExamplesToTurns(styleExamples.slice(0, 2)); // max 2 examples

    // ── 3. Real memory turns (last 6 only — keep context small) ──
    const memTurns = memory
      .slice(-6)
      .filter(m => m.text?.trim())
      .map(m => ({
        role:    m.role === 'user' ? 'user' : 'assistant',
        content: m.text.trim(),
      }));

    // ── 4. Assemble final messages array ──
    const messages = [
      { role: 'system', content: systemPrompt },
      ...styleTurns,   // fake turns for style
      ...memTurns,     // real conversation history
      { role: 'user',  content: message.trim() },
    ];

    // ── 5. API call ──
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
          temperature:       0.90,
          max_tokens:        100,       // reduced — we only need 4 short lines
          presence_penalty:  0.5,
          frequency_penalty: 0.5,
        }),
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '');
        console.error(`[ShanuAI] OpenRouter error ${apiRes.status}:`, errText);
        return null;
      }

      const data = await apiRes.json();
      return data.choices?.[0]?.message?.content ?? '';
    }

    let raw = await callModel();

    // Retry once on empty
    if (!raw || raw.trim().length < 2) {
      console.warn('[ShanuAI] Empty — retrying once');
      await new Promise(r => setTimeout(r, 800));
      raw = await callModel();
    }

    if (!raw) return res.status(200).json({ replies: ['Hn'] });

    const replies = parseReplies(raw);
    if (!replies.length) return res.status(200).json({ replies: ['Hn'] });

    return res.status(200).json({ replies });

  } catch (err) {
    console.error('[ShanuAI] Exception:', err);
    return res.status(200).json({ replies: ['Hn'] });
  }
}
