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

// Ключевые слова, при которых добавляем портфолио
const PORTFOLIO_KEYWORDS = ['опыт', 'портфолио', 'делали ли вы', 'пример', 'кейс', 'проект', 'объект'];

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR);
}
const sessions = {};
const SESSION_TTL = 90 * 24 * 60 * 60 * 1000;

// Загрузка сессий при старте с логированием
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
        } catch (e) {
            console.error('Ошибка чтения сессии:', e.message);
        }
    }
    console.log(`Загружено сессий: ${loadedCount}`);
}

// Сохранение сессии в файл
function saveSession(chatId, messages) {
    const filePath = path.join(SESSIONS_DIR, `${chatId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(messages));
}

// Подгрузка сессии из файла, если она не в памяти (на случай, если стартовая загрузка не сработала)
function ensureSession(chatId) {
    if (!sessions[chatId]) {
        const filePath = path.join(SESSIONS_DIR, `${chatId}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                sessions[chatId] = data;
                console.log(`Сессия для ${chatId} подгружена из файла`);
            } catch (e) {
                console.error('Ошибка подгрузки сессии:', e.message);
            }
        }
    }
}

const manualMode = {};
const lastActiveClient = {};
const greetedUsers = {};

async function askDeepSeek(userMessage, chatId, userFirstName, addPortfolio = false) {
    ensureSession(chatId);
    let systemPrompt = SYSTEM_PROMPT;
    if (addPortfolio) {
        systemPrompt += '\n\n**Дополнительная информация (портфолио):**\n' + PORTFOLIO_TEXT;
    }
    
    if (!sessions[chatId]) {
        sessions[chatId] = [
            { role: 'system', content: systemPrompt },
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

function buildCalendar(year, month, prefix) {
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
    return { buttons, header };
}

async function sendInteractiveReply(ctx, text, keyboardType, prefix) {
    if (keyboardType === 'calendar') {
        const now = new Date();
        const { buttons } = buildCalendar(now.getFullYear(), now.getMonth(), prefix);
        await ctx.reply(text, Markup.inlineKeyboard(buttons));
    } else if (keyboardType === 'format') {
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('Концерты & Фестивали', 'format_concerts')],
            [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conferences')],
            [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
            [Markup.button.callback('Выставки', 'format_exhibitions')],
            [Markup.button.callback('Спортивные мероприятия', 'format_sports')],
            [Markup.button.callback('Пропустить', 'format_skip')]
        ]));
    } else if (keyboardType === 'place') {
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('Улица', 'place_outdoor')],
            [Markup.button.callback('Помещение', 'place_indoor')],
            [Markup.button.callback('Под навесом', 'place_tent')],
            [Markup.button.callback('Пропустить', 'place_skip')]
        ]));
    } else if (keyboardType === 'equipment') {
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('Звуковое оборудование', 'equip_sound')],
            [Markup.button.callback('Светодиодные экраны', 'equip_led')],
            [Markup.button.callback('Световое оборудование', 'equip_light')],
            [Markup.button.callback('Сценические конструкции', 'equip_stage')],
            [Markup.button.callback('Готово (продолжить)', 'equip_done')]
        ]));
    } else if (keyboardType === 'mount') {
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('Любое по согласованию', 'mount_any')],
            [Markup.button.callback('Нужно смонтировать ночью/рано утром', 'mount_night')],
            [Markup.button.callback('Пропустить', 'mount_skip')]
        ]));
    }
}

const tagToKeyboard = {
    '[ask_date_start]': { type: 'calendar', prefix: 'date_start', text: '📅 Выберите дату начала мероприятия:' },
    '[ask_date_end]': { type: 'calendar', prefix: 'date_end', text: '📅 Выберите дату окончания:' },
    '[ask_ready_date]': { type: 'calendar', prefix: 'ready_date', text: '📅 Готовность оборудования (можно пропустить):' },
    '[ask_format]': { type: 'format', prefix: 'format', text: '🎭 Выберите формат мероприятия:' },
    '[ask_place]': { type: 'place', prefix: 'place', text: '📍 Где проходит мероприятие?' },
    '[ask_equipment]': { type: 'equipment', prefix: 'equip', text: '🔧 Какое оборудование необходимо? (можно выбрать несколько)' },
    '[ask_mount]': { type: 'mount', prefix: 'mount', text: '⏱ Время монтажа:' }
};

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

    // Проверяем, нужно ли добавить портфолио
    const lowerMessage = userMessage.toLowerCase();
    const addPortfolio = PORTFOLIO_KEYWORDS.some(keyword => lowerMessage.includes(keyword));

    ctx.sendChatAction('typing');
    try {
        const reply = await askDeepSeek(userMessage, chatId, user.first_name, addPortfolio);
        console.log('Ответ ИИ:', reply);
        let finalText = reply;
        let keyboardInfo = null;
        for (const [tag, info] of Object.entries(tagToKeyboard)) {
            if (reply.includes(tag)) {
                console.log(`Найден тег: ${tag}`);
                finalText = finalText.replace(tag, '').trim();
                keyboardInfo = info;
                break;
            }
        }

        if (keyboardInfo) {
            console.log(`Показываю клавиатуру типа: ${keyboardInfo.type}`);
            if (finalText.length > 0) {
                await ctx.reply(finalText);
            }
            try {
                await sendInteractiveReply(ctx, keyboardInfo.text, keyboardInfo.type, keyboardInfo.prefix);
            } catch (e) {
                console.error('Ошибка отправки клавиатуры:', e.message);
                // Fallback: текстовый список вариантов
                let fallbackText = keyboardInfo.text + '\n';
                if (keyboardInfo.type === 'equipment') {
                    fallbackText += '1. Звуковое оборудование\n2. Светодиодные экраны\n3. Световое оборудование\n4. Сценические конструкции\nНапишите номера через запятую.';
                } else if (keyboardInfo.type === 'format') {
                    fallbackText += '1. Концерты & Фестивали\n2. Конференции & Презентации & TV-проекты\n3. Корпоративы & Торжества\n4. Выставки\n5. Спортивные мероприятия';
                }
                await ctx.reply(fallbackText || 'Пожалуйста, выберите вариант:');
            }
        } else {
            await ctx.reply(finalText, Markup.inlineKeyboard([
                Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')
            ]));
            notifyAdmin(`🤖 Ответ ИИ клиенту ${user.first_name}:\n\n${finalText}`);
        }
    } catch (err) {
        console.error('Ошибка DeepSeek:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка.');
    }
});

