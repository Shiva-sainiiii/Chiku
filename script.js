// ===============================
// DATA
// ===============================
let dataset = [];
let memory = []; // 🔥 context memory (last chats)

async function loadDataset() {
  const res = await fetch("dataset.json");
  dataset = await res.json();
}
loadDataset();

// ===============================
// DOM
// ===============================
const chat = document.getElementById("chat-container");
const input = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const typing = document.getElementById("typing");

// ===============================
// EVENTS
// ===============================
sendBtn.onclick = sendMessage;
input.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

// ===============================
// SEND MESSAGE
// ===============================
function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, "user");
  input.value = "";

  // 🔥 save memory
  memory.push({ role: "user", text });
  if (memory.length > 10) memory.shift();

  generateReply(text);
}

// ===============================
// ADD MESSAGE
// ===============================
function addMessage(text, type, source = "dataset") {
  const msg = document.createElement("div");
  msg.className = "message " + type;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (type === "ai") {
    bubble.classList.add(source === "ai" ? "ai-generated" : "dataset-generated");
  }

  bubble.innerText = text;

  // tag
  if (type === "ai") {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.innerText = source === "ai" ? "AI" : "Real";
    bubble.appendChild(tag);
  }

  msg.appendChild(bubble);
  chat.appendChild(msg);

  chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
}

// ===============================
// MOOD DETECTION 😒🙂😡
// ===============================
function detectMood(text) {
  text = text.toLowerCase();

  if (text.includes("love") || text.includes("miss") || text.includes("❤️")) {
    return "love";
  }

  if (text.includes("sorry") || text.includes("please")) {
    return "soft";
  }

  if (text.includes("kyu") || text.includes("kya") || text.includes("?")) {
    return "question";
  }

  if (text.includes("sex") || text.includes("kiss")) {
    return "awkward";
  }

  if (text.includes("nhi") || text.includes("mat")) {
    return "attitude";
  }

  return "normal";
}

// ===============================
// SIMILARITY
// ===============================
function similarity(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();

  let score = 0;
  const wordsA = a.split(" ");
  const wordsB = b.split(" ");

  wordsA.forEach(word => {
    if (wordsB.includes(word)) score++;
  });

  return score / Math.max(wordsA.length, wordsB.length);
}

// ===============================
// CONTEXT MATCH (🔥 memory use)
// ===============================
function findBestMatch(userText) {
  let bestMatches = [];

  dataset.forEach(item => {
    const combined = item.input.join(" ");
    const score = similarity(userText, combined);

    if (score > 0.2) {
      bestMatches.push({ item, score });
    }
  });

  // 🔥 sort by score
  bestMatches.sort((a, b) => b.score - a.score);

  // 🔥 return top 3 (variation ke liye)
  return bestMatches.slice(0, 3).map(x => x.item);
}

// ===============================
// RANDOM PICK (variation)
// ===============================
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===============================
// DELAY
// ===============================
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// ===============================
// MULTI MESSAGE
// ===============================
async function sendMultiMessages(messages, source = "dataset") {
  for (let msg of messages) {
    await delay(300 + msg.length * 30);
    addMessage(msg, "ai", source);

    // 🔥 save memory
    memory.push({ role: "ai", text: msg });
    if (memory.length > 10) memory.shift();
  }
}

// ===============================
// MAIN AI LOGIC
// ===============================
async function generateReply(userText) {

  typing.classList.remove("hidden");

  const mood = detectMood(userText);

  // 🔥 dataset matches (multiple)
  const matches = findBestMatch(userText);

  if (matches.length) {
    await delay(600);

    typing.classList.add("hidden");

    // 🔥 random variation
    const selected = pickRandom(matches);

    let response = [...selected.output];

    // 🔥 mood based tweak
    if (mood === "love") {
      response.push("Hn 😅");
    }

    if (mood === "attitude") {
      response.unshift("Hn to 😒");
    }

    if (mood === "question") {
      response.push("Tu bol na");
    }

    await sendMultiMessages(response, "dataset");
    return;
  }

  // ===============================
  // 🔥 FALLBACK AI WITH MEMORY
  // ===============================
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: userText,
        memory: memory // 🔥 send context
      })
    });

    const data = await res.json();

    typing.classList.add("hidden");

    const replies = data.reply.split(". ");

    await sendMultiMessages(replies, "ai");

  } catch {
    typing.classList.add("hidden");
    addMessage("Hn 😑", "ai");
  }
}
