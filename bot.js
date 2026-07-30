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

// Хранилище состояний диалога и выбора оборудования
const userState = new Map(); // chatId -> { step, data }
// Шаги: 'format', 'date_start', 'date_end', 'ready_date', 'place', 'equipment', 'mount', 'confirm', null

// Вспомогательные функции для отправки клавиатур
function getFormatKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Концерты & Фестивали', 'format_concerts')],
        [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conferences')],
        [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
        [Markup.button.callback('Выставки', 'format_exhibitions')],
        [Markup.button.callback('Спортивные мероприятия', 'format_sports')],
        [Markup.button.callback('Пропустить', 'format_skip')]
    ]);
}

function getPlaceKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Улица', 'place_outdoor')],
        [Markup.button.callback('Помещение', 'place_indoor')],
        [Markup.button.callback('Под навесом', 'place_tent')],
        [Markup.button.callback('Пропустить', 'place_skip')]
    ]);
}

function getMountKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Любое по согласованию', 'mount_any')],
        [Markup.button.callback('Нужно смонтировать ночью/рано утром', 'mount_night')],
        [Markup.button.callback('Пропустить', 'mount_skip')]
    ]);
}

function getEquipmentKeyboard(chatId) {
    const selected = userState.get(chatId)?.equipment || new Set();
    const mark = (type) => selected.has(type) ? '✅ ' : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback(mark('all') + 'Весь комплект', 'equip_all')],
        [Markup.button.callback(mark('sound') + 'Звуковое оборудование', 'equip_sound')],
        [Markup.button.callback(mark('led') + 'Светодиодные экраны', 'equip_led')],
        [Markup.button.callback(mark('light') + 'Световое оборудование', 'equip_light')],
        [Markup.button.callback(mark('stage') + 'Сценические конструкции', 'equip_stage')],
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

// Переход к следующему шагу
async function showNextStep(ctx, chatId) {
    const state = userState.get(chatId) || { step: 'format', data: {} };
    const now = new Date();
    switch (state.step) {
        case 'format':
            await ctx.reply('🎭 Выберите формат мероприятия:', getFormatKeyboard());
            break;
        case 'date_start':
            await ctx.reply('📅 Выберите дату начала мероприятия:', getCalendar(now.getFullYear(), now.getMonth(), 'date_start'));
            break;
        case 'date_end':
            await ctx.reply('📅 Выберите дату окончания:', getCalendar(now.getFullYear(), now.getMonth(), 'date_end'));
            break;
        case 'ready_date':
            await ctx.reply('📅 Готовность оборудования (можно пропустить):', getCalendar(now.getFullYear(), now.getMonth(), 'ready_date'));
            break;
        case 'place':
            await ctx.reply('📍 Где проходит мероприятие?', getPlaceKeyboard());
            break;
        case 'equipment':
            // При первом входе на шаг сбрасываем выбор
            if (!state.equipment) state.equipment = new Set();
            userState.set(chatId, state);
            await ctx.reply('🔧 Какое оборудование необходимо? (можно выбрать несколько)', getEquipmentKeyboard(chatId));
            break;
        case 'mount':
            await ctx.reply('⏱ Время монтажа:', getMountKeyboard());
            break;
        case 'confirm':
            // Собираем итоговую сводку и отправляем ИИ
            const summary = Object.entries(state.data)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n');
            // Отправляем ИИ сообщение-сводку для генерации финального ответа
            const reply = await askDeepSeek(`Сводка: ${summary}`, chatId, '', false);
            await ctx.reply(reply || 'Данные собраны. Менеджер свяжется с вами.');
            // Сбрасываем состояние
            userState.delete(chatId);
            break;
        default:
            break;
    }
}

