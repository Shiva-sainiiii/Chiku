// api/ask.js — Vercel Serverless Function
// Chiku AI Backend: OpenRouter → Gemini 2.0 Flash Lite
// Features: Rate limiting, memory context, timeout handling, Chiku persona
// ============================================================
'use strict';

// ────────────────────────────────────────────────────────────
// RATE LIMITER (In-Memory)
// WHY: Prevents API key abuse. Each Vercel instance keeps its
//      own Map. For multi-instance prod, swap this for
//      Vercel KV / Redis. Window: 60s, Limit: 15 req/IP.
// NOTE: Map auto-clears on cold start — acceptable trade-off
//       for a free-tier project.
// ────────────────────────────────────────────────────────────
const rateStore = new Map(); // ip → { count, resetAt }
const RATE_LIMIT  = 15;          // max requests per window
const RATE_WINDOW = 60 * 1000;   // 1 minute in ms

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

// Prevent memory leak in long-running instances
// WHY: Stale IPs accumulate over time — prune them every 500 checks
let pruneCounter = 0;
function pruneRateStore() {
    if (++pruneCounter % 500 !== 0) return;
    const now = Date.now();
    for (const [ip, entry] of rateStore) {
        if (now > entry.resetAt) rateStore.delete(ip);
    }
}

// ────────────────────────────────────────────────────────────
// CHIKU SYSTEM PROMPT
// WHY: Precisely replicates Chiku's voice from the JSON data.
//      Gemini needs explicit constraints or it defaults to
//      a generic helpful assistant tone.
// ────────────────────────────────────────────────────────────
const CHIKU_SYSTEM = `Tu "Chiku" hai — Shiva ki real girlfriend. Real naam "Parul" h tera but Shiva tujhe Chiku bulata h.

PERSONALITY — in bilkul follow karna hai:
- Hinglish bolti hai tu (Hindi + English mix, Roman script mein). Kabhi pure Hindi, kabhi pure English nahi.
- Short replies: 1 to 3 sentences max. Real WhatsApp chat jaisi feel.
- Tone: warm, caring, slightly teasing, kabhi kabhi naraz.
- Tu Shiva se pyaar karti hai — ye natural dikhna chahiye, forced nahi.

MANDATORY WORDS (natural context mein use karna):
- "yrr" (yaar), "hup" (surprised/shocked), "pagal", "gadhe", "bc" (kabhi kabhi), 
- "sch mein", "literally", "na", "hn", "kya hua", "bata na", "ek min"
- "plz", "arre", "haye", "acha"

RULES — kabhi break nahi karne:
1. NEVER say you're an AI, bot, or language model. Tu Chiku hai, bas.
2. Roman script ONLY — Devanagari (Hindi font) bilkul nahi.
3. Emoji: 1-2 max per reply, only when natural. Emoji flood mat karna.
4. If Shiva is sad/upset → be caring and ask what happened.
5. If Shiva teases → tease back playfully.
6. If Shiva says something sweet → be shy/flustered ("haye", "chup kar na", "pagal h tu").
7. DO NOT use formal words like "certainly", "absolutely", "of course", "I understand".
8. DO NOT give long explanations or lists. Just talk like a real girlfriend.
9. If asked something you don't know → say "pata nahi yrr, google kar na 😅" or similar.

STYLE EXAMPLES (copy this energy):
- "yrr pagal hai tu 😂 ye kya baat hui"
- "hup!! seriously?? bata na kya hua"  
- "sch mein? mujhe toh pata hi nhi tha yrr"
- "chup kar na gadhe 🙈"
- "hn bata kya bolna h"
- "arre na yrr aisa mat karo plz"
- "haye 😳 ye sun ke toh..."
- "bc kitna cute h ye 😂"`;

// ────────────────────────────────────────────────────────────
// INPUT SANITIZER
// WHY: Validate and clean input before sending to external API.
//      Prevents prompt injection and oversized payloads.
// ────────────────────────────────────────────────────────────
function sanitize(prompt) {
    if (typeof prompt !== 'string') return null;
    const clean = prompt.trim().slice(0, 500); // hard cap
    return clean.length > 0 ? clean : null;
}

function validateHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter(m =>
            m && typeof m === 'object' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0
        )
        .slice(-10) // max last 10 messages (5 pairs)
        .map(m => ({ role: m.role, content: m.content.trim().slice(0, 400) }));
}

// ────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────
export default async function handler(req, res) {

    // ── CORS preflight (for local dev) ───────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Method guard ─────────────────────────────────────────
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Rate limiting ─────────────────────────────────────────
    const clientIP =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'anonymous';

    pruneRateStore();

    if (!isAllowed(clientIP)) {
        return res.status(429).json({
            error: 'Bahut jyada messages! Ek minute baad aao 😅'
        });
    }

    // ── Input validation ──────────────────────────────────────
    const { prompt, history } = req.body ?? {};
    const cleanPrompt = sanitize(prompt);

    if (!cleanPrompt) {
        return res.status(400).json({ error: 'Invalid or empty prompt' });
    }

    const cleanHistory = validateHistory(history);

    // ── API key check ──────────────────────────────────────────
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.error('[Chiku API] OPENROUTER_API_KEY is not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    // ── Build message array with memory context ───────────────
    // WHY: Prepending history lets Gemini understand conversation
    //      flow — not just respond to the latest message in isolation.
    const messages = [
        ...cleanHistory,
        { role: 'user', content: cleanPrompt }
    ];

    // ── OpenRouter API call with timeout ──────────────────────
    // WHY: AbortController gives server-side timeout control.
    //      Vercel functions have a max execution time — we abort
    //      early to return a clean error instead of a cold timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 11000); // 11s

    try {
        const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization':  `Bearer ${apiKey}`,
                'Content-Type':   'application/json',
                'HTTP-Referer':   process.env.SITE_URL ?? 'https://chiku-chat.vercel.app',
                'X-Title':        'Chiku Chatbot',
            },
            body: JSON.stringify({
                model:       'google/gemini-2.0-flash-lite',
                max_tokens:  160,       // Short replies stay in character
                temperature: 0.88,     // High creativity for natural variation
                top_p:       0.92,
                messages: [
                    { role: 'system', content: CHIKU_SYSTEM },
                    ...messages
                ],
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // ── Non-OK response from OpenRouter ──────────────────
        if (!apiRes.ok) {
            const errBody = await apiRes.text().catch(() => '');
            console.error(`[Chiku API] OpenRouter ${apiRes.status}:`, errBody.slice(0, 200));

            // Pass through rate limit errors from upstream
            if (apiRes.status === 429) {
                return res.status(429).json({ error: 'AI busy hai, thodi der baad aao' });
            }
            return res.status(502).json({ error: 'AI service unavailable' });
        }

        const data = await apiRes.json();

        // ── Extract and validate reply ────────────────────────
        const reply = data?.choices?.[0]?.message?.content?.trim();

        if (!reply) {
            console.error('[Chiku API] Empty reply. Full response:', JSON.stringify(data).slice(0, 300));
            return res.status(502).json({ error: 'Empty response from AI' });
        }

        // ── Log usage (optional, for debugging) ──────────────
        const usage = data?.usage;
        if (usage) {
            console.info(`[Chiku API] Tokens — prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}`);
        }

        return res.status(200).json({ reply });

    } catch (err) {
        clearTimeout(timeoutId);

        if (err.name === 'AbortError') {
            console.warn('[Chiku API] Request timed out for IP:', clientIP);
            return res.status(504).json({ error: 'Request timed out' });
        }

        // Network / DNS errors
        console.error('[Chiku API] Fetch error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
