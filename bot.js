'use strict';

/*
===========================================================
 MLK BOT
 Telegram + DeepSeek + Bitrix24
 FETCH + Connector + Open Line
 AI <-> MANAGER
===========================================================

 Bitrix local application:

 Handler:
 https://mlk-bot.onrender.com/bitrix/handler

 Initial installation:
 https://mlk-bot.onrender.com/bitrix-webhook

 Основная задача:

 Telegram
    ↓
 Bitrix Open Line
    ↓
 Connector

 И обратно:

 Bitrix Manager
    ↓
 ONIMCONNECTORMESSAGEADD
    ↓
 /bitrix/handler
    ↓
 Telegram client

 Старый внутренний Bitrix FETCH-контур
 остаётся отдельным и не зависит от Connector.
===========================================================
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


// ============================================================
// 1. ENV
// ============================================================

const PORT = Number(
    process.env.PORT || 10000
);


// ------------------------------------------------------------
// TELEGRAM
// ------------------------------------------------------------

const BOT_TOKEN =
    (process.env.BOT_TOKEN || '').trim();

const ADMIN_CHAT_ID =
    (process.env.ADMIN_CHAT_ID || '').trim();


// ------------------------------------------------------------
// DEEPSEEK
// ------------------------------------------------------------

const DEEPSEEK_API_KEY =
    (process.env.DEEPSEEK_API_KEY || '').trim();

const DEEPSEEK_MODEL =
    'deepseek-chat';


// ------------------------------------------------------------
// BITRIX — СТАРЫЙ FETCH
// ------------------------------------------------------------

const BITRIX_WEBHOOK_URL =
    (process.env.BITRIX_WEBHOOK_URL || '').trim();

const BITRIX_BOT_TOKEN =
    (process.env.BITRIX_BOT_TOKEN || '').trim();

const BITRIX_BOT_ID =
    Number(
        process.env.BITRIX_BOT_ID || 1787
    );


// ------------------------------------------------------------
// BITRIX CONNECTOR
// ------------------------------------------------------------

const BITRIX_CONNECTOR_ENABLED =
    String(
        process.env.BITRIX_CONNECTOR_ENABLED ||
        'false'
    ).toLowerCase() === 'true';

const BITRIX_CONNECTOR_ID =
    (
        process.env.BITRIX_CONNECTOR_ID ||
        'mlk_telegram'
    )
        .trim()
        .toLowerCase();

const BITRIX_CONNECTOR_NAME =
    (
        process.env.BITRIX_CONNECTOR_NAME ||
        'MLK Telegram'
    ).trim();

const BITRIX_DOMAIN =
    (
        process.env.BITRIX_DOMAIN ||
        'b24-2fqomj.bitrix24.by'
    ).trim();

const BITRIX_CLIENT_ID =
    (
        process.env.BITRIX_CLIENT_ID ||
        ''
    ).trim();

const BITRIX_CLIENT_SECRET =
    (
        process.env.BITRIX_CLIENT_SECRET ||
        ''
    ).trim();


// ------------------------------------------------------------
// PUBLIC URL
// ------------------------------------------------------------

const PUBLIC_BASE_URL =
    (
        process.env.PUBLIC_BASE_URL ||
        'https://mlk-bot.onrender.com'
    )
        .trim()
        .replace(/\/+$/, '');


// ------------------------------------------------------------
// OPEN LINE
// ------------------------------------------------------------

const BITRIX_OPENLINE_ID =
    Number(
        process.env.BITRIX_OPENLINE_ID || 0
    );


// ------------------------------------------------------------
// URLS
// ------------------------------------------------------------

const BITRIX_HANDLER_URL =
    PUBLIC_BASE_URL +
    '/bitrix/handler';

const BITRIX_INSTALL_URL =
    PUBLIC_BASE_URL +
    '/bitrix-webhook';


// ============================================================
// 2. STORAGE
// ============================================================

const DATA_DIR =
    fs.existsSync('/data')
        ? '/data'
        : '/tmp';

const AUTH_FILE =
    path.join(
        DATA_DIR,
        'bitrix-auth.json'
    );

const OFFSET_FILE =
    path.join(
        DATA_DIR,
        'bitrix-offset.json'
    );

const BITRIX_POLL_INTERVAL_MS =
    3000;


// ============================================================
// 3. LOGGING
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
    return value
        ? 'OK'
        : 'MISSING';
}


// ============================================================
// 4. HTTP HELPERS
// ============================================================

function readRequestBody(req) {

    return new Promise(
        (resolve, reject) => {

            let body = '';

            req.on(
                'data',
                chunk => {

                    body +=
                        chunk.toString();

                    if (
                        body.length >
                        10 * 1024 * 1024
                    ) {

                        reject(
                            new Error(
                                'Request body too large'
                            )
                        );

                        req.destroy();
                    }
                }
            );

            req.on(
                'end',
                () => resolve(body)
            );

            req.on(
                'error',
                reject
            );
        }
    );
}


async function fetchJson(
    url,
    options = {}
) {

    const response =
        await fetch(
            url,
            options
        );

    const text =
        await response.text();

    let data = {};

    try {

        data =
            text
                ? JSON.parse(text)
                : {};

    } catch (e) {

        throw new Error(
            `Invalid JSON response: ${text.slice(
                0,
                1000
            )}`
        );
    }

    if (!response.ok) {

        throw new Error(
            `HTTP ${response.status}: ${JSON.stringify(
                data
            ).slice(0, 1500)}`
        );
    }

    return data;
}


// ============================================================
// 5. AUTH STORAGE
// ============================================================

function ensureDataDir() {

    try {

        fs.mkdirSync(
            DATA_DIR,
            {
                recursive: true
            }
        );

    } catch (e) {
        // ignore
    }
}


function loadAuth() {

    ensureDataDir();

    try {

        if (
            !fs.existsSync(
                AUTH_FILE
            )
        ) {
            return null;
        }

        const raw =
            fs.readFileSync(
                AUTH_FILE,
                'utf8'
            );

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
        JSON.stringify(
            auth,
            null,
            2
        ),
        {
            encoding: 'utf8',
            mode: 0o600
        }
    );
}


let bitrixAuth =
    loadAuth();


// ============================================================
// 6. OLD BITRIX WEBHOOK
// ============================================================

async function bitrixWebhookCall(
    method,
    params = {}
) {

    if (
        !BITRIX_WEBHOOK_URL
    ) {

        throw new Error(
            'BITRIX_WEBHOOK_URL missing'
        );
    }

    const url =
        BITRIX_WEBHOOK_URL
            .replace(/\/+$/, '') +
        '/' +
        method;

    return fetchJson(
        url,
        {
            method: 'POST',

            headers: {
                'Content-Type':
                    'application/json'
            },

            body:
                JSON.stringify(
                    params
                )
        }
    );
}


// ============================================================
// 7. BITRIX OAUTH
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

                body:
                    params.toString()
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

    saveAuth(
        bitrixAuth
    );

    log(
        '✅ Bitrix OAuth refreshed'
    );

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
        auth:
            bitrixAuth.access_token
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

                    body:
                        JSON.stringify(
                            body
                        )
                }
            );

        if (
            data &&
            (
                data.error ===
                    'expired_token' ||
                data.error ===
                    'NO_AUTH_FOUND'
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

    } catch (e) {

        if (
            retry &&
            (
                e.message.includes(
                    'expired_token'
                ) ||
                e.message.includes(
                    'NO_AUTH_FOUND'
                )
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
// 8. TELEGRAM
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

            body:
                JSON.stringify(
                    params
                )
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
            text.slice(
                i,
                i + 4000
            )
        );
    }

    let last = null;

    for (
        const chunk of chunks
    ) {

        last =
            await telegramCall(
                'sendMessage',
                {
                    chat_id:
                        String(chatId),

                    text:
                        chunk,

                    ...extra
                }
            );
    }

    return last;
}


// ============================================================
// TELEGRAM MEDIA -> BITRIX FILES
// ============================================================

async function getTelegramConnectorFiles(message) {

    const result = [];

    if (!message) {
        return result;
    }

    const media = [];

    // PHOTO
    if (
        Array.isArray(message.photo) &&
        message.photo.length
    ) {
        const photo =
            message.photo[
                message.photo.length - 1
            ];

        if (photo?.file_id) {
            media.push({
                file_id: photo.file_id,
                name: 'photo.jpg'
            });
        }
    }

    // DOCUMENT
    if (
        message.document?.file_id
    ) {
        media.push({
            file_id:
                message.document.file_id,

            name:
                message.document.file_name ||
                'document'
        });
    }

    // VIDEO
    if (
        message.video?.file_id
    ) {
        media.push({
            file_id:
                message.video.file_id,

            name:
                message.video.file_name ||
                'video.mp4'
        });
    }

    // AUDIO
    if (
        message.audio?.file_id
    ) {
        media.push({
            file_id:
                message.audio.file_id,

            name:
                message.audio.file_name ||
                'audio.mp3'
        });
    }

    // VOICE
    if (
        message.voice?.file_id
    ) {
        media.push({
            file_id:
                message.voice.file_id,

            name:
                'voice.ogg'
        });
    }

    // ANIMATION / GIF
    if (
        message.animation?.file_id
    ) {
        media.push({
            file_id:
                message.animation.file_id,

            name:
                message.animation.file_name ||
                'animation.gif'
        });
    }

    for (
        const item of media
    ) {

        try {

            const fileInfo =
                await telegramCall(
                    'getFile',
                    {
                        file_id:
                            item.file_id
                    }
                );

            const filePath =
                fileInfo
                    ?.result
                    ?.file_path;

            if (!filePath) {

                warn(
                    '⚠️ Telegram file_path not received:',
                    item.file_id
                );

                continue;
            }

            /*
             Bitrix должен иметь возможность
             скачать файл напрямую.
            */

            const url =
                `${TELEGRAM_API}/file/bot${BOT_TOKEN}/${filePath}`;

            result.push({
                url,
                name: item.name
            });

            log(
                '📎 Telegram file prepared for Bitrix:',
                item.name
            );

        } catch (e) {

            error(
                '❌ Telegram file preparation error:',
                e.message
            );
        }
    }

    return result;
}


