```javascript
'use strict';

/*
===========================================================
MLK BOT
Telegram + DeepSeek + Bitrix24 imbot.v2 + Connector/Open Line
AI <-> MANAGER

ВАЖНО:
- Telegram token: BOT_TOKEN
- НЕ используем TELEGRAM_BOT_TOKEN
- НЕ используем DEEPSEEK_MODEL
- Старый Bitrix FETCH через imbot.v2.Event.get НЕ УДАЛЯЕМ
- Connector/Open Line работает через OAuth приложения Bitrix
- OAuth access/refresh НЕ нужны в Render Variables:
  они приходят от Bitrix при установке приложения
- OAuth сохраняется в /data/bitrix-auth.json, если /data существует
===========================================================
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 10000);

const BOT_TOKEN = String(process.env.BOT_TOKEN || '').trim();

const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || '').trim();

const DEEPSEEK_API_KEY = String(
    process.env.DEEPSEEK_API_KEY || ''
).trim();

const BITRIX_WEBHOOK_URL = String(
    process.env.BITRIX_WEBHOOK_URL || ''
).trim();

const BITRIX_BOT_TOKEN = String(
    process.env.BITRIX_BOT_TOKEN || ''
).trim();

const BITRIX_BOT_ID = Number(
    process.env.BITRIX_BOT_ID || 1787
);

const BITRIX_BOT_CODE = String(
    process.env.BITRIX_BOT_CODE || 'mlk_ai_consultant_v2'
).trim();

const BITRIX_DOMAIN = String(
    process.env.BITRIX_DOMAIN || 'b24-2fqomj.bitrix24.by'
).trim();

const BITRIX_CLIENT_ID = String(
    process.env.BITRIX_CLIENT_ID || ''
).trim();

const BITRIX_CLIENT_SECRET = String(
    process.env.BITRIX_CLIENT_SECRET || ''
).trim();

const BITRIX_CONNECTOR_ENABLED =
    String(process.env.BITRIX_CONNECTOR_ENABLED || 'false')
        .toLowerCase() === 'true';

const BITRIX_CONNECTOR_ID = String(
    process.env.BITRIX_CONNECTOR_ID || 'mlk_telegram'
).trim();

const BITRIX_CONNECTOR_NAME = String(
    process.env.BITRIX_CONNECTOR_NAME || 'MLK Telegram'
).trim();

const PUBLIC_BASE_URL = String(
    process.env.PUBLIC_BASE_URL || ''
).trim().replace(/\/+$/, '');

const BITRIX_HANDLER_URL = String(
    process.env.BITRIX_HANDLER_URL ||
    `${PUBLIC_BASE_URL}/bitrix/handler`
).trim();

const BITRIX_POLL_INTERVAL_MS = 3000;

/*
Не используем DEEPSEEK_MODEL из ENV.
Модель фиксируем здесь, как в рабочей конфигурации.
*/
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

const DEEPSEEK_URL =
    'https://api.deepseek.com/chat/completions';

const TELEGRAM_API =
    BOT_TOKEN
        ? `https://api.telegram.org/bot${BOT_TOKEN}`
        : '';

/*
Render Disk:
если /data существует — используем его.
Иначе временный каталог.
*/
const AUTH_FILE = fs.existsSync('/data')
    ? '/data/bitrix-auth.json'
    : '/tmp/bitrix-auth.json';

/* =========================================================
   STATE
========================================================= */

/*
clientId -> {
    mode: 'AI' | 'MANAGER',
    name,
    username,
    lastSeen
}
*/
const clients = new Map();

/*
Telegram admin message ID -> Telegram client ID
*/
const adminMessageMap = new Map();

/*
Bitrix internal chat ID -> Telegram client ID
*/
const bitrixChatMap = new Map();

/*
Защита от повторной обработки Telegram updates.
*/
let telegramOffset = 0;

/*
Bitrix FETCH offset.
*/
let bitrixOffset = 0;

/*
OAuth состояние.
*/
let bitrixAuth = null;

/*
Open Line ID.
Может быть найден автоматически.
*/
let bitrixOpenLineId = null;

/*
Чтобы несколько async процессов не запускали
одновременную инициализацию.
*/
let connectorInitPromise = null;

/*
Чтобы refresh OAuth не выполнялся одновременно
несколькими запросами.
*/
let refreshPromise = null;

/* =========================================================
   LOGGING
========================================================= */

function log(...args) {
    console.log(...args);
}

function warn(...args) {
    console.warn(...args);
}

function error(...args) {
    console.error(...args);
}

/*
НИКОГДА не выводим секреты.
*/
function secretStatus(value) {
    return value ? 'OK' : 'MISSING';
}

/* =========================================================
   GENERIC HTTP
========================================================= */

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

    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        throw new Error(
            `Invalid JSON response. HTTP ${response.status}: ${text.slice(0, 1000)}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}: ${JSON.stringify(data).slice(0, 2000)}`
        );
    }

    return data;
}

/* =========================================================
   AUTH FILE
========================================================= */

function ensureAuthDirectory() {
    const directory = path.dirname(AUTH_FILE);

    try {
        fs.mkdirSync(directory, {
            recursive: true
        });
    } catch (e) {
        warn('Cannot create auth directory:', e.message);
    }
}

function loadAuth() {
    ensureAuthDirectory();

    try {
        if (!fs.existsSync(AUTH_FILE)) {
            return null;
        }

        const raw = fs.readFileSync(
            AUTH_FILE,
            'utf8'
        );

        const data = JSON.parse(raw);

        if (!data || typeof data !== 'object') {
            return null;
        }

        return data;
    } catch (e) {
        error('BITRIX AUTH LOAD ERROR:', e.message);
        return null;
    }
}

