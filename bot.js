const http = require('http');
const { Telegraf, Markup } = require('telegraf');

// ============================================================
// MLK BOT
// Рабочая база: 48fbf37
//
// 1. Старый Bitrix FETCH через imbot.v2.Event.get — СОХРАНЁН
// 2. Telegram → DeepSeek → Telegram — СОХРАНЁН
// 3. Telegram → Bitrix Open Line через Connector
// 4. Bitrix Operator → Telegram через OnImConnectorMessageAdd
// 5. AI ↔ MANAGER
// 6. Telegram emergency operator mode
//
// ВАЖНО:
// НИКАКИЕ секреты не выводятся в logs.
// НИКАКОЙ BITRIX_WEBHOOK_URL целиком не логируется.
// ============================================================


const PORT = Number(process.env.PORT || 10000);

const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');


// ============================================================
// BITRIX — СТАРЫЙ РАБОЧИЙ FETCH
// ============================================================

const BITRIX_WEBHOOK_URL =
  (process.env.BITRIX_WEBHOOK_URL || '')
    .trim()
    .replace(/\/$/, '');

const BITRIX_BOT_TOKEN =
  (process.env.BITRIX_BOT_TOKEN || '').trim();

const BOT_ID =
  Number(process.env.BOT_ID || 1787);

const BOT_CODE =
  process.env.BOT_CODE || 'mlk_ai_consultant_v2';

const BITRIX_POLL_INTERVAL_MS =
  Number(process.env.BITRIX_POLL_INTERVAL_MS || 3000);


// ============================================================
// BITRIX CONNECTOR / OPEN LINE
// ============================================================

const BITRIX_CONNECTOR_ENABLED =
  String(process.env.BITRIX_CONNECTOR_ENABLED || 'true')
    .toLowerCase() === 'true';

const BITRIX_CONNECTOR_ID =
  (process.env.BITRIX_CONNECTOR_ID || 'mlk_telegram')
    .trim()
    .toLowerCase();

const BITRIX_CONNECTOR_NAME =
  process.env.BITRIX_CONNECTOR_NAME || 'MLK Telegram';

const BITRIX_OPENLINE_ID_ENV =
  (process.env.BITRIX_OPENLINE_ID || '').trim();

const BITRIX_OPENLINE_NAME =
  process.env.BITRIX_OPENLINE_NAME || 'MLK Telegram';


// ============================================================
// BITRIX OAUTH
// ============================================================

const BITRIX_CLIENT_ID =
  (process.env.BITRIX_CLIENT_ID || '').trim();

const BITRIX_CLIENT_SECRET =
  (process.env.BITRIX_CLIENT_SECRET || '').trim();

let BITRIX_OAUTH_ACCESS_TOKEN =
  (process.env.BITRIX_OAUTH_ACCESS_TOKEN || '').trim();

let BITRIX_OAUTH_REFRESH_TOKEN =
  (process.env.BITRIX_OAUTH_REFRESH_TOKEN || '').trim();

const BITRIX_DOMAIN =
  (process.env.BITRIX_DOMAIN || 'b24-2fqomj.bitrix24.by')
    .trim();

let BITRIX_APPLICATION_TOKEN =
  (process.env.BITRIX_APPLICATION_TOKEN || '').trim();

let bitrixAccessExpiresAt = 0;


// ============================================================
// DEEPSEEK
// ============================================================

const DEEPSEEK_API_KEY =
  (process.env.DEEPSEEK_API_KEY || '').trim();

