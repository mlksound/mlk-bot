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

const stateMap = new Map(); // chatId -> { step, data, equipment: Set, awaitingTimeType, time }

// ---------- Клавиатуры ----------
const formatKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Концерты & Фестивали', 'fmt_concerts')],
    [Markup.button.callback('Конференции & Презентации & TV-проекты', 'fmt_conferences')],
    [Markup.button.callback('Корпоративы & Торжества', 'fmt_corporate')],
    [Markup.button.callback('Выставки', 'fmt_exhibitions')],
    [Markup.button.callback('Спортивные мероприятия', 'fmt_sports')]
]);

const levelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Стандартный (обычные требования)', 'lvl_standard')],
    [Markup.button.callback('Высокие требования (ТВ-трансляции)', 'lvl_high')],
    [Markup.button.callback('Высший уровень (высшие лица, международные)', 'lvl_top')]
]);

const personnelKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Управление оборудованием', 'prs_manage')],
    [Markup.button.callback('Дежурный техник', 'prs_duty')],
    [Markup.button.callback('Только монтаж-демонтаж', 'prs_mount')],
    [Markup.button.callback('Другое', 'prs_other')]
]);

const placeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Улица', 'plc_outdoor')],
    [Markup.button.callback('Помещение', 'plc_indoor')],
    [Markup.button.callback('Под навесом', 'plc_tent')]
]);

const liftKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Есть грузовой лифт', 'lft_yes')],
    [Markup.button.callback('Нужно носить по лестнице', 'lft_no')]
]);

const mountKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Любое по согласованию', 'mnt_any')],
    [Markup.button.callback('Ночью/рано утром', 'mnt_night')]
]);

const demountKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Любое по согласованию', 'dmt_any')],
    [Markup.button.callback('До определённого времени', 'dmt_deadline')]
]);

function getEquipmentKeyboard(chatId) {
    const s = stateMap.get(chatId);
    const sel = s?.equipment || new Set();
    const m = (type) => sel.has(type) ? '✅ ' : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback(m('sound') + 'Звуковое оборудование', 'eqp_sound')],
        [Markup.button.callback(m('led') + 'Светодиодные экраны', 'eqp_led')],
        [Markup.button.callback(m('light') + 'Световое оборудование', 'eqp_light')],
        [Markup.button.callback(m('stage') + 'Сценические конструкции', 'eqp_stage')],
        [Markup.button.callback(m('all') + 'Полный комплекс', 'eqp_all')],
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

// ---------- ИИ ----------
async function aiReply(prompt) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
    ];
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7 })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.choices[0].message.content;
}

async function notifyAdmin(text) {
    if (!ADMIN_CHAT_ID) return;
    try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text); } catch (e) { console.error(e); }
}

