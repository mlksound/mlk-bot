```javascript
'use strict';

/*
============================================================
MLK BOT
Bitrix24 FETCH + DeepSeek + Telegram
Node.js 24+
============================================================

REQUIRED ENV:

BITRIX_WEBHOOK_URL
BITRIX_BOT_TOKEN
BOT_ID

DEEPSEEK_API_KEY

TELEGRAM_BOT_TOKEN

OPTIONAL:

BOT_CODE
DEEPSEEK_MODEL
PORT

============================================================
*/

const http = require('http');

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const BITRIX_WEBHOOK_URL =
    String(process.env.BITRIX_WEBHOOK_URL || '').trim();

const BITRIX_BOT_TOKEN =
    String(process.env.BITRIX_BOT_TOKEN || '').trim();

const BOT_ID =
    Number(process.env.BOT_ID || 1787);

const BOT_CODE =
    String(
        process.env.BOT_CODE || 'mlk_ai_consultant_v2'
    ).trim();

const DEEPSEEK_API_KEY =
    String(process.env.DEEPSEEK_API_KEY || '').trim();

const DEEPSEEK_MODEL =
    String(
        process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    ).trim();

/*
Telegram:
основная переменная — TELEGRAM_BOT_TOKEN.

Дополнительно поддерживаем TELEGRAM_TOKEN,
чтобы не ломать старую конфигурацию Render.
*/
const TELEGRAM_BOT_TOKEN =
    String(
        process.env.TELEGRAM_BOT_TOKEN ||
        process.env.TELEGRAM_TOKEN ||
        ''
    ).trim();

// ============================================================
// CHECK CONFIG
// ============================================================

function configured(value) {
    return Boolean(value && value.length > 0);
}

console.log('========================================');
console.log('MLK BITRIX FETCH + TELEGRAM + DEEPSEEK');
console.log('========================================');

console.log(
    'BITRIX_WEBHOOK_URL:',
    configured(BITRIX_WEBHOOK_URL) ? 'OK' : 'MISSING'
);

console.log(
    'BITRIX_BOT_TOKEN:',
    configured(BITRIX_BOT_TOKEN) ? 'OK' : 'MISSING'
);

console.log('BOT_ID:', BOT_ID);
console.log('BOT_CODE:', BOT_CODE);

console.log(
    'DEEPSEEK_API_KEY:',
    configured(DEEPSEEK_API_KEY) ? 'OK' : 'MISSING'
);

console.log('DEEPSEEK_MODEL:', DEEPSEEK_MODEL);

console.log(
    'TELEGRAM_BOT_TOKEN:',
    configured(TELEGRAM_BOT_TOKEN) ? 'OK' : 'MISSING'
);

console.log('PORT:', PORT);

console.log('========================================');

// ============================================================
// VALIDATION
// ============================================================

if (!configured(BITRIX_WEBHOOK_URL)) {
    console.error(
        '❌ BITRIX_WEBHOOK_URL отсутствует.'
    );
}

if (!configured(BITRIX_BOT_TOKEN)) {
    console.error(
        '❌ BITRIX_BOT_TOKEN отсутствует.'
    );
}

if (!BOT_ID) {
    console.error(
        '❌ BOT_ID отсутствует или некорректен.'
    );
}

if (!configured(DEEPSEEK_API_KEY)) {
    console.error(
        '❌ DEEPSEEK_API_KEY отсутствует.'
    );
}

if (!configured(TELEGRAM_BOT_TOKEN)) {
    console.error(
        '⚠️ TELEGRAM_BOT_TOKEN не найден.'
    );
    console.error(
        '⚠️ Telegram polling будет отключён.'
    );
}

// ============================================================
// BITRIX URL
// ============================================================

/*
BITRIX_WEBHOOK_URL является секретом.

Например, если Render содержит:

https://example.bitrix24.by/rest/1/SECRET

мы НЕ выводим его в лог.

Все API URL строятся внутри программы.
*/

function bitrixMethodUrl(method) {
    if (!BITRIX_WEBHOOK_URL) {
        throw new Error(
            'BITRIX_WEBHOOK_URL is not configured'
        );
    }

    return (
        BITRIX_WEBHOOK_URL.replace(/\/+$/, '') +
        '/' +
        method
    );
}

// ============================================================
// SAFE LOGGING
// ============================================================

function maskSecret(value) {
    if (!value) {
        return '[MISSING]';
    }

    if (value.length <= 8) {
        return '[HIDDEN]';
    }

    return (
        value.slice(0, 4) +
        '...' +
        value.slice(-4)
    );
}

// ============================================================
// HTTP JSON HELPER
// ============================================================

async function fetchJson(
    url,
    options = {},
    timeoutMs = 60000
) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(
            url,
            {
                ...options,
                signal: controller.signal
            }
        );

        const text = await response.text();

        let data;

        try {
            data = text
                ? JSON.parse(text)
                : {};
        } catch (error) {
            throw new Error(
                `Invalid JSON response. HTTP ${response.status}: ${text.slice(0, 1000)}`
            );
        }

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}: ${text.slice(0, 2000)}`
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