const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const DEEPSEEK_BASE_URL =
  (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com')
    .replace(/\/$/, '');


// ============================================================
// TELEGRAM
// ============================================================

const TELEGRAM_BOT_TOKEN =
  (
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_TOKEN ||
    ''
  ).trim();

const TELEGRAM_ADMIN_IDS = new Set(
  (process.env.TELEGRAM_ADMIN_IDS ||
   process.env.TELEGRAM_ADMIN_ID ||
   '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(Number)
);


// ============================================================
// RUNTIME STATE
// ============================================================

let bitrixOpenLineId =
  BITRIX_OPENLINE_ID_ENV
    ? Number(BITRIX_OPENLINE_ID_ENV)
    : 0;

let bitrixOffset = 0;

let connectorInitialized = false;

let telegramBot = null;


// Telegram customer state
//
// telegramChatId -> {
//   mode: 'ai' | 'manager',
//   bitrixChatId,
//   bitrixSessionId,
//   name,
//   username,
//   updatedAt
// }

const sessions = new Map();


// AI conversation history
//
// telegramChatId -> [
//   { role: 'user', content: '...' },
//   { role: 'assistant', content: '...' }
// ]

const histories = new Map();


// Telegram operator -> selected client
//
// operatorTelegramId -> customerTelegramChatId

const operatorSelectedClient = new Map();


// ============================================================
// HELPERS
// ============================================================

function secretStatus(value) {
  return value ? 'OK' : 'MISSING';
}

function safeError(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}


// ============================================================
// CONFIG LOG
// НИКАКИХ СЕКРЕТОВ
// ============================================================

function logConfig() {
  console.log('========================================');
  console.log('MLK BOT — BITRIX FETCH + CONNECTOR + TELEGRAM + DEEPSEEK');
  console.log('========================================');

  console.log(
    `BITRIX_WEBHOOK_URL: ${secretStatus(BITRIX_WEBHOOK_URL)}`
  );

  console.log(
    `BITRIX_BOT_TOKEN: ${secretStatus(BITRIX_BOT_TOKEN)}`
  );

  console.log(`BOT_ID: ${BOT_ID}`);
  console.log(`BOT_CODE: ${BOT_CODE}`);

  console.log(
    `DEEPSEEK_API_KEY: ${secretStatus(DEEPSEEK_API_KEY)}`
  );

  console.log(`DEEPSEEK_MODEL: ${DEEPSEEK_MODEL}`);

  console.log(
    `TELEGRAM_BOT_TOKEN: ${secretStatus(TELEGRAM_BOT_TOKEN)}`
  );

  console.log(
    `TELEGRAM_ADMIN_IDS: ${
      TELEGRAM_ADMIN_IDS.size ? 'SET' : 'NOT SET'
    }`
  );

  console.log(
    `BITRIX_CONNECTOR_ENABLED: ${BITRIX_CONNECTOR_ENABLED}`
  );

  console.log(
    `BITRIX_CONNECTOR_ID: ${BITRIX_CONNECTOR_ID}`
  );

  console.log(
    `BITRIX_CLIENT_ID: ${secretStatus(BITRIX_CLIENT_ID)}`
  );

  console.log(
    `BITRIX_CLIENT_SECRET: ${secretStatus(BITRIX_CLIENT_SECRET)}`
  );

  console.log(
    `BITRIX_OAUTH_ACCESS_TOKEN: ${secretStatus(BITRIX_OAUTH_ACCESS_TOKEN)}`
  );

  console.log(
    `BITRIX_OAUTH_REFRESH_TOKEN: ${secretStatus(BITRIX_OAUTH_REFRESH_TOKEN)}`
  );

  console.log(`BITRIX_DOMAIN: ${BITRIX_DOMAIN}`);

  console.log(
    `BITRIX_OPENLINE_ID: ${
      bitrixOpenLineId || 'AUTO-DISCOVERY'
    }`
  );

  console.log(
    `PUBLIC_BASE_URL: ${
      PUBLIC_BASE_URL ? 'OK' : 'MISSING'
    }`
  );

  console.log(`PORT: ${PORT}`);

  console.log('========================================');
}


// ============================================================
// GENERIC HTTP RESPONSE PARSER
// ============================================================

async function parseResponse(response) {
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid JSON response. HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${JSON.stringify(data).slice(0, 2000)}`
    );
  }

  return data;
}


// ============================================================
// BITRIX WEBHOOK CALL
// Используется ТОЛЬКО старым рабочим imbot FETCH
// ============================================================

async function bitrixWebhookCall(method, params) {
  if (!BITRIX_WEBHOOK_URL) {
    throw new Error('BITRIX_WEBHOOK_URL is missing');
  }

  const response = await fetch(
    `${BITRIX_WEBHOOK_URL}/${method}`,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },

      body: JSON.stringify(params)
    }
  );

  const data = await parseResponse(response);

  if (data.error) {
    throw new Error(
      `Bitrix ${data.error}: ${
        data.error_description || ''
      }`.trim()
    );
  }

  return data;
}


// ============================================================
// BITRIX OAUTH REFRESH
// ============================================================

async function refreshBitrixOAuth() {
  if (
    !BITRIX_CLIENT_ID ||
    !BITRIX_CLIENT_SECRET ||
    !BITRIX_OAUTH_REFRESH_TOKEN
  ) {
    throw new Error(
      'OAuth refresh credentials are incomplete'
    );
  }

  const url =
    new URL(
      'https://oauth.bitrix.info/oauth/token/'
    );

  url.searchParams.set(
    'grant_type',
    'refresh_token'
  );

  url.searchParams.set(
    'client_id',
    BITRIX_CLIENT_ID
  );

  url.searchParams.set(
    'client_secret',
    BITRIX_CLIENT_SECRET
  );

  url.searchParams.set(
    'refresh_token',
    BITRIX_OAUTH_REFRESH_TOKEN
  );

  const response =
    await fetch(
      url,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

  const data =
    await parseResponse(response);

  if (data.error) {
    throw new Error(
      `OAuth ${data.error}: ${
        data.error_description || ''
      }`.trim()
    );
  }

  if (
    !data.access_token ||
    !data.refresh_token
  ) {
    throw new Error(
      'OAuth refresh returned no token pair'
    );
  }

  BITRIX_OAUTH_ACCESS_TOKEN =
    data.access_token;

  BITRIX_OAUTH_REFRESH_TOKEN =
    data.refresh_token;

  bitrixAccessExpiresAt =
    Date.now() +
    Number(data.expires_in || 3600) * 1000 -
    60_000;

  console.log(
    '🔐 Bitrix OAuth token refreshed successfully.'
  );
}


// ============================================================
// BITRIX OAUTH CALL
// ============================================================

async function bitrixOAuthCall(
  method,
  params = {},
  retry = true
) {
  if (!BITRIX_OAUTH_ACCESS_TOKEN) {
    throw new Error(
      'BITRIX_OAUTH_ACCESS_TOKEN is missing'
    );
  }

  if (
    bitrixAccessExpiresAt &&
    Date.now() >= bitrixAccessExpiresAt &&
    BITRIX_OAUTH_REFRESH_TOKEN
  ) {
    await refreshBitrixOAuth();
  }

  const url =
    `https://${BITRIX_DOMAIN}/rest/${method}`;

  const body = {
    ...params,
    auth: BITRIX_OAUTH_ACCESS_TOKEN
  };

  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },

        body: JSON.stringify(body)
      }
    );

  const data =
    await parseResponse(response);

  if (
    data.error === 'expired_token' &&
    retry &&
    BITRIX_OAUTH_REFRESH_TOKEN
  ) {
    await refreshBitrixOAuth();

    return bitrixOAuthCall(
      method,
      params,
      false
    );
  }

  if (data.error) {
    throw new Error(
      `Bitrix ${data.error}: ${
        data.error_description || ''
      }`.trim()
    );
  }

  return data;
}


// ============================================================
// FIND OPEN LINE
// Если BITRIX_OPENLINE_ID не указан,
// ищем активную линию.
// ============================================================

async function getOpenLineId() {
  if (bitrixOpenLineId) {
    const check =
      await bitrixOAuthCall(
        'imopenlines.config.get',
        {
          CONFIG_ID: bitrixOpenLineId
        }
      );

    const line =
      check.result || {};

    console.log(
      `✅ Open Line selected: ID=${
        line.ID || bitrixOpenLineId
      }, NAME=${
        line.LINE_NAME || 'unknown'
      }`
    );

    return bitrixOpenLineId;
  }

  const response =
    await bitrixOAuthCall(
      'imopenlines.config.list.get',
      {
        PARAMS: {
          select: [
            'ID',
            'LINE_NAME',
            'ACTIVE'
          ],

          filter: {
            ACTIVE: 'Y'
          },

          order: {
            ID: 'ASC'
          },

          limit: 50,
          offset: 0
        },

        OPTIONS: {
          QUEUE: 'N',
          CONFIG_QUEUE: 'N'
        }
      }
    );

  const lines =
    Array.isArray(response.result)
      ? response.result
      : [];

  if (!lines.length) {
    throw new Error(
      'No active Bitrix Open Lines found'
    );
  }

  const exact =
    lines.find(
      x =>
        String(x.LINE_NAME || '')
          .trim()
          .toLowerCase() ===
        BITRIX_OPENLINE_NAME.toLowerCase()
    );

  const chosen =
    exact || lines[0];

  bitrixOpenLineId =
    Number(chosen.ID);

  console.log(
    `✅ Open Line auto-discovered: ID=${
      bitrixOpenLineId
    }, NAME=${
      chosen.LINE_NAME
    }`
  );

  if (!exact && lines.length > 1) {
    console.log(
      '⚠️ Multiple active Open Lines exist. ' +
      'Для точного выбора добавь BITRIX_OPENLINE_ID.'
    );
  }

  return bitrixOpenLineId;
}


// ============================================================
// CONNECTOR ICON
// ============================================================

