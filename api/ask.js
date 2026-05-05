export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { prompt } = req.body;
    const API_KEY = process.env.OPENROUTER_API_KEY; // Vercel Env Variable

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "nvidia/nemotron-3-super-120b-a12b:free",
                messages: [
                    { 
                        role: "system", 
                        content: "You are a friendly Indian girlfriend. Use Hinglish with words like 'tu', 'yaar', 'pagal', 'hup'. Keep replies short and natural." 
                    },
                    { role: "user", content: prompt }
                ]
            })
        });

        const data = await response.json();
        const reply = data.choices[0].message.content;
        
        res.status(200).json({ reply });
    } catch (error) {
        res.status(500).json({ error: "API call failed" });
    }
              }
          
