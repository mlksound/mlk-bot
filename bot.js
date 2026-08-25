'use strict';

/*
===========================================================
 MLK BOT
 Telegram + DeepSeek + Bitrix24
 FETCH + Connector + Open Line
 AI <-> MANAGER
===========================================================

 ВАЖНО:

 Telegram:
   BOT_TOKEN

 Старый рабочий Bitrix-контур:
   BITRIX_WEBHOOK_URL
   BITRIX_BOT_TOKEN
   BITRIX_BOT_ID

 Новый Connector:
   OAuth получается автоматически через:
   /bitrix-webhook

 Настройки локального приложения Bitrix:

   Путь обработчика:
   https://mlk-bot.onrender.com/bitrix/handler

   Путь первоначальной установки:
   https://mlk-bot.onrender.com/bitrix-webhook
===========================================================
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// 1. ENV
// ============================================================

const PORT = Number(process.env.PORT || 10000);

// ------------------------------------------------------------
// TELEGRAM
// ------------------------------------------------------------

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

// ------------------------------------------------------------
// DEEPSEEK
// ------------------------------------------------------------

const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();

// Используем именно эту модель.
// DEEPSEEK_MODEL из Render НЕ нужен.
const DEEPSEEK_MODEL = 'deepseek-chat';

// ------------------------------------------------------------
// BITRIX — СТАРЫЙ РАБОЧИЙ FETCH-КОНТУР
// ------------------------------------------------------------

const BITRIX_WEBHOOK_URL =
    (process.env.BITRIX_WEBHOOK_URL || '').trim();

const BITRIX_BOT_TOKEN =
    (process.env.BITRIX_BOT_TOKEN || '').trim();

const BITRIX_BOT_ID =
    Number(process.env.BITRIX_BOT_ID || 1787);

// ------------------------------------------------------------
// BITRIX CONNECTOR
// ------------------------------------------------------------

const BITRIX_CONNECTOR_ENABLED =
    String(process.env.BITRIX_CONNECTOR_ENABLED || 'false')
        .toLowerCase() === 'true';

const BITRIX_CONNECTOR_ID =
    (process.env.BITRIX_CONNECTOR_ID || 'mlk_telegram')
        .trim()
        .toLowerCase();

const BITRIX_CONNECTOR_NAME =
    (process.env.BITRIX_CONNECTOR_NAME || 'MLK Telegram')
        .trim();

const BITRIX_DOMAIN =
    (process.env.BITRIX_DOMAIN || 'b24-2fqomj.bitrix24.by')
        .trim();

const BITRIX_CLIENT_ID =
    (process.env.BITRIX_CLIENT_ID || '').trim();

const BITRIX_CLIENT_SECRET =
    (process.env.BITRIX_CLIENT_SECRET || '').trim();

const PUBLIC_BASE_URL =
    (process.env.PUBLIC_BASE_URL || 'https://mlk-bot.onrender.com')
        .trim()
        .replace(/\/+$/, '');

// ------------------------------------------------------------
// OPEN LINE
// ------------------------------------------------------------

// Если не указать — линия определяется автоматически.
const BITRIX_OPENLINE_ID =
    Number(process.env.BITRIX_OPENLINE_ID || 0);

// ------------------------------------------------------------
// URL
// ------------------------------------------------------------

const BITRIX_HANDLER_URL =
    PUBLIC_BASE_URL + '/bitrix/handler';

const BITRIX_INSTALL_URL =
    PUBLIC_BASE_URL + '/bitrix-webhook';

// ------------------------------------------------------------
// STORAGE
// ------------------------------------------------------------

// Render Free не гарантирует постоянный диск.
// Если /data существует — используем его.
// Иначе /tmp.
//
// ВАЖНО:
// OAuth после рестарта Free-инстанса может исчезнуть.
// В таком случае приложение нужно переустановить,
// чтобы Bitrix снова прислал auth.
const DATA_DIR =
    fs.existsSync('/data') ? '/data' : '/tmp';

const AUTH_FILE =
    path.join(DATA_DIR, 'bitrix-auth.json');

const OFFSET_FILE =
    path.join(DATA_DIR, 'bitrix-offset.json');

const BITRIX_POLL_INTERVAL_MS = 3000;

// ============================================================
// 2. LOGGING
// ============================================================

function log(...args) {
    console.log(...args);
}

function warn(...args) {
    console.warn(...args);
}

function error(...args) {
    console.error(...args);
}

function secretStatus(value) {
    return value ? 'OK' : 'MISSING';
}

// ============================================================
// 3. HTTP HELPERS
// ============================================================

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();

            if (body.length > 10 * 1024 * 1024) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);

    const text = await response.text();

    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        throw new Error(
            `Invalid JSON response: ${text.slice(0, 500)}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`
        );
    }

    return data;
}

// ============================================================
// 4. AUTH STORAGE
// ============================================================

function ensureDataDir() {
    try {
        fs.mkdirSync(DATA_DIR, {
            recursive: true
        });
    } catch (e) {}
}

function loadAuth() {
    ensureDataDir();

    try {
        if (!fs.existsSync(AUTH_FILE)) {
            return null;
        }

        const raw =
            fs.readFileSync(AUTH_FILE, 'utf8');

        const data =
            JSON.parse(raw);

        if (
            data &&
            data.access_token &&
            data.refresh_token
        ) {
            return data;
        }

        return null;

    } catch (e) {
        error(
            'OAuth auth load error:',
            e.message
        );

        return null;
    }
}

function saveAuth(auth) {
    ensureDataDir();

    fs.writeFileSync(
        AUTH_FILE,
        JSON.stringify(auth, null, 2),
        {
            encoding: 'utf8',
            mode: 0o600
        }
    );
}

let bitrixAuth = loadAuth();

// ============================================================
// 5. BITRIX WEBHOOK — СТАРЫЙ КОНТУР
// НЕ МЕНЯЕМ ЕГО ЛОГИКУ
// ============================================================

async function bitrixWebhookCall(
    method,
    params = {}
) {
    if (!BITRIX_WEBHOOK_URL) {
        throw new Error(
            'BITRIX_WEBHOOK_URL missing'
        );
    }

    const url =
        BITRIX_WEBHOOK_URL.replace(/\/+$/, '') +
        '/' +
        method;

    return fetchJson(url, {
        method: 'POST',

        headers: {
            'Content-Type': 'application/json'
        },

        body: JSON.stringify(params)
    });
}

// ============================================================
// 6. BITRIX OAUTH
// ============================================================

async function refreshBitrixOAuth() {

    if (
        !BITRIX_CLIENT_ID ||
        !BITRIX_CLIENT_SECRET ||
        !bitrixAuth ||
        !bitrixAuth.refresh_token
    ) {
        throw new Error(
            'OAuth refresh unavailable'
        );
    }

    const params =
        new URLSearchParams();

    params.set(
        'grant_type',
        'refresh_token'
    );

    params.set(
        'client_id',
        BITRIX_CLIENT_ID
    );

    params.set(
        'client_secret',
        BITRIX_CLIENT_SECRET
    );

    params.set(
        'refresh_token',
        bitrixAuth.refresh_token
    );

    const data =
        await fetchJson(
            'https://oauth.bitrix.info/oauth/token/',
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded'
                },

                body: params.toString()
            }
        );

    if (
        !data ||
        !data.access_token ||
        !data.refresh_token
    ) {
        throw new Error(
            'OAuth refresh returned invalid data'
        );
    }

    bitrixAuth = {
        ...bitrixAuth,
        ...data
    };

    saveAuth(bitrixAuth);

    log('✅ Bitrix OAuth refreshed');

    return bitrixAuth;
}

async function bitrixOAuthCall(
    method,
    params = {},
    retry = true
) {

    if (
        !bitrixAuth ||
        !bitrixAuth.access_token
    ) {
        throw new Error(
            'OAuth not installed'
        );
    }

    const domain =
        bitrixAuth.domain ||
        BITRIX_DOMAIN;

    const endpoint =
        `https://${domain}/rest/${method}`;

    const body = {
        ...params,
        auth: bitrixAuth.access_token
    };

    try {

        const data =
            await fetchJson(
                endpoint,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify(body)
                }
            );

        // Некоторые ошибки приходят HTTP 200.
        if (
            data &&
            (
                data.error === 'expired_token' ||
                data.error === 'NO_AUTH_FOUND'
            ) &&
            retry
        ) {

            await refreshBitrixOAuth();

            return bitrixOAuthCall(
                method,
                params,
                false
            );
        }

        if (data && data.error) {

            throw new Error(
                `Bitrix ${data.error}: ` +
                `${data.error_description || ''}`
            );
        }

        return data;

    } catch (e) {

        // Если fetchJson выбросил ошибку с текстом
        // expired_token / NO_AUTH_FOUND — пробуем refresh.
        if (
            retry &&
            (
                e.message.includes('expired_token') ||
                e.message.includes('NO_AUTH_FOUND')
            )
        ) {

            await refreshBitrixOAuth();

            return bitrixOAuthCall(
                method,
                params,
                false
            );
        }

        throw e;
    }
}

// ============================================================
// 7. TELEGRAM
// ============================================================

const TELEGRAM_API =
    BOT_TOKEN
        ? `https://api.telegram.org/bot${BOT_TOKEN}`
        : '';

async function telegramCall(
    method,
    params = {}
) {

    if (!BOT_TOKEN) {
        throw new Error(
            'BOT_TOKEN missing'
        );
    }

    return fetchJson(
        `${TELEGRAM_API}/${method}`,
        {
            method: 'POST',

            headers: {
                'Content-Type':
                    'application/json'
            },

            body: JSON.stringify(params)
        }
    );
}

async function sendTelegramMessage(
    chatId,
    text,
    extra = {}
) {

    if (!text) return null;

    const chunks = [];

    for (
        let i = 0;
        i < text.length;
        i += 4000
    ) {
        chunks.push(
            text.slice(i, i + 4000)
        );
    }

    let last = null;

    for (const chunk of chunks) {

        last =
            await telegramCall(
                'sendMessage',
                {
                    chat_id: chatId,
                    text: chunk,
                    ...extra
                }
            );
    }

    return last;
}

async function answerTelegramCallback(
    callbackQueryId,
    text = ''
) {

    try {

        await telegramCall(
            'answerCallbackQuery',
            {
                callback_query_id:
                    callbackQueryId,

                text
            }
        );

    } catch (e) {

        warn(
            'Telegram callback answer error:',
            e.message
        );
    }
}

// ============================================================
// 8. DEEPSEEK
// ============================================================

async function askDeepSeek(userText) {

    if (!DEEPSEEK_API_KEY) {
        throw new Error(
            'DEEPSEEK_API_KEY missing'
        );
    }

    const data =
        await fetchJson(
            'https://api.deepseek.com/chat/completions',
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json',

                    'Authorization':
                        `Bearer ${DEEPSEEK_API_KEY}`
                },

                body: JSON.stringify({

                    model:
                        DEEPSEEK_MODEL,

                    messages: [

                        {
                            role: 'system',

                            content:
                                'Ты ИИ-консультант компании MLK. Отвечай кратко, понятно и по существу.'
                        },

                        {
                            role: 'user',

                            content:
                                userText
                        }
                    ],

                    stream: false,

                    max_tokens: 500
                })
            }
        );

    const answer =
        data?.choices?.[0]?.message?.content;

    if (!answer) {
        throw new Error(
            'Empty answer from DeepSeek'
        );
    }

    return answer.trim();
}

// ============================================================
// 9. CLIENT STATE
// ============================================================

const clients = new Map();

/*
telegramId -> {
    mode: AI | MANAGER,
    name,
    username,
    lastSeen
}
*/