const CONNECTOR_ICON = {
  DATA_IMAGE:
    'data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%2070%2070%22%3E%3Ccircle%20cx%3D%2235%22%20cy%3D%2235%22%20r%3D%2230%22%20fill%3D%22%2327A7E7%22/%3E%3Ctext%20x%3D%2235%22%20y%3D%2244%22%20font-size%3D%2226%22%20text-anchor%3D%22middle%22%20fill%3D%22white%22%3ET%3C/text%3E%3C/svg%3E',

  COLOR: '#27A7E7',
  SIZE: '90%',
  POSITION: 'center'
};


// ============================================================
// CONNECTOR INITIALIZATION
// ============================================================

async function initializeConnector() {
  if (!BITRIX_CONNECTOR_ENABLED) {
    console.log(
      '⚠️ Bitrix Connector disabled.'
    );

    return;
  }

  if (!PUBLIC_BASE_URL) {
    throw new Error(
      'PUBLIC_BASE_URL is required for Connector'
    );
  }

  if (
    !BITRIX_OAUTH_ACCESS_TOKEN ||
    !BITRIX_CLIENT_ID ||
    !BITRIX_CLIENT_SECRET ||
    !BITRIX_OAUTH_REFRESH_TOKEN
  ) {
    throw new Error(
      'OAuth variables are required for Bitrix Connector'
    );
  }

  const lineId =
    await getOpenLineId();

  const handlerUrl =
    `${PUBLIC_BASE_URL}/bitrix/connector/event`;

  const settingsUrl =
    `${PUBLIC_BASE_URL}/bitrix/connector/settings`;


  // ----------------------------------------------------------
  // REGISTER CONNECTOR
  // ----------------------------------------------------------

  const reg =
    await bitrixOAuthCall(
      'imconnector.register',
      {
        ID: BITRIX_CONNECTOR_ID,

        NAME:
          BITRIX_CONNECTOR_NAME,

        ICON:
          CONNECTOR_ICON,

        ICON_DISABLED: {
          ...CONNECTOR_ICON,
          COLOR: '#9AA0A6'
        },

        PLACEMENT_HANDLER:
          settingsUrl,

        DEL_EXTERNAL_MESSAGES:
          true,

        EDIT_INTERNAL_MESSAGES:
          true,

        DEL_INTERNAL_MESSAGES:
          true,

        NEWSLETTER:
          true,

        NEED_SYSTEM_MESSAGES:
          true,

        NEED_SIGNATURE:
          true,

        CHAT_GROUP:
          false
      }
    );

  if (
    reg.result?.result === false
  ) {
    throw new Error(
      `Connector registration failed: ${
        JSON.stringify(reg.result)
      }`
    );
  }

  console.log(
    '✅ Bitrix Connector registered.'
  );


  // ----------------------------------------------------------
  // EVENT BIND
  // ----------------------------------------------------------

  try {
    await bitrixOAuthCall(
      'event.bind',
      {
        event:
          'OnImConnectorMessageAdd',

        handler:
          handlerUrl
      }
    );

    console.log(
      '✅ OnImConnectorMessageAdd bound.'
    );

  } catch (error) {
    console.log(
      `⚠️ event.bind: ${safeError(error)}`
    );
  }


  // ----------------------------------------------------------
  // CONNECTOR DATA
  // ----------------------------------------------------------

  await bitrixOAuthCall(
    'imconnector.connector.data.set',
    {
      CONNECTOR:
        BITRIX_CONNECTOR_ID,

      LINE:
        lineId,

      DATA: {
        ID:
          `${BITRIX_CONNECTOR_ID}_line_${lineId}`,

        URL:
          PUBLIC_BASE_URL,

        URL_IM:
          PUBLIC_BASE_URL,

        NAME:
          BITRIX_CONNECTOR_NAME
      }
    }
  );


  // ----------------------------------------------------------
  // ACTIVATE
  // ----------------------------------------------------------

  await bitrixOAuthCall(
    'imconnector.activate',
    {
      CONNECTOR:
        BITRIX_CONNECTOR_ID,

      LINE:
        lineId,

      ACTIVE:
        '1'
    }
  );


  // ----------------------------------------------------------
  // STATUS
  // ----------------------------------------------------------

  const status =
    await bitrixOAuthCall(
      'imconnector.status',
      {
        CONNECTOR:
          BITRIX_CONNECTOR_ID,

        LINE:
          lineId
      }
    );

  console.log(
    `✅ Connector status: ${
      JSON.stringify(status.result)
    }`
  );

  connectorInitialized =
    true;
}


// ============================================================
// TELEGRAM CUSTOMER → BITRIX CONNECTOR
// ============================================================

async function sendBitrixConnectorMessage(
  telegramChatId,
  text,
  telegramUser = {},
  externalSenderId = null
) {
  if (
    !connectorInitialized ||
    !bitrixOpenLineId
  ) {
    return null;
  }

  const nameParts =
    String(
      telegramUser.first_name ||
      telegramUser.username ||
      'Telegram'
    )
      .trim()
      .split(/\s+/);

  const firstName =
    (
      nameParts[0] ||
      'Telegram'
    )
      .replace(
        /[^\p{L}\s'-]/gu,
        ''
      )
      .slice(0, 25) ||
      'Telegram';

  const lastName =
    (
      telegramUser.last_name ||
      ''
    )
      .replace(
        /[^\p{L}\s'-]/gu,
        ''
      )
      .slice(0, 25);


  const messageId =
    `tg_${telegramChatId}_${Date.now()}_${
      Math.random()
        .toString(36)
        .slice(2, 8)
    }`;


  const senderId =
    String(
      externalSenderId ||
      telegramChatId
    );


  const response =
    await bitrixOAuthCall(
      'imconnector.send.messages',
      {
        CONNECTOR:
          BITRIX_CONNECTOR_ID,

        LINE:
          bitrixOpenLineId,

        MESSAGES: [
          {
            user: {
              id:
                senderId,

              name:
                firstName,

              ...(lastName
                ? {
                    last_name:
                      lastName
                  }
                : {})
            },

            message: {
              id:
                messageId,

              date:
                nowUnix(),

              text:
                String(text)
                  .slice(0, 20000)
            },

            chat: {
              id:
                String(telegramChatId),

              name:
                telegramUser.username
                  ? `@${telegramUser.username}`
                  : `Telegram ${telegramChatId}`,

              url:
                PUBLIC_BASE_URL
            }
          }
        ]
      }
    );


  const item =
    response.result
      ?.DATA
      ?.RESULT
      ?.[0];


  const chatId =
    item?.session?.CHAT_ID ||
    item?.chat?.id;


  if (chatId) {
    const key =
      String(telegramChatId);

    const session =
      sessions.get(key) ||
      {
        mode: 'ai'
      };

    session.bitrixChatId =
      Number(chatId);

    session.bitrixSessionId =
      item?.session?.ID
        ? Number(item.session.ID)
        : session.bitrixSessionId;

    session.updatedAt =
      Date.now();

    sessions.set(
      key,
      session
    );
  }

  return item;
}


// ============================================================
// SEND MESSAGE TO OPEN LINE CHAT
// Для сообщений от приложения/бота
// ============================================================

async function sendBitrixOpenLineMessage(
  chatId,
  text
) {
  if (!chatId) return;

  await bitrixOAuthCall(
    'imopenlines.bot.session.message.send',
    {
      CHAT_ID:
        Number(chatId),

      NAME:
        'DEFAULT',

      MESSAGE:
        String(text)
          .slice(0, 20000)
    }
  );
}


// ============================================================
// СТАРЫЙ РАБОЧИЙ BITRIX BOT SEND
// ============================================================

async function sendBitrixBotMessage(
  dialogId,
  text,
  keyboard = null
) {
  const fields = {
    message:
      String(text)
        .slice(0, 20000)
  };

  if (keyboard) {
    fields.keyboard =
      keyboard;
  }

  return bitrixWebhookCall(
    'imbot.v2.Chat.Message.send',
    {
      botId:
        BOT_ID,

      botToken:
        BITRIX_BOT_TOKEN,

      dialogId:
        String(dialogId),

      fields
    }
  );
}


// ============================================================
// DEEPSEEK
// ============================================================

async function getDeepSeekAnswer(
  userMessage,
  history = []
) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY is missing'
    );
  }

  const messages = [
    {
      role: 'system',

      content:
        'Ты ИИ-консультант компании MLK. ' +
        'Отвечай кратко, понятно и по существу. ' +
        'Если вопрос требует участия человека, предложи позвать менеджера.'
    },

    ...history
      .slice(-12)
      .map(item => ({
        role:
          item.role,

        content:
          item.content
      })),

    {
      role: 'user',

      content:
        userMessage
    }
  ];


  const response =
    await fetch(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'Authorization':
            `Bearer ${DEEPSEEK_API_KEY}`
        },

        body:
          JSON.stringify({
            model:
              DEEPSEEK_MODEL,

            messages,

            stream:
              false,

            max_tokens:
              800
          })
      }
    );


  const data =
    await parseResponse(response);


  const answer =
    data.choices
      ?.[0]
      ?.message
      ?.content;


  if (!answer) {
    throw new Error(
      `DeepSeek returned no answer: ${
        JSON.stringify(data)
          .slice(0, 1000)
      }`
    );
  }

  return answer.trim();
}


