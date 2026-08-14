```javascript
'use strict';

const http = require('http');

const PORT = Number(process.env.PORT || 10000);

// ============================================================
// ENV
// ============================================================

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL?.trim();
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN?.trim();

const BOT_ID = Number(process.env.BOT_ID || 1787);
const BOT_CODE = process.env.BOT_CODE || 'mlk_ai_consultant_v2';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY?.trim();
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();

const POLL_INTERVAL = 3000;

// ============================================================
// SAFE LOGGING
// ============================================================

function envStatus(value) {
    return value ? 'OK' : 'MISSING';
}

function maskSecret(value) {
    if (!value) return '[MISSING]';

    if (value.length <= 8) {
        return '[SET]';
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function safeBitrixUrl(url) {
    if (!url) return '[MISSING]';

    try {
        const parsed = new URL(url);

        // Никогда не показываем pathname целиком:
        // в pathname находится webhook token.
        return `${parsed.protocol}//${parsed.host}/rest/[HIDDEN]/`;
    } catch {
        return '[INVALID URL]';
    }
}

// ============================================================
// BITRIX URL
// ============================================================

function normalizeBitrixWebhookUrl(value) {
    if (!value) {
        throw new Error('BITRIX_WEBHOOK_URL is not configured');
    }

    let url = value.trim();

    // Убираем завершающие /
    url = url.replace(/\/+$/, '');

    // Если пользователь случайно указал метод в конце —
    // убираем его, чтобы дальше добавлять метод самостоятельно.
    url = url.replace(/\/imbot\.v2\.[^/]+$/, '');

    return url;
}

let BITRIX_BASE_URL = null;

try {
    BITRIX_BASE_URL = normalizeBitrixWebhookUrl(BITRIX_WEBHOOK_URL);
} catch (error) {
    console.error('❌ BITRIX_WEBHOOK_URL ERROR:', error.message);
}

// ============================================================
// STATE
// ============================================================

let bitrixOffset = 0;

let stopping = false;

let bitrixLoopRunning = false;
let telegramLoopRunning = false;

let telegramOffset = 0;

// ============================================================
// STARTUP
// ============================================================

console.log('========================================');
console.log('MLK BITRIX FETCH + TELEGRAM + DEEPSEEK');
console.log('========================================');

console.log('BITRIX_WEBHOOK_URL:', envStatus(BITRIX_WEBHOOK_URL));
console.log('BITRIX_BOT_TOKEN:', envStatus(BITRIX_BOT_TOKEN));
console.log('BOT_ID:', BOT_ID);
console.log('BOT_CODE:', BOT_CODE);

console.log('DEEPSEEK_API_KEY:', envStatus(DEEPSEEK_API_KEY));
console.log('DEEPSEEK_MODEL:', DEEPSEEK_MODEL);

console.log('TELEGRAM_BOT_TOKEN:', envStatus(TELEGRAM_BOT_TOKEN));

console.log('PORT:', PORT);

console.log('========================================');

if (BITRIX_BASE_URL) {
    console.log(
        '🔗 BITRIX BASE:',
        safeBitrixUrl(BITRIX_BASE_URL)
    );
}

console.log(
    '🔐 BITRIX WEBHOOK:',
    maskSecret(
        BITRIX_WEBHOOK_URL
            ? BITRIX_WEBHOOK_URL.split('/').pop()
            : null
    )
);

console.log('========================================');

if (!BITRIX_WEBHOOK_URL) {
    console.error('❌ BITRIX_WEBHOOK_URL отсутствует.');
}

if (!BITRIX_BOT_TOKEN) {
    console.error('❌ BITRIX_BOT_TOKEN отсутствует.');
}

if (!DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY отсутствует.');
}

if (!TELEGRAM_BOT_TOKEN) {
    console.error(
        '⚠️ TELEGRAM_BOT_TOKEN не виден процессу Node.js.'
    );
    console.error(
        '⚠️ Telegram polling будет отключён.'
    );
}

console.log('========================================');

// ============================================================
// GENERIC JSON REQUEST
// ============================================================

