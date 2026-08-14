require('dotenv').config();

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ============================================================
// ENV
// ============================================================

const TELEGRAM_BOT_TOKEN = (
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    ''
).trim();

const ADMIN_CHAT_ID = String(
    process.env.ADMIN_CHAT_ID || ''
).trim();

const DEEPSEEK_API_KEY = (
    process.env.DEEPSEEK_API_KEY || ''
).trim();

const DEEPSEEK_MODEL = (
    process.env.DEEPSEEK_MODEL ||
    'deepseek-chat'
).trim();

const BITRIX_WEBHOOK_URL = (
    process.env.BITRIX_WEBHOOK_URL || ''
).trim();

const BITRIX_BOT_TOKEN = (
    process.env.BITRIX_BOT_TOKEN || ''
).trim();

const BITRIX_BOT_ID = Number(
    process.env.BITRIX_BOT_ID || 1787
);

const BITRIX_BOT_CODE = (
    process.env.BITRIX_BOT_CODE ||
    'mlk_ai_consultant_v2'
).trim();

const BITRIX_MANAGER_IDS = String(
    process.env.BITRIX_MANAGER_IDS ||
    process.env.BITRIX_ADMIN_USER_ID ||
    '1'
)
    .split(',')
    .map(x => Number(x.trim()))
    .filter(Number.isInteger);

const BITRIX_POLL_INTERVAL_MS = Number(
    process.env.BITRIX_POLL_INTERVAL_MS || 3000
);

const BITRIX_EVENT_LIMIT = Math.min(
    1000,
    Math.max(
        1,
        Number(process.env.BITRIX_EVENT_LIMIT || 100)
    )
);

const PORT = Number(
    process.env.PORT || 10000
);

const MAX_HISTORY_MESSAGES = 30;

// ============================================================
// PATHS
// ============================================================

const ROOT = __dirname;

const DATA_DIR = path.join(
    ROOT,
    'data'
);

const SESSIONS_DIR = path.join(
    ROOT,
    'sessions'
);

const CLIENTS_FILE = path.join(
    DATA_DIR,
    'clients.json'
);

const OFFSET_FILE = path.join(
    DATA_DIR,
    'bitrix-offset.json'
);

const PROMPT_FILE = path.join(
    ROOT,
    'promt.txt'
);

const PORTFOLIO_FILE = path.join(
    ROOT,
    'portfolio.txt'
);

fs.mkdirSync(DATA_DIR, {
    recursive: true
});

fs.mkdirSync(SESSIONS_DIR, {
    recursive: true
});

// ============================================================
// FILES
// ============================================================

let SYSTEM_PROMPT = '';
let PORTFOLIO_TEXT = '';

try {
    SYSTEM_PROMPT = fs.readFileSync(
        PROMPT_FILE,
        'utf8'
    ).trim();
} catch (error) {
    console.error(
        '❌ Не удалось загрузить promt.txt:',
        error.message
    );

    process.exit(1);
}

if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
        PORTFOLIO_TEXT = fs.readFileSync(
            PORTFOLIO_FILE,
            'utf8'
        ).trim();
    } catch (error) {
        console.error(
            '⚠️ Ошибка portfolio.txt:',
            error.message
        );
    }
}

const PORTFOLIO_KEYWORDS = [
    'опыт',
    'портфолио',
    'делали ли вы',
    'пример',
    'кейс',
    'проект',
    'объект',
    'работали',
    'участвовали',
    'проводили'
];

// ============================================================
// ENABLED
// ============================================================

const telegramEnabled = Boolean(
    TELEGRAM_BOT_TOKEN
);

const bitrixEnabled = Boolean(
    BITRIX_WEBHOOK_URL &&
    BITRIX_BOT_TOKEN
);

const deepSeekEnabled = Boolean(
    DEEPSEEK_API_KEY
);

// ============================================================
// STATE
// ============================================================

const sessions = {};
const clients = {};

let bitrixOffset = null;
let bitrixPolling = false;
let bitrixInterval = null;

let telegramStarted = false;
let stopping = false;

let bot = null;

if (telegramEnabled) {
    bot = new Telegraf(
        TELEGRAM_BOT_TOKEN
    );
}

// ============================================================
// SAFE LOGGING
// ============================================================

function envStatus(value) {
    return value ? 'OK' : 'MISSING';
}