// ---------- Логика шагов ----------
async function goNext(ctx, chatId) {
    const s = stateMap.get(chatId);
    if (!s) return;
    let step = s.step;
    const data = s.data || {};
    s.data = data;

    // Пропуск неактуальных шагов
    if (step === 'level' && data.format_val && !['concerts','sports'].includes(data.format_val)) {
        s.step = 'personnel'; goNext(ctx, chatId); return;
    }
    if (step === 'guests' && data.format_val !== 'corporate') {
        s.step = 'personnel'; goNext(ctx, chatId); return;
    }
    if (step === 'floor' && data.place_val !== 'indoor') {
        s.step = 'equipment'; goNext(ctx, chatId); return;
    }
    if (step === 'lift' && (!data.floor || parseInt(data.floor) <= 2)) {
        s.step = 'equipment'; goNext(ctx, chatId); return;
    }
    if (step === 'lift_size' && data.lift_val !== 'yes') {
        s.step = 'equipment'; goNext(ctx, chatId); return;
    }

    const name = ctx.from?.first_name || 'клиент';
    let prompt = '';
    let keyboard = null;

    switch (step) {
        case 'format':
            prompt = 'Попроси клиента выбрать формат мероприятия.';
            keyboard = formatKeyboard;
            break;
        case 'level':
            prompt = 'Попроси клиента выбрать уровень мероприятия.';
            keyboard = levelKeyboard;
            break;
        case 'guests':
            prompt = 'Попроси клиента указать примерное количество гостей.';
            break;
        case 'personnel':
            prompt = 'Попроси клиента выбрать обслуживающий персонал.';
            keyboard = personnelKeyboard;
            break;
        case 'date_start':
            prompt = 'Попроси клиента выбрать дату начала мероприятия.';
            keyboard = getCalendar(new Date().getFullYear(), new Date().getMonth(), 'dts');
            break;
        case 'date_end':
            prompt = 'Попроси клиента выбрать дату окончания.';
            keyboard = getCalendar(new Date().getFullYear(), new Date().getMonth(), 'dte');
            break;
        case 'ready_date':
            prompt = 'Попроси клиента выбрать дату готовности оборудования.';
            keyboard = getCalendar(new Date().getFullYear(), new Date().getMonth(), 'rdy');
            break;
        case 'address':
            prompt = 'Попроси клиента ввести адрес площадки.';
            break;
        case 'place':
            prompt = 'Попроси клиента выбрать где проходит мероприятие.';
            keyboard = placeKeyboard;
            break;
        case 'floor':
            prompt = 'Попроси клиента указать этаж.';
            break;
        case 'lift':
            prompt = 'Попроси клиента выбрать способ подъема оборудования.';
            keyboard = liftKeyboard;
            break;
        case 'lift_size':
            prompt = 'Попроси клиента указать габариты лифта.';
            break;
        case 'equipment':
            prompt = 'Попроси клиента выбрать необходимое оборудование (можно несколько).';
            s.equipment = new Set();
            keyboard = getEquipmentKeyboard(chatId);
            break;
        case 'mount':
            prompt = 'Попроси клиента выбрать время монтажа.';
            keyboard = mountKeyboard;
            break;
        case 'demount':
            prompt = 'Попроси клиента выбрать время демонтажа.';
            keyboard = demountKeyboard;
            break;
        case 'confirm': {
            const summary = Object.entries(data).map(([k,v]) => `${k}: ${v}`).join('\n');
            prompt = `Подведи итог и скажи клиенту, что данные отправлены. Данные:\n${summary}`;
            break;
        }
        default: break;
    }
    stateMap.set(chatId, s);

    if (prompt) {
        let text;
        try {
            text = await aiReply(`${prompt} Имя клиента: ${name}. Текущие данные: ${JSON.stringify(data)}`);
        } catch (e) { text = 'Пожалуйста, ответьте на вопрос.'; }
        await ctx.reply(text);
    }
    if (keyboard) {
        await ctx.reply('Выберите вариант:', keyboard);
    }
}