async function postJson(url, body, options = {}) {
    const timeout = options.timeout || 30000;

    const controller = new AbortController();

    const timer = setTimeout(() => {
        controller.abort();
    }, timeout);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        const text = await response.text();

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            data = {
                raw: text
            };
        }

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}: ${text}`
            );
        }

        return data;

    } finally {
        clearTimeout(timer);
    }
}

// ============================================================
// BITRIX API
// ============================================================

async function bitrixCall(method, params) {
    if (!BITRIX_BASE_URL) {
        throw new Error('Bitrix base URL is not configured');
    }

    const url = `${BITRIX_BASE_URL}/${method}`;

    const safeParams = {
        ...params
    };

    if (safeParams.botToken) {
        safeParams.botToken = '[HIDDEN]';
    }

    console.log(`➡️ BITRIX API: ${method}`);
    console.log(`🌐 URL: ${safeBitrixUrl(url)}`);
    console.log(
        '📤 PARAMS:',
        JSON.stringify(safeParams)
    );

    const result = await postJson(
        url,
        params,
        {
            timeout: 30000
        }
    );

    return result;
}

// ============================================================
// BITRIX FETCH
// ============================================================

async function fetchBitrixEvents() {
    if (!BITRIX_WEBHOOK_URL || !BITRIX_BOT_TOKEN) {
        return null;
    }

    console.log('========================================');
    console.log('🔄 FETCH POLL');
    console.log('========================================');

    console.log(
        'TIME:',
        new Date().toISOString()
    );

    console.log('BOT_ID:', BOT_ID);
    console.log('OFFSET:', bitrixOffset);

    console.log('----------------------------------------');

    try {
        const response = await bitrixCall(
            'imbot.v2.Event.get',
            {
                botId: BOT_ID,
                botToken: BITRIX_BOT_TOKEN,
                offset: bitrixOffset,
                limit: 50
            }
        );

        const result = response?.result;

        if (!result) {
            console.error(
                '❌ Bitrix response does not contain result:',
                JSON.stringify(response)
            );

            return null;
        }

        const events = Array.isArray(result.events)
            ? result.events
            : [];

        const nextOffset =
            Number.isFinite(Number(result.nextOffset))
                ? Number(result.nextOffset)
                : bitrixOffset;

        console.log(
            '⬅️ BITRIX EVENTS:',
            events.length
        );

        console.log(
            'NEXT OFFSET:',
            nextOffset
        );

        console.log(
            'HAS MORE:',
            Boolean(result.hasMore)
        );

        // IMPORTANT:
        // nextOffset подтверждает обработанные события.
        // Мы обновляем offset только после получения ответа.
        bitrixOffset = nextOffset;

        return {
            events,
            hasMore: Boolean(result.hasMore)
        };

    } catch (error) {
        console.error(
            '❌ BITRIX FETCH ERROR:',
            error.message
        );

        return null;
    }
}

// ============================================================
// BITRIX SEND MESSAGE
// ============================================================

async function sendBitrixMessage(dialogId, message, replyId = null) {
    if (!dialogId) {
        throw new Error(
            'Cannot send Bitrix message: dialogId is missing'
        );
    }

    if (!message || !message.trim()) {
        throw new Error(
            'Cannot send Bitrix message: message is empty'
        );
    }

    const fields = {
        message: message.trim(),
        urlPreview: false
    };

    if (replyId) {
        fields.replyId = Number(replyId);
    }

    console.log('========================================');
    console.log('📤 BITRIX SEND');
    console.log('========================================');

    console.log('DIALOG ID:', dialogId);
    console.log('MESSAGE:');
    console.log(message);

    try {
        const response = await bitrixCall(
            'imbot.v2.Chat.Message.send',
            {
                botId: BOT_ID,
                botToken: BITRIX_BOT_TOKEN,
                dialogId: String(dialogId),
                fields
            }
        );

        console.log(
            '⬅️ BITRIX SEND RESPONSE:',
            JSON.stringify(response)
        );

        if (response?.result?.id) {
            console.log(
                '✅ BITRIX MESSAGE SENT:',
                response.result.id
            );
        }

        return response;

    } catch (error) {
        console.error(
            '❌ BITRIX SEND ERROR:',
            error.message
        );

        throw error;
    }
}

// ============================================================
// EXTRACT BITRIX MESSAGE
// ============================================================

function extractBitrixMessage(event) {
    if (!event) {
        return null;
    }

    if (event.type !== 'ONIMBOTV2MESSAGEADD') {
        return null;
    }

    const data = event.data || {};

    const message = data.message || {};
    const chat = data.chat || {};
    const user = data.user || {};

    const text =
        typeof message.text === 'string'
            ? message.text.trim()
            : '';

    if (!text) {
        return null;
    }

    return {
        eventId: event.eventId,
        messageId: message.id,
        chatId: message.chatId || message.chat_id,
        dialogId: chat.dialogId,
        text,
        userId: message.authorId || message.author_id,
        userName: user.name || ''
    };
}

// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(userMessage, source = 'unknown') {
    if (!DEEPSEEK_API_KEY) {
        throw new Error(
            'DEEPSEEK_API_KEY is not configured'
        );
    }

    console.log('========================================');
    console.log('🧠 DEEPSEEK REQUEST');
    console.log('========================================');

    console.log('SOURCE:', source);
    console.log('MODEL:', DEEPSEEK_MODEL);
    console.log('USER MESSAGE:', userMessage);

    const body = {
        model: DEEPSEEK_MODEL,
        messages: [
            {
                role: 'system',
                content:
                    'Ты ИИ-консультант компании MLK. ' +
                    'Отвечай на русском языке, кратко, понятно и по существу. ' +
                    'Не выдумывай факты о компании, если пользователь не дал их в сообщении.'
            },
            {
                role: 'user',
                content: userMessage
            }
        ],
        stream: false,
        max_tokens: 500
    };

    console.log(
        '📤 DEEPSEEK BODY:',
        JSON.stringify(body, null, 2)
    );

    try {
        const response = await fetch(
            'https://api.deepseek.com/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization':
                        `Bearer ${DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify(body)
            }
        );

        const text = await response.text();

        if (!response.ok) {
            throw new Error(
                `DeepSeek HTTP ${response.status}: ${text}`
            );
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(
                'DeepSeek returned invalid JSON'
            );
        }

        const answer =
            data?.choices?.[0]?.message?.content?.trim();

        if (!answer) {
            throw new Error(
                'DeepSeek returned empty answer'
            );
        }

        console.log('⬅️ DEEPSEEK HTTP:', response.status);

        console.log('🧠 DEEPSEEK ANSWER:');
        console.log(answer);

        return answer;

    } catch (error) {
        console.error(
            '❌ DEEPSEEK ERROR:',
            error.message
        );

        throw error;
    }
}

