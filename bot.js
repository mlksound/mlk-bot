// ============================================================
// MLK BITRIX24 BOT
// FETCH -> EVENT.GET -> CHAT.MESSAGE.SEND
// Без DeepSeek
// ============================================================

const http = require("http");

// ============================================================
// ENV
// ============================================================

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;

const BOT_ID = Number(process.env.BOT_ID || 1787);
const BOT_CODE =
  process.env.BOT_CODE || "mlk_ai_consultant_v2";

const PORT = Number(process.env.PORT || 10000);

// ============================================================
// ПРОВЕРКА ENV
// ============================================================

console.log("========================================");
console.log("MLK BITRIX FETCH -> MESSAGE SEND");
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
console.log("PORT:", PORT);

console.log("========================================");

// ============================================================
// ПРОВЕРКА ОБЯЗАТЕЛЬНЫХ ПЕРЕМЕННЫХ
// ============================================================

if (!BITRIX_WEBHOOK_URL) {
  console.error("❌ BITRIX_WEBHOOK_URL не установлен");
  process.exit(1);
}

if (!BITRIX_BOT_TOKEN) {
  console.error("❌ BITRIX_BOT_TOKEN не установлен");
  process.exit(1);
}

if (!BOT_ID) {
  console.error("❌ BOT_ID не установлен");
  process.exit(1);
}

// ============================================================
// BITRIX REST
// ============================================================

async function bitrixCall(method, params = {}) {
  const url =
    `${BITRIX_WEBHOOK_URL.replace(/\/$/, "")}/${method}`;

  console.log("----------------------------------------");
  console.log("➡️ BITRIX API:", method);

  // Никогда не печатаем настоящий botToken в лог
  const safeParams = {
    ...params
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
        "Accept": "application/json"
      },

      body: JSON.stringify(params)
    });

    const text = await response.text();

    console.log("⬅️ HTTP:", response.status);
    console.log("⬅️ RESPONSE:", text);

    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Bitrix вернул не JSON");
      return null;
    }

    if (data.error) {
      console.error(
        "❌ BITRIX ERROR:",
        data.error,
        data.error_description || ""
      );
    }

    return data;

  } catch (error) {
    console.error(
      "❌ Ошибка HTTP-запроса к Bitrix:",
      error.message
    );

    return null;
  }
}

// ============================================================
// FETCH OFFSET
// ============================================================

// ВАЖНО:
// Bitrix возвращает nextOffset.
// Его необходимо сохранять между запросами.
//
// Пока процесс Render живёт — храним в памяти.
//
// При перезапуске Render начинаем с 0.
// Это нормально для нашего диагностического теста,
// но после успешной проверки можно сделать
// постоянное хранение offset.

let currentOffset = 0;

// ============================================================
// ЗАЩИТА ОТ ПАРАЛЛЕЛЬНЫХ FETCH
// ============================================================

let polling = false;

// ============================================================
// GET EVENTS
// ============================================================

async function getEvents() {

  if (polling) {
    console.log(
      "⚠️ Предыдущий FETCH ещё выполняется."
    );
    return;
  }

  polling = true;

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

  try {

    const params = {
      botId: BOT_ID,

      botToken: BITRIX_BOT_TOKEN,

      offset: currentOffset,

      limit: 50
    };

    const data = await bitrixCall(
      "imbot.v2.Event.get",
      params
    );

    if (!data || !data.result) {

      console.error(
        "❌ Нет result в ответе Event.get"
      );

      return;
    }

    const result = data.result;

    const events = Array.isArray(result.events)
      ? result.events
      : [];

    const nextOffset =
      result.nextOffset;

    const hasMore =
      result.hasMore === true;

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

    // ========================================================
    // ОБРАБАТЫВАЕМ СОБЫТИЯ
    // ========================================================

    for (const event of events) {

      console.log("");
      console.log(
        "🎉 ПОЛУЧЕНО СОБЫТИЕ"
      );

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

      console.log(
        "----------------------------------------"
      );

      await processEvent(event);
    }

    // ========================================================
    // ОБНОВЛЯЕМ OFFSET
    // ========================================================

    if (
      typeof nextOffset === "number"
    ) {

      currentOffset = nextOffset;

      console.log(
        "➡️ OFFSET UPDATED TO:",
        currentOffset
      );
    }

    if (events.length === 0) {

      console.log(
        "📭 Новых событий нет."
      );
    }

  } catch (error) {

    console.error(
      "❌ FETCH ERROR:",
      error
    );

  } finally {

    polling = false;
  }
}

