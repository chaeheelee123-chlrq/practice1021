const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;
const HOST = "127.0.0.1";

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt < 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv(path.join(ROOT, ".env"));

function firstEnv(names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return "";
}

function providerFor(value) {
  if (value.startsWith("sk-or-")) return "openrouter";
  if (value.startsWith("sk-")) return "openai";
  return "";
}

const openRouterKey = firstEnv(["OPENROUTER_API_KEY", "openrouter_api_key", "OPENROUTER_KEY", "openrouter_key"]);
const openAiKey = firstEnv(["OPENAI_API_KEY", "openai_api_key", "OPENAI_KEY"]);
const provider = openRouterKey ? "openrouter" : providerFor(openAiKey);
const apiKey = provider === "openrouter" ? (openRouterKey || openAiKey) : openAiKey;
const model = firstEnv(["OPENROUTER_MODEL", "openrouter_model", "OPENAI_MODEL", "openai_model"])
  || (provider === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4o-mini");

const TOPIC_GUIDE = {
  free: "Free conversation. Follow whatever the student wants to talk about.",
  daily: "Talk about the student's day.",
  food: "Talk about food.",
  hobby: "Talk about hobbies, music, games, or sports.",
  travel: "Talk about travel and places.",
  weekend: "Talk about weekend plans.",
  school: "Talk about school or work.",
  cafe: "Role-play. You are Mina, the barista in a practice café. Take the order in natural English, then keep the chat going."
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function safeError(value) {
  let text = String(value || "요청에 실패했어요.");
  if (apiKey) text = text.split(apiKey).join("***");
  return text
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "sk-or-***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .slice(0, 300);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 200000) {
        reject(new Error("요청이 너무 깁니다."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new Error("요청 형식을 읽지 못했어요."));
      }
    });
    req.on("error", reject);
  });
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 2000) }))
    .filter((item) => item.content);
}

function systemPrompt(body) {
  const topic = TOPIC_GUIDE[body.topic] ? body.topic : "free";
  const name = typeof body.name === "string" ? body.name.replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, 40) : "";
  const level = body.level === "intermediate" ? "intermediate" : "beginner";
  return [
    "You are Mina, a warm English conversation partner for a Korean student.",
    name ? `The student's name is ${name}. Use it sometimes.` : "You do not know the student's name yet. Ask once if it fits.",
    `Current topic: ${TOPIC_GUIDE[topic]}`,
    level === "beginner"
      ? "Use short, common words that are easy to say aloud."
      : "Use natural spoken English, still clear and not too long.",
    "Write 2 or 3 short sentences and end with one question.",
    "If the student writes Korean, first give one natural English sentence they can say, then continue.",
    "Respond to their meaning. Do not give a grammar lecture.",
    "Return only a JSON object with keys en, ko, simple, and suggestions.",
    "en is your English reply. ko is a short Korean translation. simple is an easier English version of en.",
    "suggestions is an array of exactly 3 short English sentences the student might say next."
  ].join("\n");
}

function parseModelText(content) {
  const cleaned = String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const data = JSON.parse(cleaned);
    if (data && typeof data.en === "string" && data.en.trim()) return data;
  } catch (error) {
    /* The model sometimes returns plain text. Use that as the reply. */
  }
  return { en: cleaned, ko: "", simple: "", suggestions: [] };
}

async function chat(body) {
  if (!apiKey) {
    const error = new Error(".env에 OPENROUTER_API_KEY를 저장한 뒤 서버를 다시 실행하세요.");
    error.status = 400;
    throw error;
  }
  const messages = cleanMessages(body.messages);
  if (!messages.length) {
    const error = new Error("보낼 문장이 없습니다.");
    error.status = 400;
    throw error;
  }
  const endpoint = provider === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = `http://${HOST}:${PORT}`;
    headers["X-Title"] = "Talk English";
  }
  const payload = {
    model,
    temperature: 0.8,
    messages: [
      { role: "system", content: systemPrompt(body) },
      ...messages
    ]
  };
  if (provider === "openai") payload.response_format = { type: "json_object" };
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(safeError(data.error && data.error.message));
    error.status = response.status;
    throw error;
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const reply = parseModelText(text);
  const suggestions = Array.isArray(reply.suggestions)
    ? reply.suggestions.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  return {
    en: String(reply.en || "").trim(),
    ko: String(reply.ko || "").trim(),
    simple: String(reply.simple || "").trim(),
    suggestions
  };
}

function serveIndex(res) {
  const file = path.join(ROOT, "index.html");
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("index.html을 찾지 못했어요.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, apiKey
      ? { ok: true, provider }
      : { ok: false, error: ".env에 OPENROUTER_API_KEY를 저장한 뒤 서버를 다시 실행하세요." });
    return;
  }
  if (url.pathname === "/api/chat" && req.method === "POST") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await chat(body));
    } catch (error) {
      sendJson(res, error.status || 500, { error: safeError(error.message) });
    }
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    serveIndex(res);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Talk English: http://${HOST}:${PORT}`);
  if (!apiKey) console.log("OPENROUTER_API_KEY를 .env에 저장한 뒤 서버를 다시 실행하세요.");
  else console.log(provider === "openrouter" ? "OpenRouter 키를 이 컴퓨터의 서버에서만 사용합니다." : "OpenAI 키를 이 컴퓨터의 서버에서만 사용합니다.");
});
