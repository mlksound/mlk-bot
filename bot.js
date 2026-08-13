'use strict';

const http = require('http');

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN;

const BOT_ID = Number(process.env.BOT_ID || 1787);
const BOT_CODE = process.env.BOT_CODE || 'mlk_ai_consultant_v2';

const FETCH_INTERVAL = 3000;

// ВАЖНО:
// начинаем с offset 0.
// После получения событий будем сохранять nextOffset.
let currentOffset = 0;

let isFetching = false;
let lastFetchAt = 0;


// ============================================================
// STARTUP CHECK
// ============================================================

console.log('========================================');
console.log('MLK BITRIX24 FETCH DIAGNOSTIC');
console.log('========================================');

console.log(
  'BITRIX_WEBHOOK_URL:',
  BITRIX_WEBHOOK_URL ? 'OK' : 'MISSING'
);

console.log(
  'BITRIX_BOT_TOKEN:',
  BITRIX_BOT_TOKEN ? 'OK' : 'MISSING'
);

console.log('BOT_ID:', BOT_ID);
console.log('BOT_CODE:', BOT_CODE);
console.log('PORT:', PORT);
console.log('FETCH_INTERVAL:', FETCH_INTERVAL);

console.log('========================================');

if (!BITRIX_WEBHOOK_URL) {
  console.error('❌ BITRIX_WEBHOOK_URL не задан.');
  process.exit(1);
}

if (!BITRIX_BOT_TOKEN) {
  console.error('❌ BITRIX_BOT_TOKEN не задан.');
  process.exit(1);
}


// ============================================================
// BITRIX REST
// ============================================================

function bitrixUrl(method) {
  return `${BITRIX_WEBHOOK_URL}${method}.json`;
}


async function callBitrix(method, params = {}) {
  const url = bitrixUrl(method);

  console.log('');
  console.log('➡️ BITRIX API:', method);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });

    const text = await response.text();

    console.log('⬅️ HTTP:', response.status);

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error('❌ Bitrix вернул не JSON:');
      console.error(text);
      return null;
    }

    console.log(
      '⬅️ RESPONSE:',
      JSON.stringify(data)
    );

    if (data.error) {
      console.error(
        '❌ BITRIX ERROR:',
        data.error,
        data.error_description || ''
      );
    }

    return data;

  } catch (error) {
    console.error('❌ Ошибка REST:', error.message);
    return null;
  }
}


// ============================================================
// CHECK BOT
// ============================================================

async function checkBot() {
  console.log('');
  console.log('========================================');
  console.log('🤖 ПРОВЕРКА БОТА');
  console.log('========================================');

  const data = await callBitrix('imbot.bot.list');

  if (!data || !data.result) {
    console.error('❌ Не удалось получить список ботов.');
    return false;
  }

  console.log('📋 Список ботов получен.');

  const bots = data.result;

  let ourBot = null;

  for (const key of Object.keys(bots)) {
    const bot = bots[key];

    if (
      Number(bot.ID) === BOT_ID ||
      bot.CODE === BOT_CODE
    ) {
      ourBot = bot;
      break;
    }
  }

  if (!ourBot) {
    console.error('❌ НАШ БОТ НЕ НАЙДЕН');

    console.log('Доступные боты:');

    for (const key of Object.keys(bots)) {
      console.log(
        `- ID=${bots[key].ID}, NAME=${bots[key].NAME}, CODE=${bots[key].CODE}`
      );
    }

    return false;
  }

  console.log('✅ НАШ БОТ НАЙДЕН');
  console.log('Bot ID:', ourBot.ID);
  console.log('Bot NAME:', ourBot.NAME);
  console.log('Bot CODE:', ourBot.CODE);
  console.log('OpenLine:', ourBot.OPENLINE);

  return true;
}


// ============================================================
// GET BOT V2 INFO
// ============================================================

async function getBotInfo() {
  console.log('');
  console.log('========================================');
  console.log('🔍 ПРОВЕРКА CHATBOT 2.0');
  console.log('========================================');

  const data = await callBitrix(
    'imbot.v2.Bot.get',
    {
      botId: BOT_ID
    }
  );

  if (!data) {
    console.error('❌ Не удалось получить информацию о V2 боте.');
    return;
  }

  console.log(
    '🔎 BOT V2 INFO:',
    JSON.stringify(data, null, 2)
  );
}


// ============================================================
// FETCH EVENTS
// ============================================================