async function bitrixCall(
    method,
    params
) {
    const url = bitrixMethodUrl(method);

    const response = await fetchJson(
        url,
        {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },

            body: JSON.stringify(params)
        },
        60000
    );

    if (response && response.error) {
        throw new Error(
            `Bitrix API ${response.error}: ${
                response.error_description || ''
            }`
        );
    }

    return response;
}

// ============================================================
// BITRIX EVENT FETCH
// ============================================================

let bitrixOffset = 0;
let bitrixRunning = false;

async function fetchBitrixEvents() {

    if (bitrixRunning) {
        console.log(
            '⚠️ Bitrix FETCH уже выполняется — пропускаем запуск.'
        );

        return;
    }

    bitrixRunning = true;

    try {

        console.log('========================================');
        console.log('🔄 FETCH POLL');
        console.log('========================================');

        console.log(
            'TIME:',
            new Date().toISOString()
        );

        console.log(
            'BOT_ID:',
            BOT_ID
        );

        console.log(
            'OFFSET:',
            bitrixOffset
        );

        console.log('----------------------------------------');

        console.log(
            '➡️ BITRIX API: imbot.v2.Event.get'
        );

        const params = {
            botId: BOT_ID,
            botToken: BITRIX_BOT_TOKEN,
            offset: bitrixOffset,
            limit: 50
        };

        console.log(
            '📤 PARAMS:',
            JSON.stringify({
                botId: BOT_ID,
                botToken: '[HIDDEN]',
                offset: bitrixOffset,
                limit: 50
            })
        );

        const result = await bitrixCall(
            'imbot.v2.Event.get',
            params
        );

        const payload =
            result &&
            result.result
                ? result.result
                : {};

        const events =
            Array.isArray(payload.events)
                ? payload.events
                : [];

        const nextOffset =
            Number.isFinite(
                Number(payload.nextOffset)
            )
                ? Number(payload.nextOffset)
                : bitrixOffset;

        const hasMore =
            Boolean(payload.hasMore);

        console.log(
            '⬅️ BITRIX RESPONSE:',
            JSON.stringify(result)
        );

        console.log(
            '📦 EVENTS:',
            events.length
        );

        console.log(
            'NEXT OFFSET:',
            nextOffset
        );

        console.log(
            'HAS MORE:',
            hasMore
        );

        /*
        ВАЖНО:

        nextOffset передаём обратно Bitrix только
        после получения пачки.

        Это соответствует FETCH-механике imbot.v2.
        */

        if (events.length > 0) {

            for (const event of events) {

                console.log(
                    '🎉 ПОЛУЧЕНО СОБЫТИЕ'
                );

                await processBitrixEvent(
                    event
                );
            }
        } else {

            console.log(
                '📭 Новых событий нет.'
            );
        }

        bitrixOffset = nextOffset;

        console.log(
            '➡️ OFFSET UPDATED TO:',
            bitrixOffset
        );

    } catch (error) {

        console.error(
            '❌ BITRIX FETCH ERROR'
        );

        console.error(
            error.message
        );

        console.error(
            '----------------------------------------'
        );

    } finally {

        bitrixRunning = false;
    }
}

// ============================================================
// PROCESS BITRIX EVENT
// ============================================================