// ============================================================
// HISTORY
// ============================================================

function addHistory(
  chatId,
  role,
  content
) {
  const key =
    String(chatId);

  const history =
    histories.get(key) || [];

  history.push({
    role,
    content
  });

  while (
    history.length > 24
  ) {
    history.shift();
  }

  histories.set(
    key,
    history
  );

  return history;
}


function getHistoryForAI(
  chatId
) {
  return (
    histories.get(
      String(chatId)
    ) || []
  ).slice(-12);
}


// ============================================================
// AI / MANAGER MODE
// ============================================================

function getMode(chatId) {
  return (
    sessions.get(
      String(chatId)
    )?.mode ||
    'ai'
  );
}


function setMode(
  chatId,
  mode
) {
  const key =
    String(chatId);

  const session =
    sessions.get(key) || {};

  session.mode =
    mode === 'manager'
      ? 'manager'
      : 'ai';

  session.updatedAt =
    Date.now();

  sessions.set(
    key,
    session
  );


  // Сохраняем режим в Bitrix app.option.
  // Если права не позволяют — это не ломает бота.

  if (
    connectorInitialized &&
    BITRIX_OAUTH_ACCESS_TOKEN
  ) {
    const optionKey =
      `mlk_mode_${
        key.replace(
          /[^0-9-]/g,
          '_'
        )
      }`;

    bitrixOAuthCall(
      'app.option.set',
      {
        options: {
          [optionKey]:
            session.mode
        }
      }
    ).catch(() => {});
  }
}


// ============================================================
// LOAD PERSISTENT MODES
// ============================================================

async function loadPersistentModes() {
  if (!BITRIX_OAUTH_ACCESS_TOKEN) {
    return;
  }

  try {
    const response =
      await bitrixOAuthCall(
        'app.option.get',
        {}
      );

    const data =
      response.result || {};

    for (
      const [key, value]
      of Object.entries(data)
    ) {
      if (
        !key.startsWith(
          'mlk_mode_'
        )
      ) {
        continue;
      }

      const chatId =
        key
          .slice(
            'mlk_mode_'.length
          )
          .replace(
            /_/g,
            ''
          );

      if (!chatId) {
        continue;
      }

      sessions.set(
        chatId,
        {
          mode:
            value === 'manager'
              ? 'manager'
              : 'ai',

          updatedAt:
            Date.now()
        }
      );
    }

    console.log(
      '✅ Persistent AI/manager modes loaded from Bitrix.'
    );

  } catch (error) {
    console.log(
      `⚠️ Persistent mode storage unavailable: ${
        safeError(error)
      }`
    );
  }
}


// ============================================================
// TELEGRAM BUTTONS
// ============================================================

function customerKeyboard(
  chatId,
  mode
) {
  if (mode === 'ai') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '👨‍💼 Позвать менеджера',
          `TAKE_MANAGER:${chatId}`
        )
      ]
    ]);
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '🤖 Вернуть ИИ',
        `RETURN_AI:${chatId}`
      )
    ]
  ]);
}


// ============================================================
// TELEGRAM ADMIN
// ============================================================

function isAdmin(ctx) {
  return TELEGRAM_ADMIN_IDS.has(
    Number(ctx.from?.id)
  );
}


// ============================================================
// SEND TO CUSTOMER FROM TELEGRAM OPERATOR
// ============================================================

async function telegramSendToCustomer(
  customerId,
  text,
  ctx
) {
  await ctx.telegram.sendMessage(
    customerId,
    text
  );

  const session =
    sessions.get(
      String(customerId)
    );

  if (
    session?.bitrixChatId
  ) {
    await sendBitrixOpenLineMessage(
      session.bitrixChatId,
      text
    );
  }
}


// ============================================================
// REMEMBER CUSTOMER
// ============================================================

function rememberClient(
  customerId,
  telegramUser
) {
  const key =
    String(customerId);

  const session =
    sessions.get(key) ||
    {
      mode: 'ai'
    };

  session.name =
    [
      telegramUser?.first_name,
      telegramUser?.last_name
    ]
      .filter(Boolean)
      .join(' ') ||
    telegramUser?.username ||
    key;

  session.username =
    telegramUser?.username ||
    '';

  session.updatedAt =
    Date.now();

  sessions.set(
    key,
    session
  );
}


// ============================================================
// TELEGRAM CUSTOMER MESSAGE
// ============================================================

