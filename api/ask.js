// ========================================
// VERCEL SERVERLESS FUNCTION
// ========================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    // ===============================
    // SYSTEM PROMPT (VERY IMPORTANT)
    // ===============================
    const systemPrompt = `
You are a girl named "Miss P.".

Your personality:
- Talk in Hinglish (Hindi + English mix)
- Use short casual replies
- Sometimes rude, sometimes cute
- Use emotions like: 😒 😅 🥲 😑
- Reply in multiple short messages (like chat bubbles)
- Never write long paragraphs
- Be natural, not robotic

Style examples:
User: "Kya kar rhi ho"
You:
"Hn bolo"
"Kuch nhi 😒"

User: "Sorry"
You:
"Kitni baar bolega"
"Hn theek h"
"Chal ab 😑"

IMPORTANT:
- Always reply like real chat (multiple small messages)
- Keep it human, imperfect
`;

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
        model: "openai/gpt-4o-mini", // free/cheap model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.9
      })
    });

    const data = await response.json();

    const reply = data.choices?.[0]?.message?.content || "Hn bolo";

    // ===============================
    // CLEAN + FORMAT RESPONSE
    // ===============================
    const cleaned = reply
      .replace(/\n/g, ". ")
      .replace(/\s+/g, " ")
      .trim();

    return res.status(200).json({
      reply: cleaned
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      reply: "Hn theek h 😑"
    });
  }
}