function saveAuth(auth) {
    ensureAuthDirectory();

    const safeAuth = {
        access_token: auth.access_token || '',
        refresh_token: auth.refresh_token || '',
        expires_in: auth.expires_in || 3600,
        expires: auth.expires || 0,
        domain: auth.domain || BITRIX_DOMAIN,
        client_endpoint:
            auth.client_endpoint ||
            `https://${auth.domain || BITRIX_DOMAIN}/rest/`,
        server_endpoint:
            auth.server_endpoint ||
            'https://oauth.bitrix.info/rest/',
        member_id: auth.member_id || '',
        user_id: auth.user_id || '',
        scope: auth.scope || ''
    };

    fs.writeFileSync(
        AUTH_FILE,
        JSON.stringify(safeAuth, null, 2),
        {
            encoding: 'utf8',
            mode: 0o600
        }
    );

    bitrixAuth = safeAuth;
}

/* =========================================================
   OAUTH
========================================================= */

function normalizeAuth(auth) {
    if (!auth || typeof auth !== 'object') {
        return null;
    }

    if (!auth.access_token) {
        return null;
    }

    return {
        ...auth,
        domain: auth.domain || BITRIX_DOMAIN,
        client_endpoint:
            auth.client_endpoint ||
            `https://${auth.domain || BITRIX_DOMAIN}/rest/`,
        server_endpoint:
            auth.server_endpoint ||
            'https://oauth.bitrix.info/rest/'
    };
}

async function refreshBitrixOAuth() {
    if (refreshPromise) {
        return refreshPromise;
    }

    if (
        !BITRIX_CLIENT_ID ||
        !BITRIX_CLIENT_SECRET ||
        !bitrixAuth ||
        !bitrixAuth.refresh_token
    ) {
        throw new Error(
            'Bitrix OAuth refresh unavailable: client credentials or refresh_token missing'
        );
    }

    refreshPromise = (async () => {
        const params = new URLSearchParams();

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

        const data = await fetchJson(
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
            !data.access_token
        ) {
            throw new Error(
                `OAuth refresh failed: ${JSON.stringify(data)}`
            );
        }

        saveAuth({
            ...bitrixAuth,
            ...data,
            domain:
                data.domain ||
                bitrixAuth.domain ||
                BITRIX_DOMAIN,
            client_endpoint:
                data.client_endpoint ||
                bitrixAuth.client_endpoint ||
                `https://${BITRIX_DOMAIN}/rest/`
        });

        log('✅ BITRIX OAUTH REFRESH SUCCESS');

        return bitrixAuth;
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

/* =========================================================
   BITRIX OAUTH REST
========================================================= */

function getBitrixClientEndpoint() {
    if (
        bitrixAuth &&
        bitrixAuth.client_endpoint
    ) {
        return bitrixAuth.client_endpoint.replace(
            /\/+$/,
            ''
        ) + '/';
    }

    return `https://${BITRIX_DOMAIN}/rest/`;
}

async function bitrixOAuthCall(
    method,
    params = {},
    retry = true
) {
    if (!bitrixAuth || !bitrixAuth.access_token) {
        throw new Error(
            'Bitrix OAuth is not installed yet'
        );
    }

    const endpoint =
        getBitrixClientEndpoint() +
        method;

    const body = {
        ...params,
        auth: bitrixAuth.access_token
    };

    const data = await fetchJson(
        endpoint,
        {
            method: 'POST',
            headers: {
                'Content-Type':
                    'application/json',
                'Accept':
                    'application/json'
            },
            body: JSON.stringify(body)
        }
    );

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

    if (
        data &&
        data.error
    ) {
        throw new Error(
            `Bitrix ${data.error}: ${
                data.error_description || ''
            }`
        );
    }

    return data;
}

/* =========================================================
   BITRIX WEBHOOK
   Старый рабочий контур.
========================================================= */

async function bitrixWebhookCall(
    method,
    params = {}
) {
    if (!BITRIX_WEBHOOK_URL) {
        throw new Error(
            'BITRIX_WEBHOOK_URL is missing'
        );
    }

    const url =
        BITRIX_WEBHOOK_URL.replace(
            /\/+$/,
            ''
        ) +
        '/' +
        method;

    const data = await fetchJson(
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
        }
    );

    if (
        data &&
        data.error
    ) {
        throw new Error(
            `Bitrix ${data.error}: ${
                data.error_description || ''
            }`
        );
    }

    return data;
}

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegramCall(
    method,
    params = {}
) {
    if (!BOT_TOKEN) {
        throw new Error(
            'BOT_TOKEN is missing'
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
    if (!text) {
        return null;
    }

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
        last = await telegramCall(
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

/* =========================================================
   TELEGRAM ADMIN KEYBOARD
========================================================= */

function adminKeyboard(clientId) {
    return {
        inline_keyboard: [
            [
                {
                    text: '👤 MANAGER',
                    callback_data:
                        `manager:${clientId}`
                },
                {
                    text: '🤖 AI',
                    callback_data:
                        `ai:${clientId}`
                }
            ]
        ]
    };
}

/* =========================================================
   CLIENT STATE
========================================================= */

function getClient(clientId) {
    const key = String(clientId);

    if (!clients.has(key)) {
        clients.set(key, {
            mode: 'AI',
            name: '',
            username: '',
            lastSeen: Date.now()
        });
    }

    const client = clients.get(key);

    client.lastSeen = Date.now();

    return client;
}

function setClientMode(
    clientId,
    mode
) {
    const client = getClient(clientId);

    client.mode =
        mode === 'MANAGER'
            ? 'MANAGER'
            : 'AI';

    return client;
}

/* =========================================================
   ADMIN MIRROR
========================================================= */

async function mirrorToAdmin(
    clientId,
    sender,
    text
) {
    if (!ADMIN_CHAT_ID) {
        return null;
    }

    const client = getClient(clientId);

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
        text;

    try {
        const result =
            await sendTelegramMessage(
                ADMIN_CHAT_ID,
                message,
                {
                    reply_markup:
                        adminKeyboard(
                            clientId
                        )
                }
            );

        const telegramMessage =
            result &&
            result.result;

        if (
            telegramMessage &&
            telegramMessage.message_id
        ) {
            adminMessageMap.set(
                String(
                    telegramMessage.message_id
                ),
                String(clientId)
            );
        }

        return telegramMessage;
    } catch (e) {
        error(
            'TELEGRAM ADMIN MIRROR ERROR:',
            e.message
        );

        return null;
    }
}

/* =========================================================
   DEEPSEEK
========================================================= */

async function askDeepSeek(
    clientId,
    userText
) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error(
            'DEEPSEEK_API_KEY is missing'
        );
    }

    const response =
        await fetchJson(
            DEEPSEEK_URL,
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
        response &&
        response.choices &&
        response.choices[0] &&
        response.choices[0].message &&
        response.choices[0].message.content;

    if (!answer) {
        throw new Error(
            'DeepSeek returned empty answer'
        );
    }

    return answer.trim();
}

/* =========================================================
   BITRIX CONNECTOR
========================================================= */

function connectorIcon() {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<rect width="100" height="100" rx="20" fill="#229ED9"/>' +
        '<path d="M25 28h50v34H48L34 76V62H25z" fill="white"/>' +
        '</svg>';

    return (
        'data:image/svg+xml,' +
        encodeURIComponent(svg)
    );
}

async function registerConnector() {
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
                        connectorIcon(),
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
                        connectorIcon(),
                    COLOR:
                        '#999999',
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
        '✅ BITRIX CONNECTOR REGISTERED:',
        result &&
        result.result
    );

    return result;
}

async function bindConnectorEvent() {
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
        '✅ BITRIX CONNECTOR EVENT BOUND:',
        result &&
        result.result
    );

    return result;
}

async function findOpenLine() {
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

                    order: {
                        ID: 'ASC'
                    },

                    filter: {
                        ACTIVE: 'Y'
                    },

                    limit: 50,
                    offset: 0
                },

                OPTIONS: {
                    QUEUE: 'Y',
                    CONFIG_QUEUE: 'Y'
                }
            }
        );

    const lines =
        result &&
        result.result;

    if (
        !Array.isArray(lines) ||
        lines.length === 0
    ) {
        throw new Error(
            'No active Bitrix Open Lines found'
        );
    }

    /*
    Сначала ищем линию, название которой
    похоже на Telegram.
    Если нет — берём первую активную.
    */
    const telegramLine =
        lines.find(line =>
            String(
                line.LINE_NAME || ''
            )
                .toLowerCase()
                .includes('telegram')
        );

    const line =
        telegramLine ||
        lines[0];

    bitrixOpenLineId =
        Number(line.ID);

    log(
        '✅ BITRIX OPEN LINE:',
        bitrixOpenLineId,
        '-',
        line.LINE_NAME
    );

    return line;
}