async function processBitrixEvent(event) {

    try {

        console.log('========================================');
        console.log('📦 PROCESS EVENT');
        console.log('========================================');

        console.log(
            'EVENT ID:',
            event?.eventId
        );

        console.log(
            'EVENT TYPE:',
            event?.type
        );

        console.log(
            'EVENT DATE:',
            event?.date
        );

        /*
        Нам нужны сообщения пользователя.
        */

        if (
            event?.type !==
            'ONIMBOTV2MESSAGEADD'
        ) {

            console.log(
                'ℹ️ Событие не является сообщением пользователя.'
            );

            return;
        }

        const data =
            event?.data || {};

        const message =
            data.message || {};

        const chat =
            data.chat || {};

        const user =
            data.user || {};

        const text =
            String(
                message.text || ''
            ).trim();

        const messageId =
            message.id;

        const chatId =
            message.chatId ||
            message.chat_id;

        const dialogId =
            String(
                chat.dialogId ||
                ''
            );

        console.log('----------------------------------------');
        console.log('💬 MESSAGE');
        console.log('----------------------------------------');

        console.log(
            'ID:',
            messageId
        );

        console.log(
            'CHAT ID:',
            chatId
        );

        console.log(
            'DIALOG ID:',
            dialogId
        );

        console.log(
            'TEXT:',
            text
        );

        console.log('----------------------------------------');
        console.log('👤 USER');
        console.log('----------------------------------------');

        console.log(
            'ID:',
            user.id
        );

        console.log(
            'NAME:',
            user.name
        );

        console.log('----------------------------------------');
        console.log('🤖 BOT');
        console.log('----------------------------------------');

        console.log(
            'ID:',
            data.bot?.id
        );

        console.log(
            'CODE:',
            data.bot?.code
        );

        if (!text) {

            console.log(
                '⚠️ Пустое сообщение — пропускаем.'
            );

            return;
        }

        if (!dialogId) {

            console.error(
                '❌ Не найден dialogId.'
            );

            return;
        }

        /*
        Защита от ответа самому себе.

        В событии authorId — пользователь.
        Бот обычно имеет свой ID.
        */

        if (
            Number(message.authorId) === BOT_ID
        ) {

            console.log(
                '🤖 Сообщение принадлежит боту — пропускаем.'
            );

            return;
        }

        // ====================================================
        // DEEPSEEK
        // ====================================================

        console.log(
            '➡️ ШАГ 1: отправляем сообщение в DeepSeek'
        );

        let answer;

        try {

            answer =
                await askDeepSeek(
                    text,
                    user.id
                );

        } catch (error) {

            console.error(
                '❌ DEEPSEEK ERROR'
            );

            console.error(
                error.message
            );

            answer =
                'Не удалось получить ответ от AI. Попробуйте ещё раз через несколько секунд.';
        }

        console.log(
            '🧠 DEEPSEEK ANSWER'
        );

        console.log(
            answer
        );

        // ====================================================
        // SEND BITRIX
        // ====================================================

        console.log(
            '➡️ ШАГ 2: отправляем ответ DeepSeek в Bitrix'
        );

        await sendBitrixMessage(
            dialogId,
            answer,
            messageId
        );

        console.log(
            '🎉 BITRIX RESPONSE SENT'
        );

    } catch (error) {

        console.error(
            '❌ PROCESS EVENT ERROR'
        );

        console.error(
            error
        );
    }
}

// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(
    userMessage,
    userId
) {

    if (!DEEPSEEK_API_KEY) {
        throw new Error(
            'DEEPSEEK_API_KEY is not configured'
        );
    }

    console.log('========================================');
    console.log('🧠 DEEPSEEK REQUEST');
    console.log('========================================');

    console.log(
        'MODEL:',
        DEEPSEEK_MODEL
    );

    console.log(
        'USER MESSAGE:',
        userMessage
    );

    const body = {

        model: DEEPSEEK_MODEL,

        messages: [

            {
                role: 'system',

                content:
                    'Ты ИИ-консультант компании MLK. ' +
                    'Отвечай на русском языке, кратко, понятно и по существу. ' +
                    'Не придумывай факты о компании. ' +
                    'Если информации недостаточно, прямо скажи об этом.'
            },

            {
                role: 'user',

                content: userMessage
            }
        ],

        /*
        Для теста отключаем reasoning,
        чтобы ответы были быстрее.
        */

        thinking: {
            type: 'disabled'
        },

        stream: false,

        max_tokens: 500
    };

    console.log(
        '📤 DEEPSEEK BODY:',
        JSON.stringify(
            {
                ...body,

                /*
                API key никогда не логируем.
                */
            },
            null,
            2
        )
    );

    const response =
        await fetchJson(
            'https://api.deepseek.com/chat/completions',
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json',

                    'Accept':
                        'application/json',

                    'Authorization':
                        `Bearer ${DEEPSEEK_API_KEY}`
                },

                body: JSON.stringify(body)
            },
            120000
        );

    console.log(
        '⬅️ DEEPSEEK HTTP: 200'
    );

    console.log(
        '⬅️ DEEPSEEK RESPONSE:',
        JSON.stringify(response)
    );

    const content =
        response
            ?.choices?.[0]
            ?.message
            ?.content;

    if (
        typeof content !== 'string' ||
        !content.trim()
    ) {

        throw new Error(
            'DeepSeek returned empty response'
        );
    }

    return content.trim();
}

// ============================================================
// BITRIX SEND MESSAGE
// ============================================================

async function sendBitrixMessage(
    dialogId,
    message,
    replyId
) {

    console.log('========================================');
    console.log('📤 ОТПРАВЛЯЕМ ОТВЕТ В BITRIX');
    console.log('========================================');

    console.log(
        'BOT_ID:',
        BOT_ID
    );

    console.log(
        'DIALOG_ID:',
        dialogId
    );

    console.log(
        'MESSAGE:',
        message
    );

    const fields = {

        message: String(message),

        urlPreview: false
    };

    /*
    replyId полезен: Bitrix может показать ответ
    как reply на исходное сообщение.
    */

    if (
        Number.isFinite(
            Number(replyId)
        )
    ) {

        fields.replyId =
            Number(replyId);
    }

    const params = {

        botId: BOT_ID,

        botToken: BITRIX_BOT_TOKEN,

        dialogId: String(dialogId),

        fields
    };

    console.log(
        '----------------------------------------'
    );

    console.log(
        '➡️ BITRIX API: imbot.v2.Chat.Message.send'
    );

    console.log(
        '📤 PARAMS:',
        JSON.stringify({
            botId: BOT_ID,
            botToken: '[HIDDEN]',
            dialogId: String(dialogId),
            fields
        })
    );

    const response =
        await bitrixCall(
            'imbot.v2.Chat.Message.send',
            params
        );

    console.log(
        '⬅️ BITRIX SEND RESPONSE:',
        JSON.stringify(response)
    );

    if (
        response?.result?.id
    ) {

        console.log(
            '🎉🎉🎉 ОТВЕТ УСПЕШНО ОТПРАВЛЕН 🎉🎉🎉'
        );

        console.log(
            'MESSAGE ID:',
            response.result.id
        );
    }

    return response;
}

// ============================================================
// TELEGRAM API
// ============================================================

async function telegramCall(
    method,
    params = {}
) {

    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is not configured'
        );
    }

    const url =
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

    return await fetchJson(
        url,
        {
            method: 'POST',

            headers: {
                'Content-Type':
                    'application/json',

                'Accept':
                    'application/json'
            },

            body: JSON.stringify(params)
        },
        60000
    );
}

// ============================================================
// TELEGRAM SEND
// ============================================================

async function sendTelegramMessage(
    chatId,
    text
) {

    console.log(
        '📤 TELEGRAM SEND'
    );

    console.log(
        'CHAT ID:',
        chatId
    );

    console.log(
        'MESSAGE:',
        text
    );

    const response =
        await telegramCall(
            'sendMessage',
            {
                chat_id: chatId,

                text: String(text),

                disable_web_page_preview: true
            }
        );

    if (
        !response.ok
    ) {

        throw new Error(
            `Telegram sendMessage failed: ${
                JSON.stringify(response)
            }`
        );
    }

    console.log(
        '🎉 TELEGRAM MESSAGE SENT'
    );

    return response;
}

