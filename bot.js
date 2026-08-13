require("dotenv").config();

const http = require("http");
const fetch = require("node-fetch");

// ============================================================
// НАСТРОЙКИ
// ============================================================

const PORT = process.env.PORT || 10000;

const BITRIX_WEBHOOK_URL =
    process.env.BITRIX_WEBHOOK_URL;

const BITRIX_BOT_TOKEN =
    process.env.BITRIX_BOT_TOKEN;

const BOT_ID = 1787;

const EVENT_LIMIT = 10;

// Следующий offset FETCH
let offset = 0;

// Чтобы одновременно не запускать несколько запросов
let polling = false;

// ============================================================
// ПРОВЕРКА ENV
// ============================================================

console.log("========================================");
console.log("MLK BITRIX FETCH ECHO TEST");
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
    "BOT_ID:",
    BOT_ID
);

console.log(
    "PORT:",
    PORT
);

console.log("========================================");

// ============================================================
// BITRIX REST
// ============================================================

async function bitrixCall(method, params = {}) {

    if (!BITRIX_WEBHOOK_URL) {
        throw new Error(
            "BITRIX_WEBHOOK_URL не задан."
        );
    }

    const url =
        BITRIX_WEBHOOK_URL.replace(/\/$/, "") +
        "/" +
        method;

    console.log("");
    console.log("➡️ BITRIX API:", method);

    try {

        const response = await fetch(
            url,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(params)
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
            data = JSON.parse(text);
        } catch {
            throw new Error(
                "Bitrix вернул не JSON: " +
                text
            );
        }

        if (data.error) {

            console.error(
                "❌ BITRIX ERROR:",
                data.error
            );

            console.error(
                "❌ DESCRIPTION:",
                data.error_description
            );

            throw new Error(
                `${data.error}: ${
                    data.error_description || ""
                }`
            );
        }

        return data;

    } catch (error) {

        console.error(
            "❌ BITRIX REQUEST ERROR:",
            error.message
        );

        throw error;
    }
}

// ============================================================
// ПРОВЕРКА БОТА
// ============================================================

async function checkBot() {

    console.log("");
    console.log(
        "🤖 Проверяем бота Bitrix24..."
    );

    const result =
        await bitrixCall(
            "imbot.bot.list"
        );

    const bots =
        result.result || {};

    const bot =
        Object.values(bots).find(
            item =>
                Number(item.ID) === BOT_ID
        );

    if (!bot) {

        throw new Error(
            `Бот ${BOT_ID} не найден.`
        );
    }

    console.log("");
    console.log(
        "✅ НАШ БОТ НАЙДЕН"
    );

    console.log(
        "Bot ID:",
        bot.ID
    );

    console.log(
        "Bot NAME:",
        bot.NAME
    );

    console.log(
        "Bot CODE:",
        bot.CODE
    );

    console.log(
        "OpenLine:",
        bot.OPENLINE
    );

    return bot;
}

// ============================================================
// FETCH EVENTS
// ============================================================

async function getEvents() {

    const params = {

        botId:
            BOT_ID,

        botToken:
            BITRIX_BOT_TOKEN,

        limit:
            EVENT_LIMIT
    };

    if (offset !== null) {

        params.offset =
            offset;
    }

    return await bitrixCall(
        "imbot.v2.Event.get",
        params
    );
}

// ============================================================
// ОТПРАВКА СООБЩЕНИЯ
// ============================================================

async function sendEcho(
    chatId,
    originalText
) {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "📤 ПРОБУЕМ ОТПРАВИТЬ ОТВЕТ"
    );

    console.log(
        "Chat ID:",
        chatId
    );

    console.log(
        "Original:",
        originalText
    );

    const message =
        `ЭХО-ТЕСТ от Дмитрия 👋\n\n` +
        `Я получил ваше сообщение через FETCH:\n\n` +
        `«${originalText}»\n\n` +
        `Если вы видите это сообщение, ` +
        `значит отправка из Render обратно ` +
        `в Bitrix24 работает.`;

    console.log(
        "Message:",
        message
    );

    // ========================================================
    // ВАЖНО:
    // Сейчас специально проверяем старый REST-метод.
    // ========================================================

    const result =
        await bitrixCall(
            "imbot.message.add",
            {
                BOT_ID:
                    BOT_ID,

                DIALOG_ID:
                    "chat" + String(chatId),

                MESSAGE:
                    message
            }
        );

    console.log("");
    console.log(
        "✅ BITRIX ПРИНЯЛ ОТВЕТ"
    );

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );

    console.log(
        "========================================"
    );
}

// ============================================================
// ОБРАБОТКА СОБЫТИЯ
// ============================================================