async function activateConnector() {
    if (!bitrixOpenLineId) {
        await findOpenLine();
    }

    const result =
        await bitrixOAuthCall(
            'imconnector.activate',
            {
                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    bitrixOpenLineId,

                ACTIVE:
                    1
            }
        );

    log(
        '✅ BITRIX CONNECTOR ACTIVATED ON LINE:',
        bitrixOpenLineId
    );

    return result;
}

async function setConnectorData() {
    if (!bitrixOpenLineId) {
        await findOpenLine();
    }

    const result =
        await bitrixOAuthCall(
            'imconnector.connector.data.set',
            {
                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    bitrixOpenLineId,

                DATA: {
                    ID:
                        `${BITRIX_CONNECTOR_ID}_line_${bitrixOpenLineId}`,

                    URL:
                        PUBLIC_BASE_URL,

                    URL_IM:
                        BITRIX_HANDLER_URL,

                    NAME:
                        BITRIX_CONNECTOR_NAME
                }
            }
        );

    log(
        '✅ BITRIX CONNECTOR DATA SET'
    );

    return result;
}

async function initializeConnector() {
    if (
        !BITRIX_CONNECTOR_ENABLED
    ) {
        warn(
            '⚠️ BITRIX_CONNECTOR_ENABLED=false'
        );

        return;
    }

    if (connectorInitPromise) {
        return connectorInitPromise;
    }

    connectorInitPromise =
        (async () => {
            if (!BITRIX_CLIENT_ID) {
                throw new Error(
                    'BITRIX_CLIENT_ID missing'
                );
            }

            if (!BITRIX_CLIENT_SECRET) {
                throw new Error(
                    'BITRIX_CLIENT_SECRET missing'
                );
            }

            if (
                !bitrixAuth ||
                !bitrixAuth.access_token
            ) {
                throw new Error(
                    'Bitrix application is not installed yet. Open Bitrix local application and install it again so the installation callback sends OAuth tokens.'
                );
            }

            await registerConnector();

            await bindConnectorEvent();

            await findOpenLine();

            await activateConnector();

            await setConnectorData();

            log(
                '========================================'
            );

            log(
                '🎉 BITRIX CONNECTOR READY'
            );

            log(
                'CONNECTOR:',
                BITRIX_CONNECTOR_ID
            );

            log(
                'OPEN LINE:',
                bitrixOpenLineId
            );

            log(
                'HANDLER:',
                'OK'
            );

            log(
                '========================================'
            );
        })();

    try {
        return await connectorInitPromise;
    } finally {
        connectorInitPromise = null;
    }
}

/* =========================================================
   SEND TELEGRAM MESSAGE -> BITRIX OPEN LINE
========================================================= */

