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

// ---------- Вызов DeepSeek с JSON Output ----------
async function callDeepSeek(messages) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages,
            temperature: 0.7,
            response_format: { type: 'json_object' }
        })
    });
    const data = await response.json();
    if (data.error) throw new Error('DeepSeek API error: ' + data.error.message);
    if (!data.choices?.[0]?.message?.content) throw new Error('Invalid DeepSeek response');
    return JSON.parse(data.choices[0].message.content);
}

async function notifyAdmin(text) {
    if (!ADMIN_CHAT_ID) return;
    try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text); } catch (e) { console.error(e); }
}

// ---------- Хранилище состояния ----------
const stateMap = new Map(); // chatId -> { history: [], equipment: Set, awaitingTime, ... }

// ---------- Обработка сообщений ----------
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

    // Уведомление админу
    notifyAdmin(`📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`);

    // Проверка на портфолио
    const lower = userMessage.toLowerCase();
    if (PORTFOLIO_KEYWORDS.some(k => lower.includes(k))) {
        await ctx.reply(PORTFOLIO_TEXT);
        return;
    }

    // Формируем историю
    const history = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `Имя клиента: ${user.first_name}` }
    ];
    // Добавляем последние 10 сообщений
    const recent = state.history.slice(-20);
    history.push(...recent);
    history.push({ role: 'user', content: userMessage });

    try {
        const json = await callDeepSeek(history);
        // Сохраняем ответ в историю
        state.history.push({ role: 'user', content: userMessage });
        state.history.push({ role: 'assistant', content: json.message || '' });

        // Отправляем текстовое сообщение
        if (json.message) {
            await ctx.reply(json.message);
        }

        // Показываем клавиатуру в зависимости от action
        const action = json.action;
        if (action === 'ask_format') {
            await ctx.reply('🎭 Выберите формат:', getFormatKeyboard());
        } else if (action === 'ask_level') {
            await ctx.reply('📊 Укажите уровень:', getLevelKeyboard());
        } else if (action === 'ask_personnel') {
            await ctx.reply('👷 Выберите персонал:', getPersonnelKeyboard());
        } else if (action === 'ask_date_start') {
            const now = new Date();
            await ctx.reply('📅 Выберите дату начала:', getCalendar(now.getFullYear(), now.getMonth(), 'dts'));
        } else if (action === 'ask_date_end') {
            const now = new Date();
            await ctx.reply('📅 Выберите дату окончания:', getCalendar(now.getFullYear(), now.getMonth(), 'dte'));
        } else if (action === 'ask_ready_date') {
            const now = new Date();
            await ctx.reply('📅 Готовность оборудования:', getCalendar(now.getFullYear(), now.getMonth(), 'rdy'));
        } else if (action === 'ask_place') {
            await ctx.reply('📍 Где проходит мероприятие?', getPlaceKeyboard());
        } else if (action === 'ask_lift') {
            await ctx.reply('🛗 Подъем оборудования:', getLiftKeyboard());
        } else if (action === 'ask_equipment') {
            if (!state.equipment) state.equipment = new Set();
            stateMap.set(chatId, state);
            await ctx.reply('🔧 Выберите оборудование (можно несколько):', getEquipmentKeyboard(chatId, state.equipment));
        } else if (action === 'ask_mount') {
            await ctx.reply('⏱ Время монтажа:', getMountKeyboard());
        } else if (action === 'ask_demount') {
            await ctx.reply('⏱ Время демонтажа:', getDemountKeyboard());
        }
        // action === 'none' – ничего дополнительно не показываем
    } catch (err) {
        console.error('Ошибка DeepSeek:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка. Пожалуйста, попробуйте позже.');
    }
});

