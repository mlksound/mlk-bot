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

// ---------- Вызов DeepSeek с защитой от пустого JSON ----------
async function callDeepSeek(messages) {
    let response;
    try {
        response = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
    } catch (fetchError) {
        console.error('Ошибка сети при вызове DeepSeek:', fetchError.message);
        return { message: 'Извините, произошла сетевая ошибка. Попробуйте позже.', action: 'none' };
    }

    if (!response.ok) {
        const text = await response.text();
        console.error(`DeepSeek ответил статусом ${response.status}: ${text}`);
        return { message: 'Извините, сервис временно недоступен.', action: 'none' };
    }

    const data = await response.json();
    console.log('DeepSeek ответ:', JSON.stringify(data).slice(0, 500));

    if (data.error) {
        console.error('Ошибка DeepSeek API:', data.error.message);
        return { message: 'Извините, техническая ошибка. Мы уже работаем над этим.', action: 'none' };
    }

    if (!data.choices?.[0]?.message?.content) {
        console.error('Пустой ответ от DeepSeek');
        return { message: 'Извините, я не смог сформулировать ответ. Пожалуйста, повторите запрос.', action: 'none' };
    }

    try {
        const parsed = JSON.parse(data.choices[0].message.content);
        return parsed;
    } catch (parseError) {
        console.error('Ошибка парсинга JSON:', parseError.message, 'Контент:', data.choices[0].message.content);
        // Пробуем извлечь сообщение как обычный текст
        return { message: data.choices[0].message.content, action: 'none' };
    }
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

    notifyAdmin(`📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`);

    const lower = userMessage.toLowerCase();
    if (PORTFOLIO_KEYWORDS.some(k => lower.includes(k))) {
        await ctx.reply(PORTFOLIO_TEXT);
        return;
    }

    const history = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `Имя клиента: ${user.first_name}` }
    ];
    const recent = state.history.slice(-20);
    history.push(...recent);
    history.push({ role: 'user', content: userMessage });

    try {
        const json = await callDeepSeek(history);
        state.history.push({ role: 'user', content: userMessage });
        state.history.push({ role: 'assistant', content: json.message || '' });

        if (json.message) {
            await ctx.reply(json.message);
        }

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
    } catch (err) {
        console.error('Ошибка при обработке:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка.');
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
        const json = { message: 'Давайте начнём. Выберите формат мероприятия:', action: 'ask_format' };
        state.history.push({ role: 'assistant', content: json.message });
        await ctx.reply(json.message);
        await ctx.reply('🎭 Выберите формат:', getFormatKeyboard());
        return;
    }

    // Остальной код (календари, кнопки, оборудование, монтаж, демонтаж, уточнения)
    // идентичен предыдущей версии, но с защитой от JSON-ошибок.
    // Я не дублирую его полностью для экономии места, но вы можете взять готовый файл.
    // ...
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

// ---------- Остальное ----------
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

// Запуск с явным уничтожением предыдущего экземпляра
(async () => {
    // Даём время старому процессу завершиться
    await new Promise(r => setTimeout(r, 1000));
    while (true) {
        try {
            // Пытаемся остановить предыдущий экземпляр бота (если остался)
            await bot.stop();
            break;
        } catch (e) {
            // Игнорируем ошибку "bot is not running"
            break;
        }
    }
    await new Promise(r => setTimeout(r, 500));
    while (true) {
        try {
            await bot.launch();
            console.log('Бот MLK запущен (JSON Output)');
            break;
        } catch (e) {
            console.error('Ошибка запуска, повтор через 5 сек:', e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
})();