require("dotenv").config();

const http = require("http");

// ============================================================
// MLK AI BOT — BITRIX24 OPENLINE TEST BRIDGE
// ============================================================
//
// ЦЕЛЬ ЭТОЙ ВЕРСИИ:
//
// Telegram
//    ↓
// Bitrix24 Contact Center / Open Line
//    ↓
// Bitrix24 Chatbot 2.0
//    ↓
// Render
//    ↓
// этот файл
//    ↓
// Bitrix24 API
//    ↓
// Telegram
//
// Пока НЕ используем DeepSeek.
// Пока НЕ создаём сделки.
// Пока НЕ трогаем CRM.
//
// Наша задача сейчас — проверить транспорт.
// ============================================================


// ============================================================
// ENV
// ============================================================

const BITRIX_WEBHOOK_URL =
  (process.env.BITRIX_WEBHOOK_URL || "").trim();

const BITRIX_BOT_TOKEN =
  (process.env.BITRIX_BOT_TOKEN || "").trim();

const BITRIX_HANDLER_URL =
  (
    process.env.BITRIX_HANDLER_URL ||
    "https://mlk-bot.onrender.com/bitrix-webhook"
  ).trim();

const BOT_CODE =
  (
    process.env.BITRIX_BOT_CODE ||
    "mlk_ai_consultant_v2"
  ).trim();

const PORT =
  Number(process.env.PORT || 10000);


// ============================================================
// BOT ID
// ============================================================

// Мы уже знаем настоящий Bot ID из Bitrix24:
//
// Дмитрий MLK
// ID = 1787
//
// Если Bitrix24 вернёт другой ID — код автоматически его использует.

let BOT_ID = null;


// ============================================================
// STARTUP CHECK
// ============================================================

console.log("");
console.log("========================================");
console.log("MLK BITRIX24 TEST BRIDGE");
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
  "BITRIX_HANDLER_URL:",
  BITRIX_HANDLER_URL
);

console.log(
  "BOT_CODE:",
  BOT_CODE
);

console.log(
  "PORT:",
  PORT
);

console.log("========================================");


if (!BITRIX_WEBHOOK_URL) {
  console.error("❌ BITRIX_WEBHOOK_URL не задан");
  process.exit(1);
}

if (!BITRIX_BOT_TOKEN) {
  console.error("❌ BITRIX_BOT_TOKEN не задан");
  process.exit(1);
}

if (BITRIX_BOT_TOKEN.length > 40) {
  console.error(
    "❌ BITRIX_BOT_TOKEN длиннее 40 символов."
  );

  process.exit(1);
}


// ============================================================
// BITRIX REST
// ============================================================

async function bitrixCall(method, params = {}) {

  const base =
    BITRIX_WEBHOOK_URL.replace(/\/+$/, "");

  const url =
    `${base}/${method}`;

  console.log("");
  console.log("➡️ BITRIX API:", method);

  try {

    const response = await fetch(url, {

      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },

      body: JSON.stringify(params)

    });

    const text =
      await response.text();

    console.log(
      "⬅️ HTTP:",
      response.status
    );

    console.log(
      "⬅️ RESPONSE:",
      text
    );

    let data;

    try {

      data =
        JSON.parse(text);

    } catch (error) {

      throw new Error(
        `Bitrix вернул не JSON: ${text.substring(0, 1000)}`
      );

    }

    if (data.error) {

      throw new Error(
        `${data.error}: ${
          data.error_description || ""
        }`
      );

    }

    return data.result;

  } catch (error) {

    console.error(
      "❌ BITRIX API ERROR:",
      error.message
    );

    throw error;

  }

}


// ============================================================
// PARSE BITRIX WEBHOOK
// ============================================================
//
// Bitrix24 webhook может прийти как:
//
// application/x-www-form-urlencoded
//
// например:
//
// event=ONIMBOTV2MESSAGEADD
// &data[bot][id]=1787
// &data[message][text]=Привет
//
// Но для диагностики также поддерживаем JSON.
// ============================================================

function parseBitrixBody(body, contentType) {

  if (!body) {
    return {};
  }


  // ----------------------------------------------------------
  // JSON
  // ----------------------------------------------------------

  if (
    contentType &&
    contentType.toLowerCase().includes("application/json")
  ) {

    try {

      return JSON.parse(body);

    } catch (error) {

      console.error(
        "❌ JSON parse error:",
        error.message
      );

      return {};
    }

  }


  // ----------------------------------------------------------
  // FORM DATA
  // ----------------------------------------------------------

  const params =
    new URLSearchParams(body);

  const result = {};


  for (const [key, value] of params.entries()) {

    const parts =
      key.match(/[^\[\]]+/g);

    if (!parts || !parts.length) {
      continue;
    }

    let target =
      result;


    for (
      let i = 0;
      i < parts.length - 1;
      i++
    ) {

      if (
        !target[parts[i]] ||
        typeof target[parts[i]] !== "object"
      ) {

        target[parts[i]] = {};

      }

      target =
        target[parts[i]];

    }


    target[
      parts[parts.length - 1]
    ] = value;

  }


  return result;
}


