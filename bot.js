require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");

// ============================================================
// MLK AI BOT — BITRIX24 FETCH TEST
// ============================================================
//
// ЦЕЛЬ ЭТОЙ ВЕРСИИ:
//
// Telegram
//    ↓
// Bitrix24 Contact Center / Open Line
//    ↓
// Chatbot 2.0 "Дмитрий MLK"
//    ↓
// imbot.v2.Event.get
//    ↓
// Render
//    ↓
// обработка события
//    ↓
// imbot.v2.Chat.Message.send
//    ↓
// Bitrix24
//    ↓
// Telegram
//
// DeepSeek пока НЕ используется.
// CRM пока НЕ используется.
//
// Задача:
// доказать, что Bitrix24 отдаёт сообщения нашего бота
// через FETCH.
// ============================================================


// ============================================================
// ENV
// ============================================================

const BITRIX_WEBHOOK_URL =
  (process.env.BITRIX_WEBHOOK_URL || "").trim();

const BITRIX_BOT_TOKEN =
  (process.env.BITRIX_BOT_TOKEN || "").trim();

const BOT_CODE =
  (
    process.env.BITRIX_BOT_CODE ||
    "mlk_ai_consultant_v2"
  ).trim();

const PORT =
  Number(process.env.PORT || 10000);


// Наш уже существующий бот.
const EXPECTED_BOT_ID = 1787;


// Интервал опроса Bitrix24.
// 5 секунд достаточно для теста.
const POLL_INTERVAL_MS = 5000;


// Максимальное количество событий за один запрос.
const EVENT_LIMIT = 100;


// ============================================================
// OFFSET
// ============================================================
//
// Bitrix24 использует nextOffset:
//
// первый запрос:
//   без offset
//
// последующие:
//   offset = предыдущий nextOffset
//
// Это позволяет подтверждать уже обработанные события.
//
// Для тестовой версии сохраняем offset в файл.
//
// ВАЖНО:
// Render может удалить локальный файл при новом deploy.
// Для полноценного production позже перенесём offset
// в постоянное хранилище / БД.
// ============================================================

const DATA_DIR =
  path.join(__dirname, "data");

const OFFSET_FILE =
  path.join(
    DATA_DIR,
    "bitrix-offset.json"
  );


// ============================================================
// STATE
// ============================================================

let BOT_ID =
  EXPECTED_BOT_ID;

let offset =
  null;

let polling =
  false;

let stopping =
  false;


// ============================================================
// STARTUP
// ============================================================

console.log("");
console.log("========================================");
console.log("MLK BITRIX24 FETCH TEST BRIDGE");
console.log("========================================");

console.log(
  "BITRIX_WEBHOOK_URL:",
  BITRIX_WEBHOOK_URL
    ? "OK"
    : "MISSING"
);

console.log(
  "BITRIX_BOT_TOKEN:",
  BITRIX_BOT_TOKEN
    ? "OK"
    : "MISSING"
);

console.log(
  "BOT_CODE:",
  BOT_CODE
);

console.log(
  "EXPECTED_BOT_ID:",
  EXPECTED_BOT_ID
);

console.log(
  "PORT:",
  PORT
);

console.log(
  "POLL_INTERVAL_MS:",
  POLL_INTERVAL_MS
);

console.log(
  "========================================"
);


if (!BITRIX_WEBHOOK_URL) {

  console.error(
    "❌ BITRIX_WEBHOOK_URL не задан."
  );

  process.exit(1);
}


if (!BITRIX_BOT_TOKEN) {

  console.error(
    "❌ BITRIX_BOT_TOKEN не задан."
  );

  process.exit(1);
}


if (
  BITRIX_BOT_TOKEN.length > 40
) {

  console.error(
    "❌ BITRIX_BOT_TOKEN длиннее 40 символов."
  );

  process.exit(1);
}


// ============================================================
// OFFSET LOAD
// ============================================================

