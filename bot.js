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

// Загружаем все сохранённые сессии при старте
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

// Состояния для пошагового сбора информации
const userStates = {};

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

// Функция для отправки календаря
function sendCalendar(ctx, promptText, callbackPrefix) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay() || 7; // Пн=1, Вс=7
    const weeks = Math.ceil((firstDayOfWeek - 1 + daysInMonth) / 7);

    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                       'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    let calendarText = `${promptText}\n\n${monthNames[month]} ${year}\n\n`;
    const calendarButtons = [];
    let weekRow = [];

    // Добавляем дни недели
    const dayHeaders = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekRow = dayHeaders.map(d => Markup.button.callback(d, 'ignore'));
    calendarButtons.push(weekRow);

    // Пустые клетки перед первым днём
    weekRow = [];
    for (let i = 1; i < firstDayOfWeek; i++) {
        weekRow.push(Markup.button.callback(' ', 'ignore'));
    }

    // Дни месяца
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        weekRow.push(Markup.button.callback(String(day), `${callbackPrefix}_${dateStr}`));
        if (weekRow.length === 7 || day === daysInMonth) {
            while (weekRow.length < 7) {
                weekRow.push(Markup.button.callback(' ', 'ignore'));
            }
            calendarButtons.push(weekRow);
            weekRow = [];
        }
    }

    // Кнопки навигации
    calendarButtons.push([
        Markup.button.callback('◀️', `calendar_nav_${callbackPrefix}_prev_${year}_${month}`),
        Markup.button.callback('▶️', `calendar_nav_${callbackPrefix}_next_${year}_${month}`)
    ]);

    ctx.reply(calendarText, Markup.inlineKeyboard(calendarButtons));
}

// Обработка навигации календаря
function handleCalendarNav(callbackPrefix, year, month, dir) {
    const date = new Date(year, month, 1);
    if (dir === 'prev') {
        date.setMonth(date.getMonth() - 1);
    } else {
        date.setMonth(date.getMonth() + 1);
    }
    return { year: date.getFullYear(), month: date.getMonth() };
}

bot.start((ctx) => {
    const chatId = ctx.chat.id;
    if (greetedUsers[chatId]) {
        ctx.reply('С возвращением! Продолжим с того места, где остановились.');
    } else {
        ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Рад помочь вам с техническим оснащением мероприятия. Давайте начнём с выбора дат. Нажмите на дату начала мероприятия/репетиции.',
            Markup.inlineKeyboard([
                [Markup.button.callback('Выбрать дату начала', 'start_calendar_start')],
                [Markup.button.callback('Пропустить', 'skip_start_date')]
            ])
        );
        greetedUsers[chatId] = true;
    }
    lastActiveClient[ADMIN_CHAT_ID] = chatId;
    notifyAdmin(`🔔 Новый диалог (или возвращение): ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId})`);
});

// Обработчик кнопок календаря и сбора данных
bot.action(/calendar_nav_(.+)/, async (ctx) => {
    const parts = ctx.match[1].split('_');
    const callbackPrefix = parts[0];
    const year = parseInt(parts[2]);
    const month = parseInt(parts[3]);
    const dir = parts[1];
    const newDate = handleCalendarNav(callbackPrefix, year, month, dir);
    // Перерисовываем календарь
    const now = new Date(newDate.year, newDate.month, 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const firstDayOfWeek = new Date(now.getFullYear(), now.getMonth(), 1).getDay() || 7;
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                       'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    let calendarText = `Выберите дату:\n\n${monthNames[now.getMonth()]} ${now.getFullYear()}\n\n`;
    const calendarButtons = [];
    let weekRow = [];

    const dayHeaders = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekRow = dayHeaders.map(d => Markup.button.callback(d, 'ignore'));
    calendarButtons.push(weekRow);

    weekRow = [];
    for (let i = 1; i < firstDayOfWeek; i++) {
        weekRow.push(Markup.button.callback(' ', 'ignore'));
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        weekRow.push(Markup.button.callback(String(day), `${callbackPrefix}_${dateStr}`));
        if (weekRow.length === 7 || day === daysInMonth) {
            while (weekRow.length < 7) {
                weekRow.push(Markup.button.callback(' ', 'ignore'));
            }
            calendarButtons.push(weekRow);
            weekRow = [];
        }
    }
    calendarButtons.push([
        Markup.button.callback('◀️', `calendar_nav_${callbackPrefix}_prev_${now.getFullYear()}_${now.getMonth()}`),
        Markup.button.callback('▶️', `calendar_nav_${callbackPrefix}_next_${now.getFullYear()}_${now.getMonth()}`)
    ]);

    ctx.editMessageText(calendarText, Markup.inlineKeyboard(calendarButtons));
});

// Обработка выбора даты начала
bot.action(/^start_calendar_start_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    const date = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].startDate = date;
    ctx.editMessageReplyMarkup(null);
    ctx.reply(`Дата начала выбрана: ${date}. Теперь выберите дату окончания мероприятия.`,
        Markup.inlineKeyboard([
            [Markup.button.callback('Выбрать дату окончания', 'start_calendar_end')],
            [Markup.button.callback('Пропустить', 'skip_end_date')]
        ])
    );
});