async function processTelegramCustomerMessage(
  ctx,
  text
) {
  const chatId =
    String(ctx.chat.id);

  rememberClient(
    ctx.chat.id,
    ctx.from
  );

  const mode =
    getMode(ctx.chat.id);

  console.log(
    `📩 TELEGRAM CUSTOMER ${chatId} [${mode}]: ${text}`
  );


  // ----------------------------------------------------------
  // CLIENT → BITRIX
  // ----------------------------------------------------------

  await sendBitrixConnectorMessage(
    ctx.chat.id,
    text,
    ctx.from
  );


  addHistory(
    chatId,
    'user',
    text
  );


  // ----------------------------------------------------------
  // MANAGER MODE
  // ----------------------------------------------------------

  if (mode === 'manager') {
    console.log(
      '⏸️ AI disabled: manager mode.'
    );

    return;
  }


  // ----------------------------------------------------------
  // AI
  // ----------------------------------------------------------

  const answer =
    await getDeepSeekAnswer(
      text,
      getHistoryForAI(chatId)
    );


  addHistory(
    chatId,
    'assistant',
    answer
  );


  // Telegram → клиент

  await ctx.reply(
    answer,
    customerKeyboard(
      ctx.chat.id,
      'ai'
    )
  );


  // AI → Bitrix Open Line
  //
  // Отдельный внешний ID "mlk_ai_*",
  // чтобы в Bitrix AI не выглядел как клиент.

  await sendBitrixConnectorMessage(
    ctx.chat.id,
    answer,
    {
      first_name:
        'MLK AI',

      username:
        'mlk_ai'
    },
    `mlk_ai_${ctx.chat.id}`
  );
}


// ============================================================
// BITRIX CONNECTOR EVENT
//
// Срабатывает когда ОПЕРАТОР пишет в Bitrix.
// Входящее Telegram сообщение сюда НЕ попадает.
// ============================================================

async function handleBitrixConnectorEvent(
  body
) {
  const event =
    body?.event;

  const auth =
    body?.auth || {};


  // ----------------------------------------------------------
  // SECURITY
  // ----------------------------------------------------------

  if (
    auth.domain &&
    auth.domain !== BITRIX_DOMAIN
  ) {
    console.log(
      `⚠️ Ignoring connector event from unexpected domain: ${
        auth.domain
      }`
    );

    return;
  }


  if (
    auth.application_token
  ) {
    if (
      !BITRIX_APPLICATION_TOKEN
    ) {
      BITRIX_APPLICATION_TOKEN =
        auth.application_token;
    }
  }


  if (
    BITRIX_APPLICATION_TOKEN &&
    auth.application_token &&
    auth.application_token !==
      BITRIX_APPLICATION_TOKEN
  ) {
    throw new Error(
      'Invalid Bitrix application token'
    );
  }


  if (
    event !==
      'ONIMCONNECTORMESSAGEADD' &&
    event !==
      'OnImConnectorMessageAdd'
  ) {
    return;
  }


  const data =
    body.data || {};

  const messages =
    Array.isArray(
      data.MESSAGES
    )
      ? data.MESSAGES
      : [];


  // ----------------------------------------------------------
  // PROCESS EVERY OPERATOR MESSAGE
  // ----------------------------------------------------------

  for (
    const item
    of messages
  ) {
    const externalChatId =
      String(
        item.chat?.id ??
        ''
      );


    const text =
      String(
        item.message?.text ??
        ''
      )
        .replace(
          /\[br\]/gi,
          '\n'
        )
        .replace(
          /\[\/?b\]/gi,
          ''
        )
        .trim();


    const managerUserId =
      Number(
        item.message?.user_id ||
        0
      );


    if (
      !externalChatId ||
      !text
    ) {
      continue;
    }


    const customerId =
      Number(
        externalChatId
      );


    if (
      !Number.isSafeInteger(
        customerId
      ) ||
      customerId === 0
    ) {
      console.log(
        `⚠️ Connector event has non-numeric Telegram chat id: ${
          externalChatId
        }`
      );

      continue;
    }


    console.log(
      `📤 BITRIX OPERATOR → TELEGRAM ${customerId}: ${text}`
    );


    const session =
      sessions.get(
        externalChatId
      ) ||
      {
        mode:
          'manager'
      };


    session.bitrixChatId =
      Number(
        item.im?.chat_id ||
        session.bitrixChatId ||
        0
      ) ||
      session.bitrixChatId;


    session.lastManagerId =
      managerUserId ||
      session.lastManagerId;


    sessions.set(
      externalChatId,
      session
    );


    // --------------------------------------------------------
    // /ai
    // --------------------------------------------------------

    if (
      /^\/ai\b/i.test(text) ||
      /^(верни|вернуть)\s+ии/i.test(text)
    ) {
      setMode(
        customerId,
        'ai'
      );

      await telegramSendText(
        customerId,
        '🤖 ИИ снова подключён. Следующее сообщение клиента обработает ИИ.'
      );

      continue;
    }


    // --------------------------------------------------------
    // /manager
    // --------------------------------------------------------

    if (
      /^\/manager\b/i.test(text) ||
      /^(оператор|менеджер)\s*$/i.test(text)
    ) {
      setMode(
        customerId,
        'manager'
      );

      await telegramSendText(
        customerId,
        '👨‍💼 Менеджер подключён. ИИ больше не отвечает автоматически.'
      );

      continue;
    }


    // --------------------------------------------------------
    // ОБЫЧНОЕ СООБЩЕНИЕ ОПЕРАТОРА
    //
    // Сам факт сообщения оператора означает:
    // AI → MANAGER
    // --------------------------------------------------------

    setMode(
      customerId,
      'manager'
    );


    addHistory(
      externalChatId,
      'assistant',
      text
    );


    // Bitrix → Telegram

    await telegramSendText(
      customerId,
      text
    );


    // --------------------------------------------------------
    // DELIVERY STATUS
    // --------------------------------------------------------

    try {
      await bitrixOAuthCall(
        'imconnector.send.status.delivery',
        {
          CONNECTOR:
            BITRIX_CONNECTOR_ID,

          LINE:
            Number(
              data.LINE ||
              bitrixOpenLineId
            ),

          MESSAGES: [
            {
              im: {
                chat_id:
                  Number(
                    item.im?.chat_id ||
                    0
                  ),

                message_id:
                  Number(
                    item.im?.message_id ||
                    0
                  )
              },

              message: {
                id: [
                  String(
                    item.message?.id ||
                    `bitrix_${Date.now()}`
                  )
                ],

                date:
                  nowUnix()
              },

              chat: {
                id:
                  externalChatId
              }
            }
          ]
        }
      );

    } catch (error) {
      console.log(
        `⚠️ Delivery status failed: ${
          safeError(error)
        }`
      );
    }
  }
}


// ============================================================
// TELEGRAM SEND TEXT
// ============================================================

async function telegramSendText(
  chatId,
  text
) {
  if (!telegramBot) {
    return;
  }

  await telegramBot.telegram.sendMessage(
    chatId,
    text
  );
}


// ============================================================
// START TELEGRAM
// ============================================================