function loadOffset() {

  try {

    if (
      !fs.existsSync(
        DATA_DIR
      )
    ) {

      fs.mkdirSync(
        DATA_DIR,
        {
          recursive: true
        }
      );

    }


    if (
      !fs.existsSync(
        OFFSET_FILE
      )
    ) {

      console.log(
        "ℹ️ Offset-файл отсутствует."
      );

      console.log(
        "ℹ️ Первый запрос Event.get будет выполнен без offset."
      );

      offset = null;

      return;

    }


    const raw =
      fs.readFileSync(
        OFFSET_FILE,
        "utf8"
      );


    const data =
      JSON.parse(raw);


    if (
      data &&
      Number.isInteger(
        data.offset
      )
    ) {

      offset =
        data.offset;

      console.log(
        "✅ Загружен сохранённый offset:",
        offset
      );

    } else {

      offset = null;

      console.log(
        "⚠️ Offset-файл некорректен."
      );

    }

  } catch (error) {

    console.error(
      "❌ Ошибка загрузки offset:",
      error.message
    );

    offset = null;

  }

}


// ============================================================
// OFFSET SAVE
// ============================================================

function saveOffset(
  newOffset
) {

  try {

    if (
      !fs.existsSync(
        DATA_DIR
      )
    ) {

      fs.mkdirSync(
        DATA_DIR,
        {
          recursive: true
        }
      );

    }


    fs.writeFileSync(
      OFFSET_FILE,

      JSON.stringify(
        {
          offset:
            newOffset,

          savedAt:
            new Date().toISOString()

        },

        null,

        2
      )
    );


    console.log(
      "💾 Offset сохранён:",
      newOffset
    );

  } catch (error) {

    console.error(
      "❌ Ошибка сохранения offset:",
      error.message
    );

  }

}


// ============================================================
// BITRIX REST CALL
// ============================================================

async function bitrixCall(
  method,
  params = {}
) {

  const base =
    BITRIX_WEBHOOK_URL
      .replace(/\/+$/, "");


  const url =
    `${base}/${method}`;


  console.log("");
  console.log(
    "➡️ BITRIX API:",
    method
  );


  try {

    const response =
      await fetch(
        url,
        {

          method:
            "POST",

          headers:
            {
              "Content-Type":
                "application/json",

              "Accept":
                "application/json"

            },

          body:
            JSON.stringify(
              params
            )

        }
      );


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
        JSON.parse(
          text
        );

    } catch (error) {

      throw new Error(
        "Bitrix вернул не JSON: " +
        text.substring(
          0,
          1000
        )
      );

    }


    if (
      data.error
    ) {

      throw new Error(
        `${data.error}: ${
          data.error_description ||
          ""
        }`
      );

    }


    return data.result;

  } catch (error) {

    console.error("");
    console.error(
      "❌ BITRIX API ERROR"
    );

    console.error(
      error.message
    );

    throw error;

  }

}


// ============================================================
// CHECK BOT
// ============================================================

async function checkBot() {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "🤖 ПРОВЕРЯЕМ БОТА"
  );

  console.log(
    "========================================"
  );


  const result =
    await bitrixCall(
      "imbot.v2.Bot.get",
      {

        botId:
          EXPECTED_BOT_ID,

        botToken:
          BITRIX_BOT_TOKEN

      }
    );


  console.log("");
  console.log(
    "✅ BOT.GET RESULT:"
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );


  const bot =
    result &&
    (
      result.bot ||
      result
    );


  if (
    bot &&
    bot.id
  ) {

    BOT_ID =
      Number(
        bot.id
      );

  }


  console.log("");
  console.log(
    "Bot ID:",
    BOT_ID
  );

  console.log(
    "Bot CODE:",
    bot?.code
  );

  console.log(
    "Bot TYPE:",
    bot?.type
  );

  console.log(
    "OpenLine:",
    bot?.isSupportOpenline
  );

  console.log(
    "Event mode:",
    bot?.eventMode
  );


  if (
    BOT_ID !== EXPECTED_BOT_ID
  ) {

    throw new Error(
      `Ожидался Bot ID ${EXPECTED_BOT_ID}, ` +
      `но получен ${BOT_ID}`
    );

  }


  // ----------------------------------------------------------
  // Для этой версии обязательно FETCH.
  // ----------------------------------------------------------

  if (
    bot &&
    bot.eventMode &&
    bot.eventMode !== "fetch"
  ) {

    console.log("");
    console.log(
      "⚠️ ВНИМАНИЕ:"
    );

    console.log(
      "Bitrix24 пока показывает eventMode:",
      bot.eventMode
    );

    console.log(
      "Переводим бота в FETCH..."
    );

  }


  return bot;

}