// Обработка выбора даты окончания
bot.action(/^start_calendar_end_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    const date = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].endDate = date;
    ctx.editMessageReplyMarkup(null);
    ctx.reply(`Дата окончания выбрана: ${date}. Теперь укажите, когда оборудование должно быть готово (если раньше начала).`,
        Markup.inlineKeyboard([
            [Markup.button.callback('Выбрать дату готовности', 'start_calendar_ready')],
            [Markup.button.callback('Пропустить', 'skip_ready_date')]
        ])
    );
});

// Обработка выбора даты готовности
bot.action(/^start_calendar_ready_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    const date = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].readyDate = date;
    ctx.editMessageReplyMarkup(null);
    ctx.reply(`Дата готовности выбрана: ${date}. Теперь выберите формат мероприятия:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('Концерты & Фестивали', 'format_concert')],
            [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conference')],
            [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
            [Markup.button.callback('Выставки', 'format_exhibition')],
            [Markup.button.callback('Спортивные мероприятия', 'format_sport')]
        ])
    );
});

// Обработка выбора формата
bot.action(/^format_(.+)$/, (ctx) => {
    const format = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].format = format;
    ctx.editMessageReplyMarkup(null);
    ctx.reply(`Формат: ${format}. Где будет проходить мероприятие?`,
        Markup.inlineKeyboard([
            [Markup.button.callback('Улица', 'place_outdoor')],
            [Markup.button.callback('Помещение', 'place_indoor')],
            [Markup.button.callback('Под навесом', 'place_under_cover')]
        ])
    );
});

// Обработка выбора места
bot.action(/^place_(.+)$/, (ctx) => {
    const place = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].place = place;
    ctx.editMessageReplyMarkup(null);
    ctx.reply('Место проведения выбрано. Теперь выберите необходимое оборудование (можно несколько):',
        Markup.inlineKeyboard([
            [Markup.button.callback('🔊 Звуковое оборудование', 'equip_sound')],
            [Markup.button.callback('📺 Светодиодные экраны', 'equip_led')],
            [Markup.button.callback('💡 Световое оборудование', 'equip_light')],
            [Markup.button.callback('🏗 Сценические конструкции', 'equip_stage')],
            [Markup.button.callback('✅ Готово', 'equip_done')]
        ])
    );
    if (!userStates[chatId].equipment) userStates[chatId].equipment = [];
});

// Обработка выбора оборудования
bot.action(/^equip_(.+)$/, (ctx) => {
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    if (!userStates[chatId].equipment) userStates[chatId].equipment = [];
    const equip = ctx.match[1];
    if (equip === 'done') {
        ctx.editMessageReplyMarkup(null);
        ctx.reply(`Выбрано оборудование: ${userStates[chatId].equipment.join(', ')}. Теперь укажите время монтажа:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('Любое по согласованию (нет временных ограничений)', 'mount_any')],
                [Markup.button.callback('Нужно смонтировать ночью/рано утром', 'mount_night')]
            ])
        );
    } else {
        const equipmentNames = {
            sound: '🔊 Звуковое оборудование',
            led: '📺 Светодиодные экраны',
            light: '💡 Световое оборудование',
            stage: '🏗 Сценические конструкции'
        };
        const name = equipmentNames[equip];
        if (!userStates[chatId].equipment.includes(name)) {
            userStates[chatId].equipment.push(name);
        } else {
            userStates[chatId].equipment = userStates[chatId].equipment.filter(e => e !== name);
        }
        const selected = userStates[chatId].equipment;
        ctx.editMessageReplyMarkup(
            Markup.inlineKeyboard([
                [Markup.button.callback('🔊 Звуковое оборудование', 'equip_sound')],
                [Markup.button.callback('📺 Светодиодные экраны', 'equip_led')],
                [Markup.button.callback('💡 Световое оборудование', 'equip_light')],
                [Markup.button.callback('🏗 Сценические конструкции', 'equip_stage')],
                [Markup.button.callback(selected.length > 0 ? '✅ Готово' : '✅ Пропустить', 'equip_done')]
            ])
        );
    }
});

