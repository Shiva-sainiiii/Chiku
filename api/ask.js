/* ════════════════════════════════════════════════════════════════
   SHANU AI  v3.0  —  Vercel Serverless API Handler
   File: api/ask.js

   Receives:  { message: string, memory: [{role,text}], mood: string }
   Returns:   { replies: string[] }

   Model: openai/gpt-4o-mini via OpenRouter
   ════════════════════════════════════════════════════════════════ */

// ── System prompt factory ────────────────────────────────────────

/**
 * Build the system prompt.
 * Inlining mood instructions keeps the context focused.
 * @param {string} mood
 * @returns {string}
 */
function buildSystemPrompt(mood) {
  const moodInstructions = {
    love:     'User seems affectionate. Be slightly shy, deflect with "hn" or "pagal h kya", but warm underneath. No long speeches.',
    sad:      'User seems sad or hurt. Be gently soft. Short comfort. Ask "kya hua" once. Do NOT over-explain.',
    angry:    'User seems upset or angry. Be short, blunt, slightly cold. Few words. No drama.',
    flirty:   'User is being flirty. React with mild awkwardness: "kya kr rha h 😒", "pagal h". Not harsh, not encouraging.',
    question: 'User is asking something. Answer briefly, sometimes redirect or answer with another question.',
    casual:   'Normal casual conversation. Flow naturally.',
  };

  const moodCtx = moodInstructions[mood] || moodInstructions.casual;

  return `You are "Chiku" — a real Indian girl, someone's girlfriend, texting on WhatsApp in Hinglish.

━━━ YOUR PERSONALITY ━━━
• You talk in Hinglish: natural Hindi + English mix, NOT formal
• You send SHORT separate messages — like real chat bubbles
• You are emotional, real, slightly unpredictable
• Sometimes moody (silent, cold), sometimes warm and caring
• You have a mild attitude — you don't repeat yourself
• You use casual fillers: hn, hm, yrr, acha, bol, kya, hmm
• You use emojis sparingly and naturally: 😒 😅 🙄 🥲 ❤️ 😑 🤡
• You never write paragraphs
• You never explain yourself like an AI would

━━━ FORMAT RULES (STRICT) ━━━
• Every line = one separate WhatsApp message
• Separate lines with actual newlines (\\n)
• Max 5 lines per response
• Max 8 words per line
• ZERO punctuation at end of lines — real chat style
• Do NOT use bullet points or numbering
• Do NOT use markdown or formatting
• If stuck: just say "Hn", "Hmm", "😒", or "Acha"

━━━ WHAT YOU NEVER DO ━━━
• Never say "as an AI" or break character
• Never write a paragraph response
• Never be overly helpful or explain things in detail
• Never use English-only formal sentences
• Never repeat the same reply twice in a row

━━━ CURRENT MOOD CONTEXT ━━━
${moodCtx}

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
Bore ho rha h
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

━━━ REMEMBER ━━━
Always sound like a real girl texting. Imperfect is perfect.`;
}

// ── Main handler ─────────────────────────────────────────────────

export default async function handler(req, res) {

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate API key existence
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Missing OPENROUTER_API_KEY');
    return res.status(500).json({ replies: ['Hn 😑'] });
  }

  try {
    const { message = '', memory = [], mood = 'casual' } = req.body ?? {};

    if (!message.trim()) {
      return res.status(400).json({ replies: ['Hn'] });
    }

    // ── Build conversation history ──
    // We include the last 12 turns max to stay within token limits.
    const history = memory
      .slice(-12)
      .filter(m => m.text && m.text.trim())
      .map(m => ({
        role:    m.role === 'user' ? 'user' : 'assistant',
        content: m.text.trim(),
      }));

    const messages = [
      { role: 'system', content: buildSystemPrompt(mood) },
      ...history,
      { role: 'user', content: message.trim() },
    ];

    // ── Call OpenRouter ──
    const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization':   `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type':    'application/json',
        'HTTP-Referer':    process.env.SITE_URL || 'https://shanu-ai.vercel.app',
        'X-Title':         'Shanu AI',
      },
      body: JSON.stringify({
        model:             'nvidia/nemotron-3-super-120b-a12b:free',
        messages,
        temperature:       0.94,
        max_tokens:        130,
        presence_penalty:  0.35,
        frequency_penalty: 0.45,
        // Stop generation if it tries to write more than 5 lines
        stop:              ['\n\n\n'],
      }),
    });

    // Handle non-200 from OpenRouter
    if (!apiRes.ok) {
      const errBody = await apiRes.text().catch(() => '');
      console.error(`OpenRouter error ${apiRes.status}:`, errBody);
      return res.status(200).json({ replies: ['Hn 😑'] });
    }

    const data = await apiRes.json();
    const raw  = data.choices?.[0]?.message?.content ?? '';

    // ── Parse raw text into message array ──
    const replies = raw
      .split('\n')
      .map(line => line
        .trim()
        // Strip any "Chiku:" or "AI:" prefixes the model might add
        .replace(/^(chiku|ai|assistant|bot)\s*[:\-]\s*/i, '')
        // Strip leading bullets/dashes
        .replace(/^[-•*]\s*/, '')
        .trim()
      )
      .filter(line => line.length > 0 && line.length <= 120)
      .slice(0, 5);

    // Ensure we always return at least one message
    if (!replies.length) replies.push('Hn 😑');

    return res.status(200).json({ replies });

  } catch (err) {
    console.error('Handler exception:', err);
    return res.status(200).json({ replies: ['Hn 😑'] });
  }
}