function telegramUserObject(
    telegramUser,
    clientId
) {
    const firstName =
        String(
            telegramUser &&
            telegramUser.first_name ||
            'Telegram'
        )
            .replace(/[^\p{L}\p{N} _'-]/gu, '')
            .slice(0, 25) ||
        'Telegram';

    const lastName =
        String(
            telegramUser &&
            telegramUser.last_name ||
            ''
        )
            .replace(/[^\p{L}\p{N} _'-]/gu, '')
            .slice(0, 25);

    const username =
        telegramUser &&
        telegramUser.username
            ? `@${telegramUser.username}`
            : '';

    return {
        id:
            String(clientId),

        name:
            firstName,

        last_name:
            lastName,

        url:
            username
                ? `https://t.me/${telegramUser.username}`
                : '',

        skip_phone_validate:
            'Y'
    };
}

async function sendExternalMessageToBitrix(
    clientId,
    text,
    telegramUser,
    externalMessageId,
    senderType = 'client'
) {
    if (
        !BITRIX_CONNECTOR_ENABLED
    ) {
        return null;
    }

    if (
        !bitrixAuth ||
        !bitrixAuth.access_token
    ) {
        warn(
            '⚠️ Connector OAuth unavailable; message not copied to Open Line'
        );

        return null;
    }

    if (!bitrixOpenLineId) {
        await initializeConnector();
    }

    const user =
        telegramUserObject(
            telegramUser || {},
            clientId
        );

    /*
    Для сообщений, отправленных менеджером
    из Telegram, используем отдельного внешнего
    пользователя, чтобы Bitrix не воспринимал
    их как сообщения клиента.
    */
    if (
        senderType === 'manager'
    ) {
        user.id =
            `telegram_manager_${clientId}`;

        user.name =
            'Менеджер';

        user.last_name =
            'Telegram';
    }

    const messageId =
        String(
            externalMessageId ||
            `${Date.now()}_${crypto
                .randomBytes(4)
                .toString('hex')}`
        );

    const result =
        await bitrixOAuthCall(
            'imconnector.send.messages',
            {
                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    bitrixOpenLineId,

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
                                text
                        },

                        chat: {
                            id:
                                String(clientId),

                            name:
                                user.name ||
                                'Telegram',

                            url:
                                user.url ||
                                PUBLIC_BASE_URL
                        }
                    }
                ]
            }
        );

    /*
    Сохраняем связь внутреннего Bitrix chat
    с Telegram client ID.
    */
    try {
        const item =
            result &&
            result.result &&
            result.result.DATA &&
            result.result.DATA.RESULT &&
            result.result.DATA.RESULT[0];

        if (
            item &&
            item.session &&
            item.session.CHAT_ID
        ) {
            bitrixChatMap.set(
                String(
                    item.session.CHAT_ID
                ),
                String(clientId)
            );
        }
    } catch (e) {
        warn(
            'Bitrix chat mapping warning:',
            e.message
        );
    }

    return result;
}

/* =========================================================
   TELEGRAM CLIENT MESSAGE
========================================================= */

async function processTelegramClientMessage(
    message
) {
    if (
        !message ||
        !message.chat ||
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
        message.from &&
        message.from.first_name
            ? message.from.first_name
            : '';

    client.username =
        message.from &&
        message.from.username
            ? message.from.username
            : '';

    log(
        '========================================'
    );

    log(
        '📨 TELEGRAM CLIENT MESSAGE'
    );

    log(
        'CLIENT:',
        clientId
    );

    log(
        'MODE:',
        client.mode
    );

    log(
        'TEXT:',
        text
    );

    /*
    Полная копия сообщения клиента
    в Telegram администратора.
    */
    await mirrorToAdmin(
        clientId,
        'client',
        text
    );

    /*
    Полная копия сообщения клиента
    в Bitrix Open Line.
    */
    try {
        await sendExternalMessageToBitrix(
            clientId,
            text,
            message.from,
            `tg_${message.message_id}`,
            'client'
        );
    } catch (e) {
        error(
            '❌ TELEGRAM -> BITRIX CONNECTOR ERROR:',
            e.message
        );
    }

    /*
    Если менеджер перехватил диалог,
    AI НЕ отвечает.
    */
    if (
        client.mode === 'MANAGER'
    ) {
        log(
            '⏸ AI SKIPPED: MANAGER MODE'
        );

        return;
    }

    /*
    AI
    */
    try {
        const answer =
            await askDeepSeek(
                clientId,
                text
            );

        log(
            '🤖 DEEPSEEK ANSWER:',
            answer
        );

        /*
        Отвечаем клиенту Telegram.
        */
        await sendTelegramMessage(
            clientId,
            answer
        );

        /*
        Полная копия AI ответа
        администратору Telegram.
        */
        await mirrorToAdmin(
            clientId,
            'ai',
            answer
        );

        /*
        Полная копия AI ответа
        в Bitrix Open Line.
        */
        try {
            await sendExternalMessageToBitrix(
                clientId,
                answer,
                message.from,
                `ai_${Date.now()}`,
                'ai'
            );
        } catch (e) {
            error(
                '❌ AI -> BITRIX CONNECTOR ERROR:',
                e.message
            );
        }
    } catch (e) {
        error(
            '❌ DEEPSEEK ERROR:',
            e.message
        );

        await sendTelegramMessage(
            clientId,
            'Извините, произошла временная ошибка. Менеджер сможет подключиться к диалогу.'
        );

        setClientMode(
            clientId,
            'MANAGER'
        );
    }
}

/* =========================================================
   TELEGRAM ADMIN MESSAGE
========================================================= */

function getClientIdFromAdminReply(
    message
) {
    if (
        !message ||
        !message.reply_to_message
    ) {
        return null;
    }

    const replyId =
        String(
            message.reply_to_message.message_id
        );

    return (
        adminMessageMap.get(
            replyId
        ) || null
    );
}

async function processTelegramAdminMessage(
    message
) {
    if (
        !message ||
        !message.text
    ) {
        return;
    }

    if (
        !ADMIN_CHAT_ID ||
        String(message.chat.id) !==
            String(ADMIN_CHAT_ID)
    ) {
        return;
    }

    const text =
        String(message.text).trim();

    /*
    /ai 123456
    */
    if (
        text.startsWith('/ai ')
    ) {
        const clientId =
            text.slice(4).trim();

        if (clientId) {
            setClientMode(
                clientId,
                'AI'
            );

            await sendTelegramMessage(
                ADMIN_CHAT_ID,
                `🤖 AI снова включён для ${clientId}`
            );
        }

        return;
    }

    /*
    /manager 123456
    */
    if (
        text.startsWith('/manager ')
    ) {
        const clientId =
            text.slice(9).trim();

        if (clientId) {
            setClientMode(
                clientId,
                'MANAGER'
            );

            await sendTelegramMessage(
                ADMIN_CHAT_ID,
                `👤 Менеджер перехватил ${clientId}`
            );
        }

        return;
    }

    /*
    Ответ админа должен быть reply
    на сообщение клиента/AI.
    */
    const clientId =
        getClientIdFromAdminReply(
            message
        );

    if (!clientId) {
        return;
    }

    setClientMode(
        clientId,
        'MANAGER'
    );

    log(
        '👨‍💼 TELEGRAM MANAGER -> CLIENT:',
        clientId
    );

    /*
    Отправляем клиенту.
    */
    await sendTelegramMessage(
        clientId,
        text
    );

    /*
    Копируем сообщение менеджера
    в Bitrix Open Line.
    */
    try {
        await sendExternalMessageToBitrix(
            clientId,
            text,
            {
                first_name:
                    'Менеджер',
                last_name:
                    'Telegram'
            },
            `manager_${Date.now()}`,
            'manager'
        );
    } catch (e) {
        error(
            '❌ TELEGRAM MANAGER -> BITRIX ERROR:',
            e.message
        );
    }

    /*
    Отдельно подтверждаем администратору.
    */
    await sendTelegramMessage(
        ADMIN_CHAT_ID,
        `👤 Сообщение отправлено клиенту ${clientId}. Режим: MANAGER`
    );
}

/* =========================================================
   TELEGRAM CALLBACK BUTTONS
========================================================= */

async function processTelegramCallback(
    callbackQuery
) {
    if (
        !callbackQuery ||
        !callbackQuery.message
    ) {
        return;
    }

    if (
        !ADMIN_CHAT_ID ||
        String(
            callbackQuery.message.chat.id
        ) !==
        String(ADMIN_CHAT_ID)
    ) {
        return;
    }

    const data =
        String(
            callbackQuery.data || ''
        );

    const separator =
        data.indexOf(':');

    if (separator < 0) {
        return;
    }

    const action =
        data.slice(0, separator);

    const clientId =
        data.slice(
            separator + 1
        );

    if (
        !clientId
    ) {
        return;
    }

    if (
        action === 'manager'
    ) {
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
            `👤 MANAGER MODE\nКлиент: ${clientId}`
        );

        return;
    }

    if (
        action === 'ai'
    ) {
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
            `🤖 AI MODE\nКлиент: ${clientId}`
        );

        return;
    }
}