async function startTelegram() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(
      '⚠️ TELEGRAM_BOT_TOKEN отсутствует — Telegram отключён.'
    );

    return null;
  }


  const bot =
    new Telegraf(
      TELEGRAM_BOT_TOKEN
    );


  // ----------------------------------------------------------
  // /myid
  // ----------------------------------------------------------

  bot.command(
    'myid',
    async ctx => {
      await ctx.reply(
        `Ваш Telegram ID: ${ctx.from.id}`
      );
    }
  );


  // ----------------------------------------------------------
  // START
  // ----------------------------------------------------------

  bot.start(
    async ctx => {
      if (isAdmin(ctx)) {
        await ctx.reply(
          'Панель оператора MLK',
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '📋 Клиенты',
                'ADMIN_LIST'
              )
            ],

            [
              Markup.button.callback(
                '🤖 ИИ',
                'ADMIN_AI'
              ),

              Markup.button.callback(
                '👨‍💼 Менеджер',
                'ADMIN_MANAGER'
              )
            ]
          ])
        );

        return;
      }


      await ctx.reply(
        'Здравствуйте! Я консультант MLK. Чем могу помочь?'
      );
    }
  );


  // ----------------------------------------------------------
  // /clients
  // ----------------------------------------------------------

  bot.command(
    'clients',
    async ctx => {
      if (!isAdmin(ctx)) {
        return;
      }

      const items =
        [
          ...sessions.entries()
        ]
          .sort(
            (a, b) =>
              (b[1].updatedAt || 0) -
              (a[1].updatedAt || 0)
          )
          .slice(
            0,
            30
          );


      if (!items.length) {
        await ctx.reply(
          'Клиентов пока нет.'
        );

        return;
      }


      const lines =
        items.map(
          ([id, session]) =>
            `${id} — ${
              session.name || id
            } — ${
              session.mode === 'manager'
                ? '👨‍💼'
                : '🤖'
            }`
        );


      await ctx.reply(
        lines.join('\n')
      );
    }
  );


  // ----------------------------------------------------------
  // /use CHAT_ID
  // ----------------------------------------------------------

  bot.command(
    'use',
    async ctx => {
      if (!isAdmin(ctx)) {
        return;
      }

      const id =
        String(
          (
            ctx.message.text ||
            ''
          ).split(/\s+/)[1] ||
          ''
        );


      if (
        !id ||
        !sessions.has(id)
      ) {
        await ctx.reply(
          'Клиент не найден. Используй /clients.'
        );

        return;
      }


      operatorSelectedClient.set(
        String(ctx.chat.id),
        id
      );


      await ctx.reply(
        `Выбран клиент ${id}. Теперь обычный текст будет отправлен ему.`
      );
    }
  );


  // ----------------------------------------------------------
  // /ai CHAT_ID
  // ----------------------------------------------------------

  bot.command(
    'ai',
    async ctx => {
      if (!isAdmin(ctx)) {
        return;
      }

      const id =
        String(
          (
            ctx.message.text ||
            ''
          ).split(/\s+/)[1] ||
          operatorSelectedClient.get(
            String(ctx.chat.id)
          ) ||
          ''
        );


      if (!id) {
        await ctx.reply(
          'Укажи /ai CHAT_ID или сначала /use CHAT_ID.'
        );

        return;
      }


      setMode(
        id,
        'ai'
      );


      await telegramSendText(
        id,
        '🤖 ИИ снова подключён.'
      );


      await ctx.reply(
        `ИИ включён для ${id}.`
      );
    }
  );


  // ----------------------------------------------------------
  // /manager CHAT_ID
  // ----------------------------------------------------------

  bot.command(
    'manager',
    async ctx => {
      if (!isAdmin(ctx)) {
        return;
      }

      const id =
        String(
          (
            ctx.message.text ||
            ''
          ).split(/\s+/)[1] ||
          operatorSelectedClient.get(
            String(ctx.chat.id)
          ) ||
          ''
        );


      if (!id) {
        await ctx.reply(
          'Укажи /manager CHAT_ID или сначала /use CHAT_ID.'
        );

        return;
      }


      setMode(
        id,
        'manager'
      );


      await telegramSendText(
        id,
        '👨‍💼 Менеджер подключён.'
      );


      await ctx.reply(
        `Менеджер включён для ${id}.`
      );
    }
  );


  // ----------------------------------------------------------
  // /reply CHAT_ID TEXT
  // ----------------------------------------------------------

  bot.command(
    'reply',
    async ctx => {
      if (!isAdmin(ctx)) {
        return;
      }

      const parts =
        (
          ctx.message.text ||
          ''
        ).split(/\s+/);


      const id =
        String(
          parts[1] ||
          operatorSelectedClient.get(
            String(ctx.chat.id)
          ) ||
          ''
        );


      const text =
        parts
          .slice(2)
          .join(' ')
          .trim();


      if (!id || !text) {
        await ctx.reply(
          'Формат: /reply CHAT_ID текст'
        );

        return;
      }


      setMode(
        id,
        'manager'
      );


      await telegramSendToCustomer(
        id,
        text,
        ctx
      );


      await ctx.reply(
        `Отправлено клиенту ${id}.`
      );
    }
  );


  // ----------------------------------------------------------
  // CLIENT BUTTON — MANAGER
  // ----------------------------------------------------------

  bot.action(
    /^TAKE_MANAGER:(-?\d+)$/,
    async ctx => {
      const customerId =
        Number(
          ctx.match[1]
        );


      setMode(
        customerId,
        'manager'
      );


      await ctx.answerCbQuery(
        'Менеджер подключён'
      );


      await ctx.reply(
        '👨‍💼 Менеджер подключён. ИИ приостановлен.',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🤖 Вернуть ИИ',
              `RETURN_AI:${customerId}`
            )
          ]
        ])
      );


      const session =
        sessions.get(
          String(customerId)
        );


      if (
        session?.bitrixChatId
      ) {
        await sendBitrixOpenLineMessage(
          session.bitrixChatId,
          '👨‍💼 Клиент запросил менеджера. ИИ приостановлен.'
        );
      }
    }
  );


  // ----------------------------------------------------------
  // CLIENT BUTTON — AI
  // ----------------------------------------------------------

  bot.action(
    /^RETURN_AI:(-?\d+)$/,
    async ctx => {
      const customerId =
        Number(
          ctx.match[1]
        );


      setMode(
        customerId,
        'ai'
      );


      await ctx.answerCbQuery(
        'ИИ включён'
      );


      await ctx.reply(
        '🤖 ИИ снова подключён.'
      );


      const session =
        sessions.get(
          String(customerId)
        );


      if (
        session?.bitrixChatId
      ) {
        await sendBitrixOpenLineMessage(
          session.bitrixChatId,
          '🤖 ИИ снова подключён.'
        );
      }
    }
  );


  // ----------------------------------------------------------
  // ADMIN BUTTONS
  // ----------------------------------------------------------

  bot.action(
    'ADMIN_LIST',
    async ctx => {
      await ctx.answerCbQuery();

      if (!isAdmin(ctx)) {
        return;
      }

      const text =
        [
          ...sessions.entries()
        ]
          .map(
            ([id, session]) =>
              `${id} — ${
                session.name || id
              } — ${
                session.mode
              }`
          )
          .join('\n') ||
        'Пусто';


      await ctx.reply(text);
    }
  );


  bot.action(
    'ADMIN_AI',
    async ctx => {
      await ctx.answerCbQuery(
        'Используй /ai CHAT_ID'
      );
    }
  );


  bot.action(
    'ADMIN_MANAGER',
    async ctx => {
      await ctx.answerCbQuery(
        'Используй /manager CHAT_ID'
      );
    }
  );


  // ----------------------------------------------------------
  // TEXT
  // ----------------------------------------------------------

  bot.on(
    'text',
    async ctx => {
      try {
        const text =
          ctx.message.text.trim();


        if (!text) {
          return;
        }


        // ----------------------------------------------------
        // TELEGRAM OPERATOR
        // ----------------------------------------------------

        if (isAdmin(ctx)) {
          const selected =
            operatorSelectedClient.get(
              String(ctx.chat.id)
            );


          if (selected) {
            setMode(
              selected,
              'manager'
            );


            await telegramSendToCustomer(
              selected,
              text,
              ctx
            );


            await ctx.reply(
              `→ ${selected}`
            );

            return;
          }
        }


        // ----------------------------------------------------
        // CUSTOMER
        // ----------------------------------------------------

        await processTelegramCustomerMessage(
          ctx,
          text
        );

      } catch (error) {
        console.error(
          `❌ TELEGRAM MESSAGE ERROR: ${
            safeError(error)
          }`
        );

        await ctx.reply(
          'Произошла ошибка. Попробуйте ещё раз.'
        );
      }
    }
  );


  bot.catch(
    error => {
      console.error(
        `❌ TELEGRAM BOT ERROR: ${
          safeError(error)
        }`
      );
    }
  );


  await bot.launch({
    dropPendingUpdates:
      false
  });


  console.log(
    '✅ Telegram polling started.'
  );


  return bot;
}