// Обработка выбора времени монтажа
bot.action(/^mount_(.+)$/, (ctx) => {
    const mount = ctx.match[1];
    const chatId = ctx.chat.id;
    if (!userStates[chatId]) userStates[chatId] = {};
    userStates[chatId].mount = mount;
    ctx.editMessageReplyMarkup(null);
    ctx.reply('Отлично! Я собрал все данные. Сейчас передам их менеджеру для подготовки коммерческого предложения.');
    notifyAdmin(`📋 Собрана информация от клиента ${ctx.from.first_name} (@${ctx.from.username || 'нет'}):
- Начало: ${userStates[chatId].startDate || 'не указано'}
- Окончание: ${userStates[chatId].endDate || 'не указано'}
- Готовность: ${userStates[chatId].readyDate || 'не указано'}
- Формат: ${userStates[chatId].format || 'не указано'}
- Место: ${userStates[chatId].place || 'не указано'}
- Оборудование: ${userStates[chatId].equipment?.join(', ') || 'не выбрано'}
- Монтаж: ${mount === 'any' ? 'любое время' : 'ночью/утром'}`);
    // Очищаем состояние
    delete userStates[chatId];
});

// Пропуск шагов
bot.action('skip_start_date', (ctx) => {
    ctx.editMessageReplyMarkup(null);
    ctx.reply('Дата начала пропущена. Теперь выберите дату окончания (или пропустите).',
        Markup.inlineKeyboard([
            [Markup.button.callback('Выбрать дату окончания', 'start_calendar_end')],
            [Markup.button.callback('Пропустить', 'skip_end_date')]
        ])
    );
});
bot.action('skip_end_date', (ctx) => {
    ctx.editMessageReplyMarkup(null);
    ctx.reply('Дата окончания пропущена. Теперь укажите готовность оборудования (или пропустите).',
        Markup.inlineKeyboard([
            [Markup.button.callback('Выбрать дату готовности', 'start_calendar_ready')],
            [Markup.button.callback('Пропустить', 'skip_ready_date')]
        ])
    );
});
bot.action('skip_ready_date', (ctx) => {
    ctx.editMessageReplyMarkup(null);
    ctx.reply('Дата готовности пропущена. Теперь выберите формат мероприятия.',
        Markup.inlineKeyboard([
            [Markup.button.callback('Концерты & Фестивали', 'format_concert')],
            [Markup.button.callback('Конференции & Презентации & TV-проекты', 'format_conference')],
            [Markup.button.callback('Корпоративы & Торжества', 'format_corporate')],
            [Markup.button.callback('Выставки', 'format_exhibition')],
            [Markup.button.callback('Спортивные мероприятия', 'format_sport')]
        ])
    );
});

// Обработка кнопок, не попавших в предыдущие обработчики (заглушка)
bot.action('ignore', (ctx) => ctx.answerCbQuery());

// Обработка команды /start для сброса и начала сбора данных
// (уже реализовано в bot.start)

// Остальные команды и обработчики (reply, resume, contact_manager, файлы) остаются без изменений
// ... (весь предыдущий код для команды reply, resume, файлов и т.д.)

// Запуск бота
// ... (функция launchBot)