// ============================================================
// TELEGRAM POLLING
// ============================================================

let telegramOffset = 0;
let telegramRunning = false;

async function startTelegramPolling() {

    if (!TELEGRAM_BOT_TOKEN) {

        console.log(
            '⚠️ Telegram polling отключён: TELEGRAM_BOT_TOKEN отсутствует.'
        );

        return;
    }

    if (telegramRunning) {

        console.log(
            '⚠️ Telegram polling уже запущен.'
        );

        return;
    }

    telegramRunning = true;

    console.log('========================================');
    console.log('🚀 TELEGRAM POLLING STARTED');
    console.log('========================================');

    try {

        /*
        Если у Telegram был старый webhook,
        getUpdates может не работать.

        Удаляем webhook, но НЕ удаляем pending updates.
        */

        try {

            console.log(
                '➡️ TELEGRAM: deleteWebhook'
            );

            const webhookResult =
                await telegramCall(
                    'deleteWebhook',
                    {
                        drop_pending_updates: false
                    }
                );

            console.log(
                '⬅️ TELEGRAM deleteWebhook:',
                JSON.stringify(webhookResult)
            );

        } catch (error) {

            console.error(
                '⚠️ Не удалось удалить Telegram webhook:',
                error.message
            );
        }

        /*
        Получаем информацию о боте.
        */

        try {

            const me =
                await telegramCall(
                    'getMe'
                );

            console.log(
                '🤖 TELEGRAM BOT:',
                JSON.stringify(
                    me.result || {}
                )
            );

        } catch (error) {

            console.error(
                '❌ TELEGRAM getMe ERROR:',
                error.message
            );
        }

        /*
        Бесконечный long-polling.
        */

        while (telegramRunning) {

            try {

                const response =
                    await telegramCall(
                        'getUpdates',
                        {
                            offset:
                                telegramOffset,

                            timeout: 25,

                            allowed_updates: [
                                'message'
                            ]
                        }
                    );

                if (
                    !response.ok
                ) {

                    throw new Error(
                        JSON.stringify(response)
                    );
                }

                const updates =
                    Array.isArray(
                        response.result
                    )
                        ? response.result
                        : [];

                if (
                    updates.length > 0
                ) {

                    console.log(
                        '========================================'
                    );

                    console.log(
                        '📦 TELEGRAM UPDATES:',
                        updates.length
                    );

                    for (
                        const update
                        of updates
                    ) {

                        /*
                        Offset подтверждаем сразу
                        после получения update.
                        */

                        telegramOffset =
                            update.update_id + 1;

                        await processTelegramUpdate(
                            update
                        );
                    }
                }

            } catch (error) {

                console.error(
                    '❌ TELEGRAM POLLING ERROR'
                );

                console.error(
                    error.message
                );

                /*
                Не создаём бешеный цикл при ошибке.
                */

                await sleep(3000);
            }
        }

    } finally {

        telegramRunning = false;
    }
}

// ============================================================
// PROCESS TELEGRAM UPDATE
// ============================================================

async function processTelegramUpdate(
    update
) {

    const message =
        update?.message;

    if (!message) {

        console.log(
            'ℹ️ Telegram update без message — пропускаем.'
        );

        return;
    }

    const chatId =
        message?.chat?.id;

    const text =
        String(
            message?.text || ''
        ).trim();

    const from =
        message?.from || {};

    console.log('========================================');
    console.log('📨 TELEGRAM MESSAGE');
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
        'USER ID:',
        from.id
    );

    console.log(
        'USER:',
        from.username ||
        from.first_name ||
        ''
    );

    console.log(
        'TEXT:',
        text
    );

    if (!chatId) {

        console.error(
            '❌ Telegram chat_id отсутствует.'
        );

        return;
    }

    if (!text) {

        console.log(
            'ℹ️ Telegram сообщение без текста — пропускаем.'
        );

        return;
    }

    let answer;

    try {

        console.log(
            '➡️ TELEGRAM → DEEPSEEK'
        );

        answer =
            await askDeepSeek(
                text,
                from.id
            );

    } catch (error) {

        console.error(
            '❌ TELEGRAM DEEPSEEK ERROR:',
            error.message
        );

        answer =
            'Не удалось получить ответ от AI. Попробуйте ещё раз.';
    }

    try {

        console.log(
            '➡️ DEEPSEEK → TELEGRAM'
        );

        await sendTelegramMessage(
            chatId,
            answer
        );

    } catch (error) {

        console.error(
            '❌ TELEGRAM SEND ERROR:',
            error.message
        );
    }
}

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

