require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Подключаем калькулятор
const calculator = require('./calculator');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================

const BOT_TOKEN = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
const DEEPSEEK_MODEL = (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

// Bitrix24
const BITRIX_WEBHOOK_URL = (process.env.BITRIX_WEBHOOK_URL || '').trim();
const BITRIX_BOT_TOKEN = (process.env.BITRIX_BOT_TOKEN || '').trim();
const BITRIX_BOT_ID = Number(process.env.BITRIX_BOT_ID || 1787);
const BITRIX_BOT_CODE = (process.env.BITRIX_BOT_CODE || 'mlk_ai_consultant_v2').trim();
const BITRIX_POLL_INTERVAL_MS = Number(process.env.BITRIX_POLL_INTERVAL_MS || 3000);
const BITRIX_EVENT_LIMIT = Number(process.env.BITRIX_EVENT_LIMIT || 50);

const PORT = Number(process.env.PORT || 10000);
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 30;

const ROOT_DIR = __dirname;
const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const OFFSET_FILE = path.join(DATA_DIR, 'bitrix-offset.json');
const PROMPT_FILE = path.join(ROOT_DIR, 'promt.txt');
const PORTFOLIO_FILE = path.join(ROOT_DIR, 'portfolio.txt');

fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
// ЗАГРУЗКА ФАЙЛОВ
// ============================================================

let SYSTEM_PROMPT = '';
let PORTFOLIO_TEXT = '';

try {
    SYSTEM_PROMPT = fs.readFileSync(PROMPT_FILE, 'utf8');
} catch (error) {
    console.error('❌ Не удалось загрузить promt.txt:', error.message);
    process.exit(1);
}

if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
        PORTFOLIO_TEXT = fs.readFileSync(PORTFOLIO_FILE, 'utf8');
    } catch (error) {
        console.error('⚠️ Ошибка загрузки portfolio.txt:', error.message);
    }
}

const PORTFOLIO_KEYWORDS = [
    'опыт', 'портфолио', 'делали ли вы', 'пример', 'кейс',
    'проект', 'объект', 'работали', 'участвовали', 'проводили'
];

const telegramEnabled = Boolean(BOT_TOKEN);
const bitrixEnabled = Boolean(BITRIX_WEBHOOK_URL && BITRIX_BOT_TOKEN);

// ============================================================
// TELEGRAM BOT
// ============================================================

let bot = null;
if (telegramEnabled) {
    bot = new Telegraf(BOT_TOKEN);
}

// ============================================================
// СОСТОЯНИЯ
// ============================================================

const sessions = {};
const manualMode = {};
const lastActiveClient = {};
const equipmentSelection = new Map();
const awaitingTime = new Map();
const awaitingDateTime = new Map();

let bitrixOffset = null;
let bitrixPolling = false;
let stopping = false;
let bitrixInterval = null;
let telegramStarted = false;

// ============================================================
// СЕССИИ
// ============================================================

function loadSessions() {
    const now = Date.now();
    let loaded = 0, deleted = 0;
    try {
        const files = fs.readdirSync(SESSIONS_DIR);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(SESSIONS_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > SESSION_TTL) {
                    fs.unlinkSync(filePath);
                    deleted++;
                    continue;
                }
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(data)) {
                    sessions[path.basename(file, '.json')] = data;
                    loaded++;
                }
            } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
    console.log(`📂 Сессии: загружено ${loaded}, удалено старых ${deleted}`);
}

function saveSession(key) {
    if (!sessions[key]) return;
    try {
        fs.writeFileSync(path.join(SESSIONS_DIR, `${key}.json`), JSON.stringify(sessions[key], null, 2), 'utf8');
    } catch (e) {
        console.error('❌ Ошибка сохранения сессии:', e.message);
    }
}

function ensureSession(key, userFirstName = '') {
    if (sessions[key]) return sessions[key];
    const filePath = path.join(SESSIONS_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(data)) {
                sessions[key] = data;
                return sessions[key];
            }
        } catch (e) { /* ignore */ }
    }
    sessions[key] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `Имя клиента: ${userFirstName || 'неизвестно'}` }
    ];
    saveSession(key);
    return sessions[key];
}

// ============================================================
// КЛАВИАТУРЫ (полные, как в прошлых версиях)
// ============================================================

function getFormatKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Концерты & Фестивали', 'format_concerts')],
        [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conferences')],
        [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
        [Markup.button.callback('Выставки', 'format_exhibitions')],
        [Markup.button.callback('Спортивные мероприятия', 'format_sports')]
    ]);
}

function getLevelKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Стандартный (обычные требования)', 'level_standard')],
        [Markup.button.callback('Высокие требования (ТВ-трансляции)', 'level_high')],
        [Markup.button.callback('Высший уровень (высшие лица, международные)', 'level_top')]
    ]);
}

function getPersonnelKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Управление оборудованием', 'personnel_manage')],
        [Markup.button.callback('Дежурный техник', 'personnel_duty')],
        [Markup.button.callback('Только монтаж-демонтаж', 'personnel_mount')],
        [Markup.button.callback('Другое', 'personnel_other')]
    ]);
}

function getPlaceKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Улица', 'place_outdoor')],
        [Markup.button.callback('Помещение', 'place_indoor')],
        [Markup.button.callback('Под навесом', 'place_tent')]
    ]);
}

function getLiftKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Есть грузовой лифт', 'lift_yes')],
        [Markup.button.callback('Нужно носить по лестнице', 'lift_no')]
    ]);
}

function getMountKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Любое по согласованию', 'mount_any')],
        [Markup.button.callback('Ночью/рано утром', 'mount_night')]
    ]);
}

function getDemountKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Любое по согласованию', 'demount_any')],
        [Markup.button.callback('До определённого времени', 'demount_deadline')]
    ]);
}

function getEquipmentKeyboard(chatId) {
    const selected = equipmentSelection.get(chatId) || new Set();
    const mark = (type) => selected.has(type) ? '✅ ' : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback(mark('sound') + 'Звуковое оборудование', 'equip_sound')],
        [Markup.button.callback(mark('led') + 'Светодиодные экраны', 'equip_led')],
        [Markup.button.callback(mark('light') + 'Световое оборудование', 'equip_light')],
        [Markup.button.callback(mark('stage') + 'Сценические конструкции', 'equip_stage')],
        [Markup.button.callback(mark('all') + 'Полный комплекс', 'equip_all')],
        [Markup.button.callback('Готово (продолжить)', 'equip_done')]
    ]);
}

function getCalendar(year, month, prefix) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekDay = firstDay.getDay();
    const adjustedStart = startWeekDay === 0 ? 6 : startWeekDay - 1;
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const header = `${monthNames[month]} ${year}`;
    const buttons = [];
    buttons.push([
        Markup.button.callback('◀️', `${prefix}_prev_${year}_${month}`),
        Markup.button.callback(header, 'ignore'),
        Markup.button.callback('▶️', `${prefix}_next_${year}_${month}`)
    ]);
    buttons.push(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => Markup.button.callback(d, 'ignore')));
    let row = [];
    for (let i = 0; i < adjustedStart; i++) row.push(Markup.button.callback(' ', 'ignore'));
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        row.push(Markup.button.callback(String(day), `${prefix}_set_${dateStr}`));
        if (row.length === 7) { buttons.push(row); row = []; }
    }
    if (row.length > 0) {
        while (row.length < 7) row.push(Markup.button.callback(' ', 'ignore'));
        buttons.push(row);
    }
    buttons.push([Markup.button.callback('Пропустить', `${prefix}_skip`)]);
    return Markup.inlineKeyboard(buttons);
}

function getTimeKeyboard(prefix) {
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const minutes = ['00', '15', '30', '45'];
    const buttons = [];
    for (let i = 0; i < hours.length; i += 6) {
        buttons.push(hours.slice(i, i + 6).map(h => Markup.button.callback(h, `${prefix}_hour_${h}`)));
    }
    buttons.push(minutes.map(m => Markup.button.callback(m, `${prefix}_min_${m}`)));
    buttons.push([Markup.button.callback('Подтвердить', `${prefix}_time_done`)]);
    return Markup.inlineKeyboard(buttons);
}

// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(userMessage, sessionId, userFirstName = '', addPortfolio = false) {
    const key = String(sessionId);
    const messages = ensureSession(key, userFirstName);

    let messageForAI = userMessage;
    if (addPortfolio && PORTFOLIO_TEXT) {
        messageForAI = 'Отвечай на вопрос клиента, используя ТОЛЬКО информацию из списка проектов ниже. Не выдумывай проекты, которых нет в списке.\n\nСПИСОК ПРОЕКТОВ:\n' + PORTFOLIO_TEXT + '\n\nВОПРОС КЛИЕНТА:\n' + userMessage;
    }

    messages.push({ role: 'user', content: messageForAI });

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: messages,
            stream: false,
            temperature: 0.7,
            max_tokens: 1000
        })
    });

    if (!response.ok) {
        const raw = await response.text();
        throw new Error(`DeepSeek HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`DeepSeek API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const reply = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!reply) throw new Error('DeepSeek вернул пустой ответ.');

    messages[messages.length - 1] = { role: 'user', content: userMessage };
    messages.push({ role: 'assistant', content: reply });

    if (messages.length > MAX_HISTORY_MESSAGES + 2) {
        const systemMessages = messages.filter(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');
        sessions[key] = [...systemMessages, ...conversationMessages.slice(-MAX_HISTORY_MESSAGES)];
    }
    saveSession(key);
    return reply;
}

// ============================================================
// ОБРАБОТКА ТЕГОВ
// ============================================================

const TAG_MESSAGES = {
    ask_format: 'Выберите формат мероприятия: Концерты и фестивали, Конференции и презентации, Корпоративы и торжества, Выставки или Спортивные мероприятия.',
    ask_level: 'Укажите уровень мероприятия: Стандартный, Высокие требования (например, ТВ-трансляция) или Высший уровень.',
    ask_personnel: 'Какой персонал необходим: управление оборудованием, дежурный техник, только монтаж-демонтаж или другой вариант?',
    ask_place: 'Где проходит мероприятие: на улице, в помещении или под навесом?',
    ask_lift: 'Есть ли грузовой лифт для подъёма оборудования? Если нет — оборудование потребуется поднимать по лестнице.',
    ask_equipment: 'Какое оборудование необходимо? Можно указать несколько категорий: звуковое оборудование, LED-экраны, световое оборудование, сценические конструкции или полный комплекс.',
    ask_mount: 'Какое время монтажа подходит: любое по согласованию или ночью/рано утром?',
    ask_demount: 'Какое время демонтажа подходит: любое по согласованию или до определённого времени?',
    ask_date_start: 'Укажите дату начала мероприятия.',
    ask_date_end: 'Укажите дату окончания мероприятия.',
    ask_ready_date: 'Укажите дату и время, к которому оборудование должно быть полностью готово.'
};

function processAITags(text) {
    const result = String(text || '').trim();
    const tags = [];
    const regex = /\[(ask_[a-zA-Z0-9_]+)\]/g;
    let match;
    while ((match = regex.exec(result)) !== null) {
        tags.push(match[1]);
    }
    const clean = result.replace(regex, '').trim();
    return { text: clean, tags: [...new Set(tags)] };
}

// ============================================================
// ФОРМАТИРОВАНИЕ РЕЗУЛЬТАТА РАСЧЁТА
// ============================================================

function formatPriceResult(result) {
    let lines = [];
    lines.push('🧾 *Расчёт стоимости:*\n');

    lines.push('📦 *Оборудование:*');
    if (result.equipment.items.length === 0) {
        lines.push('  (не выбрано)');
    } else {
        for (const item of result.equipment.items) {
            lines.push(`  • ${item.name} (${item.model}) — ${item.qty} шт × ${item.days} дн = ${item.total.toFixed(2)} руб`);
        }
        lines.push(`  *Итого оборудование:* ${result.equipment.adjusted.toFixed(2)} руб (с учётом коэффициентов)`);
    }

    lines.push('\n👷 *Персонал:*');
    lines.push(`  Монтаж/демонтаж: ${result.personnel.md.toFixed(2)} руб`);
    lines.push(`  Обслуживание: ${result.personnel.service.toFixed(2)} руб`);
    lines.push(`  Командировочные: ${result.personnel.travel.toFixed(2)} руб`);
    lines.push(`  *Итого персонал:* ${result.personnel.total.toFixed(2)} руб`);

    lines.push('\n🚚 *Услуги:*');
    lines.push(`  Грузовой транспорт: ${result.services.cargo.toFixed(2)} руб`);
    lines.push(`  Транспорт персонала: ${result.services.staff.toFixed(2)} руб`);
    lines.push(`  Прочие услуги: ${result.services.other.toFixed(2)} руб`);
    lines.push(`  *Итого услуги:* ${result.services.total.toFixed(2)} руб`);

    lines.push('\n💰 *Итог:*');
    lines.push(`  Сумма без налогов: ${result.subtotal.toFixed(2)} руб`);
    if (result.discountPercent > 0) {
        lines.push(`  Скидка ${result.discountPercent}%: -${(result.subtotal - result.revenue).toFixed(2)} руб`);
    }
    lines.push(`  Доход после скидки: ${result.revenue.toFixed(2)} руб`);
    lines.push(`  Налоги (УСН + ФСЗН): ${result.taxes.total.toFixed(2)} руб`);
    lines.push(`  *ИТОГО К ОПЛАТЕ:* ${result.grandTotal.toFixed(2)} руб`);

    lines.push('\n📌 Коэффициенты, применённые к оборудованию:');
    const c = result.coefficients;
    lines.push(`  формат=${c.format.toFixed(2)}, уровень=${c.level.toFixed(2)}, вид услуги=${c.service.toFixed(2)}, условия=${c.location.toFixed(2)}, длительность=${c.duration.toFixed(2)} → итог = ${c.total.toFixed(2)}`);

    return lines.join('\n');
}

// ============================================================
// ОБЩАЯ ОБРАБОТКА ОТВЕТА ИИ (Telegram + Bitrix)
// ============================================================

async function handleAIResponse(chatId, aiText, isTelegram = false, ctx = null) {
    // Проверяем, не является ли ответ JSON-запросом на расчёт
    try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.action === 'calculate' && parsed.params) {
                const result = calculator.calcPrice(parsed.params);
                const response = formatPriceResult(result);
                if (isTelegram && ctx) {
                    await ctx.reply(response, { parse_mode: 'Markdown' });
                } else {
                    // Для Bitrix отправляем через другую функцию
                    // Мы вызовем её отдельно
                    return { type: 'price', text: response };
                }
                return null; // дальше не обрабатываем
            }
        }
    } catch (e) { /* невалидный JSON — игнорируем */ }

    // Обработка тегов
    const processed = processAITags(aiText);
    if (processed.text && isTelegram && ctx) {
        await ctx.reply(processed.text);
    } else if (processed.text && !isTelegram) {
        // для Bitrix возвращаем текст отдельно
        // (будет отправлено вызывающей функцией)
    }

    // Для Telegram показываем клавиатуру
    if (isTelegram && ctx) {
        for (const tag of processed.tags) {
            const tagInfo = {
                ask_format: { type: 'format' },
                ask_level: { type: 'level' },
                ask_personnel: { type: 'personnel' },
                ask_place: { type: 'place' },
                ask_lift: { type: 'lift' },
                ask_equipment: { type: 'equipment' },
                ask_mount: { type: 'mount' },
                ask_demount: { type: 'demount' },
                ask_date_start: { type: 'calendar', prefix: 'date_start', text: '📅 Выберите дату начала:' },
                ask_date_end: { type: 'calendar', prefix: 'date_end', text: '📅 Выберите дату окончания:' },
                ask_ready_date: { type: 'calendar', prefix: 'ready_date', text: '📅 Готовность оборудования:' }
            };
            const info = tagInfo[tag];
            if (!info) continue;
            if (info.type === 'format') {
                await ctx.reply('🎭 Выберите формат мероприятия:', getFormatKeyboard());
            } else if (info.type === 'level') {
                await ctx.reply('📊 Укажите уровень мероприятия:', getLevelKeyboard());
            } else if (info.type === 'personnel') {
                await ctx.reply('👷 Выберите обслуживающий персонал:', getPersonnelKeyboard());
            } else if (info.type === 'place') {
                await ctx.reply('📍 Где проходит мероприятие?', getPlaceKeyboard());
            } else if (info.type === 'lift') {
                await ctx.reply('🛗 Подъем оборудования:', getLiftKeyboard());
            } else if (info.type === 'equipment') {
                equipmentSelection.set(chatId, new Set());
                await ctx.reply('🔧 Какое оборудование необходимо? (можно выбрать несколько)', getEquipmentKeyboard(chatId));
            } else if (info.type === 'mount') {
                await ctx.reply('⏱ Время монтажа:', getMountKeyboard());
            } else if (info.type === 'demount') {
                await ctx.reply('⏱ Время демонтажа:', getDemountKeyboard());
            } else if (info.type === 'calendar') {
                const now = new Date();
                await ctx.reply(info.text, getCalendar(now.getFullYear(), now.getMonth(), info.prefix));
            }
        }
        return null;
    }

    // Для Bitrix возвращаем текст и теги отдельно
    return { type: 'tags', text: processed.text, tags: processed.tags };
}