async function fetchEvents() {

  if (isFetching) {
    console.log('⚠️ Предыдущий FETCH ещё выполняется.');
    return;
  }

  isFetching = true;

  try {

    console.log('');
    console.log('========================================');
    console.log('🔄 FETCH POLL');
    console.log('========================================');

    console.log('Время:', new Date().toISOString());
    console.log('BOT_ID:', BOT_ID);
    console.log('BOT_CODE:', BOT_CODE);
    console.log('CURRENT OFFSET:', currentOffset);

    const params = {
      botId: BOT_ID,
      offset: currentOffset
    };

    console.log(
      '📤 EVENT.GET PARAMS:',
      JSON.stringify(params)
    );

    const data = await callBitrix(
      'imbot.v2.Event.get',
      params
    );

    if (!data) {
      console.error('❌ Event.get вернул null.');
      return;
    }

    if (!data.result) {
      console.error(
        '❌ В ответе нет result:',
        JSON.stringify(data)
      );
      return;
    }

    const result = data.result;

    const events = Array.isArray(result.events)
      ? result.events
      : [];

    const nextOffset =
      result.nextOffset !== undefined
        ? Number(result.nextOffset)
        : currentOffset;

    const hasMore = Boolean(result.hasMore);

    console.log('');
    console.log('📦 FETCH RESULT');
    console.log('Events:', events.length);
    console.log('Current offset:', currentOffset);
    console.log('Next offset:', nextOffset);
    console.log('Has more:', hasMore);

    // --------------------------------------------------------
    // ПУСТО
    // --------------------------------------------------------

    if (events.length === 0) {
      console.log('📭 Новых событий нет.');
      return;
    }

    // --------------------------------------------------------
    // EVENTS
    // --------------------------------------------------------

    for (const event of events) {

      console.log('');
      console.log('########################################');
      console.log('📩 НОВОЕ СОБЫТИЕ');
      console.log('########################################');

      console.log(
        'EVENT ID:',
        event.eventId
      );

      console.log(
        'EVENT TYPE:',
        event.type
      );

      console.log(
        'EVENT DATE:',
        event.date
      );

      console.log(
        'FULL EVENT:',
        JSON.stringify(event, null, 2)
      );

      await processEvent(event);
    }

    // --------------------------------------------------------
    // OFFSET
    // --------------------------------------------------------

    if (nextOffset !== currentOffset) {

      console.log('');
      console.log(
        `➡️ OFFSET: ${currentOffset} → ${nextOffset}`
      );

      currentOffset = nextOffset;
    }

  } catch (error) {

    console.error('');
    console.error('❌ FETCH ERROR');
    console.error(error);

  } finally {

    isFetching = false;
    lastFetchAt = Date.now();
  }
}


// ============================================================
// PROCESS EVENT
// ============================================================

async function processEvent(event) {

  console.log('');
  console.log('========================================');
  console.log('⚙️ ОБРАБОТКА СОБЫТИЯ');
  console.log('========================================');

  console.log('Type:', event.type);

  // Нас интересует сообщение
  if (event.type !== 'ONIMBOTV2MESSAGEADD') {

    console.log(
      'ℹ️ Это не ONIMBOTV2MESSAGEADD — пропускаем.'
    );

    return;
  }

  const data = event.data || {};

  const message = data.message || {};
  const chat = data.chat || {};
  const user = data.user || {};
  const bot = data.bot || {};

  const messageId =
    message.id ||
    message.ID ||
    null;

  const chatId =
    message.chatId ||
    message.chat_id ||
    chat.id ||
    null;

  const dialogId =
    chat.dialogId ||
    null;

  const text =
    message.text ||
    '';

  const userId =
    user.id ||
    null;

  const userName =
    user.name ||
    user.firstName ||
    'Клиент';

  const eventBotId =
    bot.id ||
    null;

  console.log('');
  console.log('📌 РАЗОБРАННЫЕ ДАННЫЕ');
  console.log('Message ID:', messageId);
  console.log('Chat ID:', chatId);
  console.log('Dialog ID:', dialogId);
  console.log('User ID:', userId);
  console.log('User:', userName);
  console.log('Text:', text);
  console.log('Event Bot ID:', eventBotId);
  console.log('Configured Bot ID:', BOT_ID);

  // --------------------------------------------------------
  // ПРОВЕРКА
  // --------------------------------------------------------

  if (!text) {
    console.log(
      '⚠️ Текст сообщения пустой. Ничего не отправляем.'
    );

    return;
  }

  if (!chatId && !dialogId) {
    console.error(
      '❌ Нет chatId и dialogId. Невозможно определить диалог.'
    );

    return;
  }

  // --------------------------------------------------------
  // НЕ ОТВЕЧАЕМ САМИМ СЕБЕ
  // --------------------------------------------------------

  if (Number(userId) === Number(BOT_ID)) {

    console.log(
      '🤖 Сообщение пришло от самого бота. Игнорируем.'
    );

    return;
  }

  // --------------------------------------------------------
  // ГОТОВИМ ДИАГНОСТИЧЕСКИЙ ОТВЕТ
  // --------------------------------------------------------

  const reply =
    `🔧 FETCH DIAGNOSTIC OK\n\n` +
    `Здравствуйте, ${userName}!\n\n` +
    `Я получил сообщение через Bitrix24.\n\n` +
    `Ваше сообщение:\n«${text}»\n\n` +
    `Message ID: ${messageId}\n` +
    `Chat ID: ${chatId}\n` +
    `Dialog ID: ${dialogId || 'не указан'}\n` +
    `User ID: ${userId}\n\n` +
    `BOT ID: ${BOT_ID}\n` +
    `Event: ONIMBOTV2MESSAGEADD\n\n` +
    `FETCH работает.`;

  console.log('');
  console.log('📤 ГОТОВИМ ОТВЕТ В BITRIX');
  console.log(reply);

  await sendMessage({
    chatId,
    dialogId,
    message: reply
  });
}


// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage({
  chatId,
  dialogId,
  message
}) {

  console.log('');
  console.log('========================================');
  console.log('📤 ОТПРАВКА СООБЩЕНИЯ');
  console.log('========================================');

  console.log('chatId:', chatId);
  console.log('dialogId:', dialogId);
  console.log('botId:', BOT_ID);
  console.log('message:', message);

  /*
   * Для Chatbot 2.0 используем:
   *
   * imbot.v2.Chat.Message.send
   *
   * Передаём botId + chatId + message.
   */

  const params = {
    botId: BOT_ID,
    chatId: chatId,
    message: message
  };

  console.log(
    '📤 SEND PARAMS:',
    JSON.stringify(params, null, 2)
  );

  const data = await callBitrix(
    'imbot.v2.Chat.Message.send',
    params
  );

  if (!data) {
    console.error(
      '❌ SEND: нет ответа от Bitrix.'
    );

    return false;
  }

  if (data.error) {

    console.error('');
    console.error('========================================');
    console.error('❌ BITRIX SEND ERROR');
    console.error('========================================');

    console.error(
      'ERROR:',
      data.error
    );

    console.error(
      'DESCRIPTION:',
      data.error_description || ''
    );

    console.error(
      'FULL RESPONSE:',
      JSON.stringify(data, null, 2)
    );

    return false;
  }

  console.log('');
  console.log('========================================');
  console.log('✅ СООБЩЕНИЕ ОТПРАВЛЕНО');
  console.log('========================================');

  console.log(
    JSON.stringify(data, null, 2)
  );

  return true;
}


// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer(
  async (req, res) => {

    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      req.method === 'GET' &&
      req.url === '/'
    ) {

      res.writeHead(
        200,
        {
          'Content-Type': 'application/json; charset=utf-8'
        }
      );

      res.end(
        JSON.stringify({
          ok: true,
          service: 'mlk-bitrix-fetch-diagnostic',
          mode: 'fetch',
          botId: BOT_ID,
          botCode: BOT_CODE,
          offset: currentOffset,
          lastFetchAt:
            lastFetchAt
              ? new Date(lastFetchAt).toISOString()
              : null
        })
      );

      return;
    }

    // --------------------------------------------------------
    // MANUAL FETCH
    // --------------------------------------------------------

    if (
      req.method === 'GET' &&
      req.url === '/fetch'
    ) {

      await fetchEvents();

      res.writeHead(
        200,
        {
          'Content-Type': 'application/json; charset=utf-8'
        }
      );

      res.end(
        JSON.stringify({
          ok: true,
          offset: currentOffset
        })
      );

      return;
    }

    // --------------------------------------------------------
    // UNKNOWN
    // --------------------------------------------------------

    res.writeHead(
      404,
      {
        'Content-Type': 'application/json; charset=utf-8'
      }
    );

    res.end(
      JSON.stringify({
        error: 'NOT_FOUND'
      })
    );
  }
);


// ============================================================
// START SERVER
// ============================================================

server.listen(
  PORT,
  '0.0.0.0',
  async () => {

    console.log('');
    console.log('========================================');
    console.log('🚀 SERVER STARTED');
    console.log('========================================');

    console.log('PORT:', PORT);
    console.log('MODE: FETCH');
    console.log('BOT ID:', BOT_ID);
    console.log('BOT CODE:', BOT_CODE);
    console.log('CURRENT OFFSET:', currentOffset);

    console.log('========================================');

    const botOk = await checkBot();

    if (!botOk) {
      console.error(
        '⚠️ Бот не прошёл проверку.'
      );
    }

    /*
     * Не вызываем Bot.update здесь.
     *
     * Важно:
     * бот уже переведён тобой в eventMode=fetch.
     *
     * Поэтому сейчас наша задача —
     * только читать очередь событий.
     */

    await getBotInfo();

    console.log('');
    console.log('========================================');
    console.log('🎉 FETCH DIAGNOSTIC READY');
    console.log('========================================');

    console.log('BOT ID:', BOT_ID);
    console.log('BOT CODE:', BOT_CODE);
    console.log('MODE: FETCH');
    console.log('OFFSET:', currentOffset);

    console.log('');
    console.log(
      'Теперь отправь сообщение клиентом в чат с ботом.'
    );

    console.log(
      'Render будет проверять события каждые',
      FETCH_INTERVAL,
      'мс.'
    );

    console.log('========================================');
  }
);


// ============================================================
// FETCH LOOP
// ============================================================

setInterval(
  fetchEvents,
  FETCH_INTERVAL
);


// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(signal) {

  console.log('');
  console.log(
    `🛑 ${signal} — завершаем работу...`
  );

  server.close(
    () => {
      console.log('✅ Сервер закрыт.');
      process.exit(0);
    }
  );
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);