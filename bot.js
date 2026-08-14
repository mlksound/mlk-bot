'use strict';

const http = require('http');

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const BITRIX_WEBHOOK_URL = String(
    process.env.BITRIX_WEBHOOK_URL || ''
).trim();

const BITRIX_BOT_TOKEN = String(
    process.env.BITRIX_BOT_TOKEN || ''
).trim();

const BOT_ID = Number(
    process.env.BOT_ID || 1787
);

const BOT_CODE = String(
    process.env.BOT_CODE || 'mlk_ai_consultant_v2'
).trim();

const DEEPSEEK_API_KEY = String(
    process.env.DEEPSEEK_API_KEY || ''
).trim();

const DEEPSEEK_MODEL = String(
    process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
).trim();

const TELEGRAM_BOT_TOKEN = String(
    process.env.TELEGRAM_BOT_TOKEN || ''
).trim();

const BITRIX_POLL_INTERVAL = 3000;
const TELEGRAM_POLL_TIMEOUT = 25;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

// ============================================================
// STATE
// ============================================================

let bitrixOffset = 0;
let telegramOffset = 0;

let bitrixPolling = false;
let telegramPolling = false;

let shuttingDown = false;

// ============================================================
// LOGGING
// ============================================================

function log(message, ...args) {
    console.log(message, ...args);
}

function error(message, ...args) {
    console.error(message, ...args);
}

function envStatus(value) {
    return value ? 'OK' : 'MISSING';
}

// IMPORTANT:
// Never print secret values.
// In particular, BITRIX_WEBHOOK_URL and tokens are never logged.
function printStartupInfo() {
    console.log('========================================');
    console.log('MLK BITRIX + TELEGRAM + DEEPSEEK');
    console.log('========================================');

    console.log('BITRIX_WEBHOOK_URL:', envStatus(BITRIX_WEBHOOK_URL));
    console.log('BITRIX_BOT_TOKEN:', envStatus(BITRIX_BOT_TOKEN));
    console.log('BOT_ID:', BOT_ID);
    console.log('BOT_CODE:', BOT_CODE);

    console.log('DEEPSEEK_API_KEY:', envStatus(DEEPSEEK_API_KEY));
    console.log('DEEPSEEK_MODEL:', DEEPSEEK_MODEL);

    console.log(
        'TELEGRAM_BOT_TOKEN:',
        envStatus(TELEGRAM_BOT_TOKEN)
    );

    console.log('PORT:', PORT);

    console.log('========================================');
}

// ============================================================
// BITRIX URLS
// ============================================================

function getBitrixBaseUrl() {
    return BITRIX_WEBHOOK_URL.replace(/\/+$/, '');
}

function getBitrixEventUrl() {
    return getBitrixBaseUrl() + '/imbot.v2.Event.get';
}

function getBitrixSendUrl() {
    return getBitrixBaseUrl() + '/imbot.v2.Chat.Message.send';
}

// ============================================================
// GENERIC JSON FETCH
// ============================================================

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch (parseError) {
        throw new Error(
            'Invalid JSON response. HTTP ' +
            response.status +
            ': ' +
            text.slice(0, 1000)
        );
    }

    if (!response.ok) {
        throw new Error(
            'HTTP ' +
            response.status +
            ': ' +
            JSON.stringify(data)
        );
    }

    return data;
}

// ============================================================
// BITRIX API
// ============================================================

async function bitrixEventGet() {
    if (!BITRIX_WEBHOOK_URL) {
        throw new Error('BITRIX_WEBHOOK_URL is missing');
    }

    if (!BITRIX_BOT_TOKEN) {
        throw new Error('BITRIX_BOT_TOKEN is missing');
    }

    const url = getBitrixEventUrl();

    const params = {
        botId: BOT_ID,
        botToken: BITRIX_BOT_TOKEN,
        offset: bitrixOffset,
        limit: 50
    };

    console.log('----------------------------------------');
    console.log('➡️ BITRIX API: imbot.v2.Event.get');
    console.log('📤 PARAMS:', JSON.stringify({
        botId: BOT_ID,
        botToken: '[HIDDEN]',
        offset: bitrixOffset,
        limit: 50
    }));

    const data = await fetchJson(url, {
        method: 'POST',
        body: JSON.stringify(params)
    });

    return data;
}

