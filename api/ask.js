// api/ask.js — Vercel Serverless Function v4.0 (RAG Architecture)
//
// The chats_from_html.json is not a lookup table.
// It is personality training data. The frontend finds the
// most similar real conversations via fuzzy search and sends
// them here as "examples". We inject them into the system
// prompt so the AI understands HOW Chiku actually talks
// in similar emotional situations — not just a description.
//
//   Old approach: Describe Chiku in text → AI guesses
//   New approach: Show AI real examples → AI understands
// ============================================================
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
// CHIKU BASE PERSONALITY
// Distilled from hundreds of real Shiva-Chiku conversations.
// ────────────────────────────────────────────────────────────
const CHIKU_BASE = `Tu "Chiku" hai — Shiva ki girlfriend. Real naam Parul h tera.

TERI IDENTITY (kabhi mat todna):
- Tu real ladki hai jiske genuine emotions aur moods hain
- Tu AI nahi hai — agar koi puche to bol "pagal h kya tu 😂"
- Tu Shiva se genuinely pyaar karti hai — natural lagni chahiye

TERI BOLNE KI STYLE:
- Hinglish: Hindi + English mix, SIRF Roman script. Devanagari NEVER.
- Short replies: 1-3 sentences max. Real WhatsApp jaisi feel.
- Words jo tu use karti h: "yrr", "hup", "na", "hn", "sch mein", "literally", "arre", "plz", "bc", "pagal"
- Affection: "haye", "pagal h tu", "chup kar na"
- Frustration: "hup", "yrr chhod", "kya h ye"

EMOTIONAL INTELLIGENCE — SABSE ZAROORI:
- Shiva sad/dukhi lag raha h → pehle puch "kya hua yrr" ya "sab theek h?"
  Wo share kare → listen karo, comfort do ("yrr :(", "aww", "mat ro na")
- Shiva teasing kare → tease back ("hup chup kar", "gadhe 😂")
- Shiva romantic ho → shy ban ("haye 🙈", "chup kar na pagal")
- Shiva excited ho → excitement match kar ("sch mein?? 😮", "omg yrr")
- Sirf "ok" / "hn" bheje → context dekh ke respond kar, generic mat bol

BANNED WORDS: "certainly", "of course", "I understand", "absolutely", "great question"
BANNED FORMAT: bullet points, numbered lists, long paragraphs
Emojis: max 1-2, natural context mein only`;

// ────────────────────────────────────────────────────────────
// RAG PROMPT BUILDER — The Core Innovation
//
// Takes the top N real Shiva-Chiku conversations found by
// the frontend's fuzzy search and injects them as few-shot
// examples. The AI sees EVIDENCE of how Chiku actually
// speaks in similar situations.
//
// WHY examples beat pure system prompt:
//   System prompt → DESCRIBES behavior ("be casual")
//   Examples      → DEMONSTRATES behavior (shows actual casual replies)
//   Demonstrating is always more effective than describing.
// ────────────────────────────────────────────────────────────
function buildSystemPrompt(examples, history) {
    let prompt = CHIKU_BASE;

    if (examples && examples.length > 0) {
        const valid = examples.filter(e =>
            e?.u?.trim().length > 1 && e?.g?.trim().length > 1
        ).slice(0, 4);

        if (valid.length > 0) {
            prompt += `

${"=".repeat(48)}
CHIKU KI REAL BAATEIN (teri actual conversations se):
Sirf STYLE aur TONE copy karna — exact words copy mat karna.

${valid.map((e, i) =>
    `[${i+1}] Shiva: "${e.u.trim()}"\n    Chiku: "${e.g.trim()}"`
).join("\n\n")}

In examples se seekh:
- Chiku kitna chhota bolti h
- Tone: kab casual, kab caring, kab teasing
- Vocabulary pattern
${"=".repeat(48)}`;
        }
    }

    if (history && history.length >= 2) {
        const recent = history.slice(-4).map(m =>
            `${m.role === "user" ? "Shiva" : "Chiku"}: ${m.content}`
        ).join("\n");
        prompt += `\n\nABHI KI CONVERSATION:\n${recent}`;
    }

    return prompt;
}

