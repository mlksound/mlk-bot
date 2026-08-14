const http = require("http");

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 10000;

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;

const BOT_ID = Number(process.env.BOT_ID || 1787);
const BOT_CODE =
  process.env.BOT_CODE || "mlk_ai_consultant_v2";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Актуальный endpoint DeepSeek
const DEEPSEEK_URL =
  "https://api.deepseek.com/chat/completions";

// Для минимального теста используем быструю модель
const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

// ============================================================
// VALIDATION
// ============================================================

console.log("========================================");
console.log("MLK BITRIX FETCH -> DEEPSEEK TEST");
console.log("========================================");

console.log(
  "BITRIX_WEBHOOK_URL:",
  BITRIX_WEBHOOK_URL ? "OK" : "MISSING"
);

console.log(
  "BITRIX_BOT_TOKEN:",
  BITRIX_BOT_TOKEN ? "OK" : "MISSING"
);

console.log(
  "DEEPSEEK_API_KEY:",
  DEEPSEEK_API_KEY ? "OK" : "MISSING"
);

console.log("BOT_ID:", BOT_ID);
console.log("BOT_CODE:", BOT_CODE);
console.log("DEEPSEEK_MODEL:", DEEPSEEK_MODEL);
console.log("PORT:", PORT);

console.log("========================================");

if (!BITRIX_WEBHOOK_URL) {
  console.error("❌ BITRIX_WEBHOOK_URL не установлен");
  process.exit(1);
}

if (!BITRIX_BOT_TOKEN) {
  console.error("❌ BITRIX_BOT_TOKEN не установлен");
  process.exit(1);
}

if (!DEEPSEEK_API_KEY) {
  console.error("❌ DEEPSEEK_API_KEY не установлен");
  process.exit(1);
}

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer((req, res) => {
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("MLK Bitrix FETCH + DeepSeek is running\n");
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("🚀 SERVER STARTED");
  console.log("PORT:", PORT);
  console.log("MODE: FETCH");
  console.log("BOT ID:", BOT_ID);
  console.log("BOT CODE:", BOT_CODE);
  console.log("DEEPSEEK:", DEEPSEEK_MODEL);
  console.log("========================================");

  startFetch();
});

// ============================================================
// BITRIX API
// ============================================================

async function bitrixCall(method, params) {
  const url =
    `${BITRIX_WEBHOOK_URL.replace(/\/$/, "")}/${method}.json`;

  console.log("----------------------------------------");
  console.log("➡️ BITRIX API:", method);

  // Никогда не выводим настоящий botToken в лог
  const safeParams = {
    ...params,
  };

  if (safeParams.botToken) {
    safeParams.botToken = "[HIDDEN]";
  }

  console.log(
    "📤 PARAMS:",
    JSON.stringify(safeParams)
  );

  try {
    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(params),
    });

    const text = await response.text();

    console.log("⬅️ HTTP:", response.status);
    console.log("⬅️ RESPONSE:", text);

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error("❌ Bitrix вернул не JSON");

      return {
        ok: false,
        httpStatus: response.status,
        raw: text,
      };
    }

    if (data.error) {
      console.error(
        "❌ BITRIX ERROR:",
        data.error,
        data.error_description || ""
      );
    }

    return {
      ok: response.ok && !data.error,
      httpStatus: response.status,
      data,
    };
  } catch (error) {
    console.error(
      "❌ Ошибка запроса к Bitrix:",
      error.message
    );

    return {
      ok: false,
      error: error.message,
    };
  }
}

// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(userMessage) {
  console.log("");
  console.log("========================================");
  console.log("🧠 DEEPSEEK REQUEST");
  console.log("========================================");

  console.log("MODEL:", DEEPSEEK_MODEL);
  console.log("USER MESSAGE:", userMessage);

  const body = {
    model: DEEPSEEK_MODEL,

    messages: [
      {
        role: "system",
        content:
          "Ты ИИ-консультант компании MLK. " +
          "Отвечай кратко, понятно и по существу. " +
          "Для теста просто отвечай на сообщение пользователя.",
      },

      {
        role: "user",
        content: userMessage,
      },
    ],

    stream: false,

    // Для первого теста ограничиваем длину ответа
    max_tokens: 500,
  };

  console.log(
    "📤 DEEPSEEK BODY:",
    JSON.stringify(body, null, 2)
  );

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",

        Authorization:
          `Bearer ${DEEPSEEK_API_KEY}`,
      },

      body: JSON.stringify(body),
    });

    const text = await response.text();

    console.log("⬅️ DEEPSEEK HTTP:", response.status);

    console.log(
      "⬅️ DEEPSEEK RESPONSE:",
      text
    );

    if (!response.ok) {
      console.error(
        "❌ DeepSeek HTTP ERROR:",
        response.status
      );

      return null;
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error(
        "❌ DeepSeek вернул не JSON"
      );

      return null;
    }

    const answer =
      data?.choices?.[0]?.message?.content;

    if (!answer) {
      console.error(
        "❌ В ответе DeepSeek нет choices[0].message.content"
      );

      return null;
    }

    console.log("");
    console.log("========================================");
    console.log("🧠 DEEPSEEK ANSWER");
    console.log("========================================");
    console.log(answer);
    console.log("========================================");

    return answer.trim();
  } catch (error) {
    console.error(
      "❌ Ошибка запроса к DeepSeek:",
      error.message
    );

    return null;
  }
}