// ---------- Обработка колбэков ----------
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

    let state = stateMap.get(chatId);
    if (!state) {
        state = { history: [] };
        stateMap.set(chatId, state);
    }

    // Стартовые кнопки
    if (data === 'send_tz') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        await ctx.reply('Отлично! Отправьте все файлы (ТЗ, райдеры, схемы), и я передам их в отдел подготовки КП.');
        state.history.push({ role: 'system', content: 'Клиент хочет отправить файлы.' });
        return;
    }
    if (data === 'start_survey') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        // Начинаем опрос с формата
        const json = { message: 'Давайте начнём. Выберите формат мероприятия:', action: 'ask_format' };
        state.history.push({ role: 'assistant', content: json.message });
        await ctx.reply(json.message);
        await ctx.reply('🎭 Выберите формат:', getFormatKeyboard());
        return;
    }

    // Календари
    if (data.startsWith('dts') || data.startsWith('dte') || data.startsWith('rdy')) {
        const p = data.split('_');
        const prefix = p[0] + '_' + p[1]; // dts_, dte_, rdy_
        if (p[2] === 'prev' || p[2] === 'next') {
            const year = +p[3], month = +p[4];
            const d = new Date(year, month);
            if (p[2] === 'prev') d.setMonth(d.getMonth()-1); else d.setMonth(d.getMonth()+1);
            await ctx.editMessageText('📅 Выберите дату:', getCalendar(d.getFullYear(), d.getMonth(), prefix.slice(0,3)));
        } else if (p[2] === 'set') {
            const dateStr = p[3];
            await ctx.answerCbQuery(`Выбрано: ${dateStr}`);
            // Показываем время
            const stepMap = { dts: 'date_start', dte: 'date_end', rdy: 'ready_date' };
            const step = stepMap[prefix.slice(0,3)];
            await ctx.editMessageText(`Выберите время для ${step === 'date_start' ? 'начала' : step === 'date_end' ? 'окончания' : 'готовности'}:`, getTimeKeyboard(prefix.slice(0,3)));
            if (!state.time) state.time = {};
            if (!state.time[step]) state.time[step] = { hour: '00', min: '00' };
            state.dateStr = dateStr;
            stateMap.set(chatId, state);
        } else if (p[2] === 'skip') {
            await ctx.answerCbQuery('Пропущено');
            await ctx.editMessageReplyMarkup(undefined);
            const stepMap = { dts: 'date_start', dte: 'date_end', rdy: 'ready_date' };
            const step = stepMap[prefix.slice(0,3)];
            const msg = `${step} не указано`;
            state.history.push({ role: 'user', content: msg });
            stateMap.set(chatId, state);
            await ctx.reply('Пропущено');
        }
        return;
    }

    // Время
    if (data.includes('_hour_') || data.includes('_min_') || data.endsWith('_time_done')) {
        const parts = data.split('_');
        const prefix = parts[0] + '_' + parts[1]; // dts, dte, rdy
        const stepMap = { dts: 'date_start', dte: 'date_end', rdy: 'ready_date' };
        const step = stepMap[prefix];
        if (!state.time) state.time = {};
        if (!state.time[step]) state.time[step] = { hour: '00', min: '00' };
        if (data.endsWith('_time_done')) {
            const { hour, min } = state.time[step];
            const full = `${state.dateStr} ${hour}:${min}`;
            state.history.push({ role: 'user', content: `${step}: ${full}` });
            delete state.dateStr;
            stateMap.set(chatId, state);
            await ctx.editMessageReplyMarkup(undefined);
            await ctx.reply(`${step === 'date_start' ? 'Дата начала' : step === 'date_end' ? 'Дата окончания' : 'Готовность'}: ${full}`);
            await ctx.answerCbQuery();
            return;
        }
        if (data.includes('_hour_')) state.time[step].hour = parts[parts.length-1];
        else if (data.includes('_min_')) state.time[step].min = parts[parts.length-1];
        const { hour, min } = state.time[step];
        await ctx.editMessageText(`Выбрано: ${hour}:${min}. Нажмите "Подтвердить"`, getTimeKeyboard(prefix));
        await ctx.answerCbQuery();
        return;
    }

    // Формат
    if (data.startsWith('fmt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('fmt_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        state.history.push({ role: 'user', content: `Формат: ${text}` });
        stateMap.set(chatId, state);
        await ctx.reply(text);
        // После формата вызываем ИИ, чтобы он предложил следующий шаг
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_level') {
                await ctx.reply('📊 Укажите уровень:', getLevelKeyboard());
            } else if (json.action === 'ask_personnel') {
                await ctx.reply('👷 Выберите персонал:', getPersonnelKeyboard());
            } else if (json.action === 'ask_date_start') {
                const now = new Date();
                await ctx.reply('📅 Выберите дату начала:', getCalendar(now.getFullYear(), now.getMonth(), 'dts'));
            } // ... и т.д. для других действий
        } catch (e) { console.error(e); }
        return;
    }

    // Уровень
    if (data.startsWith('lvl_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || '';
        state.history.push({ role: 'user', content: `Уровень: ${text}` });
        stateMap.set(chatId, state);
        await ctx.reply(text);
        // Вызываем ИИ для продолжения
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_personnel') {
                await ctx.reply('👷 Выберите персонал:', getPersonnelKeyboard());
            } else if (json.action === 'ask_date_start') {
                const now = new Date();
                await ctx.reply('📅 Выберите дату начала:', getCalendar(now.getFullYear(), now.getMonth(), 'dts'));
            } // ...
        } catch (e) { console.error(e); }
        return;
    }

    // Персонал
    if (data.startsWith('prs_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('prs_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        state.history.push({ role: 'user', content: `Персонал: ${text}` });
        if (val === 'other') {
            await ctx.reply('Пожалуйста, опишите ваш вариант обслуживания:');
            state.awaitingPersonnelOther = true;
            stateMap.set(chatId, state);
            return;
        }
        stateMap.set(chatId, state);
        await ctx.reply(text);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_date_start') {
                const now = new Date();
                await ctx.reply('📅 Выберите дату начала:', getCalendar(now.getFullYear(), now.getMonth(), 'dts'));
            } // ...
        } catch (e) { console.error(e); }
        return;
    }

    // Место
    if (data.startsWith('plc_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('plc_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        state.history.push({ role: 'user', content: `Место: ${text}` });
        stateMap.set(chatId, state);
        await ctx.reply(text);
        if (val === 'indoor') {
            await ctx.reply('На каком этаже?');
            state.awaitingFloor = true;
        } else {
            try {
                const messages = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...state.history.slice(-10)
                ];
                const json = await callDeepSeek(messages);
                state.history.push({ role: 'assistant', content: json.message || '' });
                if (json.message) await ctx.reply(json.message);
                if (json.action === 'ask_equipment') {
                    if (!state.equipment) state.equipment = new Set();
                    stateMap.set(chatId, state);
                    await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, state.equipment));
                } // ...
            } catch (e) { console.error(e); }
        }
        return;
    }

    // Лифт
    if (data.startsWith('lft_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('lft_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        state.history.push({ role: 'user', content: `Подъем: ${text}` });
        stateMap.set(chatId, state);
        await ctx.reply(text);
        if (val === 'yes') {
            await ctx.reply('Какие габариты грузового лифта? (примерно)');
            state.awaitingLiftSize = true;
        } else {
            try {
                const messages = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...state.history.slice(-10)
                ];
                const json = await callDeepSeek(messages);
                state.history.push({ role: 'assistant', content: json.message || '' });
                if (json.message) await ctx.reply(json.message);
                if (json.action === 'ask_equipment') {
                    if (!state.equipment) state.equipment = new Set();
                    stateMap.set(chatId, state);
                    await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, state.equipment));
                } // ...
            } catch (e) { console.error(e); }
        }
        return;
    }

    // Оборудование
    if (data.startsWith('eqp_')) {
        if (!state.equipment) state.equipment = new Set();
        const set = state.equipment;
        if (data === 'eqp_done') {
            const names = { sound: 'Звук', led: 'Экраны', light: 'Свет', stage: 'Сцена', all: 'Полный комплекс' };
            const sel = Array.from(set).map(t => names[t]).join(', ') || 'ничего не выбрано';
            state.history.push({ role: 'user', content: `Выбрано оборудование: ${sel}` });
            await ctx.answerCbQuery('Готово');
            try { await ctx.deleteMessage(); } catch (e) {}
            stateMap.set(chatId, state);
            await ctx.reply(`Выбрано оборудование: ${sel}`);
            try {
                const messages = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...state.history.slice(-10)
                ];
                const json = await callDeepSeek(messages);
                state.history.push({ role: 'assistant', content: json.message || '' });
                if (json.message) await ctx.reply(json.message);
                if (json.action === 'ask_mount') {
                    await ctx.reply('⏱ Время монтажа:', getMountKeyboard());
                } // ...
            } catch (e) { console.error(e); }
        } else if (data === 'eqp_all') {
            set.clear(); set.add('all');
            await ctx.answerCbQuery('Полный комплекс');
            await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, set));
            try { await ctx.editMessageReplyMarkup(undefined); } catch (e) {}
        } else {
            const type = data.replace('eqp_', '');
            if (set.has(type)) { set.delete(type); await ctx.answerCbQuery('Убрано'); }
            else { set.add(type); if (set.has('all')) set.delete('all'); await ctx.answerCbQuery('Добавлено'); }
            await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, set));
            try { await ctx.deleteMessage(); } catch (e) {}
        }
        stateMap.set(chatId, state);
        return;
    }

    // Монтаж
    if (data.startsWith('mnt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('mnt_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        state.history.push({ role: 'user', content: `Монтаж: ${text}` });
        if (val === 'night') {
            await ctx.reply('До какого времени нужен монтаж? (введите время, например, 06:00)');
            state.awaitingMountDetail = true;
            stateMap.set(chatId, state);
            return;
        }
        stateMap.set(chatId, state);
        await ctx.reply(text);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_demount') {
                await ctx.reply('⏱ Время демонтажа:', getDemountKeyboard());
            } // ...
        } catch (e) { console.error(e); }
        return;
    }

    // Демонтаж
    if (data.startsWith('dmt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('dmt_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        state.history.push({ role: 'user', content: `Демонтаж: ${text}` });
        if (val === 'deadline') {
            await ctx.reply('До какого времени нужен демонтаж? (введите время)');
            state.awaitingDemountDetail = true;
            stateMap.set(chatId, state);
            return;
        }
        stateMap.set(chatId, state);
        await ctx.reply(text);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            // На этом этапе ИИ может предложить confirm или задать дополнительные вопросы
        } catch (e) { console.error(e); }
        return;
    }

    // Ответить админу
    if (data.startsWith('reply_to_')) {
        // ... (как раньше)
        return;
    }
    // Связаться с менеджером
    if (data === 'contact_manager') {
        // ... (как раньше)
        return;
    }
});

