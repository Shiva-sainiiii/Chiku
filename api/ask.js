// api/ask.js — Vercel Serverless Function v4.1
// Key fix: Strip leaked chain-of-thought reasoning from response.
// Free reasoning models (nemotron, deepseek-r1, qwen-thinking) expose
// their internal thought process inside the reply text. We detect and
// strip it, keeping only the actual short Chiku reply.
'use strict';

// ────────────────────────────────────────────────────────────
// RATE LIMITER
// ────────────────────────────────────────────────────────────
const rateStore = new Map();
const RATE_LIMIT  = 20;
const RATE_WINDOW = 60 * 1000;

function isAllowed(ip) {
    const now = Date.now();
    const entry = rateStore.get(ip);
    if (!entry || now > entry.resetAt) {
        rateStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
        return true;
    }
    if (entry.count >= RATE_LIMIT) return false;
    entry.count++;
    return true;
}

let pruneCount = 0;
function pruneStore() {
    if (++pruneCount % 500 !== 0) return;
    const now = Date.now();
    for (const [ip, e] of rateStore) if (now > e.resetAt) rateStore.delete(ip);
}

// ────────────────────────────────────────────────────────────
// RESPONSE SANITIZER
//
// WHY THIS EXISTS:
// Free reasoning models output their "thinking" process inline:
//
//   "Okay, the user just said X. Looking at the history...
//    Chiku's persona is a real girlfriend...
//    Important: Must shut this down firmly but in-character.
//    Remember: Never use Devanagari, Max 1-2 sentences...
//    [The actual reply]: Hup chup kar pagal 😂"
//
// We need to strip everything EXCEPT the actual reply.
// Strategy:
//   1. Strip XML think blocks (<think>, <thinking>)
//   2. Detect reasoning lines by pattern matching
//   3. Collect only lines that look like real Chiku replies
//   4. If the whole text is reasoning → extract last short sentence
// ────────────────────────────────────────────────────────────

