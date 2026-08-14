'use strict';

/*
========================================================
MLK AI BOT
BITRIX FETCH + DEEPSEEK + TELEGRAM
========================================================

BITRIX:
  imbot.v2.Event.get
  imbot.v2.Chat.Message.send

TELEGRAM:
  getUpdates
  sendMessage

AI:
  DeepSeek API
  model: deepseek-v4-flash

NODE:
  Node.js 18+ / 20+ / 22+ / 24+
========================================================
*/

const http = require('http');

// ======================================================
// ENV
// ======================================================

const PORT = Number(process.env.PORT || 10000);

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL || '';
const BITRIX_BOT_TOKEN = process.env.BITRIX_BOT_TOKEN || '';

const BOT_ID = Number(process.env.BOT_ID || 1787);
const BOT_CODE =
  process.env.BOT_CODE || 'mlk_ai_consultant_v2';

const DEEPSEEK_API_KEY =
  process.env.DEEPSEEK_API_KEY || '';

const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '';


// ======================================================
// CONSTANTS
// ======================================================

const BITRIX_POLL_INTERVAL =
  Number(process.env.BITRIX_POLL_INTERVAL || 3000);

const TELEGRAM_POLL_TIMEOUT =
  Number(process.env.TELEGRAM_POLL_TIMEOUT || 30);

const TELEGRAM_POLL_INTERVAL =
  Number(process.env.TELEGRAM_POLL_INTERVAL || 1000);

const DEEPSEEK_TIMEOUT =
  Number(process.env.DEEPSEEK_TIMEOUT || 60000);


// ======================================================
// STATE
// ======================================================

let bitrixOffset = 0;

let telegramOffset = 0;

let shuttingDown = false;

let bitrixLoopRunning = false;

let telegramLoopRunning = false;


// ======================================================
// HELPERS
// ======================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function mask(value) {
  if (!value) {
    return 'MISSING';
  }

  if (value.length <= 8) {
    return '********';
  }

  return (
    value.slice(0, 4) +
    '********' +
    value.slice(-4)
  );
}


/*
--------------------------------------------------------
BITRIX WEBHOOK NORMALIZATION
--------------------------------------------------------

В Render лучше хранить:

BITRIX_WEBHOOK_URL=
https://YOUR_DOMAIN.bitrix24.ru/rest/USER_ID/WEBHOOK/

НЕ:

https://YOUR_DOMAIN.bitrix24.ru/rest/USER_ID/WEBHOOK/imbot.v2.Event.get

Но код ниже умеет удалить случайно добавленный method.
--------------------------------------------------------
*/

function normalizeBitrixWebhookUrl(url) {
  let result = String(url || '').trim();

  if (!result) {
    return '';
  }

  result = result.replace(/\/+$/, '');

  const methods = [
    'imbot.v2.Event.get',
    'imbot.v2.Chat.Message.send'
  ];

  for (const method of methods) {
    if (result.endsWith('/' + method)) {
      result = result.slice(
        0,
        -(method.length + 1)
      );
    }
  }

  return result;
}


const BITRIX_BASE_URL =
  normalizeBitrixWebhookUrl(BITRIX_WEBHOOK_URL);


function bitrixMethodUrl(method) {
  if (!BITRIX_BASE_URL) {
    throw new Error(
      'BITRIX_WEBHOOK_URL не задан'
    );
  }

  return `${BITRIX_BASE_URL}/${method}`;
}


// ======================================================
// GENERIC JSON POST
// ======================================================

