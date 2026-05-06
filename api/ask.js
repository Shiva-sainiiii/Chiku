// api/ask.js — Vercel Serverless Function v4.2
// Fixed: AI yapping/explanations removed. 
// Features: Rate-limiting, Chain-of-Thought Sanitizer, and Strict RAG.
'use strict';

// ────────────────────────────────────────────────────────────
// 1. RATE LIMITER (Security)
// ────────────────────────────────────────────────────────────
const rateStore = new Map();
const RATE_LIMIT  = 30; // Max 30 requests per minute
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

// ────────────────────────────────────────────────────────────
// 2. RESPONSE SANITIZER
// Strip leaked reasoning (e.g. "Based on context...", "Chiku should say...")
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
    /^(must|should)\s+(shut|respond|reply|maintain|keep)/i,
    /^(the actual reply|the response|my response)\s*(is|should|will|:)/i,
    /\b(the user|chiku's persona|established persona|prior pattern)\b/i,
    /\bexamples show\b/i,
];

function sanitizeReply(raw) {
    if (!raw) return null;
    let text = raw.trim();

    // Remove XML tags like <think> or <reasoning>
    text = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');

    const lines = text.split('\n');
    const cleanLines = lines.filter(line => {
        const l = line.trim();
        if (l.length < 2) return false;
        // Check if line matches reasoning patterns
        const isReasoning = REASONING_SIGNALS.some(p => p.test(l));
        // Reject meta-language about the persona
        const isMeta = /\b(the user|chiku's|the response|the reply|prior pattern|examples show|persona)\b/i.test(l);
        return !isReasoning && !isMeta;
    });

    // If nothing left, take the last non-empty line of original (usually the actual reply)
    if (cleanLines.length === 0) {
        const filtered = lines.map(l => l.trim()).filter(l => l.length > 2);
        return filtered.length > 0 ? filtered[filtered.length - 1] : null;
    }

    return cleanLines.join(' ').trim();
}

const FALLBACK_REPLIES = [
    "Hmm... kya bola? 😂",
    "Acha? Sach mein? 🙈",
    "Pagal h kya? hup",
    "Net thoda slow h mera, ruk ja 🌸",
    "Sun na, baad mein baat karein? busy hu thoda"
];

// ────────────────────────────────────────────────────────────
// 3. MAIN HANDLER (The API Logic)
// ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    // 1. CORS & Methods
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Post only' });

    // 2. Rate Limit Check
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon';
    if (!isAllowed(ip)) {
        return res.status(429).json({ reply: "Arey ruk ja! Itni jaldi kya h? 🌸" });
    }

    const { userQuery, cleanExamples } = req.body;

    if (!userQuery) return res.status(400).json({ error: 'Missing query' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000); // 12s timeout

    try {
        // AI Model Instruction
        const systemPrompt = `
        CRITICAL: You are Chiku, Shiva's girlfriend. 
        - NEVER explain your thinking or use phrases like "Based on examples".
        - NEVER output reasoning, analysis, or context notes.
        - NEVER use "I", "Certainly", "I understand".
        - Keep replies in Hinglish (Roman script), very short (1-5 words).
        - Respond ONLY with the direct message.
        - Tone: Emotional, casual, playful, uses lowercase mostly.
        `;

        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        // Add RAG examples (Real Chat History)
        if (cleanExamples && cleanExamples.length > 0) {
            cleanExamples.forEach(ex => {
                messages.push({ role: 'user', content: ex.u });
                messages.push({ role: 'assistant', content: ex.g });
            });
        }

        // Add Current Query
        messages.push({ role: 'user', content: userQuery });

        const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://chiku-iota.vercel.app',
            },
            body: JSON.stringify({
                model: 'nvidia/nemotron-3-super-120b-a12b:free', // Fast model, no thinking bloat
                messages: messages,
                max_tokens: 35, // Physically prevents long explanations
                temperature: 0.85,
                top_p: 0.9,
                presence_penalty: 0.6
            }),
            signal: controller.signal
        });

        clearTimeout(timer);

        if (!apiRes.ok) {
            console.error('[Chiku] API Error:', apiRes.status);
            return res.status(200).json({ reply: FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)] });
        }

        const data = await apiRes.json();
        const rawReply = data?.choices?.[0]?.message?.content?.trim();

        // 4. Final Cleanup
        const reply = sanitizeReply(rawReply);

        if (!reply) {
            const fallback = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
            return res.status(200).json({ reply: fallback });
        }

        return res.status(200).json({ reply });

    } catch (err) {
        clearTimeout(timer);
        console.error('[Chiku] Server Error:', err.message);
        return res.status(200).json({ reply: "Arey yrr, network issue h side se... 🙈" });
    }
    }