// ============================================================
// ОБРАБОТКА СОБЫТИЯ
// ============================================================

async function processEvent(event) {

  console.log(
    "FULL EVENT:"
  );

  console.log(
    JSON.stringify(
      event,
      null,
      2
    )
  );

  // ==========================================================
  // НАМ НУЖНЫ ТОЛЬКО НОВЫЕ СООБЩЕНИЯ
  // ==========================================================

  if (
    event.type !==
    "ONIMBOTV2MESSAGEADD"
  ) {

    console.log(
      "ℹ️ Событие не является сообщением."
    );

    return;
  }

  // ==========================================================
  // DATA
  // ==========================================================

  const data = event.data || {};

  const message =
    data.message || {};

  const chat =
    data.chat || {};

  const user =
    data.user || {};

  const bot =
    data.bot || {};

  // ==========================================================
  // MESSAGE
  // ==========================================================

  const messageId =
    message.id;

  const text =
    message.text || "";

  const chatId =
    message.chatId ||
    message.chat_id ||
    chat.id;

  // ==========================================================
  // DIALOG ID
  // ==========================================================

  let dialogId =
    chat.dialogId;

  // Если dialogId отсутствует,
  // для личного чата можно использовать user.id.

  if (!dialogId) {

    if (
      chat.type === "private" &&
      user.id
    ) {

      dialogId = String(user.id);
    }
  }

  // ==========================================================
  // ЛОГ
  // ==========================================================

  console.log("");
  console.log("💬 MESSAGE");
  console.log(
    "ID:",
    messageId
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

  console.log("");
  console.log("👤 USER");
  console.log(
    "ID:",
    user.id
  );

  console.log(
    "NAME:",
    user.name
  );

  console.log("");
  console.log("🤖 BOT");
  console.log(
    "ID:",
    bot.id
  );

  console.log(
    "CODE:",
    bot.code
  );

  // ==========================================================
  // ЗАЩИТА
  // ==========================================================

  if (!dialogId) {

    console.error(
      "❌ НЕ НАЙДЕН dialogId."
    );

    console.error(
      "Chat:",
      JSON.stringify(chat, null, 2)
    );

    return;
  }

  if (!text) {

    console.log(
      "ℹ️ Сообщение пустое. Ответ не отправляем."
    );

    return;
  }

  // ==========================================================
  // ЗАЩИТА ОТ ОТВЕТА НА САМОГО СЕБЯ
  // ==========================================================

  if (
    Number(message.authorId) ===
    Number(BOT_ID)
  ) {

    console.log(
      "↩️ Сообщение принадлежит самому боту."
    );

    console.log(
      "Ответ не отправляем."
    );

    return;
  }

  // ==========================================================
  // ГОТОВИМ ТЕСТОВЫЙ ОТВЕТ
  // ==========================================================

  const reply =
`FETCH OK ✅

Я получил ваше сообщение через Bitrix24.

Ваше сообщение:
«${text}»

Bot ID: ${BOT_ID}
Dialog ID: ${dialogId}

Следующий этап — подключение DeepSeek.`;

  // ==========================================================
  // ОТПРАВЛЯЕМ ОТВЕТ
  // ==========================================================

  await sendMessage(
    dialogId,
    reply
  );
}

// ============================================================
// ОТПРАВКА СООБЩЕНИЯ
// ============================================================

async function sendMessage(
  dialogId,
  text
) {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "📤 ОТПРАВЛЯЕМ ОТВЕТ В BITRIX"
  );

  console.log(
    "========================================"
  );

  console.log(
    "BOT_ID:",
    BOT_ID
  );

  console.log(
    "DIALOG_ID:",
    dialogId
  );

  console.log(
    "MESSAGE:",
    text
  );

  // ==========================================================
  // СОВРЕМЕННЫЙ API CHAT-BOTS 2.0
  // ==========================================================

  const params = {

    botId: BOT_ID,

    botToken: BITRIX_BOT_TOKEN,

    dialogId: String(dialogId),

    fields: {

      message: text,

      urlPreview: false

    }
  };

  const result =
    await bitrixCall(
      "imbot.v2.Chat.Message.send",
      params
    );

  // ==========================================================
  // АНАЛИЗ РЕЗУЛЬТАТА
  // ==========================================================

  if (!result) {

    console.error(
      "❌ Ответ от Bitrix отсутствует."
    );

    return false;
  }

  if (result.error) {

    console.error(
      "❌ НЕ УДАЛОСЬ ОТПРАВИТЬ СООБЩЕНИЕ"
    );

    console.error(
      "ERROR:",
      result.error
    );

    console.error(
      "DESCRIPTION:",
      result.error_description || ""
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
      result.result,
      null,
      2
    )
  );

  console.log(
    "========================================"
  );

  return true;
}

