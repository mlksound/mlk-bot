"use strict";

/*
============================================================
MLK BOT
BITRIX FETCH + DEEPSEEK + TELEGRAM
============================================================

BITRIX:
  imbot.v2.Event.get
  imbot.v2.Chat.Message.send

TELEGRAM:
  getUpdates
  sendMessage

DEEPSEEK:
  https://api.deepseek.com/chat/completions
  model: deepseek-v4-flash

ENV:
  BITRIX_WEBHOOK_URL
  BITRIX_BOT_TOKEN
  BOT_ID
  BOT_CODE

  DEEPSEEK_API_KEY
  DEEPSEEK_MODEL       optional

  TELEGRAM_BOT_TOKEN

  PORT                 optional
============================================================
*/

const http = require("http");

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;

const BOT_ID = Number(process.env.BOT_ID || 1787);
const BOT_CODE =
  process.env.BOT_CODE || "mlk_ai_consultant_v2";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

// ============================================================
// VALIDATION
// ============================================================

console.log("========================================");
console.log("MLK BITRIX FETCH + TELEGRAM + DEEPSEEK");
console.log("========================================");

console.log(
  "BITRIX_WEBHOOK_URL:",
  BITRIX_WEBHOOK_URL ? "OK" : "MISSING"
);

console.log(
  "BITRIX_BOT_TOKEN:",
  BITRIX_BOT_TOKEN ? "OK" : "MISSING"
);

console.log("BOT_ID:", BOT_ID);
console.log("BOT_CODE:", BOT_CODE);

console.log(
  "DEEPSEEK_API_KEY:",
  DEEPSEEK_API_KEY ? "OK" : "MISSING"
);

console.log("DEEPSEEK_MODEL:", DEEPSEEK_MODEL);

console.log(
  "TELEGRAM_BOT_TOKEN:",
  TELEGRAM_BOT_TOKEN ? "OK" : "MISSING"
);

console.log("PORT:", PORT);

console.log("========================================");

if (!BITRIX_WEBHOOK_URL) {
  console.error("❌ BITRIX_WEBHOOK_URL не задан");
}

if (!BITRIX_BOT_TOKEN) {
  console.error("❌ BITRIX_BOT_TOKEN не задан");
}

if (!DEEPSEEK_API_KEY) {
  console.error("❌ DEEPSEEK_API_KEY не задан");
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error("⚠️ TELEGRAM_BOT_TOKEN не задан");
  console.error(
    "Telegram будет отключён, Bitrix продолжит работать."
  );
}

// ============================================================
// GLOBAL STATE
// ============================================================

// Bitrix FETCH offset
let bitrixOffset = 0;

// Telegram getUpdates offset
let telegramOffset = 0;

// Чтобы Telegram poll не запускался одновременно
let telegramPolling = false;

// Чтобы Bitrix poll не запускался одновременно
let bitrixPolling = false;

// Завершение
let shuttingDown = false;

// ============================================================
// HTTP SERVER FOR RENDER
// ============================================================

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
    });

    res.end(
      JSON.stringify({
        ok: true,
        service: "mlk-bitrix-telegram-bot",
        mode: "fetch",
        botId: BOT_ID,
        botCode: BOT_CODE,
        deepseek: DEEPSEEK_MODEL,
        bitrix: Boolean(BITRIX_WEBHOOK_URL && BITRIX_BOT_TOKEN),
        telegram: Boolean(TELEGRAM_BOT_TOKEN),
      })
    );

    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
    });

    res.end(
      JSON.stringify({
        ok: true,
        bitrixOffset,
        telegramOffset,
        bitrixPolling,
        telegramPolling,
      })
    );

    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log("========================================");
  console.log("🚀 SERVER STARTED");
  console.log("========================================");
  console.log("PORT:", PORT);
  console.log("MODE: FETCH");
  console.log("BOT ID:", BOT_ID);
  console.log("BOT CODE:", BOT_CODE);
  console.log("DEEPSEEK:", DEEPSEEK_MODEL);
  console.log(
    "BITRIX:",
    BITRIX_WEBHOOK_URL && BITRIX_BOT_TOKEN
      ? "ENABLED"
      : "DISABLED"
  );
  console.log(
    "TELEGRAM:",
    TELEGRAM_BOT_TOKEN ? "ENABLED" : "DISABLED"
  );
  console.log("========================================");
});

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimText(text, maxLength = 4000) {
  if (!text) {
    return "";
  }

  text = String(text);

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 3) + "...";
}