function startupLog() {
    console.log('========================================');
    console.log('MLK AI CONSULTANT');
    console.log('========================================');

    console.log(
        'TELEGRAM_BOT_TOKEN:',
        envStatus(TELEGRAM_BOT_TOKEN)
    );

    console.log(
        'DEEPSEEK_API_KEY:',
        envStatus(DEEPSEEK_API_KEY)
    );

    console.log(
        'DEEPSEEK_MODEL:',
        DEEPSEEK_MODEL
    );

    console.log(
        'ADMIN_CHAT_ID:',
        envStatus(ADMIN_CHAT_ID)
    );

    console.log(
        'BITRIX_WEBHOOK_URL:',
        envStatus(BITRIX_WEBHOOK_URL)
    );

    console.log(
        'BITRIX_BOT_TOKEN:',
        envStatus(BITRIX_BOT_TOKEN)
    );

    console.log(
        'BITRIX_BOT_ID:',
        BITRIX_BOT_ID
    );

    console.log(
        'BITRIX_BOT_CODE:',
        BITRIX_BOT_CODE
    );

    console.log(
        'BITRIX_MANAGER_IDS:',
        BITRIX_MANAGER_IDS.join(',') || 'NONE'
    );

    console.log(
        'PORT:',
        PORT
    );

    console.log('========================================');
}

// ============================================================
// JSON
// ============================================================

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        return JSON.parse(
            fs.readFileSync(
                file,
                'utf8'
            )
        );
    } catch (error) {
        console.error(
            `⚠️ Ошибка чтения ${path.basename(file)}:`,
            error.message
        );

        return fallback;
    }
}

function writeJson(file, data) {
    const temp = `${file}.tmp`;

    fs.writeFileSync(
        temp,
        JSON.stringify(
            data,
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(
        temp,
        file
    );
}

// ============================================================
// CLIENTS
// ============================================================

function loadClients() {
    const data = readJson(
        CLIENTS_FILE,
        {}
    );

    if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data)
    ) {
        Object.assign(
            clients,
            data
        );
    }

    console.log(
        '📚 Clients loaded:',
        Object.keys(clients).length
    );
}

function saveClients() {
    try {
        writeJson(
            CLIENTS_FILE,
            clients
        );
    } catch (error) {
        console.error(
            '❌ clients.json:',
            error.message
        );
    }
}

function getClient(telegramId) {
    return clients[String(telegramId)] || null;
}

function ensureClient(
    telegramId,
    firstName = '',
    username = ''
) {
    const key = String(
        telegramId
    );

    if (!clients[key]) {
        clients[key] = {
            telegramChatId: Number(
                telegramId
            ),

            firstName:
                firstName || '',

            username:
                username || '',

            mode: 'ai',

            bitrixDialogId: null,

            bitrixChatId: null,

            createdAt:
                new Date().toISOString(),

            updatedAt:
                new Date().toISOString()
        };
    }

    if (firstName) {
        clients[key].firstName =
            firstName;
    }

    if (username !== undefined) {
        clients[key].username =
            username;
    }

    clients[key].updatedAt =
        new Date().toISOString();

    saveClients();

    return clients[key];
}

function findClientByBitrixDialog(
    dialogId
) {
    const wanted =
        String(dialogId);

    for (
        const client of Object.values(clients)
    ) {
        if (
            String(
                client.bitrixDialogId || ''
            ) === wanted
        ) {
            return client;
        }
    }

    return null;
}

function setClientMode(
    client,
    mode
) {
    if (!client) return;

    client.mode =
        mode === 'manager'
            ? 'manager'
            : 'ai';

    client.updatedAt =
        new Date().toISOString();

    saveClients();
}

// ============================================================
// SESSIONS
// ============================================================

function loadSessions() {
    let count = 0;

    try {
        for (
            const file of fs.readdirSync(
                SESSIONS_DIR
            )
        ) {
            if (
                !file.endsWith('.json')
            ) {
                continue;
            }

            try {
                const data =
                    JSON.parse(
                        fs.readFileSync(
                            path.join(
                                SESSIONS_DIR,
                                file
                            ),
                            'utf8'
                        )
                    );

                if (
                    Array.isArray(data)
                ) {
                    sessions[
                        path.basename(
                            file,
                            '.json'
                        )
                    ] = data;

                    count++;
                }
            } catch (_) {}
        }
    } catch (_) {}

    console.log(
        '📂 Sessions loaded:',
        count
    );
}

function saveSession(key) {
    if (!sessions[key]) {
        return;
    }

    try {
        writeJson(
            path.join(
                SESSIONS_DIR,
                `${key}.json`
            ),
            sessions[key]
        );
    } catch (error) {
        console.error(
            '❌ Session save:',
            error.message
        );
    }
}

function ensureSession(
    key,
    firstName = ''
) {
    if (sessions[key]) {
        return sessions[key];
    }

    sessions[key] = [
        {
            role: 'system',
            content: SYSTEM_PROMPT
        },

        {
            role: 'system',
            content:
                `Имя клиента: ${
                    firstName || 'неизвестно'
                }`
        }
    ];

    saveSession(key);

    return sessions[key];
}

