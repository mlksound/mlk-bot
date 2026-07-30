require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !DEEPSEEK_API_KEY) {
    console.error('Ошибка: не заданы BOT_TOKEN или DEEPSEEK_API_KEY');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const SYSTEM_PROMPT = fs.readFileSync('./promt.txt', 'utf8');
const PORTFOLIO_TEXT = fs.readFileSync('./portfolio.txt', 'utf8');

const PORTFOLIO_KEYWORDS = ['опыт', 'портфолио', 'делали ли вы', 'пример', 'кейс', 'проект', 'объект', 'работали', 'участвовали', 'проводили'];

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);
const sessions = {};
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000;

function loadSessions() {
    const files = fs.readdirSync(SESSIONS_DIR);
    const now = Date.now();
    let loadedCount = 0;
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(SESSIONS_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > SESSION_TTL) {
            fs.unlinkSync(filePath);
            continue;
        }
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            sessions[path.basename(file, '.json')] = data;
            loadedCount++;
        } catch (e) { console.error('Ошибка чтения сессии:', e.message); }
    }
    console.log(`Загружено сессий: ${loadedCount}`);
}

function saveSession(chatId, messages) {
    fs.writeFileSync(path.join(SESSIONS_DIR, `${chatId}.json`), JSON.stringify(messages));
}

function ensureSession(chatId) {
    if (!sessions[chatId]) {
        const filePath = path.join(SESSIONS_DIR, `${chatId}.json`);
        if (fs.existsSync(filePath)) {
            try { sessions[chatId] = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
        }
    }
}

const manualMode = {};
const lastActiveClient = {};
const equipmentSelection = new Map();

// ---------- Клавиатуры ----------
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
        [Markup.button.callback('Стандартный (обычные требования к оборудованию и документации)', 'level_standard')],
        [Markup.button.callback('Высокие требования (повышенные требования к оборудованию и документации, прямые ТВ-трансляции)', 'level_high')],
        [Markup.button.callback('Высший уровень (с высшими должностными лицами, масштабные и международные мероприятия)', 'level_top')]
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
        [Markup.button.callback('Нужно смонтировать ночью/рано утром', 'mount_night')]
    ]);
}

function getDemountKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Любое по согласованию', 'demount_any')],
        [Markup.button.callback('Нужно демонтировать до определенного времени', 'demount_deadline')]
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
        if (row.length === 7) {
            buttons.push(row);
            row = [];
        }
    }
    if (row.length > 0) {
        while (row.length < 7) row.push(Markup.button.callback(' ', 'ignore'));
        buttons.push(row);
    }
    buttons.push([Markup.button.callback('Пропустить', `${prefix}_skip`)]);
    return Markup.inlineKeyboard(buttons);
}

// ---------- ИИ ----------
async function askDeepSeek(userMessage, chatId, userFirstName, addPortfolio = false) {
    ensureSession(chatId);
    let finalMessage = userMessage;
    if (addPortfolio && PORTFOLIO_TEXT) {
        finalMessage = `Отвечай, используя ТОЛЬКО проекты из списка ниже. Не выдумывай других. Вот список:\n${PORTFOLIO_TEXT}\n\nВопрос клиента: ${userMessage}`;
    }

    if (!sessions[chatId]) {
        sessions[chatId] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'system', content: `Имя клиента: ${userFirstName}` }
        ];
    }
    const messages = sessions[chatId];
    messages.push({ role: 'user', content: finalMessage });

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7 })
    });

    const data = await response.json();
    if (data.error) throw new Error('DeepSeek API error: ' + data.error.message);
    if (!data.choices?.[0]?.message) throw new Error('Invalid DeepSeek response');
    const reply = data.choices[0].message.content;

    messages[messages.length - 1] = { role: 'user', content: userMessage };
    messages.push({ role: 'assistant', content: reply });
    if (messages.length > 30) {
        sessions[chatId] = [messages[0], ...messages.slice(-30)];
    }
    saveSession(chatId, sessions[chatId]);
    return reply;
}

async function notifyAdmin(text, extra = {}) {
    if (!ADMIN_CHAT_ID) return;
    try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, extra); } catch (err) { console.error('Ошибка уведомления:', err.message); }
}