const adminMessageMap =
    new Map();

/*
admin Telegram message_id
    ->
telegram client id
*/

const bitrixChatMap =
    new Map();

/*
Bitrix chat_id
    ->
Telegram client id
*/

function getClient(clientId) {

    const key =
        String(clientId);

    if (!clients.has(key)) {

        clients.set(
            key,
            {
                mode: 'AI',
                name: '',
                username: '',
                lastSeen: Date.now()
            }
        );
    }

    const client =
        clients.get(key);

    client.lastSeen =
        Date.now();

    return client;
}

function setClientMode(
    clientId,
    mode
) {

    const client =
        getClient(clientId);

    client.mode =
        mode === 'MANAGER'
            ? 'MANAGER'
            : 'AI';

    return client;
}

// ============================================================
// 10. CONNECTOR
// ============================================================

let bitrixOpenLineId =
    BITRIX_OPENLINE_ID || null;

let connectorReady = false;

let connectorSetupRunning = false;

// ------------------------------------------------------------
// ICON
// ------------------------------------------------------------

const CONNECTOR_ICON =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" ' +
        'viewBox="0 0 100 100">' +
        '<rect width="100" height="100" rx="20" fill="#229ED9"/>' +
        '<text x="50" y="63" text-anchor="middle" ' +
        'font-size="50" fill="white">T</text>' +
        '</svg>'
    );

// ------------------------------------------------------------
// FIND OPEN LINE
// ------------------------------------------------------------

async function findOpenLine() {

    if (BITRIX_OPENLINE_ID) {

        bitrixOpenLineId =
            BITRIX_OPENLINE_ID;

        log(
            '✅ Open Line from ENV:',
            bitrixOpenLineId
        );

        return {
            ID: bitrixOpenLineId
        };
    }

    const result =
        await bitrixOAuthCall(
            'imopenlines.config.list.get',
            {
                PARAMS: {
                    select: [
                        'ID',
                        'LINE_NAME',
                        'ACTIVE'
                    ],

                    filter: {
                        ACTIVE: 'Y'
                    },

                    limit: 50
                }
            }
        );

    const lines =
        result?.result || [];

    if (
        !Array.isArray(lines) ||
        lines.length === 0
    ) {
        throw new Error(
            'No active Bitrix Open Lines found'
        );
    }

    // Сначала пытаемся найти линию Telegram.
    let line =
        lines.find(
            item =>
                String(
                    item.LINE_NAME || ''
                )
                .toLowerCase()
                .includes('telegram')
        );

    // Если Telegram-линии нет —
    // берём первую активную.
    if (!line) {
        line = lines[0];
    }

    bitrixOpenLineId =
        Number(line.ID);

    log(
        '✅ Open Line:',
        bitrixOpenLineId,
        line.LINE_NAME || ''
    );

    return line;
}