// ---------- Обработчики колбэков ----------
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

    // Стартовые кнопки
    if (data === 'send_tz') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        await ctx.reply('Отлично! Отправьте все файлы (ТЗ, райдеры, схемы), и я передам их в отдел подготовки КП.');
        stateMap.set(chatId, { step: 'files', data: {} });
        return;
    }
    if (data === 'start_survey') {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        stateMap.set(chatId, { step: 'format', data: {} });
        goNext(ctx, chatId);
        return;
    }

    const s = stateMap.get(chatId);
    if (!s) return;

    // Время
    if (data.includes('_hour_') || data.includes('_min_') || data.endsWith('_time_done')) {
        const parts = data.split('_');
        const prefix = parts[0] + '_' + parts[1]; // dts, dte, rdy
        const stepMap = { dts: 'date_start', dte: 'date_end', rdy: 'ready_date' };
        const step = stepMap[prefix];
        if (!s.time) s.time = {};
        if (!s.time[step]) s.time[step] = { hour: '00', min: '00' };
        if (data.endsWith('_time_done')) {
            const { hour, min } = s.time[step];
            const full = `${s.dateStr} ${hour}:${min}`;
            s.data[step] = full;
            delete s.dateStr;
            const order = ['date_start', 'date_end', 'ready_date', 'address', 'place', 'floor', 'lift', 'lift_size', 'equipment', 'mount', 'demount', 'confirm'];
            const idx = order.indexOf(step);
            s.step = order[idx + 1] || 'confirm';
            stateMap.set(chatId, s);
            await ctx.editMessageReplyMarkup(undefined);
            await ctx.reply(`${step === 'date_start' ? 'Дата начала' : step === 'date_end' ? 'Дата окончания' : 'Готовность'}: ${full}`);
            goNext(ctx, chatId);
            await ctx.answerCbQuery();
            return;
        }
        if (data.includes('_hour_')) s.time[step].hour = parts[parts.length-1];
        else if (data.includes('_min_')) s.time[step].min = parts[parts.length-1];
        const { hour, min } = s.time[step];
        await ctx.editMessageText(`Выбрано: ${hour}:${min}. Нажмите "Подтвердить"`, getTimeKeyboard(prefix));
        await ctx.answerCbQuery();
        return;
    }

    // Календари
    if (data.startsWith('dts') || data.startsWith('dte') || data.startsWith('rdy')) {
        const p = data.split('_');
        const prefix = p[0] + '_' + p[1];
        if (p[2] === 'prev' || p[2] === 'next') {
            const year = +p[3], month = +p[4];
            const d = new Date(year, month);
            if (p[2] === 'prev') d.setMonth(d.getMonth()-1); else d.setMonth(d.getMonth()+1);
            await ctx.editMessageText('📅 Выберите дату:', getCalendar(d.getFullYear(), d.getMonth(), prefix.slice(0,3)));
        } else if (p[2] === 'set') {
            const dateStr = p[3];
            await ctx.answerCbQuery(`Выбрано: ${dateStr}`);
            s.dateStr = dateStr;
            const stepMap = { dts: 'date_start', dte: 'date_end', rdy: 'ready_date' };
            const step = stepMap[prefix.slice(0,3)];
            await ctx.editMessageText(`Выберите время для ${step === 'date_start' ? 'начала' : step === 'date_end' ? 'окончания' : 'готовности'}:`, getTimeKeyboard(prefix.slice(0,3)));
            if (!s.time) s.time = {};
            if (!s.time[step]) s.time[step] = { hour: '00', min: '00' };
            stateMap.set(chatId, s);
        } else if (p[2] === 'skip') {
            await ctx.answerCbQuery('Пропущено');
            await ctx.editMessageReplyMarkup(undefined);
            const stepMap = { dts: 'date_start', dte: 'date_end', rdy: 'ready_date' };
            const step = stepMap[prefix.slice(0,3)];
            s.data[step] = 'не указано';
            const order = ['date_start', 'date_end', 'ready_date', 'address', 'place', 'floor', 'lift', 'lift_size', 'equipment', 'mount', 'demount', 'confirm'];
            const idx = order.indexOf(step);
            s.step = order[idx+1] || 'confirm';
            stateMap.set(chatId, s);
            await ctx.reply('Пропущено');
            goNext(ctx, chatId);
        }
        return;
    }

    // Формат
    if (data.startsWith('fmt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('fmt_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        s.data.format = text;
        s.data.format_val = val;
        s.step = (val === 'concerts' || val === 'sports') ? 'level' : ((val === 'corporate') ? 'guests' : 'personnel');
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Уровень
    if (data.startsWith('lvl_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || '';
        s.data.level = text;
        s.step = 'personnel';
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Персонал
    if (data.startsWith('prs_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('prs_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        s.data.personnel = text;
        if (val === 'other') {
            s.step = 'personnel_other';
            stateMap.set(chatId, s);
            await ctx.reply('Пожалуйста, опишите ваш вариант обслуживания:');
            return;
        }
        s.step = 'date_start';
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Место
    if (data.startsWith('plc_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('plc_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        s.data.place = text;
        s.data.place_val = val;
        if (val === 'indoor') {
            s.step = 'floor';
        } else {
            s.step = 'equipment';
        }
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Лифт
    if (data.startsWith('lft_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('lft_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        s.data.lift = text;
        s.data.lift_val = val;
        if (val === 'yes') {
            s.step = 'lift_size';
        } else {
            s.step = 'equipment';
        }
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Монтаж
    if (data.startsWith('mnt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('mnt_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        s.data.mount = text;
        if (val === 'night') {
            s.awaitingTimeType = 'mount';
            s.step = 'mount_detail';
            stateMap.set(chatId, s);
            await ctx.reply('До какого времени должен быть завершён монтаж? (введите время, например, 06:00)');
            return;
        }
        s.step = 'demount';
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Демонтаж
    if (data.startsWith('dmt_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const val = data.replace('dmt_', '');
        const text = ctx.callbackQuery.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === data)?.text || val;
        s.data.demount = text;
        if (val === 'deadline') {
            s.awaitingTimeType = 'demount';
            s.step = 'demount_detail';
            stateMap.set(chatId, s);
            await ctx.reply('До какого времени нужно демонтировать? (введите время)');
            return;
        }
        s.step = 'confirm';
        stateMap.set(chatId, s);
        await ctx.reply(text);
        goNext(ctx, chatId);
        return;
    }

    // Оборудование
    if (data.startsWith('eqp_')) {
        if (!s.equipment) s.equipment = new Set();
        const set = s.equipment;
        if (data === 'eqp_done') {
            const names = { sound: 'Звук', led: 'Экраны', light: 'Свет', stage: 'Сцена', all: 'Полный комплекс' };
            const sel = Array.from(set).map(t => names[t]).join(', ') || 'ничего не выбрано';
            s.data.equipment = sel;
            await ctx.answerCbQuery('Готово');
            try { await ctx.deleteMessage(); } catch (e) {}
            s.step = 'mount';
            stateMap.set(chatId, s);
            await ctx.reply(`Выбрано оборудование: ${sel}`);
            goNext(ctx, chatId);
        } else if (data === 'eqp_all') {
            set.clear(); set.add('all');
            await ctx.answerCbQuery('Полный комплекс');
            await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId));
            try { await ctx.editMessageReplyMarkup(undefined); } catch (e) {}
        } else {
            const type = data.replace('eqp_', '');
            if (set.has(type)) { set.delete(type); await ctx.answerCbQuery('Убрано'); }
            else { set.add(type); if (set.has('all')) set.delete('all'); await ctx.answerCbQuery('Добавлено'); }
            await ctx.reply('🔧 Выберите оборудование:', getEquipmentKeyboard(chatId));
            try { await ctx.deleteMessage(); } catch (e) {}
        }
        stateMap.set(chatId, s);
        return;
    }
});

// ---------- Текстовые сообщения ----------
bot.on('text', async (ctx, next) => {
    const chatId = ctx.chat.id;
    const msg = ctx.message.text;
    const user = ctx.from;
    if (String(user.id) === String(ADMIN_CHAT_ID)) return next();

    const s = stateMap.get(chatId);
    if (!s) {
        stateMap.set(chatId, { step: 'format', data: {} });
        goNext(ctx, chatId);
        return;
    }

    if (s.awaitingTimeType) {
        const type = s.awaitingTimeType;
        const field = type === 'mount' ? 'mount' : 'demount';
        s.data[field] = `${s.data[field]}, точное время: ${msg}`;
        delete s.awaitingTimeType;
        s.step = type === 'mount' ? 'demount' : 'confirm';
        stateMap.set(chatId, s);
        await ctx.reply(`Записал: ${s.data[field]}`);
        goNext(ctx, chatId);
        return;
    }
    if (s.step === 'personnel_other') {
        s.data.personnel = `Другое: ${msg}`;
        s.step = 'date_start';
        stateMap.set(chatId, s);
        await ctx.reply(`Записал: ${s.data.personnel}`);
        goNext(ctx, chatId);
        return;
    }
    if (s.step === 'guests') {
        s.data.guests = msg;
        s.step = 'personnel';
        stateMap.set(chatId, s);
        await ctx.reply(`Гостей: ${msg}`);
        goNext(ctx, chatId);
        return;
    }
    if (s.step === 'address') {
        s.data.address = msg;
        s.step = 'place';
        stateMap.set(chatId, s);
        await ctx.reply(`Адрес: ${msg}`);
        goNext(ctx, chatId);
        return;
    }
    if (s.step === 'floor') {
        s.data.floor = msg;
        if (parseInt(msg) > 2) s.step = 'lift';
        else s.step = 'equipment';
        stateMap.set(chatId, s);
        await ctx.reply(`Этаж: ${msg}`);
        goNext(ctx, chatId);
        return;
    }
    if (s.step === 'lift_size') {
        s.data.lift_size = msg;
        s.step = 'equipment';
        stateMap.set(chatId, s);
        await ctx.reply(`Габариты лифта: ${msg}`);
        goNext(ctx, chatId);
        return;
    }

    // Остальное — вопрос к ИИ
    try {
        const reply = await aiReply(msg);
        await ctx.reply(reply);
    } catch (e) { console.error(e); }
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

// Остальное (reply, resume, portfolio, файлы, сервер)
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
    if (stateMap.get(chatId)?.step === 'files') {
        await ctx.reply('Спасибо! Файлы получены, я передаю их в отдел подготовки КП.');
        try { await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, { caption: `📎 Файл от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})` }); } catch (e) {}
        stateMap.delete(chatId);
        return;
    }
    await ctx.reply('Спасибо! Я передал ваш файл менеджеру.');
    try { await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, { caption: `📎 Документ от ${user.first_name} ...` }); } catch (e) {}
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
            console.log('Бот MLK запущен');
            break;
        } catch (e) {
            console.error('Ошибка запуска:', e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
})();