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

// ---------- Клавиатуры ----------
function getFormatKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Концерты & Фестивали', 'fmt_concerts')],
        [Markup.button.callback('Конференции & Презентации & TV-проекты', 'fmt_conferences')],
        [Markup.button.callback('Корпоративы & Торжества', 'fmt_corporate')],
        [Markup.button.callback('Выставки', 'fmt_exhibitions')],
        [Markup.button.callback('Спортивные мероприятия', 'fmt_sports')]
    ]);
}

function getLevelKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Стандартный (обычные требования)', 'lvl_standard')],
        [Markup.button.callback('Высокие требования (ТВ-трансляции)', 'lvl_high')],
        [Markup.button.callback('Высший уровень (высшие лица, международные)', 'lvl_top')]
    ]);
}

function getPersonnelKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Управление оборудованием', 'prs_manage')],
        [Markup.button.callback('Дежурный техник', 'prs_duty')],
        [Markup.button.callback('Только монтаж-демонтаж', 'prs_mount')],
        [Markup.button.callback('Другое', 'prs_other')]
    ]);
}

function getPlaceKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Улица', 'plc_outdoor')],
        [Markup.button.callback('Помещение', 'plc_indoor')],
        [Markup.button.callback('Под навесом', 'plc_tent')]
    ]);
}

function getLiftKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Есть грузовой лифт', 'lft_yes')],
        [Markup.button.callback('Нужно носить по лестнице', 'lft_no')]
    ]);
}

function getMountKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Любое по согласованию', 'mnt_any')],
        [Markup.button.callback('Ночью/рано утром', 'mnt_night')]
    ]);
}

function getDemountKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Любое по согласованию', 'dmt_any')],
        [Markup.button.callback('До определённого времени', 'dmt_deadline')]
    ]);
}

function getEquipmentKeyboard(chatId, equipmentSet) {
    const mark = (type) => equipmentSet.has(type) ? '✅ ' : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback(mark('sound') + 'Звуковое оборудование', 'eqp_sound')],
        [Markup.button.callback(mark('led') + 'Светодиодные экраны', 'eqp_led')],
        [Markup.button.callback(mark('light') + 'Световое оборудование', 'eqp_light')],
        [Markup.button.callback(mark('stage') + 'Сценические конструкции', 'eqp_stage')],
        [Markup.button.callback(mark('all') + 'Полный комплекс', 'eqp_all')],
        [Markup.button.callback('Готово (продолжить)', 'eqp_done')]
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
    const hours = Array.from({length: 24}, (_, i) => String(i).padStart(2, '0'));
    const minutes = ['00', '15', '30', '45'];
    const btns = [];
    for (let i = 0; i < hours.length; i += 6) {
        btns.push(hours.slice(i, i + 6).map(h => Markup.button.callback(h, `${prefix}_hour_${h}`)));
    }
    btns.push(minutes.map(m => Markup.button.callback(m, `${prefix}_min_${m}`)));
    btns.push([Markup.button.callback('Подтвердить', `${prefix}_time_done`)]);
    return Markup.inlineKeyboard(btns);
}

// ---------- Вызов DeepSeek с защитой ----------
async function callDeepSeek(messages) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages,
            temperature: 0.7,
            response_format: { type: 'json_object' }
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Пустой ответ DeepSeek');

    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        console.error('Ошибка парсинга JSON:', content);
        // Попробуем извлечь JSON из текста
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
            try { parsed = JSON.parse(match[0]); } catch (e2) {}
        }
        if (!parsed) {
            // Возвращаем заглушку
            return { message: 'Извините, произошла техническая ошибка.', action: 'none' };
        }
    }

    return {
        message: parsed.message || parsed.text || parsed.reply || 'Извините, я не понял.',
        action: parsed.action || parsed.next_step || 'none',
        options: parsed.options || []
    };
}

async function notifyAdmin(text) {
    if (!ADMIN_CHAT_ID) return;
    try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text); } catch (e) { console.error(e); }
}

// ---------- Состояние ----------
const stateMap = new Map(); // chatId -> { history: [], equipment: Set, awaiting... }