// ============================================================
// BITRIX API
// ============================================================

async function bitrixCall(method, params = {}) {
  if (!BITRIX_WEBHOOK_URL) {
    throw new Error(
      "BITRIX_WEBHOOK_URL не задан"
    );
  }

  const url =
    BITRIX_WEBHOOK_URL.replace(/\/+$/, "") +
    "/method/" +
    method;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Bitrix вернул не JSON. HTTP ${response.status}: ${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Bitrix HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data.error) {
    throw new Error(
      `Bitrix ${data.error}: ${
        data.error_description || ""
      }`
    );
  }

  return data;
}

// ============================================================
// BITRIX FETCH
// ============================================================

async function fetchBitrixEvents() {
  console.log("========================================");
  console.log("🔄 FETCH POLL");
  console.log("========================================");

  console.log("TIME:", new Date().toISOString());
  console.log("BOT_ID:", BOT_ID);
  console.log("OFFSET:", bitrixOffset);

  const params = {
    botId: BOT_ID,
    botToken: BITRIX_BOT_TOKEN,
    offset: bitrixOffset,
    limit: 50,
  };

  console.log("----------------------------------------");
  console.log("➡️ BITRIX API: imbot.v2.Event.get");

  console.log(
    "📤 PARAMS:",
    JSON.stringify({
      ...params,
      botToken: "[HIDDEN]",
    })
  );

  try {
    const data = await bitrixCall(
      "imbot.v2.Event.get",
      params
    );

    const result = data.result || {};

    const events = Array.isArray(result.events)
      ? result.events
      : [];

    const nextOffset =
      result.nextOffset !== undefined
        ? Number(result.nextOffset)
        : bitrixOffset;

    const hasMore = Boolean(result.hasMore);

    console.log("⬅️ HTTP: 200");

    console.log(
      "📦 EVENTS:",
      events.length
    );

    console.log(
      "NEXT OFFSET:",
      nextOffset
    );

    console.log(
      "HAS MORE:",
      hasMore
    );

    // ВАЖНО:
    // offset двигаем сразу после успешного получения.
    bitrixOffset = nextOffset;

    console.log(
      "➡️ OFFSET UPDATED TO:",
      bitrixOffset
    );

    if (events.length === 0) {
      console.log("📭 Новых событий нет.");
      return;
    }

    console.log(
      "🎉 ПОЛУЧЕНО СОБЫТИЙ:",
      events.length
    );

    for (const event of events) {
      await processBitrixEvent(event);
    }
  } catch (error) {
    console.error("❌ BITRIX FETCH ERROR");

    console.error(error.message);

    console.error("----------------------------------------");
  }
}

// ============================================================
// PROCESS BITRIX EVENT
// ============================================================

async function processBitrixEvent(event) {
  console.log("========================================");
  console.log("📦 PROCESS BITRIX EVENT");
  console.log("========================================");

  console.log(
    "EVENT ID:",
    event?.eventId
  );

  console.log(
    "EVENT TYPE:",
    event?.type
  );

  // Нам нужны только сообщения
  if (
    event?.type !==
    "ONIMBOTV2MESSAGEADD"
  ) {
    console.log(
      "ℹ️ Игнорируем событие типа:",
      event?.type
    );

    return;
  }

  const data = event.data || {};
  const message = data.message || {};
  const chat = data.chat || {};
  const user = data.user || {};
  const bot = data.bot || {};

  const text = String(
    message.text || ""
  ).trim();

  const chatId =
    message.chatId ||
    message.chat_id ||
    chat.id;

  const dialogId =
    chat.dialogId ||
    String(chatId);

  const authorId =
    message.authorId ||
    message.author_id;

  console.log("----------------------------------------");
  console.log("💬 BITRIX MESSAGE");
  console.log("----------------------------------------");

  console.log("MESSAGE ID:", message.id);
  console.log("CHAT ID:", chatId);
  console.log("DIALOG ID:", dialogId);
  console.log("AUTHOR ID:", authorId);
  console.log("TEXT:", text);

  console.log("----------------------------------------");
  console.log("👤 USER");
  console.log("ID:", user.id);
  console.log("NAME:", user.name);

  console.log("----------------------------------------");
  console.log("🤖 BOT");
  console.log("ID:", bot.id);
  console.log("CODE:", bot.code);

  // ----------------------------------------------------------
  // Защита от пустых сообщений
  // ----------------------------------------------------------

  if (!text) {
    console.log(
      "📭 Пустое сообщение — пропускаем."
    );

    return;
  }

  // ----------------------------------------------------------
  // Защита от сообщений самого бота
  // ----------------------------------------------------------

  if (
    Number(authorId) === BOT_ID
  ) {
    console.log(
      "🤖 Сообщение отправлено ботом — пропускаем."
    );

    return;
  }

  // ----------------------------------------------------------
  // DEEPSEEK
  // ----------------------------------------------------------

  console.log(
    "➡️ ШАГ 1: отправляем сообщение в DeepSeek"
  );

  let answer;

  try {
    answer = await askDeepSeek(text);
  } catch (error) {
    console.error(
      "❌ DEEPSEEK ERROR:",
      error.message
    );

    answer =
      "Извините, сейчас не удалось получить ответ от AI. Попробуйте ещё раз.";
  }

  // ----------------------------------------------------------
  // BITRIX SEND
  // ----------------------------------------------------------

  console.log(
    "➡️ ШАГ 2: отправляем ответ DeepSeek в Bitrix"
  );

  try {
    await sendBitrixMessage(
      dialogId,
      answer
    );
  } catch (error) {
    console.error(
      "❌ BITRIX SEND ERROR:",
      error.message
    );
  }
}

// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(userMessage) {
  console.log("========================================");
  console.log("🧠 DEEPSEEK REQUEST");
  console.log("========================================");

  console.log(
    "MODEL:",
    DEEPSEEK_MODEL
  );

  console.log(
    "USER MESSAGE:",
    userMessage
  );

  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      "DEEPSEEK_API_KEY не задан"
    );
  }

  const body = {
    model: DEEPSEEK_MODEL,

    messages: [
      {
        role: "system",
        content:
          "Ты ИИ-консультант компании MLK. " +
          "Отвечай на русском языке. " +
          "Будь полезным, кратким и понятным. " +
          "Не выдумывай факты о компании MLK. " +
          "Если не знаешь точного ответа, честно скажи об этом.",
      },
      {
        role: "user",
        content: userMessage,
      },
    ],

    stream: false,

    max_tokens: 500,
  };

  console.log(
    "📤 DEEPSEEK BODY:",
    JSON.stringify(body, null, 2)
  );

  const response = await fetch(
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization:
          `Bearer ${DEEPSEEK_API_KEY}`,
      },

      body: JSON.stringify(body),
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `DeepSeek вернул не JSON. HTTP ${response.status}: ${text}`
    );
  }

  console.log(
    "⬅️ DEEPSEEK HTTP:",
    response.status
  );

  if (!response.ok) {
    console.error(
      "⬅️ DEEPSEEK ERROR RESPONSE:",
      JSON.stringify(data)
    );

    throw new Error(
      `DeepSeek HTTP ${response.status}: ${
        data.error?.message ||
        JSON.stringify(data)
      }`
    );
  }

  console.log(
    "⬅️ DEEPSEEK RESPONSE:",
    JSON.stringify(data)
  );

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "DeepSeek не вернул choices[0].message.content"
    );
  }

  console.log("========================================");
  console.log("🧠 DEEPSEEK ANSWER");
  console.log("========================================");

  console.log(answer);

  return trimText(answer, 4000);
}

// ============================================================
// SEND MESSAGE TO BITRIX
// ============================================================

async function sendBitrixMessage(
  dialogId,
  message
) {
  console.log("========================================");
  console.log("📤 ОТПРАВЛЯЕМ ОТВЕТ В BITRIX");
  console.log("========================================");

  console.log("BOT_ID:", BOT_ID);
  console.log("DIALOG_ID:", dialogId);
  console.log("MESSAGE:", message);

  const params = {
    botId: BOT_ID,

    botToken: BITRIX_BOT_TOKEN,

    dialogId: String(dialogId),

    fields: {
      message: trimText(message, 4000),

      urlPreview: false,
    },
  };

  console.log("----------------------------------------");

  console.log(
    "➡️ BITRIX API: imbot.v2.Chat.Message.send"
  );

  console.log(
    "📤 PARAMS:",
    JSON.stringify({
      ...params,
      botToken: "[HIDDEN]",
    })
  );

  const data = await bitrixCall(
    "imbot.v2.Chat.Message.send",
    params
  );

  console.log(
    "⬅️ HTTP: 200"
  );

  console.log(
    "⬅️ RESPONSE:",
    JSON.stringify(data)
  );

  console.log(
    "🎉🎉🎉 ОТВЕТ УСПЕШНО ОТПРАВЛЕН В BITRIX 🎉🎉🎉"
  );

  return data;
}