// ============================================================
// OFFSET
// ============================================================

function loadOffset() {
    const data = readJson(
        OFFSET_FILE,
        {}
    );

    if (
        Number.isInteger(
            data.offset
        )
    ) {
        bitrixOffset =
            data.offset;
    } else {
        bitrixOffset = null;
    }

    console.log(
        '📌 Bitrix offset:',
        bitrixOffset === null
            ? 'FIRST'
            : bitrixOffset
    );
}

function saveOffset(offset) {
    try {
        writeJson(
            OFFSET_FILE,
            {
                offset,
                savedAt:
                    new Date().toISOString()
            }
        );
    } catch (error) {
        console.error(
            '⚠️ Offset save:',
            error.message
        );
    }
}

// ============================================================
// TELEGRAM ADMIN
// ============================================================

async function notifyAdmin(
    text
) {
    if (
        !telegramEnabled ||
        !ADMIN_CHAT_ID ||
        !bot
    ) {
        return;
    }

    try {
        await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            text
        );
    } catch (error) {
        console.error(
            '⚠️ Admin Telegram:',
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
    if (!bitrixEnabled) {
        throw new Error(
            'Bitrix отключён.'
        );
    }

    const url =
        BITRIX_WEBHOOK_URL.replace(
            /\/+$/,
            ''
        ) +
        '/' +
        method;

    const response =
        await fetch(
            url,
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json',

                    'Accept':
                        'application/json'
                },

                body:
                    JSON.stringify(
                        params
                    )
            }
        );

    const text =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(text);
    } catch (_) {
        throw new Error(
            `Bitrix вернул не JSON. HTTP ${response.status}`
        );
    }

    if (
        !response.ok ||
        data.error
    ) {
        throw new Error(
            `Bitrix ${
                data.error ||
                `HTTP_${response.status}`
            }: ${
                data.error_description ||
                ''
            }`
        );
    }

    return data.result;
}

// ============================================================
// BITRIX SEND
// ============================================================

async function sendBitrixMessage(
    dialogId,
    text
) {
    const clean =
        String(text || '').trim();

    if (!clean) {
        return;
    }

    return bitrixCall(
        'imbot.v2.Chat.Message.send',
        {
            botId:
                BITRIX_BOT_ID,

            botToken:
                BITRIX_BOT_TOKEN,

            dialogId:
                String(dialogId),

            fields: {
                message:
                    clean,

                urlPreview:
                    true
            }
        }
    );
}

// ============================================================
// CREATE BITRIX CHAT FOR TELEGRAM CLIENT
// ============================================================

async function createBitrixChat(
    client
) {
    if (
        !bitrixEnabled ||
        client.bitrixDialogId
    ) {
        return client.bitrixDialogId;
    }

    const title =
        `Telegram — ${
            client.firstName ||
            'Клиент'
        } — ${
            client.telegramChatId
        }`;

    const result =
        await bitrixCall(
            'imbot.v2.Chat.add',
            {
                botId:
                    BITRIX_BOT_ID,

                botToken:
                    BITRIX_BOT_TOKEN,

                fields: {
                    title,

                    description:
                        `Telegram ID ${client.telegramChatId}`,

                    color:
                        'aqua',

                    userIds:
                        BITRIX_MANAGER_IDS,

                    message:
                        '💬 Чат клиента из Telegram создан. Здесь будет полная копия переписки.'
                }
            }
        );

    const dialogId =
        result?.chat?.dialogId;

    if (!dialogId) {
        throw new Error(
            'Bitrix Chat.add не вернул dialogId.'
        );
    }

    client.bitrixDialogId =
        String(dialogId);

    client.bitrixChatId =
        result?.chat?.id ||
        null;

    saveClients();

    console.log(
        '✅ Bitrix chat created for Telegram:',
        client.telegramChatId
    );

    return client.bitrixDialogId;
}

async function ensureBitrixChat(
    client
) {
    if (
        client.bitrixDialogId
    ) {
        return client.bitrixDialogId;
    }

    return createBitrixChat(
        client
    );
}

// ============================================================
// MIRROR TO BITRIX
// ============================================================

async function mirrorToBitrix(
    client,
    text
) {
    if (!bitrixEnabled) {
        return;
    }

    try {
        const dialogId =
            await ensureBitrixChat(
                client
            );

        await sendBitrixMessage(
            dialogId,
            text
        );
    } catch (error) {
        console.error(
            '❌ Telegram → Bitrix:',
            error.message
        );
    }
}

// ============================================================
// BITRIX USER EVENTS
// ============================================================