// Обработка текстовых уточнений (другое персонал, этаж, лифт, детали монтажа/демонтажа)
bot.on('text', async (ctx, next) => {
    const chatId = ctx.chat.id;
    const msg = ctx.message.text;
    const user = ctx.from;
    if (String(user.id) === String(ADMIN_CHAT_ID)) return next();

    let state = stateMap.get(chatId);
    if (!state) {
        state = { history: [] };
        stateMap.set(chatId, state);
    }

    if (state.awaitingPersonnelOther) {
        delete state.awaitingPersonnelOther;
        state.history.push({ role: 'user', content: `Персонал (другое): ${msg}` });
        stateMap.set(chatId, state);
        await ctx.reply(`Записал: ${msg}`);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_date_start') {
                const now = new Date();
                await ctx.reply('📅 Выберите дату начала:', getCalendar(now.getFullYear(), now.getMonth(), 'dts'));
            } // ...
        } catch (e) { console.error(e); }
        return;
    }

    if (state.awaitingFloor) {
        delete state.awaitingFloor;
        state.history.push({ role: 'user', content: `Этаж: ${msg}` });
        stateMap.set(chatId, state);
        if (parseInt(msg) > 2) {
            await ctx.reply('Есть ли грузовой лифт?', getLiftKeyboard());
        } else {
            try {
                const messages = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...state.history.slice(-10)
                ];
                const json = await callDeepSeek(messages);
                state.history.push({ role: 'assistant', content: json.message || '' });
                if (json.message) await ctx.reply(json.message);
                if (json.action === 'ask_equipment') {
                    if (!state.equipment) state.equipment = new Set();
                    stateMap.set(chatId, state);
                    await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, state.equipment));
                }
            } catch (e) { console.error(e); }
        }
        return;
    }

    if (state.awaitingLiftSize) {
        delete state.awaitingLiftSize;
        state.history.push({ role: 'user', content: `Габариты лифта: ${msg}` });
        stateMap.set(chatId, state);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_equipment') {
                if (!state.equipment) state.equipment = new Set();
                stateMap.set(chatId, state);
                await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId, state.equipment));
            }
        } catch (e) { console.error(e); }
        return;
    }

    if (state.awaitingMountDetail) {
        delete state.awaitingMountDetail;
        state.history.push({ role: 'user', content: `Монтаж (уточнение): ${msg}` });
        stateMap.set(chatId, state);
        await ctx.reply(`Записал: ${msg}`);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            if (json.action === 'ask_demount') {
                await ctx.reply('⏱ Время демонтажа:', getDemountKeyboard());
            }
        } catch (e) { console.error(e); }
        return;
    }

    if (state.awaitingDemountDetail) {
        delete state.awaitingDemountDetail;
        state.history.push({ role: 'user', content: `Демонтаж (уточнение): ${msg}` });
        stateMap.set(chatId, state);
        await ctx.reply(`Записал: ${msg}`);
        try {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...state.history.slice(-10)
            ];
            const json = await callDeepSeek(messages);
            state.history.push({ role: 'assistant', content: json.message || '' });
            if (json.message) await ctx.reply(json.message);
            // Возможно, завершение опроса
        } catch (e) { console.error(e); }
        return;
    }

    // Если нет активных уточнений, обрабатываем как обычное сообщение
    // (основной обработчик уже выше)
});