// ---------- Обработка ответа ИИ (теги + fallback) ----------
async function handleAIReply(ctx, text, chatId) {
    const tagRegex = /\[(ask_\w+)\]/;
    const match = text.match(tagRegex);
    let finalText = text;
    let keyboardInfo = null;

    if (match) {
        const tagName = match[1];
        finalText = text.replace(match[0], '').trim();
        const tagToKeyboard = {
            'ask_format': { type: 'format' },
            'ask_level': { type: 'level' },
            'ask_personnel': { type: 'personnel' },
            'ask_place': { type: 'place' },
            'ask_lift': { type: 'lift' },
            'ask_equipment': { type: 'equipment' },
            'ask_mount': { type: 'mount' },
            'ask_demount': { type: 'demount' },
            'ask_date_start': { type: 'calendar', prefix: 'date_start', text: '📅 Выберите дату начала:' },
            'ask_date_end': { type: 'calendar', prefix: 'date_end', text: '📅 Выберите дату окончания:' },
            'ask_ready_date': { type: 'calendar', prefix: 'ready_date', text: '📅 Готовность оборудования:' }
        };
        keyboardInfo = tagToKeyboard[tagName];
    } else {
        // Fallback: если тег не найден, но по ключевым словам можно определить нужную клавиатуру
        const lowerText = text.toLowerCase();
        if (lowerText.includes('формат') && (lowerText.includes('выберите') || lowerText.includes('какой'))) {
            keyboardInfo = { type: 'format' };
        } else if (lowerText.includes('уровень') && lowerText.includes('мероприятия')) {
            keyboardInfo = { type: 'level' };
        } else if (lowerText.includes('персонал')) {
            keyboardInfo = { type: 'personnel' };
        } else if (lowerText.includes('место') && lowerText.includes('проходит')) {
            keyboardInfo = { type: 'place' };
        } else if (lowerText.includes('лифт') || lowerText.includes('подъем')) {
            keyboardInfo = { type: 'lift' };
        } else if (lowerText.includes('оборудование') && (lowerText.includes('выберите') || lowerText.includes('какое'))) {
            keyboardInfo = { type: 'equipment' };
        } else if (lowerText.includes('монтаж') && !lowerText.includes('демонтаж')) {
            keyboardInfo = { type: 'mount' };
        } else if (lowerText.includes('демонтаж')) {
            keyboardInfo = { type: 'demount' };
        }
    }

    if (finalText.length > 0) await ctx.reply(finalText);

    if (keyboardInfo) {
        if (keyboardInfo.type === 'format') await ctx.reply('🎭 Выберите формат мероприятия:', getFormatKeyboard());
        else if (keyboardInfo.type === 'level') await ctx.reply('📊 Укажите уровень мероприятия:', getLevelKeyboard());
        else if (keyboardInfo.type === 'personnel') await ctx.reply('👷 Выберите обслуживающий персонал:', getPersonnelKeyboard());
        else if (keyboardInfo.type === 'place') await ctx.reply('📍 Где проходит мероприятие?', getPlaceKeyboard());
        else if (keyboardInfo.type === 'lift') await ctx.reply('🛗 Подъем оборудования:', getLiftKeyboard());
        else if (keyboardInfo.type === 'equipment') {
            equipmentSelection.set(ctx.chat.id, new Set());
            await ctx.reply('🔧 Какое оборудование необходимо? (можно выбрать несколько)', getEquipmentKeyboard(ctx.chat.id));
        }
        else if (keyboardInfo.type === 'mount') await ctx.reply('⏱ Время монтажа:', getMountKeyboard());
        else if (keyboardInfo.type === 'demount') await ctx.reply('⏱ Время демонтажа:', getDemountKeyboard());
        else if (keyboardInfo.type === 'calendar') {
            const now = new Date();
            await ctx.reply(keyboardInfo.text, getCalendar(now.getFullYear(), now.getMonth(), keyboardInfo.prefix));
        }
    }
}