/* =========================================================
   TELEGRAM POLLING
========================================================= */

async function telegramPoll() {
    if (!BOT_TOKEN) {
        warn(
            '⚠️ BOT_TOKEN отсутствует — Telegram отключён.'
        );

        return;
    }

    log(
        '🚀 TELEGRAM LONG POLLING STARTED'
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

                        allowed_updates: [
                            'message',
                            'callback_query'
                        ]
                    }
                );

            if (
                !result ||
                !Array.isArray(
                    result.result
                )
            ) {
                continue;
            }

            for (
                const update of result.result
            ) {
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

                        continue;
                    }

                    if (
                        !update.message
                    ) {
                        continue;
                    }

                    const message =
                        update.message;

                    /*
                    Сообщения администратора
                    */
                    if (
                        ADMIN_CHAT_ID &&
                        String(
                            message.chat.id
                        ) ===
                        String(
                            ADMIN_CHAT_ID
                        )
                    ) {
                        await processTelegramAdminMessage(
                            message
                        );

                        continue;
                    }

                    /*
                    Сообщения клиентов
                    */
                    await processTelegramClientMessage(
                        message
                    );
                } catch (e) {
                    error(
                        '❌ TELEGRAM UPDATE ERROR:',
                        e.message
                    );
                }
            }
        } catch (e) {
            error(
                '❌ TELEGRAM POLLING ERROR:',
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

/* =========================================================
   BITRIX INTERNAL BOT
   ЭТОТ КОНТУР ОСТАВЛЯЕМ РАБОЧИМ.
========================================================= */

async function processBitrixEvent(
    event
) {
    if (
        !event ||
        !event.type
    ) {
        return;
    }

    if (
        event.type !==
        'ONIMBOTV2MESSAGEADD'
    ) {
        return;
    }

    const data =
        event.data || {};

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

    if (!text) {
        return;
    }

    log(
        '========================================'
    );

    log(
        '📦 BITRIX INTERNAL BOT EVENT'
    );

    log(
        'EVENT ID:',
        event.eventId
    );

    log(
        'MESSAGE ID:',
        message.id
    );

    log(
        'CHAT ID:',
        chat.id
    );

    log(
        'USER ID:',
        user.id
    );

    log(
        'TEXT:',
        text
    );

    /*
    Сохраняем старое рабочее поведение:
    сообщение из внутреннего Bitrix-чата
    -> DeepSeek
    -> ответ через imbot.v2
    */
    try {
        const answer =
            await askDeepSeek(
                String(
                    user.id ||
                    chat.id ||
                    'bitrix'
                ),
                text
            );

        await bitrixWebhookCall(
            'imbot.v2.Chat.Message.send',
            {
                BOT_ID:
                    BITRIX_BOT_ID,

                DIALOG_ID:
                    chat.dialogId ||
                    chat.id,

                MESSAGE:
                    answer
            }
        );

        log(
            '🎉 BITRIX INTERNAL BOT ANSWER SENT'
        );
    } catch (e) {
        error(
            '❌ BITRIX INTERNAL BOT ERROR:',
            e.message
        );
    }
}

/* =========================================================
   BITRIX FETCH LOOP
   НЕ ИСПОЛЬЗУЕМ withUserEvents.
========================================================= */

async function bitrixFetchPoll() {
    if (
        !BITRIX_WEBHOOK_URL ||
        !BITRIX_BOT_TOKEN
    ) {
        warn(
            '⚠️ Bitrix internal bot configuration missing.'
        );

        return;
    }

    log(
        '========================================'
    );

    log(
        '🚀 BITRIX FETCH LOOP STARTED'
    );

    while (true) {
        try {
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
                result &&
                result.result;

            const events =
                payload &&
                Array.isArray(
                    payload.events
                )
                    ? payload.events
                    : [];

            const nextOffset =
                payload &&
                typeof payload.nextOffset !==
                    'undefined'
                    ? payload.nextOffset
                    : bitrixOffset;

            const hasMore =
                Boolean(
                    payload &&
                    payload.hasMore
                );

            if (
                events.length > 0
            ) {
                log(
                    '📦 BITRIX FETCH EVENTS:',
                    events.length
                );
            }

            /*
            Обновляем offset ДО обработки,
            чтобы не зациклиться на одном событии.
            */
            bitrixOffset =
                Number(nextOffset);

            for (
                const event of events
            ) {
                try {
                    await processBitrixEvent(
                        event
                    );
                } catch (e) {
                    error(
                        '❌ BITRIX EVENT PROCESS ERROR:',
                        e.message
                    );
                }
            }

            /*
            Если Bitrix говорит hasMore=true,
            сразу забираем следующую страницу.
            */
            if (hasMore) {
                continue;
            }
        } catch (e) {
            error(
                '❌ BITRIX FETCH ERROR:',
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

/* =========================================================
   BITRIX CONNECTOR EVENT
   MANAGER -> TELEGRAM
========================================================= */

function cleanBitrixManagerText(
    text
) {
    if (!text) {
        return '';
    }

    return String(text)
        .replace(
            /\[br\]/gi,
            '\n'
        )
        .replace(
            /\[\/br\]/gi,
            '\n'
        )
        .replace(
            /\[b\]/gi,
            ''
        )
        .replace(
            /\[\/b\]/gi,
            ''
        )
        .replace(
            /\[i\]/gi,
            ''
        )
        .replace(
            /\[\/i\]/gi,
            ''
        )
        .trim();
}

async function processConnectorManagerEvent(
    payload
) {
    const data =
        payload &&
        payload.data;

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

        /*
        Это Telegram ID клиента,
        потому что при отправке в Bitrix
        мы использовали chat.id = Telegram ID.
        */
        const clientId =
            String(
                chat.id || ''
            );

        if (!clientId) {
            continue;
        }

        /*
        Сохраняем Bitrix chat -> Telegram.
        */
        if (
            im.chat_id
        ) {
            bitrixChatMap.set(
                String(im.chat_id),
                clientId
            );
        }

        const managerText =
            cleanBitrixManagerText(
                message.text
            );

        if (!managerText) {
            continue;
        }

        /*
        Специальные команды менеджера:
        #AI — вернуть AI
        #MANAGER — оставить менеджера
        */
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
                '🤖 AI снова подключён к диалогу.'
            );

            await mirrorToAdmin(
                clientId,
                'manager',
                'Команда: AI'
            );

            continue;
        }

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
                '👤 Диалог передан менеджеру.'
            );

            await mirrorToAdmin(
                clientId,
                'manager',
                'Команда: MANAGER'
            );

            continue;
        }

        /*
        Любое нормальное сообщение оператора
        автоматически включает MANAGER.
        */
        setClientMode(
            clientId,
            'MANAGER'
        );

        log(
            '========================================'
        );

        log(
            '👨‍💼 BITRIX MANAGER -> TELEGRAM'
        );

        log(
            'CLIENT:',
            clientId
        );

        log(
            'BITRIX CHAT:',
            im.chat_id
        );

        log(
            'MESSAGE:',
            managerText
        );

        /*
        Отправляем менеджерское сообщение
        клиенту Telegram.
        */
        await sendTelegramMessage(
            clientId,
            managerText
        );

        /*
        Дублируем в Telegram администратора.
        */
        await mirrorToAdmin(
            clientId,
            'manager',
            managerText
        );

        /*
        Подтверждаем Bitrix, что сообщение
        доставлено во внешний канал.
        */
        try {
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
                                        Date.now() / 1000
                                    )
                            },

                            chat: {
                                id:
                                    clientId
                            }
                        }
                    ]
                }
            );
        } catch (e) {
            error(
                '❌ BITRIX DELIVERY STATUS ERROR:',
                e.message
            );
        }
    }
}

