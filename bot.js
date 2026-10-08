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

const {
    processSalesMessage
} = require('./sales.js');

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

// ------------------------------------------------------------
// BITRIX DIAGNOSTIC SWITCHES
// По умолчанию все включены — рабочее поведение не меняется.
// Во время тестов отключаем только один контур за раз.
// ------------------------------------------------------------
const BITRIX_DIAGNOSTIC_MODE =
    String(process.env.BITRIX_DIAGNOSTIC_MODE || 'false')
        .toLowerCase() === 'true';
const BITRIX_DIAG_FETCH_ENABLED =
    String(process.env.BITRIX_DIAG_FETCH_ENABLED || 'true')
        .toLowerCase() === 'true';
const BITRIX_DIAG_CONNECTOR_SETUP_ENABLED =
    String(process.env.BITRIX_DIAG_CONNECTOR_SETUP_ENABLED || 'true')
        .toLowerCase() === 'true';
const BITRIX_DIAG_OUTBOUND_ENABLED =
    String(process.env.BITRIX_DIAG_OUTBOUND_ENABLED || 'true')
        .toLowerCase() === 'true';
const BITRIX_DIAG_INBOUND_ENABLED =
    String(process.env.BITRIX_DIAG_INBOUND_ENABLED || 'true')
        .toLowerCase() === 'true';
const BITRIX_DIAG_DELIVERY_ENABLED =
    String(process.env.BITRIX_DIAG_DELIVERY_ENABLED || 'true')
        .toLowerCase() === 'true';
const BITRIX_DIAG_OAUTH_REFRESH_ENABLED =
    String(process.env.BITRIX_DIAG_OAUTH_REFRESH_ENABLED || 'true')
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

const DATA_DIR =
    fs.existsSync('/data') ? '/data' : '/tmp';

const AUTH_FILE =
    path.join(DATA_DIR, 'bitrix-auth.json');

// ------------------------------------------------------------
// ВРЕМЕННОЕ ХРАНИЛИЩЕ ФАЙЛОВ ДЛЯ BITRIX
// ------------------------------------------------------------

const BITRIX_FILE_DIR =
    path.join(
        DATA_DIR,
        'mlk-bitrix-files'
    );

if (
    !fs.existsSync(
        BITRIX_FILE_DIR
    )
) {
    fs.mkdirSync(
        BITRIX_FILE_DIR,
        {
            recursive: true
        }
    );
}

const bitrixTempFiles =
    new Map();

const OFFSET_FILE =
    path.join(DATA_DIR, 'bitrix-offset.json');

const BITRIX_POLL_INTERVAL_MS = 3000;

// ============================================================
// 2. LOGGING
// ============================================================

function log(...args) {
    console.log(...args);
}

const bitrixDiagnosticState = {
    startedAt: new Date().toISOString(),
    lastOAuthRefreshAt: null,
    lastOAuthError: null,
    lastConnectorSetupAt: null,
    lastConnectorSetupResult: null,
    lastConnectorStatusAt: null,
    lastConnectorStatus: null,
    lastOutboundAt: null,
    lastOutboundResult: null,
    lastInboundAt: null,
    lastInboundResult: null,
    lastDeliveryAt: null,
    lastDeliveryResult: null,
    lastFetchAt: null,
    lastFetchResult: null
};