// ---------- Callback-обработчики ----------
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

    // Календари
    const calendarPrefixes = ['date_start', 'date_end', 'ready_date'];
    for (const prefix of calendarPrefixes) {
        if (data.startsWith(prefix)) {
            const parts = data.split('_');
            if (parts[2] === 'prev' || parts[2] === 'next') {
                const year = parseInt(parts[3]);
                const month = parseInt(parts[4]);
                const newDate = new Date(year, month);
                if (parts[2] === 'prev') newDate.setMonth(newDate.getMonth() - 1);
                else newDate.setMonth(newDate.getMonth() + 1);
                await ctx.editMessageText('📅 Выберите дату:', getCalendar(newDate.getFullYear(), newDate.getMonth(), prefix));
            } else if (parts[2] === 'set') {
                const dateStr = parts[3];
                await ctx.answerCbQuery(`Выбрано: ${dateStr}`);
                await ctx.editMessageReplyMarkup(undefined);
                const humanDate = dateStr.split('-').reverse().join('.');
                const messageText = prefix === 'date_start' ? `Дата начала: ${humanDate}` :
                                    prefix === 'date_end'   ? `Дата окончания: ${humanDate}` :
                                    `Готовность оборудования: ${humanDate}`;
                await ctx.reply(messageText);
                const user = ctx.from;
                const reply = await askDeepSeek(messageText, chatId, user.first_name);
                await handleAIReply(ctx, reply, chatId);
            } else if (parts[2] === 'skip') {
                await ctx.answerCbQuery('Пропущено');
                await ctx.editMessageReplyMarkup(undefined);
                const skipMsg = prefix === 'date_start' ? 'Дата начала не указана' :
                                prefix === 'date_end'   ? 'Дата окончания не указана' :
                                'Готовность не указана';
                await ctx.reply(skipMsg);
                const user = ctx.from;
                const reply = await askDeepSeek(skipMsg, chatId, user.first_name);
                await handleAIReply(ctx, reply, chatId);
            }
            return;
        }
    }

    // Формат
    if (data.startsWith('format_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = `Формат: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Уровень
    if (data.startsWith('level_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = `Уровень: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Персонал
    if (data.startsWith('personnel_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = `Персонал: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Место
    if (data.startsWith('place_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = `Место: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Лифт
    if (data === 'lift_yes' || data === 'lift_no') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'lift_yes' ? 'Подъем: Есть грузовой лифт' : 'Подъем: Нужно носить по лестнице';
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Оборудование (множественный выбор с галочками)
    if (data.startsWith('equip_')) {
        if (!equipmentSelection.has(chatId)) equipmentSelection.set(chatId, new Set());
        const selSet = equipmentSelection.get(chatId);

        if (data === 'equip_done') {
            const typeNames = {
                sound: 'Звуковое оборудование',
                led: 'Светодиодные экраны',
                light: 'Световое оборудование',
                stage: 'Сценические конструкции',
                all: 'Полный комплекс'
            };
            const selected = Array.from(selSet).map(t => typeNames[t]);
            const messageText = selected.length > 0 ? `Выбрано оборудование: ${selected.join(', ')}` : 'Оборудование не выбрано';
            await ctx.answerCbQuery('Готово');
            try { await ctx.deleteMessage(); } catch (e) {}
            equipmentSelection.delete(chatId);
            await ctx.reply(messageText);
            const user = ctx.from;
            const reply = await askDeepSeek(messageText, chatId, user.first_name);
            await handleAIReply(ctx, reply, chatId);
        } else if (data === 'equip_all') {
            selSet.clear();
            selSet.add('all');
            await ctx.answerCbQuery('Выбран полный комплекс');
            await ctx.reply('🔧 Какое оборудование необходимо? (можно выбрать несколько)', getEquipmentKeyboard(chatId));
            try { await ctx.editMessageReplyMarkup(undefined); } catch (e) {}
        } else {
            const typeMap = {
                equip_sound: 'sound',
                equip_led: 'led',
                equip_light: 'light',
                equip_stage: 'stage'
            };
            const type = typeMap[data];
            if (!type) return;
            if (selSet.has(type)) {
                selSet.delete(type);
                await ctx.answerCbQuery('Убрано');
            } else {
                selSet.add(type);
                if (selSet.has('all')) selSet.delete('all');
                await ctx.answerCbQuery('Добавлено');
            }
            await ctx.reply('🔧 Какое оборудование необходимо? (можно выбрать несколько)', getEquipmentKeyboard(chatId));
            try { await ctx.deleteMessage(); } catch (e) {}
        }
        return;
    }

    // Монтаж
    if (data === 'mount_any' || data === 'mount_night') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'mount_any' ? 'Монтаж: Любое по согласованию' : 'Монтаж: Нужно смонтировать ночью/рано утром';
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Демонтаж
    if (data === 'demount_any' || data === 'demount_deadline') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'demount_any' ? 'Демонтаж: Любое по согласованию' : 'Демонтаж: Нужно демонтировать до определенного времени';
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await handleAIReply(ctx, reply, chatId);
        return;
    }

    // Ответить админу
    if (data.startsWith('reply_to_')) {
        lastActiveClient[ADMIN_CHAT_ID] = data.replace('reply_to_', '');
        await ctx.answerCbQuery('Теперь просто напишите /reply текст');
        await ctx.reply(`Активный клиент: ${lastActiveClient[ADMIN_CHAT_ID]}. Используйте /reply текст.`);
        return;
    }

    // Связаться с менеджером
    if (data === 'contact_manager') {
        manualMode[chatId] = true;
        await ctx.answerCbQuery('Заявка отправлена!');
        await ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
        lastActiveClient[ADMIN_CHAT_ID] = chatId;
        notifyAdmin(`📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId}) запросил менеджера.`);
        return;
    }

    // Кнопка "Отправить ТЗ"
    if (data === 'send_tz') {
        await ctx.answerCbQuery();
        await ctx.reply('Отлично! Отправьте все файлы (ТЗ, райдеры, схемы), и я передам их в отдел подготовки КП.');
        if (!sessions[chatId]) sessions[chatId] = [];
        sessions[chatId].push({ role: 'system', content: 'Клиент хочет отправить файлы.' });
        return;
    }

    // Кнопка "Начать опрос"
    if (data === 'start_survey') {
        await ctx.answerCbQuery();
        await ctx.reply('Хорошо, давайте начнём опрос. 🎭 Выберите формат мероприятия:', getFormatKeyboard());
        return;
    }
});

// ---------- Текстовые сообщения ----------
bot.on('text', async (ctx, next) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;
    const user = ctx.from;
    if (String(user.id) === String(ADMIN_CHAT_ID)) return next();

    lastActiveClient[ADMIN_CHAT_ID] = user.id;
    notifyAdmin(`📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`);

    if (manualMode[chatId]) return;

    const lowerMessage = userMessage.toLowerCase();
    const addPortfolio = PORTFOLIO_KEYWORDS.some(keyword => lowerMessage.includes(keyword));

    ctx.sendChatAction('typing');
    try {
        const reply = await askDeepSeek(userMessage, chatId, user.first_name, addPortfolio);
        await handleAIReply(ctx, reply, chatId);
    } catch (err) {
        console.error('Ошибка DeepSeek:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка.');
    }
});

// ---------- Команды ----------
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    ctx.reply('Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ». Если у вас есть готовое ТЗ, райдеры или файлы, отправьте их, и я передам в отдел подготовки КП. Если нет, я задам несколько вопросов для точного расчёта.', Markup.inlineKeyboard([
        [Markup.button.callback('📎 Отправить ТЗ и другие файлы', 'send_tz')],
        [Markup.button.callback('📋 Начать опрос', 'start_survey')]
    ]));
});

bot.command('reply', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    const targetId = lastActiveClient[ADMIN_CHAT_ID];
    if (!targetId) return ctx.reply('Нет активного клиента.');
    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply('Напишите текст после /reply');
    bot.telegram.sendMessage(targetId, text)
        .then(() => { ctx.reply('✅ Отправлено'); })
        .catch(err => ctx.reply('❌ Ошибка отправки.'));
});

bot.command('resume', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    Object.keys(manualMode).forEach(key => delete manualMode[key]);
    ctx.reply('Автоответы возобновлены.');
});