// ============================================================
// HTTP SERVER
// ============================================================

// Render требует, чтобы сервис слушал PORT.

const server =
  http.createServer(
    (req, res) => {

      // ------------------------------------------------------
      // HEALTH CHECK
      // ------------------------------------------------------

      if (
        req.method === "GET" &&
        req.url === "/"
      ) {

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );

        res.end(
          JSON.stringify({
            ok: true,
            service:
              "mlk-bitrix-fetch",
            mode:
              "fetch",
            botId:
              BOT_ID,
            botCode:
              BOT_CODE,
            offset:
              currentOffset
          })
        );

        return;
      }

      // ------------------------------------------------------
      // BITRIX WEBHOOK URL НЕ НУЖЕН ДЛЯ FETCH
      // ------------------------------------------------------

      if (
        req.url === "/bitrix-webhook"
      ) {

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );

        res.end(
          JSON.stringify({
            ok: true,
            mode:
              "fetch",
            message:
              "Webhook endpoint is not used in FETCH mode."
          })
        );

        return;
      }

      // ------------------------------------------------------
      // 404
      // ------------------------------------------------------

      res.writeHead(
        404,
        {
          "Content-Type":
            "application/json; charset=utf-8"
        }
      );

      res.end(
        JSON.stringify({
          error:
            "NOT_FOUND"
        })
      );
    }
  );

// ============================================================
// START
// ============================================================

server.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "🚀 SERVER STARTED"
    );

    console.log(
      "========================================"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "MODE: FETCH"
    );

    console.log(
      "BOT ID:",
      BOT_ID
    );

    console.log(
      "BOT CODE:",
      BOT_CODE
    );

    console.log(
      "========================================"
    );

    // --------------------------------------------------------
    // Первый FETCH
    // --------------------------------------------------------

    getEvents();

    // --------------------------------------------------------
    // Далее проверяем очередь каждые 3 секунды
    // --------------------------------------------------------

    setInterval(
      getEvents,
      3000
    );
  }
);

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function shutdown(
  signal
) {

  console.log("");
  console.log(
    `🛑 ${signal}`
  );

  server.close(
    () => {

      console.log(
        "✅ Server closed"
      );

      process.exit(0);
    }
  );
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
// GLOBAL ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {

    console.error(
      "❌ UNHANDLED REJECTION:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {

    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );
  }
);