// ------------------------------------------------------------
// REGISTER CONNECTOR
// ------------------------------------------------------------

async function registerConnector() {

    if (!BITRIX_CONNECTOR_ENABLED) {
        return;
    }

    if (
        !bitrixAuth ||
        !bitrixAuth.access_token
    ) {
        throw new Error(
            'OAuth is not installed'
        );
    }

    log(
        '🔌 Registering Bitrix Connector:',
        BITRIX_CONNECTOR_ID
    );

    const result =
        await bitrixOAuthCall(
            'imconnector.register',
            {
                ID:
                    BITRIX_CONNECTOR_ID,

                NAME:
                    BITRIX_CONNECTOR_NAME,

                ICON: {
                    DATA_IMAGE:
                        CONNECTOR_ICON,

                    COLOR:
                        '#229ED9',

                    SIZE:
                        '90%',

                    POSITION:
                        'center'
                },

                PLACEMENT_HANDLER:
                    BITRIX_HANDLER_URL,

                ICON_DISABLED: {
                    DATA_IMAGE:
                        CONNECTOR_ICON,

                    COLOR:
                        '#9AAEB7',

                    SIZE:
                        '90%',

                    POSITION:
                        'center'
                },

                DEL_EXTERNAL_MESSAGES:
                    true,

                EDIT_INTERNAL_MESSAGES:
                    true,

                DEL_INTERNAL_MESSAGES:
                    true,

                NEWSLETTER:
                    false,

                NEED_SYSTEM_MESSAGES:
                    true,

                NEED_SIGNATURE:
                    false,

                CHAT_GROUP:
                    false
            }
        );

    log(
        '✅ Connector register result:',
        JSON.stringify(result)
    );

    return result;
}

// ------------------------------------------------------------
// BIND MANAGER MESSAGE EVENT
// ------------------------------------------------------------

async function bindConnectorEvent() {

    if (!bitrixAuth?.access_token) {
        throw new Error(
            'OAuth is not installed'
        );
    }

    log(
        '🔔 Binding ONIMCONNECTORMESSAGEADD...'
    );

    const result =
        await bitrixOAuthCall(
            'event.bind',
            {
                event:
                    'ONIMCONNECTORMESSAGEADD',

                handler:
                    BITRIX_HANDLER_URL
            }
        );

    log(
        '✅ Event bind result:',
        JSON.stringify(result)
    );

    return result;
}

// ------------------------------------------------------------
// ACTIVATE CONNECTOR
// ------------------------------------------------------------

async function activateConnector(
    lineId
) {

    const line =
        Number(lineId);

    if (!line) {
        throw new Error(
            'Open Line ID is empty'
        );
    }

    log(
        '🔌 Activating Connector on Open Line:',
        line
    );

    const activateResult =
        await bitrixOAuthCall(
            'imconnector.activate',
            {
                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    line,

                ACTIVE:
                    1
            }
        );

    log(
        '✅ Connector activate:',
        JSON.stringify(activateResult)
    );

    const dataResult =
        await bitrixOAuthCall(
            'imconnector.connector.data.set',
            {
                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    line,

                DATA: {

                    ID:
                        `${BITRIX_CONNECTOR_ID}_line_${line}`,

                    URL:
                        'https://t.me/',

                    URL_IM:
                        'https://t.me/',

                    NAME:
                        BITRIX_CONNECTOR_NAME
                }
            }
        );

    log(
        '✅ Connector data:',
        JSON.stringify(dataResult)
    );

    return true;
}

// ------------------------------------------------------------
// CONNECTOR STATUS
// ------------------------------------------------------------

async function connectorStatus(
    lineId
) {

    try {

        const result =
            await bitrixOAuthCall(
                'imconnector.status',
                {
                    CONNECTOR:
                        BITRIX_CONNECTOR_ID,

                    LINE:
                        Number(lineId)
                }
            );

        log(
            '📡 Connector status:',
            JSON.stringify(result)
        );

        return result;

    } catch (e) {

        error(
            'Connector status error:',
            e.message
        );

        return null;
    }
}

// ------------------------------------------------------------
// COMPLETE CONNECTOR SETUP
// ------------------------------------------------------------

async function setupConnector() {

    if (!BITRIX_CONNECTOR_ENABLED) {
        return;
    }

    if (connectorSetupRunning) {
        return;
    }

    if (connectorReady) {
        return;
    }

    if (
        !bitrixAuth ||
        !bitrixAuth.access_token
    ) {

        warn(
            '⚠️ Connector waiting for Bitrix installation OAuth'
        );

        return;
    }

    connectorSetupRunning = true;

    try {

        log(
            '========================================'
        );

        log(
            '🔌 BITRIX CONNECTOR SETUP'
        );

        log(
            '========================================'
        );

        // 1. Register.
        await registerConnector();

        // 2. Event.
        await bindConnectorEvent();

        // 3. Open Line.
        await findOpenLine();

        // 4. Activate.
        await activateConnector(
            bitrixOpenLineId
        );

        // 5. Check.
        await connectorStatus(
            bitrixOpenLineId
        );

        connectorReady = true;

        log(
            '========================================'
        );

        log(
            '✅ BITRIX CONNECTOR READY'
        );

        log(
            'Connector:',
            BITRIX_CONNECTOR_ID
        );

        log(
            'Open Line:',
            bitrixOpenLineId
        );

        log(
            '========================================'
        );

    } catch (e) {

        connectorReady = false;

        error(
            '❌ Connector setup error:',
            e.message
        );

    } finally {

        connectorSetupRunning = false;
    }
}

// ============================================================
// 11. SEND TELEGRAM -> BITRIX OPEN LINE
// ============================================================