// ============================================================
// BITRIX FILE -> TELEGRAM
// ============================================================

async function sendTelegramFile(
    chatId,
    fileUrl,
    fileName = 'file'
) {

    if (!fileUrl) {
        return null;
    }

    const lowerName =
        String(
            fileName
        ).toLowerCase();

    /*
     Изображения отправляем
     как фотографии.
    */

    const imageExtensions = [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.bmp'
    ];

    const isImage =
        imageExtensions.some(
            ext =>
                lowerName.endsWith(
                    ext
                )
        );

    if (isImage) {

        log(
            '📷 Bitrix -> Telegram photo:',
            fileName
        );

        return telegramCall(
            'sendPhoto',
            {
                chat_id:
                    String(chatId),

                photo:
                    fileUrl
            }
        );
    }

    /*
     Видео.
    */

    if (
        lowerName.endsWith('.mp4') ||
        lowerName.endsWith('.mov') ||
        lowerName.endsWith('.m4v')
    ) {

        log(
            '🎥 Bitrix -> Telegram video:',
            fileName
        );

        return telegramCall(
            'sendVideo',
            {
                chat_id:
                    String(chatId),

                video:
                    fileUrl
            }
        );
    }

    /*
     Audio.
    */

    if (
        lowerName.endsWith('.mp3') ||
        lowerName.endsWith('.wav') ||
        lowerName.endsWith('.m4a')
    ) {

        log(
            '🎵 Bitrix -> Telegram audio:',
            fileName
        );

        return telegramCall(
            'sendAudio',
            {
                chat_id:
                    String(chatId),

                audio:
                    fileUrl
            }
        );
    }

    /*
     Всё остальное —
     document.
    */

    log(
        '📎 Bitrix -> Telegram document:',
        fileName
    );

    return telegramCall(
        'sendDocument',
        {
            chat_id:
                String(chatId),

            document:
                fileUrl
        }
    );
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
// 9. DEEPSEEK
// ============================================================

async function askDeepSeek(
    userText
) {

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

                body:
                    JSON.stringify(
                        {
                            model:
                                DEEPSEEK_MODEL,

                            messages: [
                                {
                                    role:
                                        'system',

                                    content:
                                        'Ты ИИ-консультант компании MLK. Отвечай кратко, понятно и по существу.'
                                },

                                {
                                    role:
                                        'user',

                                    content:
                                        userText
                                }
                            ],

                            stream:
                                false,

                            max_tokens:
                                500
                        }
                    )
            }
        );

    const answer =
        data?.choices?.[0]
            ?.message?.content;

    if (!answer) {

        throw new Error(
            'Empty answer from DeepSeek'
        );
    }

    return answer.trim();
}


// ============================================================
// 10. CLIENT STATE
// ============================================================

const clients =
    new Map();

const adminMessageMap =
    new Map();

/*
 Bitrix internal chat_id
      ->
 Telegram client chat_id
*/
const bitrixChatMap =
    new Map();