/* =========================================================
   INCOMING BITRIX HANDLER PARSER
========================================================= */

function setNestedValue(
    root,
    key,
    value
) {
    /*
    Поддержка:
    auth[access_token]
    data[MESSAGES][0][chat][id]
    */
    const parts = [];

    const regex =
        /([^[\]]+)|\[([^\]]*)\]/g;

    let match;

    while (
        (match = regex.exec(key)) !== null
    ) {
        parts.push(
            match[1] !== undefined
                ? match[1]
                : match[2]
        );
    }

    if (
        parts.length === 0
    ) {
        root[key] = value;
        return;
    }

    let current = root;

    for (
        let i = 0;
        i < parts.length - 1;
        i++
    ) {
        const part =
            parts[i];

        const nextPart =
            parts[i + 1];

        if (
            typeof current[part] !==
            'object' ||
            current[part] === null
        ) {
            current[part] =
                /^\d+$/.test(
                    nextPart
                )
                    ? []
                    : {};
        }

        current =
            current[part];
    }

    const last =
        parts[parts.length - 1];

    current[last] = value;
}

function parseFormEncodedBody(
    body
) {
    const parsed = {};

    const params =
        new URLSearchParams(body);

    for (
        const [key, value]
        of params.entries()
    ) {
        setNestedValue(
            parsed,
            key,
            value
        );
    }

    return parsed;
}

function normalizeBitrixPayload(
    body,
    contentType
) {
    if (!body) {
        return {};
    }

    if (
        contentType &&
        contentType
            .toLowerCase()
            .includes('application/json')
    ) {
        try {
            return JSON.parse(body);
        } catch (e) {
            return {};
        }
    }

    return parseFormEncodedBody(
        body
    );
}

/* =========================================================
   BITRIX HANDLER
========================================================= */