// Обработка callback-запросов (календари, кнопки)
bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data;
    if (data === 'ignore') return ctx.answerCbQuery();

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
                await ctx.answerCbQuery(`Выбрано: ${dateStr}`);
                await ctx.editMessageReplyMarkup(undefined);
                const humanDate = dateStr.split('-').reverse().join('.');
                const messageText = `Дата${prefix === 'date_start' ? ' начала' : prefix === 'date_end' ? ' окончания' : ' готовности'}: ${humanDate}`;
                await ctx.reply(messageText);
                const user = ctx.from;
                const reply = await askDeepSeek(messageText, chatId, user.first_name);
                await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
            } else if (parts[2] === 'skip') {
                await ctx.answerCbQuery('Пропущено');
                await ctx.editMessageReplyMarkup(undefined);
                const skipMsg = prefix === 'date_start' ? 'Дата начала не указана' : prefix === 'date_end' ? 'Дата окончания не указана' : 'Готовность не указана';
                await ctx.reply(skipMsg);
                const user = ctx.from;
                const reply = await askDeepSeek(skipMsg, chatId, user.first_name);
                await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
            }
            return;
        }
    }

    if (data.startsWith('format_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'format_skip' ? 'Формат не указан' : `Формат: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
        return;
    }

    if (data.startsWith('place_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'place_skip' ? 'Место не указано' : `Место: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
        return;
    }

    if (data.startsWith('equip_')) {
        if (data === 'equip_done') {
            await ctx.answerCbQuery();
            await ctx.editMessageReplyMarkup(undefined);
            // Получаем выбранные опции
            const selected = ctx.callbackQuery.message.reply_markup.inline_keyboard
                .flat()
                .filter(btn => btn.callback_data.startsWith('equip_') && btn.callback_data !== 'equip_done')
                .map(btn => btn.text);
            const messageText = selected.length > 0 
                ? `Выбрано оборудование: ${selected.join(', ')}` 
                : 'Оборудование не выбрано';
            await ctx.reply(messageText);
            const user = ctx.from;
            const reply = await askDeepSeek(messageText, chatId, user.first_name);
            await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
        } else {
            await ctx.answerCbQuery('Добавлено');
        }
        return;
    }

    if (data.startsWith('mount_')) {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup(undefined);
        const text = data === 'mount_skip' ? 'Время монтажа не указано' : `Монтаж: ${ctx.callbackQuery.message.reply_markup.inline_keyboard.find(b => b[0].callback_data === data)[0].text}`;
        await ctx.reply(text);
        const user = ctx.from;
        const reply = await askDeepSeek(text, chatId, user.first_name);
        await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
        return;
    }

    if (data.startsWith('reply_to_')) {
        lastActiveClient[ADMIN_CHAT_ID] = data.replace('reply_to_', '');
        await ctx.answerCbQuery('Теперь просто напишите /reply текст');
        await ctx.reply(`Активный клиент: ${lastActiveClient[ADMIN_CHAT_ID]}. Используйте /reply текст.`);
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

bot.start((ctx) => {
    const chatId = ctx.chat.id;
    if (greetedUsers[chatId]) {
        ctx.reply('С возвращением! Продолжим с того места, где остановились.');
    } else {
        ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Рад помочь с техническим оснащением. Просто опишите вашу задачу — я помогу подобрать оборудование и отвечу на вопросы.');
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

bot.command('menu', (ctx) => {
    ctx.reply('Вы можете заполнить данные в любое время прямо в чате. Просто расскажите о мероприятии, а я буду задавать уточняющие вопросы и предлагать удобные формы для ввода.');
});

bot.command('portfolio', (ctx) => {
    ctx.reply(PORTFOLIO_TEXT || 'Портфолио временно недоступно.');
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

http.createServer((req, res) => {
    console.log(`Получен HTTP-запрос: ${req.method} ${req.url} от ${req.socket.remoteAddress}`);
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
    await bot.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
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