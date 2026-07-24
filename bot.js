require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !DEEPSEEK_API_KEY) {
    console.error('Ошибка: не заданы BOT_TOKEN или DEEPSEEK_API_KEY в .env');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const SYSTEM_PROMPT = fs.readFileSync('./promt.txt', 'utf8');

const sessions = {};
const manualMode = {};
// Храним ID последнего активного клиента
const lastActiveClient = {};

async function askDeepSeek(userMessage, chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = [
            { role: 'system', content: SYSTEM_PROMPT }
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
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: messages,
            temperature: 0.7
        })
    });

    const data = await response.json();

    if (data.error) {
        if (data.error.message === 'Insufficient Balance') {
            throw new Error('Баланс не активирован.');
        }
        throw new Error('Ошибка API: ' + data.error.message);
    }

    if (!data.choices?.[0]?.message) {
        throw new Error('Некорректный ответ: ' + JSON.stringify(data));
    }
    const reply = data.choices[0].message.content;

    messages.push({ role: 'assistant', content: reply });

    if (messages.length > 21) {
        sessions[chatId] = [messages[0], ...messages.slice(-20)];
    }

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
    ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK. Рад помочь вам с техническим оснащением мероприятия. Расскажите, пожалуйста, о вашем проекте.');
    const user = ctx.from;
    lastActiveClient[ADMIN_CHAT_ID] = user.id; // запоминаем клиента
    notifyAdmin(`🔔 Новый диалог: ${user.first_name} ${user.last_name || ''} (@${user.username || 'нет'}, ID: ${user.id})`);
});

// Команда /reply без ID – отправляет ответ последнему активному клиенту
bot.command('reply', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;

    const targetId = lastActiveClient[ADMIN_CHAT_ID];
    if (!targetId) {
        return ctx.reply('Нет активного клиента. Дождитесь нового сообщения.');
    }

    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply('Напишите текст после /reply');

    bot.telegram.sendMessage(targetId, text)
        .then(() => {
            ctx.reply('✅ Отправлено');
            notifyAdmin(`✉️ Ваш ответ клиенту ${targetId}:\n\n${text}`);
        })
        .catch(err => ctx.reply('❌ Ошибка отправки.'));
});

// Команда /resume
bot.command('resume', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    Object.keys(manualMode).forEach(key => delete manualMode[key]);
    ctx.reply('Автоответы возобновлены.');
});

// Inline-кнопка "Ответить" в сообщениях клиента
bot.action(/^reply_to_(\d+)$/, (ctx) => {
    const targetId = ctx.match[1];
    lastActiveClient[ADMIN_CHAT_ID] = targetId;
    ctx.answerCbQuery('Теперь просто напишите /reply текст');
    ctx.reply(`Активный клиент: ${targetId}. Используйте /reply текст.`);
});

// Кнопка "Связаться с менеджером"
bot.action('contact_manager', (ctx) => {
    const chatId = ctx.chat.id;
    manualMode[chatId] = true;
    ctx.answerCbQuery('Заявка отправлена!');
    ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
    const user = ctx.from;
    lastActiveClient[ADMIN_CHAT_ID] = user.id;
    notifyAdmin(`📞 Клиент ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}) запросил менеджера. Автоответы отключены.`);
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;
    const user = ctx.from;

    if (String(user.id) === String(ADMIN_CHAT_ID)) return;

    lastActiveClient[ADMIN_CHAT_ID] = user.id;

    // Уведомление с кнопкой "Ответить"
    notifyAdmin(
        `📩 Сообщение от ${user.first_name} ${user.last_name || ''} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`,
        Markup.inlineKeyboard([
            Markup.button.callback('✉️ Ответить', `reply_to_${user.id}`)
        ])
    );

    if (manualMode[chatId]) return;

    ctx.sendChatAction('typing');

    try {
        const reply = await askDeepSeek(userMessage, chatId);
        await ctx.reply(reply, Markup.inlineKeyboard([
            Markup.button.callback('📞 Связаться с менеджером', 'contact_manager')
        ]));
        notifyAdmin(`🤖 Ответ ИИ клиенту ${user.first_name}:\n\n${reply}`);
    } catch (err) {
        console.error('Ошибка DeepSeek:', err.message);
        await ctx.reply('Извините, произошла техническая ошибка.');
    }
});

bot.launch()
    .then(() => console.log('Бот MLK с упрощённым /reply запущен'))
    .catch(err => console.error('Ошибка запуска:', err));