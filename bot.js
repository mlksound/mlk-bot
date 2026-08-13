require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");

// ============================================================
// MLK AI CONSULTANT
// BITRIX24 CHATBOT 2.0 + FETCH + DEEPSEEK
// ============================================================
//
// Архитектура:
//
// Клиент Telegram
//       ↓
// Bitrix24 / Открытая линия
//       ↓
// Chatbot 2.0 "Дмитрий MLK" (ID 1787)
//       ↓
// imbot.v2.Event.get
//       ↓
// Render
//       ↓
// DeepSeek
//       ↓
// imbot.v2.Chat.Message.send
//       ↓
// Bitrix24
//       ↓
// Telegram
//
// ============================================================


// ============================================================
// ENV
// ============================================================

const BITRIX_WEBHOOK_URL =
    (process.env.BITRIX_WEBHOOK_URL || "").trim();

const BITRIX_BOT_TOKEN =
    (process.env.BITRIX_BOT_TOKEN || "").trim();

const DEEPSEEK_API_KEY =
    (process.env.DEEPSEEK_API_KEY || "").trim();

const BOT_CODE =
    (
        process.env.BITRIX_BOT_CODE ||
        "mlk_ai_consultant_v2"
    ).trim();

const EXPECTED_BOT_ID =
    Number(process.env.BITRIX_BOT_ID || 1787);

const PORT =
    Number(process.env.PORT || 10000);


// ============================================================
// SETTINGS
// ============================================================

const POLL_INTERVAL_MS = 3000;

const EVENT_LIMIT = 50;

const SESSION_TTL =
    90 * 24 * 60 * 60 * 1000;

// Максимум сообщений истории,
// которые отправляем DeepSeek.
// Системные сообщения сохраняются отдельно.
const MAX_HISTORY_MESSAGES = 30;


// ============================================================
// FILES
// ============================================================

const SESSIONS_DIR =
    path.join(__dirname, "sessions");

const DATA_DIR =
    path.join(__dirname, "data");

const OFFSET_FILE =
    path.join(DATA_DIR, "bitrix-offset.json");

const PROMPT_FILE =
    path.join(__dirname, "promt.txt");

const PORTFOLIO_FILE =
    path.join(__dirname, "portfolio.txt");


// ============================================================
// CHECK ENV
// ============================================================

console.log("");
console.log("========================================");
console.log("MLK AI CONSULTANT");
console.log("BITRIX24 FETCH + DEEPSEEK");
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

console.log(
    "BOT_CODE:",
    BOT_CODE
);

console.log(
    "BOT_ID:",
    EXPECTED_BOT_ID
);

console.log(
    "PORT:",
    PORT
);

console.log(
    "POLL:",
    `${POLL_INTERVAL_MS / 1000} sec`
);

console.log("========================================");


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

if (!DEEPSEEK_API_KEY) {
    console.error(
        "❌ DEEPSEEK_API_KEY не задан."
    );
    process.exit(1);
}


// ============================================================
// LOAD PROMPT
// ============================================================

let SYSTEM_PROMPT = "";

try {

    SYSTEM_PROMPT =
        fs.readFileSync(
            PROMPT_FILE,
            "utf8"
        );

    console.log(
        `✅ promt.txt загружен: ${SYSTEM_PROMPT.length} символов`
    );

} catch (error) {

    console.error(
        "❌ Не удалось загрузить promt.txt:",
        error.message
    );

    process.exit(1);
}


// ============================================================
// LOAD PORTFOLIO
// ============================================================

let PORTFOLIO_TEXT = "";

if (fs.existsSync(PORTFOLIO_FILE)) {

    try {

        PORTFOLIO_TEXT =
            fs.readFileSync(
                PORTFOLIO_FILE,
                "utf8"
            );

        console.log(
            `✅ portfolio.txt загружен: ${PORTFOLIO_TEXT.length} символов`
        );

    } catch (error) {

        console.error(
            "⚠️ Ошибка загрузки portfolio.txt:",
            error.message
        );

    }

} else {

    console.log(
        "ℹ️ portfolio.txt отсутствует. Работаем без отдельного портфолио."
    );
}


// ============================================================
// PORTFOLIO KEYWORDS
// ============================================================

const PORTFOLIO_KEYWORDS = [
    "опыт",
    "портфолио",
    "делали ли вы",
    "пример",
    "кейс",
    "проект",
    "объект",
    "работали",
    "участвовали",
    "проводили"
];