async function postJson(url, body, options = {}) {
  const controller = new AbortController();

  const timeout =
    Number(options.timeout || 30000);

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',

        ...(options.headers || {})
      },

      body: JSON.stringify(body),

      signal: controller.signal
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text
      };
    }

    if (!response.ok) {
      throw new Error(
        `${options.name || 'HTTP'} ${response.status}: ${text}`
      );
    }

    return data;

  } catch (error) {

    if (error.name === 'AbortError') {
      throw new Error(
        `${options.name || 'HTTP'} timeout after ${timeout}ms`
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}


// ======================================================
// BITRIX API
// ======================================================

async function bitrixCall(method, params) {

  const url = bitrixMethodUrl(method);

  console.log('');
  console.log('----------------------------------------');
  console.log(`➡️ BITRIX API: ${method}`);
  console.log(`🌐 URL: ${url}`);

  const safeParams = {
    ...params
  };

  if (safeParams.botToken) {
    safeParams.botToken = '[HIDDEN]';
  }

  console.log(
    '📤 PARAMS:',
    JSON.stringify(safeParams)
  );

  const data = await postJson(
    url,
    params,
    {
      name: 'Bitrix',
      timeout: 30000
    }
  );

  console.log(
    '⬅️ BITRIX RESPONSE:',
    JSON.stringify(data)
  );

  return data;
}


// ======================================================
// BITRIX EVENT.GET
// ======================================================

async function bitrixGetEvents() {

  const params = {
    botId: BOT_ID,

    botToken: BITRIX_BOT_TOKEN,

    offset: bitrixOffset,

    limit: 50
  };

  return bitrixCall(
    'imbot.v2.Event.get',
    params
  );
}


// ======================================================
// BITRIX SEND MESSAGE
// ======================================================

async function bitrixSendMessage(
  dialogId,
  message,
  replyId = null
) {

  const fields = {
    message: String(message || ''),

    urlPreview: false
  };

  if (replyId) {
    fields.replyId = Number(replyId);
  }

  const params = {
    botId: BOT_ID,

    botToken: BITRIX_BOT_TOKEN,

    dialogId: String(dialogId),

    fields
  };

  console.log('');
  console.log('========================================');
  console.log('📤 BITRIX SEND');
  console.log('========================================');
  console.log('BOT ID:', BOT_ID);
  console.log('DIALOG ID:', dialogId);
  console.log('MESSAGE:', message);

  const result = await bitrixCall(
    'imbot.v2.Chat.Message.send',
    params
  );

  console.log('');
  console.log('🎉 BITRIX MESSAGE SENT');
  console.log(
    'RESULT:',
    JSON.stringify(result.result || result)
  );

  return result;
}


// ======================================================
// DEEPSEEK
// ======================================================

async function askDeepSeek(userMessage) {

  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY не задан'
    );
  }

  const text =
    String(userMessage || '').trim();

  if (!text) {
    return 'Пожалуйста, напишите сообщение.';
  }

  console.log('');
  console.log('========================================');
  console.log('🧠 DEEPSEEK REQUEST');
  console.log('========================================');
  console.log('MODEL:', DEEPSEEK_MODEL);
  console.log('USER MESSAGE:', text);

  const body = {

    model: DEEPSEEK_MODEL,

    messages: [

      {
        role: 'system',

        content:
          'Ты ИИ-консультант компании MLK. ' +
          'Отвечай на русском языке. ' +
          'Отвечай понятно, полезно и по существу. ' +
          'Не выдумывай факты о компании MLK, если ' +
          'они не были предоставлены пользователем.'
      },

      {
        role: 'user',

        content: text
      }

    ],

    stream: false,

    max_tokens: 1000
  };


  console.log(
    '📤 DEEPSEEK BODY:',
    JSON.stringify(body, null, 2)
  );


  const data = await postJson(

    'https://api.deepseek.com/chat/completions',

    body,

    {
      name: 'DeepSeek',

      timeout: DEEPSEEK_TIMEOUT,

      headers: {
        Authorization:
          `Bearer ${DEEPSEEK_API_KEY}`
      }
    }

  );


  console.log('');
  console.log('⬅️ DEEPSEEK RESPONSE');

  console.log(
    JSON.stringify(data)
  );


  const answer =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;


  if (!answer) {

    console.error(
      '❌ DeepSeek не вернул choices[0].message.content'
    );

    throw new Error(
      'Пустой ответ DeepSeek'
    );
  }


  console.log('');
  console.log('🧠 DEEPSEEK ANSWER');
  console.log('----------------------------------------');
  console.log(answer);


  return String(answer).trim();
}


// ======================================================
// PROCESS BITRIX EVENT
// ======================================================