// ============================================================
// READ HTTP BODY
// ============================================================

function readBody(req) {

  return new Promise(
    (resolve, reject) => {

      let body = "";

      req.on(
        "data",
        chunk => {

          body +=
            chunk.toString();

          if (
            body.length >
            5 * 1024 * 1024
          ) {

            reject(
              new Error(
                "Request body too large"
              )
            );

            req.destroy();

          }

        }
      );


      req.on(
        "end",
        () => resolve(body)
      );


      req.on(
        "error",
        reject
      );

    }
  );

}


// ============================================================
// FIND BOT
// ============================================================
//
// ВАЖНО:
//
// Мы НЕ пытаемся каждый раз создавать нового бота.
//
// Бот уже существует:
//
// ID = 1787
//
// Поэтому сначала получаем список ботов.
// ============================================================

async function findBot() {

  console.log("");
  console.log("🤖 Проверяем бота Bitrix24...");


  const bots =
    await bitrixCall(
      "imbot.bot.list",
      {}
    );


  console.log(
    "📋 Список ботов получен."
  );


  if (!bots) {

    throw new Error(
      "Bitrix24 не вернул список ботов."
    );

  }


  // ----------------------------------------------------------
  // Bitrix может вернуть объект вида:
//
// {
//   "5": {...},
//   "1787": {...}
// }
//
// или массив.
// ----------------------------------------------------------

  let list = [];


  if (Array.isArray(bots)) {

    list = bots;

  } else {

    list =
      Object.values(bots);

  }


  const bot =
    list.find(
      item =>
        String(item.ID || item.id) === "1787"
    )
    ||
    list.find(
      item =>
        String(item.CODE || item.code) === BOT_CODE
    );


  if (!bot) {

    console.error(
      "❌ Наш бот не найден."
    );

    console.log(
      "Доступные боты:",
      JSON.stringify(
        list,
        null,
        2
      )
    );

    throw new Error(
      "Бот MLK / Дмитрий не найден."
    );

  }


  BOT_ID =
    Number(
      bot.ID ||
      bot.id
    );


  console.log("");
  console.log(
    "✅ НАШ БОТ НАЙДЕН"
  );

  console.log(
    "Bot ID:",
    BOT_ID
  );

  console.log(
    "Bot NAME:",
    bot.NAME ||
    bot.name
  );

  console.log(
    "Bot CODE:",
    bot.CODE ||
    bot.code
  );

  console.log(
    "OpenLine:",
    bot.OPENLINE
  );


  return bot;

}


// ============================================================
// UPDATE BOT
// ============================================================
//
// Здесь мы НЕ регистрируем нового бота.
//
// Мы обновляем уже существующего.
//
// Bitrix24 автоматически подписывает Chatbot 2.0
// на события ONIMBOTV2* при eventMode=webhook.
// ============================================================

async function updateBot() {

  if (!BOT_ID) {

    throw new Error(
      "BOT_ID отсутствует."
    );

  }


  console.log("");
  console.log(
    "🔧 Обновляем настройки Chatbot 2.0..."
  );


  try {

    const result =
      await bitrixCall(
        "imbot.v2.Bot.update",
        {

          botId:
            BOT_ID,

          botToken:
            BITRIX_BOT_TOKEN,

          fields: {

            eventMode:
              "webhook",

            webhookUrl:
              BITRIX_HANDLER_URL,

            isSupportOpenline:
              true,

            properties: {

              name:
                "Дмитрий",

              lastName:
                "MLK",

              workPosition:
                "AI-консультант MLK",

              gender:
                "M"

            }

          }

        }
      );


    console.log("");
    console.log(
      "✅ BOT UPDATE УСПЕШНО"
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );


    return result;

  } catch (error) {

    console.error("");
    console.error(
      "❌ BOT UPDATE ERROR:"
    );

    console.error(
      error.message
    );

    console.error("");
    console.error(
      "Если здесь будет BOT_OWNERSHIP_ERROR,"
    );

    console.error(
      "значит BITRIX_BOT_TOKEN не является токеном владельца этого бота."
    );

    throw error;

  }

}


// ============================================================
// SEND MESSAGE TO BITRIX
// ============================================================