// ============================================================
// SWITCH BOT TO FETCH
// ============================================================
//
// ВАЖНО:
//
// При смене webhook → fetch Bitrix24 удаляет webhook-подписки.
// После этого события доступны через Event.get.
//
// Это штатное поведение Bitrix24.
// ============================================================

async function switchToFetch() {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "🔄 ПЕРЕКЛЮЧАЕМ БОТА В FETCH MODE"
  );

  console.log(
    "========================================"
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

          fields:
            {

              eventMode:
                "fetch"

            }

        }
      );


    console.log("");
    console.log(
      "✅ BOT UPDATE OK"
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );


    const bot =
      result?.bot;


    if (
      bot?.eventMode
    ) {

      console.log(
        "Event mode:",
        bot.eventMode
      );

    }


    return result;

  } catch (error) {

    console.error("");
    console.error(
      "❌ НЕ УДАЛОСЬ ПЕРЕКЛЮЧИТЬ БОТА В FETCH"
    );

    console.error(
      error.message
    );

    throw error;

  }

}


// ============================================================
// GET EVENTS
// ============================================================

async function getEvents() {

  const params =
    {

      botId:
        BOT_ID,

      botToken:
        BITRIX_BOT_TOKEN,

      limit:
        EVENT_LIMIT

    };


  // ----------------------------------------------------------
  // offset добавляем только если он уже известен.
  //
  // Первый запрос должен идти БЕЗ offset.
  // ----------------------------------------------------------

  if (
    offset !== null
  ) {

    params.offset =
      offset;

  }


  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "🔄 BITRIX EVENT POLL"
  );

  console.log(
    "========================================"
  );

  console.log(
    "Bot ID:",
    BOT_ID
  );

  console.log(
    "Current offset:",
    offset === null
      ? "NONE / FIRST REQUEST"
      : offset
  );


  const result =
    await bitrixCall(
      "imbot.v2.Event.get",
      params
    );


  return result;

}


// ============================================================
// HANDLE ONE EVENT
// ============================================================

async function handleEvent(
  event
) {

  console.log("");
  console.log(
    "########################################"
  );

  console.log(
    "📩 НОВОЕ СОБЫТИЕ BITRIX24"
  );

  console.log(
    "########################################"
  );


  console.log(
    "EVENT ID:",
    event.eventId
  );

  console.log(
    "TYPE:",
    event.type
  );

  console.log(
    "DATE:",
    event.date
  );


  console.log("");
  console.log(
    "FULL EVENT DATA:"
  );

  console.log(
    JSON.stringify(
      event.data,
      null,
      2
    )
  );


  const data =
    event.data || {};


  const bot =
    data.bot || {};


  const message =
    data.message || {};


  const chat =
    data.chat || {};


  const user =
    data.user || {};


  console.log("");
  console.log(
    "========== EXTRACTED DATA =========="
  );


  console.log(
    "BOT ID:",
    bot.id
  );

  console.log(
    "BOT CODE:",
    bot.code
  );

  console.log(
    "USER ID:",
    user.id
  );

  console.log(
    "USER NAME:",
    user.name
  );

  console.log(
    "USER FIRST NAME:",
    user.firstName
  );

  console.log(
    "CHAT ID:",
    chat.id
  );

  console.log(
    "DIALOG ID:",
    chat.dialogId
  );

  console.log(
    "MESSAGE ID:",
    message.id
  );

  console.log(
    "MESSAGE CHAT ID:",
    message.chatId
  );

  console.log(
    "MESSAGE AUTHOR ID:",
    message.authorId
  );

  console.log(
    "MESSAGE TEXT:",
    message.text
  );


  // ==========================================================
  // MESSAGE
  // ==========================================================

  if (
    event.type ===
    "ONIMBOTV2MESSAGEADD"
  ) {

    await handleIncomingMessage(
      data
    );

    return;

  }


  // ==========================================================
  // JOIN CHAT
  // ==========================================================

  if (
    event.type ===
    "ONIMBOTV2JOINCHAT"
  ) {

    console.log(
      "👋 БОТ БЫЛ ДОБАВЛЕН В ЧАТ."
    );

    return;

  }


  // ==========================================================
  // DELETE
  // ==========================================================

  if (
    event.type ===
    "ONIMBOTV2DELETE"
  ) {

    console.log(
      "⚠️ БОТ УДАЛЁН ИЗ BITRIX24."
    );

    return;

  }


  // ==========================================================
  // OTHER
  // ==========================================================

  console.log(
    "ℹ️ Событие получено, но для теста отдельная обработка не нужна."
  );

}