function getClient(
    clientId
) {

    const key =
        String(clientId);

    if (
        !clients.has(key)
    ) {

        clients.set(
            key,
            {
                mode: 'AI',
                name: '',
                username: '',
                lastSeen:
                    Date.now()
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
// 11. CONNECTOR STATE
// ============================================================

let bitrixOpenLineId =
    BITRIX_OPENLINE_ID || null;

let connectorReady =
    false;

let connectorSetupRunning =
    false;


// ============================================================
// 12. CONNECTOR ICON
// ============================================================

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


// ============================================================
// 13. FIND OPEN LINE
// ============================================================

async function findOpenLine() {

    if (
        BITRIX_OPENLINE_ID
    ) {

        bitrixOpenLineId =
            BITRIX_OPENLINE_ID;

        log(
            '✅ Open Line from ENV:',
            bitrixOpenLineId
        );

        return {
            ID:
                bitrixOpenLineId
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
        !lines.length
    ) {

        throw new Error(
            'No active Bitrix Open Lines found'
        );
    }

    let line =
        lines.find(
            item =>
                String(
                    item.LINE_NAME || ''
                )
                    .toLowerCase()
                    .includes(
                        'telegram'
                    )
        );

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


// ============================================================
// 14. REGISTER CONNECTOR
// ============================================================

async function registerConnector() {

    if (
        !BITRIX_CONNECTOR_ENABLED
    ) {
        return;
    }

    if (
        !bitrixAuth?.access_token
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


// ============================================================
// 15. BIND CONNECTOR EVENT
// ============================================================

async function bindConnectorEvent() {

    if (
        !bitrixAuth?.access_token
    ) {

        throw new Error(
            'OAuth is not installed'
        );
    }

    log(
        '🔔 Binding ONIMCONNECTORMESSAGEADD...'
    );

    try {

        const result =
            await bitrixOAuthCall(
                'event.bind',
                {
                    event:
                        'OnImConnectorMessageAdd',

                    handler:
                        BITRIX_HANDLER_URL
                }
            );

        log(
            '✅ Event bind result:',
            JSON.stringify(result)
        );

        return result;

    } catch (e) {

        /*
         Bitrix возвращает:
         Handler already binded

         Это НЕ ошибка, если обработчик
         уже существует.

         Поэтому продолжаем работу.
        */

        if (
            String(e.message || '')
                .toLowerCase()
                .includes(
                    'handler already binded'
                )
        ) {

            warn(
                '⚠️ ONIMCONNECTORMESSAGEADD already bound — continuing'
            );

            return {
                alreadyBound:
                    true
            };
        }

        throw e;
    }
}


// ============================================================
// 16. ACTIVATE CONNECTOR
// ============================================================

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
        JSON.stringify(
            activateResult
        )
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
        JSON.stringify(
            dataResult
        )
    );

    return true;
}


// ============================================================
// 17. CONNECTOR STATUS
// ============================================================

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


// ============================================================
// 18. SETUP CONNECTOR
// ============================================================

async function setupConnector() {

    if (
        !BITRIX_CONNECTOR_ENABLED
    ) {
        return;
    }

    if (
        connectorSetupRunning
    ) {
        return;
    }

    if (
        connectorReady
    ) {
        return;
    }

    if (
        !bitrixAuth?.access_token
    ) {

        warn(
            '⚠️ Connector waiting for Bitrix installation OAuth'
        );

        return;
    }

    connectorSetupRunning =
        true;

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

        await registerConnector();

        /*
         Не падаем из-за повторного event.bind.
        */
        await bindConnectorEvent();

        await findOpenLine();

        await activateConnector(
            bitrixOpenLineId
        );

        await connectorStatus(
            bitrixOpenLineId
        );

        connectorReady =
            true;

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

        connectorReady =
            false;

        error(
            '❌ Connector setup error:',
            e.message
        );

    } finally {

        connectorSetupRunning =
            false;
    }
}


// ============================================================
// 19. TELEGRAM -> BITRIX CONNECTOR (ИСПРАВЛЕННАЯ ВЕРСИЯ)
// ============================================================

async function sendToBitrixConnector(
    clientId,
    text,
    senderType = 'client',
    telegramUser = null,
    files = []
) {
    if (!BITRIX_CONNECTOR_ENABLED) {
        return null;
    }

    /*
     * ----------------------------------------------------------
     * OAUTH
     * ----------------------------------------------------------
     */

    if (!bitrixAuth?.access_token) {
        warn(
            '⚠️ Connector OAuth unavailable — trying connector setup'
        );

        try {
            await setupConnector();
        } catch (e) {
            warn(
                '⚠️ Connector setup retry failed:',
                e.message
            );
        }
    }

    if (!bitrixAuth?.access_token) {
        warn(
            '⚠️ Connector OAuth still unavailable'
        );

        return null;
    }

    /*
     * ----------------------------------------------------------
     * OPEN LINE
     * ----------------------------------------------------------
     */

    if (!bitrixOpenLineId) {
        try {
            await findOpenLine();
        } catch (e) {
            error(
                '❌ Unable to find Bitrix Open Line:',
                e.message
            );

            return null;
        }
    }

    if (!bitrixOpenLineId) {
        error(
            '❌ Bitrix Open Line ID is empty'
        );

        return null;
    }

    /*
     * ----------------------------------------------------------
     * TEXT
     * ----------------------------------------------------------
     */

    let messageText =
        text !== undefined &&
        text !== null
            ? String(text).trim()
            : '';

    /*
     * ----------------------------------------------------------
     * FILES
     *
     * Bitrix connector does not reliably accept:
     *
     * text: ''
     * files: [...]
     *
     * Поэтому для сообщения, состоящего только из файла,
     * добавляем технический текст.
     *
     * Клиент его увидит в Open Line как сообщение
     * с вложением, а сам файл будет прикреплён отдельно.
     * ----------------------------------------------------------
     */

    const normalizedFiles =
        Array.isArray(files)
            ? files
                .filter(
                    file =>
                        file &&
                        file.url
                )
                .map(
                    file => ({
                        url:
                            String(
                                file.url
                            ),

                        name:
                            String(
                                file.name ||
                                'file'
                            )
                    })
                )
            : [];

    if (
        !messageText &&
        normalizedFiles.length
    ) {
        messageText =
            '📎 Вложение из Telegram';
    }

    /*
     * ----------------------------------------------------------
     * EMPTY MESSAGE
     * ----------------------------------------------------------
     */

    if (
        !messageText &&
        !normalizedFiles.length
    ) {
        warn(
            '⚠️ Bitrix message skipped: no text and no files'
        );

        return null;
    }

    /*
     * ----------------------------------------------------------
     * USER
     * ----------------------------------------------------------
     */

    const user = {
        id:
            String(clientId),

        name:
            telegramUser?.first_name
                ? String(
                    telegramUser.first_name
                )
                : 'Telegram user'
    };

    if (
        telegramUser?.last_name
    ) {
        user.last_name =
            String(
                telegramUser.last_name
            );
    }

    if (
        telegramUser?.username
    ) {
        user.url =
            `https://t.me/${telegramUser.username}`;
    }

    /*
     * ----------------------------------------------------------
     * MESSAGE
     * ----------------------------------------------------------
     */

    const message = {
        id:
            `tg-${clientId}-${Date.now()}-${crypto
                .randomBytes(4)
                .toString('hex')}`,

        date:
            Math.floor(
                Date.now() / 1000
            ),

        text:
            messageText
    };

    /*
     * Файлы добавляем только если они реально есть.
     */

    if (
        normalizedFiles.length
    ) {
        message.files =
            normalizedFiles;
    }

    /*
     * ----------------------------------------------------------
     * DIAGNOSTICS
     * ----------------------------------------------------------
     */

    log(
        '📤 SEND TO BITRIX:',
        JSON.stringify({
            clientId:
                String(clientId),

            senderType,

            text:
                messageText,

            files:
                normalizedFiles.length,

            fileNames:
                normalizedFiles.map(
                    file =>
                        file.name
                )
        })
    );

    /*
     * ----------------------------------------------------------
     * SEND
     * ----------------------------------------------------------
     */

    try {
        const result =
            await bitrixOAuthCall(
                'imconnector.send.messages',
                {
                    CONNECTOR:
                        BITRIX_CONNECTOR_ID,

                    LINE:
                        Number(
                            bitrixOpenLineId
                        ),

                    MESSAGES: [
                        {
                            user,

                            message,

                            chat: {
                                id:
                                    String(
                                        clientId
                                    ),

                                url:
                                    telegramUser?.username
                                        ? `https://t.me/${telegramUser.username}`
                                        : 'https://t.me/'
                            }
                        }
                    ]
                }
            );

        /*
         * ------------------------------------------------------
         * BITRIX CHAT MAP
         * ------------------------------------------------------
         */

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

                    String(
                        clientId
                    )
                );

                log(
                    '🗺️ Bitrix chat map:',
                    String(
                        item.session.CHAT_ID
                    ),
                    '=>',
                    String(
                        clientId
                    )
                );
            }

        } catch (e) {
            warn(
                '⚠️ Bitrix chat mapping error:',
                e.message
            );
        }

        /*
         * ------------------------------------------------------
         * CHECK RESULT
         * ------------------------------------------------------
         */

        const resultItem =
            result
                ?.result
                ?.DATA
                ?.RESULT
                ?.[0];

        if (
            resultItem &&
            resultItem.SUCCESS === false
        ) {
            error(
                '❌ BITRIX DELIVERY FAILED:',
                JSON.stringify(
                    resultItem.ERRORS ||
                    resultItem
                )
            );

            return result;
        }

        /*
         * ------------------------------------------------------
         * SUCCESS
         * ------------------------------------------------------
         */

        log(
            '✅ BITRIX DELIVERY CONFIRMED'
        );

        if (
            normalizedFiles.length
        ) {
            log(
                '📎 Files sent to Bitrix:',
                normalizedFiles.length
            );

            normalizedFiles.forEach(
                file => {
                    log(
                        '   📎',
                        file.name,
                        '→',
                        file.url
                    );
                }
            );
        }

        return result;

    } catch (e) {

        error(
            '❌ SEND TO BITRIX ERROR:',
            e.message
        );

        /*
         * Если OAuth протух —
         * заставляем следующий запрос
         * повторить авторизацию.
         */

        if (
            /oauth|auth|token|access/i.test(
                String(
                    e.message || ''
                )
            )
        ) {
            warn(
                '⚠️ Bitrix OAuth appears unavailable'
            );

            if (
                bitrixAuth
            ) {
                bitrixAuth.access_token =
                    null;
            }
        }

        return null;
    }
}


// ============================================================
// 20. TELEGRAM -> ADMIN
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

        if (
            msg?.message_id
        ) {

            adminMessageMap.set(
                String(
                    msg.message_id
                ),

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
// 21. TELEGRAM CLIENT MESSAGE (ОБНОВЛЕНО)
// ============================================================

async function processTelegramClientMessage(
    message
) {

    if (
        !message?.chat?.id
    ) {
        return;
    }

    const clientId =
        String(
            message.chat.id
        );

    const text =
        String(
            message.text ||
            message.caption ||
            ''
        ).trim();

    const files =
        await getTelegramConnectorFiles(
            message
        );

    const hasMedia =
        Array.isArray(files) &&
        files.length > 0;

    /*
     Нет ни текста, ни файла —
     ничего обрабатывать.
    */

    if (
        !text &&
        !hasMedia
    ) {
        return;
    }

    const client =
        getClient(clientId);

    client.name =
        message.from?.first_name ||
        '';

    client.username =
        message.from?.username ||
        '';

    log(
        `📨 Client ${clientId}: ${
            text ||
            '[MEDIA]'
        }`
    );

    if (hasMedia) {

        log(
            '📎 Telegram media count:',
            files.length
        );
    }

    /*
     ------------------------------------------------------------
     TELEGRAM -> ADMIN
     ------------------------------------------------------------
    */

    if (text) {

        await mirrorToAdmin(
            clientId,
            'client',
            text
        );
    }

    /*
     ------------------------------------------------------------
     TELEGRAM -> BITRIX
     ------------------------------------------------------------
    */

    try {

        await sendToBitrixConnector(
            clientId,
            text,
            'client',
            message.from,
            files
        );

    } catch (e) {

        error(
            'Telegram -> Bitrix error:',
            e.message
        );
    }

    /*
     ------------------------------------------------------------
     MANAGER MODE
     ------------------------------------------------------------
    */

    if (
        client.mode ===
        'MANAGER'
    ) {

        log(
            '⏸ AI skipped: MANAGER mode'
        );

        return;
    }

    /*
     ------------------------------------------------------------
     Если пришёл только файл —
     AI не пытаемся заставлять анализировать
     файл как текст.
     ------------------------------------------------------------
    */

    if (!text) {

        log(
            '⏸ AI skipped: media without text'
        );

        return;
    }

    /*
     ------------------------------------------------------------
     AI
     ------------------------------------------------------------
    */

    try {

        const answer =
            await askDeepSeek(
                text
            );

        await sendTelegramMessage(
            clientId,
            answer
        );

        await mirrorToAdmin(
            clientId,
            'ai',
            answer
        );

        try {

            await sendToBitrixConnector(
                clientId,
                answer,
                'ai',
                message.from,
                []
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

        try {

            await sendTelegramMessage(
                clientId,
                'Извините, произошла ошибка. Сейчас подключу менеджера.'
            );

        } catch (telegramError) {

            error(
                'Telegram fallback error:',
                telegramError.message
            );
        }

        setClientMode(
            clientId,
            'MANAGER'
        );
    }
}


// ============================================================
// 22. TELEGRAM ADMIN MESSAGE
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
        String(
            message.text || ''
        ).trim();

    if (!text) {
        return;
    }

    /*
     /ai CLIENT_ID
    */

    if (
        text.startsWith('/ai ')
    ) {

        const clientId =
            text
                .slice(4)
                .trim();

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

    /*
     /manager CLIENT_ID
    */

    if (
        text.startsWith('/manager ')
    ) {

        const clientId =
            text
                .slice(9)
                .trim();

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

    /*
     Reply на сообщение клиента
    */

    const replyId =
        message
            .reply_to_message
            ?.message_id;

    let clientId =
        null;

    if (replyId) {

        clientId =
            adminMessageMap.get(
                String(replyId)
            ) || null;
    }

    if (!clientId) {
        return;
    }

    setClientMode(
        clientId,
        'MANAGER'
    );

    await sendTelegramMessage(
        clientId,
        text
    );

    try {

        await sendToBitrixConnector(
            clientId,
            text,
            'manager',
            {
                first_name:
                    'Менеджер'
            },
            []
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
// 23. TELEGRAM CALLBACK
// ============================================================

async function processTelegramCallback(
    callbackQuery
) {

    if (
        !callbackQuery?.data
    ) {
        return;
    }

    if (
        !ADMIN_CHAT_ID ||
        String(
            callbackQuery.message?.chat?.id
        ) !==
            String(ADMIN_CHAT_ID)
    ) {
        return;
    }

    const parts =
        callbackQuery.data.split(':');

    const action =
        parts[0];

    const clientId =
        parts
            .slice(1)
            .join(':');

    if (!clientId) {
        return;
    }

    if (
        action ===
        'manager'
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
            `👤 MANAGER для ${clientId}`
        );

    } else if (
        action ===
        'ai'
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
            `🤖 AI для ${clientId}`
        );
    }
}


// ============================================================
// 24. TELEGRAM POLLING
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

                        allowed_updates: [
                            'message',
                            'callback_query'
                        ]
                    }
                );

            const updates =
                result?.result || [];

            for (
                const update of updates
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

                    } else if (
                        update.message
                    ) {

                        const msg =
                            update.message;

                        if (
                            ADMIN_CHAT_ID &&
                            String(
                                msg.chat.id
                            ) ===
                                String(
                                    ADMIN_CHAT_ID
                                )
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
// 25. BITRIX FETCH
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
                Number(
                    data.offset || 0
                );
        }

    } catch (e) {

        error(
            'Offset load error:',
            e.message
        );
    }
}


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


loadBitrixOffset();


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
             Старый рабочий FETCH-контур.
             Не зависит от Connector/OAuth.
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
                Array.isArray(
                    payload.events
                )
                    ? payload.events
                    : [];

            const nextOffset =
                payload.nextOffset ??
                bitrixOffset;

            if (
                events.length
            ) {

                log(
                    `📦 Bitrix events: ${events.length}`
                );
            }

            bitrixOffset =
                Number(
                    nextOffset
                );

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
// 26. FORM-URLENCODED BITRIX PARSER
//
// Это КЛЮЧЕВОЙ блок.
//
// Bitrix присылает:
//
// data[CONNECTOR]=mlk_telegram
// data[LINE]=11
// data[MESSAGES][0][im][chat_id]=1893
// data[MESSAGES][0][message][text]=Привет
// data[MESSAGES][0][chat][id]=1018137139
//
// Мы превращаем это в:
//
// {
//   data: {
//     CONNECTOR: "mlk_telegram",
//     LINE: "11",
//     MESSAGES: [
//       {
//         im: {
//           chat_id: "1893"
//         },
//         message: {
//           text: "Привет"
//         },
//         chat: {
//           id: "1018137139"
//         }
//       }
//     ]
//   }
// }
// ============================================================

function setNestedValue(
    target,
    key,
    value
) {

    const parts =
        String(key)
            .replace(
                /\[([^\]]*)\]/g,
                '.$1'
            )
            .split('.')
            .filter(Boolean);

    if (
        !parts.length
    ) {
        return;
    }

    let current =
        target;

    for (
        let i = 0;
        i < parts.length - 1;
        i++
    ) {

        const part =
            parts[i];

        const next =
            parts[i + 1];

        if (
            current[part] === undefined ||
            current[part] === null ||
            typeof current[part] !==
                'object'
        ) {

            current[part] =
                /^\d+$/.test(next)
                    ? []
                    : {};
        }

        current =
            current[part];
    }

    current[
        parts[parts.length - 1]
    ] = value;
}


function parseBitrixFormBody(
    body
) {

    const payload = {};

    const params =
        new URLSearchParams(
            body
        );

    for (
        const [key, value]
        of params.entries()
    ) {

        setNestedValue(
            payload,
            key,
            value
        );
    }

    return payload;
}


// ============================================================
// 27. NORMALIZE CONNECTOR PAYLOAD
//
// Дополнительная защита:
//
// Если Bitrix когда-нибудь снова пришлёт
// плоские data[...] ключи,
// мы восстановим структуру вручную.
// ============================================================

function normalizeConnectorPayload(
    payload
) {

    if (
        payload &&
        payload.data &&
        typeof payload.data ===
            'object'
    ) {

        return payload;
    }

    const normalized = {
        ...payload,
        data: {}
    };

    const flatKeys =
        Object.keys(
            payload || {}
        );

    for (
        const key of flatKeys
    ) {

        if (
            !key.startsWith(
                'data['
            )
        ) {
            continue;
        }

        setNestedValue(
            normalized,
            key,
            payload[key]
        );
    }

    return normalized;
}


// ============================================================
// 28. CONNECTOR DELIVERY
// ============================================================

async function confirmConnectorDelivery(
    data,
    item
) {

    try {

        const im =
            item?.im || {};

        const message =
            item?.message || {};

        if (
            !im.chat_id ||
            !im.message_id
        ) {

            warn(
                '⚠️ Delivery confirmation skipped: missing im.chat_id or im.message_id'
            );

            return;
        }

        const line =
            Number(
                data?.LINE ||
                bitrixOpenLineId ||
                0
            );

        if (!line) {

            warn(
                '⚠️ Delivery confirmation skipped: LINE missing'
            );

            return;
        }

        await bitrixOAuthCall(
            'imconnector.send.status.delivery',
            {
                CONNECTOR:
                    BITRIX_CONNECTOR_ID,

                LINE:
                    line,

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
                                    item?.chat?.id ||
                                    ''
                                )
                        }
                    }
                ]
            }
        );

        log(
            '✅ BITRIX DELIVERY CONFIRMED'
        );

    } catch (e) {

        error(
            'Connector delivery error:',
            e.message
        );
    }
}


