```javascript
require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ============================================================
// MLK AI CONSULTANT — TELEGRAM + BITRIX24 FETCH + DEEPSEEK
// ============================================================
// ВАЖНО:
// - Telegram token: BOT_TOKEN (старое рабочее имя)
//   или TELEGRAM_BOT_TOKEN
// - Bitrix webhook URL и bot token никогда не выводятся в logs.
// - Bitrix работает через FETCH: imbot.v2.Event.get
// - Telegram работает через Telegraf long polling.
// ============================================================

const BOT_TOKEN =
    (process.env.BOT_TOKEN ||
        process.env.TELEGRAM_BOT_TOKEN ||
        '').trim();

const DEEPSEEK_API_KEY =
    (process.env.DEEPSEEK_API_KEY || '').trim();

const DEEPSEEK_MODEL =
    (process.env.DEEPSEEK_MODEL ||
        'deepseek-v4-flash').trim();

const ADMIN_CHAT_ID =
    (process.env.ADMIN_CHAT_ID || '').trim();

const BITRIX_WEBHOOK_URL =
    (process.env.BITRIX_WEBHOOK_URL || '').trim();

const BITRIX_BOT_TOKEN =
    (process.env.BITRIX_BOT_TOKEN || '').trim();

const BITRIX_BOT_ID =
    Number(process.env.BITRIX_BOT_ID || 1787);

const BITRIX_BOT_CODE =
    (process.env.BITRIX_BOT_CODE ||
        'mlk_ai_consultant_v2').trim();

const PORT =
    Number(process.env.PORT || 10000);

const BITRIX_POLL_INTERVAL_MS =
    Number(process.env.BITRIX_POLL_INTERVAL_MS || 3000);

const BITRIX_EVENT_LIMIT =
    Number(process.env.BITRIX_EVENT_LIMIT || 50);

const SESSION_TTL =
    90 * 24 * 60 * 60 * 1000;

const MAX_HISTORY_MESSAGES = 30;

const ROOT_DIR = __dirname;

const SESSIONS_DIR =
    path.join(ROOT_DIR, 'sessions');

const DATA_DIR =
    path.join(ROOT_DIR, 'data');

const OFFSET_FILE =
    path.join(DATA_DIR, 'bitrix-offset.json');

const PROMPT_FILE =
    path.join(ROOT_DIR, 'promt.txt');

const PORTFOLIO_FILE =
    path.join(ROOT_DIR, 'portfolio.txt');

fs.mkdirSync(SESSIONS_DIR, {
    recursive: true
});

fs.mkdirSync(DATA_DIR, {
    recursive: true
});


// ============================================================
// LOAD FILES
// ============================================================

let SYSTEM_PROMPT = '';
let PORTFOLIO_TEXT = '';

try {
    SYSTEM_PROMPT =
        fs.readFileSync(
            PROMPT_FILE,
            'utf8'
        );
} catch (error) {
    console.error(
        '❌ Не удалось загрузить promt.txt:',
        error.message
    );

    process.exit(1);
}

if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
        PORTFOLIO_TEXT =
            fs.readFileSync(
                PORTFOLIO_FILE,
                'utf8'
            );
    } catch (error) {
        console.error(
            '⚠️ Ошибка загрузки portfolio.txt:',
            error.message
        );
    }
}


// ============================================================
// PORTFOLIO KEYWORDS
// ============================================================

const PORTFOLIO_KEYWORDS = [
    'опыт',
    'портфолио',
    'делали ли вы',
    'пример',
    'кейс',
    'проект',
    'объект',
    'работали',
    'участвовали',
    'проводили'
];


// ============================================================
// STARTUP DIAGNOSTICS
// НИКАКИХ СЕКРЕТОВ
// ============================================================

console.log('');

console.log(
    '========================================'
);

console.log(
    'MLK AI CONSULTANT'
);

console.log(
    'TELEGRAM + BITRIX24 FETCH + DEEPSEEK'
);

console.log(
    '========================================'
);

console.log(
    'BOT_TOKEN:',
    BOT_TOKEN ? 'OK' : 'MISSING'
);

console.log(
    'DEEPSEEK_API_KEY:',
    DEEPSEEK_API_KEY ? 'OK' : 'MISSING'
);

console.log(
    'DEEPSEEK_MODEL:',
    DEEPSEEK_MODEL
);

console.log(
    'ADMIN_CHAT_ID:',
    ADMIN_CHAT_ID ? 'OK' : 'MISSING'
);

console.log(
    'BITRIX_WEBHOOK_URL:',
    BITRIX_WEBHOOK_URL ? 'OK' : 'MISSING'
);

console.log(
    'BITRIX_BOT_TOKEN:',
    BITRIX_BOT_TOKEN ? 'OK' : 'MISSING'
);

console.log(
    'BITRIX_BOT_ID:',
    BITRIX_BOT_ID
);

console.log(
    'BITRIX_BOT_CODE:',
    BITRIX_BOT_CODE
);

console.log(
    'PORT:',
    PORT
);

console.log(
    'BITRIX_POLL_INTERVAL:',
    `${BITRIX_POLL_INTERVAL_MS} ms`
);

console.log(
    '========================================'
);


if (!DEEPSEEK_API_KEY) {
    console.error(
        '❌ DEEPSEEK_API_KEY не задан.'
    );

    process.exit(1);
}

if (
    !BOT_TOKEN &&
    !BITRIX_WEBHOOK_URL
) {
    console.error(
        '❌ Не задан ни BOT_TOKEN/TELEGRAM_BOT_TOKEN, ' +
        'ни BITRIX_WEBHOOK_URL.'
    );

    process.exit(1);
}

if (
    BITRIX_WEBHOOK_URL &&
    (
        !BITRIX_BOT_TOKEN ||
        !Number.isInteger(BITRIX_BOT_ID)
    )
) {
    console.error(
        '❌ Bitrix настроен не полностью: ' +
        'нужны BITRIX_BOT_TOKEN и корректный BITRIX_BOT_ID.'
    );

    process.exit(1);
}


const telegramEnabled =
    Boolean(BOT_TOKEN);

const bitrixEnabled =
    Boolean(
        BITRIX_WEBHOOK_URL &&
        BITRIX_BOT_TOKEN
    );

const bot =
    telegramEnabled
        ? new Telegraf(BOT_TOKEN)
        : null;


// ============================================================
// STATE
// ============================================================

const sessions = {};

const manualMode = {};

const lastActiveClient = {};

const equipmentSelection =
    new Map();

const awaitingTime =
    new Map();

const awaitingDateTime =
    new Map();

let bitrixOffset = null;

let bitrixPolling = false;

let stopping = false;

let bitrixInterval = null;

let telegramStarted = false;


// ============================================================
// SESSION STORAGE
// ============================================================

function loadSessions() {
    const now = Date.now();

    let loaded = 0;
    let deleted = 0;

    for (
        const file
        of fs.readdirSync(SESSIONS_DIR)
    ) {
        if (
            !file.endsWith('.json')
        ) {
            continue;
        }

        const filePath =
            path.join(
                SESSIONS_DIR,
                file
            );

        try {
            const stats =
                fs.statSync(
                    filePath
                );

            if (
                now - stats.mtimeMs >
                SESSION_TTL
            ) {
                fs.unlinkSync(
                    filePath
                );

                deleted++;

                continue;
            }

            const data =
                JSON.parse(
                    fs.readFileSync(
                        filePath,
                        'utf8'
                    )
                );

            if (
                Array.isArray(data)
            ) {
                sessions[
                    path.basename(
                        file,
                        '.json'
                    )
                ] = data;

                loaded++;
            }

        } catch (error) {
            console.error(
                `⚠️ Ошибка чтения сессии ${file}:`,
                error.message
            );
        }
    }

    console.log(
        `📂 Сессии: загружено ${loaded}, удалено старых ${deleted}`
    );
}


function saveSession(chatId) {
    const key =
        String(chatId);

    if (!sessions[key]) {
        return;
    }

    try {
        fs.writeFileSync(
            path.join(
                SESSIONS_DIR,
                `${key}.json`
            ),
            JSON.stringify(
                sessions[key],
                null,
                2
            ),
            'utf8'
        );

    } catch (error) {
        console.error(
            '❌ Ошибка сохранения сессии:',
            error.message
        );
    }
}


function ensureSession(
    chatId,
    userFirstName = ''
) {
    const key =
        String(chatId);

    if (
        sessions[key]
    ) {
        return sessions[key];
    }

    const filePath =
        path.join(
            SESSIONS_DIR,
            `${key}.json`
        );

    if (
        fs.existsSync(
            filePath
        )
    ) {
        try {
            const data =
                JSON.parse(
                    fs.readFileSync(
                        filePath,
                        'utf8'
                    )
                );

            if (
                Array.isArray(data)
            ) {
                sessions[key] =
                    data;

                return sessions[key];
            }

        } catch (error) {
            console.error(
                '⚠️ Не удалось загрузить существующую сессию:',
                error.message
            );
        }
    }

    sessions[key] = [
        {
            role: 'system',
            content: SYSTEM_PROMPT
        },
        {
            role: 'system',
            content:
                `Имя клиента: ${
                    userFirstName ||
                    'неизвестно'
                }`
        }
    ];

    saveSession(key);

    return sessions[key];
}


// ============================================================
// TELEGRAM KEYBOARDS
// ============================================================

function getFormatKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Концерты & Фестивали',
                'format_concerts'
            )
        ],
        [
            Markup.button.callback(
                'Конференции & Презентации & TV-проекты',
                'format_conferences'
            )
        ],
        [
            Markup.button.callback(
                'Корпоративы & Торжества',
                'format_corporate'
            )
        ],
        [
            Markup.button.callback(
                'Выставки',
                'format_exhibitions'
            )
        ],
        [
            Markup.button.callback(
                'Спортивные мероприятия',
                'format_sports'
            )
        ]
    ]);
}


function getLevelKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Стандартный (обычные требования)',
                'level_standard'
            )
        ],
        [
            Markup.button.callback(
                'Высокие требования (ТВ-трансляции)',
                'level_high'
            )
        ],
        [
            Markup.button.callback(
                'Высший уровень (высшие лица, международные)',
                'level_top'
            )
        ]
    ]);
}


function getPersonnelKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Управление оборудованием',
                'personnel_manage'
            )
        ],
        [
            Markup.button.callback(
                'Дежурный техник',
                'personnel_duty'
            )
        ],
        [
            Markup.button.callback(
                'Только монтаж-демонтаж',
                'personnel_mount'
            )
        ],
        [
            Markup.button.callback(
                'Другое',
                'personnel_other'
            )
        ]
    ]);
}


function getPlaceKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Улица',
                'place_outdoor'
            )
        ],
        [
            Markup.button.callback(
                'Помещение',
                'place_indoor'
            )
        ],
        [
            Markup.button.callback(
                'Под навесом',
                'place_tent'
            )
        ]
    ]);
}


function getLiftKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Есть грузовой лифт',
                'lift_yes'
            )
        ],
        [
            Markup.button.callback(
                'Нужно носить по лестнице',
                'lift_no'
            )
        ]
    ]);
}


function getMountKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Любое по согласованию',
                'mount_any'
            )
        ],
        [
            Markup.button.callback(
                'Ночью/рано утром',
                'mount_night'
            )
        ]
    ]);
}


function getDemountKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                'Любое по согласованию',
                'demount_any'
            )
        ],
        [
            Markup.button.callback(
                'До определённого времени',
                'demount_deadline'
            )
        ]
    ]);
}


function getEquipmentKeyboard(chatId) {
    const selected =
        equipmentSelection.get(
            chatId
        ) ||
        new Set();

    const mark =
        type =>
            selected.has(type)
                ? '✅ '
                : '';

    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                mark('sound') +
                'Звуковое оборудование',
                'equip_sound'
            )
        ],
        [
            Markup.button.callback(
                mark('led') +
                'Светодиодные экраны',
                'equip_led'
            )
        ],
        [
            Markup.button.callback(
                mark('light') +
                'Световое оборудование',
                'equip_light'
            )
        ],
        [
            Markup.button.callback(
                mark('stage') +
                'Сценические конструкции',
                'equip_stage'
            )
        ],
        [
            Markup.button.callback(
                mark('all') +
                'Полный комплекс',
                'equip_all'
            )
        ],
        [
            Markup.button.callback(
                'Готово (продолжить)',
                'equip_done'
            )
        ]
    ]);
}


function getCalendar(
    year,
    month,
    prefix
) {
    const firstDay =
        new Date(
            year,
            month,
            1
        );

    const lastDay =
        new Date(
            year,
            month + 1,
            0
        );

    const daysInMonth =
        lastDay.getDate();

    const startWeekDay =
        firstDay.getDay();

    const adjustedStart =
        startWeekDay === 0
            ? 6
            : startWeekDay - 1;

    const monthNames = [
        'Январь',
        'Февраль',
        'Март',
        'Апрель',
        'Май',
        'Июнь',
        'Июль',
        'Август',
        'Сентябрь',
        'Октябрь',
        'Ноябрь',
        'Декабрь'
    ];

    const buttons = [
        [
            Markup.button.callback(
                '◀️',
                `${prefix}_prev_${year}_${month}`
            ),
            Markup.button.callback(
                `${monthNames[month]} ${year}`,
                'ignore'
            ),
            Markup.button.callback(
                '▶️',
                `${prefix}_next_${year}_${month}`
            )
        ]
    ];

    buttons.push(
        [
            'Пн',
            'Вт',
            'Ср',
            'Чт',
            'Пт',
            'Сб',
            'Вс'
        ].map(
            d =>
                Markup.button.callback(
                    d,
                    'ignore'
                )
        )
    );

    let row = [];

    for (
        let i = 0;
        i < adjustedStart;
        i++
    ) {
        row.push(
            Markup.button.callback(
                ' ',
                'ignore'
            )
        );
    }

    for (
        let day = 1;
        day <= daysInMonth;
        day++
    ) {
        const dateStr =
            `${year}-${String(
                month + 1
            ).padStart(2, '0')}-${String(
                day
            ).padStart(2, '0')}`;

        row.push(
            Markup.button.callback(
                String(day),
                `${prefix}_set_${dateStr}`
            )
        );

        if (
            row.length === 7
        ) {
            buttons.push(row);
            row = [];
        }
    }

    if (
        row.length
    ) {
        while (
            row.length < 7
        ) {
            row.push(
                Markup.button.callback(
                    ' ',
                    'ignore'
                )
            );
        }

        buttons.push(row);
    }

    buttons.push([
        Markup.button.callback(
            'Пропустить',
            `${prefix}_skip`
        )
    ]);

    return Markup.inlineKeyboard(
        buttons
    );
}


function getTimeKeyboard(prefix) {
    const hours =
        Array.from(
            {
                length: 24
            },
            (_, i) =>
                String(i).padStart(
                    2,
                    '0'
                )
        );

    const minutes = [
        '00',
        '15',
        '30',
        '45'
    ];

    const buttons = [];

    for (
        let i = 0;
        i < hours.length;
        i += 6
    ) {
        buttons.push(
            hours
                .slice(i, i + 6)
                .map(
                    h =>
                        Markup.button.callback(
                            h,
                            `${prefix}_hour_${h}`
                        )
                )
        );
    }

    buttons.push(
        minutes.map(
            m =>
                Markup.button.callback(
                    m,
                    `${prefix}_min_${m}`
                )
        )
    );

    buttons.push([
        Markup.button.callback(
            'Подтвердить',
            `${prefix}_time_done`
        )
    ]);

    return Markup.inlineKeyboard(
        buttons
    );
}


// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(
    userMessage,
    sessionId,
    userFirstName = '',
    addPortfolio = false
) {
    const key =
        String(sessionId);

    const messages =
        ensureSession(
            key,
            userFirstName
        );

    let messageForAI =
        userMessage;

    if (
        addPortfolio &&
        PORTFOLIO_TEXT
    ) {
        messageForAI =
            'Отвечай на вопрос клиента, используя ТОЛЬКО информацию из списка проектов ниже. ' +
            'Не выдумывай проекты, которых нет в списке.\n\n' +
            'СПИСОК ПРОЕКТОВ:\n' +
            PORTFOLIO_TEXT +
            '\n\nВОПРОС КЛИЕНТА:\n' +
            userMessage;
    }

    messages.push({
        role: 'user',
        content: messageForAI
    });

    console.log(
        '🧠 DeepSeek:',
        DEEPSEEK_MODEL,
        '| session:',
        key
    );

    let response;

    try {
        response =
            await fetch(
                'https://api.deepseek.com/v1/chat/completions',
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

                            messages:
                                messages,

                            stream:
                                false,

                            temperature:
                                0.7,

                            max_tokens:
                                1000
                        })
                }
            );

    } catch (error) {
        throw new Error(
            `Ошибка соединения с DeepSeek: ${error.message}`
        );
    }

    const raw =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(raw);

    } catch {
        throw new Error(
            `DeepSeek вернул не JSON. HTTP ${response.status}: ${raw.slice(0, 1000)}`
        );
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `DeepSeek HTTP ${response.status}: ${
                data?.error?.message ||
                raw.slice(0, 1000)
            }`
        );
    }

    if (
        data.error
    ) {
        throw new Error(
            `DeepSeek API error: ${
                data.error.message ||
                JSON.stringify(data.error)
            }`
        );
    }

    const reply =
        String(
            data?.choices?.[0]?.message?.content ||
            ''
        ).trim();

    if (
        !reply
    ) {
        throw new Error(
            'DeepSeek вернул пустой ответ.'
        );
    }

    messages[
        messages.length - 1
    ] = {
        role: 'user',
        content: userMessage
    };

    messages.push({
        role: 'assistant',
        content: reply
    });

    if (
        messages.length >
        MAX_HISTORY_MESSAGES + 2
    ) {
        const systemMessages =
            messages.filter(
                m =>
                    m.role === 'system'
            );

        const conversationMessages =
            messages.filter(
                m =>
                    m.role !== 'system'
            );

        sessions[key] = [
            ...systemMessages,
            ...conversationMessages.slice(
                -MAX_HISTORY_MESSAGES
            )
        ];
    }

    saveSession(key);

    return reply;
}


function processAITags(text) {
    let result =
        String(
            text || ''
        ).trim();

    const tags = [];

    const regex =
        /\[(ask_[a-zA-Z0-9_]+)\]/g;

    let match;

    while (
        (match =
            regex.exec(result)) !== null
    ) {
        tags.push(
            match[1]
        );
    }

    result =
        result
            .replace(
                regex,
                ''
            )
            .trim();

    return {
        text:
            result,

        tags:
            [
                ...new Set(tags)
            ]
    };
}


const TAG_MESSAGES = {
    ask_format:
        'Выберите формат мероприятия: Концерты и фестивали, Конференции и презентации, Корпоративы и торжества, Выставки или Спортивные мероприятия.',

    ask_level:
        'Укажите уровень мероприятия: Стандартный, Высокие требования (например, ТВ-трансляция) или Высший уровень.',

    ask_personnel:
        'Какой персонал необходим: управление оборудованием, дежурный техник, только монтаж-демонтаж или другой вариант?',

    ask_place:
        'Где проходит мероприятие: на улице, в помещении или под навесом?',

    ask_lift:
        'Есть ли грузовой лифт для подъёма оборудования? Если нет — оборудование потребуется поднимать по лестнице.',

    ask_equipment:
        'Какое оборудование необходимо? Можно указать несколько категорий: звуковое оборудование, LED-экраны, световое оборудование, сценические конструкции или полный комплекс.',

    ask_mount:
        'Какое время монтажа подходит: любое по согласованию или ночью/рано утром?',

    ask_demount:
        'Какое время демонтажа подходит: любое по согласованию или до определённого времени?',

    ask_date_start:
        'Укажите дату начала мероприятия.',

    ask_date_end:
        'Укажите дату окончания мероприятия.',

    ask_ready_date:
        'Укажите дату и время, к которому оборудование должно быть полностью готово.'
};


// ============================================================
// BITRIX REST
// ============================================================

async function bitrixCall(
    method,
    params = {}
) {
    if (
        !bitrixEnabled
    ) {
        throw new Error(
            'Bitrix отключён.'
        );
    }

    const base =
        BITRIX_WEBHOOK_URL
            .replace(
                /\/+$/,
                ''
            );

    const url =
        `${base}/${method}`;

    console.log(
        `➡️ BITRIX API: ${method}`
    );

    let response;

    try {
        response =
            await fetch(
                url,
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        'Accept':
                            'application/json'
                    },

                    body:
                        JSON.stringify(params)
                }
            );

    } catch (error) {
        throw new Error(
            `Bitrix connection error: ${error.message}`
        );
    }

    const text =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(text);

    } catch {
        throw new Error(
            `Bitrix вернул не JSON. HTTP ${response.status}: ${text.slice(0, 1000)}`
        );
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `Bitrix HTTP ${response.status}: ${
                data?.error ||
                ''
            } ${
                data?.error_description ||
                ''
            }`.trim()
        );
    }

    if (
        data.error
    ) {
        throw new Error(
            `Bitrix ${data.error}: ${
                data.error_description ||
                ''
            }`.trim()
        );
    }

    return data.result;
}


// ============================================================
// BITRIX BOT CHECK
// ============================================================

async function checkBitrixBot() {
    const result =
        await bitrixCall(
            'imbot.v2.Bot.get',
            {
                botId:
                    BITRIX_BOT_ID,

                botToken:
                    BITRIX_BOT_TOKEN
            }
        );

    const info =
        result?.bot ||
        result ||
        {};

    console.log(
        '🤖 Bitrix bot:',
        info.id ||
        BITRIX_BOT_ID
    );

    console.log(
        '   code:',
        info.code ||
        BITRIX_BOT_CODE
    );

    console.log(
        '   eventMode:',
        info.eventMode ||
        'unknown'
    );

    if (
        info.id &&
        Number(info.id) !==
            BITRIX_BOT_ID
    ) {
        throw new Error(
            `Bitrix вернул Bot ID ${info.id}, ожидался ${BITRIX_BOT_ID}.`
        );
    }

    if (
        info.eventMode &&
        info.eventMode !== 'fetch'
    ) {
        throw new Error(
            `Bitrix bot ${BITRIX_BOT_ID} не в FETCH. Текущий режим: ${info.eventMode}`
        );
    }
}


// ============================================================
// BITRIX EVENTS
// ============================================================

async function getBitrixEvents() {
    const params = {
        botId:
            BITRIX_BOT_ID,

        botToken:
            BITRIX_BOT_TOKEN,

        limit:
            BITRIX_EVENT_LIMIT
    };

    if (
        bitrixOffset !== null
    ) {
        params.offset =
            bitrixOffset;
    }

    return bitrixCall(
        'imbot.v2.Event.get',
        params
    );
}


// ============================================================
// BITRIX SEND MESSAGE
// ============================================================

async function sendBitrixMessage(
    dialogId,
    text
) {
    const cleanText =
        String(
            text || ''
        ).trim();

    if (
        !cleanText
    ) {
        return null;
    }

    console.log(
        `📤 Bitrix send | dialog=${dialogId}`
    );

    return bitrixCall(
        'imbot.v2.Chat.Message.send',
        {
            botId:
                BITRIX_BOT_ID,

            botToken:
                BITRIX_BOT_TOKEN,

            dialogId:
                String(dialogId),

            fields: {
                message:
                    cleanText,

                urlPreview:
                    true
            }
        }
    );
}


// ============================================================
// BITRIX OFFSET
// ============================================================

function loadBitrixOffset() {
    try {
        if (
            !fs.existsSync(
                OFFSET_FILE
            )
        ) {
            bitrixOffset =
                null;

            console.log(
                'ℹ️ Bitrix offset отсутствует — первый запрос без offset.'
            );

            return;
        }

        const data =
            JSON.parse(
                fs.readFileSync(
                    OFFSET_FILE,
                    'utf8'
                )
            );

        bitrixOffset =
            Number.isInteger(
                data.offset
            )
                ? data.offset
                : null;

        console.log(
            '✅ Bitrix offset:',
            bitrixOffset === null
                ? 'none'
                : bitrixOffset
        );

    } catch (error) {
        bitrixOffset =
            null;

        console.error(
            '⚠️ Ошибка загрузки Bitrix offset:',
            error.message
        );
    }
}


function saveBitrixOffset(
    value
) {
    try {
        fs.writeFileSync(
            OFFSET_FILE,
            JSON.stringify(
                {
                    offset:
                        value,

                    savedAt:
                        new Date().toISOString()
                },
                null,
                2
            ),
            'utf8'
        );

    } catch (error) {
        console.error(
            '⚠️ Ошибка сохранения Bitrix offset:',
            error.message
        );
    }
}


// ============================================================
// BITRIX AI RESPONSE
// ============================================================

async function sendAIResponseToBitrix(
    dialogId,
    aiText
) {
    const processed =
        processAITags(
            aiText
        );

    if (
        processed.text
    ) {
        await sendBitrixMessage(
            dialogId,
            processed.text
        );
    }

    for (
        const tag
        of processed.tags
    ) {
        const question =
            TAG_MESSAGES[tag];

        if (
            !question
        ) {
            console.log(
                `⚠️ Неизвестный AI tag: [${tag}]`
            );

            continue;
        }

        await sendBitrixMessage(
            dialogId,
            question
        );
    }
}


// ============================================================
// BITRIX INCOMING MESSAGE
// ============================================================

async function handleBitrixMessage(
    data
) {
    const message =
        data?.message ||
        {};

    const chat =
        data?.chat ||
        {};

    const user =
        data?.user ||
        {};

    const botInfo =
        data?.bot ||
        {};

    const text =
        String(
            message.text ||
            ''
        ).trim();

    const dialogId =
        chat.dialogId ||
        chat.dialog_id ||
        message.chatId ||
        message.chat_id;

    const authorId =
        message.authorId ??
        message.author_id;

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '📩 BITRIX MESSAGE'
    );

    console.log(
        '========================================'
    );

    console.log(
        'EVENT BOT ID:',
        botInfo.id ||
        BITRIX_BOT_ID
    );

    console.log(
        'MESSAGE ID:',
        message.id ||
        'unknown'
    );

    console.log(
        'CHAT ID:',
        message.chatId ||
        chat.id ||
        'unknown'
    );

    console.log(
        'DIALOG ID:',
        dialogId ||
        'unknown'
    );

    console.log(
        'USER:',
        user.name ||
        user.firstName ||
        'unknown'
    );

    console.log(
        'TEXT:',
        text ||
        '(empty)'
    );

    if (
        !dialogId
    ) {
        throw new Error(
            'У входящего Bitrix события отсутствует dialogId.'
        );
    }

    if (
        !text
    ) {
        return;
    }

    // Защита от зацикливания.
    if (
        Number(authorId) ===
        BITRIX_BOT_ID
    ) {
        console.log(
            '↩️ Это сообщение самого Bitrix-бота. Пропускаем.'
        );

        return;
    }

    if (
        botInfo.id &&
        Number(botInfo.id) !==
            BITRIX_BOT_ID
    ) {
        console.log(
            `↩️ Событие другого бота (${botInfo.id}). Пропускаем.`
        );

        return;
    }

    const lowerText =
        text.toLowerCase();

    const addPortfolio =
        PORTFOLIO_KEYWORDS.some(
            keyword =>
                lowerText.includes(
                    keyword
                )
        );

    const firstName =
        user.firstName ||
        user.name ||
        'клиент';

    try {
        const reply =
            await askDeepSeek(
                text,
                `bitrix_${dialogId}`,
                firstName,
                addPortfolio
            );

        console.log(
            '🤖 AI RESPONSE:',
            reply
        );

        await sendAIResponseToBitrix(
            dialogId,
            reply
        );

        console.log(
            '✅ Bitrix цикл завершён.'
        );

    } catch (error) {
        console.error(
            '❌ Ошибка Bitrix → DeepSeek:',
            error.stack ||
            error.message
        );

        try {
            await sendBitrixMessage(
                dialogId,
                'Извините, произошла временная техническая ошибка. Пожалуйста, попробуйте написать ещё раз или я передам вас менеджеру.'
            );
        } catch (sendError) {
            console.error(
                '❌ Не удалось отправить ошибку в Bitrix:',
                sendError.message
            );
        }

        throw error;
    }
}


// ============================================================
// BITRIX EVENT
// ============================================================

async function handleBitrixEvent(
    event
) {
    if (
        !event
    ) {
        return;
    }

    console.log('');

    console.log(
        '📨 BITRIX EVENT:',
        event.eventId,
        event.type,
        event.date ||
            ''
    );

    if (
        event.type ===
        'ONIMBOTV2MESSAGEADD'
    ) {
        await handleBitrixMessage(
            event.data ||
            {}
        );

        return;
    }

    if (
        event.type ===
        'ONIMBOTV2JOINCHAT'
    ) {
        console.log(
            '👋 Bitrix: бот добавлен в чат.'
        );

        return;
    }

    if (
        event.type ===
        'ONIMBOTV2DELETE'
    ) {
        console.log(
            '⚠️ Bitrix: бот удалён из чата.'
        );

        return;
    }

    console.log(
        'ℹ️ Bitrix: событие без специальной обработки.'
    );
}


// ============================================================
// BITRIX POLLING
// ============================================================

async function pollBitrix() {
    if (
        !bitrixEnabled ||
        stopping ||
        bitrixPolling
    ) {
        return;
    }

    bitrixPolling =
        true;

    try {
        const result =
            await getBitrixEvents();

        const events =
            Array.isArray(
                result?.events
            )
                ? result.events
                : [];

        const nextOffset =
            Number(
                result?.nextOffset
            );

        const hasMore =
            Boolean(
                result?.hasMore
            );

        console.log(
            `🔄 Bitrix FETCH | events=${events.length} offset=${bitrixOffset ?? 'none'} next=${Number.isInteger(nextOffset) ? nextOffset : 'none'} more=${hasMore}`
        );

        // Обрабатываем последовательно.
        // Offset двигаем только после успешной обработки пачки.
        for (
            const event
            of events
        ) {
            await handleBitrixEvent(
                event
            );
        }

        if (
            Number.isInteger(
                nextOffset
            )
        ) {
            bitrixOffset =
                nextOffset;

            saveBitrixOffset(
                bitrixOffset
            );
        }

        if (
            hasMore
        ) {
            setImmediate(
                pollBitrix
            );
        }

    } catch (error) {
        console.error(
            '❌ BITRIX FETCH ERROR:',
            error.stack ||
            error.message
        );

    } finally {
        bitrixPolling =
            false;
    }
}


function startBitrixPolling() {
    if (
        !bitrixEnabled
    ) {
        console.log(
            '⚠️ Bitrix отключён: нет BITRIX_WEBHOOK_URL или BITRIX_BOT_TOKEN.'
        );

        return;
    }

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        '🚀 BITRIX FETCH LOOP STARTED'
    );

    console.log(
        '========================================'
    );

    pollBitrix();

    bitrixInterval =
        setInterval(
            pollBitrix,
            BITRIX_POLL_INTERVAL_MS
        );
}


// ============================================================
// TELEGRAM HELPERS
// ============================================================

async function notifyAdmin(
    text,
    extra = {}
) {
    if (
        !telegramEnabled ||
        !ADMIN_CHAT_ID
    ) {
        return;
    }

    try {
        await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            text,
            extra
        );

    } catch (error) {
        console.error(
            '⚠️ Telegram admin notification error:',
            error.message
        );
    }
}


async function handleTelegramAIReply(
    ctx,
    text,
    chatId
) {
    const tagRegex =
        /\[(ask_\w+)\]/;

    const match =
        text.match(
            tagRegex
        );

    let finalText =
        text;

    let keyboardInfo =
        null;

    if (
        match
    ) {
        const tagName =
            match[1];

        finalText =
            text
                .replace(
                    match[0],
                    ''
                )
                .trim();

        const map = {
            ask_format:
                {
                    type:
                        'format'
                },

            ask_level:
                {
                    type:
                        'level'
                },

            ask_personnel:
                {
                    type:
                        'personnel'
                },

            ask_place:
                {
                    type:
                        'place'
                },

            ask_lift:
                {
                    type:
                        'lift'
                },

            ask_equipment:
                {
                    type:
                        'equipment'
                },

            ask_mount:
                {
                    type:
                        'mount'
                },

            ask_demount:
                {
                    type:
                        'demount'
                },

            ask_date_start:
                {
                    type:
                        'calendar',

                    prefix:
                        'date_start',

                    text:
                        '📅 Выберите дату начала:'
                },

            ask_date_end:
                {
                    type:
                        'calendar',

                    prefix:
                        'date_end',

                    text:
                        '📅 Выберите дату окончания:'
                },

            ask_ready_date:
                {
                    type:
                        'calendar',

                    prefix:
                        'ready_date',

                    text:
                        '📅 Готовность оборудования:'
                }
        };

        keyboardInfo =
            map[tagName] ||
            null;
    }

    if (
        !keyboardInfo
    ) {
        const lower =
            text.toLowerCase();

        if (
            lower.includes(
                'формат'
            ) &&
            (
                lower.includes(
                    'выберите'
                ) ||
                lower.includes(
                    'какой'
                )
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'format'
                };

        } else if (
            lower.includes(
                'уровень'
            ) &&
            lower.includes(
                'мероприятия'
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'level'
                };

        } else if (
            lower.includes(
                'персонал'
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'personnel'
                };

        } else if (
            lower.includes(
                'место'
            ) &&
            lower.includes(
                'проходит'
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'place'
                };

        } else if (
            lower.includes(
                'лифт'
            ) ||
            lower.includes(
                'подъем'
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'lift'
                };

        } else if (
            lower.includes(
                'оборудование'
            ) &&
            (
                lower.includes(
                    'выберите'
                ) ||
                lower.includes(
                    'какое'
                )
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'equipment'
                };

        } else if (
            lower.includes(
                'монтаж'
            ) &&
            !lower.includes(
                'демонтаж'
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'mount'
                };

        } else if (
            lower.includes(
                'демонтаж'
            )
        ) {
            keyboardInfo =
                {
                    type:
                        'demount'
                };
        }
    }

    if (
        finalText
    ) {
        await ctx.reply(
            finalText
        );
    }

    if (
        !keyboardInfo
    ) {
        return;
    }

    if (
        keyboardInfo.type ===
        'format'
    ) {
        await ctx.reply(
            '🎭 Выберите формат мероприятия:',
            getFormatKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'level'
    ) {
        await ctx.reply(
            '📊 Укажите уровень мероприятия:',
            getLevelKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'personnel'
    ) {
        await ctx.reply(
            '👷 Выберите обслуживающий персонал:',
            getPersonnelKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'place'
    ) {
        await ctx.reply(
            '📍 Где проходит мероприятие?',
            getPlaceKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'lift'
    ) {
        await ctx.reply(
            '🛗 Подъем оборудования:',
            getLiftKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'equipment'
    ) {
        equipmentSelection.set(
            chatId,
            new Set()
        );

        await ctx.reply(
            '🔧 Какое оборудование необходимо? (можно выбрать несколько)',
            getEquipmentKeyboard(
                chatId
            )
        );

    } else if (
        keyboardInfo.type ===
        'mount'
    ) {
        await ctx.reply(
            '⏱ Время монтажа:',
            getMountKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'demount'
    ) {
        await ctx.reply(
            '⏱ Время демонтажа:',
            getDemountKeyboard()
        );

    } else if (
        keyboardInfo.type ===
        'calendar'
    ) {
        const now =
            new Date();

        await ctx.reply(
            keyboardInfo.text,

            getCalendar(
                now.getFullYear(),
                now.getMonth(),
                keyboardInfo.prefix
            )
        );
    }
}


function callbackButtonText(
    ctx,
    data
) {
    try {
        const rows =
            ctx.callbackQuery
                ?.message
                ?.reply_markup
                ?.inline_keyboard ||
            [];

        for (
            const row
            of rows
        ) {
            for (
                const button
                of row
            ) {
                if (
                    button.callback_data ===
                    data
                ) {
                    return (
                        button.text ||
                        data
                    );
                }
            }
        }

    } catch (_) {}

    return data;
}


// ============================================================
// TELEGRAM HANDLERS
// ============================================================

function setupTelegramHandlers() {
    if (
        !telegramEnabled
    ) {
        return;
    }

    bot.on(
        'callback_query',
        async ctx => {
            const chatId =
                ctx.chat.id;

            const data =
                ctx.callbackQuery.data;

            try {
                if (
                    data ===
                    'ignore'
                ) {
                    await ctx.answerCbQuery();
                    return;
                }

                // ------------------------------------------------
                // ВРЕМЯ
                // ------------------------------------------------

                if (
                    data.includes(
                        '_hour_'
                    ) ||
                    data.includes(
                        '_min_'
                    ) ||
                    data.endsWith(
                        '_time_done'
                    )
                ) {
                    const parts =
                        data.split('_');

                    const prefix =
                        parts[0] +
                        '_' +
                        parts[1];

                    if (
                        !awaitingDateTime.has(
                            chatId
                        )
                    ) {
                        await ctx.answerCbQuery();
                        return;
                    }

                    const timeData =
                        awaitingDateTime.get(
                            chatId
                        );

                    if (
                        !timeData[prefix]
                    ) {
                        timeData[prefix] = {
                            hour:
                                '00',

                            min:
                                '00'
                        };
                    }

                    if (
                        data.endsWith(
                            '_time_done'
                        )
                    ) {
                        const {
                            hour,
                            min
                        } =
                            timeData[prefix];

                        const dateStr =
                            timeData.dateStr;

                        const fullDate =
                            `${dateStr} ${hour}:${min}`;

                        const labelMap = {
                            date_start:
                                'Дата начала',

                            date_end:
                                'Дата окончания',

                            ready_date:
                                'Готовность оборудования'
                        };

                        awaitingDateTime.delete(
                            chatId
                        );

                        await ctx.editMessageReplyMarkup(
                            undefined
                        );

                        await ctx.reply(
                            `${labelMap[prefix]}: ${fullDate}`
                        );

                        const reply =
                            await askDeepSeek(
                                `${labelMap[prefix]}: ${fullDate}`,
                                `telegram_${chatId}`,
                                ctx.from.first_name
                            );

                        await handleTelegramAIReply(
                            ctx,
                            reply,
                            chatId
                        );

                        await ctx.answerCbQuery();

                        return;
                    }

                    if (
                        data.includes(
                            '_hour_'
                        )
                    ) {
                        timeData[
                            prefix
                        ].hour =
                            parts[
                                parts.length - 1
                            ];
                    }

                    if (
                        data.includes(
                            '_min_'
                        )
                    ) {
                        timeData[
                            prefix
                        ].min =
                            parts[
                                parts.length - 1
                            ];
                    }

                    awaitingDateTime.set(
                        chatId,
                        timeData
                    );

                    await ctx.editMessageText(
                        `Выбрано: ${timeData[prefix].hour}:${timeData[prefix].min}. Нажмите "Подтвердить"`,
                        getTimeKeyboard(
                            prefix
                        )
                    );

                    await ctx.answerCbQuery();

                    return;
                }


                // ------------------------------------------------
                // КАЛЕНДАРИ
                // ------------------------------------------------

                const calendarPrefixes = [
                    'date_start',
                    'date_end',
                    'ready_date'
                ];

                for (
                    const prefix
                    of calendarPrefixes
                ) {
                    if (
                        !data.startsWith(
                            prefix
                        )
                    ) {
                        continue;
                    }

                    const parts =
                        data.split('_');

                    if (
                        parts[2] ===
                            'prev' ||
                        parts[2] ===
                            'next'
                    ) {
                        const year =
                            Number(
                                parts[3]
                            );

                        const month =
                            Number(
                                parts[4]
                            );

                        const newDate =
                            new Date(
                                year,
                                month
                            );

                        newDate.setMonth(
                            newDate.getMonth() +
                            (
                                parts[2] ===
                                'prev'
                                    ? -1
                                    : 1
                            )
                        );

                        await ctx.editMessageText(
                            '📅 Выберите дату:',
                            getCalendar(
                                newDate.getFullYear(),
                                newDate.getMonth(),
                                prefix
                            )
                        );

                    } else if (
                        parts[2] ===
                        'set'
                    ) {
                        const dateStr =
                            parts[3];

                        await ctx.answerCbQuery(
                            `Выбрано: ${dateStr}`
                        );

                        const timeData =
                            awaitingDateTime.get(
                                chatId
                            ) ||
                            {};

                        timeData.dateStr =
                            dateStr;

                        timeData[prefix] = {
                            hour:
                                '00',

                            min:
                                '00'
                        };

                        awaitingDateTime.set(
                            chatId,
                            timeData
                        );

                        const label =
                            prefix ===
                            'date_start'
                                ? 'начала'
                                : prefix ===
                                  'date_end'
                                    ? 'окончания'
                                    : 'готовности';

                        await ctx.editMessageText(
                            `Выберите время для ${label}:`,
                            getTimeKeyboard(
                                prefix
                            )
                        );

                    } else if (
                        parts[2] ===
                        'skip'
                    ) {
                        await ctx.answerCbQuery(
                            'Пропущено'
                        );

                        await ctx.editMessageReplyMarkup(
                            undefined
                        );

                        const skipMsg =
                            prefix ===
                            'date_start'
                                ? 'Дата начала не указана'
                                : prefix ===
                                  'date_end'
                                    ? 'Дата окончания не указана'
                                    : 'Готовность не указана';

                        await ctx.reply(
                            skipMsg
                        );

                        const reply =
                            await askDeepSeek(
                                skipMsg,
                                `telegram_${chatId}`,
                                ctx.from.first_name
                            );

                        await handleTelegramAIReply(
                            ctx,
                            reply,
                            chatId
                        );
                    }

                    return;
                }


                // ------------------------------------------------
                // FORMAT / LEVEL / PERSONNEL / PLACE
                // ------------------------------------------------

                const simplePrefixMap = [
                    [
                        'format_',
                        'Формат'
                    ],

                    [
                        'level_',
                        'Уровень'
                    ],

                    [
                        'personnel_',
                        'Персонал'
                    ],

                    [
                        'place_',
                        'Место'
                    ]
                ];

                for (
                    const [
                        prefix,
                        label
                    ]
                    of simplePrefixMap
                ) {
                    if (
                        data.startsWith(
                            prefix
                        )
                    ) {
                        await ctx.answerCbQuery();

                        await ctx.editMessageReplyMarkup(
                            undefined
                        );

                        const text =
                            `${label}: ${callbackButtonText(ctx, data)}`;

                        await ctx.reply(
                            text
                        );

                        const reply =
                            await askDeepSeek(
                                text,
                                `telegram_${chatId}`,
                                ctx.from.first_name
                            );

                        await handleTelegramAIReply(
                            ctx,
                            reply,
                            chatId
                        );

                        return;
                    }
                }


                // ------------------------------------------------
                // LIFT
                // ------------------------------------------------

                if (
                    data ===
                        'lift_yes' ||
                    data ===
                        'lift_no'
                ) {
                    await ctx.answerCbQuery();

                    await ctx.editMessageReplyMarkup(
                        undefined
                    );

                    const text =
                        data ===
                        'lift_yes'
                            ? 'Подъем: Есть грузовой лифт'
                            : 'Подъем: Нужно носить по лестнице';

                    await ctx.reply(
                        text
                    );

                    const reply =
                        await askDeepSeek(
                            text,
                            `telegram_${chatId}`,
                            ctx.from.first_name
                        );

                    await handleTelegramAIReply(
                        ctx,
                        reply,
                        chatId
                    );

                    return;
                }


                // ------------------------------------------------
                // EQUIPMENT
                // ------------------------------------------------

                if (
                    data.startsWith(
                        'equip_'
                    )
                ) {
                    if (
                        !equipmentSelection.has(
                            chatId
                        )
                    ) {
                        equipmentSelection.set(
                            chatId,
                            new Set()
                        );
                    }

                    const selected =
                        equipmentSelection.get(
                            chatId
                        );

                    const typeNames = {
                        sound:
                            'Звуковое оборудование',

                        led:
                            'Светодиодные экраны',

                        light:
                            'Световое оборудование',

                        stage:
                            'Сценические конструкции',

                        all:
                            'Полный комплекс'
                    };

                    if (
                        data ===
                        'equip_done'
                    ) {
                        const selectedNames =
                            Array.from(
                                selected
                            )
                                .map(
                                    x =>
                                        typeNames[x]
                                )
                                .filter(
                                    Boolean
                                );

                        const text =
                            selectedNames.length
                                ? `Выбрано оборудование: ${selectedNames.join(', ')}`
                                : 'Оборудование не выбрано';

                        await ctx.answerCbQuery(
                            'Готово'
                        );

                        try {
                            await ctx.deleteMessage();
                        } catch (_) {}

                        equipmentSelection.delete(
                            chatId
                        );

                        await ctx.reply(
                            text
                        );

                        const reply =
                            await askDeepSeek(
                                text,
                                `telegram_${chatId}`,
                                ctx.from.first_name
                            );

                        await handleTelegramAIReply(
                            ctx,
                            reply,
                            chatId
                        );

                        return;
                    }

                    if (
                        data ===
                        'equip_all'
                    ) {
                        selected.clear();
                        selected.add(
                            'all'
                        );

                    } else {
                        const typeMap = {
                            equip_sound:
                                'sound',

                            equip_led:
                                'led',

                            equip_light:
                                'light',

                            equip_stage:
                                'stage'
                        };

                        const type =
                            typeMap[data];

                        if (
                            !type
                        ) {
                            return;
                        }

                        if (
                            selected.has(
                                type
                            )
                        ) {
                            selected.delete(
                                type
                            );
                        } else {
                            selected.add(
                                type
                            );
                        }

                        if (
                            selected.has(
                                'all'
                            )
                        ) {
                            selected.delete(
                                'all'
                            );
                        }
                    }

                    await ctx.answerCbQuery(
                        'Обновлено'
                    );

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch (_) {}

                    await ctx.reply(
                        '🔧 Какое оборудование необходимо? (можно выбрать несколько)',
                        getEquipmentKeyboard(
                            chatId
                        )
                    );

                    return;
                }


                // ------------------------------------------------
                // MOUNT / DEMOUNT
                // ------------------------------------------------

                if (
                    data ===
                        'mount_any' ||
                    data ===
                        'demount_any'
                ) {
                    await ctx.answerCbQuery();

                    await ctx.editMessageReplyMarkup(
                        undefined
                    );

                    const text =
                        data ===
                        'mount_any'
                            ? 'Монтаж: Любое по согласованию'
                            : 'Демонтаж: Любое по согласованию';

                    await ctx.reply(
                        text
                    );

                    const reply =
                        await askDeepSeek(
                            text,
                            `telegram_${chatId}`,
                            ctx.from.first_name
                        );

                    await handleTelegramAIReply(
                        ctx,
                        reply,
                        chatId
                    );

                    return;
                }

                if (
                    data ===
                        'mount_night' ||
                    data ===
                        'demount_deadline'
                ) {
                    await ctx.answerCbQuery();

                    await ctx.editMessageReplyMarkup(
                        undefined
                    );

                    const type =
                        data ===
                        'mount_night'
                            ? 'mount'
                            : 'demount';

                    awaitingTime.set(
                        chatId,
                        type
                    );

                    await ctx.reply(
                        data ===
                        'mount_night'
                            ? 'Монтаж: Ночью/рано утром. До какого времени? (например, 06:00)'
                            : 'Демонтаж: До определённого времени. До какого? (например, 18:00)'
                    );

                    return;
                }


                // ------------------------------------------------
                // CONTACT MANAGER
                // ------------------------------------------------

                if (
                    data ===
                    'contact_manager'
                ) {
                    manualMode[chatId] =
                        true;

                    lastActiveClient[
                        ADMIN_CHAT_ID
                    ] =
                        chatId;

                    await ctx.answerCbQuery(
                        'Заявка отправлена!'
                    );

                    await ctx.reply(
                        'Спасибо! Менеджер скоро свяжется с вами.'
                    );

                    await notifyAdmin(
                        `📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || 'нет'}, ID: ${chatId}) запросил менеджера.`
                    );

                    return;
                }


                // ------------------------------------------------
                // SEND TZ
                // ------------------------------------------------

                if (
                    data ===
                    'send_tz'
                ) {
                    await ctx.answerCbQuery();

                    await ctx.editMessageReplyMarkup(
                        undefined
                    );

                    await ctx.reply(
                        'Отлично! Отправьте все файлы (ТЗ, райдеры, схемы), и я передам их в отдел подготовки КП.'
                    );

                    ensureSession(
                        `telegram_${chatId}`,
                        ctx.from.first_name
                    ).push({
                        role:
                            'system',

                        content:
                            'Клиент хочет отправить файлы.'
                    });

                    saveSession(
                        `telegram_${chatId}`
                    );

                    return;
                }


                // ------------------------------------------------
                // START SURVEY
                // ------------------------------------------------

                if (
                    data ===
                    'start_survey'
                ) {
                    await ctx.answerCbQuery();

                    await ctx.editMessageReplyMarkup(
                        undefined
                    );

                    await ctx.reply(
                        'Хорошо, давайте обсудим ваше мероприятие. 🎭 Выберите формат мероприятия:',
                        getFormatKeyboard()
                    );

                    return;
                }


                // ------------------------------------------------
                // ADMIN REPLY BUTTON
                // ------------------------------------------------

                if (
                    data.startsWith(
                        'reply_to_'
                    )
                ) {
                    lastActiveClient[
                        ADMIN_CHAT_ID
                    ] =
                        data.replace(
                            'reply_to_',
                            ''
                        );

                    await ctx.answerCbQuery(
                        'Выбран клиент'
                    );

                    await ctx.reply(
                        `Активный клиент: ${lastActiveClient[ADMIN_CHAT_ID]}. Используйте /reply текст.`
                    );
                }

            } catch (error) {
                console.error(
                    '❌ Telegram callback error:',
                    error.stack ||
                    error.message
                );

                try {
                    await ctx.answerCbQuery(
                        'Произошла ошибка'
                    );
                } catch (_) {}
            }
        }
    );


    // ========================================================
    // TELEGRAM TEXT
    // ========================================================

    bot.on(
        'text',
        async (
            ctx,
            next
        ) => {
            const chatId =
                ctx.chat.id;

            const userMessage =
                ctx.message.text;

            const user =
                ctx.from;

            if (
                String(user.id) ===
                String(ADMIN_CHAT_ID)
            ) {
                return next();
            }

            lastActiveClient[
                ADMIN_CHAT_ID
            ] =
                user.id;

            await notifyAdmin(
                `📩 Сообщение от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id}):\n\n${userMessage}`
            );

            if (
                manualMode[chatId]
            ) {
                return;
            }

            const timeAwaiting =
                awaitingTime.get(
                    chatId
                );

            if (
                timeAwaiting
            ) {
                awaitingTime.delete(
                    chatId
                );

                const fullMessage =
                    timeAwaiting ===
                    'mount'
                        ? `Монтаж: Ночью/рано утром, точное время: ${userMessage}`
                        : `Демонтаж: До определённого времени, точное время: ${userMessage}`;

                try {
                    await ctx.sendChatAction(
                        'typing'
                    );

                    const reply =
                        await askDeepSeek(
                            fullMessage,
                            `telegram_${chatId}`,
                            user.first_name
                        );

                    await handleTelegramAIReply(
                        ctx,
                        reply,
                        chatId
                    );

                } catch (error) {
                    console.error(
                        '❌ Telegram DeepSeek error:',
                        error.message
                    );

                    await ctx.reply(
                        'Извините, произошла техническая ошибка.'
                    );
                }

                return;
            }

            const lower =
                userMessage.toLowerCase();

            const addPortfolio =
                PORTFOLIO_KEYWORDS.some(
                    keyword =>
                        lower.includes(
                            keyword
                        )
                );

            try {
                await ctx.sendChatAction(
                    'typing'
                );

                const reply =
                    await askDeepSeek(
                        userMessage,
                        `telegram_${chatId}`,
                        user.first_name,
                        addPortfolio
                    );

                await handleTelegramAIReply(
                    ctx,
                    reply,
                    chatId
                );

            } catch (error) {
                console.error(
                    '❌ Telegram DeepSeek error:',
                    error.stack ||
                    error.message
                );

                await ctx.reply(
                    'Извините, произошла техническая ошибка.'
                );
            }
        }
    );


    // ========================================================
    // /START
    // ========================================================

    bot.start(
        async ctx => {
            const chatId =
                ctx.chat.id;

            await ctx.reply(
                'Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».\n\n' +
                'Если у вас есть готовые файлы с полной информацией по мероприятию (ТЗ, райдеры, даты, любые другие файлы), вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.\n\n' +
                'Или мы можем обсудить ваше мероприятие, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.\n\n' +
                'С чего начнём?',

                Markup.inlineKeyboard([
                    [
                        Markup.button.callback(
                            '📎 Отправить файлы',
                            'send_tz'
                        )
                    ],

                    [
                        Markup.button.callback(
                            '💬 Продолжить диалог',
                            'start_survey'
                        )
                    ]
                ])
            );

            ensureSession(
                `telegram_${chatId}`,
                ctx.from.first_name
            );
        }
    );


    // ========================================================
    // ADMIN /reply
    // ========================================================

    bot.command(
        'reply',
        async ctx => {
            if (
                String(ctx.from.id) !==
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const targetId =
                lastActiveClient[
                    ADMIN_CHAT_ID
                ];

            if (
                !targetId
            ) {
                return ctx.reply(
                    'Нет активного клиента.'
                );
            }

            const text =
                ctx.message.text
                    .split(' ')
                    .slice(1)
                    .join(' ')
                    .trim();

            if (
                !text
            ) {
                return ctx.reply(
                    'Напишите текст после /reply'
                );
            }

            try {
                await bot.telegram.sendMessage(
                    targetId,
                    text
                );

                await ctx.reply(
                    '✅ Отправлено'
                );

            } catch (error) {
                await ctx.reply(
                    `❌ Ошибка отправки: ${error.message}`
                );
            }
        }
    );


    // ========================================================
    // ADMIN /resume
    // ========================================================

    bot.command(
        'resume',
        async ctx => {
            if (
                String(ctx.from.id) !==
                String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            Object.keys(
                manualMode
            ).forEach(
                key =>
                    delete manualMode[key]
            );

            await ctx.reply(
                'Автоответы возобновлены.'
            );
        }
    );


    // ========================================================
    // /portfolio
    // ========================================================

    bot.command(
        'portfolio',
        async ctx => {
            await ctx.reply(
                PORTFOLIO_TEXT ||
                'Портфолио временно недоступно.'
            );
        }
    );


    // ========================================================
    // DOCUMENTS
    // ========================================================

    bot.on(
        'document',
        async ctx => {
            const user =
                ctx.from;

            const doc =
                ctx.message.document;

            const session =
                ensureSession(
                    `telegram_${ctx.chat.id}`,
                    user.first_name
                );

            const requestedFiles =
                session.some(
                    m =>
                        m.content ===
                        'Клиент хочет отправить файлы.'
                );

            await ctx.reply(
                requestedFiles
                    ? 'Спасибо! Файлы получены, я передаю их в отдел подготовки КП.'
                    : 'Спасибо! Я передал ваш файл менеджеру.'
            );

            if (
                !ADMIN_CHAT_ID
            ) {
                return;
            }

            try {
                await ctx.telegram.sendDocument(
                    ADMIN_CHAT_ID,
                    doc.file_id,
                    {
                        caption:
                            `📎 Документ от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})\nИмя файла: ${doc.file_name || 'неизвестно'}`
                    }
                );

            } catch (error) {
                console.error(
                    '❌ Telegram document forwarding error:',
                    error.message
                );
            }

            if (
                requestedFiles
            ) {
                sessions[
                    `telegram_${ctx.chat.id}`
                ] =
                    session.filter(
                        m =>
                            m.content !==
                            'Клиент хочет отправить файлы.'
                    );

                saveSession(
                    `telegram_${ctx.chat.id}`
                );
            }
        }
    );


    // ========================================================
    // PHOTOS
    // ========================================================

    bot.on(
        'photo',
        async ctx => {
            const user =
                ctx.from;

            const photos =
                ctx.message.photo;

            if (
                !photos?.length
            ) {
                return;
            }

            await ctx.reply(
                'Спасибо! Я передал ваше фото менеджеру.'
            );

            if (
                !ADMIN_CHAT_ID
            ) {
                return;
            }

            try {
                await ctx.telegram.sendPhoto(
                    ADMIN_CHAT_ID,
                    photos[
                        photos.length - 1
                    ].file_id,
                    {
                        caption:
                            `📷 Фото от ${user.first_name} (@${user.username || 'нет'}, ID: ${user.id})`
                    }
                );

            } catch (error) {
                console.error(
                    '❌ Telegram photo forwarding error:',
                    error.message
                );
            }
        }
    );
}


// ============================================================
// TELEGRAM START
// ============================================================

async function startTelegram() {
    if (
        !telegramEnabled
    ) {
        console.log(
            '⚠️ Telegram отключён: BOT_TOKEN/TELEGRAM_BOT_TOKEN отсутствует.'
        );

        return;
    }

    setupTelegramHandlers();

    loadSessions();

    while (
        !stopping &&
        !telegramStarted
    ) {
        try {
            await bot.launch();

            telegramStarted =
                true;

            console.log(
                '✅ Telegram polling STARTED'
            );

            await notifyAdmin(
                '✅ Бот MLK запущен и работает'
            );

        } catch (error) {
            console.error(
                '❌ Telegram launch error:',
                error.message
            );

            if (
                stopping
            ) {
                return;
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        5000
                    )
            );
        }
    }
}


// ============================================================
// HTTP SERVER
// ============================================================

const server =
    http.createServer(
        (
            req,
            res
        ) => {

            if (
                req.method ===
                    'GET' &&
                req.url === '/'
            ) {
                res.writeHead(
                    200,
                    {
                        'Content-Type':
                            'text/plain; charset=utf-8'
                    }
                );

                res.end(
                    'MLK AI Consultant is running'
                );

                return;
            }

            if (
                req.method ===
                    'GET' &&
                req.url ===
                    '/health'
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
                            ok:
                                true,

                            telegram:
                                telegramEnabled,

                            telegramStarted:
                                telegramStarted,

                            bitrix:
                                bitrixEnabled,

                            bitrixBotId:
                                bitrixEnabled
                                    ? BITRIX_BOT_ID
                                    : null,

                            bitrixPolling:
                                bitrixPolling,

                            bitrixOffset:
                                bitrixOffset,

                            deepseek:
                                Boolean(
                                    DEEPSEEK_API_KEY
                                ),

                            sessions:
                                Object.keys(
                                    sessions
                                ).length,

                            time:
                                new Date().toISOString()
                        },
                        null,
                        2
                    )
                );

                return;
            }

            res.writeHead(
                404,
                {
                    'Content-Type':
                        'text/plain; charset=utf-8'
                }
            );

            res.end(
                'Not Found'
            );
        }
    );


// ============================================================
// START
// ============================================================

async function start() {
    loadSessions();

    loadBitrixOffset();

    server.listen(
        PORT,
        '0.0.0.0',
        async () => {

            console.log('');

            console.log(
                '========================================'
            );

            console.log(
                '🚀 SERVER STARTED'
            );

            console.log(
                '========================================'
            );

            console.log(
                'PORT:',
                PORT
            );

            console.log(
                'TELEGRAM:',
                telegramEnabled
                    ? 'ENABLED'
                    : 'DISABLED'
            );

            console.log(
                'BITRIX:',
                bitrixEnabled
                    ? 'ENABLED'
                    : 'DISABLED'
            );

            console.log(
                'DEEPSEEK:',
                DEEPSEEK_MODEL
            );

            console.log(
                '========================================'
            );


            // ------------------------------------------------
            // BITRIX
            // ------------------------------------------------

            if (
                bitrixEnabled
            ) {
                try {
                    await checkBitrixBot();

                    startBitrixPolling();

                } catch (error) {
                    console.error(
                        '❌ Bitrix startup check failed:',
                        error.stack ||
                        error.message
                    );

                    // Telegram не зависит от Bitrix.
                    setTimeout(
                        startBitrixPolling,
                        5000
                    );
                }
            }


            // ------------------------------------------------
            // TELEGRAM
            // ------------------------------------------------

            startTelegram()
                .catch(
                    error => {
                        console.error(
                            '❌ Telegram startup fatal error:',
                            error.stack ||
                            error.message
                        );
                    }
                );
        }
    );
}


// ============================================================
// PROCESS ERRORS
// ============================================================

process.on(
    'unhandledRejection',
    reason => {
        console.error(
            '❌ UNHANDLED REJECTION:',
            reason?.stack ||
            reason
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            '❌ UNCAUGHT EXCEPTION:',
            error.stack ||
            error.message
        );
    }
);


// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(
    signal
) {
    if (
        stopping
    ) {
        return;
    }

    stopping =
        true;

    console.log(
        `🛑 ${signal} — завершаем работу...`
    );

    if (
        bitrixInterval
    ) {
        clearInterval(
            bitrixInterval
        );
    }

    if (
        telegramStarted &&
        bot
    ) {
        try {
            bot.stop(
                signal
            );
        } catch (_) {}
    }

    server.close(
        () => {
            console.log(
                '✅ Server closed.'
            );

            process.exit(0);
        }
    );

    setTimeout(
        () =>
            process.exit(0),
        5000
    ).unref();
}


process.once(
    'SIGTERM',
    () =>
        shutdown(
            'SIGTERM'
        )
);

process.once(
    'SIGINT',
    () =>
        shutdown(
            'SIGINT'
        )
);


// ============================================================
// RUN
// ============================================================

start()
    .catch(
        error => {
            console.error(
                '❌ FATAL START ERROR:',
                error.stack ||
                error.message
            );

            process.exit(1);
        }
    );
```