async function sendToBitrixConnector(
    clientId,
    text,
    senderType = 'client',
    telegramUser = null
) {

    if (!BITRIX_CONNECTOR_ENABLED) {
        return null;
    }

    if (
        !bitrixAuth ||
        !bitrixAuth.access_token
    ) {

        warn(
            '⚠️ Connector OAuth unavailable'
        );

        return null;
    }

    if (!bitrixOpenLineId) {
        await findOpenLine();
    }

    const user = {

        id:
            String(clientId),

        name:
            telegramUser?.first_name ||
            'Клиент',

        last_name:
            telegramUser?.last_name ||
            '',

        url:
            telegramUser?.username
                ? `https://t.me/${telegramUser.username}`
                : '',

        skip_phone_validate:
            'Y'
    };

    /*
    ВАЖНО:
    Для AI ответов мы НЕ создаём нового пользователя.
    И AI, и клиент идут в одном Telegram-диалоге.
    */

    const messageId =
        `tg_${Date.now()}_` +
        crypto
            .randomBytes(4)
            .toString('hex');

    const result =
        await bitrixOAuthCall(
            'imconnector.send.messages',
            {

                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    Number(bitrixOpenLineId),

                MESSAGES: [

                    {

                        user,

                        message: {

                            id:
                                messageId,

                            date:
                                Math.floor(
                                    Date.now() / 1000
                                ),

                            text:
                                String(text)
                        },

                        chat: {

                            id:
                                String(clientId),

                            url:
                                telegramUser?.username
                                    ? `https://t.me/${telegramUser.username}`
                                    : 'https://t.me/',

                        }

                    }

                ]
            }
        );

    try {

        const item =
            result
                ?.result
                ?.DATA
                ?.RESULT
                ?.[0];

        if (
            item?.session?.CHAT_ID
        ) {

            bitrixChatMap.set(
                String(
                    item.session.CHAT_ID
                ),

                String(clientId)
            );
        }

    } catch (e) {}

    return result;
}

// ============================================================
// 12. TELEGRAM -> ADMIN
// ============================================================

async function mirrorToAdmin(
    clientId,
    sender,
    text
) {

    if (!ADMIN_CHAT_ID) {
        return;
    }

    const client =
        getClient(clientId);

    const label =
        sender === 'client'
            ? '👤 Клиент'
            : sender === 'ai'
                ? '🤖 AI'
                : '👨‍💼 Менеджер';

    const message =
        `${label}\n` +
        `Telegram ID: ${clientId}\n` +
        `Режим: ${client.mode}\n\n` +
        `${text}`;

    try {

        const result =
            await sendTelegramMessage(
                ADMIN_CHAT_ID,
                message,
                {

                    reply_markup: {

                        inline_keyboard: [

                            [

                                {
                                    text:
                                        '👤 MANAGER',

                                    callback_data:
                                        `manager:${clientId}`
                                },

                                {
                                    text:
                                        '🤖 AI',

                                    callback_data:
                                        `ai:${clientId}`
                                }

                            ]

                        ]

                    }

                }
            );

        const msg =
            result?.result;

        if (msg?.message_id) {

            adminMessageMap.set(
                String(msg.message_id),
                String(clientId)
            );
        }

    } catch (e) {

        error(
            'Mirror admin error:',
            e.message
        );
    }
}

// ============================================================
// 13. TELEGRAM CLIENT MESSAGE
// ============================================================

async function processTelegramClientMessage(
    message
) {

    if (
        !message?.chat?.id ||
        !message.text
    ) {
        return;
    }

    const clientId =
        String(message.chat.id);

    const text =
        String(message.text).trim();

    if (!text) {
        return;
    }

    const client =
        getClient(clientId);

    client.name =
        message.from?.first_name || '';

    client.username =
        message.from?.username || '';

    log(
        `📨 Client ${clientId}: ${text}`
    );

    // 1. Полностью дублируем клиентское сообщение
    await mirrorToAdmin(
        clientId,
        'client',
        text
    );

    // 2. Telegram -> Bitrix
    try {

        await sendToBitrixConnector(
            clientId,
            text,
            'client',
            message.from
        );

    } catch (e) {

        error(
            'Telegram -> Bitrix error:',
            e.message
        );
    }

    // 3. MANAGER режим
    if (client.mode === 'MANAGER') {

        log(
            '⏸ AI skipped: MANAGER mode'
        );

        return;
    }

    // 4. AI
    try {

        const answer =
            await askDeepSeek(text);

        // Telegram
        await sendTelegramMessage(
            clientId,
            answer
        );

        // Админ Telegram
        await mirrorToAdmin(
            clientId,
            'ai',
            answer
        );

        // Bitrix
        try {

            await sendToBitrixConnector(
                clientId,
                answer,
                'ai',
                message.from
            );

        } catch (e) {

            error(
                'AI -> Bitrix error:',
                e.message
            );
        }

    } catch (e) {

        error(
            'DeepSeek error:',
            e.message
        );

        await sendTelegramMessage(
            clientId,
            'Извините, произошла ошибка. Сейчас подключу менеджера.'
        );

        setClientMode(
            clientId,
            'MANAGER'
        );
    }
}

// ============================================================
// 14. TELEGRAM ADMIN MESSAGE
// ============================================================

async function processTelegramAdminMessage(
    message
) {

    if (
        !ADMIN_CHAT_ID ||
        String(message.chat.id) !==
            String(ADMIN_CHAT_ID)
    ) {
        return;
    }

    const text =
        String(message.text || '').trim();

    if (!text) {
        return;
    }

    // /ai CLIENT_ID
    if (text.startsWith('/ai ')) {

        const clientId =
            text.slice(4).trim();

        if (clientId) {

            setClientMode(
                clientId,
                'AI'
            );

            await sendTelegramMessage(
                ADMIN_CHAT_ID,
                `🤖 AI включён для ${clientId}`
            );
        }

        return;
    }

    // /manager CLIENT_ID
    if (text.startsWith('/manager ')) {

        const clientId =
            text.slice(9).trim();

        if (clientId) {

            setClientMode(
                clientId,
                'MANAGER'
            );

            await sendTelegramMessage(
                ADMIN_CHAT_ID,
                `👤 MANAGER включён для ${clientId}`
            );
        }

        return;
    }

    // Reply на сообщение клиента в админском Telegram
    const replyId =
        message.reply_to_message?.message_id;

    let clientId = null;

    if (replyId) {

        clientId =
            adminMessageMap.get(
                String(replyId)
            ) || null;
    }

    if (!clientId) {
        return;
    }

    // Ответ менеджера автоматически
    // переводит клиента в MANAGER
    setClientMode(
        clientId,
        'MANAGER'
    );

    // Telegram
    await sendTelegramMessage(
        clientId,
        text
    );

    // Bitrix
    try {

        await sendToBitrixConnector(
            clientId,
            text,
            'manager',
            {
                first_name:
                    'Менеджер'
            }
        );

    } catch (e) {

        error(
            'Admin -> Bitrix error:',
            e.message
        );
    }

    await sendTelegramMessage(
        ADMIN_CHAT_ID,
        `👤 Сообщение отправлено клиенту ${clientId}`
    );
}

// ============================================================
// 15. TELEGRAM CALLBACK
// ============================================================