// ============================================================
// 29. BITRIX -> TELEGRAM (ОБНОВЛЕНО: ДОБАВЛЕНА ОБРАБОТКА ФАЙЛОВ)
//
// Это основной исправленный обработчик.
//
// Вход:
// ONIMCONNECTORMESSAGEADD
//
// Важное поле:
//
// data.MESSAGES[0].chat.id
//
// В твоём реальном payload:
//
// data[MESSAGES][0][chat][id] = 1018137139
//
// Это и есть Telegram chat_id клиента.
// ============================================================

async function processConnectorManagerEvent(
    payload
) {

    try {

        console.log(
            '========================================'
        );

        console.log(
            '📥 BITRIX OUTBOUND EVENT'
        );

        console.log(
            'EVENT:',
            payload?.event || ''
        );

        console.log(
            'EVENT HANDLER ID:',
            payload?.event_handler_id ||
                ''
        );

        const data =
            payload?.data || {};

        console.log(
            'CONNECTOR:',
            data.CONNECTOR ||
                '(EMPTY)'
        );

        console.log(
            'LINE:',
            data.LINE ||
                '(EMPTY)'
        );

        const messages =
            Array.isArray(
                data.MESSAGES
            )
                ? data.MESSAGES
                : [];

        console.log(
            'MESSAGES COUNT:',
            messages.length
        );

        /*
         -------------------------------------------------------
         Если Bitrix прислал неструктурированный payload,
         показываем его, но не падаем.
         -------------------------------------------------------
        */

        if (
            !messages.length
        ) {

            console.log(
                '❌ No messages in normalized Bitrix event'
            );

            console.log(
                'FULL NORMALIZED PAYLOAD:',
                JSON.stringify(
                    payload
                )
            );

            console.log(
                '========================================'
            );

            return;
        }


        /*
         -------------------------------------------------------
         Проверяем Connector
         -------------------------------------------------------
        */

        const connector =
            String(
                data.CONNECTOR ||
                ''
            ).trim();

        if (
            connector &&
            connector.toLowerCase() !==
                String(
                    BITRIX_CONNECTOR_ID
                ).toLowerCase()
        ) {

            warn(
                '⚠️ Ignored connector:',
                connector
            );

            warn(
                'Expected connector:',
                BITRIX_CONNECTOR_ID
            );

            return;
        }


        /*
         -------------------------------------------------------
         Обрабатываем сообщения
         -------------------------------------------------------
        */

        for (
            let index = 0;
            index < messages.length;
            index++
        ) {

            const item =
                messages[index] ||
                {};

            const im =
                item.im || {};

            const message =
                item.message || {};

            const chat =
                item.chat || {};


            /*
             Telegram chat.id.
             В твоём payload это:

             1018137139
            */

            const externalChatId =
                String(
                    chat.id ||
                    ''
                ).trim();


            /*
             Внутренний Bitrix chat_id.
            */

            const bitrixChatId =
                String(
                    im.chat_id ||
                    ''
                ).trim();


            /*
             Если внешний chat.id отсутствует,
             используем ранее сохранённое соответствие.
            */

            const mappedTelegramChatId =
                bitrixChatId
                    ? String(
                        bitrixChatMap.get(
                            bitrixChatId
                        ) || ''
                    ).trim()
                    : '';


            const telegramChatId =
                externalChatId ||
                mappedTelegramChatId;


            const bitrixMessageId =
                String(
                    im.message_id ||
                    ''
                ).trim();


            const managerText =
                String(
                    message.text ||
                    ''
                ).trim();

            const managerFiles =
                Array.isArray(
                    message.files
                )
                    ? message.files
                    : [];


            console.log(
                '----------------------------------------'
            );

            console.log(
                `📨 BITRIX MESSAGE ${index + 1}`
            );

            console.log(
                'External Telegram chat.id:',
                externalChatId ||
                    '(EMPTY)'
            );

            console.log(
                'Bitrix im.chat_id:',
                bitrixChatId ||
                    '(EMPTY)'
            );

            console.log(
                'Mapped Telegram chat_id:',
                mappedTelegramChatId ||
                    '(EMPTY)'
            );

            console.log(
                'Final Telegram chat_id:',
                telegramChatId ||
                    '(EMPTY)'
            );

            console.log(
                'Bitrix im.message_id:',
                bitrixMessageId ||
                    '(EMPTY)'
            );

            console.log(
                'Message user_id:',
                message.user_id ||
                    '(EMPTY)'
            );

            console.log(
                'Manager text:',
                managerText ||
                    '(EMPTY)'
            );

            console.log(
                'Manager files:',
                managerFiles.length ||
                    '(EMPTY)'
            );

            console.log(
                'RAW MESSAGE:',
                JSON.stringify(
                    item
                )
            );


            /*
             ---------------------------------------------------
             Без Telegram chat_id отправлять некуда.
             ---------------------------------------------------
            */

            if (
                !telegramChatId
            ) {

                error(
                    '❌ Telegram chat_id could not be resolved'
                );

                error(
                    'Bitrix chat_id:',
                    bitrixChatId ||
                        '(EMPTY)'
                );

                continue;
            }


            /*
             ---------------------------------------------------
             Без текста и без файлов — нечего отправлять.
             ---------------------------------------------------
            */

            if (
                !managerText &&
                !managerFiles.length
            ) {

                warn(
                    '⚠️ Manager message has no text and no files'
                );

                continue;
            }


            /*
             ---------------------------------------------------
             Сохраняем mapping.
             ---------------------------------------------------
            */

            if (
                bitrixChatId
            ) {

                bitrixChatMap.set(
                    bitrixChatId,
                    telegramChatId
                );

                console.log(
                    '🗺️ Bitrix chat map:',
                    bitrixChatId,
                    '=>',
                    telegramChatId
                );
            }


            /*
             ---------------------------------------------------
             Команда #AI
             ---------------------------------------------------
            */

            if (
                managerText === '#AI' ||
                managerText === '/ai'
            ) {

                setClientMode(
                    telegramChatId,
                    'AI'
                );

                console.log(
                    '🤖 Switching client to AI:',
                    telegramChatId
                );

                try {

                    await sendTelegramMessage(
                        telegramChatId,
                        '🤖 AI подключён'
                    );

                } catch (e) {

                    error(
                        '❌ AI mode Telegram error:',
                        e.message
                    );
                }

                await confirmConnectorDelivery(
                    data,
                    item
                );

                continue;
            }


            /*
             ---------------------------------------------------
             Команда #MANAGER
             ---------------------------------------------------
            */

            if (
                managerText === '#MANAGER' ||
                managerText === '/manager'
            ) {

                setClientMode(
                    telegramChatId,
                    'MANAGER'
                );

                console.log(
                    '👤 Switching client to MANAGER:',
                    telegramChatId
                );

                try {

                    await sendTelegramMessage(
                        telegramChatId,
                        '👤 Диалог передан менеджеру'
                    );

                } catch (e) {

                    error(
                        '❌ MANAGER mode Telegram error:',
                        e.message
                    );
                }

                await confirmConnectorDelivery(
                    data,
                    item
                );

                continue;
            }


            /*
             ===================================================
             ОБЫЧНЫЙ ОТВЕТ МЕНЕДЖЕРА (ТЕКСТ + ФАЙЛЫ)
             ===================================================
            */

            setClientMode(
                telegramChatId,
                'MANAGER'
            );

            console.log(
                '👤 Manager reply detected'
            );

            console.log(
                '📤 TRY TELEGRAM SEND'
            );

            console.log(
                'Telegram chat_id:',
                telegramChatId
            );

            console.log(
                'Telegram text:',
                managerText
            );

            console.log(
                'Telegram files:',
                managerFiles.length
            );


            // -------------------------------------------------------
            // Bitrix -> Telegram: TEXT
            // -------------------------------------------------------

            if (managerText) {

                await sendTelegramMessage(
                    telegramChatId,
                    managerText
                );
            }


            // -------------------------------------------------------
            // Bitrix -> Telegram: FILES
            // -------------------------------------------------------

            if (
                managerFiles.length
            ) {

                log(
                    '📎 Bitrix files:',
                    managerFiles.length
                );

                for (
                    const file of managerFiles
                ) {

                    try {

                        const fileUrl =
                            String(
                                file?.url ||
                                file?.link ||
                                ''
                            ).trim();

                        const fileName =
                            String(
                                file?.name ||
                                'file'
                            ).trim();

                        if (!fileUrl) {

                            warn(
                                '⚠️ Bitrix file has no URL:',
                                fileName
                            );

                            continue;
                        }

                        await sendTelegramFile(
                            telegramChatId,
                            fileUrl,
                            fileName
                        );

                    } catch (e) {

                        error(
                            '❌ Bitrix -> Telegram file error:',
                            e.message
                        );
                    }
                }
            }


            /*
             ---------------------------------------------------
             ADMIN MIRROR
             ---------------------------------------------------
            */

            try {

                await mirrorToAdmin(
                    telegramChatId,
                    'manager',
                    managerText ||
                        '[файл]'
                );

                console.log(
                    '✅ Admin mirror OK'
                );

            } catch (e) {

                console.error(
                    '⚠️ Admin mirror error:',
                    e.message
                );
            }


            /*
             ---------------------------------------------------
             DELIVERY CONFIRMATION
             ---------------------------------------------------
            */

            try {

                await confirmConnectorDelivery(
                    data,
                    item
                );

            } catch (e) {

                console.error(
                    '❌ Delivery confirm error:',
                    e.message
                );
            }


            console.log(
                'Telegram sent:',
                true
            );
        }


        console.log(
            '========================================'
        );

    } catch (e) {

        console.error(
            '❌ Connector event processing ERROR:',
            e.message
        );

        if (e.stack) {

            console.error(
                e.stack
            );
        }

        console.error(
            'PAYLOAD:',
            JSON.stringify(
                payload
            )
        );

        console.log(
            '========================================'
        );
    }
}