async function bitrixSendMessage(dialogId, message) {
    if (!BITRIX_WEBHOOK_URL) {
        throw new Error('BITRIX_WEBHOOK_URL is missing');
    }

    if (!BITRIX_BOT_TOKEN) {
        throw new Error('BITRIX_BOT_TOKEN is missing');
    }

    const url = getBitrixSendUrl();

    const params = {
        botId: BOT_ID,
        botToken: BITRIX_BOT_TOKEN,
        dialogId: String(dialogId),
        fields: {
            message: String(message),
            urlPreview: false
        }
    };

    console.log('========================================');
    console.log('📤 ОТПРАВЛЯЕМ ОТВЕТ В BITRIX');
    console.log('========================================');
    console.log('BOT_ID:', BOT_ID);
    console.log('DIALOG_ID:', String(dialogId));
    console.log('MESSAGE:', message);

    const data = await fetchJson(url, {
        method: 'POST',
        body: JSON.stringify(params)
    });

    return data;
}

// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(userMessage) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY is missing');
    }

    const message = String(userMessage || '').trim();

    if (!message) {
        return 'Пожалуйста, напишите вопрос.';
    }

    console.log('========================================');
    console.log('🧠 DEEPSEEK REQUEST');
    console.log('========================================');
    console.log('MODEL:', DEEPSEEK_MODEL);
    console.log('USER MESSAGE:', message);

    const body = {
        model: DEEPSEEK_MODEL,
        messages: [
            {
                role: 'system',
                content:
                    'Ты ИИ-консультант компании MLK. ' +
                    'Отвечай кратко, понятно и по существу. ' +
                    'Для теста просто отвечай на сообщение пользователя.'
            },
            {
                role: 'user',
                content: message
            }
        ],
        stream: false,
        max_tokens: 500
    };

    console.log('📤 DEEPSEEK REQUEST BODY:', JSON.stringify(body, null, 2));

    const response = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();

    console.log('⬅️ DEEPSEEK HTTP:', response.status);

    if (!response.ok) {
        console.error(
            '❌ DEEPSEEK ERROR:',
            text.slice(0, 2000)
        );

        throw new Error(
            'DeepSeek HTTP ' +
            response.status +
            ': ' +
            text.slice(0, 1000)
        );
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch (parseError) {
        throw new Error(
            'DeepSeek returned invalid JSON: ' +
            text.slice(0, 1000)
        );
    }

    console.log(
        '⬅️ DEEPSEEK RESPONSE:',
        JSON.stringify(data)
    );

    const answer =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;

    if (!answer) {
        throw new Error(
            'DeepSeek response does not contain choices[0].message.content'
        );
    }

    console.log('========================================');
    console.log('🧠 DEEPSEEK ANSWER');
    console.log('========================================');
    console.log(answer);

    return String(answer).trim();
}

// ============================================================
// BITRIX EVENT PROCESSING
// ============================================================