// ============================================================
// TELEGRAM API
// ============================================================

async function telegramCall(
  method,
  params = {}
) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN не задан"
    );
  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify(params),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Telegram вернул не JSON. HTTP ${response.status}: ${text}`
    );
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram ${response.status}: ${
        data.description ||
        JSON.stringify(data)
      }`
    );
  }

  return data;
}

// ============================================================
// TELEGRAM BOT INFO
// ============================================================

async function testTelegram() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(
      "⚠️ TELEGRAM_BOT_TOKEN отсутствует — Telegram отключён."
    );

    return;
  }

  console.log("========================================");
  console.log("🤖 TELEGRAM TEST");
  console.log("========================================");

  try {
    const data =
      await telegramCall("getMe");

    console.log(
      "✅ Telegram connection OK"
    );

    console.log(
      "BOT:",
      JSON.stringify(data.result)
    );
  } catch (error) {
    console.error(
      "❌ TELEGRAM CONNECTION ERROR:",
      error.message
    );
  }
}

// ============================================================
// TELEGRAM POLLING
// ============================================================

async function telegramPoll() {
  if (!TELEGRAM_BOT_TOKEN) {
    return;
  }

  if (telegramPolling) {
    console.log(
      "⚠️ Предыдущий Telegram FETCH ещё выполняется."
    );

    return;
  }

  telegramPolling = true;

  try {
    const params = {
      offset: telegramOffset,

      timeout: 20,

      allowed_updates: [
        "message",
      ],
    };

    const data =
      await telegramCall(
        "getUpdates",
        params
      );

    const updates =
      Array.isArray(data.result)
        ? data.result
        : [];

    if (updates.length === 0) {
      return;
    }

    console.log("========================================");
    console.log("📨 TELEGRAM UPDATES");
    console.log("========================================");

    console.log(
      "COUNT:",
      updates.length
    );

    for (const update of updates) {
      // Всегда двигаем offset после получения update
      if (
        typeof update.update_id ===
        "number"
      ) {
        telegramOffset =
          update.update_id + 1;
      }

      await processTelegramUpdate(
        update
      );
    }

    console.log(
      "➡️ TELEGRAM OFFSET:",
      telegramOffset
    );
  } catch (error) {
    console.error(
      "❌ TELEGRAM POLL ERROR:",
      error.message
    );

    // Небольшая пауза после ошибки
    await sleep(3000);
  } finally {
    telegramPolling = false;
  }
}

// ============================================================
// PROCESS TELEGRAM UPDATE
// ============================================================

async function processTelegramUpdate(
  update
) {
  console.log("========================================");
  console.log("📦 PROCESS TELEGRAM UPDATE");
  console.log("========================================");

  console.log(
    "UPDATE ID:",
    update.update_id
  );

  const message =
    update.message;

  if (!message) {
    console.log(
      "ℹ️ Update не содержит message — пропускаем."
    );

    return;
  }

  const chat =
    message.chat || {};

  const from =
    message.from || {};

  const text =
    String(message.text || "").trim();

  const chatId =
    chat.id;

  console.log("----------------------------------------");
  console.log("💬 TELEGRAM MESSAGE");
  console.log("----------------------------------------");

  console.log(
    "MESSAGE ID:",
    message.message_id
  );

  console.log(
    "CHAT ID:",
    chatId
  );

  console.log(
    "CHAT TYPE:",
    chat.type
  );

  console.log(
    "FROM ID:",
    from.id
  );

  console.log(
    "FROM NAME:",
    [
      from.first_name,
      from.last_name,
    ]
      .filter(Boolean)
      .join(" ")
  );

  console.log(
    "TEXT:",
    text
  );

  // ----------------------------------------------------------
  // Пустое сообщение
  // ----------------------------------------------------------

  if (!text) {
    console.log(
      "📭 Telegram message без text — пропускаем."
    );

    return;
  }

  // ----------------------------------------------------------
  // Сообщение самого бота
  // ----------------------------------------------------------

  if (from.is_bot) {
    console.log(
      "🤖 Telegram сообщение от бота — пропускаем."
    );

    return;
  }

  // ----------------------------------------------------------
  // DEEPSEEK
  // ----------------------------------------------------------

  console.log(
    "➡️ ШАГ 1: Telegram → DeepSeek"
  );

  let answer;

  try {
    answer =
      await askDeepSeek(text);
  } catch (error) {
    console.error(
      "❌ DEEPSEEK ERROR:",
      error.message
    );

    answer =
      "Извините, сейчас не удалось получить ответ от AI. Попробуйте ещё раз.";
  }

  // ----------------------------------------------------------
  // TELEGRAM SEND
  // ----------------------------------------------------------

  console.log(
    "➡️ ШАГ 2: DeepSeek → Telegram"
  );

  try {
    await sendTelegramMessage(
      chatId,
      answer
    );
  } catch (error) {
    console.error(
      "❌ TELEGRAM SEND ERROR:",
      error.message
    );
  }
}