async function subscribeBitrixEvents() {
    try {
        await bitrixCall(
            'im.v2.Event.subscribe',
            {}
        );

        console.log(
            '✅ Bitrix user event subscription OK'
        );

        return true;
    } catch (error) {
        console.error(
            '❌ Bitrix user subscription:',
            error.message
        );

        console.error(
            '⚠️ Нужен scope im для ONIMV2MESSAGEADD.'
        );

        return false;
    }
}

// ============================================================
// BITRIX EVENT GET
// ============================================================

async function getBitrixEvents() {
    const params = {
        botId:
            BITRIX_BOT_ID,

        botToken:
            BITRIX_BOT_TOKEN,

        limit:
            BITRIX_EVENT_LIMIT,

        withUserEvents:
            true
    };

    if (
        bitrixOffset !== null
    ) {
        params.offset =
            bitrixOffset;
    }

    return bitrixCall(
        'imbot.v2.Event.get',
        params
    );
}

// ============================================================
// DEEPSEEK
// ============================================================

function needsPortfolio(
    text
) {
    const lower =
        String(text || '')
            .toLowerCase();

    return PORTFOLIO_KEYWORDS.some(
        keyword =>
            lower.includes(
                keyword
            )
    );
}

async function askDeepSeek(
    text,
    sessionId,
    firstName = ''
) {
    if (!deepSeekEnabled) {
        throw new Error(
            'DEEPSEEK_API_KEY отсутствует.'
        );
    }

    const messages =
        ensureSession(
            sessionId,
            firstName
        );

    let aiText =
        String(text || '');

    if (
        needsPortfolio(aiText) &&
        PORTFOLIO_TEXT
    ) {
        aiText =
            'Отвечай на вопрос клиента, используя ТОЛЬКО информацию из списка проектов ниже. Не выдумывай проекты.\n\n' +
            'СПИСОК ПРОЕКТОВ:\n' +
            PORTFOLIO_TEXT +
            '\n\nВОПРОС КЛИЕНТА:\n' +
            aiText;
    }

    messages.push({
        role: 'user',
        content: aiText
    });

    try {
        const response =
            await fetch(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        'Authorization':
                            `Bearer ${DEEPSEEK_API_KEY}`
                    },

                    body:
                        JSON.stringify({
                            model:
                                DEEPSEEK_MODEL,

                            messages,

                            stream:
                                false,

                            temperature:
                                0.7,

                            max_tokens:
                                1000
                        })
                }
            );

        const raw =
            await response.text();

        if (!response.ok) {
            throw new Error(
                `DeepSeek HTTP ${response.status}`
            );
        }

        const data =
            JSON.parse(raw);

        const reply =
            String(
                data?.choices?.[0]?.message?.content ||
                ''
            ).trim();

        if (!reply) {
            throw new Error(
                'DeepSeek вернул пустой ответ.'
            );
        }

        messages[
            messages.length - 1
        ] = {
            role: 'user',
            content:
                String(text || '')
        };

        messages.push({
            role: 'assistant',
            content:
                reply
        });

        if (
            messages.length >
            MAX_HISTORY_MESSAGES + 2
        ) {
            const system =
                messages.filter(
                    x =>
                        x.role === 'system'
                );

            const conversation =
                messages.filter(
                    x =>
                        x.role !== 'system'
                );

            sessions[sessionId] = [
                ...system,
                ...conversation.slice(
                    -MAX_HISTORY_MESSAGES
                )
            ];
        }

        saveSession(
            sessionId
        );

        return reply;

    } catch (error) {

        if (
            Array.isArray(
                sessions[sessionId]
            ) &&
            sessions[sessionId]
                .at(-1)
                ?.role === 'user'
        ) {
            sessions[sessionId].pop();
            saveSession(
                sessionId
            );
        }

        throw error;
    }
}

// ============================================================
// TELEGRAM → CLIENT
// ============================================================

async function sendAIToTelegram(
    client,
    text
) {
    if (!bot) return;

    await bot.telegram.sendMessage(
        client.telegramChatId,
        text
    );

    await mirrorToBitrix(
        client,
        `🤖 ИИ\n\n${text}`
    );

    await notifyAdmin(
        `🤖 ИИ → ${
            client.firstName ||
            'клиент'
        }\nTelegram ID: ${
            client.telegramChatId
        }\n\n${text}`
    );
}

// ============================================================
// TELEGRAM CLIENT MESSAGE
// ============================================================

