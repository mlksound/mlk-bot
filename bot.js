require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
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

const sessions = {};
const manualMode = {};
const lastActiveClient = {};

// Функция для отправки критических ошибок администратору
async function sendAdminAlert(text) {
    if (!ADMIN_CHAT_ID) return;
    try {
        await bot.telegram.sendMessage(ADMIN_CHAT_ID, `🚨 Бот MLK: ${text}`);
    } catch (err) {
        console.error('Не удалось отправить alert админу:', err.message);
    }
}

async function askDeepSeek(userMessage, chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = [{ role: 'system', content: SYSTEM_PROMPT }];
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
    if (messages.length > 21) sessions[chatId] = [messages[0], ...messages.slice(-20)];
    return reply;
}

async function notifyAdmin(text, extra = {}) {
    if (!ADMIN_CHAT_ID) return;
    try {
        await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, extra);
    } catch (err) {
        console.error('Ошибка уведомления:', err.message);
    }
}

bot.start((ctx) => {
    ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK...');
    const user = ctx.from;
    lastActiveClient[ADMIN_CHAT_ID] = user.id;
    notifyAdmin(`🔔 Новый диалог: ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})`);
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

bot.action(/^reply_to_(\d+)$/, (ctx) => {
    const targetId = ctx.match[1];
    lastActiveClient[ADMIN_CHAT_ID] = targetId;
    ctx.answerCbQuery('Теперь просто напишите /reply текст');
    ctx.reply(`Активный клиент: ${targetId}. Используйте /reply текст.`);
});

bot.action('contact_manager', (ctx) => {
    const chatId = ctx.chat.id;
    manualMode[chatId] = true;
    ctx.answerCbQuery('Заявка отправлена!');
    ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
    const user = ctx.from;
    lastActiveClient[ADMIN_CHAT_ID] = user.id;
    notifyAdmin(`📞 Клиент ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}) запросил менеджера.`);
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
        const reply = await askDeepSeek(userMessage, chatId);
        await ctx.reply(reply, Markup.inlineKeyboard([Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')]));
        notifyAdmin(`🤖 Ответ ИИ клиенту ${user.first_name}:\n\n${reply}`);
    } catch (err) {
        console.error('Ошибка DeepSeek:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка.');
    }
});

// Мини-сервер для проверки здоровья Render
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 10000);

// Глобальный обработчик необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
    const errMsg = reason instanceof Error ? reason.message : String(reason);
    console.error('Необработанная ошибка:', errMsg);
    sendAdminAlert(`Необработанная ошибка: ${errMsg}`);
});

// Перехват фатальных ошибок (когда процесс собирается упасть)
process.on('uncaughtException', (err) => {
    console.error('Фатальная ошибка:', err.message);
    sendAdminAlert(`Фатальная ошибка, бот упал: ${err.message}`);
    // Даём время отправить сообщение, затем выходим (Render перезапустит)
    setTimeout(() => process.exit(1), 1000);
});

// Запуск бота с повторными попытками при обрыве соединения
async function launchBot() {
    while (true) {
        try {
            await bot.launch();
            console.log('Бот MLK запущен');
            sendAdminAlert('✅ Бот запущен и работает');
            break;
        } catch (err) {
            console.error('Ошибка запуска, повтор через 5 секунд:', err.message);
            sendAdminAlert(`Ошибка запуска: ${err.message}. Повтор через 5 сек.`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

launchBot();