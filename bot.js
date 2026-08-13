// ============================================================
// MLK — Bitrix24 Chatbot 2.0 TEST BRIDGE
// Цель этой версии:
// Bitrix24 -> Render -> Bitrix24
//
// ВАЖНО:
// Это ТЕСТОВАЯ версия.
// DeepSeek и старый Telegram/Telegraf здесь пока НЕ используются.
// ============================================================

const http = require("http");

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;

const PORT = process.env.PORT || 10000;

// Адрес, куда Bitrix24 будет присылать события.
// Можно задать через Render Environment.
// Если переменная не задана — используется адрес нашего Render.
const BITRIX_HANDLER_URL =
  process.env.BITRIX_HANDLER_URL ||
  "https://mlk-bot.onrender.com/bitrix-webhook";

// Уникальный код нашего AI-бота в Bitrix24.
const BOT_CODE = "mlk_ai_consultant_v2";

// ------------------------------------------------------------
// ПРОВЕРКА ENV
// ------------------------------------------------------------

function checkEnvironment() {
  console.log("========================================");
  console.log("MLK Bitrix24 TEST BRIDGE");
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

  console.log("PORT:", PORT);
  console.log("BOT_CODE:", BOT_CODE);

  if (!BITRIX_WEBHOOK_URL) {
    throw new Error("BITRIX_WEBHOOK_URL не задан в Render Environment");
  }

  if (!BITRIX_BOT_TOKEN) {
    throw new Error("BITRIX_BOT_TOKEN не задан в Render Environment");
  }
}

// ------------------------------------------------------------
// BITRIX REST
// ------------------------------------------------------------