// ============================================================
// HANDLE INCOMING MESSAGE
// ============================================================

async function handleIncomingMessage(
  data
) {

  const message =
    data.message || {};

  const chat =
    data.chat || {};

  const user =
    data.user || {};


  const text =
    String(
      message.text || ""
    ).trim();


  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "💬 ПОЛУЧЕНО СООБЩЕНИЕ КЛИЕНТА"
  );

  console.log(
    "========================================"
  );


  console.log(
    "Клиент:",
    user.name ||
    user.firstName ||
    "Без имени"
  );

  console.log(
    "User ID:",
    user.id
  );

  console.log(
    "Dialog ID:",
    chat.dialogId
  );

  console.log(
    "Text:",
    text
  );


  if (!text) {

    console.log(
      "ℹ️ В сообщении нет текста."
    );

    return;

  }


  if (!chat.dialogId) {

    console.error(
      "❌ Нет chat.dialogId."
    );

    return;

  }


  // ==========================================================
  // ПОКА НЕ DEEPSEEK
  // ==========================================================
  //
  // Возвращаем простой тестовый ответ.
  //
  // Если этот ответ придёт клиенту в Telegram —
  // значит вся связка Bitrix24 ↔ Render работает.
  // ==========================================================

  const reply =
    `Здравствуйте${
      user.firstName
        ? ", " + user.firstName
        : ""
    }! 👋\n\n` +

    `Я получил ваше сообщение через Битрикс24.\n\n` +

    `Ваше сообщение:\n` +

    `«${text.substring(
      0,
      1000
    )}»\n\n` +

    `Это тестовая версия интеграции MLK.\n` +

    `Связка FETCH работает. ` +

    `Следующим этапом подключим ИИ-консультанта.`;


  await sendBitrixMessage(
    chat.dialogId,
    reply
  );

}


// ============================================================
// SEND MESSAGE
// ============================================================