async function processTelegramCallback(
    callbackQuery
) {

    if (!callbackQuery?.data) {
        return;
    }

    if (
        !ADMIN_CHAT_ID ||
        String(
            callbackQuery.message?.chat?.id
        ) !== String(ADMIN_CHAT_ID)
    ) {
        return;
    }

    const data =
        callbackQuery.data;

    const parts =
        data.split(':');

    const action =
        parts[0];

    const clientId =
        parts.slice(1).join(':');

    if (!clientId) {
        return;
    }

    if (action === 'manager') {

        setClientMode(
            clientId,
            'MANAGER'
        );

        await answerTelegramCallback(
            callbackQuery.id,
            'Менеджер подключён'
        );

        await sendTelegramMessage(
            ADMIN_CHAT_ID,
            `👤 MANAGER для ${clientId}`
        );

    } else if (action === 'ai') {

        setClientMode(
            clientId,
            'AI'
        );

        await answerTelegramCallback(
            callbackQuery.id,
            'AI включён'
        );

        await sendTelegramMessage(
            ADMIN_CHAT_ID,
            `🤖 AI для ${clientId}`
        );
    }
}

// ============================================================
// 16. TELEGRAM POLLING
// ============================================================

let telegramOffset = 0;

async function telegramPoll() {

    if (!BOT_TOKEN) {

        warn(
            'Telegram disabled: BOT_TOKEN missing'
        );

        return;
    }

    log(
        '🚀 Telegram polling started'
    );

    while (true) {

        try {

            const result =
                await telegramCall(
                    'getUpdates',
                    {

                        offset:
                            telegramOffset,

                        limit:
                            100,

                        timeout:
                            30,

                        allowed_updates:
                            [
                                'message',
                                'callback_query'
                            ]
                    }
                );

            const updates =
                result?.result || [];

            for (const update of updates) {

                telegramOffset =
                    Number(
                        update.update_id
                    ) + 1;

                try {

                    if (
                        update.callback_query
                    ) {

                        await processTelegramCallback(
                            update.callback_query
                        );

                    } else if (
                        update.message
                    ) {

                        const msg =
                            update.message;

                        if (
                            ADMIN_CHAT_ID &&
                            String(msg.chat.id) ===
                                String(ADMIN_CHAT_ID)
                        ) {

                            await processTelegramAdminMessage(
                                msg
                            );

                        } else {

                            await processTelegramClientMessage(
                                msg
                            );
                        }
                    }

                } catch (e) {

                    error(
                        'Telegram update error:',
                        e.message
                    );
                }
            }

        } catch (e) {

            error(
                'Telegram polling error:',
                e.message
            );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        5000
                    )
            );
        }
    }
}

// ============================================================
// 17. BITRIX FETCH
//
// ВАЖНО:
// Это тот самый старый рабочий контур.
// Не переводим его на OAuth.
// Не переводим его на Connector.
// ============================================================

let bitrixOffset = 0;

function loadBitrixOffset() {

    try {

        if (
            fs.existsSync(
                OFFSET_FILE
            )
        ) {

            const data =
                JSON.parse(
                    fs.readFileSync(
                        OFFSET_FILE,
                        'utf8'
                    )
                );

            bitrixOffset =
                data.offset || 0;
        }

    } catch (e) {

        error(
            'Offset load error:',
            e.message
        );
    }
}

loadBitrixOffset();

function saveBitrixOffset(
    offset
) {

    try {

        fs.writeFileSync(
            OFFSET_FILE,
            JSON.stringify(
                {
                    offset,
                    savedAt:
                        new Date().toISOString()
                }
            ),
            'utf8'
        );

    } catch (e) {

        error(
            'Offset save error:',
            e.message
        );
    }
}

async function bitrixFetchPoll() {

    if (
        !BITRIX_WEBHOOK_URL ||
        !BITRIX_BOT_TOKEN
    ) {

        warn(
            'Bitrix internal bot disabled'
        );

        return;
    }

    log(
        '🚀 Bitrix fetch loop started'
    );

    while (true) {

        try {

            /*
            ==================================================
            НЕ МЕНЯЕМ РАБОЧУЮ СХЕМУ
            ==================================================
            */

            const result =
                await bitrixWebhookCall(
                    'imbot.v2.Event.get',
                    {

                        botId:
                            BITRIX_BOT_ID,

                        botToken:
                            BITRIX_BOT_TOKEN,

                        offset:
                            bitrixOffset,

                        limit:
                            50
                    }
                );

            const payload =
                result?.result || {};

            const events =
                payload.events || [];

            const nextOffset =
                payload.nextOffset ??
                bitrixOffset;

            if (
                events.length > 0
            ) {

                log(
                    `📦 Bitrix events: ${events.length}`
                );
            }

            bitrixOffset =
                Number(nextOffset);

            saveBitrixOffset(
                bitrixOffset
            );

            for (
                const event of events
            ) {

                try {

                    if (
                        event.type ===
                        'ONIMBOTV2MESSAGEADD'
                    ) {

                        const data =
                            event.data || {};

                        const text =
                            String(
                                data.message?.text ||
                                ''
                            ).trim();

                        const dialogId =
                            data.chat?.dialogId ||
                            data.chat?.id;

                        if (
                            text &&
                            dialogId
                        ) {

                            /*
                            Старый внутренний
                            Bitrix-чат продолжает
                            работать независимо
                            от Connector.
                            */

                            const answer =
                                await askDeepSeek(
                                    text
                                );

                            await bitrixWebhookCall(
                                'imbot.v2.Chat.Message.send',
                                {

                                    BOT_ID:
                                        BITRIX_BOT_ID,

                                    DIALOG_ID:
                                        dialogId,

                                    MESSAGE:
                                        answer
                                }
                            );
                        }
                    }

                } catch (e) {

                    error(
                        'Bitrix event error:',
                        e.message
                    );
                }
            }

        } catch (e) {

            error(
                'Bitrix fetch error:',
                e.message
            );
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    BITRIX_POLL_INTERVAL_MS
                )
        );
    }
}

// ============================================================
// 18. CONNECTOR MANAGER -> TELEGRAM
// ============================================================

async function processConnectorManagerEvent(
    payload
) {

    const data =
        payload?.data;

    if (!data) {
        return;
    }

    if (
        String(
            data.CONNECTOR || ''
        ).toLowerCase() !==
        BITRIX_CONNECTOR_ID.toLowerCase()
    ) {
        return;
    }

    const messages =
        Array.isArray(
            data.MESSAGES
        )
            ? data.MESSAGES
            : [];

    for (
        const item of messages
    ) {

        const chat =
            item.chat || {};

        const message =
            item.message || {};

        const im =
            item.im || {};

        const clientId =
            String(
                chat.id || ''
            );

        if (!clientId) {
            continue;
        }

        if (im.chat_id) {

            bitrixChatMap.set(
                String(im.chat_id),
                clientId
            );
        }

        const managerText =
            String(
                message.text || ''
            ).trim();

        if (!managerText) {
            continue;
        }

        // ----------------------------------------------------
        // #AI
        // ----------------------------------------------------

        if (
            managerText === '#AI' ||
            managerText === '/ai'
        ) {

            setClientMode(
                clientId,
                'AI'
            );

            await sendTelegramMessage(
                clientId,
                '🤖 AI подключён'
            );

            await mirrorToAdmin(
                clientId,
                'manager',
                'Команда: AI'
            );

            await confirmConnectorDelivery(
                data,
                item
            );

            continue;
        }

        // ----------------------------------------------------
        // #MANAGER
        // ----------------------------------------------------

        if (
            managerText === '#MANAGER' ||
            managerText === '/manager'
        ) {

            setClientMode(
                clientId,
                'MANAGER'
            );

            await sendTelegramMessage(
                clientId,
                '👤 Диалог передан менеджеру'
            );

            await mirrorToAdmin(
                clientId,
                'manager',
                'Команда: MANAGER'
            );

            await confirmConnectorDelivery(
                data,
                item
            );

            continue;
        }

        // ----------------------------------------------------
        // ОБЫЧНЫЙ ОТВЕТ МЕНЕДЖЕРА
        // ----------------------------------------------------

        setClientMode(
            clientId,
            'MANAGER'
        );

        // Bitrix -> Telegram
        await sendTelegramMessage(
            clientId,
            managerText
        );

        // Bitrix -> админский Telegram
        await mirrorToAdmin(
            clientId,
            'manager',
            managerText
        );

        // подтверждение Bitrix
        await confirmConnectorDelivery(
            data,
            item
        );
    }
}

