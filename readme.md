# Chiku 💕 — AI Girlfriend Chatbot

A privacy-first, **hybrid AI chatbot** that combines local fuzzy-search with cloud AI to deliver authentic, emotionally-aware conversations. Chiku learns her personality from real conversations and responds with genuine warmth, not robotic politeness.

**Live Demo:** [chiku-iota.vercel.app](https://chiku-iota.vercel.app)

---

## 🎯 What Makes Chiku Different?

### 1. **Hybrid Local-First Architecture**
- **Local fuzzy search** on 100+ real Shiva-Chiku conversations (instant, private, no API cost)
- **AI fallback** only when no good match is found (fast 95% of the time, intelligent 5% of the time)
- Zero data leakage — conversation context never leaves your device unless needed

### 2. **RAG-Powered Personality Engine**
Instead of describing behavior, Chiku shows examples:
```
❌ OLD: "Be casual, use Hinglish, keep replies short"
✅ NEW: AI sees real conversations → learns TONE, PATTERNS, CONTEXT
        → generates fresh replies that sound authentically Chiku
```

### 3. **Emotional Intelligence**
- Detects intent (greeting, question, sad, angry, romantic, etc.)
- Adjusts matching threshold dynamically (greetings < 0.55, emotions > 0.64)
- Maintains conversation context with memory buffer (last 5 exchanges)
- Anti-repetition system prevents bot saying same thing twice

### 4. **Hinglish + WhatsApp Vibes**
- Roman script Hindi-English mix (`"Yrr", "hup", "sch mein", "pagal"`)
- 1-3 sentence max replies — natural chat feel
- Personality emerges from real data, not hardcoded rules

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (HTML + Vanilla JS) — chiku-iota.vercel.app   │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 1. Load chats_from_html.json (100+ real chat)    │  │
│  │ 2. Build fuzzy index + word map                  │  │
│  │ 3. On user message:                              │  │
│  │    - Strip emoji, detect intent                  │  │
│  │    - Fuzzy search across local data              │  │
│  │    - If score ≥ 0.90 → return local reply ✅    │  │
│  │    - If score 0.28–0.89 → find top 4 examples   │  │
│  │    - If no match → fallback to AI                │  │
│  │ 4. Send examples + context to /api/ask           │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬────────────────────────────────┘
                           │ (only 5% of requests)
┌──────────────────────────┴────────────────────────────────┐
│  BACKEND (Vercel Serverless) — /api/ask.js               │
│  ┌───────────────────────────────────────────────────┐   │
│  │ 1. Rate limit (20 req/min per IP)                │   │
│  │ 2. Sanitize prompt + examples                    │   │
│  │ 3. Build system prompt with RAG examples         │   │
│  │ 4. Call OpenRouter (Nemotron free model)         │   │
│  │ 5. Clean response (strip analysis/reasoning)     │   │
│  │ 6. Return reply only (no explanation)            │   │
│  └───────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
         │
         ├─→ OpenRouter API
         │   └─→ nvidia/nemotron-3-super-120b-a12b:free
```

---

## 🚀 Key Features

### **Smart Matching Algorithm**
- **Word indexing** for O(1) candidate lookup
- **Levenshtein distance** for fuzzy matching (limited to 45 chars for perf)
- **Intent boosting** (greeting→greeting +0.10, question→question +0.06, etc.)
- **Length ratio similarity** to favor contextually similar messages

### **Anti-Repetition System**
- Tracks last 25 used responses (FIFO queue)
- Never repeats exact last message
- Blocks garbage responses (`"??"`, `"."`, single chars)

### **Personality Injection (RAG)**
System prompt includes:
- Base personality rules (Hinglish, tone, emoji, banned words)
- Top 4 similar real conversations as few-shot examples
- Recent conversation context (last 4 messages)

### **Performance Optimizations**
- **50 max tokens** → keep replies short & fast
- **0.65 temperature** → less rambling, more focused
- **Client-side timeout: 16s** → graceful fallback
- **Server-side timeout: 13s** → safety net

---

## 📂 Project Structure

```
Chiku/
├── index.html              # Main UI (glassmorphic design)
├── chats_from_html.json    # 100+ real Shiva-Chiku conversations
├── api/
│   └── ask.js              # Vercel serverless function (OpenRouter)
├── readme.md               # This file
└── README.md               # Detailed documentation
```

---

## 🛠️ Setup & Deployment

### **Prerequisites**
- OpenRouter API key ([get one free](https://openrouter.ai))
- Vercel account (for serverless backend)

### **Quick Start**
```bash
# Clone repo
git clone https://github.com/Shiva-sainiiii/Chiku.git
cd Chiku

# Set environment variables
export OPENROUTER_API_KEY=sk-...

# Deploy to Vercel
vercel
```

### **Environment Variables**
Set these in Vercel dashboard:
- `OPENROUTER_API_KEY` → Your OpenRouter API key
- `SITE_URL` (optional) → Default: `https://chiku-iota.vercel.app/`

---

## 📊 How It Works — Example Flows

### **Example 1: Near-Perfect Match (Score ≥ 0.90)**
```
User: "Hii Chiku 💕"
↓
Frontend fuzzy search finds:
  [score 0.95] "Hi chiku" → "Haye 🙈"
↓
Decision: score ≥ 0.90 ✅
Result: Direct local reply (instant, free)
Chiku: "Haye 🙈" (◉ Local)
```

### **Example 2: Moderate Match (Score 0.28–0.89) — RAG Mode**
```
User: "Suno na yrr, mera cover lana h aaj fir mat bolna"
↓
Frontend fuzzy search finds partial matches:
  [score 0.68] Similar greeting example
  [score 0.62] Context-aware example
  [score 0.55] Emotional pattern example
↓
Decision: 0.28 < score < 0.90 → Use RAG
Result: Send top 4 examples to AI as personality guide
Chiku (AI-generated): "Bss 1 person h jo merko sambhal sakta h" (◈ Memory)
```

### **Example 3: No Match → Pure AI**
```
User: "Tell me about quantum physics"
↓
Frontend: No relevant examples found
↓
Decision: score < 0.28 → Pure AI with personality prompt only
Result: AI uses system prompt to generate personality-aware reply
Chiku (personality-injected): "Yrr mujhe science nhi samjh aati 😅" (✦ AI)
```

---

## 🎨 Frontend Stack

- **HTML5** (77.5%) — Semantic structure + inline CSS + JS
- **JavaScript (22.5%)** — Vanilla JS, no frameworks (~1000 lines)
  - Fuzzy search engine (FuzzyEngine)
  - Smart matching with intent detection
  - Message UI with animations
  - Local storage for quick replies

### **Key JS Modules**
| Module | Lines | Purpose |
|--------|-------|---------|
| `State` | ~20 | Global app state, memory buffer, anti-repeat tracking |
| `FuzzyEngine` | ~80 | Levenshtein distance, word normalization, scoring |
| `Indexer` | ~30 | Word index for O(1) candidate lookup |
| `UI` | ~60 | Message rendering, animations, scroll management |
| `apiAsk()` | ~20 | OpenRouter API client with AbortSignal timeout |
| `handleSend()` | ~80 | Core logic: local vs RAG vs pure AI decision |

---

## ⚙️ Backend (Vercel Serverless)

### **File: `/api/ask.js`**
**Responsibility:** Generate personality-aware AI responses using RAG

**Current Settings:**
```javascript
model:        "nvidia/nemotron-3-super-120b-a12b:free"
max_tokens:   50                    // Short, snappy replies
temperature:  0.65                  // Focused, less rambling
top_p:        0.80                  // Avoid tangents
rate_limit:   20 req/min per IP
timeout:      13s (client 16s)
```

**Workflow:**
1. Validate + sanitize prompt/history/examples
2. Build system prompt = base personality + RAG examples + conversation history
3. Call OpenRouter API
4. Clean response (remove analysis, reasoning, asterisks)
5. Return short reply only

---

## 🔐 Privacy & Security

✅ **Client-side first** — Sensitive data stays local by default  
✅ **Opt-in cloud** — Only sent to OpenRouter when needed  
✅ **No logging** — Conversation history never stored  
✅ **Rate limited** — 20 req/min per IP to prevent abuse  
✅ **CORS enabled** — Frontend-only deployment  

---

## 📈 Performance

| Scenario | Latency | Cost | Quality |
|----------|---------|------|---------|
| Local match (≥0.90) | <600ms | Free | ⭐⭐⭐⭐⭐ |
| RAG mode (0.28–0.89) | 2–3s | $0.0001 | ⭐⭐⭐⭐⭐ |
| No match (pure AI) | 2–3s | $0.0001 | ⭐⭐⭐⭐ |

**Result: 95% instant + free, 5% smart + cheap**

---

## 🐛 Troubleshooting

### **AI giving long explanations instead of short replies?**
In `/api/ask.js`, reduce token budget:
```javascript
max_tokens: 40,      // was 50
temperature: 0.60,   // was 0.65
```

### **Examples not being used in RAG?**
Check browser console:
```javascript
console.log(`[Chiku] RAG — examples:${cleanExamples.length}, ...`)
// Should show examples:4 (not examples:0)
```

### **Rate limit errors?**
Increase limits in `/api/ask.js`:
```javascript
const RATE_LIMIT  = 30;           // was 20
const RATE_WINDOW = 90 * 1000;    // was 60s
```

---

## 💡 Key Learnings

1. **Personality > Prompts** — Real examples beat descriptions every time
2. **Hybrid is best** — Local for speed/privacy, AI for context & emotion
3. **Intent matters** — Different message types need different matching thresholds
4. **Context is king** — Memory buffer makes huge UX difference
5. **Garbage in = garbage out** — Dataset quality is critical

---

## 📝 License

MIT — Feel free to fork, modify, deploy!

---

## 🤝 Contributing

Found a bug? Want to improve? Open an issue or PR!

**Ideas:**
- [ ] More personality training data
- [ ] Caching layer for frequent queries
- [ ] Support for more languages
- [ ] User-specific personality tuning
- [ ] Analytics dashboard

---

## 👨‍💻 Author

**Shiva** — Built Chiku as an experiment in personality-driven AI.

Questions? Bugs? [Open an issue!](https://github.com/Shiva-sainiiii/Chiku/issues)

---

**Made with ❤️ using fuzzy logic + AI magic**