async function processBitrixEvent(event) {

  console.log('');
  console.log('🎉🎉🎉 ПОЛУЧЕНО СОБЫТИЕ 🎉🎉🎉');

  console.log('========================================');
  console.log('📦 PROCESS EVENT');
  console.log('========================================');

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


  // ----------------------------------------------------
  // Нас интересуют только новые сообщения
  // ----------------------------------------------------

  if (
    event.type !==
    'ONIMBOTV2MESSAGEADD'
  ) {

    console.log(
      'ℹ️ Событие не является сообщением. Пропускаем.'
    );

    return;
  }


  const data = event.data || {};

  const message =
    data.message || {};

  const chat =
    data.chat || {};

  const user =
    data.user || {};


  const messageId =
    message.id;

  const chatId =
    message.chatId ||
    message.chat_id ||
    chat.id;

  const dialogId =
    chat.dialogId ||
    String(user.id || '');

  const text =
    String(message.text || '').trim();


  console.log('');
  console.log('💬 MESSAGE');
  console.log('----------------------------------------');
  console.log('ID:', messageId);
  console.log('CHAT ID:', chatId);
  console.log('DIALOG ID:', dialogId);
  console.log('TEXT:', text);


  console.log('');
  console.log('👤 USER');
  console.log('----------------------------------------');
  console.log('ID:', user.id);
  console.log('NAME:', user.name);


  console.log('');
  console.log('🤖 BOT');
  console.log('----------------------------------------');
  console.log('ID:', BOT_ID);
  console.log('CODE:', BOT_CODE);


  // ----------------------------------------------------
  // Защита от пустых сообщений
  // ----------------------------------------------------

  if (!text) {

    console.log(
      '📭 Пустое сообщение. Пропускаем.'
    );

    return;
  }


  // ----------------------------------------------------
  // Получаем ответ DeepSeek
  // ----------------------------------------------------

  console.log('');
  console.log(
    '➡️ ШАГ 1: DeepSeek'
  );


  let answer;

  try {

    answer =
      await askDeepSeek(text);

  } catch (error) {

    console.error('');
    console.error(
      '❌ DEEPSEEK ERROR'
    );

    console.error(
      error.message
    );


    answer =
      'Не удалось получить ответ от ИИ. ' +
      'Попробуйте ещё раз через несколько секунд.';
  }


  // ----------------------------------------------------
  // Отправляем ответ в Bitrix
  // ----------------------------------------------------

  console.log('');
  console.log(
    '➡️ ШАГ 2: отправляем ответ в Bitrix'
  );


  try {

    await bitrixSendMessage(
      dialogId,
      answer,
      messageId
    );

  } catch (error) {

    console.error('');
    console.error(
      '❌ BITRIX SEND ERROR'
    );

    console.error(
      error.message
    );

    /*
     * Важно:
     * здесь НЕ бросаем ошибку дальше.
     * FETCH loop должен продолжить работу.
     */

    throw error;
  }
}


// ======================================================
// BITRIX FETCH LOOP
// ======================================================