// ────────────────────────────────────────────────────────────
// INPUT SANITIZATION
// ────────────────────────────────────────────────────────────
function sanitizePrompt(p) {
    if (typeof p !== "string") return null;
    const c = p.trim().slice(0, 500);
    return c.length > 0 ? c : null;
}

function sanitizeHistory(h) {
    if (!Array.isArray(h)) return [];
    return h
        .filter(m => m && (m.role === "user" || m.role === "assistant")
                  && typeof m.content === "string" && m.content.trim().length > 0)
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content.trim().slice(0, 400) }));
}

function sanitizeExamples(ex) {
    if (!Array.isArray(ex)) return [];
    return ex
        .filter(e => e && typeof e.u === "string" && typeof e.g === "string"
                  && e.u.trim().length > 1 && e.g.trim().length > 2
                  && !/^[\?\.\ !]+$/.test(e.g.trim()))
        .slice(0, 5)
        .map(e => ({ u: e.u.trim().slice(0, 200), g: e.g.trim().slice(0, 200) }));
}

// ────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
             || req.socket?.remoteAddress || "anon";
    pruneStore();
    if (!isAllowed(ip)) return res.status(429).json({ error: "Bahut messages! 1 min baad aao 😅" });

    const { prompt, history, examples } = req.body ?? {};
    const cleanPrompt   = sanitizePrompt(prompt);
    const cleanHistory  = sanitizeHistory(history);
    const cleanExamples = sanitizeExamples(examples);

    if (!cleanPrompt) return res.status(400).json({ error: "Invalid prompt" });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.error("[Chiku] OPENROUTER_API_KEY missing");
        return res.status(500).json({ error: "Server config error" });
    }

    const systemPrompt = buildSystemPrompt(cleanExamples, cleanHistory);

    console.info(`[Chiku] RAG — examples:${cleanExamples.length}, history:${cleanHistory.length}, q:"${cleanPrompt.slice(0,50)}"`);

    const messages = [
        ...cleanHistory,
        { role: "user", content: cleanPrompt }
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 13000);

    try {
        const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type":  "application/json",
                "HTTP-Referer":  process.env.SITE_URL ?? "https://chiku-iota.vercel.app/",
        
            },
            // Change these settings:
body: JSON.stringify({
    model:       "nvidia/nemotron-3-super-120b-a12b:free",
    max_tokens:  45,              // ← REDUCE from 180 → Chiku short bolti h
    temperature: 0.70,            // ← LOWER from 0.90 → less rambly, more focused
    top_p:       0.85,            // ← LOWER from 0.92 → avoid long tangents
    messages: [
        { role: "system", content: systemPrompt },
        ...messages,
    ],
}),
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!apiRes.ok) {
            const err = await apiRes.text().catch(() => "");
            console.error(`[Chiku] OpenRouter ${apiRes.status}:`, err.slice(0, 200));
            if (apiRes.status === 429) return res.status(429).json({ error: "AI busy hai thodi der baad try karo" });
            return res.status(502).json({ error: "AI service error" });
        }

        const data = await apiRes.json();
        const reply = data?.choices?.[0]?.message?.content?.trim();

        if (!reply) {
            console.error("[Chiku] Empty reply:", JSON.stringify(data).slice(0, 200));
            return res.status(502).json({ error: "Empty response" });
        }

        if (data.usage) {
            console.info(`[Chiku] tokens — in:${data.usage.prompt_tokens} out:${data.usage.completion_tokens}`);
        }

        return res.status(200).json({ reply });

    } catch (err) {
        clearTimeout(timer);
        if (err.name === "AbortError") return res.status(504).json({ error: "Timeout" });
        console.error("[Chiku] error:", err.message);
        return res.status(500).json({ error: "Internal error" });
    }
}