async function processClientMessage(
    ctx,
    text
) {
    const user =
        ctx.from;

    const client =
        ensureClient(
            ctx.chat.id,
            user.first_name,
            user.username
        );

    // Полная копия сообщения клиента.
    await mirrorToBitrix(
        client,
        `👤 КЛИЕНТ — Telegram\n` +
        `${client.firstName || ''} ` +
        `(@${client.username || 'нет'}, ID ${client.telegramChatId})\n\n` +
        text
    );

    await notifyAdmin(
        `📩 КЛИЕНТ — Telegram\n` +
        `${client.firstName || ''} ` +
        `(@${client.username || 'нет'}, ID ${client.telegramChatId})\n\n` +
        text
    );

    // --------------------------------------------------------
    // MANAGER MODE
    // --------------------------------------------------------

    if (
        client.mode === 'manager'
    ) {
        console.log(
            `👨‍💼 AI OFF for ${client.telegramChatId}`
        );

        return;
    }

    // --------------------------------------------------------
    // AI
    // --------------------------------------------------------

    try {
        await ctx.sendChatAction(
            'typing'
        );

        const reply =
            await askDeepSeek(
                text,
                `client_${client.telegramChatId}`,
                client.firstName
            );

        await sendAIToTelegram(
            client,
            reply
        );

    } catch (error) {

        console.error(
            '❌ DeepSeek:',
            error.message
        );

        const errorText =
            'Извините, произошла техническая ошибка. Попробуйте ещё раз.';

        await ctx.reply(
            errorText
        );

        await mirrorToBitrix(
            client,
            `🤖 ИИ\n\n${errorText}`
        );
    }
}

// ============================================================
// TELEGRAM
// ============================================================