// ============================================================
// PROCESS BITRIX EVENT
// ============================================================

async function processBitrixEvent(event) {
    console.log('========================================');
    console.log('🎉 ПОЛУЧЕНО СОБЫТИЕ');
    console.log('========================================');

    console.log('EVENT ID:', event.eventId);
    console.log('EVENT TYPE:', event.type);

    const incoming = extractBitrixMessage(event);

    if (!incoming) {
        console.log(
            'ℹ️ Событие не является текстовым сообщением.'
        );

        return;
    }

    console.log('----------------------------------------');
    console.log('💬 BITRIX MESSAGE');
    console.log('----------------------------------------');

    console.log('MESSAGE ID:', incoming.messageId);
    console.log('CHAT ID:', incoming.chatId);
    console.log('DIALOG ID:', incoming.dialogId);
    console.log('USER ID:', incoming.userId);
    console.log('USER:', incoming.userName);
    console.log('TEXT:', incoming.text);

    // Не отвечаем на сообщения, которые нельзя отправить.
    if (!incoming.dialogId) {
        console.error(
            '❌ DIALOG ID отсутствует.'
        );

        return;
    }

    try {
        console.log(
            '➡️ ШАГ 1: Bitrix → DeepSeek'
        );

        const answer = await askDeepSeek(
            incoming.text,
            'bitrix'
        );

        console.log(
            '➡️ ШАГ 2: DeepSeek → Bitrix'
        );

        await sendBitrixMessage(
            incoming.dialogId,
            answer,
            incoming.messageId
        );

        console.log(
            '✅ BITRIX PIPELINE COMPLETE'
        );

    } catch (error) {
        console.error(
            '❌ BITRIX PIPELINE ERROR:',
            error.message
        );

        // Если DeepSeek упал, пользователь всё равно должен
        // получить понятный ответ в Bitrix.
        try {
            await sendBitrixMessage(
                incoming.dialogId,
                'Не удалось получить ответ от AI. Попробуйте ещё раз через несколько секунд.'
            );
        } catch (sendError) {
            console.error(
                '❌ Не удалось отправить сообщение об ошибке в Bitrix:',
                sendError.message
            );
        }
    }
}