async function bitrixFetchLoop() {

  if (bitrixLoopRunning) {

    console.log(
      '⚠️ Bitrix FETCH loop уже запущен.'
    );

    return;
  }

  bitrixLoopRunning = true;


  console.log('');
  console.log('========================================');
  console.log('🚀 BITRIX FETCH LOOP STARTED');
  console.log('========================================');


  while (!shuttingDown) {

    try {

      console.log('');
      console.log('========================================');
      console.log('🔄 FETCH POLL');
      console.log('========================================');

      console.log(
        'TIME:',
        new Date().toISOString()
      );

      console.log(
        'BOT_ID:',
        BOT_ID
      );

      console.log(
        'OFFSET:',
        bitrixOffset
      );


      const response =
        await bitrixGetEvents();


      const result =
        response.result || {};

      const events =
        Array.isArray(result.events)
          ? result.events
          : [];

      const nextOffset =
        Number.isFinite(
          Number(result.nextOffset)
        )
          ? Number(result.nextOffset)
          : bitrixOffset;

      const hasMore =
        Boolean(result.hasMore);


      console.log('');
      console.log(
        '📦 EVENTS:',
        events.length
      );

      console.log(
        'NEXT OFFSET:',
        nextOffset
      );

      console.log(
        'HAS MORE:',
        hasMore
      );


      // ------------------------------------------------
      // ВАЖНО:
      //
      // Не двигаем offset до обработки событий.
      // Сначала DeepSeek + Bitrix send.
      // Потом подтверждаем очередь.
      // ------------------------------------------------

      for (const event of events) {

        try {

          await processBitrixEvent(
            event
          );

        } catch (error) {

          console.error('');
          console.error(
            '❌ ОШИБКА ОБРАБОТКИ EVENT'
          );

          console.error(
            error.message
          );

          /*
           * Останавливаем обработку текущей пачки.
           *
           * Offset НЕ двигаем.
           * Следующий цикл попробует событие снова.
           */

          break;
        }
      }


      /*
       * Если все события обработаны,
       * подтверждаем nextOffset.
       */

      if (events.length > 0) {

        /*
         * Проверяем последнее событие.
         * Если обработка не упала — двигаем offset.
         */

        bitrixOffset = nextOffset;

        console.log('');
        console.log(
          '➡️ OFFSET UPDATED TO:',
          bitrixOffset
        );

      } else {

        /*
         * Если событий нет, можно спокойно
         * использовать nextOffset.
         */

        bitrixOffset = nextOffset;

        console.log(
          '📭 Новых событий нет.'
        );
      }


      /*
       * Если есть ещё события — сразу повторяем.
       * Иначе небольшая пауза.
       */

      if (hasMore) {

        continue;
      }


      await sleep(
        BITRIX_POLL_INTERVAL
      );


    } catch (error) {

      console.error('');
      console.error(
        '❌ BITRIX FETCH ERROR'
      );

      console.error(
        error.message
      );

      console.error(
        '----------------------------------------'
      );


      /*
       * При 404 не надо долбить Bitrix
       * сотнями запросов в секунду.
       */

      await sleep(5000);
    }
  }


  bitrixLoopRunning = false;


  console.log(
    '🛑 BITRIX FETCH LOOP STOPPED'
  );
}


// ======================================================
// TELEGRAM API
// ======================================================

function telegramApiUrl(method) {

  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN не задан'
    );
  }

  return (
    `https://api.telegram.org/bot` +
    `${TELEGRAM_BOT_TOKEN}/${method}`
  );
}


async function telegramCall(
  method,
  params = {},
  timeout = 40000
) {

  const url =
    telegramApiUrl(method);


  const response =
    await postJson(

      url,

      params,

      {
        name: 'Telegram',

        timeout
      }
    );


  if (!response.ok) {

    throw new Error(
      `Telegram API error: ` +
      JSON.stringify(response)
    );
  }


  return response.result;
}


// ======================================================
// TELEGRAM SEND
// ======================================================

async function telegramSendMessage(
  chatId,
  text
) {

  console.log('');
  console.log('========================================');
  console.log('📤 TELEGRAM SEND');
  console.log('========================================');

  console.log(
    'CHAT ID:',
    chatId
  );

  console.log(
    'MESSAGE:',
    text
  );


  const result =
    await telegramCall(

      'sendMessage',

      {
        chat_id: chatId,

        text: String(text || '')
      },

      30000
    );


  console.log(
    '🎉 TELEGRAM MESSAGE SENT',
    result && result.message_id
      ? result.message_id
      : ''
  );


  return result;
}


// ======================================================
// PROCESS TELEGRAM MESSAGE
// ======================================================

async function processTelegramMessage(
  message
) {

  if (!message) {
    return;
  }


  const chat =
    message.chat || {};

  const from =
    message.from || {};


  const text =
    String(message.text || '').trim();


  /*
   * Telegram может присылать не текст:
   * фото, стикер и т.д.
   */

  if (!text) {

    console.log(
      '📭 Telegram message без текста. Пропускаем.'
    );

    return;
  }


  console.log('');
  console.log('========================================');
  console.log('📨 TELEGRAM MESSAGE');
  console.log('========================================');

  console.log(
    'UPDATE ID:',
    message.update_id
  );

  console.log(
    'CHAT ID:',
    chat.id
  );

  console.log(
    'USER:',
    from.username ||
    from.first_name ||
    from.id
  );

  console.log(
    'TEXT:',
    text
  );


  let answer;


  try {

    answer =
      await askDeepSeek(text);

  } catch (error) {

    console.error(
      '❌ TELEGRAM DEEPSEEK ERROR:',
      error.message
    );


    answer =
      'Не удалось получить ответ от ИИ. ' +
      'Попробуйте ещё раз.';
  }


  await telegramSendMessage(
    chat.id,
    answer
  );
}