// ============================================================
// 19. CONNECTOR DELIVERY
// ============================================================

async function confirmConnectorDelivery(
    data,
    item
) {

    try {

        const im =
            item.im || {};

        const message =
            item.message || {};

        if (
            !im.chat_id ||
            !im.message_id
        ) {
            return;
        }

        await bitrixOAuthCall(
            'imconnector.send.status.delivery',
            {

                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    Number(data.LINE),

                MESSAGES: [

                    {

                        im: {

                            chat_id:
                                Number(
                                    im.chat_id
                                ),

                            message_id:
                                Number(
                                    im.message_id
                                )
                        },

                        message: {

                            id: [
                                String(
                                    message.id ||
                                    `bitrix_${Date.now()}`
                                )
                            ],

                            date:
                                Math.floor(
                                    Date.now() /
                                    1000
                                )
                        },

                        chat: {

                            id:
                                String(
                                    item.chat?.id ||
                                    ''
                                )
                        }
                    }

                ]
            }
        );

    } catch (e) {

        error(
            'Connector delivery error:',
            e.message
        );
    }
}

// ============================================================
// 20. HTTP SERVER
// ============================================================

const server =
    http.createServer(
        async (req, res) => {

            try {

                const url =
                    new URL(
                        req.url,
                        `http://${req.headers.host || 'localhost'}`
                    );

                // ==================================================
                // HEALTH
                // ==================================================

                if (
                    url.pathname ===
                    '/health'
                ) {

                    res.writeHead(
                        200,
                        {
                            'Content-Type':
                                'application/json'
                        }
                    );

                    res.end(
                        JSON.stringify(
                            {

                                ok: true,

                                telegram:
                                    !!BOT_TOKEN,

                                bitrixFetch:
                                    !!(
                                        BITRIX_WEBHOOK_URL &&
                                        BITRIX_BOT_TOKEN
                                    ),

                                connector:
                                    BITRIX_CONNECTOR_ENABLED,

                                oauth:
                                    !!(
                                        bitrixAuth &&
                                        bitrixAuth.access_token
                                    ),

                                connectorReady:
                                    connectorReady,

                                openLine:
                                    bitrixOpenLineId,

                                connectorId:
                                    BITRIX_CONNECTOR_ID
                            }
                        )
                    );

                    return;
                }

                // ==================================================
                // BITRIX INITIAL INSTALLATION CALLBACK
                //
                // Именно этот URL указываем в:
                // "Путь для первоначальной установки"
                //
                // https://mlk-bot.onrender.com/bitrix-webhook
                // ==================================================

                ```js
// ============================================================
// BITRIX INITIAL INSTALLATION CALLBACK
//
// Путь в Bitrix24:
// https://mlk-bot.onrender.com/bitrix-webhook
//
// Bitrix24 присылает OAuth при установке локального
// приложения POST-запросом application/x-www-form-urlencoded.
//
// ВАЖНО:
// auth приходит не как:
//     auth: {...}
//
// а как:
//     auth[access_token]
//     auth[refresh_token]
//     auth[domain]
//     auth[client_endpoint]
//     ...
//
// Поэтому здесь специально собираем вложенный объект auth.
// ============================================================

if (url.pathname === '/bitrix-webhook') {

    try {

        // --------------------------------------------------------
        // GET
        // --------------------------------------------------------
        //
        // GET нужен только для проверки, что URL существует.
        //
        if (req.method === 'GET') {

            log('========================================');
            log('📥 BITRIX INSTALL CALLBACK — GET');
            log('URL:', req.url);
            log('QUERY:', Object.fromEntries(url.searchParams.entries()));
            log('========================================');

            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8'
            });

            res.end(
                'Bitrix installation callback is ready'
            );

            return;
        }

        // --------------------------------------------------------
        // Разрешаем только POST
        // --------------------------------------------------------

        if (req.method !== 'POST') {

            res.writeHead(405, {
                'Content-Type': 'application/json'
            });

            res.end(JSON.stringify({
                status: 'error',
                message: 'Method Not Allowed'
            }));

            return;
        }

        // --------------------------------------------------------
        // Читаем тело
        // --------------------------------------------------------

        const body = await readRequestBody(req);

        log('========================================');
        log('📥 BITRIX INSTALL CALLBACK');
        log('CONTENT-TYPE:', req.headers['content-type'] || 'MISSING');
        log('BODY LENGTH:', body.length);
        log('========================================');

        let payload = {};

        // --------------------------------------------------------
        // 1. JSON
        // --------------------------------------------------------

        if (body) {

            try {

                payload = JSON.parse(body);

                log('BITRIX CALLBACK FORMAT: JSON');

            } catch (jsonError) {

                // ------------------------------------------------
                // 2. application/x-www-form-urlencoded
                // ------------------------------------------------

                log(
                    'BITRIX CALLBACK FORMAT: FORM URLENCODED'
                );

                const params =
                    new URLSearchParams(body);

                for (const [key, value] of params.entries()) {

                    /*
                     * Простые поля:
                     *
                     * event=ONAPPINSTALL
                     * ts=...
                     *
                     * Вложенные:
                     *
                     * auth[access_token]=...
                     * auth[refresh_token]=...
                     * auth[domain]=...
                     *
                     * data[VERSION]=...
                     */

                    const authMatch =
                        key.match(/^auth\[([^\]]+)\]$/);

                    if (authMatch) {

                        if (!payload.auth) {
                            payload.auth = {};
                        }

                        payload.auth[authMatch[1]] = value;

                        continue;
                    }

                    const dataMatch =
                        key.match(/^data\[([^\]]+)\]$/);

                    if (dataMatch) {

                        if (!payload.data) {
                            payload.data = {};
                        }

                        payload.data[dataMatch[1]] = value;

                        continue;
                    }

                    payload[key] = value;
                }
            }
        }

        // --------------------------------------------------------
        // Дополнительный случай:
        //
        // Иногда auth может прийти строкой JSON.
        // --------------------------------------------------------

        if (
            typeof payload.auth === 'string'
        ) {

            try {

                payload.auth =
                    JSON.parse(payload.auth);

            } catch (e) {

                // Оставляем как есть.
            }
        }

        // --------------------------------------------------------
        // ЛОГИРУЕМ ТОЛЬКО НАЗВАНИЯ OAuth-полей.
        //
        // Сами токены в Logs НЕ выводим.
        // --------------------------------------------------------

        log(
            'BITRIX EVENT:',
            payload.event || 'MISSING'
        );

        log(
            'BITRIX AUTH:',
            payload.auth ? 'PRESENT' : 'MISSING'
        );

        if (payload.auth) {

            log(
                'AUTH access_token:',
                payload.auth.access_token
                    ? 'PRESENT'
                    : 'MISSING'
            );

            log(
                'AUTH refresh_token:',
                payload.auth.refresh_token
                    ? 'PRESENT'
                    : 'MISSING'
            );

            log(
                'AUTH domain:',
                payload.auth.domain || 'MISSING'
            );

            log(
                'AUTH client_endpoint:',
                payload.auth.client_endpoint
                    ? 'PRESENT'
                    : 'MISSING'
            );

            log(
                'AUTH member_id:',
                payload.auth.member_id
                    ? 'PRESENT'
                    : 'MISSING'
            );
        }

        // --------------------------------------------------------
        // ПРОВЕРКА OAuth
        // --------------------------------------------------------

        const auth =
            payload.auth || {};

        if (
            !auth.access_token ||
            !auth.refresh_token
        ) {

            error(
                '❌ BITRIX INSTALL CALLBACK: OAuth tokens missing'
            );

            /*
             * Не падаем.
             *
             * Bitrix получил HTTP 400, но сам Node-процесс
             * продолжает работать.
             */

            res.writeHead(400, {
                'Content-Type': 'application/json'
            });

            res.end(
                JSON.stringify({
                    status: 'error',
                    message:
                        'Bitrix OAuth auth data missing'
                })
            );

            return;
        }

        // --------------------------------------------------------
        // СОХРАНЯЕМ OAuth
        // --------------------------------------------------------

        bitrixAuth = {
            ...auth,

            /*
             * На всякий случай сохраняем client_id приложения,
             * если Bitrix его не прислал.
             */

            client_id:
                auth.client_id ||
                BITRIX_CLIENT_ID,

            client_secret:
                auth.client_secret ||
                BITRIX_CLIENT_SECRET
        };

        saveAuth(bitrixAuth);

        log(
            '========================================'
        );

        log(
            '✅ BITRIX OAuth TOKENS RECEIVED'
        );

        log(
            '✅ OAuth saved to:',
            AUTH_FILE
        );

        log(
            'BITRIX DOMAIN:',
            bitrixAuth.domain ||
            BITRIX_DOMAIN
        );

        log(
            '========================================'
        );

        // --------------------------------------------------------
        // СРАЗУ ОТВЕЧАЕМ BITRIX
        // --------------------------------------------------------

        res.writeHead(200, {
            'Content-Type': 'application/json'
        });

        res.end(
            JSON.stringify({
                status: 'success'
            })
        );

        // --------------------------------------------------------
        // А Connector запускаем уже ПОСЛЕ ответа Bitrix.
        //
        // Если Connector сломается — Telegram и FETCH
        // продолжат работать.
        // --------------------------------------------------------

        setImmediate(() => {

            setupConnector()
                .then(() => {

                    log(
                        '✅ Connector setup completed after Bitrix installation'
                    );

                })
                .catch(e => {

                    error(
                        '❌ Connector setup after installation:',
                        e.message
                    );

                });

        });

        return;

    } catch (e) {

        // --------------------------------------------------------
        // Ошибка самого callback НЕ должна убивать сервер.
        // --------------------------------------------------------

        error(
            '❌ Bitrix installation callback error:',
            e.message
        );

        if (!res.headersSent) {

            res.writeHead(500, {
                'Content-Type': 'application/json'
            });

            res.end(
                JSON.stringify({
                    status: 'error',
                    message: 'Internal callback error'
                })
            );

            return;
        }

        try {
            res.end();
        } catch (ignore) {}

        return;
    }
}


                // ==================================================
                // BITRIX CONNECTOR HANDLER
                //
                // GET:
                // Bitrix открывает настройки Connector.
                //
                // POST:
                // OnImConnectorMessageAdd
                // ==================================================

                if (
                    url.pathname ===
                    '/bitrix/handler'
                ) {

                    // ------------------------------------------------
                    // GET — SETTINGS_CONNECTOR
                    // ------------------------------------------------

                    if (
                        req.method === 'GET'
                    ) {

                        const placementOptions =
                            url.searchParams.get(
                                'PLACEMENT_OPTIONS'
                            );

                        let options = {};

                        if (
                            placementOptions
                        ) {

                            try {

                                options =
                                    JSON.parse(
                                        placementOptions
                                    );

                            } catch (e) {}
                        }

                        const line =
                            Number(
                                options.LINE ||
                                bitrixOpenLineId ||
                                0
                            );

                        const active =
                            options.ACTIVE_STATUS;

                        if (line) {

                            bitrixOpenLineId =
                                line;

                            // Bitrix settings page.
                            // Активируем канал.
                            setImmediate(
                                async () => {

                                    try {

                                        await activateConnector(
                                            line
                                        );

                                        await connectorStatus(
                                            line
                                        );

                                        connectorReady =
                                            true;

                                    } catch (e) {

                                        error(
                                            'Connector settings activation error:',
                                            e.message
                                        );
                                    }
                                }
                            );
                        }

                        res.writeHead(
                            200,
                            {
                                'Content-Type':
                                    'text/html; charset=utf-8'
                            }
                        );

                        res.end(
                            `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>MLK Telegram</title>
<style>
body {
    font-family: Arial, sans-serif;
    padding: 30px;
    background: #f5f7f9;
}
.box {
    max-width: 600px;
    margin: auto;
    background: white;
    padding: 25px;
    border-radius: 12px;
}
.ok {
    color: #168a42;
}
</style>
</head>
<body>
<div class="box">
<h2>MLK Telegram</h2>

<p class="ok">
<b>Connector MLK Telegram подключён.</b>
</p>

<p>
Открытая линия:
<b>${line || 'определяется'}</b>
</p>

<p>
Статус:
<b>${active === undefined ? 'готов к настройке' : active ? 'активен' : 'выключен'}</b>
</p>

<p>
Клиент пишет в Telegram → сообщение попадает в Bitrix24 Open Line.
</p>

<p>
Ответ менеджера в Bitrix24 → отправляется обратно клиенту в Telegram.
</p>
</div>
</body>
</html>`
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // POST — EVENTS
                    // ------------------------------------------------

                    if (
                        req.method === 'POST'
                    ) {

                        const body =
                            await readRequestBody(
                                req
                            );

                        let payload = {};

                        try {

                            payload =
                                JSON.parse(
                                    body
                                );

                        } catch (e) {

                            const params =
                                new URLSearchParams(
                                    body
                                );

                            for (
                                const [
                                    key,
                                    value
                                ] of params.entries()
                            ) {

                                payload[key] =
                                    value;
                            }

                            if (
                                typeof payload.data ===
                                'string'
                            ) {

                                try {

                                    payload.data =
                                        JSON.parse(
                                            payload.data
                                        );

                                } catch (e) {}
                            }
                        }

                        log(
                            '📥 Bitrix Connector POST:',
                            payload.event ||
                            'unknown'
                        );

                        // ------------------------------------------------
                        // MANAGER MESSAGE
                        // ------------------------------------------------

                        if (
                            String(
                                payload.event ||
                                ''
                            ).toUpperCase() ===
                            'ONIMCONNECTORMESSAGEADD'
                        ) {

                            // Сначала мгновенно отвечаем Bitrix.
                            res.writeHead(
                                200,
                                {
                                    'Content-Type':
                                        'application/json'
                                }
                            );

                            res.end(
                                JSON.stringify(
                                    {
                                        status:
                                            'success'
                                    }
                                )
                            );

                            setImmediate(
                                () => {

                                    processConnectorManagerEvent(
                                        payload
                                    ).catch(
                                        e =>
                                            error(
                                                'Connector event processing:',
                                                e.message
                                            )
                                    );
                                }
                            );

                            return;
                        }

                        res.writeHead(
                            200,
                            {
                                'Content-Type':
                                    'application/json'
                            }
                        );

                        res.end(
                            JSON.stringify(
                                {
                                    status:
                                        'ok'
                                }
                            )
                        );

                        return;
                    }

                    res.writeHead(
                        405
                    );

                    res.end(
                        'Method Not Allowed'
                    );

                    return;
                }

                // ==================================================
                // ROOT
                // ==================================================

                res.writeHead(
                    200,
                    {
                        'Content-Type':
                            'text/plain; charset=utf-8'
                    }
                );

                res.end(
                    'MLK Bot is running'
                );

            } catch (e) {

                error(
                    'HTTP server error:',
                    e.message
                );

                if (
                    !res.headersSent
                ) {

                    res.writeHead(
                        500
                    );
                }

                res.end(
                    'Internal Server Error'
                );
            }
        }
    );

// ============================================================
// 21. STARTUP
// ============================================================

async function startup() {

    log(
        '========================================'
    );

    log(
        'MLK BOT — WORKING FETCH + CONNECTOR'
    );

    log(
        'Telegram + DeepSeek + Bitrix24'
    );

    log(
        '========================================'
    );

    log(
        'BOT_TOKEN:',
        secretStatus(BOT_TOKEN)
    );

    log(
        'ADMIN_CHAT_ID:',
        secretStatus(ADMIN_CHAT_ID)
    );

    log(
        'DEEPSEEK_API_KEY:',
        secretStatus(DEEPSEEK_API_KEY)
    );

    log(
        'DEEPSEEK_MODEL:',
        DEEPSEEK_MODEL
    );

    log(
        'BITRIX_WEBHOOK_URL:',
        secretStatus(BITRIX_WEBHOOK_URL)
    );

    log(
        'BITRIX_BOT_TOKEN:',
        secretStatus(BITRIX_BOT_TOKEN)
    );

    log(
        'BITRIX_BOT_TOKEN LENGTH:',
        BITRIX_BOT_TOKEN.length
    );

    log(
        'BITRIX_BOT_ID:',
        BITRIX_BOT_ID
    );

    log(
        'BITRIX_CONNECTOR_ENABLED:',
        BITRIX_CONNECTOR_ENABLED
    );

    log(
        'BITRIX_CONNECTOR_ID:',
        BITRIX_CONNECTOR_ID
    );

    log(
        'BITRIX_CONNECTOR_NAME:',
        BITRIX_CONNECTOR_NAME
    );

    log(
        'BITRIX_DOMAIN:',
        BITRIX_DOMAIN
    );

    log(
        'BITRIX_CLIENT_ID:',
        secretStatus(BITRIX_CLIENT_ID)
    );

    log(
        'BITRIX_CLIENT_SECRET:',
        secretStatus(BITRIX_CLIENT_SECRET)
    );

    log(
        'PUBLIC_BASE_URL:',
        PUBLIC_BASE_URL
    );

    log(
        'BITRIX_HANDLER_URL:',
        BITRIX_HANDLER_URL
    );

    log(
        'BITRIX_INSTALL_URL:',
        BITRIX_INSTALL_URL
    );

    log(
        'BITRIX_OPENLINE_ID:',
        bitrixOpenLineId || 'AUTO'
    );

    log(
        'AUTH FILE:',
        AUTH_FILE
    );

    log(
        '========================================'
    );

    // ----------------------------------------------------------
    // HTTP
    // ----------------------------------------------------------

    server.listen(
        PORT,
        '0.0.0.0',
        () => {

            log(
                `🚀 Server started on port ${PORT}`
            );
        }
    );

    // ----------------------------------------------------------
    // TELEGRAM
    // ----------------------------------------------------------

    telegramPoll()
        .catch(
            e =>
                error(
                    'Telegram fatal:',
                    e.message
                )
        );

    // ----------------------------------------------------------
    // BITRIX FETCH
    // ----------------------------------------------------------

    bitrixFetchPoll()
        .catch(
            e =>
                error(
                    'Bitrix FETCH fatal:',
                    e.message
                )
        );

    // ----------------------------------------------------------
    // CONNECTOR
    // ----------------------------------------------------------

    if (
        BITRIX_CONNECTOR_ENABLED
    ) {

        if (
            bitrixAuth &&
            bitrixAuth.access_token
        ) {

            log(
                '🔌 OAuth already exists — starting Connector setup'
            );

            setupConnector()
                .catch(
                    e =>
                        error(
                            'Connector startup:',
                            e.message
                        )
                );

        } else {

            warn(
                '⚠️ Connector waiting for Bitrix local-app installation.'
            );

            warn(
                '➡️ Install/reinstall the Bitrix local application.'
            );

            warn(
                `➡️ Installation callback: ${BITRIX_INSTALL_URL}`
            );
        }
    }
}

// ============================================================
// 22. SHUTDOWN
// ============================================================

function shutdown(signal) {

    log(
        `🛑 ${signal}`
    );

    server.close(
        () => {

            log(
                'Server closed'
            );

            process.exit(0);
        }
    );

    setTimeout(
        () =>
            process.exit(0),
        5000
    );
}

process.on(
    'SIGTERM',
    () =>
        shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () =>
        shutdown('SIGINT')
);

process.on(
    'unhandledRejection',
    reason =>
        error(
            'Unhandled rejection:',
            reason
        )
);

process.on(
    'uncaughtException',
    err =>
        error(
            'Uncaught exception:',
            err.message
        )
);

// ============================================================
// START
// ============================================================

startup().catch(
    e => {

        error(
            'Startup fatal:',
            e.message
        );

        process.exit(1);
    }
);