// ============================================================
// BITRIX24
// ============================================================

async function bitrixCall(method, params = {}) {
    if (!bitrixEnabled) throw new Error('Bitrix отключён.');
    const base = BITRIX_WEBHOOK_URL.replace(/\/+$/, '');
    const url = `${base}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Bitrix HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const data = await response.json();
    if (data.error) throw new Error(`Bitrix ${data.error}: ${data.error_description || ''}`);
    return data.result;
}

async function sendBitrixMessage(dialogId, text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    return bitrixCall('imbot.v2.Chat.Message.send', {
        botId: BITRIX_BOT_ID,
        botToken: BITRIX_BOT_TOKEN,
        dialogId: String(dialogId),
        fields: { message: clean, urlPreview: true }
    });
}

async function getBitrixEvents(offset = null) {
    const params = { botId: BITRIX_BOT_ID, botToken: BITRIX_BOT_TOKEN, limit: BITRIX_EVENT_LIMIT };
    if (offset !== null) params.offset = offset;
    return bitrixCall('imbot.v2.Event.get', params);
}

function loadBitrixOffset() {
    try {
        if (!fs.existsSync(OFFSET_FILE)) { bitrixOffset = null; return; }
        const data = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8'));
        bitrixOffset = Number.isInteger(data.offset) ? data.offset : null;
        console.log('✅ Bitrix offset:', bitrixOffset === null ? 'none' : bitrixOffset);
    } catch (e) { bitrixOffset = null; }
}

function saveBitrixOffset(value) {
    try {
        fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset: value, savedAt: new Date().toISOString() }, null, 2), 'utf8');
    } catch (e) { console.error('⚠️ Ошибка сохранения Bitrix offset:', e.message); }
}

async function handleBitrixMessage(data) {
    const message = data?.message || {};
    const chat = data?.chat || {};
    const user = data?.user || {};
    const botInfo = data?.bot || {};
    const text = String(message.text || '').trim();
    const dialogId = chat.dialogId || chat.dialog_id || message.chatId || message.chat_id;
    const authorId = message.authorId ?? message.author_id;

    if (!dialogId || !text) return;
    if (Number(authorId) === BITRIX_BOT_ID) return;
    if (botInfo.id && Number(botInfo.id) !== BITRIX_BOT_ID) return;

    const addPortfolio = PORTFOLIO_KEYWORDS.some(k => text.toLowerCase().includes(k));
    const firstName = user.firstName || user.name || 'клиент';

    try {
        const reply = await askDeepSeek(text, `bitrix_${dialogId}`, firstName, addPortfolio);
        const result = await handleAIResponse(dialogId, reply, false);
        if (result) {
            if (result.type === 'price') {
                await sendBitrixMessage(dialogId, result.text);
            } else if (result.type === 'tags') {
                if (result.text) await sendBitrixMessage(dialogId, result.text);
                for (const tag of result.tags) {
                    const question = TAG_MESSAGES[tag];
                    if (question) await sendBitrixMessage(dialogId, question);
                }
            }
        }
    } catch (error) {
        console.error('❌ Bitrix DeepSeek error:', error.message);
        await sendBitrixMessage(dialogId, 'Извините, произошла техническая ошибка. Попробуйте позже.');
    }
}

async function handleBitrixEvent(event) {
    if (!event) return;
    if (event.type === 'ONIMBOTV2MESSAGEADD') {
        await handleBitrixMessage(event.data || {});
    } else if (event.type === 'ONIMBOTV2JOINCHAT') {
        console.log('👋 Bitrix: бот добавлен в чат.');
    } else if (event.type === 'ONIMBOTV2DELETE') {
        console.log('⚠️ Bitrix: бот удалён из чата.');
    }
}

async function pollBitrix() {
    if (!bitrixEnabled || stopping || bitrixPolling) return;
    bitrixPolling = true;
    try {
        const result = await getBitrixEvents(bitrixOffset);
        const events = Array.isArray(result?.events) ? result.events : [];
        const nextOffset = Number(result?.nextOffset);
        const hasMore = Boolean(result?.hasMore);
        for (const event of events) {
            await handleBitrixEvent(event);
        }
        if (Number.isInteger(nextOffset)) {
            bitrixOffset = nextOffset;
            saveBitrixOffset(bitrixOffset);
        }
        if (hasMore) setImmediate(pollBitrix);
    } catch (error) {
        console.error('❌ BITRIX FETCH ERROR:', error.message);
    } finally {
        bitrixPolling = false;
    }
}

function startBitrixPolling() {
    if (!bitrixEnabled) return;
    console.log('🚀 BITRIX FETCH LOOP STARTED');
    pollBitrix();
    bitrixInterval = setInterval(pollBitrix, BITRIX_POLL_INTERVAL_MS);
}

async function checkBitrixBot() {
    const result = await bitrixCall('imbot.v2.Bot.get', { botId: BITRIX_BOT_ID, botToken: BITRIX_BOT_TOKEN });
    const info = result?.bot || result || {};
    console.log('🤖 Bitrix bot:', info.id || BITRIX_BOT_ID);
    if (info.id && Number(info.id) !== BITRIX_BOT_ID) {
        throw new Error(`Bitrix вернул Bot ID ${info.id}, ожидался ${BITRIX_BOT_ID}.`);
    }
    if (info.eventMode && info.eventMode !== 'fetch') {
        throw new Error(`Bitrix bot ${BITRIX_BOT_ID} не в FETCH. Текущий режим: ${info.eventMode}`);
    }
}

// ============================================================
// TELEGRAM HANDLERS
// ============================================================

function setupTelegramHandlers() {
    if (!telegramEnabled || !bot) return;

    bot.on('callback_query', async (ctx) => {
        const chatId = ctx.chat.id;
        const data = ctx.callbackQuery.data;
        try {
            if (data === 'ignore') { await ctx.answerCbQuery(); return; }

            // Время
            if (data.includes('_hour_') || data.includes('_min_') || data.endsWith('_time_done')) {
                const parts = data.split('_');
                const prefix = parts[0] + '_' + parts[1];
                if (!awaitingDateTime.has(chatId)) { await ctx.answerCbQuery(); return; }
                const timeData = awaitingDateTime.get(chatId);
                if (!timeData[prefix]) timeData[prefix] = { hour: '00', min: '00' };
                if (data.endsWith('_time_done')) {
                    const { hour, min } = timeData[prefix];
                    const fullDate = `${timeData.dateStr} ${hour}:${min}`;
                    const labelMap = { date_start: 'Дата начала', date_end: 'Дата окончания', ready_date: 'Готовность оборудования' };
                    awaitingDateTime.delete(chatId);
                    await ctx.editMessageReplyMarkup(undefined);
                    await ctx.reply(`${labelMap[prefix]}: ${fullDate}`);
                    const reply = await askDeepSeek(`${labelMap[prefix]}: ${fullDate}`, `telegram_${chatId}`, ctx.from.first_name);
                    await handleAIResponse(chatId, reply, true, ctx);
                    await ctx.answerCbQuery();
                    return;
                }
                if (data.includes('_hour_')) timeData[prefix].hour = parts[parts.length - 1];
                else if (data.includes('_min_')) timeData[prefix].min = parts[parts.length - 1];
                awaitingDateTime.set(chatId, timeData);
                const { hour, min } = timeData[prefix];
                await ctx.editMessageText(`Выбрано: ${hour}:${min}. Нажмите "Подтвердить"`, getTimeKeyboard(prefix));
                await ctx.answerCbQuery();
                return;
            }

            // Календари
            const calPrefixes = ['date_start', 'date_end', 'ready_date'];
            for (const p of calPrefixes) {
                if (data.startsWith(p)) {
                    const parts = data.split('_');
                    if (parts[2] === 'prev' || parts[2] === 'next') {
                        const year = Number(parts[3]), month = Number(parts[4]);
                        const newDate = new Date(year, month);
                        newDate.setMonth(newDate.getMonth() + (parts[2] === 'prev' ? -1 : 1));
                        await ctx.editMessageText('📅 Выберите дату:', getCalendar(newDate.getFullYear(), newDate.getMonth(), p));
                        await ctx.answerCbQuery();
                    } else if (parts[2] === 'set') {
                        const dateStr = parts[3];
                        await ctx.answerCbQuery(`Выбрано: ${dateStr}`);
                        const timeData = awaitingDateTime.get(chatId) || {};
                        timeData.dateStr = dateStr;
                        timeData[p] = { hour: '00', min: '00' };
                        awaitingDateTime.set(chatId, timeData);
                        const label = p === 'date_start' ? 'начала' : p === 'date_end' ? 'окончания' : 'готовности';
                        await ctx.editMessageText(`Выберите время для ${label}:`, getTimeKeyboard(p));
                    } else if (parts[2] === 'skip') {
                        await ctx.answerCbQuery('Пропущено');
                        await ctx.editMessageReplyMarkup(undefined);
                        const skipMsg = p === 'date_start' ? 'Дата начала не указана' : p === 'date_end' ? 'Дата окончания не указана' : 'Готовность не указана';
                        await ctx.reply(skipMsg);
                        const reply = await askDeepSeek(skipMsg, `telegram_${chatId}`, ctx.from.first_name);
                        await handleAIResponse(chatId, reply, true, ctx);
                    }
                    return;
                }
            }

            // Простые кнопки (format, level, personnel, place)
            const simpleMap = [
                ['format_', 'Формат'],
                ['level_', 'Уровень'],
                ['personnel_', 'Персонал'],
                ['place_', 'Место']
            ];
            for (const [prefix, label] of simpleMap) {
                if (data.startsWith(prefix)) {
                    await ctx.answerCbQuery();
                    await ctx.editMessageReplyMarkup(undefined);
                    const text = `${label}: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || data}`;
                    await ctx.reply(text);
                    const reply = await askDeepSeek(text, `telegram_${chatId}`, ctx.from.first_name);
                    await handleAIResponse(chatId, reply, true, ctx);
                    return;
                }
            }

            // Lift
            if (data === 'lift_yes' || data === 'lift_no') {
                await ctx.answerCbQuery();
                await ctx.editMessageReplyMarkup(undefined);
                const text = data === 'lift_yes' ? 'Подъем: Есть грузовой лифт' : 'Подъем: Нужно носить по лестнице';
                await ctx.reply(text);
                const reply = await askDeepSeek(text, `telegram_${chatId}`, ctx.from.first_name);
                await handleAIResponse(chatId, reply, true, ctx);
                return;
            }

            // Equipment
            if (data.startsWith('equip_')) {
                if (!equipmentSelection.has(chatId)) equipmentSelection.set(chatId, new Set());
                const selected = equipmentSelection.get(chatId);
                const typeNames = { sound: 'Звуковое оборудование', led: 'Светодиодные экраны', light: 'Световое оборудование', stage: 'Сценические конструкции', all: 'Полный комплекс' };
                if (data === 'equip_done') {
                    const selectedNames = Array.from(selected).map(x => typeNames[x]).filter(Boolean);
                    const text = selectedNames.length ? `Выбрано оборудование: ${selectedNames.join(', ')}` : 'Оборудование не выбрано';
                    await ctx.answerCbQuery('Готово');
                    try { await ctx.deleteMessage(); } catch (_) {}
                    equipmentSelection.delete(chatId);
                    await ctx.reply(text);
                    const reply = await askDeepSeek(text, `telegram_${chatId}`, ctx.from.first_name);
                    await handleAIResponse(chatId, reply, true, ctx);
                    return;
                }
                if (data === 'equip_all') {
                    selected.clear();
                    selected.add('all');
                } else {
                    const typeMap = { equip_sound: 'sound', equip_led: 'led', equip_light: 'light', equip_stage: 'stage' };
                    const type = typeMap[data];
                    if (!type) return;
                    if (selected.has(type)) selected.delete(type);
                    else { selected.add(type); if (selected.has('all')) selected.delete('all'); }
                }
                await ctx.answerCbQuery('Обновлено');
                try { await ctx.editMessageReplyMarkup(undefined); } catch (_) {}
                await ctx.reply('🔧 Какое оборудование необходимо? (можно выбрать несколько)', getEquipmentKeyboard(chatId));
                return;
            }

            // Mount / Demount
            if (data === 'mount_any' || data === 'demount_any') {
                await ctx.answerCbQuery();
                await ctx.editMessageReplyMarkup(undefined);
                const text = data === 'mount_any' ? 'Монтаж: Любое по согласованию' : 'Демонтаж: Любое по согласованию';
                await ctx.reply(text);
                const reply = await askDeepSeek(text, `telegram_${chatId}`, ctx.from.first_name);
                await handleAIResponse(chatId, reply, true, ctx);
                return;
            }
            if (data === 'mount_night' || data === 'demount_deadline') {
                await ctx.answerCbQuery();
                await ctx.editMessageReplyMarkup(undefined);
                const type = data === 'mount_night' ? 'mount' : 'demount';
                awaitingTime.set(chatId, type);
                await ctx.reply(data === 'mount_night' ? 'Монтаж: Ночью/рано утром. До какого времени? (например, 06:00)' : 'Демонтаж: До определённого времени. До какого? (например, 18:00)');
                return;
            }

            // contact_manager, send_tz, start_survey, reply_to_
            if (data === 'contact_manager') {
                manualMode[chatId] = true;
                lastActiveClient[ADMIN_CHAT_ID] = chatId;
                await ctx.answerCbQuery('Заявка отправлена!');
                await ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
                await notifyAdmin(`📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId}) запросил менеджера.`);
                return;
            }
            if (data === 'send_tz') {
                await ctx.answerCbQuery();
                await ctx.editMessageReplyMarkup(undefined);
                await ctx.reply('Отлично! Отправьте все файлы (ТЗ, райдеры, схемы), и я передам их в отдел подготовки КП.');
                const session = ensureSession(`telegram_${chatId}`, ctx.from.first_name);
                session.push({ role: 'system', content: 'Клиент хочет отправить файлы.' });
                saveSession(`telegram_${chatId}`);
                return;
            }
            if (data === 'start_survey') {
                await ctx.answerCbQuery();
                await ctx.editMessageReplyMarkup(undefined);
                await ctx.reply('Хорошо, давайте обсудим ваше мероприятие. 🎭 Выберите формат мероприятия:', getFormatKeyboard());
                return;
            }
            if (data.startsWith('reply_to_')) {
                lastActiveClient[ADMIN_CHAT_ID] = data.replace('reply_to_', '');
                await ctx.answerCbQuery('Выбран клиент');
                await ctx.reply(`Активный клиент: ${lastActiveClient[ADMIN_CHAT_ID]}. Используйте /reply текст.`);
                return;
            }
        } catch (error) {
            console.error('❌ Telegram callback error:', error.message);
            try { await ctx.answerCbQuery('Произошла ошибка'); } catch (_) {}
        }
    });

    bot.on('text', async (ctx, next) => {
        const chatId = ctx.chat.id;
        const userMessage = ctx.message.text;
        const user = ctx.from;
        if (String(user.id) === String(ADMIN_CHAT_ID)) return next();

        lastActiveClient[ADMIN_CHAT_ID] = user.id;
        await notifyAdmin(`📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`);

        if (manualMode[chatId]) return;

        const timeAwaiting = awaitingTime.get(chatId);
        if (timeAwaiting) {
            awaitingTime.delete(chatId);
            const fullMessage = timeAwaiting === 'mount'
                ? `Монтаж: Ночью/рано утром, точное время: ${userMessage}`
                : `Демонтаж: До определённого времени, точное время: ${userMessage}`;
            try {
                const reply = await askDeepSeek(fullMessage, `telegram_${chatId}`, user.first_name);
                await handleAIResponse(chatId, reply, true, ctx);
            } catch (error) {
                console.error('❌ Telegram DeepSeek error:', error.message);
                await ctx.reply('Извините, произошла техническая ошибка.');
            }
            return;
        }

        const lower = userMessage.toLowerCase();
        const addPortfolio = PORTFOLIO_KEYWORDS.some(k => lower.includes(k));
        try {
            await ctx.sendChatAction('typing');
            const reply = await askDeepSeek(userMessage, `telegram_${chatId}`, user.first_name, addPortfolio);
            await handleAIResponse(chatId, reply, true, ctx);
        } catch (error) {
            console.error('❌ Telegram DeepSeek error:', error.message);
            await ctx.reply('Извините, произошла техническая ошибка.');
        }
    });

    bot.start(async (ctx) => {
        const chatId = ctx.chat.id;
        await ctx.reply(
            'Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».\n\n' +
            'Если у вас есть готовые файлы с полной информацией по мероприятию (ТЗ, райдеры, даты, любые другие файлы), вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.\n\n' +
            'Или мы можем обсудить ваше мероприятие, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.\n\n' +
            'С чего начнём?',
            Markup.inlineKeyboard([
                [Markup.button.callback('📎 Отправить файлы', 'send_tz')],
                [Markup.button.callback('💬 Продолжить диалог', 'start_survey')]
            ])
        );
        ensureSession(`telegram_${chatId}`, ctx.from.first_name);
    });

    bot.command('reply', async (ctx) => {
        if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
        const targetId = lastActiveClient[ADMIN_CHAT_ID];
        if (!targetId) return ctx.reply('Нет активного клиента.');
        const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
        if (!text) return ctx.reply('Напишите текст после /reply');
        try {
            await bot.telegram.sendMessage(targetId, text);
            await ctx.reply('✅ Отправлено');
        } catch (error) {
            await ctx.reply(`❌ Ошибка отправки: ${error.message}`);
        }
    });

    bot.command('resume', async (ctx) => {
        if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
        Object.keys(manualMode).forEach(key => delete manualMode[key]);
        await ctx.reply('Автоответы возобновлены.');
    });

    bot.command('portfolio', async (ctx) => {
        await ctx.reply(PORTFOLIO_TEXT || 'Портфолио временно недоступно.');
    });

    bot.on('document', async (ctx) => {
        const user = ctx.from;
        const doc = ctx.message.document;
        const session = ensureSession(`telegram_${ctx.chat.id}`, user.first_name);
        const requestedFiles = session.some(m => m.content === 'Клиент хочет отправить файлы.');
        await ctx.reply(requestedFiles ? 'Спасибо! Файлы получены, я передаю их в отдел подготовки КП.' : 'Спасибо! Я передал ваш файл менеджеру.');
        if (ADMIN_CHAT_ID) {
            try {
                await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, {
                    caption: `📎 Документ от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})\nИмя файла: ${doc.file_name || 'неизвестно'}`
                });
            } catch (e) { console.error('Ошибка пересылки:', e.message); }
        }
        if (requestedFiles) {
            sessions[`telegram_${ctx.chat.id}`] = session.filter(m => m.content !== 'Клиент хочет отправить файлы.');
            saveSession(`telegram_${ctx.chat.id}`);
        }
    });

    bot.on('photo', async (ctx) => {
        const user = ctx.from;
        const photos = ctx.message.photo;
        if (!photos?.length) return;
        await ctx.reply('Спасибо! Я передал ваше фото менеджеру.');
        if (ADMIN_CHAT_ID) {
            try {
                await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, photos[photos.length - 1].file_id, {
                    caption: `📷 Фото от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})`
                });
            } catch (e) { console.error('Ошибка пересылки:', e.message); }
        }
    });
}

async function notifyAdmin(text, extra = {}) {
    if (!telegramEnabled || !ADMIN_CHAT_ID || !bot) return;
    try {
        await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, extra);
    } catch (e) { console.error('⚠️ Ошибка уведомления админа:', e.message); }
}

// ============================================================
// ЗАПУСК
// ============================================================

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('MLK AI Consultant is running');
        return;
    }
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            telegram: telegramEnabled,
            telegramStarted: telegramStarted,
            bitrix: bitrixEnabled,
            bitrixPolling: bitrixPolling,
            bitrixOffset: bitrixOffset,
            sessions: Object.keys(sessions).length,
            time: new Date().toISOString()
        }, null, 2));
        return;
    }
    res.writeHead(404);
    res.end('Not Found');
});

async function start() {
    loadSessions();
    loadBitrixOffset();

    server.listen(PORT, '0.0.0.0', async () => {
        console.log('========================================');
        console.log('🚀 SERVER STARTED');
        console.log('========================================');
        console.log(`PORT: ${PORT}`);
        console.log(`TELEGRAM: ${telegramEnabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`BITRIX: ${bitrixEnabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`DEEPSEEK: ${DEEPSEEK_MODEL}`);
        console.log('========================================');

        if (bitrixEnabled) {
            try {
                await checkBitrixBot();
                startBitrixPolling();
            } catch (error) {
                console.error('❌ Bitrix startup check failed:', error.message);
                setTimeout(startBitrixPolling, 5000);
            }
        }

        if (telegramEnabled) {
            setupTelegramHandlers();
            while (!stopping && !telegramStarted) {
                try {
                    await bot.launch();
                    telegramStarted = true;
                    console.log('✅ Telegram polling STARTED');
                    await notifyAdmin('✅ Бот MLK запущен и работает');
                } catch (error) {
                    console.error('❌ Telegram launch error:', error.message);
                    if (stopping) return;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
    });
}

// Обработка завершения
function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`🛑 ${signal} — завершаем работу...`);
    if (bitrixInterval) clearInterval(bitrixInterval);
    if (telegramStarted && bot) {
        try { bot.stop(signal); } catch (_) {}
    }
    server.close(() => {
        console.log('✅ Server closed.');
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('❌ UNHANDLED REJECTION:', reason));
process.on('uncaughtException', (error) => console.error('❌ UNCAUGHT EXCEPTION:', error.stack || error.message));

start().catch(error => {
    console.error('❌ FATAL START ERROR:', error.stack || error.message);
    process.exit(1);
});