async function processBitrixEvent(event) {
    console.log('========================================');
    console.log('📦 PROCESS EVENT');
    console.log('========================================');

    console.log('EVENT ID:', event.eventId);
    console.log('EVENT TYPE:', event.type);
    console.log('EVENT DATE:', event.date);

    if (event.type !== 'ONIMBOTV2MESSAGEADD') {
        console.log('ℹ️ Событие не является сообщением. Пропускаем.');
        return;
    }

    const data = event.data || {};
    const message = data.message || {};
    const chat = data.chat || {};
    const user = data.user || {};

    const text = String(message.text || '').trim();

    const chatId =
        message.chatId ||
        message.chat_id ||
        chat.id ||
        null;

    const dialogId =
        chat.dialogId ||
        chat.dialog_id ||
        null;

    console.log('----------------------------------------');
    console.log('💬 MESSAGE');
    console.log('----------------------------------------');

    console.log('ID:', message.id);
    console.log('CHAT ID:', chatId);
    console.log('DIALOG ID:', dialogId);
    console.log('TEXT:', text);

    console.log('----------------------------------------');
    console.log('👤 USER');
    console.log('----------------------------------------');

    console.log('ID:', user.id);
    console.log('NAME:', user.name);

    console.log('----------------------------------------');
    console.log('🤖 BOT');
    console.log('----------------------------------------');

    console.log('ID:', BOT_ID);
    console.log('CODE:', BOT_CODE);

    if (!text) {
        console.log('⚠️ Пустое сообщение. Пропускаем.');
        return;
    }

    if (!dialogId) {
        console.error(
            '❌ Не найден dialogId. Событие:',
            JSON.stringify(event)
        );
        return;
    }

    // Avoid responding to bot/system messages.
    if (message.isSystem === true) {
        console.log('⚠️ Системное сообщение. Пропускаем.');
        return;
    }

    console.log('➡️ ШАГ 1: отправляем сообщение в DeepSeek');

    let answer;

    try {
        answer = await askDeepSeek(text);
    } catch (err) {
        console.error('❌ DEEPSEEK FAILED:', err.message);

        answer =
            'Не удалось получить ответ от ИИ. ' +
            'Попробуйте ещё раз через несколько секунд.';
    }

    console.log('➡️ ШАГ 2: отправляем ответ в Bitrix');

    try {
        const result = await bitrixSendMessage(
            dialogId,
            answer
        );

        console.log('🎉 ОТВЕТ УСПЕШНО ОТПРАВЛЕН В BITRIX');
        console.log('RESULT:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error(
            '❌ BITRIX SEND FAILED:',
            err.message
        );
    }
}

// ============================================================
// BITRIX FETCH LOOP
// ============================================================

async function pollBitrix() {
    if (shuttingDown) {
        return;
    }

    if (bitrixPolling) {
        console.log('⚠️ Bitrix poll уже выполняется. Пропускаем.');
        return;
    }

    bitrixPolling = true;

    try {
        console.log('========================================');
        console.log('🔄 FETCH POLL');
        console.log('========================================');

        console.log('TIME:', new Date().toISOString());
        console.log('BOT_ID:', BOT_ID);
        console.log('OFFSET:', bitrixOffset);

        const data = await bitrixEventGet();

        console.log(
            '⬅️ BITRIX RESPONSE:',
            JSON.stringify(data)
        );

        const result = data && data.result
            ? data.result
            : {};

        const events = Array.isArray(result.events)
            ? result.events
            : [];

        const nextOffset =
            typeof result.nextOffset === 'number'
                ? result.nextOffset
                : bitrixOffset;

        const hasMore = Boolean(result.hasMore);

        console.log('📦 EVENTS:', events.length);
        console.log('NEXT OFFSET:', nextOffset);
        console.log('HAS MORE:', hasMore);

        // Advance offset BEFORE processing.
        // This prevents the same event from being picked up
        // again if processing takes several seconds.
        if (nextOffset !== bitrixOffset) {
            bitrixOffset = nextOffset;
            console.log(
                '➡️ OFFSET UPDATED TO:',
                bitrixOffset
            );
        }

        if (events.length === 0) {
            console.log('📭 Новых событий нет.');
            return;
        }

        for (const event of events) {
            console.log(
                '🎉🎉🎉 ПОЛУЧЕНО СОБЫТИЕ 🎉🎉🎉'
            );

            try {
                await processBitrixEvent(event);
            } catch (err) {
                console.error(
                    '❌ EVENT PROCESSING ERROR:',
                    err.message
                );
            }
        }

        // If Bitrix says there are more events, immediately fetch
        // the next batch instead of waiting three seconds.
        if (hasMore && !shuttingDown) {
            console.log(
                '🔁 HAS MORE=true — забираем следующую пачку.'
            );

            await pollBitrix();
        }
    } catch (err) {
        console.error('❌ BITRIX FETCH ERROR');
        console.error(err.message);
    } finally {
        bitrixPolling = false;
    }
}

function startBitrixLoop() {
    console.log('========================================');
    console.log('🚀 BITRIX FETCH LOOP STARTED');
    console.log('========================================');

    // First poll immediately.
    pollBitrix();

    // Then every 3 seconds.
    setInterval(() => {
        pollBitrix();
    }, BITRIX_POLL_INTERVAL);
}