async function processEvent(event) {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "📩 НОВОЕ СОБЫТИЕ FETCH"
    );

    console.log(
        "Event ID:",
        event.eventId
    );

    console.log(
        "Event type:",
        event.type
    );

    console.log(
        "Date:",
        event.date
    );

    const data =
        event.data || {};

    const message =
        data.message || {};

    const chat =
        data.chat || {};

    const user =
        data.user || {};

    console.log("");
    console.log(
        "👤 USER:"
    );

    console.log(
        "ID:",
        user.id
    );

    console.log(
        "Name:",
        user.name
    );

    console.log("");
    console.log(
        "💬 MESSAGE:"
    );

    console.log(
        "Message ID:",
        message.id
    );

    console.log(
        "Chat ID:",
        message.chatId ||
        message.chat_id ||
        chat.id
    );

    console.log(
        "Text:",
        message.text
    );

    // --------------------------------------------------------
    // Игнорируем пустые сообщения
    // --------------------------------------------------------

    const text =
        String(
            message.text || ""
        ).trim();

    if (!text) {

        console.log(
            "⚠️ Пустое сообщение — пропускаем."
        );

        return;
    }

    // --------------------------------------------------------
    // Игнорируем сообщения от самого бота
    // --------------------------------------------------------

    if (
        Number(message.authorId) ===
        BOT_ID
    ) {

        console.log(
            "🤖 Сообщение от самого бота — пропускаем."
        );

        return;
    }

    const chatId =
        message.chatId ||
        message.chat_id ||
        chat.id;

    if (!chatId) {

        console.error(
            "❌ Не найден Chat ID."
        );

        return;
    }

    // --------------------------------------------------------
    // ОТПРАВЛЯЕМ ЭХО
    // --------------------------------------------------------

    await sendEcho(
        chatId,
        text
    );
}

// ============================================================
// POLLING
// ============================================================

async function poll() {

    if (polling) {
        return;
    }

    polling = true;

    try {

        console.log("");
        console.log(
            "🔄 FETCH: проверяем события..."
        );

        const result =
            await getEvents();

        const data =
            result.result || {};

        const events =
            data.events || [];

        console.log(
            "📦 Получено событий:",
            events.length
        );

        console.log(
            "Current offset:",
            offset
        );

        console.log(
            "Next offset:",
            data.nextOffset
        );

        console.log(
            "Has more:",
            data.hasMore
        );

        // ----------------------------------------------------
        // Обрабатываем события
        // ----------------------------------------------------

        for (
            const event of events
        ) {

            try {

                await processEvent(
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
            }
        }

        // ----------------------------------------------------
        // Очень важно:
        // сохраняем следующий offset
        // ----------------------------------------------------

        if (
            typeof data.nextOffset ===
            "number"
        ) {

            offset =
                data.nextOffset;
        }

    } catch (error) {

        console.error("");
        console.error(
            "❌ FETCH ERROR"
        );

        console.error(
            error.stack ||
            error.message
        );

    } finally {

        polling = false;
    }
}

// ============================================================
// HTTP SERVER
// ============================================================

const server =
    http.createServer(
        async (req, res) => {

            if (
                req.url === "/" ||
                req.url === "/health"
            ) {

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/plain; charset=utf-8"
                    }
                );

                res.end(
                    "MLK Bitrix FETCH Echo Test: OK"
                );

                return;
            }

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
        }
    );

// ============================================================
// START
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
            "MODE: FETCH"
        );

        console.log(
            "BOT ID:",
            BOT_ID
        );

        console.log(
            "========================================"
        );

        try {

            await checkBot();

            console.log("");
            console.log(
                "🎉 FETCH ECHO TEST READY"
            );

            console.log(
                "Теперь напиши сообщение клиентом."
            );

            // ------------------------------------------------
            // Первый запуск сразу проверяем
            // ------------------------------------------------

            await poll();

            // ------------------------------------------------
            // Далее проверяем каждые 3 секунды
            // ------------------------------------------------

            setInterval(
                poll,
                3000
            );

        } catch (error) {

            console.error("");
            console.error(
                "❌ STARTUP ERROR"
            );

            console.error(
                error.stack ||
                error.message
            );
        }
    }
);

// ============================================================
// ERRORS
// ============================================================

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "❌ UNHANDLED REJECTION:",
            error
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
// SHUTDOWN
// ============================================================

function shutdown(
    signal
) {

    console.log("");
    console.log(
        `🛑 ${signal} — завершаем работу...`
    );

    server.close(
        () => {

            console.log(
                "✅ HTTP server closed."
            );

            process.exit(0);
        }
    );

    setTimeout(
        () => {

            process.exit(0);

        },
        5000
    );
}

process.once(
    "SIGTERM",
    () =>
        shutdown("SIGTERM")
);

process.once(
    "SIGINT",
    () =>
        shutdown("SIGINT")
);