// ============================================================
// SEND MESSAGE TO BITRIX
// ============================================================

async function sendBitrixMessage(dialogId, message) {
  console.log("");
  console.log("========================================");
  console.log("📤 ОТПРАВЛЯЕМ ОТВЕТ В BITRIX");
  console.log("========================================");

  console.log("BOT_ID:", BOT_ID);
  console.log("DIALOG_ID:", dialogId);
  console.log("MESSAGE:", message);

  const result = await bitrixCall(
    "imbot.v2.Chat.Message.send",
    {
      botId: BOT_ID,

      botToken: BITRIX_BOT_TOKEN,

      dialogId: String(dialogId),

      fields: {
        message: message,

        urlPreview: false,
      },
    }
  );

  if (!result.ok) {
    console.error(
      "❌ Не удалось отправить сообщение в Bitrix"
    );

    return false;
  }

  console.log("");
  console.log(
    "🎉🎉🎉 ОТВЕТ УСПЕШНО ОТПРАВЛЕН 🎉🎉🎉"
  );

  console.log(
    "RESULT:",
    JSON.stringify(
      result.data?.result || {},
      null,
      2
    )
  );

  return true;
}

// ============================================================
// FETCH
// ============================================================

let currentOffset = 0;

let fetchRunning = false;

// Чтобы одновременно не запустить несколько FETCH
let processingEvent = false;

// ============================================================
// GET EVENTS
// ============================================================

async function fetchEvents() {
  console.log("");
  console.log("========================================");
  console.log("🔄 FETCH POLL");
  console.log("========================================");

  console.log(
    "TIME:",
    new Date().toISOString()
  );

  console.log("BOT_ID:", BOT_ID);
  console.log("OFFSET:", currentOffset);

  const result = await bitrixCall(
    "imbot.v2.Event.get",
    {
      botId: BOT_ID,

      botToken: BITRIX_BOT_TOKEN,

      offset: currentOffset,

      limit: 50,
    }
  );

  if (!result.ok) {
    console.error(
      "❌ FETCH ERROR"
    );

    return;
  }

  const apiResult = result.data?.result;

  if (!apiResult) {
    console.error(
      "❌ В ответе Bitrix отсутствует result"
    );

    return;
  }

  const events =
    Array.isArray(apiResult.events)
      ? apiResult.events
      : [];

  const nextOffset =
    Number.isFinite(Number(apiResult.nextOffset))
      ? Number(apiResult.nextOffset)
      : currentOffset;

  const hasMore =
    Boolean(apiResult.hasMore);

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

  // Обновляем offset сразу после получения событий.
  // Это важно, чтобы после обработки события
  // оно не пришло повторно.
  currentOffset = nextOffset;

  console.log(
    "➡️ OFFSET UPDATED TO:",
    currentOffset
  );

  if (events.length === 0) {
    console.log(
      "📭 Новых событий нет."
    );

    return;
  }

  console.log("");
  console.log(
    "🎉🎉🎉 ПОЛУЧЕНО СОБЫТИЕ 🎉🎉🎉"
  );

  for (const event of events) {
    await processEvent(event);
  }
}

// ============================================================
// PROCESS EVENT
// ============================================================