async function bitrixCall(method, payload = {}) {
  const url =
    BITRIX_WEBHOOK_URL.replace(/\/+$/, "") +
    "/" +
    method;

  console.log("");
  console.log("➡️ Bitrix API:", method);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    console.log("⬅️ HTTP:", response.status);
    console.log("⬅️ Response:", text);

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Bitrix вернул не JSON: ${text.substring(0, 500)}`
      );
    }

    if (data.error) {
      throw new Error(
        `${data.error}: ${data.error_description || ""}`
      );
    }

    return data;
  } catch (error) {
    console.error(
      "❌ Ошибка Bitrix API:",
      error.message
    );

    throw error;
  }
}

// ------------------------------------------------------------
// РЕГИСТРАЦИЯ / ОБНОВЛЕНИЕ БОТА
// ------------------------------------------------------------

async function setupBitrixBot() {
  console.log("");
  console.log("========================================");
  console.log("🤖 НАСТРОЙКА BITRIX24 БОТА");
  console.log("========================================");

  // ----------------------------------------------------------
  // 1. REGISTER
  //
  // Повторный вызов с тем же code возвращает существующего
  // бота. Это предусмотрено API Bitrix24.
  // ----------------------------------------------------------

  console.log("");
  console.log("1️⃣ Регистрируем/ищем бота...");

  const registerResult = await bitrixCall(
    "imbot.v2.Bot.register",
    {
      fields: {
        code: BOT_CODE,

        botToken: BITRIX_BOT_TOKEN,

        properties: {
          name: "Дмитрий",
          lastName: "MLK",
          workPosition: "AI-консультант MLK",
          gender: "M",
        },

        type: "bot",

        // Bitrix24 будет отправлять события
        // непосредственно на наш Render.
        eventMode: "webhook",

        webhookUrl: BITRIX_HANDLER_URL,

        // Разрешаем работу в Открытых линиях.
        isSupportOpenline: true,

        isHidden: false,
        isReactionsEnabled: true,
      },
    }
  );

  const bot =
    registerResult?.result?.bot;

  if (!bot || !bot.id) {
    throw new Error(
      "Bitrix24 не вернул ID бота после регистрации"
    );
  }

  const botId = Number(bot.id);

  console.log("");
  console.log("✅ BOT REGISTERED / FOUND");
  console.log("Bot ID:", botId);
  console.log("Bot code:", bot.code);
  console.log(
    "OpenLine support:",
    bot.isSupportOpenline
  );
  console.log(
    "Event mode:",
    bot.eventMode
  );

  // ----------------------------------------------------------
  // 2. UPDATE
  //
  // Это важно:
  // если бот уже существовал раньше, register является
  // idempotent и не обязан менять его настройки.
  //
  // Поэтому явно обновляем webhook + OpenLine.
  // ----------------------------------------------------------

  console.log("");
  console.log("2️⃣ Обновляем настройки бота...");

  const updateResult = await bitrixCall(
    "imbot.v2.Bot.update",
    {
      botId,
      botToken: BITRIX_BOT_TOKEN,

      fields: {
        properties: {
          name: "Дмитрий",
          lastName: "MLK",
          workPosition: "AI-консультант MLK",
          gender: "M",
        },

        eventMode: "webhook",

        webhookUrl:
          BITRIX_HANDLER_URL,

        isSupportOpenline: true,

        isHidden: false,
        isReactionsEnabled: true,
      },
    }
  );

  const updatedBot =
    updateResult?.result?.bot;

  console.log("");
  console.log("✅ BOT UPDATED");

  if (updatedBot) {
    console.log(
      "Bot ID:",
      updatedBot.id
    );

    console.log(
      "Event mode:",
      updatedBot.eventMode
    );

    console.log(
      "OpenLine support:",
      updatedBot.isSupportOpenline
    );
  }

  console.log("");
  console.log("========================================");
  console.log("🎉 BITRIX BOT READY");
  console.log("========================================");
  console.log("BOT ID:", botId);
  console.log(
    "WEBHOOK:",
    BITRIX_HANDLER_URL
  );
}

// ------------------------------------------------------------
// ОТПРАВКА СООБЩЕНИЯ ОТ БОТА
// ------------------------------------------------------------

async function sendBitrixMessage(
  botId,
  dialogId,
  message
) {
  return bitrixCall(
    "imbot.v2.Chat.Message.send",
    {
      botId: Number(botId),

      botToken:
        BITRIX_BOT_TOKEN,

      dialogId: String(dialogId),

      fields: {
        message,
      },
    }
  );
}

// ------------------------------------------------------------
// HTTP SERVER
// ------------------------------------------------------------

const server =
  http.createServer(async (req, res) => {

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (
      req.method === "GET" &&
      req.url === "/"
    ) {
      res.writeHead(200, {
        "Content-Type":
          "text/plain; charset=utf-8",
      });

      res.end(
        "MLK Bitrix24 TEST BRIDGE: OK"
      );

      return;
    }

    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (
      req.method === "GET" &&
      req.url === "/health"
    ) {
      res.writeHead(200, {
        "Content-Type":
          "application/json; charset=utf-8",
      });

      res.end(
        JSON.stringify({
          ok: true,
          service:
            "mlk-bitrix-test-bridge",
          time: new Date().toISOString(),
        })
      );

      return;
    }

    // --------------------------------------------------------
    // BITRIX WEBHOOK
    // --------------------------------------------------------

    if (
      req.method === "POST" &&
      req.url === "/bitrix-webhook"
    ) {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        console.log("");
        console.log("========================================");
        console.log("📩 BITRIX EVENT RECEIVED");
        console.log("========================================");

        try {
          // --------------------------------------------------
          // Bitrix24 imbot.v2 webhook присылает JSON.
          // --------------------------------------------------

          let event;

          try {
            event = JSON.parse(body);
          } catch (error) {
            console.error(
              "❌ Не удалось разобрать JSON"
            );

            console.error(
              body.substring(0, 2000)
            );

            res.writeHead(400, {
              "Content-Type":
                "application/json",
            });

            res.end(
              JSON.stringify({
                ok: false,
                error:
                  "Invalid JSON",
              })
            );

            return;
          }

          console.log(
            "EVENT:",
            event.event
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

          // --------------------------------------------------
          // Данные события.
          // --------------------------------------------------

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
            "Bot ID:",
            bot.id
          );

          console.log(
            "User:",
            user.id,
            user.name ||
              user.firstName ||
              ""
          );

          console.log(
            "Dialog ID:",
            chat.dialogId
          );

          console.log(
            "Message ID:",
            message.id ||
              message.messageId
          );

          console.log(
            "Message:",
            message.text ||
              message.message ||
              ""
          );

          // --------------------------------------------------
          // Главное событие:
          // пользователь написал боту.
          // --------------------------------------------------

          if (
            event.event ===
            "ONIMBOTV2MESSAGEADD"
          ) {
            const botId =
              bot.id;

            const dialogId =
              chat.dialogId;

            const clientText =
              message.text ||
              message.message ||
              "";

            console.log("");
            console.log(
              "💬 CLIENT MESSAGE:"
            );

            console.log(
              clientText
            );

            // ------------------------------------------------
            // Пока НЕ вызываем DeepSeek.
            //
            // Отправляем простой тестовый ответ.
            // ------------------------------------------------

            if (
              botId &&
              dialogId
            ) {
              await sendBitrixMessage(
                botId,
                dialogId,
                "Здравствуйте! 👋\n\n" +
                "Это тестовая версия AI-консультанта MLK.\n" +
                "Сообщение успешно дошло до Render через Bitrix24.\n\n" +
                "Связка Bitrix24 → Render → Bitrix24 работает."
              );

              console.log("");
              console.log(
                "✅ TEST RESPONSE SENT"
              );
            } else {
              console.error(
                "❌ Нет botId или dialogId"
              );
            }
          }

          // --------------------------------------------------
          // Бот добавлен в чат
          // --------------------------------------------------

          if (
            event.event ===
            "ONIMBOTV2JOINCHAT"
          ) {
            console.log(
              "🤖 Бот добавлен в чат."
            );

            console.log(
              "Dialog ID:",
              data.dialogId
            );
          }

          // --------------------------------------------------
          // Бот удалён
          // --------------------------------------------------

          if (
            event.event ===
            "ONIMBOTV2DELETE"
          ) {
            console.log(
              "⚠️ Бот удалён из чата."
            );
          }

          // --------------------------------------------------
          // ВСЕГДА подтверждаем получение события.
          // --------------------------------------------------

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
            })
          );

        } catch (error) {
          console.error("");
          console.error(
            "❌ ERROR PROCESSING BITRIX EVENT"
          );

          console.error(
            error.stack ||
              error.message
          );

          // Bitrix всё равно получает HTTP-ответ.
          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: false,
              error:
                error.message,
            })
          );
        }
      });

      return;
    }

    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    res.writeHead(404, {
      "Content-Type":
        "text/plain; charset=utf-8",
    });

    res.end("Not Found");
  });

// ------------------------------------------------------------
// START
// ------------------------------------------------------------

async function start() {
  try {
    checkEnvironment();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log("");
        console.log(
          `🌐 HTTP server listening on port ${PORT}`
        );

        console.log(
          `🔗 Bitrix handler: ${BITRIX_HANDLER_URL}`
        );
      }
    );

    // Небольшая задержка, чтобы HTTP-сервер
    // уже был доступен к моменту настройки бота.
    setTimeout(async () => {
      try {
        await setupBitrixBot();
      } catch (error) {
        console.error("");
        console.error(
          "❌ BITRIX SETUP FAILED"
        );

        console.error(
          error.stack ||
            error.message
        );
      }
    }, 1000);

  } catch (error) {
    console.error("");
    console.error(
      "❌ STARTUP FAILED"
    );

    console.error(
      error.stack ||
        error.message
    );

    process.exit(1);
  }
}

start();