// ============================================================
// SESSION STORAGE
// ============================================================

if (!fs.existsSync(SESSIONS_DIR)) {

    fs.mkdirSync(
        SESSIONS_DIR,
        {
            recursive: true
        }
    );
}

if (!fs.existsSync(DATA_DIR)) {

    fs.mkdirSync(
        DATA_DIR,
        {
            recursive: true
        }
    );
}


// Все активные сессии в памяти.
//
// Ключ = Bitrix dialogId
//
const sessions = {};


// ============================================================
// LOAD SESSIONS
// ============================================================

function loadSessions() {

    console.log("");
    console.log("========================================");
    console.log("📂 ЗАГРУЗКА СЕССИЙ");
    console.log("========================================");

    const now =
        Date.now();

    let loaded =
        0;

    let deleted =
        0;

    let errors =
        0;

    const files =
        fs.readdirSync(
            SESSIONS_DIR
        );

    for (
        const file
        of files
    ) {

        if (
            !file.endsWith(".json")
        ) {
            continue;
        }

        const filePath =
            path.join(
                SESSIONS_DIR,
                file
            );

        try {

            const stats =
                fs.statSync(
                    filePath
                );

            if (
                now - stats.mtimeMs >
                SESSION_TTL
            ) {

                fs.unlinkSync(
                    filePath
                );

                deleted++;

                continue;
            }

            const raw =
                fs.readFileSync(
                    filePath,
                    "utf8"
                );

            const data =
                JSON.parse(
                    raw
                );

            const dialogId =
                path.basename(
                    file,
                    ".json"
                );

            if (
                Array.isArray(data)
            ) {

                sessions[dialogId] =
                    data;

                loaded++;
            }

        } catch (error) {

            errors++;

            console.error(
                `❌ Ошибка чтения ${file}:`,
                error.message
            );
        }
    }

    console.log(
        "Загружено:",
        loaded
    );

    console.log(
        "Удалено старых:",
        deleted
    );

    console.log(
        "Ошибок:",
        errors
    );

    console.log("========================================");
}


// ============================================================
// SAVE SESSION
// ============================================================

function saveSession(
    dialogId
) {

    if (
        !sessions[dialogId]
    ) {
        return;
    }

    const filePath =
        path.join(
            SESSIONS_DIR,
            `${dialogId}.json`
        );

    try {

        fs.writeFileSync(
            filePath,
            JSON.stringify(
                sessions[dialogId],
                null,
                2
            ),
            "utf8"
        );

    } catch (error) {

        console.error(
            "❌ Ошибка сохранения сессии:",
            error.message
        );
    }
}


// ============================================================
// CREATE / LOAD SESSION
// ============================================================

function ensureSession(
    dialogId,
    userFirstName
) {

    const key =
        String(dialogId);

    if (
        sessions[key]
    ) {
        return sessions[key];
    }

    const filePath =
        path.join(
            SESSIONS_DIR,
            `${key}.json`
        );

    if (
        fs.existsSync(
            filePath
        )
    ) {

        try {

            const data =
                JSON.parse(
                    fs.readFileSync(
                        filePath,
                        "utf8"
                    )
                );

            if (
                Array.isArray(data)
            ) {

                sessions[key] =
                    data;

                return sessions[key];
            }

        } catch (error) {

            console.error(
                "⚠️ Не удалось загрузить существующую сессию:",
                error.message
            );
        }
    }

    sessions[key] = [

        {
            role: "system",
            content: SYSTEM_PROMPT
        },

        {
            role: "system",
            content:
                `Имя клиента: ${
                    userFirstName ||
                    "неизвестно"
                }`
        }

    ];

    saveSession(key);

    return sessions[key];
}


// ============================================================
// OFFSET
// ============================================================

let offset =
    null;


function loadOffset() {

    try {

        if (
            !fs.existsSync(
                OFFSET_FILE
            )
        ) {

            console.log(
                "ℹ️ Offset отсутствует."
            );

            console.log(
                "ℹ️ Первый Event.get будет выполнен без offset."
            );

            offset =
                null;

            return;
        }

        const data =
            JSON.parse(
                fs.readFileSync(
                    OFFSET_FILE,
                    "utf8"
                )
            );

        if (
            Number.isInteger(
                data.offset
            )
        ) {

            offset =
                data.offset;

            console.log(
                "✅ Загружен offset:",
                offset
            );

        } else {

            offset =
                null;
        }

    } catch (error) {

        console.error(
            "❌ Ошибка загрузки offset:",
            error.message
        );

        offset =
            null;
    }
}