async function sendBitrixMessage(
  dialogId,
  message
) {

  if (!BOT_ID) {

    throw new Error(
      "BOT_ID не установлен."
    );

  }


  if (!dialogId) {

    throw new Error(
      "dialogId отсутствует."
    );

  }


  console.log("");
  console.log(
    "📤 ОТПРАВЛЯЕМ СООБЩЕНИЕ В BITRIX"
  );

  console.log(
    "Bot ID:",
    BOT_ID
  );

  console.log(
    "Dialog ID:",
    dialogId
  );

  console.log(
    "Message:",
    message
  );


  const result =
    await bitrixCall(
      "imbot.v2.Chat.Message.send",
      {

        botId:
          BOT_ID,

        botToken:
          BITRIX_BOT_TOKEN,

        dialogId:
          String(dialogId),

        fields: {

          message:
            message,

          urlPreview:
            true

        }

      }
    );


  console.log("");
  console.log(
    "✅ СООБЩЕНИЕ ОТПРАВЛЕНО В BITRIX"
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );


  return result;

}


// ============================================================
// EXTRACT MESSAGE FROM EVENT
// ============================================================

function extractEventData(event) {

  const data =
    event?.data || {};


  const bot =
    data.bot || {};


  const message =
    data.message || {};


  const chat =
    data.chat || {};


  const user =
    data.user || {};


  return {

    bot,

    message,

    chat,

    user

  };

}


// ============================================================
// HANDLE BITRIX EVENT
// ============================================================

async function handleBitrixEvent(event) {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "📩 BITRIX EVENT RECEIVED"
  );

  console.log(
    "========================================"
  );


  console.log(
    "EVENT:",
    event?.event
  );


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


  // ----------------------------------------------------------
  // TEST
  // ----------------------------------------------------------

  if (
    event?.event === "TEST"
  ) {

    console.log(
      "ℹ️ Это тестовый запрос Bitrix."
    );

    return;

  }


  const {
    bot,
    message,
    chat,
    user
  } =
    extractEventData(event);


  console.log("");
  console.log(
    "Bot ID:",
    bot.id
  );

  console.log(
    "Bot CODE:",
    bot.code
  );

  console.log(
    "User ID:",
    user.id
  );

  console.log(
    "User:",
    user.name ||
    user.firstName ||
    ""
  );

  console.log(
    "Chat ID:",
    chat.id ||
    message.chatId ||
    ""
  );

  console.log(
    "Dialog ID:",
    chat.dialogId ||
    ""
  );

  console.log(
    "Entity Type:",
    chat.entityType ||
    ""
  );

  console.log(
    "Message ID:",
    message.id ||
    message.messageId ||
    ""
  );

  console.log(
    "Message:",
    message.text ||
    message.message ||
    ""
  );


  // ----------------------------------------------------------
  // Проверяем Bot ID
  // ----------------------------------------------------------

  if (
    bot.id &&
    BOT_ID &&
    String(bot.id) !== String(BOT_ID)
  ) {

    console.warn(
      `⚠️ Событие относится к другому боту. ` +
      `Получен ${bot.id}, ожидается ${BOT_ID}.`
    );

    return;

  }


  // ----------------------------------------------------------
  // Нас интересует новое сообщение
  // ----------------------------------------------------------

  const eventName =
    String(
      event?.event ||
      ""
    ).toUpperCase();


  if (
    eventName !==
    "ONIMBOTV2MESSAGEADD"
  ) {

    console.log(
      "ℹ️ Это не ONIMBOTV2MESSAGEADD."
    );

    console.log(
      "Событие:",
      eventName
    );

    return;

  }


  // ----------------------------------------------------------
  // Получаем текст
  // ----------------------------------------------------------

  const clientText =
    String(
      message.text ||
      message.message ||
      ""
    ).trim();


  if (!clientText) {

    console.log(
      "ℹ️ Сообщение не содержит текста."
    );

    return;

  }


  // ----------------------------------------------------------
  // Получаем dialogId
  // ----------------------------------------------------------

  let dialogId =
    chat.dialogId;


  if (!dialogId) {

    const chatId =
      message.chatId ||
      chat.id;


    if (chatId) {

      dialogId =
        `chat${chatId}`;

    }

  }


  if (!dialogId) {

    console.error(
      "❌ НЕ УДАЛОСЬ ОПРЕДЕЛИТЬ dialogId"
    );

    return;

  }


  console.log("");
  console.log(
    "🎯 ДИАЛОГ:",
    dialogId
  );


  // ----------------------------------------------------------
  // Имя клиента
  // ----------------------------------------------------------

  const firstName =
    user.firstName ||
    user.name ||
    "клиент";


  // ----------------------------------------------------------
  // ПОКА ФИКСИРОВАННЫЙ ОТВЕТ
  // ----------------------------------------------------------

  const reply =
    `Здравствуйте, ${firstName}! 👋\n\n` +

    `Это тестовый AI-консультант MLK.\n\n` +

    `Я получил ваше сообщение через Битрикс24.\n\n` +

    `Ваше сообщение:\n` +

    `«${clientText.slice(0, 1000)}»\n\n` +

    `Если вы видите этот ответ в Telegram — ` +

    `связка Telegram → Битрикс24 → Render → Битрикс24 работает.`;



  // ----------------------------------------------------------
  // ОТПРАВЛЯЕМ ОТВЕТ
  // ----------------------------------------------------------

  await sendBitrixMessage(
    dialogId,
    reply
  );


  console.log("");
  console.log(
    "🎉 ПОЛНЫЙ ТЕСТОВЫЙ ЦИКЛ ЗАВЕРШЁН"
  );

}


// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {

      try {

        // ======================================================
        // ROOT
        // ======================================================

        if (
          req.method === "GET" &&
          req.url === "/"
        ) {

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/plain; charset=utf-8"
            }
          );

          res.end(
            "MLK Bitrix24 AI Bot is running"
          );

          return;

        }


        // ======================================================
        // HEALTH
        // ======================================================

        if (
          req.method === "GET" &&
          req.url === "/health"
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

              ok:
                true,

              botId:
                BOT_ID,

              botCode:
                BOT_CODE,

              handler:
                BITRIX_HANDLER_URL,

              time:
                new Date().toISOString()

            })
          );

          return;

        }


        // ======================================================
        // BITRIX WEBHOOK
        // ======================================================

        if (
          req.method === "POST" &&
          req.url.startsWith(
            "/bitrix-webhook"
          )
        ) {

          console.log("");
          console.log(
            "========================================"
          );

          console.log(
            "🌐 HTTP POST /bitrix-webhook"
          );

          console.log(
            "Time:",
            new Date().toISOString()
          );

          console.log(
            "Content-Type:",
            req.headers["content-type"]
          );

          console.log(
            "========================================"
          );


          const body =
            await readBody(req);


          console.log("");
          console.log(
            "RAW BODY:"
          );

          console.log(
            body.substring(
              0,
              10000
            )
          );


          const event =
            parseBitrixBody(
              body,
              req.headers["content-type"]
            );


          console.log("");
          console.log(
            "PARSED EVENT:"
          );

          console.log(
            JSON.stringify(
              event,
              null,
              2
            )
          );


          // ----------------------------------------------------
          // Сразу отвечаем Bitrix
          // ----------------------------------------------------

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify({
              ok:
                true
            })
          );


          // ----------------------------------------------------
          // Потом обрабатываем событие
          // ----------------------------------------------------

          handleBitrixEvent(
            event
          ).catch(
            error => {

              console.error("");

              console.error(
                "❌ EVENT HANDLER ERROR:"
              );

              console.error(
                error.stack ||
                error.message
              );

            }
          );


          return;

        }


        // ======================================================
        // 404
        // ======================================================

        res.writeHead(
          404,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        res.end(
          "Not Found"
        );


      } catch (error) {

        console.error("");

        console.error(
          "❌ HTTP SERVER ERROR:"
        );

        console.error(
          error.stack ||
          error.message
        );


        if (
          !res.headersSent
        ) {

          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify({
              ok:
                false,

              error:
                error.message

            })
          );

        }

      }

    }
  );


// ============================================================
// START SERVER
// ============================================================

server.listen(
  PORT,
  async () => {

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      "🚀 SERVER STARTED"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "HANDLER:",
      BITRIX_HANDLER_URL
    );

    console.log(
      "========================================"
    );


    try {

      // --------------------------------------------------------
      // Находим уже существующего бота
      // --------------------------------------------------------

      await findBot();


      // --------------------------------------------------------
      // Настраиваем webhook
      // --------------------------------------------------------

      await updateBot();


      console.log("");
      console.log(
        "========================================"
      );

      console.log(
        "🎉 BITRIX BOT READY"
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
        "WEBHOOK:",
        BITRIX_HANDLER_URL
      );

      console.log(
        "========================================"
      );

      console.log("");
      console.log(
        "Теперь можно отправить тестовое сообщение клиентом."
      );

    } catch (error) {

      console.error("");
      console.error(
        "========================================"
      );

      console.error(
        "❌ BITRIX BOT START ERROR"
      );

      console.error(
        error.stack ||
        error.message
      );

      console.error(
        "========================================"
      );

    }

  }
);


// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  reason => {

    console.error(
      "❌ UNHANDLED REJECTION:",
      reason
    );

  }
);


process.on(
  "uncaughtException",
  error => {

    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error.stack ||
      error.message
    );

  }
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.once(
  "SIGTERM",
  () => {

    console.log(
      "🛑 SIGTERM — завершаем работу..."
    );

    server.close(
      () => process.exit(0)
    );

  }
);


process.once(
  "SIGINT",
  () => {

    console.log(
      "🛑 SIGINT — завершаем работу..."
    );

    server.close(
      () => process.exit(0)
    );

  }
);