// ======================================================
// TELEGRAM LOOP
// ======================================================

async function telegramLoop() {

  if (!TELEGRAM_BOT_TOKEN) {

    console.log('');
    console.log(
      '⚠️ TELEGRAM_BOT_TOKEN отсутствует.'
    );

    console.log(
      '⚠️ Telegram polling отключён.'
    );

    return;
  }


  if (telegramLoopRunning) {

    console.log(
      '⚠️ Telegram loop уже запущен.'
    );

    return;
  }


  telegramLoopRunning = true;


  console.log('');
  console.log('========================================');
  console.log('🚀 TELEGRAM LOOP STARTED');
  console.log('========================================');


  /*
   * Получаем информацию о боте.
   * Это сразу позволяет проверить token.
   */

  try {

    const me =
      await telegramCall(
        'getMe',
        {},
        15000
      );


    console.log(
      '✅ TELEGRAM BOT:',
      me.username
        ? '@' + me.username
        : me.first_name
    );


  } catch (error) {

    console.error('');
    console.error(
      '❌ TELEGRAM TOKEN ERROR'
    );

    console.error(
      error.message
    );

    telegramLoopRunning = false;

    return;
  }


  while (!shuttingDown) {

    try {

      const updates =
        await telegramCall(

          'getUpdates',

          {
            offset:
              telegramOffset,

            timeout:
              TELEGRAM_POLL_TIMEOUT,

            allowed_updates: [
              'message'
            ]
          },

          (TELEGRAM_POLL_TIMEOUT + 10) * 1000
        );


      if (
        !Array.isArray(updates) ||
        updates.length === 0
      ) {

        continue;
      }


      console.log('');
      console.log(
        `📦 TELEGRAM UPDATES: ${updates.length}`
      );


      for (const update of updates) {

        /*
         * Сразу запоминаем offset Telegram,
         * чтобы не получать один update бесконечно.
         */

        telegramOffset =
          Number(update.update_id) + 1;


        if (!update.message) {
          continue;
        }


        try {

          await processTelegramMessage(
            update.message
          );

        } catch (error) {

          console.error('');
          console.error(
            '❌ TELEGRAM EVENT ERROR'
          );

          console.error(
            error.message
          );
        }
      }


    } catch (error) {

      console.error('');
      console.error(
        '❌ TELEGRAM POLLING ERROR'
      );

      console.error(
        error.message
      );


      await sleep(
        TELEGRAM_POLL_INTERVAL
      );
    }
  }


  telegramLoopRunning = false;


  console.log(
    '🛑 TELEGRAM LOOP STOPPED'
  );
}


// ======================================================
// HTTP SERVER
// ======================================================

const server =
  http.createServer(
    (req, res) => {

      /*
       * Render требует, чтобы приложение
       * слушало PORT.
       */

      if (
        req.method === 'GET' &&
        req.url === '/'
      ) {

        res.writeHead(
          200,
          {
            'Content-Type':
              'application/json; charset=utf-8'
          }
        );


        res.end(
          JSON.stringify(
            {
              ok: true,

              service:
                'MLK Bitrix + Telegram + DeepSeek',

              bitrix: Boolean(
                BITRIX_BASE_URL
              ),

              telegram: Boolean(
                TELEGRAM_BOT_TOKEN
              ),

              deepseek: Boolean(
                DEEPSEEK_API_KEY
              ),

              botId: BOT_ID,

              botCode: BOT_CODE,

              model: DEEPSEEK_MODEL,

              mode: 'fetch'
            },

            null,
            2
          )
        );


        return;
      }


      res.writeHead(
        200,
        {
          'Content-Type':
            'text/plain; charset=utf-8'
        }
      );


      res.end(
        'MLK AI Bot is running'
      );
    }
  );


// ======================================================
// START
// ======================================================

console.log('');
console.log('========================================');
console.log('MLK BITRIX FETCH + TELEGRAM + DEEPSEEK');
console.log('========================================');

console.log(
  'BITRIX_WEBHOOK_URL:',
  BITRIX_BASE_URL
    ? 'OK'
    : 'MISSING'
);

console.log(
  'BITRIX_BOT_TOKEN:',
  BITRIX_BOT_TOKEN
    ? 'OK'
    : 'MISSING'
);