// ============================================================
// 30. HTTP SERVER
// ============================================================

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            try {

                const url =
                    new URL(
                        req.url,
                        `http://${
                            req.headers.host ||
                            'localhost'
                        }`
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
                                ok:
                                    true,

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
                // BITRIX INSTALLATION CALLBACK
                // ==================================================

                if (
                    url.pathname ===
                    '/bitrix-webhook'
                ) {

                    /*
                     GET
                    */

                    if (
                        req.method !==
                        'POST'
                    ) {

                        res.writeHead(
                            200,
                            {
                                'Content-Type':
                                    'text/plain; charset=utf-8'
                            }
                        );

                        res.end(
                            'Bitrix installation endpoint is ready'
                        );

                        return;
                    }


                    /*
                     READ BODY
                    */

                    let body = '';

                    try {

                        body =
                            await readRequestBody(
                                req
                            );

                    } catch (e) {

                        error(
                            '❌ Bitrix installation body read error:',
                            e.message
                        );

                        res.writeHead(
                            500,
                            {
                                'Content-Type':
                                    'application/json'
                            }
                        );

                        res.end(
                            JSON.stringify(
                                {
                                    status:
                                        'error',

                                    message:
                                        'Unable to read request body'
                                }
                            )
                        );

                        return;
                    }


                    /*
                     PARSE
                    */

                    let payload =
                        {};

                    let auth =
                        {};

                    const contentType =
                        String(
                            req.headers[
                                'content-type'
                            ] || ''
                        ).toLowerCase();


                    try {

                        if (
                            contentType.includes(
                                'application/json'
                            )
                        ) {

                            payload =
                                body
                                    ? JSON.parse(
                                        body
                                    )
                                    : {};

                        } else {

                            payload =
                                parseBitrixFormBody(
                                    body
                                );
                        }


                        /*
                         auth может прийти
                         как объект.
                        */

                        if (
                            payload.auth &&
                            typeof payload.auth ===
                                'object'
                        ) {

                            auth = {
                                ...payload.auth
                            };
                        }


                        /*
                         auth может прийти
                         как JSON string.
                        */

                        if (
                            typeof payload.auth ===
                                'string'
                        ) {

                            try {

                                const parsedAuth =
                                    JSON.parse(
                                        payload.auth
                                    );

                                if (
                                    parsedAuth &&
                                    typeof parsedAuth ===
                                        'object'
                                ) {

                                    auth = {
                                        ...auth,
                                        ...parsedAuth
                                    };
                                }

                            } catch (e) {
                                // normal
                            }
                        }


                        /*
                         Дополнительный
                         fallback.
                        */

                        if (
                            payload.access_token &&
                            !auth.access_token
                        ) {

                            auth.access_token =
                                payload.access_token;
                        }

                        if (
                            payload.refresh_token &&
                            !auth.refresh_token
                        ) {

                            auth.refresh_token =
                                payload.refresh_token;
                        }

                        if (
                            payload.domain &&
                            !auth.domain
                        ) {

                            auth.domain =
                                payload.domain;
                        }

                        if (
                            payload.client_endpoint &&
                            !auth.client_endpoint
                        ) {

                            auth.client_endpoint =
                                payload.client_endpoint;
                        }

                    } catch (e) {

                        error(
                            '❌ Bitrix installation request parse error:',
                            e.message
                        );

                        res.writeHead(
                            400,
                            {
                                'Content-Type':
                                    'application/json'
                            }
                        );

                        res.end(
                            JSON.stringify(
                                {
                                    status:
                                        'error',

                                    message:
                                        'Invalid Bitrix installation request'
                                }
                            )
                        );

                        return;
                    }


                    /*
                     DIAGNOSTICS
                    */

                    log(
                        '========================================'
                    );

                    log(
                        '📥 BITRIX INSTALL CALLBACK'
                    );

                    log(
                        'CONTENT-TYPE:',
                        contentType ||
                            'unknown'
                    );

                    log(
                        'BODY LENGTH:',
                        body.length
                    );

                    log(
                        'AUTH ACCESS:',
                        auth.access_token
                            ? 'PRESENT'
                            : 'MISSING'
                    );

                    log(
                        'AUTH REFRESH:',
                        auth.refresh_token
                            ? 'PRESENT'
                            : 'MISSING'
                    );

                    log(
                        'AUTH DOMAIN:',
                        auth.domain ||
                            'MISSING'
                    );

                    log(
                        'AUTH CLIENT ENDPOINT:',
                        auth.client_endpoint
                            ? 'PRESENT'
                            : 'MISSING'
                    );

                    log(
                        '========================================'
                    );


                    /*
                     SAVE OAUTH
                    */

                    if (
                        auth.access_token &&
                        auth.refresh_token
                    ) {

                        bitrixAuth = {
                            ...auth
                        };

                        if (
                            !bitrixAuth.domain
                        ) {

                            bitrixAuth.domain =
                                BITRIX_DOMAIN;
                        }

                        if (
                            !bitrixAuth.client_endpoint &&
                            bitrixAuth.domain
                        ) {

                            bitrixAuth.client_endpoint =
                                `https://${bitrixAuth.domain}/rest/`;
                        }


                        try {

                            saveAuth(
                                bitrixAuth
                            );

                            log(
                                '✅ OAuth tokens received and saved'
                            );

                        } catch (e) {

                            error(
                                '❌ OAuth save error:',
                                e.message
                            );

                            res.writeHead(
                                500,
                                {
                                    'Content-Type':
                                        'application/json'
                                }
                            );

                            res.end(
                                JSON.stringify(
                                    {
                                        status:
                                            'error',

                                        message:
                                            'OAuth received but could not be saved'
                                    }
                                )
                            );

                            return;
                        }


                        /*
                         Bitrix должен получить
                         быстрый 200.
                        */

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


                        /*
                         Connector setup
                         выполняем после ответа.
                        */

                        setImmediate(
                            () => {

                                setupConnector()
                                    .then(
                                        () => {

                                            log(
                                                '========================================'
                                            );

                                            log(
                                                '✅ BITRIX CONNECTOR READY AFTER INSTALL'
                                            );

                                            log(
                                                'CONNECTOR:',
                                                BITRIX_CONNECTOR_ID
                                            );

                                            log(
                                                'OPEN LINE:',
                                                bitrixOpenLineId ||
                                                    'AUTO'
                                            );

                                            log(
                                                '========================================'
                                            );
                                        }
                                    )
                                    .catch(
                                        e => {

                                            error(
                                                '❌ Connector setup after installation:',
                                                e.message
                                            );
                                        }
                                    );
                            }
                        );

                        return;
                    }


                    /*
                     OAuth отсутствует.
                    */

                    error(
                        '❌ Bitrix installation callback did not contain OAuth auth'
                    );

                    try {

                        log(
                            'RECEIVED KEYS:',
                            Object.keys(
                                payload
                            )
                        );

                        log(
                            'AUTH KEYS:',
                            Object.keys(
                                auth
                            )
                        );

                    } catch (e) {
                        // ignore
                    }


                    res.writeHead(
                        400,
                        {
                            'Content-Type':
                                'application/json'
                        }
                    );

                    res.end(
                        JSON.stringify(
                            {
                                status:
                                    'error',

                                message:
                                    'Bitrix OAuth auth data missing',

                                received:
                                    Object.keys(
                                        payload
                                    ),

                                auth_keys:
                                    Object.keys(
                                        auth
                                    )
                            }
                        )
                    );

                    return;
                }


                // ==================================================
                // BITRIX CONNECTOR HANDLER
                // ==================================================

                if (
                    url.pathname ===
                    '/bitrix/handler'
                ) {


                    // ==================================================
                    // GET
                    // ==================================================

                    if (
                        req.method ===
                        'GET'
                    ) {

                        let options =
                            {};

                        const placementOptions =
                            url.searchParams.get(
                                'PLACEMENT_OPTIONS'
                            );

                        if (
                            placementOptions
                        ) {

                            try {

                                options =
                                    JSON.parse(
                                        placementOptions
                                    );

                            } catch (e) {

                                options =
                                    {};
                            }
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
<b>${
    active === undefined
        ? 'готов к настройке'
        : active
            ? 'активен'
            : 'выключен'
}</b>
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


                    // ==================================================
                    // POST
                    // ==================================================

                    if (
                        req.method ===
                        'POST'
                    ) {

                        let body = '';

                        try {

                            body =
                                await readRequestBody(
                                    req
                                );

                        } catch (e) {

                            error(
                                'Bitrix Connector body read error:',
                                e.message
                            );

                            res.writeHead(
                                500,
                                {
                                    'Content-Type':
                                        'application/json'
                                }
                            );

                            res.end(
                                JSON.stringify(
                                    {
                                        status:
                                            'error'
                                    }
                                )
                            );

                            return;
                        }


                        /*
                         =================================================
                         PARSER
                         =================================================

                         Поддерживаем:

                         1. application/json

                         2. application/x-www-form-urlencoded

                         3. старый плоский payload
                         */

                        let payload =
                            {};

                        try {

                            const type =
                                String(
                                    req.headers[
                                        'content-type'
                                    ] || ''
                                ).toLowerCase();


                            if (
                                type.includes(
                                    'application/json'
                                )
                            ) {

                                payload =
                                    body
                                        ? JSON.parse(
                                            body
                                        )
                                        : {};

                            } else {

                                payload =
                                    parseBitrixFormBody(
                                        body
                                    );
                            }

                        } catch (e) {

                            error(
                                '❌ Bitrix Connector parse error:',
                                e.message
                            );

                            payload =
                                {};
                        }


                        /*
                         Нормализуем.
                        */

                        payload =
                            normalizeConnectorPayload(
                                payload
                            );


                        log(
                            '========================================'
                        );

                        log(
                            '📥 Bitrix Connector POST:',
                            payload.event ||
                                '(unknown)'
                        );


                        /*
                         Диагностика именно
                         ONIMCONNECTORMESSAGEADD.
                        */

                        if (
                            String(
                                payload.event ||
                                ''
                            ).toUpperCase() ===
                            'ONIMCONNECTORMESSAGEADD'
                        ) {

                            const data =
                                payload.data ||
                                {};

                            const messages =
                                Array.isArray(
                                    data.MESSAGES
                                )
                                    ? data.MESSAGES
                                    : [];


                            log(
                                '🔎 Parsed Connector:',
                                data.CONNECTOR ||
                                    '(EMPTY)'
                            );

                            log(
                                '🔎 Parsed Line:',
                                data.LINE ||
                                    '(EMPTY)'
                            );

                            log(
                                '🔎 Parsed Messages:',
                                messages.length
                            );


                            if (
                                messages.length
                            ) {

                                const first =
                                    messages[0];

                                log(
                                    '🔎 Parsed Telegram chat:',
                                    first?.chat?.id ||
                                        '(EMPTY)'
                                );

                                log(
                                    '🔎 Parsed Bitrix chat:',
                                    first?.im?.chat_id ||
                                        '(EMPTY)'
                                );

                                log(
                                    '🔎 Parsed message:',
                                    first?.message?.text ||
                                        '(EMPTY)'
                                );
                            }


                            /*
                             ВАЖНО:

                             Отвечаем Bitrix сразу.
                             Обработка Telegram — после 200.
                            */

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
                                        e => {

                                            error(
                                                'Connector event processing:',
                                                e.message
                                            );
                                        }
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
// 31. STARTUP
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
        secretStatus(
            BOT_TOKEN
        )
    );

    log(
        'ADMIN_CHAT_ID:',
        secretStatus(
            ADMIN_CHAT_ID
        )
    );

    log(
        'DEEPSEEK_API_KEY:',
        secretStatus(
            DEEPSEEK_API_KEY
        )
    );

    log(
        'DEEPSEEK_MODEL:',
        DEEPSEEK_MODEL
    );

    log(
        'BITRIX_WEBHOOK_URL:',
        secretStatus(
            BITRIX_WEBHOOK_URL
        )
    );

    log(
        'BITRIX_BOT_TOKEN:',
        secretStatus(
            BITRIX_BOT_TOKEN
        )
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
        bitrixOpenLineId ||
            'AUTO'
    );

    log(
        'AUTH FILE:',
        AUTH_FILE
    );

    log(
        'OAUTH:',
        bitrixAuth?.access_token
            ? 'INSTALLED'
            : 'NOT INSTALLED'
    );

    log(
        '========================================'
    );


    /*
     HTTP
    */

    server.listen(
        PORT,
        '0.0.0.0',
        () => {

            log(
                `🚀 Server started on port ${PORT}`
            );
        }
    );


    /*
     Telegram
    */

    telegramPoll()
        .catch(
            e =>
                error(
                    'Telegram fatal:',
                    e.message
                )
        );


    /*
     Старый Bitrix FETCH.
    */

    bitrixFetchPoll()
        .catch(
            e =>
                error(
                    'Bitrix FETCH fatal:',
                    e.message
                )
        );


    /*
     Connector.
    */

    if (
        BITRIX_CONNECTOR_ENABLED
    ) {

        if (
            bitrixAuth?.access_token
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
// 32. SHUTDOWN
// ============================================================

function shutdown(
    signal
) {

    log(
        `🛑 ${signal}`
    );

    server.close(
        () => {

            log(
                'Server closed'
            );

            process.exit(
                0
            );
        }
    );

    setTimeout(
        () =>
            process.exit(
                0
            ),
        5000
    );
}


process.on(
    'SIGTERM',
    () =>
        shutdown(
            'SIGTERM'
        )
);

process.on(
    'SIGINT',
    () =>
        shutdown(
            'SIGINT'
        )
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
// 33. START
// ============================================================

startup()
    .catch(
        e => {

            error(
                'Startup fatal:',
                e.message
            );

            process.exit(
                1
            );
        }
    );