async function handleBitrixRequest(
    req,
    res
) {
    let body = '';

    try {
        body =
            await readRequestBody(req);
    } catch (e) {
        res.statusCode = 400;
        res.end('Bad request');
        return;
    }

    const payload =
        normalizeBitrixPayload(
            body,
            req.headers['content-type'] || ''
        );

    /*
    1. INSTALLATION CALLBACK
    */
    if (
        payload &&
        payload.auth &&
        payload.auth.access_token
    ) {
        const normalized =
            normalizeAuth(
                payload.auth
            );

        if (normalized) {
            saveAuth(normalized);

            log(
                '========================================'
            );

            log(
                '🎉 BITRIX OAUTH RECEIVED'
            );

            log(
                'DOMAIN:',
                normalized.domain
            );

            log(
                'SCOPE:',
                normalized.scope || 'unknown'
            );

            log(
                'ACCESS TOKEN:',
                'SAVED'
            );

            log(
                'REFRESH TOKEN:',
                normalized.refresh_token
                    ? 'SAVED'
                    : 'MISSING'
            );

            log(
                '========================================'
            );

            res.statusCode = 200;

            res.setHeader(
                'Content-Type',
                'application/json'
            );

            res.end(
                JSON.stringify({
                    status:
                        'success'
                })
            );

            /*
            После получения OAuth
            запускаем Connector.
            */
            setImmediate(() => {
                initializeConnector()
                    .catch(e =>
                        error(
                            '❌ CONNECTOR INIT AFTER OAUTH ERROR:',
                            e.message
                        )
                    );
            });

            return;
        }
    }

    /*
    2. CONNECTOR EVENT
    */
    if (
        payload &&
        payload.event ===
            'ONIMCONNECTORMESSAGEADD'
    ) {
        /*
        Отвечаем Bitrix сразу.
        */
        res.statusCode = 200;

        res.setHeader(
            'Content-Type',
            'application/json'
        );

        res.end(
            JSON.stringify({
                status:
                    'success'
            })
        );

        /*
        Обрабатываем после ответа.
        */
        setImmediate(() => {
            processConnectorManagerEvent(
                payload
            ).catch(e =>
                error(
                    '❌ CONNECTOR EVENT PROCESS ERROR:',
                    e.message
                )
            );
        });

        return;
    }

    /*
    3. PLACEMENT / SETTINGS
    */
    if (
        payload &&
        payload.PLACEMENT_OPTIONS
    ) {
        let options =
            payload.PLACEMENT_OPTIONS;

        if (
            typeof options ===
            'string'
        ) {
            try {
                options =
                    JSON.parse(
                        options
                    );
            } catch (e) {
                options = {};
            }
        }

        res.statusCode = 200;

        res.setHeader(
            'Content-Type',
            'text/html; charset=utf-8'
        );

        res.end(`
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>MLK Telegram Connector</title>
<style>
body {
    font-family: Arial, sans-serif;
    padding: 30px;
}
.ok {
    color: green;
}
</style>
</head>
<body>
<h2>MLK Telegram Connector</h2>
<p class="ok">Connector handler работает.</p>
<p>Connector: ${BITRIX_CONNECTOR_ID}</p>
<p>Open Line определяется автоматически.</p>
<p>Эту страницу можно закрыть.</p>
</body>
</html>
        `);

        /*
        Если Bitrix передал LINE,
        активируем именно эту линию.
        */
        if (
            options &&
            options.LINE
        ) {
            bitrixOpenLineId =
                Number(
                    options.LINE
                );

            initializeConnector()
                .catch(e =>
                    error(
                        '❌ CONNECTOR PLACEMENT INIT ERROR:',
                        e.message
                    )
                );
        }

        return;
    }

    /*
    4. GET/обычный запрос
    */
    res.statusCode = 200;

    res.setHeader(
        'Content-Type',
        'text/html; charset=utf-8'
    );

    res.end(`
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>MLK Bot</title>
</head>
<body>
<h2>MLK Bot is running</h2>
<p>Bitrix handler: OK</p>
</body>
</html>
    `);
}

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        async (req, res) => {
            try {
                const url =
                    new URL(
                        req.url,
                        `http://${req.headers.host || 'localhost'}`
                    );

                /*
                Health
                */
                if (
                    url.pathname ===
                    '/health'
                ) {
                    res.statusCode = 200;

                    res.setHeader(
                        'Content-Type',
                        'application/json'
                    );

                    res.end(
                        JSON.stringify({
                            ok: true,
                            telegram:
                                Boolean(
                                    BOT_TOKEN
                                ),
                            bitrix:
                                Boolean(
                                    BITRIX_WEBHOOK_URL
                                ),
                            connector:
                                BITRIX_CONNECTOR_ENABLED,
                            oauth:
                                Boolean(
                                    bitrixAuth &&
                                    bitrixAuth.access_token
                                ),
                            openLine:
                                bitrixOpenLineId
                        })
                    );

                    return;
                }

                /*
                OAuth manual authorization
                */
                if (
                    url.pathname ===
                    '/bitrix/oauth'
                ) {
                    if (
                        !BITRIX_CLIENT_ID
                    ) {
                        res.statusCode = 500;
                        res.end(
                            'BITRIX_CLIENT_ID is missing'
                        );
                        return;
                    }

                    const oauthUrl =
                        new URL(
                            `https://${BITRIX_DOMAIN}/oauth/authorize/`
                        );

                    oauthUrl.searchParams.set(
                        'client_id',
                        BITRIX_CLIENT_ID
                    );

                    res.statusCode = 302;

                    res.setHeader(
                        'Location',
                        oauthUrl.toString()
                    );

                    res.end();

                    return;
                }

                /*
                OAuth callback через code
                */
                if (
                    url.pathname ===
                    '/bitrix/oauth/callback'
                ) {
                    const code =
                        url.searchParams.get(
                            'code'
                        );

                    if (!code) {
                        res.statusCode = 400;
                        res.end(
                            'OAuth code is missing'
                        );
                        return;
                    }

                    try {
                        const params =
                            new URLSearchParams();

                        params.set(
                            'grant_type',
                            'authorization_code'
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
                            'code',
                            code
                        );

                        const auth =
                            await fetchJson(
                                'https://oauth.bitrix.info/oauth/token/',
                                {
                                    method:
                                        'POST',

                                    headers: {
                                        'Content-Type':
                                            'application/x-www-form-urlencoded'
                                    },

                                    body:
                                        params.toString()
                                }
                            );

                        if (
                            !auth ||
                            !auth.access_token
                        ) {
                            throw new Error(
                                'OAuth token response is invalid'
                            );
                        }

                        saveAuth(
                            auth
                        );

                        await initializeConnector();

                        res.statusCode = 200;

                        res.setHeader(
                            'Content-Type',
                            'text/html; charset=utf-8'
                        );

                        res.end(`
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Bitrix OAuth</title>
</head>
<body>
<h2>Готово</h2>
<p>Bitrix OAuth успешно получен.</p>
<p>Connector и Open Line инициализированы.</p>
</body>
</html>
                        `);
                    } catch (e) {
                        error(
                            '❌ OAUTH CALLBACK ERROR:',
                            e.message
                        );

                        res.statusCode = 500;
                        res.end(
                            `OAuth error: ${e.message}`
                        );
                    }

                    return;
                }

                /*
                Главный Bitrix handler.
                */
                if (
                    url.pathname ===
                    new URL(
                        BITRIX_HANDLER_URL,
                        PUBLIC_BASE_URL ||
                            `http://localhost:${PORT}`
                    ).pathname
                ) {
                    await handleBitrixRequest(
                        req,
                        res
                    );

                    return;
                }

                /*
                Если BITRIX_HANDLER_URL содержит
                полный URL, этот fallback позволяет
                работать и с /bitrix/handler.
                */
                if (
                    url.pathname ===
                    '/bitrix/handler'
                ) {
                    await handleBitrixRequest(
                        req,
                        res
                    );

                    return;
                }

                /*
                Root
                */
                if (
                    url.pathname ===
                    '/'
                ) {
                    res.statusCode = 200;

                    res.setHeader(
                        'Content-Type',
                        'text/plain; charset=utf-8'
                    );

                    res.end(
                        'MLK Bot is running'
                    );

                    return;
                }

                res.statusCode = 404;
                res.end('Not found');
            } catch (e) {
                error(
                    'HTTP SERVER ERROR:',
                    e.message
                );

                if (!res.headersSent) {
                    res.statusCode = 500;
                }

                res.end(
                    'Internal server error'
                );
            }
        }
    );

