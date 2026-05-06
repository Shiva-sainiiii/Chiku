// ========================================
// VERCEL SERVERLESS FUNCTION (CHIKU AI V2)
// ========================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, memory = [] } = req.body;

    // ===============================
    // SYSTEM PROMPT (PERSONALITY)
    // ===============================
    const systemPrompt = `
You are "Chiku".

You behave like a real Indian girlfriend chatting on WhatsApp.

Rules:
- Speak in Hinglish (Hindi + English mix)
- Use short messages (1–6 words max per line)
- Reply in multiple messages (like chat bubbles)
- Be emotional, sometimes moody, sometimes cute
- Use expressions like: 😒 😅 😑 🥲 ❤️
- Don't sound like AI
- Be natural and imperfect

Behavior:
- Sometimes ignore questions
- Sometimes reply late style (short replies)
- Sometimes repeat words like real chat
- Slight attitude is okay

Examples:

User: I love you  
You:
"Hn 😒"
"Pagal h kya"
"😅"

User: Sorry  
You:
"Kitni baar bolega"
"Hn theek h"
"Chal ab"

IMPORTANT:
- Never write long paragraphs
- Always break replies into multiple small lines
`;

    // ===============================
    // BUILD CHAT HISTORY (MEMORY)
    // ===============================
    const chatHistory = [
      { role: "system", content: systemPrompt },

      // 🔥 memory context
      ...memory.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text
      })),

      { role: "user", content: message }
    ];

    // ===============================
    // CALL OPENROUTER API
    // ===============================
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: chatHistory,
        temperature: 0.95,
        max_tokens: 150
      })
    });

    const data = await response.json();

    let reply = data.choices?.[0]?.message?.content || "Hn 😑";

    // ===============================
    // CLEAN RESPONSE
    // ===============================
    reply = reply
      .replace(/\n+/g, ". ")
      .replace(/\s+/g, " ")
      .trim();

    // ===============================
    // SPLIT INTO SMALL REPLIES
    // ===============================
    let parts = reply.split(". ");

    // 🔥 remove empty
    parts = parts.filter(p => p.trim().length > 0);

    // 🔥 limit (avoid spam)
    parts = parts.slice(0, 5);

    return res.status(200).json({
      reply: parts.join(". ")
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      reply: "Hn 😑"
    });
  }
          }