async function processEvent(event) {
  console.log("");
  console.log("========================================");
  console.log("📦 PROCESS EVENT");
  console.log("========================================");

  console.log(
    "EVENT ID:",
    event.eventId
  );

  console.log(
    "EVENT TYPE:",
    event.type
  );

  console.log(
    "EVENT DATE:",
    event.date
  );

  // Нас интересуют только сообщения
  if (
    event.type !==
    "ONIMBOTV2MESSAGEADD"
  ) {
    console.log(
      "ℹ️ Событие не является сообщением. Пропускаем."
    );

    return;
  }

  const data = event.data || {};

  const message =
    data.message || {};

  const chat =
    data.chat || {};

  const user =
    data.user || {};

  const bot =
    data.bot || {};

  const text =
    typeof message.text === "string"
      ? message.text.trim()
      : "";

  const chatId =
    message.chatId ||
    message.chat_id ||
    chat.id;

  const dialogId =
    chat.dialogId;

  console.log("----------------------------------------");
  console.log("💬 MESSAGE");
  console.log("----------------------------------------");

  console.log(
    "ID:",
    message.id
  );

  console.log(
    "CHAT ID:",
    chatId
  );

  console.log(
    "DIALOG ID:",
    dialogId
  );

  console.log(
    "TEXT:",
    text
  );

  console.log("----------------------------------------");
  console.log("👤 USER");
  console.log("----------------------------------------");

  console.log(
    "ID:",
    user.id
  );

  console.log(
    "NAME:",
    user.name
  );

  console.log("----------------------------------------");
  console.log("🤖 BOT");
  console.log("----------------------------------------");

  console.log(
    "ID:",
    bot.id
  );

  console.log(
    "CODE:",
    bot.code
  );

  // ----------------------------------------------------------
  // Защита от пустых сообщений
  // ----------------------------------------------------------

  if (!text) {
    console.log(
      "📭 Сообщение пустое. Пропускаем."
    );

    return;
  }

  // ----------------------------------------------------------
  // Защита от собственных сообщений бота
  // ----------------------------------------------------------

  if (
    Number(message.authorId) === BOT_ID
  ) {
    console.log(
      "🤖 Это сообщение самого бота. Пропускаем."
    );

    return;
  }

  // ----------------------------------------------------------
  // Проверяем dialogId
  // ----------------------------------------------------------

  if (!dialogId) {
    console.error(
      "❌ Не найден dialogId. Невозможно отправить ответ."
    );

    return;
  }

  // ----------------------------------------------------------
  // Не допускаем параллельную обработку
  // ----------------------------------------------------------

  if (processingEvent) {
    console.log(
      "⚠️ Уже обрабатывается другое событие."
    );

    return;
  }

  processingEvent = true;

  try {
    // ========================================================
    // 1. ОТПРАВЛЯЕМ ПОЛЬЗОВАТЕЛЬСКИЙ ТЕКСТ В DEEPSEEK
    // ========================================================

    console.log("");
    console.log(
      "➡️ ШАГ 1: отправляем сообщение в DeepSeek"
    );

    const deepSeekAnswer =
      await askDeepSeek(text);

    // ========================================================
    // 2. ЕСЛИ DEEPSEEK НЕ ОТВЕТИЛ
    // ========================================================

    if (!deepSeekAnswer) {
      console.error(
        "❌ DeepSeek не вернул ответ."
      );

      await sendBitrixMessage(
        dialogId,
        "Не удалось получить ответ от DeepSeek. Проверь DEEPSEEK_API_KEY и логи Render."
      );

      return;
    }

    // ========================================================
    // 3. ОТПРАВЛЯЕМ ОТВЕТ В BITRIX
    // ========================================================

    console.log("");
    console.log(
      "➡️ ШАГ 2: отправляем ответ DeepSeek в Bitrix"
    );

    await sendBitrixMessage(
      dialogId,
      deepSeekAnswer
    );
  } catch (error) {
    console.error(
      "❌ Ошибка обработки события:",
      error
    );

    try {
      await sendBitrixMessage(
        dialogId,
        "Произошла ошибка при обработке сообщения."
      );
    } catch (sendError) {
      console.error(
        "❌ Не удалось отправить сообщение об ошибке:",
        sendError
      );
    }
  } finally {
    processingEvent = false;
  }
}

// ============================================================
// FETCH LOOP
// ============================================================

async function startFetch() {
  if (fetchRunning) {
    return;
  }

  fetchRunning = true;

  console.log("");
  console.log("========================================");
  console.log("🚀 FETCH LOOP STARTED");
  console.log("========================================");

  // Первый запрос сразу
  await fetchEvents();

  // Затем каждые 3 секунды
  setInterval(async () => {
    if (fetchRunning === false) {
      return;
    }

    await fetchEvents();
  }, 3000);
}

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(signal) {
  console.log("");
  console.log("========================================");
  console.log(`🛑 ${signal}`);
  console.log("========================================");

  fetchRunning = false;

  server.close(() => {
    console.log("✅ Server closed");
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