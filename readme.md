💬 Chiku AI — Personalized Girlfriend Chatbot

A hybrid AI chatbot that mimics real conversation behavior using your personal Instagram chat dataset + AI fallback.

Built with ❤️ using Vanilla JavaScript, Vercel Serverless Functions, and OpenRouter API.

---

🚀 Features

- 💬 Real chat-based replies (trained on your personal dataset)
- 🧠 Smart context matching algorithm
- 🤖 AI fallback when no dataset match found
- 💞 Girlfriend-style responses (Hinglish + emotions)
- 🗨️ Multi-message chat bubbles (realistic conversation flow)
- ⏱️ Typing delay simulation (human-like feel)
- 🎨 Modern UI (WhatsApp + glassmorphism style)
- 📱 Fully responsive (mobile friendly)

---

🧠 How It Works

User Input
   ↓
script.js
   ↓
Dataset Matching (Real Chats)
   ↓ (if match found)
Return Stored Conversation
   ↓
Multi-message UI Output

Else ↓

ask.js API (OpenRouter)
   ↓
AI Generated Response (Same Style)
   ↓
Multi-message UI Output

---

📁 Project Structure

project/
│
├── index.html        # Chat UI structure
├── style.css         # UI/UX design
├── script.js         # AI logic + dataset engine
├── dataset.json      # Your chat dataset
│
└── api/
    └── ask.js        # AI fallback (Vercel serverless)

---

⚙️ Setup Guide

1. Clone Project

git clone https://github.com/yourusername/chiku-ai
cd chiku-ai

---

2. Add Dataset

Place your generated file:

dataset.json

---

3. Setup API Key

Create ".env" file:

OPENROUTER_API_KEY=your_api_key_here

---

4. Run Locally

npm install -g vercel
vercel dev

---

🔥 Dataset Format

[
  {
    "input": [
      "Kya kar rhi ho",
      "Free ho?"
    ],
    "output": [
      "Kuch nhi 😒",
      "Tu bol"
    ]
  }
]

---

🎯 Goal of This Project

To create a human-like conversational AI that:

- Understands your personal chat patterns
- Mimics tone, emotion, and response style
- Feels like real conversation (not robotic)

---

⚠️ Disclaimer

This project is for learning and experimental purposes only.
It does not represent real human emotions or relationships.

---

💎 Future Improvements

- 🧠 Memory (past conversation tracking)
- 😊 Emotion detection
- 🎤 Voice input support
- 🔍 Better NLP matching (fuzzy + semantic search)
- 📊 Conversation analytics

---

👨‍💻 Author

Shiva Saini

---

⭐ Support

If you like this project:

- ⭐ Star the repo
- 🚀 Share with friends
- 💡 Build something even cooler

---

Chiku AI — Not just a chatbot, a vibe. 💙