function bitrixDiag(label, data = null) {
    if (!BITRIX_DIAGNOSTIC_MODE) return;
    const prefix = `[BITRIX DIAG][uptime=${Math.round(process.uptime())}s] ${label}`;
    if (data === null || data === undefined) {
        log(prefix);
        return;
    }
    try { log(prefix, JSON.stringify(data)); }
    catch (e) { log(prefix, data); }
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

function getFetchDiagnosticUrl(url) {

    try {

        const parsed =
            new URL(url);

        let pathname =
            parsed.pathname;

        if (
            pathname.includes('/bot')
        ) {

            pathname =
                pathname.replace(
                    /\/bot[^/]+/,
                    '/bot[REDACTED]'
                );
        }

        return (
            parsed.protocol +
            '//' +
            parsed.hostname +
            pathname
        );

    } catch (e) {

        return '[invalid-url]';
    }
}


function getErrorDiagnostics(error) {

    const cause =
        error?.cause;

    return {

        name:
            error?.name ||
            'Error',

        message:
            error?.message ||
            String(error),

        code:
            error?.code ||
            cause?.code ||
            null,

        errno:
            error?.errno ||
            cause?.errno ||
            null,

        syscall:
            error?.syscall ||
            cause?.syscall ||
            null,

        causeName:
            cause?.name ||
            null,

        causeMessage:
            cause?.message ||
            null,

        causeCode:
            cause?.code ||
            null,

        stack:
            error?.stack ||
            null
    };
}


async function fetchJson(
    url,
    options = {}
) {

    const startedAt =
        Date.now();

    const method =
        String(
            options?.method ||
            'GET'
        ).toUpperCase();

    const target =
        getFetchDiagnosticUrl(
            url
        );

    try {

        const response =
            await fetch(
                url,
                options
            );

        const durationMs =
            Date.now() -
            startedAt;

        const text =
            await response.text();

        let data = {};

        try {

            data =
                text
                    ? JSON.parse(text)
                    : {};

        } catch (e) {

            error(
                '⚠️ FETCH INVALID JSON'
            );

            error(
                'TARGET:',
                target
            );

            error(
                'METHOD:',
                method
            );

            error(
                'HTTP STATUS:',
                response.status
            );

            error(
                'DURATION MS:',
                durationMs
            );

            error(
                'BODY:',
                text.slice(0, 1000)
            );

            throw new Error(
                `Invalid JSON response: ${text.slice(0, 500)}`
            );
        }

        if (!response.ok) {

            error(
                '⚠️ FETCH HTTP ERROR'
            );

            error(
                'TARGET:',
                target
            );

            error(
                'METHOD:',
                method
            );

            error(
                'HTTP STATUS:',
                response.status
            );

            error(
                'DURATION MS:',
                durationMs
            );

            error(
                'RESPONSE:',
                JSON.stringify(data).slice(0, 1000)
            );

            throw new Error(
                `HTTP ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`
            );
        }

        return data;

    } catch (e) {

        const durationMs =
            Date.now() -
            startedAt;

        const diagnostics =
            getErrorDiagnostics(
                e
            );

        error(
            '========================================'
        );

        error(
            '❌ FETCH FAILED'
        );

        error(
            'TARGET:',
            target
        );

        error(
            'METHOD:',
            method
        );

        error(
            'DURATION MS:',
            durationMs
        );

        error(
            'ERROR NAME:',
            diagnostics.name
        );

        error(
            'ERROR MESSAGE:',
            diagnostics.message
        );

        error(
            'ERROR CODE:',
            diagnostics.code
        );

        error(
            'ERROR ERRNO:',
            diagnostics.errno
        );

        error(
            'ERROR SYSCALL:',
            diagnostics.syscall
        );

        error(
            'CAUSE NAME:',
            diagnostics.causeName
        );

        error(
            'CAUSE MESSAGE:',
            diagnostics.causeMessage
        );

        error(
            'CAUSE CODE:',
            diagnostics.causeCode
        );

        error(
            'UPTIME SEC:',
            Math.round(
                process.uptime()
            )
        );

        const memory =
            process.memoryUsage();

        error(
            'MEMORY RSS MB:',
            Math.round(
                memory.rss /
                1024 /
                1024
            )
        );

        error(
            'HEAP USED MB:',
            Math.round(
                memory.heapUsed /
                1024 /
                1024
            )
        );

        if (
            diagnostics.stack
        ) {

            error(
                'STACK:',
                diagnostics.stack
            );
        }

        error(
            '========================================'
        );

        throw e;
    }
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

function logOAuthRefreshDiagnostics(data) {

    log('🔎 BITRIX OAUTH REFRESH DIAGNOSTIC');
    log('----------------------------------------');

    if (!data || typeof data !== 'object') {
        log('❌ OAuth response is not an object');
        log('----------------------------------------');
        return;
    }

    const safeFields = [
        'domain',
        'client_endpoint',
        'server_endpoint',
        'scope',
        'member_id',
        'status',
        'expires_in',
        'token_type'
    ];

    for (const field of safeFields) {

        if (data[field] !== undefined) {

            log(
                `OAuth ${field}:`,
                String(data[field])
            );
        }
    }

    log(
        'OAuth response keys:',
        Object.keys(data).join(', ')
    );

    log(
        'OAuth access_token:',
        data.access_token
            ? `PRESENT (${String(data.access_token).length} chars)`
            : 'MISSING'
    );

    log(
        'OAuth refresh_token:',
        data.refresh_token
            ? `PRESENT (${String(data.refresh_token).length} chars)`
            : 'MISSING'
    );

    log('----------------------------------------');
}

async function refreshBitrixOAuth() {

    bitrixDiag('OAUTH REFRESH START');

    if (!BITRIX_DIAG_OAUTH_REFRESH_ENABLED) {
        warn('🧪 BITRIX DIAG: OAuth refresh is DISABLED');
        throw new Error('Bitrix OAuth refresh disabled by diagnostic switch');
    }

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

    logOAuthRefreshDiagnostics(data);

    bitrixAuth = {
        ...bitrixAuth,
        ...data
    };

    saveAuth(bitrixAuth);

    bitrixDiagnosticState.lastOAuthRefreshAt = new Date().toISOString();
        bitrixDiagnosticState.lastOAuthError = null;
        bitrixDiag('OAUTH REFRESH SUCCESS', {
            domain: bitrixAuth.domain || null,
            hasAccessToken: !!bitrixAuth.access_token,
            hasRefreshToken: !!bitrixAuth.refresh_token
        });

    log('✅ Bitrix OAuth refreshed');

    try {

        await diagnoseBitrixOAuthContext();

    } catch (e) {

        error(
            '❌ OAuth diagnostic error:',
            e.message
        );
    }

    return bitrixAuth;
}

async function diagnoseBitrixOAuthContext() {

    log('🔎 BITRIX OAUTH DIAGNOSTIC');
    log('----------------------------------------');

    // 1. Проверяем сам OAuth
    try {

        const profile =
            await bitrixOAuthCall(
                'profile',
                {},
                false
            );

        log(
            '✅ OAuth profile: OK',
            profile?.result?.ID
                ? `user=${profile.result.ID}`
                : ''
        );

    } catch (e) {

        error(
            '❌ OAuth profile ERROR:',
            e.message
        );
    }


    // 2. Проверяем именно Connector
    try {

        const status =
            await bitrixOAuthCall(
                'imconnector.status',
                {
                    CONNECTOR:
                        BITRIX_CONNECTOR_ID,

                    LINE:
                        Number(
                            bitrixOpenLineId || 0
                        )
                },
                false
            );

        log(
            '✅ Connector status: OK',
            JSON.stringify(status)
        );

    } catch (e) {

        error(
            '❌ Connector status ERROR:',
            e.message
        );
    }

    log('----------------------------------------');
}

async function bitrixOAuthCall(
    method,
    params = {},
    retry = true
) {

    bitrixDiag('REST CALL START', { method, retry });

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

    log(
        '🔐 BITRIX REST AUTH CONTEXT:',
        `method=${method}`,
        `domain=${domain}`,
        `token=${bitrixAuth.access_token ? 'PRESENT' : 'MISSING'}`,
        `tokenLength=${bitrixAuth.access_token ? String(bitrixAuth.access_token).length : 0}`
    );

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

        bitrixDiag('REST CALL RESULT', {
            method,
            ok: true,
            error: data?.error || null,
            errorDescription: data?.error_description || null
        });

        if (
            data &&
            (
                data.error === 'expired_token' ||
                data.error === 'NO_AUTH_FOUND'
            ) &&
            retry
        ) {

            log('🔄 BITRIX OAUTH REFRESH TRIGGERED');
            log('----------------------------------------');
            log('REST METHOD:', method);
            log('BITRIX ERROR:', data.error);
            log(
                'BITRIX ERROR DESCRIPTION:',
                data.error_description || ''
            );
            log('----------------------------------------');

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

        if (
            retry &&
            (
                e.message.includes('expired_token') ||
                e.message.includes('NO_AUTH_FOUND')
            )
        ) {

            log('🔄 BITRIX OAUTH REFRESH TRIGGERED FROM CATCH');
            log('----------------------------------------');
            log('REST METHOD:', method);
            log('ERROR:', e.message);
            log('----------------------------------------');

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

// ============================================================
// TYPING ACTION
// ============================================================

async function sendTelegramTyping(
    chatId
) {

    try {

        await telegramCall(
            'sendChatAction',
            {
                chat_id:
                    String(chatId),

                action:
                    'typing'
            }
        );

    } catch (e) {

        warn(
            'Telegram typing error:',
            e.message
        );
    }
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

// ============================================================
// EQUIPMENT MULTI-SELECT MARKUP
// ============================================================

function buildEquipmentMultiSelectMarkup(selected = []) {

    const equipment = [
        ['🔊 Звуковое оборудование', 'sound'],
        ['📺 LED-экраны', 'led'],
        ['💡 Световое оборудование', 'light'],
        ['🎪 Сценические конструкции', 'stage']
    ];

    const selectedSet = new Set(
        Array.isArray(selected)
            ? selected
            : []
    );

    const keyboard = [];

    for (const [label, value] of equipment) {

        const isSelected =
            selectedSet.has(value);

        keyboard.push([
            {
                text:
                    `${isSelected ? '✅' : '⬜'} ${label}`,

                callback_data:
                    `sales:equipment:toggle:${value}:${Array.from(selectedSet).join(',')}`
            }
        ]);
    }

    const allSelected =
        equipment.every(
            ([, value]) =>
                selectedSet.has(value)
        );

    keyboard.push([
        {
            text:
                `${allSelected ? '✅' : '⬜'} 🎛 Полный комплекс`,

            callback_data:
                `sales:equipment:all:${Array.from(selectedSet).join(',')}`
        }
    ]);

    keyboard.push([
        {
            text: '✅ Готово',

            callback_data:
                `sales:equipment:done:${Array.from(selectedSet).join(',')}`
        }
    ]);

    return {
        inline_keyboard: keyboard
    };
}


function buildTelegramReplyMarkup(actions) {

    if (!Array.isArray(actions) || !actions.length) {
        return null;
    }

    const keyboard = [];

    const quickReplyOptions = {

        ask_format: [
            ['🎵 Концерты / фестивали', 'concerts'],
            ['🎤 Конференции / презентации', 'conferences'],
            ['🎉 Корпоративы / торжества', 'corporate'],
            ['🏢 Выставки', 'exhibitions'],
            ['🏆 Спортивные мероприятия', 'sports']
        ],

        ask_level: [
            [
                'Стандартный (обычные требования к оборудованию и документации)',
                'standard'
            ],
            [
                'Высокие требования (повышенные требования к оборудованию и документации, прямые ТВ-трансляции)',
                'high'
            ],
            [
                'Высший уровень (с высшими должностными лицами, масштабные и международные мероприятия)',
                'highest'
            ]
        ],

        ask_personnel: [
            ['Полное управление оборудованием', 'management'],
            ['Дежурный техник', 'duty_technician'],
            ['Только монтаж / демонтаж', 'installation_dismantling'],
            ['Другое', 'other']
        ],

        ask_place: [
            ['🌳 Улица', 'outdoor'],
            ['🏢 Помещение', 'indoor'],
            ['⛺ Под навесом', 'covered']
        ],

        ask_lift: [
            ['🏗 Есть грузовой лифт', 'has_lift'],
            ['🪜 По лестнице', 'stairs'],
            ['❓ Не знаю', 'unknown']
        ],

        ask_equipment: [
            ['🔊 Звуковое оборудование', 'sound'],
            ['📺 LED-экраны', 'led'],
            ['💡 Световое оборудование', 'light'],
            ['🎪 Сценические конструкции', 'stage'],
            ['🎛 Полный комплекс', 'all']
        ],

        ask_sound_rider: [
            ['✅ Да, есть', 'yes'],
            ['❌ Нет', 'no']
        ],

        ask_light_fixtures: [
            ['✅ Да, есть', 'yes'],
            ['❌ Нет', 'no']
        ],

        ask_mount: [
            ['По согласованию', 'any'],
            ['🌙 Ночью / рано утром', 'night']
        ],

        ask_demount: [
            ['По согласованию', 'any'],
            ['⏰ До определённого времени', 'deadline']
        ]
    };


    for (const action of actions) {

        if (!action || !action.type) {
            continue;
        }


        // ----------------------------------------------------
        // FILES
        // ----------------------------------------------------

        if (action.type === 'send_files') {

            keyboard.push([
                {
                    text: '📎 Отправить ТЗ / файлы',
                    callback_data:
                        'sales:send_files'
                }
            ]);

            continue;
        }


        // ----------------------------------------------------
        // CALENDAR
        // ----------------------------------------------------

        if (action.type === 'calendar') {

            if (
                action.tag === 'ask_date_start' ||
                action.tag === 'ask_date_end' ||
                action.tag === 'ask_ready_date'
            ) {

                keyboard.push([
                    {
                        text: '📅 Выбрать дату',
                        callback_data:
                            `sales:calendar:${action.tag}`
                    }
                ]);
            }

            continue;
        }


        // ----------------------------------------------------
        // QUICK REPLY
        // ----------------------------------------------------

        if (action.type === 'quick_reply') {

            if (
                action.tag === 'discuss_project'
            ) {

                keyboard.push([
                    {
                        text: '💬 Обсудить проект',
                        callback_data:
                            'sales:discuss_project'
                    }
                ]);

                continue;
            }


            if (
                action.tag === 'manager_handoff'
            ) {

                keyboard.push([
                    {
                        text: '👨‍💼 Передать менеджеру',
                        callback_data:
                            'sales:manager_handoff'
                    }
                ]);

                continue;
            }


            if (
                action.tag === 'ask_equipment'
            ) {

                keyboard.push(
                    ...buildEquipmentMultiSelectMarkup()
                        .inline_keyboard
                );

                continue;
            }


            const options =
                quickReplyOptions[action.tag];


            if (!options) {
                continue;
            }


            for (
                const [label, value]
                of options
            ) {

                keyboard.push([
                    {
                        text: label,

                        callback_data:
                            `sales:action:${action.tag}:${value}`
                    }
                ]);
            }

            continue;
        }
    }


    if (!keyboard.length) {
        return null;
    }


    return {
        inline_keyboard:
            keyboard
    };
}

// ============================================================
// TELEGRAM SALES CALENDAR
// ============================================================

const SALES_MONTHS = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь'
];


const SALES_WEEKDAYS = [
    'Пн',
    'Вт',
    'Ср',
    'Чт',
    'Пт',
    'Сб',
    'Вс'
];


// ------------------------------------------------------------
// DATE HELPERS
// ------------------------------------------------------------

function pad2(value) {

    return String(value)
        .padStart(2, '0');
}


function salesDateValue(
    year,
    month,
    day
) {

    return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}


function getDaysInMonth(
    year,
    month
) {

    return new Date(
        year,
        month + 1,
        0
    ).getDate();
}


function getMonthMondayIndex(
    year,
    month
) {

    const day =
        new Date(
            year,
            month,
            1
        ).getDay();

    return day === 0
        ? 6
        : day - 1;
}


// ------------------------------------------------------------
// CALENDAR
// ------------------------------------------------------------

function buildSalesCalendar(
    tag,
    year,
    month
) {

    const keyboard = [];


    // HEADER
    keyboard.push([
        {
            text:
                '‹',
            callback_data:
                `sales:calendar:${tag}:prev:${year}-${pad2(month)}`
        },

        {
            text:
                `${SALES_MONTHS[month]} ${year}`,
            callback_data:
                'sales:noop'
        },

        {
            text:
                '›',
            callback_data:
                `sales:calendar:${tag}:next:${year}-${pad2(month + 2)}`
        }
    ]);


    // WEEKDAYS
    keyboard.push(
        SALES_WEEKDAYS.map(
            day => ({
                text: day,
                callback_data:
                    'sales:noop'
            })
        )
    );


    const firstDay =
        getMonthMondayIndex(
            year,
            month
        );

    const daysInMonth =
        getDaysInMonth(
            year,
            month
        );


    let row = [];


    // EMPTY CELLS
    for (
        let i = 0;
        i < firstDay;
        i++
    ) {

        row.push({
            text: ' ',
            callback_data:
                'sales:noop'
        });
    }


    // DAYS
    for (
        let day = 1;
        day <= daysInMonth;
        day++
    ) {

        const value =
            salesDateValue(
                year,
                month,
                day
            );


        row.push({
            text:
                String(day),

            callback_data:
                `sales:calendar:${tag}:day:${value}`
        });


        if (row.length === 7) {

            keyboard.push(row);

            row = [];
        }
    }


    // LAST ROW
    if (row.length) {

        while (
            row.length < 7
        ) {

            row.push({
                text: ' ',
                callback_data:
                    'sales:noop'
            });
        }

        keyboard.push(row);
    }


    // TODAY
    keyboard.push([
        {
            text:
                '📅 Сегодня',
            callback_data:
                `sales:calendar:${tag}:today`
        }
    ]);


    return {
        inline_keyboard:
            keyboard
    };
}


// ------------------------------------------------------------
// TIME PICKER
// ------------------------------------------------------------

function buildSalesTimePicker(
    tag,
    date
) {

    const keyboard = [];

    const times = [];


    // 30 минут
    for (
        let hour = 0;
        hour < 24;
        hour++
    ) {

        for (
            let minute = 0;
            minute < 60;
            minute += 30
        ) {

            times.push(
                `${pad2(hour)}:${pad2(minute)}`
            );
        }
    }


    // 4 кнопки в ряд
    let row = [];


    for (
        const time of times
    ) {

        row.push({
            text:
                time,

            callback_data:
                `sales:calendar:${tag}:time:${date}:${time}`
        });


        if (row.length === 4) {

            keyboard.push(row);

            row = [];
        }
    }


    if (row.length) {
        keyboard.push(row);
    }


    keyboard.push([
        {
            text:
                '⬅️ Назад к дате',

            callback_data:
                `sales:calendar:${tag}:back:${date}`
        }
    ]);


    return {
        inline_keyboard:
            keyboard
    };
}


async function editTelegramMessageReplyMarkup(
    callbackQuery,
    replyMarkup
) {

    const chatId =
        callbackQuery
            ?.message
            ?.chat
            ?.id;

    const messageId =
        callbackQuery
            ?.message
            ?.message_id;


    if (
        !chatId ||
        !messageId
    ) {
        return;
    }


    await telegramCall(
        'editMessageReplyMarkup',
        {
            chat_id:
                chatId,

            message_id:
                messageId,

            reply_markup:
                replyMarkup
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
// СКАЧИВАНИЕ ФАЙЛА ИЗ TELEGRAM ДЛЯ BITRIX
// ============================================================

async function downloadTelegramFileForBitrix(
    fileId,
    fileName
) {

    const token =
        crypto
            .randomBytes(32)
            .toString('hex');

    const safeName =
        path.basename(
            fileName || 'file'
        );

    const filePath =
        path.join(
            BITRIX_FILE_DIR,
            `${token}-${safeName}`
        );

    // --------------------------------------------------------
    // 1. Получаем Telegram file_path
    // --------------------------------------------------------

    const getFileResponse =
        await fetch(
            `${TELEGRAM_API}/getFile?file_id=${encodeURIComponent(fileId)}`
        );

    if (!getFileResponse.ok) {

        throw new Error(
            `Telegram getFile HTTP ${getFileResponse.status}`
        );
    }

    const getFileData =
        await getFileResponse.json();

    if (
        !getFileData.ok ||
        !getFileData.result?.file_path
    ) {

        throw new Error(
            `Telegram getFile failed: ${JSON.stringify(getFileData)}`
        );
    }

    const filePathTelegram =
        getFileData.result.file_path;

    // --------------------------------------------------------
    // 2. Скачиваем сам файл
    // --------------------------------------------------------

    const downloadUrl =
        `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePathTelegram}`;

    log(
        '📥 Downloading Telegram file:',
        safeName
    );

    const fileResponse =
        await fetch(
            downloadUrl
        );

    if (!fileResponse.ok) {

        throw new Error(
            `Telegram file download HTTP ${fileResponse.status}`
        );
    }

    // --------------------------------------------------------
    // 3. Сохраняем временно
    // --------------------------------------------------------

    const buffer =
        Buffer.from(
            await fileResponse.arrayBuffer()
        );

    fs.writeFileSync(
        filePath,
        buffer
    );

    // --------------------------------------------------------
    // 4. Запоминаем файл
    // --------------------------------------------------------

    bitrixTempFiles.set(
        token,
        {
            filePath,
            fileName: safeName,
            createdAt: Date.now()
        }
    );

    log(
        '📦 Temporary Bitrix file prepared:',
        safeName
    );

    return {
        token,
        fileName: safeName
    };
}

// ============================================================
// TELEGRAM MEDIA -> BITRIX FILES
// ============================================================

async function getTelegramConnectorFiles(
    message
) {

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
                file_id:
                    photo.file_id,

                name:
                    'photo.jpg'
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

        if (!item.file_id) {
            continue;
        }

        result.push({
            fileId:
                item.file_id,

            name:
                item.name
        });

        log(
            '📎 Telegram file prepared for Bitrix:',
            item.name
        );
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
        throw new Error(
            'Bitrix file URL is empty'
        );
    }

    const lowerName =
        String(fileName || 'file')
            .toLowerCase();

    // --------------------------------------------------------
    // 1. Скачиваем файл с Bitrix на наш сервер
    // --------------------------------------------------------

    console.log(
        '📥 Downloading Bitrix file:',
        fileName
    );

    const fileResponse =
        await fetch(fileUrl);

    if (!fileResponse.ok) {

        throw new Error(
            `Bitrix file download HTTP ${fileResponse.status}`
        );
    }

    const buffer =
        Buffer.from(
            await fileResponse.arrayBuffer()
        );

    if (!buffer.length) {

        throw new Error(
            'Bitrix file downloaded but is empty'
        );
    }

    // --------------------------------------------------------
    // 2. Определяем тип отправки
    // --------------------------------------------------------

    let method = 'sendDocument';

    const fieldName = 'document';

    if (
        lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg') ||
        lowerName.endsWith('.png') ||
        lowerName.endsWith('.gif') ||
        lowerName.endsWith('.webp') ||
        lowerName.endsWith('.bmp')
    ) {
        method = 'sendPhoto';
    }

    else if (
        lowerName.endsWith('.mp4') ||
        lowerName.endsWith('.mov') ||
        lowerName.endsWith('.m4v')
    ) {
        method = 'sendVideo';
    }

    else if (
        lowerName.endsWith('.mp3') ||
        lowerName.endsWith('.wav') ||
        lowerName.endsWith('.m4a')
    ) {
        method = 'sendAudio';
    }

    const telegramField =
        method === 'sendPhoto'
            ? 'photo'
            : method === 'sendVideo'
                ? 'video'
                : method === 'sendAudio'
                    ? 'audio'
                    : fieldName;

    // --------------------------------------------------------
    // 3. Загружаем файл НЕ по URL,
    //    а непосредственно в Telegram
    // --------------------------------------------------------

    const form =
        new FormData();

    form.append(
        'chat_id',
        String(chatId)
    );

    form.append(
        telegramField,
        new Blob([buffer]),
        String(fileName || 'file')
    );

    console.log(
        '📤 Uploading file to Telegram:',
        fileName,
        'via',
        method
    );

    const response =
        await fetch(
            `${TELEGRAM_API}/${method}`,
            {
                method: 'POST',
                body: form
            }
        );

    const raw =
        await response.text();

    let data;

    try {

        data =
            JSON.parse(raw);

    } catch {

        data = {
            ok: false,
            description: raw
        };
    }

    if (
        !response.ok ||
        !data.ok
    ) {

        throw new Error(
            `Telegram ${method} failed: ${
                data.description ||
                `HTTP ${response.status}`
            }`
        );
    }

    console.log(
        '✅ Telegram file upload OK:',
        fileName
    );

    return data;
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

const adminMessageMap =
    new Map();

const bitrixChatMap =
    new Map();

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

    let line =
        lines.find(
            item =>
                String(
                    item.LINE_NAME || ''
                )
                .toLowerCase()
                .includes('telegram')
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

async function bindConnectorEvent() {

    if (!bitrixAuth?.access_token) {
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

        const message =
            String(e?.message || '').toLowerCase();

        // Bitrix сообщает, что обработчик уже существует.
        // Это НЕ ошибка для нашего сценария:
        // значит обработчик был зарегистрирован ранее.
        if (
            message.includes('handler already binded')
        ) {

            warn(
                '⚠️ ONIMCONNECTORMESSAGEADD already bound — continuing'
            );

            return {
                alreadyBound: true
            };
        }

        // Любая другая ошибка действительно должна
        // остановить настройку Connector.
        throw e;
    }
}

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

async function setupConnector() {

    bitrixDiagnosticState.lastConnectorSetupAt = new Date().toISOString();
    bitrixDiag('CONNECTOR SETUP START');

    if (!BITRIX_DIAG_CONNECTOR_SETUP_ENABLED) {
        warn('🧪 BITRIX DIAG: Connector setup is DISABLED');
        bitrixDiagnosticState.lastConnectorSetupResult = 'disabled';
        return;
    }

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

        await registerConnector();

        await bindConnectorEvent();

        await findOpenLine();

        await activateConnector(
            bitrixOpenLineId
        );

        const statusResult =
            await connectorStatus(
                bitrixOpenLineId
            );

        bitrixDiagnosticState.lastConnectorStatusAt = new Date().toISOString();
        bitrixDiagnosticState.lastConnectorStatus = statusResult || 'ok';

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
        bitrixDiagnosticState.lastConnectorSetupResult = `error: ${e.message}`;
        bitrixDiag('CONNECTOR SETUP ERROR', {
            error: e.message,
            stack: e.stack || null,
            connectorReady,
            openLine: bitrixOpenLineId
        });

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
    telegramUser = null,
    files = []
) {

    bitrixDiagnosticState.lastOutboundAt = new Date().toISOString();
    bitrixDiag('OUTBOUND START', { clientId: String(clientId), senderType });

    if (!BITRIX_DIAG_OUTBOUND_ENABLED) {
        warn('🧪 BITRIX DIAG: Connector outbound is DISABLED');
        bitrixDiagnosticState.lastOutboundResult = 'disabled';
        return null;
    }

    if (!BITRIX_CONNECTOR_ENABLED) {
        bitrixDiagnosticState.lastOutboundResult = 'connector_disabled';
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

    // ------------------------------------------------------------
    // FILES
    // ------------------------------------------------------------

    const rawFiles =
        Array.isArray(files)
            ? files.filter(
                file =>
                    file &&
                    file.fileId
            )
            : [];

    const preparedFiles = [];

    for (
        const raw of rawFiles
    ) {

        try {

            const prepared =
                await downloadTelegramFileForBitrix(
                    raw.fileId,
                    raw.name
                );

            const bitrixFileUrl =
                `${PUBLIC_BASE_URL}/bitrix-file/${encodeURIComponent(prepared.token)}`;

            preparedFiles.push({
                url:
                    bitrixFileUrl,

                name:
                    prepared.fileName
            });

        } catch (e) {

            error(
                '❌ Failed to prepare file for Bitrix:',
                e.message
            );
        }
    }

    if (
        !text &&
        preparedFiles.length
    ) {

        text =
            '📎 Вложение из Telegram';
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

    const messageId =
        `tg_${Date.now()}_` +
        crypto
            .randomBytes(4)
            .toString('hex');

    const message = {
        id:
            messageId,

        date:
            Math.floor(
                Date.now() / 1000
            ),

        text:
            String(text)
    };

    if (
        preparedFiles.length
    ) {

        message.files =
            preparedFiles;
    }

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

                        message,

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
        !message?.chat?.id
    ) {
        return;
    }

    const clientId =
        String(message.chat.id);

    const text =
        String(
            message.text ||
            message.caption ||
            ''
        ).trim();

    const telegramFiles =
        await getTelegramConnectorFiles(
            message
        );

    if (
        !text &&
        !telegramFiles.length
    ) {
        return;
    }

    const client =
        getClient(clientId);

    client.name =
        message.from?.first_name || '';

    client.username =
        message.from?.username || '';

    log(
        `📨 Client ${clientId}: ${text || '[MEDIA]'}`
    );

    // 1. Полностью дублируем клиентское сообщение
    await mirrorToAdmin(
        clientId,
        'client',
        text || '[MEDIA]'
    );

    // 2. Telegram -> Bitrix
    bitrixDiagnosticState.lastOutboundAt = new Date().toISOString();
    bitrixDiag('OUTBOUND START', {
        clientId: String(clientId),
        hasText: !!text,
        files: telegramFiles.length
    });

    try {

        const outboundResult =
            await sendToBitrixConnector(
                clientId,
                text,
                'client',
                message.from,
                telegramFiles
            );

        bitrixDiagnosticState.lastOutboundResult = 'success';
        bitrixDiag('OUTBOUND SUCCESS', {
            clientId: String(clientId),
            chatId:
                outboundResult
                    ?.result
                    ?.DATA
                    ?.RESULT
                    ?.[0]
                    ?.session
                    ?.CHAT_ID || null
        });

    } catch (e) {

        bitrixDiagnosticState.lastOutboundResult =
            `error: ${e.message}`;

        bitrixDiag('OUTBOUND ERROR', {
            error: e.message,
            stack: e.stack || null
        });

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

    // 4. SALES ENGINE
    try {

        let salesInput;

        if (
            text === '/start'
        ) {

            salesInput = {
                type: 'start',

                clientName:
                    client.name || ''
            };

        } else if (
            telegramFiles.length
        ) {

            salesInput = {
                type: 'file',

                fileName:
                    telegramFiles[0].name,

                fileText:
                    text || '',

                clientName:
                    client.name || ''
            };

        } else {

            salesInput = {
                type: 'text',

                text,

                clientName:
                    client.name || ''
            };
        }

        await sendTelegramTyping(
            clientId
        );

        const result =
            await processSalesMessage(
                clientId,
                salesInput
            );

        const answer =
            String(result?.text || '').trim();

        if (!answer) {
            throw new Error(
                'Sales Engine returned empty text'
            );
        }

        log(
            '🧠 Sales Engine:',
            `client=${clientId}`,
            `stage=${result?.stage || ''}`,
            `intent=${result?.intent || ''}`
        );

        const replyMarkup =
            buildTelegramReplyMarkup(
                result?.actions
            );

        await sendTelegramMessage(
            clientId,
            answer,
            replyMarkup
                ? {
                    reply_markup: replyMarkup
                }
                : {}
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
                'Sales Engine -> Bitrix error:',
                e.message
            );
        }

    } catch (e) {

        error(
            'Sales Engine error:',
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
// 15. TELEGRAM CALLBACK
// ============================================================

async function processTelegramCallback(
    callbackQuery
) {

    if (!callbackQuery?.data) {
        return;
    }

    const data =
        callbackQuery.data;

    const parts =
        data.split(':');

    const action =
        parts[0];

    // --------------------------------------------------------
    // CLIENT SALES BUTTONS
    // --------------------------------------------------------

    if (
        action === 'sales'
    ) {

        const salesAction =
            parts[1];

        const clientId =
            String(
                callbackQuery
                    .message
                    ?.chat
                    ?.id
            );

        if (
            !clientId ||
            !salesAction
        ) {
            return;
        }


        // ----------------------------------------------------
        // EQUIPMENT MULTI-SELECT
        // ----------------------------------------------------

        if (
            salesAction === 'equipment'
        ) {

            const equipmentAction =
                parts[2];

            const equipmentValue =
                parts[3] || '';

            const selected =
                parts[4]
                    ? parts[4]
                        .split(',')
                        .filter(Boolean)
                    : [];


            // ----------------------------------------------
            // TOGGLE
            // ----------------------------------------------

            if (
                equipmentAction === 'toggle'
            ) {

                const nextSelected =
                    new Set(selected);

                if (
                    nextSelected.has(
                        equipmentValue
                    )
                ) {
                    nextSelected.delete(
                        equipmentValue
                    );
                } else {
                    nextSelected.add(
                        equipmentValue
                    );
                }


                await answerTelegramCallback(
                    callbackQuery.id
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildEquipmentMultiSelectMarkup(
                        Array.from(nextSelected)
                    )
                );

                return;
            }


            // ----------------------------------------------
            // ALL
            // ----------------------------------------------

            if (
                equipmentAction === 'all'
            ) {

                const allEquipment = [
                    'sound',
                    'led',
                    'light',
                    'stage'
                ];

                const allSelected =
                    allEquipment.every(
                        value =>
                            selected.includes(value)
                    );

                const nextSelected =
                    allSelected
                        ? []
                        : allEquipment;


                await answerTelegramCallback(
                    callbackQuery.id
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildEquipmentMultiSelectMarkup(
                        nextSelected
                    )
                );

                return;
            }


            // ----------------------------------------------
            // DONE
            // ----------------------------------------------

            if (
                equipmentAction === 'done'
            ) {

                if (!selected.length) {

                    await answerTelegramCallback(
                        callbackQuery.id,
                        'Выберите хотя бы один вариант'
                    );

                    return;
                }


                await answerTelegramCallback(
                    callbackQuery.id,
                    'Оборудование выбрано'
                );


                const result =
                    await processSalesMessage(
                        clientId,
                        {
                            type: 'action',

                            tag:
                                'ask_equipment',

                            value:
                                selected
                        }
                    );


                const replyMarkup =
                    buildTelegramReplyMarkup(
                        result?.actions
                    );


                await sendTelegramMessage(
                    clientId,
                    result?.text || '',

                    replyMarkup
                        ? {
                            reply_markup:
                                replyMarkup
                        }
                        : {}
                );


                return;
            }

            return;
        }


        // ----------------------------------------------------
        // SALES ENGINE ACTION
        // ----------------------------------------------------

        if (
            salesAction === 'action'
        ) {

            const salesTag =
                parts[2];

            const salesValue =
                parts.slice(3).join(':');


            if (
                !salesTag ||
                !salesValue
            ) {
                return;
            }


            await answerTelegramCallback(
                callbackQuery.id,
                'Принято'
            );


            const result =
                await processSalesMessage(
                    clientId,
                    {
                        type:
                            'action',

                        tag:
                            salesTag,

                        value:
                            salesValue
                    }
                );


            const replyMarkup =
                buildTelegramReplyMarkup(
                    result?.actions
                );


            await sendTelegramMessage(
                clientId,
                result?.text || '',

                replyMarkup
                    ? {
                        reply_markup:
                            replyMarkup
                    }
                    : {}
            );


            return;
        }


        // ----------------------------------------------------
        // SALES CALENDAR
        // ----------------------------------------------------

        if (
            salesAction === 'calendar'
        ) {

            const calendarTag =
                parts[2];

            const calendarAction =
                parts[3];


            if (!calendarTag) {
                return;
            }


            // ------------------------------------------------
            // OPEN CALENDAR
            // ------------------------------------------------

            if (
                !calendarAction
            ) {

                const now =
                    new Date();

                const year =
                    now.getFullYear();

                const month =
                    now.getMonth();


                await answerTelegramCallback(
                    callbackQuery.id
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildSalesCalendar(
                        calendarTag,
                        year,
                        month
                    )
                );


                return;
            }


            // ------------------------------------------------
            // PREVIOUS MONTH
            // ------------------------------------------------

            if (
                calendarAction === 'prev'
            ) {

                const [year, month] =
                    parts[4]
                        .split('-')
                        .map(Number);


                const date =
                    new Date(
                        year,
                        month - 1,
                        1
                    );


                await answerTelegramCallback(
                    callbackQuery.id
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildSalesCalendar(
                        calendarTag,
                        date.getFullYear(),
                        date.getMonth()
                    )
                );


                return;
            }


            // ------------------------------------------------
            // NEXT MONTH
            // ------------------------------------------------

            if (
                calendarAction === 'next'
            ) {

                const [year, month] =
                    parts[4]
                        .split('-')
                        .map(Number);


                const date =
                    new Date(
                        year,
                        month - 1,
                        1
                    );


                await answerTelegramCallback(
                    callbackQuery.id
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildSalesCalendar(
                        calendarTag,
                        date.getFullYear(),
                        date.getMonth()
                    )
                );


                return;
            }


            // ------------------------------------------------
            // TODAY
            // ------------------------------------------------

            if (
                calendarAction === 'today'
            ) {

                const now =
                    new Date();

                const date =
                    salesDateValue(
                        now.getFullYear(),
                        now.getMonth(),
                        now.getDate()
                    );


                await answerTelegramCallback(
                    callbackQuery.id,
                    'Дата выбрана'
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildSalesTimePicker(
                        calendarTag,
                        date
                    )
                );


                return;
            }


            // ------------------------------------------------
            // DATE SELECTED
            // ------------------------------------------------

            if (
                calendarAction === 'day'
            ) {

                const selectedDate =
                    parts[4];


                if (
                    !selectedDate
                ) {
                    return;
                }


                await answerTelegramCallback(
                    callbackQuery.id,
                    'Дата выбрана'
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildSalesTimePicker(
                        calendarTag,
                        selectedDate
                    )
                );


                return;
            }


            // ------------------------------------------------
            // BACK TO DATE
            // ------------------------------------------------

            if (
                calendarAction === 'back'
            ) {

                const selectedDate =
                    parts[4];


                if (
                    !selectedDate
                ) {
                    return;
                }


                const [
                    year,
                    month
                ] =
                    selectedDate
                        .split('-')
                        .map(Number);


                await answerTelegramCallback(
                    callbackQuery.id
                );


                await editTelegramMessageReplyMarkup(
                    callbackQuery,

                    buildSalesCalendar(
                        calendarTag,
                        year,
                        month - 1
                    )
                );


                return;
            }


            // ------------------------------------------------
            // TIME SELECTED
            // ------------------------------------------------

            if (
                calendarAction === 'time'
            ) {

                const selectedDate =
                    parts[4];

                const hour =
                    parts[5];

                const minute =
                    parts[6];


                if (
                    !selectedDate ||
                    !hour ||
                    !minute
                ) {
                    return;
                }


                const value =
                    `${selectedDate} ${hour}:${minute}`;


                await answerTelegramCallback(
                    callbackQuery.id,
                    'Время выбрано'
                );


                const result =
                    await processSalesMessage(
                        clientId,
                        {
                            type:
                                'action',

                            tag:
                                calendarTag,

                            value
                        }
                    );


                const replyMarkup =
                    buildTelegramReplyMarkup(
                        result?.actions
                    );


                await sendTelegramMessage(
                    clientId,
                    result?.text || '',

                    replyMarkup
                        ? {
                            reply_markup:
                                replyMarkup
                        }
                        : {}
                );


                return;
            }


            return;
        }


        if (
            salesAction === 'send_files'
        ) {

            await answerTelegramCallback(
                callbackQuery.id,
                'Можно отправить файл'
            );

            await sendTelegramMessage(
                clientId,
                'Отлично. Отправляйте ТЗ, райдер или другие материалы по проекту. Я передам их команде MLK.'
            );

            return;
        }

        if (
            salesAction === 'discuss_project'
        ) {

            await answerTelegramCallback(
                callbackQuery.id,
                'Начинаем'
            );

            const result =
                await processSalesMessage(
                    clientId,
                    {
                        type:
                            'action',

                        tag:
                            'discuss_project'
                    }
                );

            const replyMarkup =
                buildTelegramReplyMarkup(
                    result?.actions
                );

            await sendTelegramMessage(
                clientId,
                result?.text || '',
                replyMarkup
                    ? {
                        reply_markup:
                            replyMarkup
                    }
                    : {}
            );

            return;
        }

        return;
    }


    // --------------------------------------------------------
    // ADMIN BUTTONS
    // --------------------------------------------------------

    if (
        !ADMIN_CHAT_ID ||
        String(
            callbackQuery.message?.chat?.id
        ) !== String(ADMIN_CHAT_ID)
    ) {
        return;
    }

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

let telegramConsecutiveErrors = 0;
let telegramLastSuccessAt = null;

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

            telegramConsecutiveErrors = 0;

            telegramLastSuccessAt =
                new Date().toISOString();

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

                    if (e.stack) {
                        error(
                            'Telegram update stack:',
                            e.stack
                        );
                    }
                }
            }

        } catch (e) {

            telegramConsecutiveErrors++;

            error(
                '========================================'
            );

            error(
                `⚠️ Telegram polling error #${telegramConsecutiveErrors}`
            );

            error(
                'ERROR:',
                e.message
            );

            error(
                'LAST SUCCESS:',
                telegramLastSuccessAt ||
                    'NEVER'
            );

            error(
                'UPTIME SEC:',
                Math.round(
                    process.uptime()
                )
            );

            const memory =
                process.memoryUsage();

            error(
                'MEMORY RSS MB:',
                Math.round(
                    memory.rss /
                    1024 /
                    1024
                )
            );

            error(
                'HEAP USED MB:',
                Math.round(
                    memory.heapUsed /
                    1024 /
                    1024
                )
            );

            if (
                e.stack
            ) {

                error(
                    'STACK:',
                    e.stack
                );
            }

            error(
                '========================================'
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
// ============================================================

let bitrixOffset = 0;

let bitrixConsecutiveErrors = 0;
let bitrixLastSuccessAt = null;

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

    if (!BITRIX_DIAG_FETCH_ENABLED) {
        warn('🧪 BITRIX DIAG: Bitrix FETCH loop is DISABLED');
        bitrixDiagnosticState.lastFetchResult = 'disabled';
        return;
    }

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

        bitrixDiagnosticState.lastFetchAt = new Date().toISOString();

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

            bitrixConsecutiveErrors = 0;

            bitrixLastSuccessAt =
                new Date().toISOString();

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

            bitrixConsecutiveErrors++;

            error(
                '========================================'
            );

            error(
                `⚠️ Bitrix FETCH error #${bitrixConsecutiveErrors}`
            );

            error(
                'ERROR:',
                e.message
            );

            error(
                'LAST SUCCESS:',
                bitrixLastSuccessAt ||
                    'NEVER'
            );

            error(
                'UPTIME SEC:',
                Math.round(
                    process.uptime()
                )
            );

            const memory =
                process.memoryUsage();

            error(
                'MEMORY RSS MB:',
                Math.round(
                    memory.rss /
                    1024 /
                    1024
                )
            );

            error(
                'HEAP USED MB:',
                Math.round(
                    memory.heapUsed /
                    1024 /
                    1024
                )
            );

            if (
                e.stack
            ) {

                error(
                    'STACK:',
                    e.stack
                );
            }

            error(
                '========================================'
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

async function processConnectorManagerEvent(payload) {
    bitrixDiagnosticState.lastInboundAt = new Date().toISOString();
    bitrixDiag('INBOUND START', {
        event: payload?.event || null,
        connector: payload?.data?.CONNECTOR || null,
        line: payload?.data?.LINE || null
    });

    if (!BITRIX_DIAG_INBOUND_ENABLED) {
        warn('🧪 BITRIX DIAG: Connector inbound processing is DISABLED');
        bitrixDiagnosticState.lastInboundResult = 'disabled';
        return;
    }

    try {
        console.log('========================================');
        console.log('📥 BITRIX OUTBOUND EVENT');
        console.log('EVENT:', payload?.event || '');
        console.log('EVENT HANDLER ID:', payload?.event_handler_id || '');
        console.log('CONNECTOR:', payload?.data?.CONNECTOR || '');
        console.log('LINE:', payload?.data?.LINE || '');
        console.log(
            'MESSAGES COUNT:',
            Array.isArray(payload?.data?.MESSAGES)
                ? payload.data.MESSAGES.length
                : 0
        );

        const data = payload?.data;

        if (!data) {
            console.log('❌ No data in Bitrix event');
            console.log('FULL PAYLOAD:', JSON.stringify(payload));
            console.log('========================================');
            return;
        }

        const connector =
            String(data.CONNECTOR || '').trim();

        if (
            connector.toLowerCase() !==
            String(BITRIX_CONNECTOR_ID || '').toLowerCase()
        ) {
            console.log(
                '⚠️ Ignored connector:',
                connector
            );

            console.log(
                'Expected connector:',
                BITRIX_CONNECTOR_ID
            );

            console.log('========================================');
            return;
        }

        const messages =
            Array.isArray(data.MESSAGES)
                ? data.MESSAGES
                : [];

        if (!messages.length) {
            console.log(
                '⚠️ Bitrix event contains no MESSAGES'
            );

            console.log(
                'FULL DATA:',
                JSON.stringify(data)
            );

            console.log('========================================');
            return;
        }

        for (let index = 0; index < messages.length; index++) {

            const item =
                messages[index] || {};

            const im =
                item.im || {};

            const message =
                item.message || {};

            const chat =
                item.chat || {};

            const externalChatId =
    String(chat.id || '').trim();

const bitrixChatId =
    String(im.chat_id || '').trim();

const mappedTelegramChatId =
    bitrixChatId
        ? String(
            bitrixChatMap.get(bitrixChatId) || ''
        ).trim()
        : '';

const telegramChatId =
    externalChatId ||
    mappedTelegramChatId;

console.log(
    'External chat.id:',
    externalChatId || '(EMPTY)'
);

console.log(
    'Bitrix im.chat_id:',
    bitrixChatId || '(EMPTY)'
);

console.log(
    'Mapped Telegram chat_id:',
    mappedTelegramChatId || '(EMPTY)'
);

console.log(
    'Final Telegram chat_id:',
    telegramChatId || '(EMPTY)'
);

            const bitrixMessageId =
                String(im.message_id || '').trim();

            const managerText =
                String(message.text || '').trim();

            const managerFiles =
                Array.isArray(
                    message.files
                )
                    ? message.files
                    : [];

            console.log('----------------------------------------');
            console.log(
                `📨 BITRIX MESSAGE ${index + 1}`
            );

            console.log(
                'External chat.id:',
                telegramChatId || '(EMPTY)'
            );

            console.log(
                'Bitrix im.chat_id:',
                bitrixChatId || '(EMPTY)'
            );

            console.log(
                'Bitrix im.message_id:',
                bitrixMessageId || '(EMPTY)'
            );

            console.log(
                'Message user_id:',
                message.user_id || '(EMPTY)'
            );

            console.log(
                'Message text:',
                managerText || '(EMPTY)'
            );

            console.log(
                'Manager files:',
                managerFiles.length || '(EMPTY)'
            );

            console.log(
                'RAW MESSAGE:',
                JSON.stringify(item)
            );

            if (!telegramChatId) {
    console.log(
        '❌ Telegram chat_id could not be resolved'
    );

    console.log(
        '❌ Bitrix chat_id:',
        bitrixChatId || '(EMPTY)'
    );

    console.log(
        '❌ No mapping Bitrix chat -> Telegram chat'
    );

    continue;
}

            if (
                !managerText &&
                !managerFiles.length
            ) {
                console.log(
                    '⚠️ Manager message contains no text and no files'
                );

                continue;
            }

            if (bitrixChatId) {
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

                    console.log(
                        '✅ AI mode message sent to Telegram'
                    );
                } catch (e) {
                    console.error(
                        '❌ AI mode Telegram error:',
                        e.message
                    );
                }

                try {
                    await mirrorToAdmin(
                        telegramChatId,
                        'manager',
                        'Команда: AI'
                    );
                } catch (e) {
                    console.error(
                        '⚠️ Admin mirror error:',
                        e.message
                    );
                }

                await confirmConnectorDelivery(
                    data,
                    item
                );

                continue;
            }

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

                    console.log(
                        '✅ MANAGER mode message sent to Telegram'
                    );
                } catch (e) {
                    console.error(
                        '❌ MANAGER mode Telegram error:',
                        e.message
                    );
                }

                try {
                    await mirrorToAdmin(
                        telegramChatId,
                        'manager',
                        'Команда: MANAGER'
                    );
                } catch (e) {
                    console.error(
                        '⚠️ Admin mirror error:',
                        e.message
                    );
                }

                await confirmConnectorDelivery(
                    data,
                    item
                );

                continue;
            }

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

            let telegramSent = false;

            try {

                if (managerText) {

                    const telegramResult =
                        await sendTelegramMessage(
                            telegramChatId,
                            managerText
                        );

                    telegramSent = true;

                    console.log(
                        '✅ TELEGRAM SEND OK'
                    );

                    console.log(
                        'Telegram result:',
                        JSON.stringify(
                            telegramResult || {}
                        )
                    );
                }

                for (
                    const file of managerFiles
                ) {

                    try {

                        await sendTelegramFile(
                            telegramChatId,
                            file.downloadLink,
                            file.name || 'file'
                        );

                        console.log(
                            '✅ Manager file sent to Telegram:',
                            file.name || 'file'
                        );

                        telegramSent = true;

                    } catch (e) {

                        console.error(
                            '❌ Manager file -> Telegram error:',
                            e.message
                        );
                    }
                }

            } catch (e) {

                console.error(
                    '❌ TELEGRAM SEND ERROR:',
                    e.message
                );

                if (e.stack) {
                    console.error(
                        e.stack
                    );
                }
            }

            try {

                await mirrorToAdmin(
                    telegramChatId,
                    'manager',
                    managerText || '[файл]'
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

            try {

                await confirmConnectorDelivery(
                    data,
                    item
                );

                console.log(
                    '✅ BITRIX DELIVERY CONFIRMED'
                );

            } catch (e) {

                console.error(
                    '❌ BITRIX DELIVERY CONFIRM ERROR:',
                    e.message
                );
            }

            console.log(
                'Telegram sent:',
                telegramSent
            );
        }

        console.log('========================================');

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
            JSON.stringify(payload)
        );

        console.log('========================================');
    }
}

// ============================================================
// 19. CONNECTOR DELIVERY
// ============================================================

async function confirmConnectorDelivery(
    data,
    item
) {

    bitrixDiagnosticState.lastDeliveryAt = new Date().toISOString();
    bitrixDiag('DELIVERY CONFIRM START');

    if (!BITRIX_DIAG_DELIVERY_ENABLED) {
        warn('🧪 BITRIX DIAG: Connector delivery confirmation is DISABLED');
        bitrixDiagnosticState.lastDeliveryResult = 'disabled';
        return;
    }

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

        bitrixDiagnosticState.lastDeliveryResult = 'success';
        bitrixDiag('DELIVERY CONFIRM SUCCESS');

    } catch (e) {

        error(
            'Connector delivery error:',
            e.message
        );
    }
}

// ============================================================
// BITRIX CONNECTOR PAYLOAD PARSER
// ============================================================

function parseBitrixFormBody(body) {

    const payload = {};

    const params =
        new URLSearchParams(
            String(body || '')
        );

    for (
        const [key, value]
        of params.entries()
    ) {

        const parts =
            String(key)
                .replace(
                    /\[([^\]]*)\]/g,
                    '.$1'
                )
                .split('.')
                .filter(Boolean);

        if (!parts.length) {
            continue;
        }

        let current =
            payload;

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
                typeof current[part] !== 'object'
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

    return payload;
}


function normalizeConnectorPayload(payload) {

    if (
        !payload ||
        typeof payload !== 'object'
    ) {
        return {};
    }

    // --------------------------------------------------------
    // JSON payload уже имеет нормальную структуру
    // --------------------------------------------------------

    const normalized = {
        ...payload
    };

    // --------------------------------------------------------
    // Иногда Bitrix присылает data как JSON-строку
    // --------------------------------------------------------

    if (
        typeof normalized.data === 'string'
    ) {

        try {

            const parsed =
                JSON.parse(
                    normalized.data
                );

            if (
                parsed &&
                typeof parsed === 'object'
            ) {

                normalized.data =
                    parsed;
            }

        } catch (e) {
            // Оставляем исходное значение.
        }
    }

    // --------------------------------------------------------
    // Иногда event приходит в другом регистре
    // --------------------------------------------------------

    if (
        !normalized.event &&
        normalized.EVENT
    ) {

        normalized.event =
            normalized.EVENT;
    }

    // --------------------------------------------------------
    // Нормализуем DATA
    // --------------------------------------------------------

    if (
        !normalized.data &&
        normalized.DATA
    ) {

        normalized.data =
            normalized.DATA;
    }

    return normalized;
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
                // BITRIX FILE ENDPOINT
                // ==================================================

                if (
                    req.method === 'GET' &&
                    url.pathname.startsWith(
                        '/bitrix-file/'
                    )
                ) {

                    try {

                        const token =
                            decodeURIComponent(
                                url.pathname
                                    .substring(
                                        '/bitrix-file/'.length
                                    )
                                    .split('?')[0]
                            );

                        const entry =
                            bitrixTempFiles.get(
                                token
                            );

                        if (!entry) {

                            res.writeHead(
                                404,
                                {
                                    'Content-Type':
                                        'text/plain; charset=utf-8'
                                }
                            );

                            res.end(
                                'File not found or expired'
                            );

                            return;
                        }

                        // Файл доступен 30 минут
                        if (
                            Date.now() -
                                entry.createdAt >
                            30 * 60 * 1000
                        ) {

                            try {
                                fs.unlinkSync(
                                    entry.filePath
                                );
                            } catch {}

                            bitrixTempFiles.delete(
                                token
                            );

                            res.writeHead(
                                410,
                                {
                                    'Content-Type':
                                        'text/plain; charset=utf-8'
                                }
                            );

                            res.end(
                                'File expired'
                            );

                            return;
                        }

                        if (
                            !fs.existsSync(
                                entry.filePath
                            )
                        ) {

                            bitrixTempFiles.delete(
                                token
                            );

                            res.writeHead(
                                404,
                                {
                                    'Content-Type':
                                        'text/plain; charset=utf-8'
                                }
                            );

                            res.end(
                                'File not found'
                            );

                            return;
                        }

                        const stat =
                            fs.statSync(
                                entry.filePath
                            );

                        res.writeHead(
                            200,
                            {
                                'Content-Type':
                                    'application/octet-stream',

                                'Content-Length':
                                    stat.size,

                                'Content-Disposition':
                                    `attachment; filename="${encodeURIComponent(entry.fileName)}"`
                            }
                        );

                        fs.createReadStream(
                            entry.filePath
                        ).pipe(res);

                        log(
                            '📤 Bitrix downloaded temporary file:',
                            entry.fileName
                        );

                        return;

                    } catch (e) {

                        error(
                            '❌ Bitrix temporary file error:',
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

                        return;
                    }
                }

                // ==================================================
                // HEALTH
                // ==================================================

                if (
                    url.pathname ===
                    '/health'
                ) {

                    const memory =
                        process.memoryUsage();

                    const health = {
                        ok: true,

                        timestamp:
                            new Date().toISOString(),

                        uptimeSec:
                            Math.round(
                                process.uptime()
                            ),

                        pid:
                            process.pid,

                        memory: {
                            rssMb:
                                Math.round(
                                    memory.rss /
                                    1024 /
                                    1024
                                ),

                            heapUsedMb:
                                Math.round(
                                    memory.heapUsed /
                                    1024 /
                                    1024
                                ),

                            heapTotalMb:
                                Math.round(
                                    memory.heapTotal /
                                    1024 /
                                    1024
                                )
                        },

                        telegram: {
                            configured:
                                !!BOT_TOKEN,

                            consecutiveErrors:
                                telegramConsecutiveErrors,

                            lastSuccessAt:
                                telegramLastSuccessAt
                        },

                        bitrixFetch: {
                            configured:
                                !!(
                                    BITRIX_WEBHOOK_URL &&
                                    BITRIX_BOT_TOKEN
                                ),

                            consecutiveErrors:
                                bitrixConsecutiveErrors,

                            lastSuccessAt:
                                bitrixLastSuccessAt
                        },

                        connector: {
                            enabled:
                                BITRIX_CONNECTOR_ENABLED,

                            oauth:
                                !!(
                                    bitrixAuth &&
                                    bitrixAuth.access_token
                                ),

                            ready:
                                connectorReady,

                            openLine:
                                bitrixOpenLineId,

                            connectorId:
                                BITRIX_CONNECTOR_ID
                        },

                        diagnostic: {
                            enabled:
                                BITRIX_DIAGNOSTIC_MODE,

                            switches: {
                                fetch:
                                    BITRIX_DIAG_FETCH_ENABLED,
                                connectorSetup:
                                    BITRIX_DIAG_CONNECTOR_SETUP_ENABLED,
                                outbound:
                                    BITRIX_DIAG_OUTBOUND_ENABLED,
                                inbound:
                                    BITRIX_DIAG_INBOUND_ENABLED,
                                delivery:
                                    BITRIX_DIAG_DELIVERY_ENABLED,
                                oauthRefresh:
                                    BITRIX_DIAG_OAUTH_REFRESH_ENABLED
                            },

                            state:
                                bitrixDiagnosticState
                        }
                    };

                    res.writeHead(
                        200,
                        {
                            'Content-Type':
                                'application/json'
                        }
                    );

                    res.end(
                        JSON.stringify(
                            health
                        )
                    );

                    return;
                }

                // ==================================================
// BITRIX INITIAL INSTALLATION CALLBACK
// ==================================================

if (
    url.pathname ===
    '/bitrix-webhook'
) {

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
            JSON.stringify({
                status: 'error',
                message:
                    'Unable to read request body'
            })
        );

        return;
    }

    let payload = {};
    let auth = {};

    const contentType =
        String(
            req.headers['content-type'] ||
            ''
        ).toLowerCase();

    try {

        if (
            contentType.includes(
                'application/json'
            )
        ) {

            payload =
                body
                    ? JSON.parse(body)
                    : {};

        }

        else {

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

            for (
                const [
                    key,
                    value
                ] of params.entries()
            ) {

                const match =
                    key.match(
                        /^auth\[(.+)\]$/
                    );

                if (match) {

                    auth[
                        match[1]
                    ] = value;
                }
            }

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
                }
            }
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
            JSON.stringify({
                status: 'error',
                message:
                    'Invalid Bitrix installation request'
            })
        );

        return;
    }

    if (
        payload.auth &&
        typeof payload.auth ===
            'object'
    ) {

        auth = {
            ...auth,
            ...payload.auth
        };
    }

    if (
        !auth.access_token &&
        payload.access_token
    ) {

        auth.access_token =
            payload.access_token;
    }

    if (
        !auth.refresh_token &&
        payload.refresh_token
    ) {

        auth.refresh_token =
            payload.refresh_token;
    }

    if (
        !auth.domain &&
        payload.domain
    ) {

        auth.domain =
            payload.domain;
    }

    if (
        !auth.client_endpoint &&
        payload.client_endpoint
    ) {

        auth.client_endpoint =
            payload.client_endpoint;
    }

    log(
        '========================================'
    );

    log(
        '📥 BITRIX INSTALL CALLBACK'
    );

    log(
        'CONTENT-TYPE:',
        contentType || 'unknown'
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

    if (
        auth.access_token &&
        auth.refresh_token
    ) {

        bitrixAuth = {
            ...auth
        };

        if (
            !bitrixAuth.domain &&
            BITRIX_DOMAIN
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
                JSON.stringify({
                    status: 'error',
                    message:
                        'OAuth received but could not be saved'
                })
            );

            return;
        }

        setImmediate(
            () => {

                setupConnector()
                    .then(
                        () => {

                            log(
                                '========================================'
                            );

                            if (connectorReady) {

                                log(
                                    '✅ BITRIX CONNECTOR READY AFTER INSTALL'
                                );

                            } else {

                                warn(
                                    '⚠️ BITRIX CONNECTOR NOT READY AFTER INSTALL'
                                );

                            }

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

        res.writeHead(
            200,
            {
                'Content-Type':
                    'application/json'
            }
        );

        res.end(
            JSON.stringify({
                status:
                    'success'
            })
        );

        return;
    }

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

    } catch (e) {}

    res.writeHead(
        400,
        {
            'Content-Type':
                'application/json'
        }
    );

    res.end(
        JSON.stringify({
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
        })
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

                    if (
                        req.method === 'POST'
                    ) {

                        const body =
                            await readRequestBody(
                                req
                            );

                        let payload = {};

                        try {

                            if (
                                typeof body === 'string' &&
                                body.trim().startsWith('{')
                            ) {

                                payload =
                                    JSON.parse(body);

                            } else {

                                payload =
                                    parseBitrixFormBody(body);
                            }

                            payload =
                                normalizeConnectorPayload(
                                    payload
                                );

                        } catch (e) {

                            error(
                                'Bitrix request parse error:',
                                e.message
                            );

                            payload = {};
                        }

                        log(
                            '📥 Bitrix Connector POST:',
                            payload.event ||
                            'unknown'
                        );

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

                            const connector =
                                data.CONNECTOR ||
                                '';

                            const line =
                                data.LINE ||
                                '';

                            const messages =
                                Array.isArray(
                                    data.MESSAGES
                                )
                                    ? data.MESSAGES
                                    : [];

                            log(
                                '🔎 Parsed Connector:',
                                connector ||
                                '(EMPTY)'
                            );

                            log(
                                '🔎 Parsed Line:',
                                line ||
                                '(EMPTY)'
                            );

                            log(
                                '🔎 Parsed Messages:',
                                messages.length
                            );

                            if (
                                messages.length > 0
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
                                    'application/json; charset=utf-8'
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

    bitrixDiag('STARTUP CONFIG', {
        connectorEnabled: BITRIX_CONNECTOR_ENABLED,
        diagnosticMode: BITRIX_DIAGNOSTIC_MODE,
        fetchEnabled: BITRIX_DIAG_FETCH_ENABLED,
        connectorSetupEnabled: BITRIX_DIAG_CONNECTOR_SETUP_ENABLED,
        outboundEnabled: BITRIX_DIAG_OUTBOUND_ENABLED,
        inboundEnabled: BITRIX_DIAG_INBOUND_ENABLED,
        deliveryEnabled: BITRIX_DIAG_DELIVERY_ENABLED,
        oauthRefreshEnabled: BITRIX_DIAG_OAUTH_REFRESH_ENABLED,
        dataDir: DATA_DIR,
        authFile: AUTH_FILE,
        authLoaded: !!(bitrixAuth && bitrixAuth.access_token),
        authDomain: bitrixAuth?.domain || BITRIX_DOMAIN || null
    });

    server.listen(
        PORT,
        '0.0.0.0',
        () => {

            log(
                `🚀 Server started on port ${PORT}`
            );
        }
    );

    telegramPoll()
        .catch(
            e =>
                error(
                    'Telegram fatal:',
                    e.message
                )
        );

    bitrixFetchPoll()
        .catch(
            e =>
                error(
                    'Bitrix FETCH fatal:',
                    e.message
                )
        );

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

    error(
        '========================================'
    );

    error(
        `🛑 ${signal} RECEIVED`
    );

    error(
        'PID:',
        process.pid
    );

    error(
        'UPTIME SEC:',
        Math.round(
            process.uptime()
        )
    );

    const memory =
        process.memoryUsage();

    error(
        'MEMORY RSS MB:',
        Math.round(
            memory.rss /
            1024 /
            1024
        )
    );

    error(
        'HEAP USED MB:',
        Math.round(
            memory.heapUsed /
            1024 /
            1024
        )
    );

    error(
        'HEAP TOTAL MB:',
        Math.round(
            memory.heapTotal /
            1024 /
            1024
        )
    );

    error(
        'TIMESTAMP:',
        new Date().toISOString()
    );

    error(
        '========================================'
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

process.on('unhandledRejection', reason => {
    error('========================================');
    error('💥 UNHANDLED REJECTION');

    error(
        'NAME:',
        reason?.name || 'Unknown'
    );

    error(
        'MESSAGE:',
        reason?.message || String(reason)
    );

    error(
        'CODE:',
        reason?.code || reason?.cause?.code || null
    );

    error(
        'ERRNO:',
        reason?.errno || reason?.cause?.errno || null
    );

    error(
        'SYSCALL:',
        reason?.syscall || reason?.cause?.syscall || null
    );

    error(
        'CAUSE NAME:',
        reason?.cause?.name || null
    );

    error(
        'CAUSE MESSAGE:',
        reason?.cause?.message || null
    );

    error(
        'CAUSE CODE:',
        reason?.cause?.code || null
    );

    error(
        'UPTIME SEC:',
        Math.round(process.uptime())
    );

    const memory = process.memoryUsage();

    error(
        'MEMORY RSS MB:',
        Math.round(
            memory.rss / 1024 / 1024
        )
    );

    error(
        'HEAP USED MB:',
        Math.round(
            memory.heapUsed / 1024 / 1024
        )
    );

    if (reason?.stack) {
        error(
            'STACK:',
            reason.stack
        );
    }

    error('========================================');
});

process.on(
    'uncaughtException',
    err => {

        error(
            '========================================'
        );

        error(
            '💥 UNCAUGHT EXCEPTION'
        );

        error(
            'NAME:',
            err?.name ||
                'Error'
        );

        error(
            'MESSAGE:',
            err?.message ||
                String(err)
        );

        error(
            'CODE:',
            err?.code ||
                null
        );

        error(
            'UPTIME SEC:',
            Math.round(
                process.uptime()
            )
        );

        const memory =
            process.memoryUsage();

        error(
            'MEMORY RSS MB:',
            Math.round(
                memory.rss /
                1024 /
                1024
            )
        );

        error(
            'HEAP USED MB:',
            Math.round(
                memory.heapUsed /
                1024 /
                1024
            )
        );

        if (
            err?.stack
        ) {

            error(
                'STACK:',
                err.stack
            );
        }

        error(
            '========================================'
        );
    }
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