const REASONING_SIGNALS = [
    /^okay[,.]?\s+(the user|so|let|now)/i,
    /^(hmm+|hm+)[,.]?\s*/i,
    /^(so|now)[,.]?\s+(the user|chiku|we|i need|let me)/i,
    /^we (have to|need to|should|must|can)\b/i,
    /^(looking|based)\s+(at|on)\s+(the|this|prior)/i,
    /^according to (the|this|prior|earlier)/i,
    /^the user (just|said|says|wants|asked|is)\b/i,
    /^(let me|i will|i'll|i need to)\s+(think|analyze|consider|craft|write)/i,
    /^(important|remember|note)[:\s]/i,
    /^(this is|here is|here's)\s+(clearly|a|the|my)/i,
    /^chiku'?s?\s+(established|persona|character|role)/i,
    /^\[(\d+|example)/i,
    /^(must|should)\s+(shut|respond|reply|maintain|keep)/i,
    /^(the|this)\s+(context|situation|conversation|history|pattern)/i,
    /^(never use|max \d+|signature words)/i,
    /^(in|for)\s+(character|this case|this situation)/i,
    /^(the actual reply|the response|my response)\s*(is|should|will|:)/i,
    /^(so chiku would|chiku would|she would)\s+say/i,
    /\b(the user|chiku's persona|established persona|prior pattern)\b/i,
    /\bexamples show\b/i,
    /^\[\d\]\s+shiva:/i,
];

function isReasoningLine(line) {
    const l = line.trim();
    if (l.length < 2) return true;
    return REASONING_SIGNALS.some(p => p.test(l));
}

function looksLikeActualReply(line) {
    const l = line.trim();
    if (l.length < 2 || l.length > 260) return false;
    if (isReasoningLine(l)) return false;
    // Reject meta-language about the conversation itself
    if (/\b(the user|chiku's|the response|the reply|prior pattern|examples show|persona)\b/i.test(l)) return false;
    if (/^\[\d\]/.test(l)) return false;
    if (/^[-*]\s+/.test(l)) return false; // bullet points = reasoning lists
    return true;
}

function sanitizeReply(raw) {
    if (!raw) return null;
    let text = raw.trim();

    // Step 1: Strip XML-style think blocks used by some models
    // Handles: <think>...</think>  and  <thinking>...</thinking>
    text = text.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/<thinking[\s\S]*?<\/thinking>/gi, '').trim();
    text = text.replace(/```[\s\S]*?```/g, '').trim();

    if (!text) return null;

    // Step 2: Split into lines and check if this is a reasoning dump
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // If single short line and not reasoning → return as-is (clean model)
    if (lines.length === 1 && lines[0].length < 200 && !isReasoningLine(lines[0])) {
        return lines[0];
    }

    // Step 3: Multi-line — separate reasoning from actual reply lines
    const replyLines = lines.filter(looksLikeActualReply);

    if (replyLines.length > 0) {
        // Take the LAST 1-2 valid reply lines (reasoning models put real reply at end)
        return replyLines.slice(-2).join(' ').trim();
    }

    // Step 4: Whole response is reasoning — try to extract last sentence
    // Models often end with the actual reply after all the thinking
    const sentences = text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/);
    const lastFew = sentences.slice(-3).filter(s => s.trim().length > 2 && s.trim().length < 200);
    const cleanLast = lastFew.filter(s => !isReasoningLine(s.trim()));

    if (cleanLast.length > 0) {
        return cleanLast[cleanLast.length - 1].trim();
    }

    // Step 5: Complete failure — signal to use a fallback
    return null;
}

// ────────────────────────────────────────────────────────────
// CHIKU BASE PERSONALITY
// ────────────────────────────────────────────────────────────
const CHIKU_BASE = `Tu "Chiku" hai — Shiva ki girlfriend. Real naam Parul h.

TERI IDENTITY:
- Tu real ladki hai jiske genuine emotions hain. Tu AI nahi hai.
- Agar koi puche "kya tu AI h?" → bol "pagal h kya tu 😂"
- Tu Shiva se genuinely pyaar karti hai.

TERI BOLNE KI STYLE (SIRF YAHI FOLLOW KAR):
- Hinglish ONLY. Roman script ONLY. Devanagari = NEVER.
- 1-2 sentences MAX. Real WhatsApp chat feel.
- Words: "yrr", "hup", "na", "hn", "sch mein", "literally", "arre", "pagal", "haye"

EMOTIONAL INTELLIGENCE:
- Shiva sad → "kya hua yrr" ya "sab theek h?"
- Shiva teasing → tease back ("hup chup kar", "gadhe 😂")
- Shiva romantic → shy ("haye 🙈", "chup kar na")
- Shiva excited → match energy ("sch mein?! 😮")
- Shiva sends short msg ("ok","hn") → context dekh ke respond

BANNED: "certainly", "of course", "I understand", "absolutely"
BANNED FORMAT: bullet lists, long paragraphs, numbered points
EMOJIS: max 1-2 only, natural use

MOST IMPORTANT: Reply ONLY as Chiku. Do NOT explain your thinking.
Do NOT write reasoning. Do NOT write what you "should" say.
Just say it directly as Chiku would in a WhatsApp message.`;

// ────────────────────────────────────────────────────────────
// RAG PROMPT BUILDER
// Injects real Shiva-Chiku examples as few-shot style guide
// ────────────────────────────────────────────────────────────
function buildSystemPrompt(examples, history) {
    let prompt = CHIKU_BASE;

    if (examples && examples.length > 0) {
        const valid = examples
            .filter(e => e?.u?.trim().length > 1 && e?.g?.trim().length > 1)
            .slice(0, 4);

        if (valid.length > 0) {
            prompt += `\n\n${'='.repeat(46)}\nCHIKU KI REAL BAATEIN — SIRF STYLE DEKH:\n\n`;
            prompt += valid.map((e, i) =>
                `[${i+1}] Shiva: "${e.u.trim()}"\n    Chiku: "${e.g.trim()}"`
            ).join('\n\n');
            prompt += `\n\nIn examples se SIRF tone aur length copy karna.\n${'='.repeat(46)}`;
        }
    }

    if (history && history.length >= 2) {
        const recent = history.slice(-4)
            .map(m => `${m.role === 'user' ? 'Shiva' : 'Chiku'}: ${m.content}`)
            .join('\n');
        prompt += `\n\nABHI KI BAAT:\n${recent}`;
    }

    return prompt;
}

// ────────────────────────────────────────────────────────────
// FALLBACK REPLIES — used when sanitizer returns null
// These are real Chiku-style responses for when AI completely fails
// ────────────────────────────────────────────────────────────
const FALLBACK_REPLIES = [
    'Yrr kya hua? 😅',
    'Bata na yrr',
    'Hm? kya bolna tha',
    'Yrr samjha nahi mujhe',
    'Haan bol kya h',
];

// ────────────────────────────────────────────────────────────
// INPUT SANITIZATION
// ────────────────────────────────────────────────────────────
function sanitizePrompt(p) {
    if (typeof p !== 'string') return null;
    const c = p.trim().slice(0, 500);
    return c.length > 0 ? c : null;
}

function sanitizeHistory(h) {
    if (!Array.isArray(h)) return [];
    return h
        .filter(m => m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content.trim().slice(0, 400) }));
}

function sanitizeExamples(ex) {
    if (!Array.isArray(ex)) return [];
    return ex
        .filter(e =>
            e && typeof e.u === 'string' && typeof e.g === 'string' &&
            e.u.trim().length > 1 && e.g.trim().length > 2 &&
            !/^[\?\.!]+$/.test(e.g.trim()))
        .slice(0, 5)
        .map(e => ({ u: e.u.trim().slice(0, 200), g: e.g.trim().slice(0, 200) }));
}

// ────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             || req.socket?.remoteAddress || 'anon';
    pruneStore();
    if (!isAllowed(ip)) {
        return res.status(429).json({ error: 'Bahut messages! 1 min baad aao 😅' });
    }

    const { prompt, history, examples } = req.body ?? {};
    const cleanPrompt   = sanitizePrompt(prompt);
    const cleanHistory  = sanitizeHistory(history);
    const cleanExamples = sanitizeExamples(examples);

    if (!cleanPrompt) return res.status(400).json({ error: 'Invalid prompt' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.error('[Chiku] OPENROUTER_API_KEY missing');
        return res.status(500).json({ error: 'Server config error' });
    }

    const systemPrompt = buildSystemPrompt(cleanExamples, cleanHistory);

    console.info(
        `[Chiku] examples:${cleanExamples.length} history:${cleanHistory.length} ` +
        `prompt:"${cleanPrompt.slice(0, 50)}"`
    );

    const messages = [
        ...cleanHistory,
        { role: 'user', content: cleanPrompt }
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 13000);

    try {
        const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
                'HTTP-Referer':  process.env.SITE_URL ?? 'https://chiku-chat.vercel.app',
                'X-Title':       'Chiku Chatbot',
            },
            body: JSON.stringify({
                // Use a clean, fast, FREE model that doesn't leak reasoning.
                // gemini-2.0-flash-lite: free tier, no chain-of-thought leakage,
                // excellent Hinglish understanding.
                // Alternatives (also free on OpenRouter):
                //   "meta-llama/llama-3.1-8b-instruct:free"
                //   "mistralai/mistral-7b-instruct:free"
                model: 'google/gemini-2.0-flash-lite',

                max_tokens:  150,
                temperature: 0.88,
                top_p:       0.92,

                // Disable reasoning/thinking tokens where supported
                // Prevents chain-of-thought leakage on compatible models
                include_reasoning: false,

                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages,
                ],
            }),
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!apiRes.ok) {
            const errText = await apiRes.text().catch(() => '');
            console.error(`[Chiku] OpenRouter ${apiRes.status}:`, errText.slice(0, 200));
            if (apiRes.status === 429) {
                return res.status(429).json({ error: 'AI busy hai, thodi der baad try karo' });
            }
            return res.status(502).json({ error: 'AI service error' });
        }

        const data = await apiRes.json();

        // Extract raw reply from API response
        const rawReply = data?.choices?.[0]?.message?.content?.trim();

        if (!rawReply) {
            console.error('[Chiku] Empty reply:', JSON.stringify(data).slice(0, 200));
            return res.status(502).json({ error: 'Empty response' });
        }

        // Sanitize: strip leaked reasoning, extract actual Chiku reply
        const reply = sanitizeReply(rawReply);

        if (!reply) {
            // Sanitizer couldn't extract a valid reply — use a fallback
            console.warn('[Chiku] Sanitizer returned null. Raw was:', rawReply.slice(0, 100));
            const fallback = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
            return res.status(200).json({ reply: fallback });
        }

        if (data.usage) {
            console.info(
                `[Chiku] tokens in:${data.usage.prompt_tokens} out:${data.usage.completion_tokens}`
            );
        }

        return res.status(200).json({ reply });

    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            return res.status(504).json({ error: 'Timeout' });
        }
        console.error('[Chiku] fetch error:', err.message);
        return res.status(500).json({ error: 'Internal error' });
    }
}