// ============================================================
// TELEGRAM API
// ============================================================

function telegramApiUrl(method) {
    return (
        'https://api.telegram.org/bot' +
        TELEGRAM_BOT_TOKEN +
        '/' +
        method
    );
}

async function telegramApi(method, params = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN is missing');
    }

    const url = telegramApiUrl(method);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    });

    const text = await response.text();

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch (parseError) {
        throw new Error(
            'Telegram invalid JSON. HTTP ' +
            response.status +
            ': ' +
            text.slice(0, 1000)
        );
    }

    if (!response.ok || data.ok !== true) {
        throw new Error(
            'Telegram HTTP ' +
            response.status +
            ': ' +
            JSON.stringify(data)
        );
    }

    return data;
}

async function getTelegramMe() {
    const data = await telegramApi('getMe');

    console.log('========================================');
    console.log('🤖 TELEGRAM BOT');
    console.log('========================================');

    console.log(
        'USERNAME:',
        data.result && data.result.username
            ? '@' + data.result.username
            : '[NO USERNAME]'
    );

    console.log(
        'ID:',
        data.result ? data.result.id : '[UNKNOWN]'
    );

    return data.result;
}

async function sendTelegramMessage(chatId, text) {
    const safeText = String(text || '').trim();

    if (!safeText) {
        return;
    }

    // Telegram message limit is 4096 characters.
    // Split longer AI responses.
    const chunks = [];

    for (let i = 0; i < safeText.length; i += 4000) {
        chunks.push(safeText.slice(i, i + 4000));
    }

    for (const chunk of chunks) {
        await telegramApi('sendMessage', {
            chat_id: chatId,
            text: chunk
        });
    }
}

// ============================================================
// TELEGRAM UPDATE PROCESSING
// ============================================================

async function processTelegramUpdate(update) {
    if (!update || !update.message) {
        return;
    }

    const message = update.message;

    const chatId =
        message.chat &&
        message.chat.id;

    const text =
        typeof message.text === 'string'
            ? message.text.trim()
            : '';

    if (!chatId || !text) {
        return;
    }

    console.log('========================================');
    console.log('📨 TELEGRAM MESSAGE');
    console.log('========================================');

    console.log('UPDATE ID:', update.update_id);
    console.log('CHAT ID:', chatId);
    console.log('USER:', message.from
        ? (
            message.from.first_name ||
            message.from.username ||
            message.from.id
        )
        : '[UNKNOWN]'
    );
    console.log('TEXT:', text);

    let answer;

    try {
        answer = await askDeepSeek(text);
    } catch (err) {
        console.error(
            '❌ TELEGRAM DEEPSEEK ERROR:',
            err.message
        );

        answer =
            'Не удалось получить ответ от ИИ. ' +
            'Попробуйте ещё раз через несколько секунд.';
    }

    try {
        await sendTelegramMessage(
            chatId,
            answer
        );

        console.log(
            '🎉 TELEGRAM RESPONSE SENT'
        );
    } catch (err) {
        console.error(
            '❌ TELEGRAM SEND ERROR:',
            err.message
        );
    }
}

// ============================================================
// TELEGRAM LONG POLLING
// ============================================================

async function pollTelegram() {
    if (shuttingDown) {
        return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
        return;
    }

    if (telegramPolling) {
        return;
    }

    telegramPolling = true;

    try {
        const data = await telegramApi(
            'getUpdates',
            {
                offset: telegramOffset,
                timeout: TELEGRAM_POLL_TIMEOUT,
                allowed_updates: [
                    'message'
                ]
            }
        );

        const updates = Array.isArray(data.result)
            ? data.result
            : [];

        if (updates.length === 0) {
            return;
        }

        console.log(
            '📦 TELEGRAM UPDATES:',
            updates.length
        );

        for (const update of updates) {
            if (
                typeof update.update_id === 'number'
            ) {
                telegramOffset =
                    update.update_id + 1;
            }

            try {
                await processTelegramUpdate(update);
            } catch (err) {
                console.error(
                    '❌ TELEGRAM UPDATE ERROR:',
                    err.message
                );
            }
        }
    } catch (err) {
        console.error(
            '❌ TELEGRAM POLLING ERROR:',
            err.message
        );

        // Do not hammer Telegram if something goes wrong.
        await sleep(3000);
    } finally {
        telegramPolling = false;
    }
}