/* =========================================================
   STARTUP
========================================================= */

async function startup() {
    bitrixAuth =
        loadAuth();

    log(
        '========================================'
    );

    log(
        'MLK BOT — FINAL'
    );

    log(
        'BITRIX FETCH + CONNECTOR + OPEN LINE + TELEGRAM + DEEPSEEK'
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
        'BITRIX_BOT_ID:',
        BITRIX_BOT_ID
    );

    log(
        'BITRIX_BOT_CODE:',
        BITRIX_BOT_CODE
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
        'BITRIX_CLIENT_ID:',
        secretStatus(
            BITRIX_CLIENT_ID
        )
    );

    log(
        'BITRIX_CLIENT_SECRET:',
        secretStatus(
            BITRIX_CLIENT_SECRET
        )
    );

    log(
        'BITRIX_DOMAIN:',
        BITRIX_DOMAIN
    );

    log(
        'BITRIX_HANDLER_URL:',
        secretStatus(
            BITRIX_HANDLER_URL
        )
    );

    log(
        'PUBLIC_BASE_URL:',
        secretStatus(
            PUBLIC_BASE_URL
        )
    );

    log(
        'BITRIX_OAUTH:',
        bitrixAuth
            ? 'SAVED'
            : 'NOT INSTALLED'
    );

    log(
        'AUTH STORAGE:',
        AUTH_FILE
    );

    log(
        '========================================'
    );

    /*
    Сервер запускаем всегда.
    Даже если Connector OAuth ещё не установлен,
    старый Bitrix bot и Telegram должны работать.
    */
    server.listen(
        PORT,
        '0.0.0.0',
        () => {
            log(
                '🚀 SERVER STARTED'
            );

            log(
                'PORT:',
                PORT
            );

            log(
                'PUBLIC_BASE_URL:',
                PUBLIC_BASE_URL ||
                    'NOT SET'
            );
        }
    );

    /*
    Старый рабочий Bitrix FETCH.
    */
    bitrixFetchPoll()
        .catch(e =>
            error(
                'BITRIX FETCH LOOP FATAL:',
                e.message
            )
        );

    /*
    Telegram.
    */
    telegramPoll()
        .catch(e =>
            error(
                'TELEGRAM LOOP FATAL:',
                e.message
            )
        );

    /*
    Connector.
    Если OAuth уже есть — запускаем.
    Если нет — НЕ падаем.
    */
    if (
        BITRIX_CONNECTOR_ENABLED
    ) {
        if (
            bitrixAuth &&
            bitrixAuth.access_token
        ) {
            initializeConnector()
                .catch(e =>
                    error(
                        '❌ BITRIX CONNECTOR INIT ERROR:',
                        e.message
                    )
                );
        } else {
            warn(
                '⚠️ BITRIX CONNECTOR: OAuth not installed yet.'
            );

            warn(
                'Install the local Bitrix application so the installation callback sends OAuth tokens.'
            );
        }
    }
}

/* =========================================================
   SHUTDOWN
========================================================= */

function shutdown(signal) {
    log(
        `🛑 ${signal}`
    );

    server.close(() => {
        log(
            '✅ Server closed'
        );

        process.exit(0);
    });

    setTimeout(
        () => process.exit(0),
        5000
    );
}

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

/* =========================================================
   START
========================================================= */

startup().catch(e => {
    error(
        '❌ STARTUP ERROR:',
        e.message
    );

    /*
    Не падаем из-за Connector.
    Это важно: старые рабочие контуры должны
    продолжать работать.
    */
});
```