async function sendBitrixMessage(
  dialogId,
  text
) {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "📤 ОТПРАВКА ОТВЕТА В BITRIX24"
  );

  console.log(
    "========================================"
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
    "Text:",
    text
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

        fields:
          {

            message:
              text,

            urlPreview:
              true

          }

      }
    );


  console.log("");
  console.log(
    "✅ ОТВЕТ ОТПРАВЛЕН"
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
// POLLING LOOP
// ============================================================

async function pollBitrix() {

  if (
    stopping
  ) {

    return;

  }


  if (
    polling
  ) {

    console.log(
      "⚠️ Предыдущий polling ещё работает. Пропускаем цикл."
    );

    return;

  }


  polling =
    true;


  try {

    const result =
      await getEvents();


    if (!result) {

      console.log(
        "⚠️ Bitrix24 не вернул result."
      );

      return;

    }


    const events =
      Array.isArray(
        result.events
      )
        ? result.events
        : [];


    const nextOffset =
      Number(
        result.nextOffset
      );


    const hasMore =
      Boolean(
        result.hasMore
      );


    console.log("");
    console.log(
      "========== EVENT RESPONSE =========="
    );

    console.log(
      "Events:",
      events.length
    );

    console.log(
      "Current offset:",
      offset
    );

    console.log(
      "Next offset:",
      nextOffset
    );

    console.log(
      "Has more:",
      hasMore
    );


    // --------------------------------------------------------
    // Обрабатываем события
    // --------------------------------------------------------

    for (
      const event
      of events
    ) {

      try {

        await handleEvent(
          event
        );

      } catch (error) {

        console.error("");
        console.error(
          "❌ ОШИБКА ОБРАБОТКИ СОБЫТИЯ"
        );

        console.error(
          error.stack ||
          error.message
        );

        // ----------------------------------------------------
        // ВАЖНО:
        //
        // Не падаем всем процессом из-за одного события.
        // ----------------------------------------------------

      }

    }


    // --------------------------------------------------------
    // Подтверждаем события.
    //
    // Bitrix24 требует передавать nextOffset
    // в следующем запросе.
    // --------------------------------------------------------

    if (
      Number.isInteger(
        nextOffset
      )
    ) {

      offset =
        nextOffset;

      saveOffset(
        offset
      );

    }


    // --------------------------------------------------------
    // Если есть ещё события,
    // обработаем их немедленно.
    // --------------------------------------------------------

    if (
      hasMore
    ) {

      console.log(
        "📚 Есть ещё события. Получаем следующую пачку..."
      );

      // Сразу запускаем следующий цикл.
      setImmediate(
        pollBitrix
      );

    }

  } catch (error) {

    console.error("");
    console.error(
      "❌ POLLING ERROR"
    );

    console.error(
      error.stack ||
      error.message
    );

  } finally {

    polling =
      false;

  }

}


// ============================================================
// START POLLING
// ============================================================

function startPolling() {

  console.log("");
  console.log(
    "========================================"
  );

  console.log(
    "🔄 FETCH POLLING STARTED"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Каждые ${POLL_INTERVAL_MS / 1000} секунд`
  );

  console.log(
    "Bitrix method: imbot.v2.Event.get"
  );

  console.log(
    "Bot ID:",
    BOT_ID
  );

  console.log(
    "========================================"
  );


  // Первый запрос сразу.
  pollBitrix();


  // Затем регулярно.
  setInterval(
    pollBitrix,
    POLL_INTERVAL_MS
  );

}


// ============================================================
// HTTP SERVER
// ============================================================
//
// Render требует открытый порт.
// Webhook от Bitrix здесь НЕ используется.
//
// HTTP нужен только для:
// - Render health check
// - проверки состояния сервиса
// ============================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

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
            "MLK Bitrix24 FETCH Bot is running"
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
            JSON.stringify(
              {

                ok:
                  true,

                botId:
                  BOT_ID,

                botCode:
                  BOT_CODE,

                mode:
                  "fetch",

                offset:
                  offset,

                polling:
                  polling,

                time:
                  new Date().toISOString()

              },

              null,

              2

            )
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

        console.error(
          "HTTP ERROR:",
          error.stack ||
          error.message
        );


        if (
          !res.headersSent
        ) {

          res.writeHead(
            500
          );

          res.end(
            "Internal Server Error"
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
      "🚀 HTTP SERVER STARTED"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "========================================"
    );


    try {

      // --------------------------------------------------------
      // Загружаем offset
      // --------------------------------------------------------

      loadOffset();


      // --------------------------------------------------------
      // Проверяем существующего бота
      // --------------------------------------------------------

      const bot =
        await checkBot();


      // --------------------------------------------------------
      // Если бот ещё в webhook — переводим в fetch.
      // --------------------------------------------------------

      if (
        !bot ||
        bot.eventMode !== "fetch"
      ) {

        await switchToFetch();

        // ------------------------------------------------------
        // После изменения режима ещё раз проверяем.
        // ------------------------------------------------------

        console.log("");
        console.log(
          "🔎 Повторно проверяем режим бота..."
        );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1000
            )
        );

        await checkBot();

      }


      console.log("");
      console.log(
        "========================================"
      );

      console.log(
        "🎉 BITRIX FETCH BOT READY"
      );

      console.log(
        "========================================"
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
        "MODE: FETCH"
      );

      console.log(
        "POLL:",
        `${POLL_INTERVAL_MS / 1000}s`
      );

      console.log(
        "========================================"
      );


      // --------------------------------------------------------
      // Запускаем polling.
      // --------------------------------------------------------

      startPolling();


    } catch (error) {

      console.error("");
      console.error(
        "========================================"
      );

      console.error(
        "❌ STARTUP ERROR"
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
// PROCESS ERRORS
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

function shutdown(
  signal
) {

  console.log("");
  console.log(
    `🛑 ${signal} — завершаем работу...`
  );


  stopping =
    true;


  server.close(
    () => {

      console.log(
        "✅ HTTP server closed."
      );

      process.exit(
        0
      );

    }
  );


  setTimeout(
    () => {

      console.log(
        "⚠️ Принудительное завершение."
      );

      process.exit(
        0
      );

    },
    5000
  );

}


process.once(
  "SIGTERM",
  () =>
    shutdown(
      "SIGTERM"
    )
);


process.once(
  "SIGINT",
  () =>
    shutdown(
      "SIGINT"
    )
);