async function startTelegramLoop() {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log(
            '⚠️ TELEGRAM_BOT_TOKEN отсутствует — Telegram отключён.'
        );
        return;
    }

    console.log('========================================');
    console.log('🚀 TELEGRAM POLLING STARTED');
    console.log('========================================');

    try {
        await getTelegramMe();
    } catch (err) {
        console.error(
            '❌ TELEGRAM getMe ERROR:',
            err.message
        );
    }

    while (!shuttingDown) {
        await pollTelegram();
    }
}

// ============================================================
// HEALTH SERVER
// ============================================================

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        const response = {
            ok: true,
            service: 'mlk-bot',
            bitrix: Boolean(BITRIX_WEBHOOK_URL && BITRIX_BOT_TOKEN),
            telegram: Boolean(TELEGRAM_BOT_TOKEN),
            deepseek: Boolean(DEEPSEEK_API_KEY),
            botId: BOT_ID,
            botCode: BOT_CODE,
            model: DEEPSEEK_MODEL,
            bitrixOffset: bitrixOffset,
            telegramOffset: telegramOffset
        };

        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(
            JSON.stringify(response, null, 2)
        );

        return;
    }

    res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8'
    });

    res.end(
        JSON.stringify({
            ok: false,
            error: 'Not found'
        })
    );
});

function startServer() {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('========================================');
        console.log('🚀 SERVER STARTED');
        console.log('========================================');

        console.log('PORT:', PORT);
        console.log('MODE: FETCH');
        console.log('BOT ID:', BOT_ID);
        console.log('BOT CODE:', BOT_CODE);
        console.log('DEEPSEEK:', DEEPSEEK_MODEL);

        console.log(
            'BITRIX:',
            BITRIX_WEBHOOK_URL && BITRIX_BOT_TOKEN
                ? 'ENABLED'
                : 'DISABLED'
        );

        console.log(
            'TELEGRAM:',
            TELEGRAM_BOT_TOKEN
                ? 'ENABLED'
                : 'DISABLED'
        );

        console.log('========================================');
    });
}

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log('========================================');
    console.log('🛑 ' + signal);
    console.log('========================================');

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(0);
    }, 5000).unref();
}

process.on('SIGTERM', () => {
    shutdown('SIGTERM');
});

process.on('SIGINT', () => {
    shutdown('SIGINT');
});

// ============================================================
// START
// ============================================================

async function main() {
    printStartupInfo();

    if (!BITRIX_WEBHOOK_URL) {
        console.error(
            '❌ BITRIX_WEBHOOK_URL не задан.'
        );
    }

    if (!BITRIX_BOT_TOKEN) {
        console.error(
            '❌ BITRIX_BOT_TOKEN не задан.'
        );
    }

    if (!DEEPSEEK_API_KEY) {
        console.error(
            '❌ DEEPSEEK_API_KEY не задан.'
        );
    }

    if (!TELEGRAM_BOT_TOKEN) {
        console.error(
            '⚠️ TELEGRAM_BOT_TOKEN не задан.'
        );
        console.error(
            'Telegram polling будет отключён.'
        );
    }

    startServer();

    if (BITRIX_WEBHOOK_URL && BITRIX_BOT_TOKEN) {
        startBitrixLoop();
    } else {
        console.error(
            '❌ Bitrix FETCH не запущен: отсутствуют настройки.'
        );
    }

    if (TELEGRAM_BOT_TOKEN) {
        startTelegramLoop();
    } else {
        console.log(
            '⚠️ Telegram отключён: TELEGRAM_BOT_TOKEN отсутствует.'
        );
    }
}

main().catch(err => {
    console.error(
        '💥 FATAL STARTUP ERROR:',
        err
    );

    process.exit(1);
});