// ============================================================
// СТАРЫЙ РАБОЧИЙ BITRIX FETCH EVENT
//
// ЭТОТ КОД НЕ ПЕРЕВОДИМ НА im.v2.Event.get
// ============================================================

async function processBitrixBotEvent(
  event
) {
  if (
    event.type !==
    'ONIMBOTV2MESSAGEADD'
  ) {
    return;
  }


  const message =
    event.data?.message ||
    {};

  const chat =
    event.data?.chat ||
    {};

  const user =
    event.data?.user ||
    {};

  const text =
    String(
      message.text || ''
    ).trim();


  if (!text) {
    return;
  }


  console.log(
    '========================================'
  );

  console.log(
    '📦 BITRIX FETCH EVENT'
  );

  console.log(
    `EVENT ID: ${event.eventId}`
  );

  console.log(
    `MESSAGE ID: ${message.id}`
  );

  console.log(
    `CHAT ID: ${
      message.chatId ||
      chat.id
    }`
  );

  console.log(
    `USER ID: ${user.id}`
  );

  console.log(
    `TEXT: ${text}`
  );

  console.log(
    '========================================'
  );


  try {
    const answer =
      await getDeepSeekAnswer(
        text,
        []
      );


    const keyboard = {
      BOT_ID,

      BUTTONS: [
        {
          TEXT:
            '👨‍💼 Менеджер',

          ACTION:
            'PUT',

          ACTION_VALUE:
            '/manager'
        },

        {
          TEXT:
            '🤖 ИИ',

          ACTION:
            'PUT',

          ACTION_VALUE:
            '/ai'
        }
      ]
    };


    await sendBitrixBotMessage(
      chat.dialogId ||
      String(user.id),
      answer,
      keyboard
    );


    console.log(
      '🎉 Bitrix internal bot answer sent.'
    );

  } catch (error) {
    console.error(
      `❌ BITRIX BOT EVENT ERROR: ${
        safeError(error)
      }`
    );
  }
}


// ============================================================
// СТАРЫЙ BITRIX FETCH LOOP
// ============================================================

async function pollBitrix() {
  while (true) {
    try {
      const params = {
        botId:
          BOT_ID,

        botToken:
          BITRIX_BOT_TOKEN,

        offset:
          bitrixOffset,

        limit:
          50
      };


      const response =
        await bitrixWebhookCall(
          'imbot.v2.Event.get',
          params
        );


      const result =
        response.result ||
        {};


      const events =
        Array.isArray(
          result.events
        )
          ? result.events
          : [];


      if (events.length) {
        console.log(
          `📦 BITRIX FETCH EVENTS: ${events.length}`
        );
      }


      for (
        const event
        of events
      ) {
        await processBitrixBotEvent(
          event
        );
      }


      if (
        typeof result.nextOffset ===
        'number'
      ) {
        bitrixOffset =
          result.nextOffset;
      }


      if (
        !result.hasMore
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              BITRIX_POLL_INTERVAL_MS
            )
        );
      }

    } catch (error) {
      console.error(
        `❌ BITRIX FETCH ERROR: ${
          safeError(error)
        }`
      );


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            Math.max(
              BITRIX_POLL_INTERVAL_MS,
              5000
            )
          )
      );
    }
  }
}


// ============================================================
// HTTP BODY
// ============================================================

async function readBody(req) {
  return await new Promise(
    (resolve, reject) => {
      let data = '';

      req.on(
        'data',
        chunk => {
          data += chunk;

          if (
            data.length >
            2_000_000
          ) {
            req.destroy();
          }
        }
      );


      req.on(
        'end',
        () => {
          if (!data) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(data)
            );
          } catch {
            reject(
              new Error(
                'Invalid JSON body'
              )
            );
          }
        }
      );


      req.on(
        'error',
        reject
      );
    }
  );
}


// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {

        // ----------------------------------------------------
        // ROOT
        // ----------------------------------------------------

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
            JSON.stringify({
              ok:
                true,

              service:
                'mlk-bot',

              connector:
                connectorInitialized,

              openLineId:
                bitrixOpenLineId ||
                null
            })
          );

          return;
        }


        // ----------------------------------------------------
        // HEALTH
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          req.url === '/health'
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          );


          res.end(
            JSON.stringify({
              ok:
                true,

              telegram:
                Boolean(
                  telegramBot
                ),

              bitrixFetch:
                Boolean(
                  BITRIX_WEBHOOK_URL
                ),

              connector:
                connectorInitialized,

              openLineId:
                bitrixOpenLineId ||
                null
            })
          );

          return;
        }


        // ----------------------------------------------------
        // CONNECTOR SETTINGS
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          req.url ===
            '/bitrix/connector/settings'
        ) {
          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            '<!doctype html>' +
            '<html>' +
            '<body>' +
            '<h3>MLK Telegram Connector</h3>' +
            '<p>Connector is managed by MLK Bot.</p>' +
            '</body>' +
            '</html>'
          );

          return;
        }


        // ----------------------------------------------------
        // CONNECTOR SETTINGS POST
        // ----------------------------------------------------

        if (
          req.method === 'POST' &&
          req.url ===
            '/bitrix/connector/settings'
        ) {
          const body =
            await readBody(req);


          let options = {};

          if (
            body.PLACEMENT_OPTIONS
          ) {
            try {
              options =
                JSON.parse(
                  body.PLACEMENT_OPTIONS
                );
            } catch {
              options = {};
            }
          }


          const line =
            Number(
              options.LINE ||
              bitrixOpenLineId
            );


          if (
            line &&
            BITRIX_OAUTH_ACCESS_TOKEN
          ) {
            await bitrixOAuthCall(
              'imconnector.activate',
              {
                CONNECTOR:
                  BITRIX_CONNECTOR_ID,

                LINE:
                  line,

                ACTIVE:
                  String(
                    options.ACTIVE_STATUS ??
                    1
                  )
              }
            );


            await bitrixOAuthCall(
              'imconnector.connector.data.set',
              {
                CONNECTOR:
                  BITRIX_CONNECTOR_ID,

                LINE:
                  line,

                DATA: {
                  ID:
                    `${BITRIX_CONNECTOR_ID}_line_${line}`,

                  URL:
                    PUBLIC_BASE_URL,

                  URL_IM:
                    PUBLIC_BASE_URL,

                  NAME:
                    BITRIX_CONNECTOR_NAME
                }
              }
            );
          }


          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            '<!doctype html>' +
            '<html>' +
            '<body>' +
            '<h3>MLK Telegram Connector</h3>' +
            '<p>Saved.</p>' +
            '</body>' +
            '</html>'
          );

          return;
        }


        // ----------------------------------------------------
        // BITRIX CONNECTOR EVENT
        // ----------------------------------------------------

        if (
          req.method === 'POST' &&
          req.url ===
            '/bitrix/connector/event'
        ) {
          const body =
            await readBody(req);


          console.log(
            '📥 Bitrix Connector event received.'
          );


          await handleBitrixConnectorEvent(
            body
          );


          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json'
            }
          );


          res.end(
            JSON.stringify({
              ok:
                true
            })
          );

          return;
        }


        // ----------------------------------------------------
        // BITRIX INSTALL CALLBACK
        // ----------------------------------------------------

        if (
          req.method === 'POST' &&
          req.url ===
            '/bitrix/install'
        ) {
          const body =
            await readBody(req);


          if (
            body.auth?.access_token
          ) {
            BITRIX_OAUTH_ACCESS_TOKEN =
              body.auth.access_token;

            BITRIX_OAUTH_REFRESH_TOKEN =
              body.auth.refresh_token ||
              BITRIX_OAUTH_REFRESH_TOKEN;

            BITRIX_APPLICATION_TOKEN =
              body.auth.application_token ||
              BITRIX_APPLICATION_TOKEN;

            bitrixAccessExpiresAt =
              Date.now() +
              Number(
                body.auth.expires_in ||
                3600
              ) *
              1000 -
              60_000;


            console.log(
              '✅ Bitrix installation callback received.'
            );
          }


          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json'
            }
          );


          res.end(
            JSON.stringify({
              status:
                'success'
            })
          );

          return;
        }


        // ----------------------------------------------------
        // 404
        // ----------------------------------------------------

        res.writeHead(
          404,
          {
            'Content-Type':
              'application/json'
          }
        );


        res.end(
          JSON.stringify({
            error:
              'Not found'
          })
        );

      } catch (error) {
        console.error(
          `❌ HTTP HANDLER ERROR: ${
            safeError(error)
          }`
        );


        res.writeHead(
          500,
          {
            'Content-Type':
              'application/json'
          }
        );


        res.end(
          JSON.stringify({
            error:
              'Internal error'
          })
        );
      }
    }
  );


// ============================================================
// MAIN
// ============================================================

async function main() {
  logConfig();


  // ----------------------------------------------------------
  // REQUIRED OLD CONFIG
  // ----------------------------------------------------------

  if (
    !BITRIX_WEBHOOK_URL ||
    !BITRIX_BOT_TOKEN
  ) {
    throw new Error(
      'BITRIX_WEBHOOK_URL and BITRIX_BOT_TOKEN are required'
    );
  }


  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY is required'
    );
  }


  // ----------------------------------------------------------
  // HTTP SERVER
  // ----------------------------------------------------------

  server.listen(
    PORT,
    () => {
      console.log(
        '========================================'
      );

      console.log(
        '🚀 SERVER STARTED'
      );

      console.log(
        `PORT: ${PORT}`
      );

      console.log(
        `PUBLIC_BASE_URL: ${
          PUBLIC_BASE_URL
            ? 'OK'
            : 'MISSING'
        }`
      );

      console.log(
        '========================================'
      );
    }
  );


  // ----------------------------------------------------------
  // IMPORTANT:
  // Старый рабочий FETCH запускается как раньше.
  // НИКАКОГО im.v2.Event.get здесь нет.
  // ----------------------------------------------------------

  pollBitrix()
    .catch(
      error =>
        console.error(
          `❌ FETCH LOOP STOPPED: ${
            safeError(error)
          }`
        )
    );


  // ----------------------------------------------------------
  // CONNECTOR
  // ----------------------------------------------------------

  try {
    if (
      BITRIX_CONNECTOR_ENABLED
    ) {
      await initializeConnector();

      await loadPersistentModes();
    }

  } catch (error) {
    console.error(
      `❌ BITRIX CONNECTOR INIT ERROR: ${
        safeError(error)
      }`
    );
  }


  // ----------------------------------------------------------
  // TELEGRAM
  // ----------------------------------------------------------

  try {
    telegramBot =
      await startTelegram();

  } catch (error) {
    console.error(
      `❌ TELEGRAM START ERROR: ${
        safeError(error)
      }`
    );
  }
}


// ============================================================
// SHUTDOWN
// ============================================================

process.once(
  'SIGINT',
  () => {
    if (telegramBot) {
      telegramBot.stop(
        'SIGINT'
      );
    }

    server.close(
      () => process.exit(0)
    );
  }
);


process.once(
  'SIGTERM',
  () => {
    if (telegramBot) {
      telegramBot.stop(
        'SIGTERM'
      );
    }

    server.close(
      () => process.exit(0)
    );
  }
);


// ============================================================
// START
// ============================================================

main().catch(
  error => {
    console.error(
      `❌ FATAL START ERROR: ${
        safeError(error)
      }`
    );

    process.exit(1);
  }
);