// Обработка callback-запросов (календари, кнопки)
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

    const state = userState.get(chatId) || { step: 'format', data: {} };

    // Календари
    if (data.startsWith('date_start') || data.startsWith('date_end') || data.startsWith('ready_date')) {
        const parts = data.split('_');
        const prefix = parts[0] + '_' + parts[1]; // date_start, date_end, ready_date
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
            const labelMap = {
                date_start: 'Дата начала',
                date_end: 'Дата окончания',
                ready_date: 'Дата готовности'
            };
            state.data[prefix] = humanDate;
            // Переход к следующему шагу
            const stepOrder = ['date_start', 'date_end', 'ready_date'];
            const idx = stepOrder.indexOf(prefix);
            if (idx < stepOrder.length - 1) {
                state.step = stepOrder[idx + 1];
            } else {
                state.step = 'place';
            }
            userState.set(chatId, state);
            await ctx.reply(`${labelMap[prefix]}: ${humanDate}`);
            await showNextStep(ctx, chatId);
        } else if (parts[2] === 'skip') {
            await ctx.answerCbQuery('Пропущено');
            await ctx.editMessageReplyMarkup(undefined);
            const stepOrder = ['date_start', 'date_end', 'ready_date'];
            const idx = stepOrder.indexOf(prefix);
            if (idx < stepOrder.length - 1) {
                state.step = stepOrder[idx + 1];
            } else {
                state.step = 'place';
            }
            userState.set(chatId, state);
            await ctx.reply('Пропущено');
            await showNextStep(ctx, chatId);
        }
        return;
    }

    // Формат
    if (data.startsWith('format_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'format_skip' ? 'Формат не указан' : `Формат: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        state.data.format = text;
        state.step = 'date_start';
        userState.set(chatId, state);
        await ctx.reply(text);
        await showNextStep(ctx, chatId);
        return;
    }

    // Место
    if (data.startsWith('place_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'place_skip' ? 'Место не указано' : `Место: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        state.data.place = text;
        state.step = 'equipment';
        userState.set(chatId, state);
        await ctx.reply(text);
        await showNextStep(ctx, chatId);
        return;
    }

    // Оборудование
    if (data.startsWith('equip_')) {
        if (!state.equipment) state.equipment = new Set();
        if (data === 'equip_done') {
            const typeNames = {
                sound: 'Звуковое оборудование',
                led: 'Светодиодные экраны',
                light: 'Световое оборудование',
                stage: 'Сценические конструкции'
            };
            const selected = Array.from(state.equipment).map(t => typeNames[t]);
            const messageText = selected.length > 0 ? `Выбрано оборудование: ${selected.join(', ')}` : 'Оборудование не выбрано';
            await ctx.answerCbQuery('Готово');
            await ctx.editMessageReplyMarkup(undefined);
            state.data.equipment = messageText;
            state.step = 'mount';
            userState.set(chatId, state);
            await ctx.reply(messageText);
            await showNextStep(ctx, chatId);
        } else if (data === 'equip_all') {
            state.equipment = new Set(['sound', 'led', 'light', 'stage']);
            await ctx.answerCbQuery('Выбран полный комплект');
            await ctx.editMessageReplyMarkup(getEquipmentKeyboard(chatId));
        } else {
            const typeMap = {
                equip_sound: 'sound',
                equip_led: 'led',
                equip_light: 'light',
                equip_stage: 'stage'
            };
            const type = typeMap[data];
            if (!type) return;
            if (state.equipment.has(type)) {
                state.equipment.delete(type);
                await ctx.answerCbQuery('Убрано');
            } else {
                state.equipment.add(type);
                await ctx.answerCbQuery('Добавлено');
            }
            await ctx.editMessageReplyMarkup(getEquipmentKeyboard(chatId));
        }
        userState.set(chatId, state);
        return;
    }

    // Монтаж
    if (data.startsWith('mount_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'mount_skip' ? 'Время монтажа не указано' : `Монтаж: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        state.data.mount = text;
        state.step = 'confirm';
        userState.set(chatId, state);
        await ctx.reply(text);
        await showNextStep(ctx, chatId);
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
});

// Обработка текстовых сообщений (для ручного ввода дат, адреса, оборудования и т.д.)
bot.on('text', async (ctx, next) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;
    const user = ctx.from;
    if (String(user.id) === String(ADMIN_CHAT_ID)) return next();

    lastActiveClient[ADMIN_CHAT_ID] = user.id;
    notifyAdmin(`📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`, Markup.inlineKeyboard([Markup.button.callback('✉️ Ответить', `reply_to_${user.id}`)]));

    if (manualMode[chatId]) return;

    const state = userState.get(chatId);
    if (!state) {
        // Начинаем новый диалог
        userState.set(chatId, { step: 'format', data: {} });
        await ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Давайте подберём оборудование для вашего мероприятия.');
        await showNextStep(ctx, chatId);
        return;
    }

    // Если пользователь ввёл текст вместо кнопки, пытаемся интерпретировать
    // Для простоты просто переходим к следующему шагу, сохраняя текст как данные
    const stepMap = {
        'format': 'format',
        'date_start': 'date_start',
        'date_end': 'date_end',
        'ready_date': 'ready_date',
        'place': 'place',
        'equipment': 'equipment',
        'mount': 'mount'
    };
    state.data[state.step] = userMessage;
    const stepOrder = ['format', 'date_start', 'date_end', 'ready_date', 'place', 'equipment', 'mount'];
    const idx = stepOrder.indexOf(state.step);
    if (idx < stepOrder.length - 1) {
        state.step = stepOrder[idx + 1];
    } else {
        state.step = 'confirm';
    }
    userState.set(chatId, state);
    await showNextStep(ctx, chatId);
});

// Команды и остальное (без изменений)
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    userState.delete(chatId);
    userState.set(chatId, { step: 'format', data: {} });
    ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Давайте подберём оборудование для вашего мероприятия.');
    showNextStep(ctx, chatId);
});

bot.command('reply', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    const targetId = lastActiveClient[ADMIN_CHAT_ID];
    if (!targetId) return ctx.reply('Нет активного клиента.');
    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply('Напишите текст после /reply');
    bot.telegram.sendMessage(targetId, text)
        .then(() => { ctx.reply('✅ Отправлено'); notifyAdmin(`✉️ Ваш ответ клиенту ${targetId}:\n\n${text}`); })
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

// ... (остальной код: document, photo, message forwarding, http сервер, запуск)
// Ниже вставьте уже существующие обработчики document, photo, message, http сервер, launchBot, они без изменений.