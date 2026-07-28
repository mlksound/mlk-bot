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
    try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, extra); } catch (err) { console.error('Ошибка уведомления:', err.message); }
}

bot.start((ctx) => {
    ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Рад помочь вам с техническим оснащением мероприятия. Расскажите, пожалуйста, о вашем проекте.');
    lastActiveClient[ADMIN_CHAT_ID] = ctx.from.id;
    notifyAdmin(`🔔 Новый диалог: ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${ctx.from.id})`);
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
    lastActiveClient[ADMIN_CHAT_ID] = ctx.match[1];
    ctx.answerCbQuery('Теперь просто напишите /reply текст');
    ctx.reply(`Активный клиент: ${ctx.match[1]}. Используйте /reply текст.`);
});

bot.action('contact_manager', (ctx) => {
    manualMode[ctx.chat.id] = true;
    ctx.answerCbQuery('Заявка отправлена!');
    ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
    lastActiveClient[ADMIN_CHAT_ID] = ctx.from.id;
    notifyAdmin(`📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${ctx.from.id}) запросил менеджера.`);
});

// Пересылка документов админу (без анализа)
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

// Пересылка фото админу (без анализа)
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

// Мини-сервер для health check
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
}).listen(process.env.PORT || 10000);

// Корректное завершение предыдущего экземпляра
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