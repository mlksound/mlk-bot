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

// Папка для хранения сессий
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR);
}

const sessions = {};
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000; // 90 дней

function loadSessions() {
    const files = fs.readdirSync(SESSIONS_DIR);
    const now = Date.now();
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
        } catch (e) {
            console.error('Ошибка чтения сессии:', e.message);
        }
    }
}

function saveSession(chatId, messages) {
    const filePath = path.join(SESSIONS_DIR, `${chatId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(messages));
}

const manualMode = {};
const lastActiveClient = {};
const greetedUsers = {};

// Состояние формы опроса для каждого клиента
const formState = {};

async function askDeepSeek(userMessage, chatId, userFirstName) {
    if (!sessions[chatId]) {
        sessions[chatId] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'system', content: `Имя клиента: ${userFirstName}` }
        ];
    }
    const messages = sessions[chatId];
    messages.push({ role: 'user', content: userMessage });

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

// Генерация календаря за текущий месяц (можно переключать месяцы)
function buildCalendar(year, month, prefix) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekDay = firstDay.getDay(); // 0 = воскресенье
    const adjustedStart = startWeekDay === 0 ? 6 : startWeekDay - 1; // Пн = 0

    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const header = `${monthNames[month]} ${year}`;

    const buttons = [];
    // Навигация по месяцам
    buttons.push([
        Markup.button.callback('◀️', `${prefix}_prev_${year}_${month}`),
        Markup.button.callback(header, 'ignore'),
        Markup.button.callback('▶️', `${prefix}_next_${year}_${month}`)
    ]);
    // Дни недели
    buttons.push(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => Markup.button.callback(d, 'ignore')));
    // Дни
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
    // Кнопка пропуска
    buttons.push([Markup.button.callback('Пропустить', `${prefix}_skip`)]);
    return { buttons, header };
}

// Запуск опроса
bot.command('menu', (ctx) => {
    formState[ctx.chat.id] = { step: 'date_start' };
    const now = new Date();
    const { buttons } = buildCalendar(now.getFullYear(), now.getMonth(), 'date_start');
    ctx.reply('📅 Выберите дату начала мероприятия:', Markup.inlineKeyboard(buttons));
});

// Обработка всех callback-запросов от кнопок
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

    // Обработка календарей
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
                const { buttons } = buildCalendar(newDate.getFullYear(), newDate.getMonth(), prefix);
                await ctx.editMessageText('📅 Выберите дату:', Markup.inlineKeyboard(buttons));
            } else if (parts[2] === 'set') {
                const dateStr = parts[3];
                if (!formState[chatId]) formState[chatId] = {};
                formState[chatId][prefix] = dateStr;
                await ctx.answerCbQuery(`Выбрано: ${dateStr}`);
                // Переход к следующему шагу
                if (prefix === 'date_start') {
                    formState[chatId].step = 'date_end';
                    const now = new Date();
                    const { buttons } = buildCalendar(now.getFullYear(), now.getMonth(), 'date_end');
                    await ctx.editMessageText('📅 Выберите дату окончания:', Markup.inlineKeyboard(buttons));
                } else if (prefix === 'date_end') {
                    formState[chatId].step = 'ready_date';
                    const now = new Date();
                    const { buttons } = buildCalendar(now.getFullYear(), now.getMonth(), 'ready_date');
                    await ctx.editMessageText('📅 Готовность оборудования (можно пропустить):', Markup.inlineKeyboard(buttons));
                } else if (prefix === 'ready_date') {
                    // Переходим к выбору формата
                    formState[chatId].step = 'format';
                    await ctx.editMessageText('🎭 Выберите формат мероприятия:', Markup.inlineKeyboard([
                        [Markup.button.callback('Концерты & Фестивали', 'format_concerts')],
                        [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conferences')],
                        [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
                        [Markup.button.callback('Выставки', 'format_exhibitions')],
                        [Markup.button.callback('Спортивные мероприятия', 'format_sports')],
                        [Markup.button.callback('Пропустить', 'format_skip')]
                    ]));
                }
            } else if (parts[2] === 'skip') {
                await ctx.answerCbQuery('Пропущено');
                if (prefix === 'date_start') {
                    formState[chatId].step = 'date_end';
                    const now = new Date();
                    const { buttons } = buildCalendar(now.getFullYear(), now.getMonth(), 'date_end');
                    await ctx.editMessageText('📅 Выберите дату окончания:', Markup.inlineKeyboard(buttons));
                } else if (prefix === 'date_end') {
                    formState[chatId].step = 'ready_date';
                    const now = new Date();
                    const { buttons } = buildCalendar(now.getFullYear(), now.getMonth(), 'ready_date');
                    await ctx.editMessageText('📅 Готовность оборудования (можно пропустить):', Markup.inlineKeyboard(buttons));
                } else if (prefix === 'ready_date') {
                    formState[chatId].step = 'format';
                    await ctx.editMessageText('🎭 Выберите формат мероприятия:', Markup.inlineKeyboard([
                        [Markup.button.callback('Концерты & Фестивали', 'format_concerts')],
                        [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conferences')],
                        [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
                        [Markup.button.callback('Выставки', 'format_exhibitions')],
                        [Markup.button.callback('Спортивные мероприятия', 'format_sports')],
                        [Markup.button.callback('Пропустить', 'format_skip')]
                    ]));
                }
            }
            return;
        }
    }

    // Обработка выбора формата
    if (data.startsWith('format_')) {
        const value = data.replace('format_', '');
        if (value !== 'skip') formState[chatId].format = value;
        formState[chatId].step = 'place';
        await ctx.answerCbQuery();
        await ctx.editMessageText('📍 Где проходит мероприятие?', Markup.inlineKeyboard([
            [Markup.button.callback('Улица', 'place_outdoor')],
            [Markup.button.callback('Помещение', 'place_indoor')],
            [Markup.button.callback('Под навесом', 'place_tent')],
            [Markup.button.callback('Пропустить', 'place_skip')]
        ]));
        return;
    }

    // Обработка выбора места
    if (data.startsWith('place_')) {
        const value = data.replace('place_', '');
        if (value !== 'skip') formState[chatId].place = value;
        formState[chatId].step = 'equipment';
        await ctx.answerCbQuery();
        await ctx.editMessageText('🔧 Какое оборудование необходимо? (можно выбрать несколько)', Markup.inlineKeyboard([
            [Markup.button.callback('Звуковое оборудование', 'equip_sound')],
            [Markup.button.callback('Светодиодные экраны', 'equip_led')],
            [Markup.button.callback('Световое оборудование', 'equip_light')],
            [Markup.button.callback('Сценические конструкции', 'equip_stage')],
            [Markup.button.callback('Готово (продолжить)', 'equip_done')]
        ]));
        return;
    }

    // Обработка выбора оборудования (можно несколько)
    if (data.startsWith('equip_')) {
        const value = data.replace('equip_', '');
        if (value === 'done') {
            formState[chatId].step = 'mount_time';
            await ctx.answerCbQuery();
            await ctx.editMessageText('⏱ Время монтажа:', Markup.inlineKeyboard([
                [Markup.button.callback('Любое по согласованию', 'mount_any')],
                [Markup.button.callback('Нужно смонтировать ночью/рано утром', 'mount_night')],
                [Markup.button.callback('Пропустить', 'mount_skip')]
            ]));
        } else {
            if (!formState[chatId].equipment) formState[chatId].equipment = [];
            const index = formState[chatId].equipment.indexOf(value);
            if (index === -1) formState[chatId].equipment.push(value);
            else formState[chatId].equipment.splice(index, 1);
            await ctx.answerCbQuery(index === -1 ? 'Добавлено' : 'Убрано');
        }
        return;
    }

    // Обработка выбора времени монтажа
    if (data.startsWith('mount_')) {
        const value = data.replace('mount_', '');
        if (value !== 'skip') formState[chatId].mount = value;
        // Завершение опроса, формирование сводки
        const summary = [
            `📋 Сводка от клиента ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId})`,
            `Дата начала: ${formState[chatId].date_start || 'не указана'}`,
            `Дата окончания: ${formState[chatId].date_end || 'не указана'}`,
            `Готовность оборудования: ${formState[chatId].ready_date || 'не указана'}`,
            `Формат: ${formState[chatId].format || 'не указан'}`,
            `Место: ${formState[chatId].place || 'не указано'}`,
            `Оборудование: ${(formState[chatId].equipment || []).join(', ') || 'не выбрано'}`,
            `Монтаж: ${formState[chatId].mount || 'не указан'}`
        ].join('\n');
        await ctx.editMessageText('✅ Спасибо! Ваши данные отправлены менеджеру.');
        notifyAdmin(summary);
        delete formState[chatId];
        return;
    }

    // Обработка кнопок "Ответить" и "Связаться с менеджером" (прежние)
    if (data.startsWith('reply_to_')) {
        const targetId = data.replace('reply_to_', '');
        lastActiveClient[ADMIN_CHAT_ID] = targetId;
        await ctx.answerCbQuery('Теперь просто напишите /reply текст');
        await ctx.reply(`Активный клиент: ${targetId}. Используйте /reply текст.`);
        return;
    }
    if (data === 'contact_manager') {
        manualMode[chatId] = true;
        await ctx.answerCbQuery('Заявка отправлена!');
        await ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
        lastActiveClient[ADMIN_CHAT_ID] = chatId;
        notifyAdmin(`📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId}) запросил менеджера.`);
        return;
    }
});

// Остальные обработчики (start, reply, resume, text, document, photo, message)
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    if (greetedUsers[chatId]) {
        ctx.reply('С возвращением! Продолжим с того места, где остановились.');
    } else {
        ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Рад помочь вам с техническим оснащением мероприятия. Вы можете в любой момент заполнить форму, отправив команду /menu, или просто опишите задачу словами.');
        greetedUsers[chatId] = true;
    }
    lastActiveClient[ADMIN_CHAT_ID] = chatId;
    notifyAdmin(`🔔 Новый диалог (или возвращение): ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId})`);
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

bot.on('document', async (ctx) => {
    const user = ctx.from;
    const doc = ctx.message.document;
    if (!doc) return;
    await ctx.reply('Спасибо! Я передал ваш файл менеджеру.');
    try {
        await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, {
            caption: `📎 Документ от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})\nИмя файла: ${doc.file_name || 'неизвестно'}`
        });
    } catch (err) { console.error('Ошибка пересылки документа:', err.message); }
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
    } catch (err) { console.error('Ошибка пересылки фото:', err.message); }
});

bot.on('message', async (ctx, next) => {
    const user = ctx.from;
    if (String(user.id) !== String(ADMIN_CHAT_ID)) return next();
    const targetId = lastActiveClient[ADMIN_CHAT_ID];
    if (!targetId) return next();
    const msg = ctx.message;
    if (msg.document) {
        try {
            await ctx.telegram.sendDocument(targetId, msg.document.file_id, { caption: msg.caption || '' });
            ctx.reply('✅ Документ отправлен клиенту.');
        } catch (err) { ctx.reply('❌ Ошибка отправки.'); }
    } else if (msg.photo) {
        const largest = msg.photo[msg.photo.length - 1];
        try {
            await ctx.telegram.sendPhoto(targetId, largest.file_id, { caption: msg.caption || '' });
            ctx.reply('✅ Фото отправлено клиенту.');
        } catch (err) { ctx.reply('❌ Ошибка отправки.'); }
    }
    return next();
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;
    const user = ctx.from;
    if (String(user.id) === String(ADMIN_CHAT_ID)) return;
    lastActiveClient[ADMIN_CHAT_ID] = user.id;
    notifyAdmin(
        `📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`,
        Markup.inlineKeyboard([Markup.button.callback('✉️ Ответить', `reply_to_${user.id}`)])
    );
    if (manualMode[chatId]) return;
    ctx.sendChatAction('typing');
    try {
        const reply = await askDeepSeek(userMessage, chatId, user.first_name);
        await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
        notifyAdmin(`🤖 Ответ ИИ клиенту ${user.first_name}:\n\n${reply}`);
    } catch (err) {
        console.error('Ошибка DeepSeek:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка.');
    }
});

// Мини-сервер для health check
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 10000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    console.error('Необработанная ошибка:', reason);
    notifyAdmin(`🚨 Необработанная ошибка: ${reason}`);
});
process.on('uncaughtException', (err) => {
    console.error('Фатальная ошибка:', err.message);
    notifyAdmin(`🚨 Фатальная ошибка: ${err.message}`);
    setTimeout(() => process.exit(1), 1000);
});

async function launchBot() {
    loadSessions();
    while (true) {
        try {
            await bot.launch();
            console.log('Бот MLK запущен (с меню)');
            notifyAdmin('✅ Бот запущен и работает (с меню)');
            break;
        } catch (err) {
            console.error('Ошибка запуска, повтор через 5 сек:', err.message);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

launchBot();