// ============================================================
// BITRIX LOOP
// ============================================================

async function bitrixLoop() {
    if (bitrixLoopRunning) {
        console.log(
            '⚠️ Bitrix loop уже запущен. Второй loop не запускаем.'
        );

        return;
    }

    bitrixLoopRunning = true;

    console.log('========================================');
    console.log('🚀 BITRIX FETCH LOOP STARTED');
    console.log('========================================');

    while (!stopping) {
        const result = await fetchBitrixEvents();

        if (result?.events?.length) {
            for (const event of result.events) {
                if (stopping) {
                    break;
                }

                await processBitrixEvent(event);
            }
        } else if (result) {
            console.log(
                '📭 Новых Bitrix событий нет.'
            );
        }

        if (stopping) {
            break;
        }

        await sleep(POLL_INTERVAL);
    }

    bitrixLoopRunning = false;

    console.log(
        '🛑 BITRIX FETCH LOOP STOPPED'
    );
}

// ============================================================
// TELEGRAM API
// ============================================================

function telegramUrl(method) {
    return (
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`
    );
}

async function telegramCall(method, params = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is not configured'
        );
    }

    const response = await postJson(
        telegramUrl(method),
        params,
        {
            timeout: 35000
        }
    );

    if (!response?.ok) {
        throw new Error(
            `Telegram API error: ${JSON.stringify(response)}`
        );
    }

    return response;
}

// ============================================================
// TELEGRAM SEND
// ============================================================

async function sendTelegramMessage(chatId, message) {
    if (!chatId) {
        throw new Error(
            'Telegram chat_id is missing'
        );
    }

    if (!message) {
        throw new Error(
            'Telegram message is empty'
        );
    }

    console.log('========================================');
    console.log('📤 TELEGRAM SEND');
    console.log('========================================');

    console.log('CHAT ID:', chatId);
    console.log('MESSAGE:');
    console.log(message);

    await telegramCall(
        'sendMessage',
        {
            chat_id: chatId,
            text: message
        }
    );

    console.log(
        '✅ TELEGRAM MESSAGE SENT'
    );
}

// ============================================================
// TELEGRAM UPDATE
// ============================================================

async function processTelegramUpdate(update) {
    const message = update?.message;

    if (!message) {
        return;
    }

    if (message.from?.is_bot) {
        return;
    }

    const chatId = message.chat?.id;

    const text =
        typeof message.text === 'string'
            ? message.text.trim()
            : '';

    if (!chatId || !text) {
        return;
    }

    console.log('========================================');
    console.log('📨 TELEGRAM UPDATE');
    console.log('========================================');

    console.log(
        'UPDATE ID:',
        update.update_id
    );

    console.log(
        'CHAT ID:',
        chatId
    );

    console.log(
        'USER:',
        message.from?.first_name || ''
    );

    console.log(
        'TEXT:',
        text
    );

    try {
        console.log(
            '➡️ TELEGRAM → DEEPSEEK'
        );

        const answer = await askDeepSeek(
            text,
            'telegram'
        );

        console.log(
            '➡️ DEEPSEEK → TELEGRAM'
        );

        await sendTelegramMessage(
            chatId,
            answer
        );

        console.log(
            '✅ TELEGRAM PIPELINE COMPLETE'
        );

    } catch (error) {
        console.error(
            '❌ TELEGRAM PIPELINE ERROR:',
            error.message
        );

        try {
            await sendTelegramMessage(
                chatId,
                'Не удалось получить ответ от AI. Попробуйте ещё раз через несколько секунд.'
            );
        } catch (sendError) {
            console.error(
                '❌ Telegram error message failed:',
                sendError.message
            );
        }
    }
}

// ============================================================
// TELEGRAM LOOP
// ============================================================

async function telegramLoop() {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log(
            '⚠️ Telegram polling не запущен: TELEGRAM_BOT_TOKEN отсутствует в process.env.'
        );

        return;
    }

    if (telegramLoopRunning) {
        console.log(
            '⚠️ Telegram loop уже запущен.'
        );

        return;
    }

    telegramLoopRunning = true;

    console.log('========================================');
    console.log('🚀 TELEGRAM POLLING STARTED');
    console.log('========================================');

    while (!stopping) {
        try {
            const response = await telegramCall(
                'getUpdates',
                {
                    offset: telegramOffset,
                    timeout: 25,
                    allowed_updates: [
                        'message'
                    ]
                }
            );

            const updates = Array.isArray(response.result)
                ? response.result
                : [];

            if (updates.length) {
                console.log(
                    '📦 TELEGRAM UPDATES:',
                    updates.length
                );

                for (const update of updates) {
                    if (
                        Number.isInteger(update.update_id)
                    ) {
                        telegramOffset =
                            update.update_id + 1;
                    }

                    await processTelegramUpdate(
                        update
                    );
                }
            }

        } catch (error) {
            if (!stopping) {
                console.error(
                    '❌ TELEGRAM POLLING ERROR:',
                    error.message
                );

                await sleep(5000);
            }
        }
    }

    telegramLoopRunning = false;

    console.log(
        '🛑 TELEGRAM POLLING STOPPED'
    );
}

// ============================================================
// HEALTH SERVER
// ============================================================

const server = http.createServer(
    (req, res) => {
        if (req.url === '/health') {
            res.writeHead(
                200,
                {
                    'Content-Type':
                        'application/json; charset=utf-8'
                }
            );

            res.end(
                JSON.stringify({
                    ok: true,
                    service: 'mlk-bot',
                    bitrix: Boolean(
                        BITRIX_WEBHOOK_URL &&
                        BITRIX_BOT_TOKEN
                    ),
                    telegram: Boolean(
                        TELEGRAM_BOT_TOKEN
                    ),
                    deepseek: Boolean(
                        DEEPSEEK_API_KEY
                    ),
                    botId: BOT_ID,
                    botCode: BOT_CODE
                })
            );

            return;
        }

        res.writeHead(200, {
            'Content-Type':
                'text/plain; charset=utf-8'
        });

        res.end('MLK bot is running\n');
    }
);

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
    if (stopping) {
        return;
    }

    stopping = true;

    console.log('========================================');
    console.log(`🛑 ${signal}`);
    console.log('========================================');

    server.close(() => {
        console.log(
            '✅ Server closed'
        );

        process.exit(0);
    });

    // Даём текущему запросу завершиться.
    setTimeout(() => {
        console.log(
            '⚠️ Forced shutdown'
        );

        process.exit(0);
    }, 10000);
}

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

// ============================================================
// START
// ============================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {
        console.log('========================================');
        console.log('🚀 SERVER STARTED');
        console.log('========================================');

        console.log('PORT:', PORT);
        console.log('MODE:', 'FETCH');

        console.log(
            'BOT ID:',
            BOT_ID
        );

        console.log(
            'BOT CODE:',
            BOT_CODE
        );

        console.log(
            'DEEPSEEK:',
            DEEPSEEK_MODEL
        );

        console.log(
            'BITRIX:',
            BITRIX_WEBHOOK_URL &&
            BITRIX_BOT_TOKEN
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

        // ВАЖНО:
        // запускаем каждый loop ровно один раз.
        void bitrixLoop();
        void telegramLoop();
    }
);
```
