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

// Преобразование URL файла Telegram в Base64
async function fileUrlToBase64(fileLink) {
    const response = await fetch(fileLink);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
}

// Анализ файла через DeepSeek (поддерживает изображения и текстовые документы)
async function analyzeFileWithDeepSeek(fileLink, mimeType, fileName) {
    const base64 = await fileUrlToBase64(fileLink);
    const dataUrl = `data:${mimeType};base64,${base64}`;
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Ты — ассистент, который анализирует содержимое файлов. Отвечай кратко, по делу.' },
                { role: 'user', content: [
                    { type: 'text', text: `Проанализируй содержимое этого файла (${fileName}). Если это изображение, опиши, что на нём. Если документ, выдели ключевую информацию.` },
                    { type: 'image_url', image_url: { url: dataUrl } }
                ]}
            ],
            temperature: 0.3
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
}

// Отправка уведомлений админу
async function notifyAdmin(text, extra = {}) {
    if (!ADMIN_CHAT_ID) return;
    try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text, extra); } catch (err) { console.error('Ошибка уведомления:', err.message); }
}

// Пересылка документа админу
async function forwardDocumentToAdmin(ctx) {
    const user = ctx.from;
    const doc = ctx.message.document;
    if (!doc) return;
    try {
        await ctx.telegram.sendDocument(ADMIN_CHAT_ID, doc.file_id, {
            caption: `📎 Документ от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})\nИмя файла: ${doc.file_name || 'неизвестно'}`
        });
    } catch (err) { console.error('Ошибка пересылки:', err.message); }
}

// Пересылка фото админу
async function forwardPhotoToAdmin(ctx) {
    const user = ctx.from;
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;
    const largest = photos[photos.length - 1];
    try {
        await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, largest.file_id, {
            caption: `📷 Фото от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})`
        });
    } catch (err) { console.error('Ошибка пересылки:', err.message); }
}

bot.start((ctx) => {
    ctx.reply('Здравствуйте! Меня зовут Дмитрий, я консультант MLK...');
    lastActiveClient[ADMIN_CHAT_ID] = ctx.from.id;
    notifyAdmin(`🔔 Новый диалог: ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${ctx.from.id})`);
});

// Команда /reply для ответа клиенту
bot.command('reply', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    const targetId = lastActiveClient[ADMIN_CHAT_ID];
    if (!targetId) return ctx.reply('Нет активного клиента.');
    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply('Напишите текст после /reply');
    bot.telegram.sendMessage(targetId, text)
        .then(() => { ctx.reply('✅ Отправлено'); notifyAdmin(`✉️ Ответ клиенту ${targetId}:\n\n${text}`); })
        .catch(err => ctx.reply('❌ Ошибка отправки.'));
});

bot.command('resume', (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_CHAT_ID)) return;
    Object.keys(manualMode).forEach(k => delete manualMode[k]);
    ctx.reply('Автоответы возобновлены.');
});

// Кнопка "Ответить" в уведомлении
bot.action(/^reply_to_(\d+)$/, (ctx) => {
    lastActiveClient[ADMIN_CHAT_ID] = ctx.match[1];
    ctx.answerCbQuery('Теперь просто напишите /reply текст');
    ctx.reply(`Активный клиент: ${ctx.match[1]}. Используйте /reply текст.`);
});

// Кнопка "Связаться с менеджером"
bot.action('contact_manager', (ctx) => {
    manualMode[ctx.chat.id] = true;
    ctx.answerCbQuery('Заявка отправлена!');
    ctx.reply('Спасибо! Менеджер скоро свяжется с вами.');
    lastActiveClient[ADMIN_CHAT_ID] = ctx.from.id;
    notifyAdmin(`📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${ctx.from.id}) запросил менеджера.`);
});

// Обработка документов от клиента (с анализом)
bot.on('document', async (ctx) => {
    const user = ctx.from;
    const doc = ctx.message.document;
    // Пересылаем админу в любом случае
    await forwardDocumentToAdmin(ctx);
    // Пытаемся проанализировать, если файл не слишком большой (до 5 МБ)
    if (doc.file_size < 5 * 1024 * 1024) {
        try {
            const fileLink = await ctx.telegram.getFileLink(doc.file_id);
            const analysis = await analyzeFileWithDeepSeek(fileLink.toString(), doc.mime_type, doc.file_name);
            await ctx.reply(`📋 Проанализировал ваш файл «${doc.file_name}»:\n\n${analysis}`);
        } catch (err) {
            console.error('Ошибка анализа файла:', err.message);
            // Не отвечаем клиенту ошибкой, файл уже у админа
        }
    } else {
        await ctx.reply('Файл слишком большой для автоматического анализа (более 5 МБ), но я передал его менеджеру.');
    }
});

// Обработка фото от клиента (с анализом)
bot.on('photo', async (ctx) => {
    const user = ctx.from;
    await forwardPhotoToAdmin(ctx);
    // Анализируем фото
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    try {
        const fileLink = await ctx.telegram.getFileLink(largest.file_id);
        const analysis = await analyzeFileWithDeepSeek(fileLink.toString(), 'image/jpeg', 'фото');
        await ctx.reply(`📸 Проанализировал ваше фото:\n\n${analysis}`);
    } catch (err) {
        console.error('Ошибка анализа фото:', err.message);
    }
});

// Обработка сообщений от админа (в том числе файлов для пересылки клиенту)
bot.on('message', async (ctx, next) => {
    const user = ctx.from;
    if (String(user.id) !== String(ADMIN_CHAT_ID)) return next(); // не админ – обрабатываем дальше

    // Если админ отправил документ или фото – пересылаем активному клиенту
    const targetId = lastActiveClient[ADMIN_CHAT_ID];
    if (!targetId) return next(); // нет активного клиента

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
    // Если это не файл, пропускаем дальше (может быть команда /reply и т.д.)
    return next();
});

// Текстовые сообщения
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

// Защита от падений
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
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}
launchBot();