function setupTelegram() {
    if (
        !telegramEnabled ||
        !bot
    ) {
        return;
    }

    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    bot.start(
        async ctx => {
            const client =
                ensureClient(
                    ctx.chat.id,
                    ctx.from.first_name,
                    ctx.from.username
                );

            setClientMode(
                client,
                'ai'
            );

            await ctx.reply(
                'Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».\n\n' +
                'Можете просто написать свой вопрос — я помогу разобраться.'
            );

            await mirrorToBitrix(
                client,
                '👤 КЛИЕНТ — Telegram\n\n/start'
            );

            await notifyAdmin(
                `📩 Клиент запустил бота.\n` +
                `${client.firstName || ''}\n` +
                `Telegram ID: ${client.telegramChatId}`
            );
        }
    );

    // --------------------------------------------------------
    // TEXT
    // --------------------------------------------------------

    bot.on(
        'text',
        async ctx => {
            if (
                String(ctx.from.id) ===
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const text =
                String(
                    ctx.message.text ||
                    ''
                ).trim();

            if (!text) return;

            await processClientMessage(
                ctx,
                text
            );
        }
    );

    // --------------------------------------------------------
    // DOCUMENT
    // --------------------------------------------------------

    bot.on(
        'document',
        async ctx => {
            const client =
                ensureClient(
                    ctx.chat.id,
                    ctx.from.first_name,
                    ctx.from.username
                );

            const doc =
                ctx.message.document;

            await ctx.reply(
                'Спасибо! Я передал ваш файл менеджеру.'
            );

            await mirrorToBitrix(
                client,
                `📎 Клиент отправил файл:\n${
                    doc.file_name ||
                    'неизвестно'
                }`
            );

            await notifyAdmin(
                `📎 Файл от клиента\n` +
                `${client.firstName || ''}\n` +
                `Telegram ID: ${client.telegramChatId}\n` +
                `Файл: ${
                    doc.file_name ||
                    'неизвестно'
                }`
            );

            if (
                ADMIN_CHAT_ID
            ) {
                try {
                    await bot.telegram.sendDocument(
                        ADMIN_CHAT_ID,
                        doc.file_id,
                        {
                            caption:
                                `📎 Файл клиента\n` +
                                `${client.firstName || ''}\n` +
                                `Telegram ID: ${client.telegramChatId}\n` +
                                `Файл: ${
                                    doc.file_name ||
                                    'неизвестно'
                                }`
                        }
                    );
                } catch (error) {
                    console.error(
                        '❌ Forward document:',
                        error.message
                    );
                }
            }

            setClientMode(
                client,
                'manager'
            );
        }
    );

    // --------------------------------------------------------
    // PHOTO
    // --------------------------------------------------------

    bot.on(
        'photo',
        async ctx => {
            const client =
                ensureClient(
                    ctx.chat.id,
                    ctx.from.first_name,
                    ctx.from.username
                );

            await ctx.reply(
                'Спасибо! Я передал ваше фото менеджеру.'
            );

            await mirrorToBitrix(
                client,
                '📷 Клиент отправил фото.'
            );

            const photos =
                ctx.message.photo;

            if (
                ADMIN_CHAT_ID &&
                photos?.length
            ) {
                try {
                    await bot.telegram.sendPhoto(
                        ADMIN_CHAT_ID,
                        photos[
                            photos.length - 1
                        ].file_id,
                        {
                            caption:
                                `📷 Фото клиента\n` +
                                `${client.firstName || ''}\n` +
                                `Telegram ID: ${client.telegramChatId}`
                        }
                    );
                } catch (error) {
                    console.error(
                        '❌ Forward photo:',
                        error.message
                    );
                }
            }

            setClientMode(
                client,
                'manager'
            );
        }
    );

    // --------------------------------------------------------
    // ADMIN /reply
    // --------------------------------------------------------

    bot.command(
        'reply',
        async ctx => {
            if (
                String(ctx.from.id) !==
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const parts =
                String(
                    ctx.message.text
                )
                    .split(' ')
                    .slice(1);

            let targetId = null;

            if (
                parts[0] &&
                /^-?\d+$/.test(
                    parts[0]
                )
            ) {
                targetId =
                    Number(
                        parts.shift()
                    );
            }

            const text =
                parts.join(' ').trim();

            if (
                !targetId
            ) {
                await ctx.reply(
                    'Использование:\n/reply TELEGRAM_ID текст'
                );

                return;
            }

            if (!text) {
                await ctx.reply(
                    'Укажите текст.'
                );

                return;
            }

            const client =
                ensureClient(
                    targetId
                );

            setClientMode(
                client,
                'manager'
            );

            try {
                await bot.telegram.sendMessage(
                    targetId,
                    text
                );

                await mirrorToBitrix(
                    client,
                    `👨‍💼 МЕНЕДЖЕР — Telegram\n\n${text}`
                );

                await notifyAdmin(
                    `👨‍💼 МЕНЕДЖЕР → КЛИЕНТ\n` +
                    `ID: ${targetId}\n\n` +
                    text
                );

                await ctx.reply(
                    '✅ Отправлено. ИИ отключён для этого клиента.'
                );

            } catch (error) {
                await ctx.reply(
                    `❌ ${error.message}`
                );
            }
        }
    );

    // --------------------------------------------------------
    // ADMIN /manager
    // --------------------------------------------------------

    bot.command(
        'manager',
        async ctx => {
            if (
                String(ctx.from.id) !==
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const id =
                Number(
                    String(
                        ctx.message.text
                    )
                        .split(' ')[1]
                );

            if (!id) {
                await ctx.reply(
                    '/manager TELEGRAM_ID'
                );

                return;
            }

            const client =
                ensureClient(id);

            setClientMode(
                client,
                'manager'
            );

            await ctx.reply(
                `👨‍💼 Менеджер подключён к ${id}.`
            );
        }
    );

    // --------------------------------------------------------
    // ADMIN /ai
    // --------------------------------------------------------

    bot.command(
        'ai',
        async ctx => {
            if (
                String(ctx.from.id) !==
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const id =
                Number(
                    String(
                        ctx.message.text
                    )
                        .split(' ')[1]
                );

            if (!id) {
                await ctx.reply(
                    '/ai TELEGRAM_ID'
                );

                return;
            }

            const client =
                ensureClient(id);

            setClientMode(
                client,
                'ai'
            );

            await ctx.reply(
                `🤖 ИИ снова подключён к ${id}.`
            );

            if (client.bitrixDialogId) {
                await sendBitrixMessage(
                    client.bitrixDialogId,
                    '🤖 Менеджер вернул диалог ИИ.'
                );
            }

            await bot.telegram.sendMessage(
                id,
                '🤖 Менеджер вернул диалог ИИ. Продолжаем.'
            );
        }
    );

    // --------------------------------------------------------
    // ADMIN /clients
    // --------------------------------------------------------

    bot.command(
        'clients',
        async ctx => {
            if (
                String(ctx.from.id) !==
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const list =
                Object.values(
                    clients
                );

            if (!list.length) {
                await ctx.reply(
                    'Клиентов пока нет.'
                );

                return;
            }

            const text =
                list
                    .slice(-30)
                    .reverse()
                    .map(
                        c =>
                            `${
                                c.mode === 'ai'
                                    ? '🤖'
                                    : '👨‍💼'
                            } ${
                                c.firstName ||
                                'Без имени'
                            } | TG ${
                                c.telegramChatId
                            } | BX ${
                                c.bitrixDialogId ||
                                'нет'
                            }`
                    )
                    .join('\n');

            await ctx.reply(
                `👥 Клиенты:\n\n${text}`
            );
        }
    );
}

// ============================================================
// BITRIX USER MESSAGE
// ============================================================

async function handleBitrixUserMessage(
    data
) {
    const message =
        data?.message || {};

    const chat =
        data?.chat || {};

    const user =
        data?.user || {};

    const text =
        String(
            message.text || ''
        ).trim();

    const dialogId =
        chat.dialogId ||
        chat.dialog_id ||
        message.chatId ||
        message.chat_id;

    const authorId =
        message.authorId ??
        message.author_id ??
        user.id;

    if (
        !dialogId ||
        !text
    ) {
        return;
    }

    const client =
        findClientByBitrixDialog(
            dialogId
        );

    if (!client) {
        console.log(
            'ℹ️ Bitrix message is not linked to Telegram client:',
            dialogId
        );

        return;
    }

    // Только менеджеры могут управлять клиентом.
    if (
        !BITRIX_MANAGER_IDS.includes(
            Number(authorId)
        )
    ) {
        return;
    }

    const command =
        text.toLowerCase();

    // --------------------------------------------------------
    // RETURN TO AI
    // --------------------------------------------------------

    if (
        command === '/ai' ||
        command === '/resume' ||
        command === 'вернуть ии'
    ) {
        setClientMode(
            client,
            'ai'
        );

        await sendBitrixMessage(
            dialogId,
            '🤖 ИИ снова подключён.'
        );

        await bot.telegram.sendMessage(
            client.telegramChatId,
            '🤖 Менеджер вернул диалог ИИ.'
        );

        await notifyAdmin(
            `🤖 ИИ снова включён\n` +
            `Клиент: ${client.telegramChatId}`
        );

        return;
    }

    // --------------------------------------------------------
    // MANAGER MESSAGE
    // --------------------------------------------------------

    setClientMode(
        client,
        'manager'
    );

    try {
        await bot.telegram.sendMessage(
            client.telegramChatId,
            text
        );

        await mirrorToBitrix(
            client,
            `👨‍💼 МЕНЕДЖЕР — Bitrix24\n\n${text}`
        );

        await notifyAdmin(
            `👨‍💼 МЕНЕДЖЕР — Bitrix24\n` +
            `Клиент: ${client.telegramChatId}\n\n` +
            text
        );

        console.log(
            `📤 Bitrix manager → Telegram ${client.telegramChatId}`
        );

    } catch (error) {
        console.error(
            '❌ Bitrix → Telegram:',
            error.message
        );

        await sendBitrixMessage(
            dialogId,
            '❌ Не удалось отправить сообщение клиенту в Telegram.'
        );
    }
}

// ============================================================
// BITRIX BOT EVENT
// ============================================================

async function handleBitrixEvent(
    event
) {
    if (!event) {
        return;
    }

    // Сообщения самого бота.
    // Игнорируем, иначе зеркало зациклится.
    if (
        event.type ===
        'ONIMBOTV2MESSAGEADD'
    ) {
        return;
    }

    // Пользовательское сообщение.
    if (
        event.type ===
        'ONIMV2MESSAGEADD'
    ) {
        await handleBitrixUserMessage(
            event.data || {}
        );

        return;
    }

    if (
        event.type ===
        'ONIMBOTV2JOINCHAT'
    ) {
        console.log(
            '👋 Bitrix bot joined chat.'
        );

        return;
    }

    if (
        event.type ===
        'ONIMBOTV2DELETE'
    ) {
        console.log(
            '⚠️ Bitrix bot removed from chat.'
        );
    }
}

// ============================================================
// BITRIX POLL
// ============================================================

async function pollBitrix() {
    if (
        !bitrixEnabled ||
        stopping ||
        bitrixPolling
    ) {
        return;
    }

    bitrixPolling = true;

    try {
        const result =
            await getBitrixEvents();

        const events =
            Array.isArray(
                result?.events
            )
                ? result.events
                : [];

        const nextOffset =
            Number(
                result?.nextOffset
            );

        const hasMore =
            Boolean(
                result?.hasMore
            );

        console.log(
            `🔄 BITRIX: events=${events.length} offset=${bitrixOffset} next=${nextOffset}`
        );

        for (
            const event of events
        ) {
            try {
                await handleBitrixEvent(
                    event
                );
            } catch (error) {
                console.error(
                    '❌ Event processing:',
                    error.message
                );
            }
        }

        if (
            Number.isInteger(
                nextOffset
            )
        ) {
            bitrixOffset =
                nextOffset;

            saveOffset(
                bitrixOffset
            );
        }

        if (
            hasMore &&
            !stopping
        ) {
            setImmediate(
                pollBitrix
            );
        }

    } catch (error) {
        console.error(
            '❌ BITRIX FETCH ERROR:',
            error.message
        );
    } finally {
        bitrixPolling =
            false;
    }
}

// ============================================================
// BITRIX BOT CHECK
// ============================================================

async function checkBitrixBot() {
    const result =
        await bitrixCall(
            'imbot.v2.Bot.get',
            {
                botId:
                    BITRIX_BOT_ID,

                botToken:
                    BITRIX_BOT_TOKEN
            }
        );

    const info =
        result?.bot ||
        result ||
        {};

    console.log(
        '🤖 Bitrix bot:',
        info.id ||
            BITRIX_BOT_ID,
        info.code ||
            BITRIX_BOT_CODE
    );

    if (
        info.id &&
        Number(info.id) !==
            BITRIX_BOT_ID
    ) {
        throw new Error(
            `Неверный Bitrix Bot ID: ${info.id}`
        );
    }

    if (
        info.eventMode &&
        info.eventMode !==
            'fetch'
    ) {
        throw new Error(
            `Bitrix bot не FETCH: ${info.eventMode}`
        );
    }
}

// ============================================================
// HTTP
// ============================================================

const server =
    http.createServer(
        (req, res) => {
            if (
                req.method === 'GET' &&
                req.url === '/'
            ) {
                res.writeHead(
                    200,
                    {
                        'Content-Type':
                            'text/plain; charset=utf-8'
                    }
                );

                res.end(
                    'MLK AI Consultant is running'
                );

                return;
            }

            if (
                req.method === 'GET' &&
                req.url === '/health'
            ) {
                res.writeHead(
                    200,
                    {
                        'Content-Type':
                            'application/json; charset=utf-8'
                    }
                );

                res.end(
                    JSON.stringify(
                        {
                            ok: true,

                            telegram:
                                telegramEnabled,

                            telegramStarted:
                                telegramStarted,

                            bitrix:
                                bitrixEnabled,

                            bitrixPolling:
                                bitrixPolling,

                            bitrixOffset:
                                bitrixOffset,

                            deepSeek:
                                deepSeekEnabled,

                            clients:
                                Object.keys(
                                    clients
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
                404
            );

            res.end(
                'Not Found'
            );
        }
    );

// ============================================================
// START
// ============================================================

async function start() {
    startupLog();

    loadSessions();
    loadClients();
    loadOffset();

    server.listen(
        PORT,
        '0.0.0.0',
        async () => {
            console.log(
                '========================================'
            );

            console.log(
                '🚀 SERVER STARTED'
            );

            console.log(
                'PORT:',
                PORT
            );

            console.log(
                'TELEGRAM:',
                telegramEnabled
                    ? 'ENABLED'
                    : 'DISABLED'
            );

            console.log(
                'BITRIX:',
                bitrixEnabled
                    ? 'ENABLED'
                    : 'DISABLED'
            );

            console.log(
                'DEEPSEEK:',
                deepSeekEnabled
                    ? DEEPSEEK_MODEL
                    : 'DISABLED'
            );

            console.log(
                '========================================'
            );

            // ------------------------------------------------
            // BITRIX
            // ------------------------------------------------

            if (
                bitrixEnabled
            ) {
                try {
                    await checkBitrixBot();

                    await subscribeBitrixEvents();

                    await pollBitrix();

                    bitrixInterval =
                        setInterval(
                            pollBitrix,
                            BITRIX_POLL_INTERVAL_MS
                        );

                } catch (error) {
                    console.error(
                        '❌ Bitrix startup:',
                        error.message
                    );
                }
            }

            // ------------------------------------------------
            // TELEGRAM
            // ------------------------------------------------

            if (
                telegramEnabled
            ) {
                setupTelegram();

                try {
                    await bot.launch();

                    telegramStarted =
                        true;

                    console.log(
                        '✅ Telegram polling STARTED'
                    );

                    await notifyAdmin(
                        '✅ MLK бот запущен.\n\n' +
                        'Telegram → AI → Bitrix работает.\n' +
                        'Bitrix → Manager → Telegram работает.\n' +
                        'Для возврата клиента ИИ: /ai TELEGRAM_ID'
                    );

                } catch (error) {
                    console.error(
                        '❌ Telegram launch:',
                        error.message
                    );

                    throw error;
                }
            }
        }
    );
}

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(
    signal
) {
    if (stopping) {
        return;
    }

    stopping = true;

    console.log(
        `🛑 ${signal}`
    );

    if (
        bitrixInterval
    ) {
        clearInterval(
            bitrixInterval
        );
    }

    if (
        telegramStarted &&
        bot
    ) {
        try {
            bot.stop(
                signal
            );
        } catch (_) {}
    }

    server.close(
        () => {
            console.log(
                '✅ Server closed'
            );

            process.exit(0);
        }
    );

    setTimeout(
        () => process.exit(0),
        5000
    ).unref();
}

process.once(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.once(
    'SIGINT',
    () => shutdown('SIGINT')
);

process.on(
    'unhandledRejection',
    error => {
        console.error(
            '❌ UNHANDLED REJECTION:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            '❌ UNCAUGHT EXCEPTION:',
            error.stack ||
            error.message
        );
    }
);

start().catch(
    error => {
        console.error(
            '❌ FATAL START ERROR:',
            error.stack ||
            error.message
        );

        process.exit(1);
    }
);