// ============================================================
// HTTP SERVER
// ============================================================

const server =
    http.createServer(
        async (req, res) => {

            /*
            Render требует HTTP server.
            */

            if (
                req.method === 'GET' &&
                req.url === '/'
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

                            service:
                                'mlk-bitrix-deepseek-telegram',

                            bitrix:
                                Boolean(
                                    BITRIX_WEBHOOK_URL &&
                                    BITRIX_BOT_TOKEN
                                ),

                            telegram:
                                Boolean(
                                    TELEGRAM_BOT_TOKEN
                                ),

                            deepseek:
                                Boolean(
                                    DEEPSEEK_API_KEY
                                ),

                            botId:
                                BOT_ID,

                            model:
                                DEEPSEEK_MODEL
                        }
                    )
                );

                return;
            }

            /*
            Health endpoint.
            */

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
                            ok: true
                        }
                    )
                );

                return;
            }

            res.writeHead(
                404,
                {
                    'Content-Type':
                        'application/json; charset=utf-8'
                }
            );

            res.end(
                JSON.stringify(
                    {
                        error:
                            'Not found'
                    }
                )
            );
        }
    );

// ============================================================
// START SERVER
// ============================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log('========================================');
        console.log('🚀 SERVER STARTED');
        console.log('========================================');

        console.log(
            'PORT:',
            PORT
        );

        console.log(
            'MODE: FETCH'
        );

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
            configured(BITRIX_WEBHOOK_URL) &&
            configured(BITRIX_BOT_TOKEN)
                ? 'ENABLED'
                : 'DISABLED'
        );

        console.log(
            'TELEGRAM:',
            configured(TELEGRAM_BOT_TOKEN)
                ? 'ENABLED'
                : 'DISABLED'
        );

        console.log(
            '========================================'
        );

        startLoops();
    }
);

// ============================================================
// START LOOPS
// ============================================================

let loopsStarted = false;

function startLoops() {

    if (loopsStarted) {

        console.log(
            '⚠️ Loops уже запущены.'
        );

        return;
    }

    loopsStarted = true;

    console.log('========================================');
    console.log('🚀 LOOPS STARTED');
    console.log('========================================');

    /*
    BITRIX LOOP
    */

    if (
        configured(BITRIX_WEBHOOK_URL) &&
        configured(BITRIX_BOT_TOKEN)
    ) {

        console.log(
            '✅ Bitrix FETCH включён.'
        );

        /*
        Первый запрос сразу.
        */

        fetchBitrixEvents();

        /*
        Только ОДИН interval.
        */

        setInterval(
            () => {
                fetchBitrixEvents();
            },
            3000
        );

    } else {

        console.error(
            '❌ Bitrix FETCH отключён: отсутствуют настройки.'
        );
    }

    /*
    TELEGRAM LOOP
    */

    if (
        configured(TELEGRAM_BOT_TOKEN)
    ) {

        startTelegramPolling();

    } else {

        console.log(
            '⚠️ Telegram polling отключён.'
        );
    }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {

    console.log('========================================');
    console.log(
        `🛑 ${signal}`
    );
    console.log('========================================');

    telegramRunning = false;

    server.close(
        () => {

            console.log(
                '✅ Server closed'
            );

            process.exit(0);
        }
    );

    /*
    Если server.close почему-то не завершится,
    не зависаем бесконечно.
    */

    setTimeout(
        () => {
            process.exit(0);
        },
        5000
    ).unref();
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
// GLOBAL ERROR HANDLERS
// ============================================================

process.on(
    'unhandledRejection',
    error => {

        console.error(
            '❌ UNHANDLED REJECTION'
        );

        console.error(
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {

        console.error(
            '❌ UNCAUGHT EXCEPTION'
        );

        console.error(
            error
        );
    }
);
```