// ---------- Старт ----------
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    ctx.reply(
        'Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».\n\nЕсли у вас есть готовые файлы с полной информацией по мероприятию (ТЗ, райдеры, даты, любые другие файлы), вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.\n\nИли мы можем обсудить ваше мероприятие, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.\n\nС чего начнём?',
        Markup.inlineKeyboard([
            [Markup.button.callback('📎 Отправить файлы', 'send_tz')],
            [Markup.button.callback('💬 Продолжить диалог', 'start_survey')]
        ])
    );
});

// ---------- Остальное (reply, resume, portfolio, файлы) ----------
const lastActiveClient = {};
const manualMode = {};

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
    Object.keys(manualMode).forEach(k => delete manualMode[k]);
    ctx.reply('Автоответы возобновлены.');
});

bot.command('portfolio', (ctx) => {
    ctx.reply(fs.readFileSync('./portfolio.txt', 'utf8') || 'Нет данных.');
});

bot.on('document', async (ctx) => {
    const chatId = ctx.chat.id;
    const user = ctx.from;
    const doc = ctx.message.document;
    await ctx.reply('Спасибо! Я передал ваш файл менеджеру.');
    try { await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, { caption: `📎 Файл от ${user.first_name} ...` }); } catch (e) {}
});

bot.on('photo', async (ctx) => {
    const user = ctx.from;
    const photos = ctx.message.photo;
    if (!photos?.length) return;
    const largest = photos[photos.length-1];
    await ctx.reply('Спасибо! Я передал ваше фото менеджеру.');
    try { await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, largest.file_id, { caption: `📷 Фото от ${user.first_name} ...` }); } catch (e) {}
});

http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 10000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));
process.on('uncaughtException', (err) => { console.error('Fatal:', err.message); setTimeout(() => process.exit(1), 1000); });

(async () => {
    while (true) {
        try {
            await bot.launch();
            console.log('Бот MLK запущен (JSON Output)');
            break;
        } catch (e) {
            console.error('Ошибка запуска:', e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
})();