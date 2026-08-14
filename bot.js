'use strict';

/* =========================================================
   MLK BOT — Telegram + DeepSeek + Bitrix24 (im.v2 + Connector)
   Версия 2.0 — с дублированием в Open Line и управлением режимами
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

// ============================================================
// 1. КОНФИГУРАЦИЯ (из переменных окружения)
// ============================================================

const PORT = Number(process.env.PORT || 10000);

// Telegram
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

// DeepSeek
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const DEEPSEEK_MODEL = 'deepseek-chat';  // фиксируем модель

// Bitrix Webhook (старый контур)
const BITRIX_WEBHOOK_URL = (process.env.BITRIX_WEBHOOK_URL || '').trim();
const BITRIX_BOT_TOKEN = (process.env.BITRIX_BOT_TOKEN || '').trim();
const BITRIX_BOT_ID = Number(process.env.BITRIX_BOT_ID || 0);

// Bitrix Connector / Open Line (новый контур)
const BITRIX_CONNECTOR_ENABLED = (process.env.BITRIX_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true';
const BITRIX_CONNECTOR_ID = (process.env.BITRIX_CONNECTOR_ID || 'mlk_telegram').trim();
const BITRIX_CONNECTOR_NAME = (process.env.BITRIX_CONNECTOR_NAME || 'MLK Telegram').trim();
const BITRIX_DOMAIN = (process.env.BITRIX_DOMAIN || 'b24-2fqomj.bitrix24.by').trim();
const BITRIX_CLIENT_ID = (process.env.BITRIX_CLIENT_ID || '').trim();
const BITRIX_CLIENT_SECRET = (process.env.BITRIX_CLIENT_SECRET || '').trim();

// Публичный URL (для handler)
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

// Handler URL — фикс синтаксической ошибки
const BITRIX_HANDLER_URL = String(
    process.env.BITRIX_HANDLER_URL ||
    (PUBLIC_BASE_URL ? PUBLIC_BASE_URL + '/bitrix/handler' : '')
).trim();

const BITRIX_POLL_INTERVAL_MS = 3000;

// Файл для хранения OAuth токенов
const DATA_DIR = fs.existsSync('/data') ? '/data' : '/tmp';
const AUTH_FILE = path.join(DATA_DIR, 'bitrix-auth.json');
const OFFSET_FILE = path.join(DATA_DIR, 'bitrix-offset.json');

// ============================================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function log(...args) { console.log(...args); }
function warn(...args) { console.warn(...args); }
function error(...args) { console.error(...args); }

function secretStatus(value) { return value ? 'OK' : 'MISSING'; }

// Чтение тела запроса
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); if (body.length > 10*1024*1024) { reject(new Error('Body too large')); req.destroy(); } });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

// Универсальный fetch с JSON
async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch(e) { throw new Error(`Invalid JSON: ${text.slice(0, 200)}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
    return data;
}

// ============================================================
// 3. РАБОТА С AUTH (OAuth)
// ============================================================

function ensureDataDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
}

function loadAuth() {
    ensureDataDir();
    try {
        if (!fs.existsSync(AUTH_FILE)) return null;
        const raw = fs.readFileSync(AUTH_FILE, 'utf8');
        const data = JSON.parse(raw);
        return data && data.access_token ? data : null;
    } catch(e) { error('Auth load error:', e.message); return null; }
}

function saveAuth(auth) {
    ensureDataDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 });
}

let bitrixAuth = loadAuth();

// ============================================================
// 4. BITRIX WEBHOOK (старый контур)
// ============================================================

async function bitrixWebhookCall(method, params = {}) {
    if (!BITRIX_WEBHOOK_URL) throw new Error('BITRIX_WEBHOOK_URL missing');
    const url = BITRIX_WEBHOOK_URL.replace(/\/+$/, '') + '/' + method;
    return fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
}

// ============================================================
// 5. BITRIX OAUTH (новый контур для Connector)
// ============================================================

async function refreshBitrixOAuth() {
    if (!BITRIX_CLIENT_ID || !BITRIX_CLIENT_SECRET || !bitrixAuth || !bitrixAuth.refresh_token) {
        throw new Error('OAuth refresh unavailable');
    }
    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('client_id', BITRIX_CLIENT_ID);
    params.set('client_secret', BITRIX_CLIENT_SECRET);
    params.set('refresh_token', bitrixAuth.refresh_token);
    const data = await fetchJson('https://oauth.bitrix.info/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    if (!data || !data.access_token) throw new Error('OAuth refresh failed');
    bitrixAuth = { ...bitrixAuth, ...data };
    saveAuth(bitrixAuth);
    log('✅ OAuth refreshed');
    return bitrixAuth;
}

async function bitrixOAuthCall(method, params = {}, retry = true) {
    if (!bitrixAuth || !bitrixAuth.access_token) throw new Error('OAuth not installed');
    const endpoint = `https://${bitrixAuth.domain || BITRIX_DOMAIN}/rest/${method}`;
    const body = { ...params, auth: bitrixAuth.access_token };
    try {
        const data = await fetchJson(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (data && (data.error === 'expired_token' || data.error === 'NO_AUTH_FOUND') && retry) {
            await refreshBitrixOAuth();
            return bitrixOAuthCall(method, params, false);
        }
        if (data && data.error) throw new Error(`Bitrix ${data.error}: ${data.error_description || ''}`);
        return data;
    } catch(e) {
        throw new Error(`Bitrix OAuth call failed: ${e.message}`);
    }
}

// ============================================================
// 6. TELEGRAM API
// ============================================================

const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';

async function telegramCall(method, params = {}) {
    if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
    return fetchJson(`${TELEGRAM_API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
}

async function sendTelegramMessage(chatId, text, extra = {}) {
    if (!text) return null;
    const chunks = [];
    for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i+4000));
    let last = null;
    for (const chunk of chunks) {
        last = await telegramCall('sendMessage', { chat_id: chatId, text: chunk, ...extra });
    }
    return last;
}

async function answerTelegramCallback(callbackQueryId, text = '') {
    try {
        await telegramCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
    } catch(e) { warn('Callback answer error:', e.message); }
}

// ============================================================
// 7. DEEPSEEK
// ============================================================

async function askDeepSeek(userText) {
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing');
    const data = await fetchJson('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
                { role: 'system', content: 'Ты ИИ-консультант компании MLK. Отвечай кратко и по существу.' },
                { role: 'user', content: userText }
            ],
            stream: false,
            max_tokens: 500
        })
    });
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('Empty answer from DeepSeek');
    return answer.trim();
}

// ============================================================
// 8. СОСТОЯНИЕ КЛИЕНТОВ И РЕЖИМЫ
// ============================================================

const clients = new Map();          // telegramId -> { mode: 'AI'|'MANAGER', name, username }
const adminMessageMap = new Map();  // telegram message_id -> clientId (для reply)
const bitrixChatMap = new Map();    // bitrix internal chat_id -> telegramId

function getClient(clientId) {
    const key = String(clientId);
    if (!clients.has(key)) {
        clients.set(key, { mode: 'AI', name: '', username: '', lastSeen: Date.now() });
    }
    const client = clients.get(key);
    client.lastSeen = Date.now();
    return client;
}

function setClientMode(clientId, mode) {
    const client = getClient(clientId);
    client.mode = (mode === 'MANAGER') ? 'MANAGER' : 'AI';
    return client;
}

// ============================================================
// 9. ОТПРАВКА В BITRIX OPEN LINE (Connector)
// ============================================================

let bitrixOpenLineId = null;

async function findOpenLine() {
    const result = await bitrixOAuthCall('imopenlines.config.list.get', {
        PARAMS: {
            select: ['ID', 'LINE_NAME', 'ACTIVE'],
            filter: { ACTIVE: 'Y' },
            limit: 50
        }
    });
    const lines = result?.result || [];
    if (!Array.isArray(lines) || lines.length === 0) throw new Error('No active Open Lines');
    // Ищем линию с "Telegram" в названии
    const telegramLine = lines.find(l => String(l.LINE_NAME || '').toLowerCase().includes('telegram'));
    const line = telegramLine || lines[0];
    bitrixOpenLineId = Number(line.ID);
    log('✅ Open Line found:', bitrixOpenLineId, line.LINE_NAME);
    return line;
}

async function ensureOpenLine() {
    if (!bitrixOpenLineId) {
        await findOpenLine();
    }
    return bitrixOpenLineId;
}

async function sendToBitrixConnector(clientId, text, senderType = 'client', telegramUser = null) {
    if (!BITRIX_CONNECTOR_ENABLED) return null;
    if (!bitrixAuth || !bitrixAuth.access_token) {
        warn('⚠️ Connector OAuth unavailable');
        return null;
    }
    await ensureOpenLine();

    const user = {
        id: String(clientId),
        name: telegramUser?.first_name || 'Клиент',
        last_name: telegramUser?.last_name || '',
        url: telegramUser?.username ? `https://t.me/${telegramUser.username}` : '',
        skip_phone_validate: 'Y'
    };
    if (senderType === 'manager') {
        user.id = `telegram_manager_${clientId}`;
        user.name = 'Менеджер';
        user.last_name = 'Telegram';
    }
    const messageId = `tg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const result = await bitrixOAuthCall('imconnector.send.messages', {
        CONNECTOR: BITRIX_CONNECTOR_ID,
        LINE: bitrixOpenLineId,
        MESSAGES: [{
            user,
            message: { id: messageId, date: Math.floor(Date.now()/1000), text },
            chat: { id: String(clientId), name: user.name || 'Telegram', url: PUBLIC_BASE_URL || '' }
        }]
    });
    // Сохраняем маппинг чата
    try {
        const item = result?.result?.DATA?.RESULT?.[0];
        if (item?.session?.CHAT_ID) {
            bitrixChatMap.set(String(item.session.CHAT_ID), String(clientId));
        }
    } catch(e) {}
    return result;
}

// ============================================================
// 10. ОБРАБОТКА СООБЩЕНИЙ В TELEGRAM
// ============================================================

async function mirrorToAdmin(clientId, sender, text) {
    if (!ADMIN_CHAT_ID) return;
    const client = getClient(clientId);
    const label = sender === 'client' ? '👤 Клиент' : sender === 'ai' ? '🤖 AI' : '👨‍💼 Менеджер';
    const message = `${label}\nTelegram ID: ${clientId}\nРежим: ${client.mode}\n\n${text}`;
    try {
        const result = await sendTelegramMessage(ADMIN_CHAT_ID, message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 MANAGER', callback_data: `manager:${clientId}` },
                     { text: '🤖 AI', callback_data: `ai:${clientId}` }]
                ]
            }
        });
        const msg = result?.result;
        if (msg?.message_id) {
            adminMessageMap.set(String(msg.message_id), String(clientId));
        }
    } catch(e) { error('Mirror to admin error:', e.message); }
}

async function processTelegramClientMessage(message) {
    if (!message?.chat?.id || !message.text) return;
    const clientId = String(message.chat.id);
    const text = String(message.text).trim();
    if (!text) return;

    const client = getClient(clientId);
    client.name = message.from?.first_name || '';
    client.username = message.from?.username || '';

    log(`📨 Client ${clientId}: ${text}`);

    // Дублируем клиенту в админский чат
    await mirrorToAdmin(clientId, 'client', text);

    // Отправляем в Bitrix Connector
    try {
        await sendToBitrixConnector(clientId, text, 'client', message.from);
    } catch(e) { error('Send to Bitrix connector error:', e.message); }

    // Если режим MANAGER — не отвечаем AI
    if (client.mode === 'MANAGER') {
        log('⏸ AI skipped, MANAGER mode');
        return;
    }

    // AI ответ
    try {
        const answer = await askDeepSeek(text);
        await sendTelegramMessage(clientId, answer);
        await mirrorToAdmin(clientId, 'ai', answer);
        try {
            await sendToBitrixConnector(clientId, answer, 'ai', message.from);
        } catch(e) { error('AI to Bitrix error:', e.message); }
    } catch(e) {
        error('DeepSeek error:', e.message);
        await sendTelegramMessage(clientId, 'Извините, произошла ошибка. Менеджер подключится.');
        setClientMode(clientId, 'MANAGER');
    }
}

async function processTelegramAdminMessage(message) {
    if (!ADMIN_CHAT_ID || String(message.chat.id) !== String(ADMIN_CHAT_ID)) return;
    const text = String(message.text).trim();
    if (!text) return;

    // Обработка команд /ai и /manager
    if (text.startsWith('/ai ')) {
        const clientId = text.slice(4).trim();
        if (clientId) {
            setClientMode(clientId, 'AI');
            await sendTelegramMessage(ADMIN_CHAT_ID, `🤖 AI для ${clientId}`);
        }
        return;
    }
    if (text.startsWith('/manager ')) {
        const clientId = text.slice(9).trim();
        if (clientId) {
            setClientMode(clientId, 'MANAGER');
            await sendTelegramMessage(ADMIN_CHAT_ID, `👤 MANAGER для ${clientId}`);
        }
        return;
    }

    // Если это reply на сообщение админа, находим клиента
    const replyId = message.reply_to_message?.message_id;
    let clientId = null;
    if (replyId) {
        clientId = adminMessageMap.get(String(replyId)) || null;
    }
    if (!clientId) return;

    setClientMode(clientId, 'MANAGER');
    await sendTelegramMessage(clientId, text);
    try {
        await sendToBitrixConnector(clientId, text, 'manager', { first_name: 'Менеджер' });
    } catch(e) { error('Manager to Bitrix error:', e.message); }
    await sendTelegramMessage(ADMIN_CHAT_ID, `👤 Сообщение отправлено клиенту ${clientId}`);
}

async function processTelegramCallback(callbackQuery) {
    if (!callbackQuery?.data) return;
    if (!ADMIN_CHAT_ID || String(callbackQuery.message.chat.id) !== String(ADMIN_CHAT_ID)) return;

    const data = callbackQuery.data;
    const [action, clientId] = data.split(':');
    if (!clientId) return;

    if (action === 'manager') {
        setClientMode(clientId, 'MANAGER');
        await answerTelegramCallback(callbackQuery.id, 'Менеджер подключён');
        await sendTelegramMessage(ADMIN_CHAT_ID, `👤 MANAGER для ${clientId}`);
    } else if (action === 'ai') {
        setClientMode(clientId, 'AI');
        await answerTelegramCallback(callbackQuery.id, 'AI включён');
        await sendTelegramMessage(ADMIN_CHAT_ID, `🤖 AI для ${clientId}`);
    }
}

// ============================================================
// 11. TELEGRAM POLLING
// ============================================================

let telegramOffset = 0;

async function telegramPoll() {
    if (!BOT_TOKEN) {
        warn('Telegram disabled: BOT_TOKEN missing');
        return;
    }
    log('🚀 Telegram polling started');
    while (true) {
        try {
            const result = await telegramCall('getUpdates', {
                offset: telegramOffset,
                limit: 100,
                timeout: 30,
                allowed_updates: ['message', 'callback_query']
            });
            const updates = result?.result || [];
            for (const update of updates) {
                telegramOffset = Number(update.update_id) + 1;
                try {
                    if (update.callback_query) {
                        await processTelegramCallback(update.callback_query);
                    } else if (update.message) {
                        const msg = update.message;
                        if (ADMIN_CHAT_ID && String(msg.chat.id) === String(ADMIN_CHAT_ID)) {
                            await processTelegramAdminMessage(msg);
                        } else {
                            await processTelegramClientMessage(msg);
                        }
                    }
                } catch(e) { error('Update error:', e.message); }
            }
        } catch(e) {
            error('Telegram polling error:', e.message);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// ============================================================
// 12. BITRIX FETCH (старый контур)
// ============================================================

let bitrixOffset = 0;

function loadBitrixOffset() {
    try {
        if (fs.existsSync(OFFSET_FILE)) {
            const data = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8'));
            bitrixOffset = data.offset || 0;
        }
    } catch(e) { error('Offset load error:', e.message); }
}
loadBitrixOffset();

function saveBitrixOffset(offset) {
    try {
        fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset, savedAt: new Date().toISOString() }), 'utf8');
    } catch(e) { error('Offset save error:', e.message); }
}

async function bitrixFetchPoll() {
    if (!BITRIX_WEBHOOK_URL || !BITRIX_BOT_TOKEN) {
        warn('Bitrix internal bot disabled');
        return;
    }
    log('🚀 Bitrix fetch loop started');
    while (true) {
        try {
            const result = await bitrixWebhookCall('imbot.v2.Event.get', {
                botId: BITRIX_BOT_ID,
                botToken: BITRIX_BOT_TOKEN,
                offset: bitrixOffset,
                limit: 50
            });
            const payload = result?.result || {};
            const events = payload.events || [];
            const nextOffset = payload.nextOffset ?? bitrixOffset;
            if (events.length > 0) log(`📦 Bitrix events: ${events.length}`);
            bitrixOffset = Number(nextOffset);
            saveBitrixOffset(bitrixOffset);

            for (const event of events) {
                try {
                    if (event.type === 'ONIMBOTV2MESSAGEADD') {
                        const data = event.data || {};
                        const text = String(data.message?.text || '').trim();
                        const dialogId = data.chat?.dialogId || data.chat?.id;
                        if (text && dialogId) {
                            // Отвечаем DeepSeek (старый контур)
                            const answer = await askDeepSeek(text);
                            await bitrixWebhookCall('imbot.v2.Chat.Message.send', {
                                BOT_ID: BITRIX_BOT_ID,
                                DIALOG_ID: dialogId,
                                MESSAGE: answer
                            });
                        }
                    }
                } catch(e) { error('Bitrix event error:', e.message); }
            }
        } catch(e) {
            error('Bitrix fetch error:', e.message);
        }
        await new Promise(resolve => setTimeout(resolve, BITRIX_POLL_INTERVAL_MS));
    }
}

// ============================================================
// 13. BITRIX CONNECTOR HANDLER (для сообщений от менеджера в Open Line)
// ============================================================

async function processConnectorManagerEvent(payload) {
    const data = payload?.data;
    if (!data) return;
    if (String(data.CONNECTOR || '').toLowerCase() !== BITRIX_CONNECTOR_ID.toLowerCase()) return;

    const messages = Array.isArray(data.MESSAGES) ? data.MESSAGES : [];
    for (const item of messages) {
        const chat = item.chat || {};
        const message = item.message || {};
        const im = item.im || {};
        const clientId = String(chat.id || '');
        if (!clientId) continue;
        if (im.chat_id) bitrixChatMap.set(String(im.chat_id), clientId);

        const managerText = String(message.text || '').trim();
        if (!managerText) continue;

        // Команды: #AI, #MANAGER
        if (managerText === '#AI' || managerText === '/ai') {
            setClientMode(clientId, 'AI');
            await sendTelegramMessage(clientId, '🤖 AI подключён');
            await mirrorToAdmin(clientId, 'manager', 'Команда: AI');
            continue;
        }
        if (managerText === '#MANAGER' || managerText === '/manager') {
            setClientMode(clientId, 'MANAGER');
            await sendTelegramMessage(clientId, '👤 Диалог передан менеджеру');
            await mirrorToAdmin(clientId, 'manager', 'Команда: MANAGER');
            continue;
        }

        // Обычное сообщение — переключаем в MANAGER
        setClientMode(clientId, 'MANAGER');
        await sendTelegramMessage(clientId, managerText);
        await mirrorToAdmin(clientId, 'manager', managerText);

        // Подтверждение доставки в Bitrix
        try {
            await bitrixOAuthCall('imconnector.send.status.delivery', {
                CONNECTOR: BITRIX_CONNECTOR_ID,
                LINE: Number(data.LINE),
                MESSAGES: [{
                    im: { chat_id: Number(im.chat_id), message_id: Number(im.message_id) },
                    message: { id: [String(message.id || `bitrix_${Date.now()}`)], date: Math.floor(Date.now()/1000) },
                    chat: { id: clientId }
                }]
            });
        } catch(e) { error('Delivery status error:', e.message); }
    }
}

// ============================================================
// 14. HTTP СЕРВЕР
// ============================================================

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        // Health
        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                telegram: !!BOT_TOKEN,
                bitrix: !!BITRIX_WEBHOOK_URL,
                connector: BITRIX_CONNECTOR_ENABLED,
                oauth: !!(bitrixAuth && bitrixAuth.access_token),
                openLine: bitrixOpenLineId
            }));
            return;
        }
        // OAuth авторизация (ручная)
        if (url.pathname === '/bitrix/oauth') {
            if (!BITRIX_CLIENT_ID) {
                res.writeHead(500); res.end('BITRIX_CLIENT_ID missing'); return;
            }
            const oauthUrl = new URL(`https://${BITRIX_DOMAIN}/oauth/authorize/`);
            oauthUrl.searchParams.set('client_id', BITRIX_CLIENT_ID);
            res.writeHead(302, { Location: oauthUrl.toString() });
            res.end();
            return;
        }
        // OAuth callback
        if (url.pathname === '/bitrix/oauth/callback') {
            const code = url.searchParams.get('code');
            if (!code) { res.writeHead(400); res.end('No code'); return; }
            try {
                const params = new URLSearchParams();
                params.set('grant_type', 'authorization_code');
                params.set('client_id', BITRIX_CLIENT_ID);
                params.set('client_secret', BITRIX_CLIENT_SECRET);
                params.set('code', code);
                const auth = await fetchJson('https://oauth.bitrix.info/oauth/token/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });
                if (!auth || !auth.access_token) throw new Error('Invalid token response');
                bitrixAuth = auth;
                saveAuth(bitrixAuth);
                // Инициализируем Connector
                await findOpenLine();
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h2>OAuth успешно получен</h2></body></html>');
            } catch(e) {
                error('OAuth callback error:', e.message);
                res.writeHead(500); res.end('OAuth error');
            }
            return;
        }
        // Bitrix handler (для Connector событий)
        if (url.pathname === '/bitrix/handler') {
            const body = await readRequestBody(req);
            let payload = {};
            try { payload = JSON.parse(body); } catch(e) { 
                // Если не JSON, пробуем parse form-urlencoded
                const params = new URLSearchParams(body);
                for (const [key, val] of params.entries()) payload[key] = val;
            }
            // Если это установка приложения (auth)
            if (payload.auth && payload.auth.access_token) {
                bitrixAuth = payload.auth;
                saveAuth(bitrixAuth);
                log('✅ OAuth received from installation');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));
                setImmediate(() => findOpenLine().catch(e => error('OpenLine init error:', e.message)));
                return;
            }
            // Если это событие Connector
            if (payload.event === 'ONIMCONNECTORMESSAGEADD') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));
                setImmediate(() => processConnectorManagerEvent(payload).catch(e => error('Connector event error:', e.message)));
                return;
            }
            // Иначе - просто OK
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }
        // Root
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('MLK Bot is running');
    } catch(e) {
        error('HTTP error:', e.message);
        if (!res.headersSent) res.writeHead(500);
        res.end('Internal error');
    }
});

// ============================================================
// 15. ЗАПУСК
// ============================================================

async function startup() {
    log('========================================');
    log('MLK BOT — FINAL VERSION');
    log('Telegram + DeepSeek + Bitrix24 (FETCH + Connector)');
    log('========================================');
    log('BOT_TOKEN:', secretStatus(BOT_TOKEN));
    log('ADMIN_CHAT_ID:', secretStatus(ADMIN_CHAT_ID));
    log('DEEPSEEK_API_KEY:', secretStatus(DEEPSEEK_API_KEY));
    log('DEEPSEEK_MODEL:', DEEPSEEK_MODEL);
    log('BITRIX_WEBHOOK_URL:', secretStatus(BITRIX_WEBHOOK_URL));
    log('BITRIX_BOT_TOKEN:', secretStatus(BITRIX_BOT_TOKEN));
    log('BITRIX_BOT_ID:', BITRIX_BOT_ID);
    log('BITRIX_CONNECTOR_ENABLED:', BITRIX_CONNECTOR_ENABLED);
    log('BITRIX_CONNECTOR_ID:', BITRIX_CONNECTOR_ID);
    log('BITRIX_DOMAIN:', BITRIX_DOMAIN);
    log('BITRIX_CLIENT_ID:', secretStatus(BITRIX_CLIENT_ID));
    log('BITRIX_CLIENT_SECRET:', secretStatus(BITRIX_CLIENT_SECRET));
    log('PUBLIC_BASE_URL:', PUBLIC_BASE_URL || 'NOT SET');
    log('BITRIX_HANDLER_URL:', BITRIX_HANDLER_URL || 'NOT SET');
    log('AUTH FILE:', AUTH_FILE);
    log('========================================');

    // Загружаем OAuth
    bitrixAuth = loadAuth();

    // Запускаем сервер
    server.listen(PORT, '0.0.0.0', () => {
        log(`🚀 Server started on port ${PORT}`);
    });

    // Запускаем Telegram polling
    telegramPoll().catch(e => error('Telegram loop fatal:', e.message));

    // Запускаем Bitrix fetch (старый контур)
    bitrixFetchPoll().catch(e => error('Bitrix fetch fatal:', e.message));

    // Если Connector включён и есть OAuth — инициализируем
    if (BITRIX_CONNECTOR_ENABLED && bitrixAuth && bitrixAuth.access_token) {
        findOpenLine().catch(e => error('OpenLine init error:', e.message));
    } else if (BITRIX_CONNECTOR_ENABLED) {
        warn('Connector enabled but OAuth missing. Install Bitrix app first.');
    }
}

function shutdown(signal) {
    log(`🛑 ${signal}`);
    server.close(() => { log('Server closed'); process.exit(0); });
    setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => error('Unhandled rejection:', reason));
process.on('uncaughtException', err => error('Uncaught exception:', err.message));

startup().catch(e => {
    error('Startup fatal:', e.message);
    process.exit(1);
});