bot.command('portfolio', (ctx) => {
    ctx.reply(PORTFOLIO_TEXT || 'Портфолио временно недоступно.');
});

// ---------- Пересылка файлов ----------
bot.on('document', async (ctx) => {
    const chatId = ctx.chat.id;
    if (sessions[chatId] && sessions[chatId].some(m => m.content === 'Клиент хочет отправить файлы.')) {
        const user = ctx.from;
        const doc = ctx.message.document;
        await ctx.reply('Спасибо! Файлы получены, я передаю их в отдел подготовки КП.');
        try {
            await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, {
                caption: `📎 Файл от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})\nИмя файла: ${doc.file_name || 'неизвестно'}`
            });
        } catch (err) { console.error('Ошибка пересылки:', err.message); }
        sessions[chatId] = sessions[chatId].filter(m => m.content !== 'Клиент хочет отправить файлы.');
        return;
    }
    const user = ctx.from;
    const doc = ctx.message.document;
    await ctx.reply('Спасибо! Я передал ваш файл менеджеру.');
    try {
        await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, {
            caption: `📎 Документ от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})\nИмя файла: ${doc.file_name || 'неизвестно'}`
        });
    } catch (err) { console.error('Ошибка пересылки:', err.message); }
});

bot.on('photo', async (ctx) => {
    const user = ctx.from;
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;
    const largest = photos[photos.length - 1];
    await ctx.reply('Спасибо! Я передал ваше фото менеджеру.');
    try {
        await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, largest.file_id, {
            caption: `📷 Фото от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})`
        });
    } catch (err) { console.error('Ошибка пересылки:', err.message); }
});

// ---------- HTTP сервер ----------
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 10000);

// ---------- Защита от падений ----------
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    console.error('Необработанная ошибка:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Фатальная ошибка:', err.message);
    setTimeout(() => process.exit(1), 1000);
});

async function launchBot() {
    loadSessions();
    while (true) {
        try {
            await bot.launch();
            console.log('Бот MLK запущен');
            notifyAdmin('✅ Бот запущен и работает');
            break;
        } catch (err) {
            console.error('Ошибка запуска, повтор через 5 сек:', err.message);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

launchBot();