// ===============================
// LOAD DATASET
// ===============================
let dataset = [];

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
// SEND MESSAGE
// ===============================
sendBtn.onclick = sendMessage;
input.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, "user");
  input.value = "";

  generateReply(text);
}

// ===============================
// ADD MESSAGE UI
// ===============================
function addMessage(text, type) {
  const msg = document.createElement("div");
  msg.className = "message " + type;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerText = text;

  msg.appendChild(bubble);
  chat.appendChild(msg);

  chat.scrollTop = chat.scrollHeight;
}

// ===============================
// SIMILARITY (simple but effective)
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
// FIND BEST MATCH
// ===============================
function findBestMatch(userText) {
  let best = null;
  let bestScore = 0;

  dataset.forEach(item => {
    const combinedInput = item.input.join(" ");

    const score = similarity(userText, combinedInput);

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });

  return bestScore > 0.2 ? best : null;
}

// ===============================
// TYPING EFFECT
// ===============================
function showTyping() {
  typing.classList.remove("hidden");
}

function hideTyping() {
  typing.classList.add("hidden");
}

// ===============================
// SEND MULTIPLE AI MESSAGES
// ===============================
async function sendMultiMessages(messages) {
  for (let msg of messages) {
    await delay(random(500, 1200));
    addMessage(msg, "ai");
  }
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ===============================
// MAIN REPLY LOGIC
// ===============================
async function generateReply(userText) {

  showTyping();

  // Step 1: Try dataset match
  const match = findBestMatch(userText);

  if (match) {
    await delay(random(800, 1500));
    hideTyping();

    await sendMultiMessages(match.output);
    return;
  }

  // Step 2: Fallback AI API
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: userText })
    });

    const data = await res.json();

    hideTyping();

    // Split into multiple lines (simulate her style)
    const replies = data.reply.split(". ");

    await sendMultiMessages(replies);

  } catch (err) {
    hideTyping();
    addMessage("Hn theek h 👍", "ai");
  }
}