// ---------- Универсальный обработчик действий ----------
async function handleAction(ctx, chatId, action) {
    const state = stateMap.get(chatId);
    if (!state) return;
    if (action === 'none' || !action) return;
    if (action === 'ask_format') await ctx.reply('🎭 Выберите формат:', getFormatKeyboard());
    else if (action === 'ask_level') await ctx.reply('📊 Укажите уровень:', getLevelKeyboard());
    else if (action === 'ask_personnel') await ctx.reply('👷 Выберите персонал:', getPersonnelKeyboard());
    else if (action === 'ask_date_start') await ctx.reply('📅 Выберите дату начала:', getCalendar(new Date().getFullYear(), new Date().getMonth(), 'dts'));
    else if (action === 'ask_date_end') await ctx.reply('📅 Выберите дату окончания:', getCalendar(new Date().getFullYear(), new Date().getMonth(), 'dte'));
    else if (action === 'ask_ready_date') await ctx.reply('📅 Готовность оборудования:', getCalendar(new Date().getFullYear(), new Date().getMonth(), 'rdy'));
    else if (action === 'ask_place') await ctx.reply('📍 Где проходит мероприятие?', getPlaceKeyboard());
    else if (action === 'ask_lift') await ctx.reply('🛗 Подъем оборудования:', getLiftKeyboard());
    else if (action === 'ask_equipment') {
        if (!state.equipment) state.equipment = new Set();
        await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, state.equipment));
    }
    else if (action === 'ask_mount') await ctx.reply('⏱ Время монтажа:', getMountKeyboard());
    else if (action === 'ask_demount') await ctx.reply('⏱ Время демонтажа:', getDemountKeyboard());
}

// ---------- Обработка текстовых сообщений ----------
bot.on('text', async (ctx, next) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;
    const user = ctx.from;
    if (String(user.id) === String(ADMIN_CHAT_ID)) return next();

    let state = stateMap.get(chatId);
    if (!state) {
        state = { history: [] };
        stateMap.set(chatId, state);
    }

    notifyAdmin(`📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`);

    // Портфолио
    if (PORTFOLIO_KEYWORDS.some(k => userMessage.toLowerCase().includes(k))) {
        await ctx.reply(PORTFOLIO_TEXT);
        return;
    }

    // Уточнения
    if (state.awaitingPersonnelOther) {
        delete state.awaitingPersonnelOther;
        state.history.push({ role: 'system', content: `Клиент выбрал персонал (другое): ${userMessage}` });
        await ctx.reply(`Записал: ${userMessage}`);
        const json = await callDeepSeek([{ role: 'system', content: SYSTEM_PROMPT }, ...state.history.slice(-20)]);
        state.history.push({ role: 'assistant', content: json.message });
        if (json.message) await ctx.reply(json.message);
        handleAction(ctx, chatId, json.action);
        return;
    }
    // (аналогично для floor, lift_size, mount_detail, demount_detail)

    const history = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `Имя клиента: ${user.first_name}` },
        ...state.history.slice(-20),
        { role: 'user', content: userMessage }
    ];
    const json = await callDeepSeek(history);
    state.history.push({ role: 'user', content: userMessage });
    state.history.push({ role: 'assistant', content: json.message });
    if (json.message) await ctx.reply(json.message);
    handleAction(ctx, chatId, json.action);
});

// ---------- Колбэки (аналогично с валидацией) ----------
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

    let state = stateMap.get(chatId);
    if (!state) { state = { history: [] }; stateMap.set(chatId, state); }

    if (data === 'send_tz') { /* ... */ return; }
    if (data === 'start_survey') { /* ... */ return; }

    // Календари, время, кнопки – везде вызываем callDeepSeek и handleAction с проверкой json.action
    // Пример для формата:
    if (data.startsWith('fmt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || data;
        state.history.push({ role: 'system', content: `Клиент выбрал формат: ${text}` });
        const json = await callDeepSeek([{ role: 'system', content: SYSTEM_PROMPT }, ...state.history.slice(-20)]);
        state.history.push({ role: 'assistant', content: json.message });
        if (json.message) await ctx.reply(json.message);
        handleAction(ctx, chatId, json.action);
        return;
    }
    // Остальные колбэки обрабатываются по тому же шаблону.
});

// ---------- Старт ----------
bot.start((ctx) => {
    ctx.reply(
        'Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».\n\nЕсли у вас есть готовые файлы с полной информацией по мероприятию (ТЗ, райдеры, даты, любые другие файлы), вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.\n\nИли мы можем обсудить ваше мероприятие, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.\n\nС чего начнём?',
        Markup.inlineKeyboard([
            [Markup.button.callback('📎 Отправить файлы', 'send_tz')],
            [Markup.button.callback('💬 Продолжить диалог', 'start_survey')]
        ])
    );
});

// ---------- Остальные команды и сервер ----------
// (без изменений, как в предыдущей версии)