console.log(
  'BOT_ID:',
  BOT_ID
);

console.log(
  'BOT_CODE:',
  BOT_CODE
);

console.log(
  'DEEPSEEK_API_KEY:',
  DEEPSEEK_API_KEY
    ? 'OK'
    : 'MISSING'
);

console.log(
  'DEEPSEEK_MODEL:',
  DEEPSEEK_MODEL
);

console.log(
  'TELEGRAM_BOT_TOKEN:',
  TELEGRAM_BOT_TOKEN
    ? 'OK'
    : 'MISSING'
);

console.log(
  'PORT:',
  PORT
);

console.log('========================================');


if (!BITRIX_BASE_URL) {

  console.error('');
  console.error(
    '❌ BITRIX_WEBHOOK_URL не задан.'
  );

} else {

  console.log('');
  console.log(
    '🔗 BITRIX BASE URL:',
    BITRIX_BASE_URL
  );

  console.log(
    '🔗 EVENT URL:',
    bitrixMethodUrl(
      'imbot.v2.Event.get'
    )
  );

  console.log(
    '🔗 SEND URL:',
    bitrixMethodUrl(
      'imbot.v2.Chat.Message.send'
    )
  );
}


if (!DEEPSEEK_API_KEY) {

  console.error('');
  console.error(
    '❌ DEEPSEEK_API_KEY не задан.'
  );
}


if (!TELEGRAM_BOT_TOKEN) {

  console.log('');
  console.log(
    '⚠️ TELEGRAM_BOT_TOKEN не задан.'
  );

  console.log(
    'Telegram будет отключён.'
  );
}


server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log('');
    console.log('========================================');
    console.log('🚀 SERVER STARTED');
    console.log('========================================');

    console.log(
      'PORT:',
      PORT
    );

    console.log(
      'MODE: FETCH'
    );

    console.log(
      'BOT ID:',
      BOT_ID
    );

    console.log(
      'BOT CODE:',
      BOT_CODE
    );

    console.log(
      'DEEPSEEK:',
      DEEPSEEK_MODEL
    );

    console.log(
      'BITRIX:',
      BITRIX_BASE_URL
        ? 'ENABLED'
        : 'DISABLED'
    );

    console.log(
      'TELEGRAM:',
      TELEGRAM_BOT_TOKEN
        ? 'ENABLED'
        : 'DISABLED'
    );

    console.log('========================================');


    /*
     * КРИТИЧЕСКИ ВАЖНО:
     *
     * Запускаем каждый loop РОВНО ОДИН РАЗ.
     */

    if (
      BITRIX_BASE_URL &&
      BITRIX_BOT_TOKEN
    ) {

      bitrixFetchLoop()
        .catch(error => {

          console.error(
            '❌ FATAL BITRIX LOOP ERROR:',
            error
          );

        });

    } else {

      console.log(
        '⚠️ Bitrix FETCH отключён: нет ENV.'
      );
    }


    if (TELEGRAM_BOT_TOKEN) {

      telegramLoop()
        .catch(error => {

          console.error(
            '❌ FATAL TELEGRAM LOOP ERROR:',
            error
          );

        });

    } else {

      console.log(
        '⚠️ Telegram отключён: TELEGRAM_BOT_TOKEN отсутствует.'
      );
    }
  }
);


// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

function shutdown(signal) {

  if (shuttingDown) {
    return;
  }


  shuttingDown = true;


  console.log('');
  console.log('========================================');
  console.log(`🛑 ${signal}`);
  console.log('========================================');


  server.close(() => {

    console.log(
      '✅ Server closed'
    );

    process.exit(0);
  });


  setTimeout(() => {

    console.log(
      '⚠️ Forced shutdown'
    );

    process.exit(1);

  }, 10000);
}


process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);


// ======================================================
// UNHANDLED ERRORS
// ======================================================

process.on(
  'unhandledRejection',
  error => {

    console.error('');
    console.error(
      '❌ UNHANDLED REJECTION'
    );

    console.error(
      error
    );
  }
);


process.on(
  'uncaughtException',
  error => {

    console.error('');
    console.error(
      '❌ UNCAUGHT EXCEPTION'
    );

    console.error(
      error
    );
  }
);