// ============================================================
// SEND TELEGRAM MESSAGE
// ============================================================

async function sendTelegramMessage(
  chatId,
  message
) {
  console.log("========================================");
  console.log("📤 ОТПРАВЛЯЕМ ОТВЕТ В TELEGRAM");
  console.log("========================================");

  console.log(
    "CHAT ID:",
    chatId
  );

  console.log(
    "MESSAGE:",
    message
  );

  const params = {
    chat_id: chatId,

    text: trimText(message, 4000),
  };

  const data =
    await telegramCall(
      "sendMessage",
      params
    );

  console.log(
    "⬅️ TELEGRAM RESPONSE:",
    JSON.stringify(data)
  );

  console.log(
    "🎉🎉🎉 ОТВЕТ УСПЕШНО ОТПРАВЛЕН В TELEGRAM 🎉🎉🎉"
  );

  return data;
}

// ============================================================
// BITRIX LOOP
// ============================================================

async function bitrixLoop() {
  if (!BITRIX_WEBHOOK_URL) {
    console.error(
      "❌ Bitrix loop не запущен: BITRIX_WEBHOOK_URL отсутствует."
    );

    return;
  }

  if (!BITRIX_BOT_TOKEN) {
    console.error(
      "❌ Bitrix loop не запущен: BITRIX_BOT_TOKEN отсутствует."
    );

    return;
  }

  if (bitrixPolling) {
    console.log(
      "⚠️ Предыдущий Bitrix FETCH ещё выполняется."
    );

    return;
  }

  bitrixPolling = true;

  try {
    await fetchBitrixEvents();
  } catch (error) {
    console.error(
      "❌ BITRIX LOOP ERROR:",
      error.message
    );
  } finally {
    bitrixPolling = false;
  }
}

// ============================================================
// START LOOPS
// ============================================================

async function startLoops() {
  console.log("========================================");
  console.log("🚀 LOOPS STARTED");
  console.log("========================================");

  // Telegram test
  await testTelegram();

  // ----------------------------------------------------------
  // BITRIX
  // ----------------------------------------------------------

  if (
    BITRIX_WEBHOOK_URL &&
    BITRIX_BOT_TOKEN
  ) {
    console.log(
      "✅ Bitrix FETCH включён."
    );

    // Первый запрос сразу
    await bitrixLoop();

    // Затем каждые 3 секунды
    setInterval(async () => {
      if (shuttingDown) {
        return;
      }

      await bitrixLoop();
    }, 3000);
  } else {
    console.log(
      "⚠️ Bitrix отключён."
    );
  }

  // ----------------------------------------------------------
  // TELEGRAM
  // ----------------------------------------------------------

  if (TELEGRAM_BOT_TOKEN) {
    console.log(
      "✅ Telegram polling включён."
    );

    // Telegram long polling
    // Запускаем отдельно от Bitrix.
    const telegramRunner =
      async () => {
        while (!shuttingDown) {
          await telegramPoll();

          if (!shuttingDown) {
            // Небольшая пауза
            await sleep(500);
          }
        }
      };

    telegramRunner().catch(
      (error) => {
        console.error(
          "❌ TELEGRAM RUNNER CRASH:",
          error
        );
      }
    );
  } else {
    console.log(
      "⚠️ Telegram polling отключён: TELEGRAM_BOT_TOKEN отсутствует."
    );
  }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log("========================================");
  console.log(`🛑 ${signal}`);
  console.log("========================================");

  server.close(() => {
    console.log(
      "✅ Server closed"
    );

    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 5000);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

// ============================================================
// START
// ============================================================

startLoops().catch(
  (error) => {
    console.error(
      "❌ FATAL START ERROR:",
      error
    );
  }
);