function saveOffset(
    newOffset
) {

    try {

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
            ),
            "utf8"
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
// BITRIX REST
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
        "➡️ BITRIX:",
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

        let data;

        try {

            data =
                JSON.parse(
                    text
                );

        } catch {

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

        console.error(
            "❌ BITRIX API ERROR:",
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
        "🤖 ПРОВЕРКА БОТА BITRIX24"
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

    const bot =
        result?.bot ||
        result;

    console.log(
        "Bot ID:",
        bot?.id
    );

    console.log(
        "Bot code:",
        bot?.code
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
        Number(bot?.id) !==
        EXPECTED_BOT_ID
    ) {

        throw new Error(
            `Получен неправильный Bot ID. ` +
            `Ожидался ${EXPECTED_BOT_ID}, ` +
            `получен ${bot?.id}`
        );
    }

    if (
        bot?.eventMode !==
        "fetch"
    ) {

        throw new Error(
            `Бот 1787 сейчас работает не в FETCH. ` +
            `Текущий режим: ${bot?.eventMode}`
        );
    }

    console.log(
        "✅ Бот 1787 находится в FETCH."
    );

    return bot;
}


// ============================================================
// GET EVENTS
// ============================================================

async function getEvents() {

    const params =
        {
            botId:
                EXPECTED_BOT_ID,

            botToken:
                BITRIX_BOT_TOKEN,

            limit:
                EVENT_LIMIT
        };

    if (
        offset !== null
    ) {

        params.offset =
            offset;
    }

    return await bitrixCall(
        "imbot.v2.Event.get",
        params
    );
}


// ============================================================
// SEND MESSAGE TO BITRIX
// ============================================================

async function sendBitrixMessage(
    dialogId,
    text
) {

    const cleanText =
        String(
            text || ""
        ).trim();

    if (
        !cleanText
    ) {
        return;
    }

    console.log("");
    console.log(
        "📤 ОТПРАВКА ОТВЕТА"
    );

    console.log(
        "Dialog ID:",
        dialogId
    );

    console.log(
        "Text:",
        cleanText
    );

    const result =
        await bitrixCall(
            "imbot.v2.Chat.Message.send",
            {
                botId:
                    EXPECTED_BOT_ID,

                botToken:
                    BITRIX_BOT_TOKEN,

                dialogId:
                    String(dialogId),

                fields:
                    {
                        message:
                            cleanText,

                        urlPreview:
                            true
                    }
            }
        );

    console.log(
        "✅ Ответ отправлен в Bitrix24."
    );

    return result;
}


// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(
    userMessage,
    dialogId,
    userFirstName,
    addPortfolio = false
) {

    const key =
        String(dialogId);

    const messages =
        ensureSession(
            key,
            userFirstName
        );

    let messageForAI =
        userMessage;

    // --------------------------------------------------------
    // Если клиент спрашивает про опыт / проекты,
    // добавляем portfolio.txt.
    // --------------------------------------------------------

    if (
        addPortfolio &&
        PORTFOLIO_TEXT
    ) {

        messageForAI =
            `Отвечай на вопрос клиента, используя `
            + `ТОЛЬКО информацию из списка проектов ниже. `
            + `Не выдумывай проекты, которых нет в списке.\n\n`
            + `СПИСОК ПРОЕКТОВ:\n`
            + PORTFOLIO_TEXT
            + `\n\nВОПРОС КЛИЕНТА:\n`
            + userMessage;
    }

    messages.push(
        {
            role:
                "user",

            content:
                messageForAI
        }
    );

    console.log("");
    console.log(
        "🧠 DEEPSEEK"
    );

    console.log(
        "Dialog:",
        dialogId
    );

    console.log(
        "History messages:",
        messages.length
    );

    const response =
        await fetch(
            "https://api.deepseek.com/v1/chat/completions",
            {
                method:
                    "POST",

                headers:
                    {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${DEEPSEEK_API_KEY}`
                    },

                body:
                    JSON.stringify(
                        {
                            model:
                                "deepseek-chat",

                            messages:
                                messages,

                            temperature:
                                0.7
                        }
                    )
            }
        );

    const raw =
        await response.text();

    let data;

    try {

        data =
            JSON.parse(
                raw
            );

    } catch {

        throw new Error(
            "DeepSeek вернул не JSON: " +
            raw.substring(
                0,
                1000
            )
        );
    }

    if (
        data.error
    ) {

        throw new Error(
            "DeepSeek API error: " +
            (
                data.error.message ||
                JSON.stringify(
                    data.error
                )
            )
        );
    }

    if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message
    ) {

        throw new Error(
            "DeepSeek не вернул сообщение."
        );
    }

    const reply =
        String(
            data.choices[0].message.content ||
            ""
        ).trim();

    if (
        !reply
    ) {

        throw new Error(
            "DeepSeek вернул пустой ответ."
        );
    }

    // --------------------------------------------------------
    // В истории сохраняем исходный вопрос,
    // а не технический prompt с portfolio.txt.
    // --------------------------------------------------------

    messages[messages.length - 1] =
        {
            role:
                "user",

            content:
                userMessage
        };

    messages.push(
        {
            role:
                "assistant",

            content:
                reply
        }
    );

    // --------------------------------------------------------
    // Ограничиваем историю.
    // --------------------------------------------------------

    if (
        messages.length >
        MAX_HISTORY_MESSAGES + 2
    ) {

        const systemMessages =
            messages.filter(
                m =>
                    m.role ===
                    "system"
            );

        const conversationMessages =
            messages.filter(
                m =>
                    m.role !==
                    "system"
            );

        const trimmed =
            conversationMessages.slice(
                -MAX_HISTORY_MESSAGES
            );

        sessions[key] =
            [
                ...systemMessages,
                ...trimmed
            ];
    }

    saveSession(
        key
    );

    console.log(
        "✅ DeepSeek ответ получен."
    );

    return reply;
}


// ============================================================
// TAGS
// ============================================================
//
// В старом Telegram-боте теги превращались в inline keyboard
// Telegraf.
//
// Сейчас транспортом является Bitrix24.
//
// Поэтому на первом этапе мы безопасно превращаем теги
// в понятный текстовый вопрос.
//
// Это позволяет сохранить логику promt.txt без риска
// сломать FETCH-интеграцию.
// ============================================================

const TAG_MESSAGES =
    {

        ask_format:
            "Выберите формат мероприятия: Концерты и фестивали, Конференции и презентации, Корпоративы и торжества, Выставки или Спортивные мероприятия.",

        ask_level:
            "Укажите уровень мероприятия: Стандартный, Высокие требования (например, ТВ-трансляция) или Высший уровень.",

        ask_personnel:
            "Какой персонал необходим: управление оборудованием, дежурный техник, только монтаж-демонтаж или другой вариант?",

        ask_place:
            "Где проходит мероприятие: на улице, в помещении или под навесом?",

        ask_lift:
            "Есть ли грузовой лифт для подъёма оборудования? Если нет — оборудование потребуется поднимать по лестнице.",

        ask_equipment:
            "Какое оборудование необходимо? Можно указать несколько категорий: звуковое оборудование, LED-экраны, световое оборудование, сценические конструкции или полный комплекс.",

        ask_mount:
            "Какое время монтажа подходит: любое по согласованию или ночью/рано утром?",

        ask_demount:
            "Какое время демонтажа подходит: любое по согласованию или до определённого времени?",

        ask_date_start:
            "Укажите дату начала мероприятия.",

        ask_date_end:
            "Укажите дату окончания мероприятия.",

        ask_ready_date:
            "Укажите дату и время, к которому оборудование должно быть полностью готово."
    };


// ============================================================
// PROCESS AI TAGS
// ============================================================

function processAITags(
    text
) {

    let result =
        String(
            text || ""
        ).trim();

    const tags =
        [];

    const regex =
        /\[(ask_[a-zA-Z0-9_]+)\]/g;

    let match;

    while (
        (match =
            regex.exec(
                result
            )) !== null
    ) {

        tags.push(
            match[1]
        );
    }

    // Удаляем теги из основного текста.
    result =
        result.replace(
            regex,
            ""
        ).trim();

    return {
        text:
            result,

        tags:
            [
                ...new Set(
                    tags
                )
            ]
    };
}


// ============================================================
// SEND AI RESPONSE
// ============================================================

async function sendAIResponse(
    dialogId,
    aiText
) {

    const processed =
        processAITags(
            aiText
        );

    // --------------------------------------------------------
    // Сначала основной текст.
    // --------------------------------------------------------

    if (
        processed.text
    ) {

        await sendBitrixMessage(
            dialogId,
            processed.text
        );
    }

    // --------------------------------------------------------
    // Потом вопрос, соответствующий тегу.
    //
    // Если DeepSeek поставил несколько тегов,
    // отправляем их последовательно.
    // --------------------------------------------------------

    for (
        const tag
        of processed.tags
    ) {

        const question =
            TAG_MESSAGES[tag];

        if (
            !question
        ) {

            console.log(
                `⚠️ Неизвестный тег: [${tag}]`
            );

            continue;
        }

        await sendBitrixMessage(
            dialogId,
            question
        );
    }

    // --------------------------------------------------------
    // Если DeepSeek вернул пустой текст и неизвестный тег.
    // --------------------------------------------------------

    if (
        !processed.text &&
        processed.tags.length === 0
    ) {

        await sendBitrixMessage(
            dialogId,
            "Подскажите, пожалуйста, подробнее."
        );
    }
}


// ============================================================
// HANDLE INCOMING MESSAGE
// ============================================================

async function handleIncomingMessage(
    data
) {

    const message =
        data.message ||
        {};

    const chat =
        data.chat ||
        {};

    const user =
        data.user ||
        {};

    const text =
        String(
            message.text ||
            ""
        ).trim();

    const dialogId =
        chat.dialogId ||
        chat.dialog_id ||
        message.chatId ||
        message.chat_id;

    console.log("");
    console.log(
        "########################################"
    );

    console.log(
        "📩 СООБЩЕНИЕ КЛИЕНТА"
    );

    console.log(
        "########################################"
    );

    console.log(
        "Client:",
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
        dialogId
    );

    console.log(
        "Message ID:",
        message.id
    );

    console.log(
        "Text:",
        text
    );

    if (
        !dialogId
    ) {

        throw new Error(
            "У входящего события отсутствует dialogId."
        );
    }

    if (
        !text
    ) {

        console.log(
            "ℹ️ Сообщение без текста. Пока пропускаем."
        );

        return;
    }


    // ========================================================
    // ПРОТИВ ЗАЦИКЛИВАНИЯ
    // ========================================================
    //
    // Обрабатываем только сообщения пользователя.
    //
    // authorId обычно соответствует user.id.
    //
    // Если сообщение принадлежит самому боту,
    // не отправляем его снова в DeepSeek.
    // ========================================================

    if (
        Number(
            message.authorId
        ) ===
        EXPECTED_BOT_ID
    ) {

        console.log(
            "↩️ Это сообщение самого бота. Пропускаем."
        );

        return;
    }


    // ========================================================
    // PORTFOLIO
    // ========================================================

    const lowerText =
        text.toLowerCase();

    const addPortfolio =
        PORTFOLIO_KEYWORDS.some(
            keyword =>
                lowerText.includes(
                    keyword
                )
        );


    // ========================================================
    // DEEPSEEK
    // ========================================================

    try {

        const reply =
            await askDeepSeek(
                text,
                dialogId,
                user.firstName ||
                user.name ||
                "",
                addPortfolio
            );

        console.log("");
        console.log(
            "🤖 AI RESPONSE:"
        );

        console.log(
            reply
        );

        await sendAIResponse(
            dialogId,
            reply
        );

    } catch (error) {

        console.error("");
        console.error(
            "❌ ОШИБКА DEEPSEEK / AI"
        );

        console.error(
            error.stack ||
            error.message
        );

        // ----------------------------------------------------
        // Клиент всё равно получает нормальный ответ.
        // ----------------------------------------------------

        try {

            await sendBitrixMessage(
                dialogId,
                "Извините, произошла временная техническая ошибка. Пожалуйста, попробуйте написать ещё раз или я передам вас менеджеру."
            );

        } catch (sendError) {

            console.error(
                "❌ Не удалось отправить сообщение об ошибке:",
                sendError.message
            );
        }

        // ----------------------------------------------------
        // Очень важно:
        // пробрасываем ошибку выше.
        //
        // Тогда offset НЕ будет подтверждён.
        //
        // После следующего polling Bitrix сможет
        // повторно отдать событие.
        // ----------------------------------------------------

        throw error;
    }
}


// ============================================================
// HANDLE EVENT
// ============================================================

async function handleEvent(
    event
) {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "📨 BITRIX EVENT"
    );

    console.log(
        "========================================"
    );

    console.log(
        "Event ID:",
        event.eventId
    );

    console.log(
        "Type:",
        event.type
    );

    console.log(
        "Date:",
        event.date
    );

    const data =
        event.data ||
        {};


    // ========================================================
    // MESSAGE
    // ========================================================

    if (
        event.type ===
        "ONIMBOTV2MESSAGEADD"
    ) {

        await handleIncomingMessage(
            data
        );

        return;
    }


    // ========================================================
    // JOIN CHAT
    // ========================================================

    if (
        event.type ===
        "ONIMBOTV2JOINCHAT"
    ) {

        console.log(
            "👋 Бот добавлен в чат."
        );

        return;
    }


    // ========================================================
    // DELETE
    // ========================================================

    if (
        event.type ===
        "ONIMBOTV2DELETE"
    ) {

        console.log(
            "⚠️ Бот удалён из чата."
        );

        return;
    }


    // ========================================================
    // OTHER
    // ========================================================

    console.log(
        "ℹ️ Событие получено, специальной обработки нет."
    );
}


// ============================================================
// POLLING
// ============================================================

let polling =
    false;

let stopping =
    false;


async function pollBitrix() {

    if (
        stopping
    ) {
        return;
    }

    if (
        polling
    ) {

        return;
    }

    polling =
        true;

    try {

        const result =
            await getEvents();

        if (
            !result
        ) {

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
            "========== FETCH =========="
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


        // ====================================================
        // ОБРАБОТКА
        // ====================================================
        //
        // ВАЖНО:
        //
        // offset подтверждаем ТОЛЬКО после того,
        // как все события текущей пачки успешно обработаны.
        //
        // Если DeepSeek или Bitrix упал,
        // offset НЕ двигается.
        // ====================================================

        for (
            const event
            of events
        ) {

            await handleEvent(
                event
            );
        }


        // ====================================================
        // CONFIRM OFFSET
        // ====================================================

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


        // ====================================================
        // ЕСЛИ ЕСТЬ ЕЩЁ СОБЫТИЯ
        // ====================================================

        if (
            hasMore
        ) {

            console.log(
                "📚 Есть ещё события. Забираем следующую пачку."
            );

            setImmediate(
                pollBitrix
            );
        }

    } catch (error) {

        console.error("");
        console.error(
            "❌ FETCH POLLING ERROR"
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
        "Bitrix method: imbot.v2.Event.get"
    );

    console.log(
        "Bot ID:",
        EXPECTED_BOT_ID
    );

    console.log(
        "Interval:",
        `${POLL_INTERVAL_MS / 1000} sec`
    );

    console.log(
        "========================================"
    );


    // Сразу проверяем очередь.
    pollBitrix();


    // Далее регулярно.
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
//
// Bitrix webhook сюда НЕ приходит.
// FETCH работает через исходящие REST-запросы.
//
// ============================================================

const server =
    http.createServer(
        (req, res) => {

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
                    "MLK AI Consultant — Bitrix24 FETCH is running."
                );

                return;
            }


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
                                EXPECTED_BOT_ID,

                            botCode:
                                BOT_CODE,

                            mode:
                                "fetch",

                            offset:
                                offset,

                            polling:
                                polling,

                            sessions:
                                Object.keys(
                                    sessions
                                ).length,

                            time:
                                new Date().toISOString()
                        },
                        null,
                        2
                    )
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

async function start() {

    try {

        loadSessions();

        loadOffset();


        server.listen(
            PORT,
            "0.0.0.0",
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
                    "========================================"
                );


                try {

                    // ------------------------------------------------
                    // Проверяем существующего бота.
                    // ------------------------------------------------

                    await checkBot();


                    // ------------------------------------------------
                    // Запускаем FETCH.
                    // ------------------------------------------------

                    startPolling();


                    console.log("");
                    console.log(
                        "========================================"
                    );

                    console.log(
                        "🎉 MLK AI CONSULTANT READY"
                    );

                    console.log(
                        "========================================"
                    );

                    console.log(
                        "Bot:",
                        EXPECTED_BOT_ID
                    );

                    console.log(
                        "Mode: FETCH"
                    );

                    console.log(
                        "AI: DeepSeek"
                    );

                    console.log(
                        "Sessions: 90 days"
                    );

                    console.log(
                        "========================================"
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

    } catch (error) {

        console.error(
            "❌ FATAL START ERROR:",
            error.stack ||
            error.message
        );

        process.exit(1);
    }
}


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
// SHUTDOWN
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


// ============================================================
// RUN
// ============================================================

start();