```javascript
require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");

// ============================================================
// MLK AI BOT
//
// TELEGRAM + BITRIX24 FETCH + DEEPSEEK
//
// Telegram:
//   Telegram -> Render -> DeepSeek -> Telegram
//
// Bitrix:
//   Bitrix24 -> Event.get -> Render -> DeepSeek
//           -> Chat.Message.send -> Bitrix24
//
// ВАЖНО:
// - Секреты НИКОГДА не печатаются в лог.
// - Поддерживаются BOT_TOKEN и TELEGRAM_BOT_TOKEN.
// - BITRIX_WEBHOOK_URL используется только внутри приложения.
// ============================================================


// ============================================================
// ENV
// ============================================================

const TELEGRAM_BOT_TOKEN = (
    process.env.BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ""
).trim();

const DEEPSEEK_API_KEY = (
    process.env.DEEPSEEK_API_KEY ||
    ""
).trim();

const ADMIN_CHAT_ID = (
    process.env.ADMIN_CHAT_ID ||
    ""
).trim();

const BITRIX_WEBHOOK_URL = (
    process.env.BITRIX_WEBHOOK_URL ||
    ""
).trim();

const BITRIX_BOT_TOKEN = (
    process.env.BITRIX_BOT_TOKEN ||
    ""
).trim();

const BITRIX_BOT_ID = Number(
    process.env.BITRIX_BOT_ID || 1787
);

const BITRIX_BOT_CODE = (
    process.env.BITRIX_BOT_CODE ||
    "mlk_ai_consultant_v2"
).trim();

const PORT = Number(
    process.env.PORT || 10000
);


// ============================================================
// SETTINGS
// ============================================================

const BITRIX_POLL_INTERVAL_MS = 3000;
const BITRIX_EVENT_LIMIT = 50;

const SESSION_TTL =
    90 * 24 * 60 * 60 * 1000;

const MAX_HISTORY_MESSAGES = 30;


// ============================================================
// FILES
// ============================================================

const SESSIONS_DIR =
    path.join(__dirname, "sessions");

const DATA_DIR =
    path.join(__dirname, "data");

const OFFSET_FILE =
    path.join(DATA_DIR, "bitrix-offset.json");

const PROMPT_FILE =
    path.join(__dirname, "promt.txt");

const PORTFOLIO_FILE =
    path.join(__dirname, "portfolio.txt");


// ============================================================
// DIRECTORIES
// ============================================================

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}


// ============================================================
// STARTUP LOG
// ============================================================

console.log("");
console.log("========================================");
console.log("MLK AI BOT");
console.log("TELEGRAM + BITRIX24 FETCH + DEEPSEEK");
console.log("========================================");

console.log(
    "TELEGRAM_BOT_TOKEN:",
    TELEGRAM_BOT_TOKEN ? "OK" : "MISSING"
);

console.log(
    "DEEPSEEK_API_KEY:",
    DEEPSEEK_API_KEY ? "OK" : "MISSING"
);

console.log(
    "ADMIN_CHAT_ID:",
    ADMIN_CHAT_ID ? "OK" : "MISSING"
);

console.log(
    "BITRIX_WEBHOOK_URL:",
    BITRIX_WEBHOOK_URL ? "OK" : "MISSING"
);

console.log(
    "BITRIX_BOT_TOKEN:",
    BITRIX_BOT_TOKEN ? "OK" : "MISSING"
);

console.log(
    "BITRIX_BOT_ID:",
    BITRIX_BOT_ID
);

console.log(
    "BITRIX_BOT_CODE:",
    BITRIX_BOT_CODE
);

console.log(
    "PORT:",
    PORT
);

console.log(
    "BITRIX_POLL_INTERVAL_MS:",
    BITRIX_POLL_INTERVAL_MS
);

console.log("========================================");


// ============================================================
// VALIDATION
// ============================================================

if (!DEEPSEEK_API_KEY) {
    console.error(
        "❌ DEEPSEEK_API_KEY не задан."
    );
    process.exit(1);
}

if (
    !TELEGRAM_BOT_TOKEN &&
    !(
        BITRIX_WEBHOOK_URL &&
        BITRIX_BOT_TOKEN
    )
) {
    console.error(
        "❌ Не настроен ни Telegram, ни Bitrix."
    );
    console.error(
        "Нужен BOT_TOKEN/TELEGRAM_BOT_TOKEN или BITRIX_WEBHOOK_URL + BITRIX_BOT_TOKEN."
    );
    process.exit(1);
}


// ============================================================
// PROMPT
// ============================================================

let SYSTEM_PROMPT = "";

try {
    SYSTEM_PROMPT = fs.readFileSync(
        PROMPT_FILE,
        "utf8"
    );

    console.log(
        "✅ promt.txt загружен:",
        SYSTEM_PROMPT.length,
        "символов"
    );
} catch (error) {
    console.error(
        "❌ Не удалось загрузить promt.txt:",
        error.message
    );

    process.exit(1);
}


// ============================================================
// PORTFOLIO
// ============================================================

let PORTFOLIO_TEXT = "";

if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
        PORTFOLIO_TEXT = fs.readFileSync(
            PORTFOLIO_FILE,
            "utf8"
        );

        console.log(
            "✅ portfolio.txt загружен:",
            PORTFOLIO_TEXT.length,
            "символов"
        );
    } catch (error) {
        console.error(
            "⚠️ Ошибка загрузки portfolio.txt:",
            error.message
        );
    }
} else {
    console.log(
        "ℹ️ portfolio.txt отсутствует."
    );
}


// ============================================================
// PORTFOLIO KEYWORDS
// ============================================================

const PORTFOLIO_KEYWORDS = [
    "опыт",
    "портфолио",
    "делали ли вы",
    "пример",
    "кейс",
    "проект",
    "объект",
    "работали",
    "участвовали",
    "проводили"
];


// ============================================================
// TELEGRAM
// ============================================================

let telegramBot = null;

if (TELEGRAM_BOT_TOKEN) {
    telegramBot = new Telegraf(
        TELEGRAM_BOT_TOKEN
    );

    console.log(
        "✅ Telegram transport включён."
    );
} else {
    console.log(
        "⚠️ Telegram transport отключён: токен отсутствует."
    );
}


// ============================================================
// SESSIONS
// ============================================================

const sessions = {};

const manualMode = {};

const lastActiveClient = {};

const equipmentSelection = new Map();

const awaitingTime = new Map();

const awaitingDateTime = new Map();


// ============================================================
// LOAD SESSIONS
// ============================================================

function loadSessions() {
    console.log("");
    console.log(
        "📂 Загрузка Telegram/AI сессий..."
    );

    const now = Date.now();

    let loaded = 0;
    let deleted = 0;

    let files = [];

    try {
        files = fs.readdirSync(
            SESSIONS_DIR
        );
    } catch (error) {
        console.error(
            "Ошибка чтения sessions:",
            error.message
        );

        return;
    }

    for (const file of files) {
        if (!file.endsWith(".json")) {
            continue;
        }

        const filePath =
            path.join(
                SESSIONS_DIR,
                file
            );

        try {
            const stats =
                fs.statSync(filePath);

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
                        "utf8"
                    )
                );

            if (
                Array.isArray(data)
            ) {
                const key =
                    path.basename(
                        file,
                        ".json"
                    );

                sessions[key] = data;

                loaded++;
            }
        } catch (error) {
            console.error(
                `Ошибка чтения ${file}:`,
                error.message
            );
        }
    }

    console.log(
        "Сессий загружено:",
        loaded
    );

    console.log(
        "Старых сессий удалено:",
        deleted
    );
}


// ============================================================
// SAVE SESSION
// ============================================================

function saveSession(key) {
    if (!sessions[key]) {
        return;
    }

    const filePath =
        path.join(
            SESSIONS_DIR,
            `${key}.json`
        );

    try {
        fs.writeFileSync(
            filePath,
            JSON.stringify(
                sessions[key],
                null,
                2
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "❌ Ошибка сохранения сессии:",
            error.message
        );
    }
}


// ============================================================
// ENSURE SESSION
// ============================================================

function ensureSession(
    key,
    userFirstName
) {
    key = String(key);

    if (sessions[key]) {
        return sessions[key];
    }

    const filePath =
        path.join(
            SESSIONS_DIR,
            `${key}.json`
        );

    if (
        fs.existsSync(filePath)
    ) {
        try {
            const data =
                JSON.parse(
                    fs.readFileSync(
                        filePath,
                        "utf8"
                    )
                );

            if (
                Array.isArray(data)
            ) {
                sessions[key] = data;

                return sessions[key];
            }
        } catch (error) {
            console.error(
                "⚠️ Ошибка существующей сессии:",
                error.message
            );
        }
    }

    sessions[key] = [
        {
            role: "system",
            content: SYSTEM_PROMPT
        },
        {
            role: "system",
            content:
                `Имя клиента: ${
                    userFirstName ||
                    "неизвестно"
                }`
        }
    ];

    saveSession(key);

    return sessions[key];
}


// ============================================================
// DEEPSEEK
// ============================================================

async function askDeepSeek(
    userMessage,
    sessionKey,
    userFirstName,
    addPortfolio = false
) {
    const key =
        String(sessionKey);

    const messages =
        ensureSession(
            key,
            userFirstName
        );

    let messageForAI =
        String(userMessage || "");

    if (
        addPortfolio &&
        PORTFOLIO_TEXT
    ) {
        messageForAI =
            "Отвечай на вопрос клиента, используя ТОЛЬКО информацию из списка проектов ниже. " +
            "Не выдумывай проекты, которых нет в списке.\n\n" +
            "СПИСОК ПРОЕКТОВ:\n" +
            PORTFOLIO_TEXT +
            "\n\nВОПРОС КЛИЕНТА:\n" +
            userMessage;
    }

    messages.push({
        role: "user",
        content: messageForAI
    });

    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "🧠 DEEPSEEK"
    );
    console.log(
        "SESSION:",
        key
    );
    console.log(
        "USER:",
        String(userMessage).slice(0, 500)
    );
    console.log(
        "========================================"
    );

    try {
        const response =
            await fetch(
                "https://api.deepseek.com/v1/chat/completions",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${DEEPSEEK_API_KEY}`
                    },

                    body:
                        JSON.stringify({
                            model:
                                "deepseek-chat",

                            messages,

                            temperature:
                                0.7
                        })
                }
            );

        const raw =
            await response.text();

        let data;

        try {
            data =
                JSON.parse(raw);
        } catch {
            throw new Error(
                "DeepSeek вернул не JSON: " +
                raw.slice(0, 1000)
            );
        }

        if (
            !response.ok ||
            data.error
        ) {
            const message =
                data?.error?.message ||
                JSON.stringify(
                    data?.error ||
                    data
                );

            throw new Error(
                `DeepSeek HTTP ${response.status}: ${message}`
            );
        }

        if (
            !data.choices ||
            !data.choices[0] ||
            !data.choices[0].message
        ) {
            throw new Error(
                "DeepSeek не вернул сообщение."
            );
        }

        const reply =
            String(
                data.choices[0].message.content ||
                ""
            ).trim();

        if (!reply) {
            throw new Error(
                "DeepSeek вернул пустой ответ."
            );
        }

        messages[
            messages.length - 1
        ] = {
            role: "user",
            content: String(
                userMessage
            )
        };

        messages.push({
            role: "assistant",
            content: reply
        });

        if (
            messages.length >
            MAX_HISTORY_MESSAGES + 2
        ) {
            const systemMessages =
                messages.filter(
                    item =>
                        item.role ===
                        "system"
                );

            const conversationMessages =
                messages.filter(
                    item =>
                        item.role !==
                        "system"
                );

            sessions[key] = [
                ...systemMessages,
                ...conversationMessages.slice(
                    -MAX_HISTORY_MESSAGES
                )
            ];
        }

        saveSession(key);

        console.log(
            "✅ DeepSeek ответ получен."
        );

        console.log(
            "ANSWER:",
            reply.slice(0, 1000)
        );

        return reply;
    } catch (error) {
        // Если DeepSeek упал, не оставляем
        // технический prompt в истории.
        if (
            messages.length &&
            messages[messages.length - 1]
                .role === "user"
        ) {
            messages.pop();
        }

        saveSession(key);

        throw error;
    }
}


// ============================================================
// TELEGRAM ADMIN NOTIFICATION
// ============================================================

async function notifyAdmin(
    text,
    extra = {}
) {
    if (
        !telegramBot ||
        !ADMIN_CHAT_ID
    ) {
        return;
    }

    try {
        await telegramBot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            text,
            extra
        );
    } catch (error) {
        console.error(
            "❌ Telegram admin notification:",
            error.message
        );
    }
}


// ============================================================
// TELEGRAM KEYBOARDS
// ============================================================

function getFormatKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Концерты & Фестивали",
                "format_concerts"
            )
        ],
        [
            Markup.button.callback(
                "Конференции & Презентации & TV-проекты",
                "format_conferences"
            )
        ],
        [
            Markup.button.callback(
                "Корпоративы & Торжества",
                "format_corporate"
            )
        ],
        [
            Markup.button.callback(
                "Выставки",
                "format_exhibitions"
            )
        ],
        [
            Markup.button.callback(
                "Спортивные мероприятия",
                "format_sports"
            )
        ]
    ]);
}


function getLevelKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Стандартный (обычные требования)",
                "level_standard"
            )
        ],
        [
            Markup.button.callback(
                "Высокие требования (ТВ-трансляции)",
                "level_high"
            )
        ],
        [
            Markup.button.callback(
                "Высший уровень (высшие лица, международные)",
                "level_top"
            )
        ]
    ]);
}


function getPersonnelKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Управление оборудованием",
                "personnel_manage"
            )
        ],
        [
            Markup.button.callback(
                "Дежурный техник",
                "personnel_duty"
            )
        ],
        [
            Markup.button.callback(
                "Только монтаж-демонтаж",
                "personnel_mount"
            )
        ],
        [
            Markup.button.callback(
                "Другое",
                "personnel_other"
            )
        ]
    ]);
}


function getPlaceKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Улица",
                "place_outdoor"
            )
        ],
        [
            Markup.button.callback(
                "Помещение",
                "place_indoor"
            )
        ],
        [
            Markup.button.callback(
                "Под навесом",
                "place_tent"
            )
        ]
    ]);
}


function getLiftKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Есть грузовой лифт",
                "lift_yes"
            )
        ],
        [
            Markup.button.callback(
                "Нужно носить по лестнице",
                "lift_no"
            )
        ]
    ]);
}


function getMountKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Любое по согласованию",
                "mount_any"
            )
        ],
        [
            Markup.button.callback(
                "Ночью/рано утром",
                "mount_night"
            )
        ]
    ]);
}


function getDemountKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "Любое по согласованию",
                "demount_any"
            )
        ],
        [
            Markup.button.callback(
                "До определённого времени",
                "demount_deadline"
            )
        ]
    ]);
}


function getEquipmentKeyboard(
    chatId
) {
    const selected =
        equipmentSelection.get(
            chatId
        ) || new Set();

    const mark =
        type =>
            selected.has(type)
                ? "✅ "
                : "";

    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                mark("sound") +
                "Звуковое оборудование",
                "equip_sound"
            )
        ],
        [
            Markup.button.callback(
                mark("led") +
                "Светодиодные экраны",
                "equip_led"
            )
        ],
        [
            Markup.button.callback(
                mark("light") +
                "Световое оборудование",
                "equip_light"
            )
        ],
        [
            Markup.button.callback(
                mark("stage") +
                "Сценические конструкции",
                "equip_stage"
            )
        ],
        [
            Markup.button.callback(
                mark("all") +
                "Полный комплекс",
                "equip_all"
            )
        ],
        [
            Markup.button.callback(
                "Готово (продолжить)",
                "equip_done"
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
        "Январь",
        "Февраль",
        "Март",
        "Апрель",
        "Май",
        "Июнь",
        "Июль",
        "Август",
        "Сентябрь",
        "Октябрь",
        "Ноябрь",
        "Декабрь"
    ];

    const buttons = [];

    buttons.push([
        Markup.button.callback(
            "◀️",
            `${prefix}_prev_${year}_${month}`
        ),

        Markup.button.callback(
            `${monthNames[month]} ${year}`,
            "ignore"
        ),

        Markup.button.callback(
            "▶️",
            `${prefix}_next_${year}_${month}`
        )
    ]);

    buttons.push(
        [
            "Пн",
            "Вт",
            "Ср",
            "Чт",
            "Пт",
            "Сб",
            "Вс"
        ].map(
            day =>
                Markup.button.callback(
                    day,
                    "ignore"
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
                " ",
                "ignore"
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
            ).padStart(2, "0")}-${String(
                day
            ).padStart(2, "0")}`;

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
        row.length > 0
    ) {
        while (
            row.length < 7
        ) {
            row.push(
                Markup.button.callback(
                    " ",
                    "ignore"
                )
            );
        }

        buttons.push(row);
    }

    buttons.push([
        Markup.button.callback(
            "Пропустить",
            `${prefix}_skip`
        )
    ]);

    return Markup.inlineKeyboard(
        buttons
    );
}


function getTimeKeyboard(
    prefix
) {
    const hours =
        Array.from(
            {
                length: 24
            },
            (_, i) =>
                String(i).padStart(
                    2,
                    "0"
                )
        );

    const minutes = [
        "00",
        "15",
        "30",
        "45"
    ];

    const buttons = [];

    for (
        let i = 0;
        i < hours.length;
        i += 6
    ) {
        buttons.push(
            hours
                .slice(
                    i,
                    i + 6
                )
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
            "Подтвердить",
            `${prefix}_time_done`
        )
    ]);

    return Markup.inlineKeyboard(
        buttons
    );
}


// ============================================================
// TELEGRAM AI REPLY
// ============================================================

async function handleTelegramAIReply(
    ctx,
    text,
    chatId
) {
    const tagRegex =
        /\[(ask_\w+)\]/;

    const match =
        text.match(tagRegex);

    let finalText =
        text;

    let keyboardInfo =
        null;

    if (match) {
        const tagName =
            match[1];

        finalText =
            text
                .replace(
                    match[0],
                    ""
                )
                .trim();

        const tagToKeyboard = {
            ask_format: {
                type: "format"
            },

            ask_level: {
                type: "level"
            },

            ask_personnel: {
                type: "personnel"
            },

            ask_place: {
                type: "place"
            },

            ask_lift: {
                type: "lift"
            },

            ask_equipment: {
                type: "equipment"
            },

            ask_mount: {
                type: "mount"
            },

            ask_demount: {
                type: "demount"
            },

            ask_date_start: {
                type: "calendar",
                prefix: "date_start",
                text:
                    "📅 Выберите дату начала:"
            },

            ask_date_end: {
                type: "calendar",
                prefix: "date_end",
                text:
                    "📅 Выберите дату окончания:"
            },

            ask_ready_date: {
                type: "calendar",
                prefix: "ready_date",
                text:
                    "📅 Готовность оборудования:"
            }
        };

        keyboardInfo =
            tagToKeyboard[
                tagName
            ];
    } else {
        const lowerText =
            text.toLowerCase();

        if (
            lowerText.includes(
                "формат"
            ) &&
            (
                lowerText.includes(
                    "выберите"
                ) ||
                lowerText.includes(
                    "какой"
                )
            )
        ) {
            keyboardInfo = {
                type: "format"
            };
        } else if (
            lowerText.includes(
                "уровень"
            ) &&
            lowerText.includes(
                "мероприятия"
            )
        ) {
            keyboardInfo = {
                type: "level"
            };
        } else if (
            lowerText.includes(
                "персонал"
            )
        ) {
            keyboardInfo = {
                type: "personnel"
            };
        } else if (
            lowerText.includes(
                "место"
            ) &&
            lowerText.includes(
                "проходит"
            )
        ) {
            keyboardInfo = {
                type: "place"
            };
        } else if (
            lowerText.includes(
                "лифт"
            ) ||
            lowerText.includes(
                "подъем"
            )
        ) {
            keyboardInfo = {
                type: "lift"
            };
        } else if (
            lowerText.includes(
                "оборудование"
            ) &&
            (
                lowerText.includes(
                    "выберите"
                ) ||
                lowerText.includes(
                    "какое"
                )
            )
        ) {
            keyboardInfo = {
                type: "equipment"
            };
        } else if (
            lowerText.includes(
                "монтаж"
            ) &&
            !lowerText.includes(
                "демонтаж"
            )
        ) {
            keyboardInfo = {
                type: "mount"
            };
        } else if (
            lowerText.includes(
                "демонтаж"
            )
        ) {
            keyboardInfo = {
                type: "demount"
            };
        }
    }

    if (
        finalText.length > 0
    ) {
        await ctx.reply(
            finalText
        );
    }

    if (!keyboardInfo) {
        return;
    }

    if (
        keyboardInfo.type ===
        "format"
    ) {
        await ctx.reply(
            "🎭 Выберите формат мероприятия:",
            getFormatKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "level"
    ) {
        await ctx.reply(
            "📊 Укажите уровень мероприятия:",
            getLevelKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "personnel"
    ) {
        await ctx.reply(
            "👷 Выберите обслуживающий персонал:",
            getPersonnelKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "place"
    ) {
        await ctx.reply(
            "📍 Где проходит мероприятие?",
            getPlaceKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "lift"
    ) {
        await ctx.reply(
            "🛗 Подъем оборудования:",
            getLiftKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "equipment"
    ) {
        equipmentSelection.set(
            chatId,
            new Set()
        );

        await ctx.reply(
            "🔧 Какое оборудование необходимо? (можно выбрать несколько)",
            getEquipmentKeyboard(
                chatId
            )
        );
    } else if (
        keyboardInfo.type ===
        "mount"
    ) {
        await ctx.reply(
            "⏱ Время монтажа:",
            getMountKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "demount"
    ) {
        await ctx.reply(
            "⏱ Время демонтажа:",
            getDemountKeyboard()
        );
    } else if (
        keyboardInfo.type ===
        "calendar"
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


// ============================================================
// TELEGRAM CALLBACKS
// ============================================================

function getButtonText(
    ctx,
    callbackData
) {
    try {
        const keyboard =
            ctx.callbackQuery
                ?.message
                ?.reply_markup
                ?.inline_keyboard;

        if (!keyboard) {
            return callbackData;
        }

        for (
            const row of keyboard
        ) {
            for (
                const button of row
            ) {
                if (
                    button.callback_data ===
                    callbackData
                ) {
                    return button.text;
                }
            }
        }
    } catch (error) {
        console.error(
            "Ошибка получения текста кнопки:",
            error.message
        );
    }

    return callbackData;
}


if (telegramBot) {
    telegramBot.on(
        "callback_query",
        async ctx => {
            try {
                const chatId =
                    ctx.chat.id;

                const data =
                    ctx.callbackQuery.data;

                if (
                    data ===
                    "ignore"
                ) {
                    await ctx.answerCbQuery();

                    return;
                }

                // --------------------------------------------
                // TIME
                // --------------------------------------------

                if (
                    data.includes(
                        "_hour_"
                    ) ||
                    data.includes(
                        "_min_"
                    ) ||
                    data.endsWith(
                        "_time_done"
                    )
                ) {
                    const parts =
                        data.split("_");

                    const prefix =
                        parts[0] +
                        "_" +
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
                            hour: "00",
                            min: "00"
                        };
                    }

                    if (
                        data.endsWith(
                            "_time_done"
                        )
                    ) {
                        awaitingDateTime.delete(
                            chatId
                        );

                        const {
                            hour,
                            min
                        } =
                            timeData[
                                prefix
                            ];

                        const dateStr =
                            timeData.dateStr;

                        const fullDate =
                            `${dateStr} ${hour}:${min}`;

                        const labelMap = {
                            date_start:
                                "Дата начала",

                            date_end:
                                "Дата окончания",

                            ready_date:
                                "Готовность оборудования"
                        };

                        const label =
                            labelMap[
                                prefix
                            ] ||
                            prefix;

                        try {
                            await ctx.editMessageReplyMarkup(
                                undefined
                            );
                        } catch {}

                        await ctx.reply(
                            `${label}: ${fullDate}`
                        );

                        const user =
                            ctx.from;

                        const reply =
                            await askDeepSeek(
                                `${label}: ${fullDate}`,
                                `tg_${chatId}`,
                                user.first_name
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
                            "_hour_"
                        )
                    ) {
                        timeData[
                            prefix
                        ].hour =
                            parts[
                                parts.length - 1
                            ];
                    } else {
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

                    const {
                        hour,
                        min
                    } =
                        timeData[
                            prefix
                        ];

                    await ctx.editMessageText(
                        `Выбрано: ${hour}:${min}. Нажмите "Подтвердить"`,
                        getTimeKeyboard(
                            prefix
                        )
                    );

                    await ctx.answerCbQuery();

                    return;
                }


                // --------------------------------------------
                // CALENDAR
                // --------------------------------------------

                const calendarPrefixes = [
                    "date_start",
                    "date_end",
                    "ready_date"
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
                        data.split("_");

                    if (
                        parts[2] ===
                            "prev" ||
                        parts[2] ===
                            "next"
                    ) {
                        const year =
                            parseInt(
                                parts[3]
                            );

                        const month =
                            parseInt(
                                parts[4]
                            );

                        const newDate =
                            new Date(
                                year,
                                month
                            );

                        if (
                            parts[2] ===
                            "prev"
                        ) {
                            newDate.setMonth(
                                newDate.getMonth() - 1
                            );
                        } else {
                            newDate.setMonth(
                                newDate.getMonth() + 1
                            );
                        }

                        await ctx.editMessageText(
                            "📅 Выберите дату:",
                            getCalendar(
                                newDate.getFullYear(),
                                newDate.getMonth(),
                                prefix
                            )
                        );

                        await ctx.answerCbQuery();

                        return;
                    }

                    if (
                        parts[2] ===
                        "set"
                    ) {
                        const dateStr =
                            parts[3];

                        await ctx.answerCbQuery(
                            `Выбрано: ${dateStr}`
                        );

                        const timeData =
                            awaitingDateTime.get(
                                chatId
                            ) || {};

                        timeData.dateStr =
                            dateStr;

                        timeData[
                            prefix
                        ] = {
                            hour: "00",
                            min: "00"
                        };

                        awaitingDateTime.set(
                            chatId,
                            timeData
                        );

                        const title =
                            prefix ===
                            "date_start"
                                ? "начала"
                                : prefix ===
                                  "date_end"
                                ? "окончания"
                                : "готовности";

                        await ctx.editMessageText(
                            `Выберите время для ${title}:`,
                            getTimeKeyboard(
                                prefix
                            )
                        );

                        return;
                    }

                    if (
                        parts[2] ===
                        "skip"
                    ) {
                        await ctx.answerCbQuery(
                            "Пропущено"
                        );

                        try {
                            await ctx.editMessageReplyMarkup(
                                undefined
                            );
                        } catch {}

                        const skipMsg =
                            prefix ===
                            "date_start"
                                ? "Дата начала не указана"
                                : prefix ===
                                  "date_end"
                                ? "Дата окончания не указана"
                                : "Готовность не указана";

                        await ctx.reply(
                            skipMsg
                        );

                        const user =
                            ctx.from;

                        const reply =
                            await askDeepSeek(
                                skipMsg,
                                `tg_${chatId}`,
                                user.first_name
                            );

                        await handleTelegramAIReply(
                            ctx,
                            reply,
                            chatId
                        );

                        return;
                    }
                }


                // --------------------------------------------
                // FORMAT / LEVEL / PERSONNEL / PLACE
                // --------------------------------------------

                if (
                    data.startsWith(
                        "format_"
                    ) ||
                    data.startsWith(
                        "level_"
                    ) ||
                    data.startsWith(
                        "personnel_"
                    ) ||
                    data.startsWith(
                        "place_"
                    )
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    const labelMap = {
                        format_:
                            "Формат",
                        level_:
                            "Уровень",
                        personnel_:
                            "Персонал",
                        place_:
                            "Место"
                    };

                    const prefix =
                        Object.keys(
                            labelMap
                        ).find(
                            p =>
                                data.startsWith(
                                    p
                                )
                        );

                    const buttonText =
                        getButtonText(
                            ctx,
                            data
                        );

                    const text =
                        `${labelMap[prefix]}: ${buttonText}`;

                    await ctx.reply(
                        text
                    );

                    const user =
                        ctx.from;

                    const reply =
                        await askDeepSeek(
                            text,
                            `tg_${chatId}`,
                            user.first_name
                        );

                    await handleTelegramAIReply(
                        ctx,
                        reply,
                        chatId
                    );

                    return;
                }


                // --------------------------------------------
                // LIFT
                // --------------------------------------------

                if (
                    data ===
                        "lift_yes" ||
                    data ===
                        "lift_no"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    const text =
                        data ===
                        "lift_yes"
                            ? "Подъем: Есть грузовой лифт"
                            : "Подъем: Нужно носить по лестнице";

                    await ctx.reply(
                        text
                    );

                    const user =
                        ctx.from;

                    const reply =
                        await askDeepSeek(
                            text,
                            `tg_${chatId}`,
                            user.first_name
                        );

                    await handleTelegramAIReply(
                        ctx,
                        reply,
                        chatId
                    );

                    return;
                }


                // --------------------------------------------
                // EQUIPMENT
                // --------------------------------------------

                if (
                    data.startsWith(
                        "equip_"
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

                    if (
                        data ===
                        "equip_done"
                    ) {
                        const names = {
                            sound:
                                "Звуковое оборудование",

                            led:
                                "Светодиодные экраны",

                            light:
                                "Световое оборудование",

                            stage:
                                "Сценические конструкции",

                            all:
                                "Полный комплекс"
                        };

                        const selectedNames =
                            Array.from(
                                selected
                            ).map(
                                type =>
                                    names[type]
                            );

                        const messageText =
                            selectedNames.length
                                ? `Выбрано оборудование: ${selectedNames.join(", ")}`
                                : "Оборудование не выбрано";

                        await ctx.answerCbQuery(
                            "Готово"
                        );

                        try {
                            await ctx.deleteMessage();
                        } catch {}

                        equipmentSelection.delete(
                            chatId
                        );

                        await ctx.reply(
                            messageText
                        );

                        const user =
                            ctx.from;

                        const reply =
                            await askDeepSeek(
                                messageText,
                                `tg_${chatId}`,
                                user.first_name
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
                        "equip_all"
                    ) {
                        selected.clear();

                        selected.add(
                            "all"
                        );

                        await ctx.answerCbQuery(
                            "Выбран полный комплекс"
                        );

                        await ctx.reply(
                            "🔧 Какое оборудование необходимо? (можно выбрать несколько)",
                            getEquipmentKeyboard(
                                chatId
                            )
                        );

                        return;
                    }

                    const typeMap = {
                        equip_sound:
                            "sound",

                        equip_led:
                            "led",

                        equip_light:
                            "light",

                        equip_stage:
                            "stage"
                    };

                    const type =
                        typeMap[
                            data
                        ];

                    if (!type) {
                        await ctx.answerCbQuery();

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

                        await ctx.answerCbQuery(
                            "Убрано"
                        );
                    } else {
                        selected.add(
                            type
                        );

                        selected.delete(
                            "all"
                        );

                        await ctx.answerCbQuery(
                            "Добавлено"
                        );
                    }

                    await ctx.reply(
                        "🔧 Какое оборудование необходимо? (можно выбрать несколько)",
                        getEquipmentKeyboard(
                            chatId
                        )
                    );

                    return;
                }


                // --------------------------------------------
                // MOUNT
                // --------------------------------------------

                if (
                    data ===
                    "mount_any"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    const text =
                        "Монтаж: Любое по согласованию";

                    await ctx.reply(
                        text
                    );

                    const reply =
                        await askDeepSeek(
                            text,
                            `tg_${chatId}`,
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
                    "mount_night"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    await ctx.reply(
                        "Монтаж: Ночью/рано утром. До какого времени? (введите, например, 06:00)"
                    );

                    awaitingTime.set(
                        chatId,
                        "mount"
                    );

                    return;
                }


                // --------------------------------------------
                // DEMOUNT
                // --------------------------------------------

                if (
                    data ===
                    "demount_any"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    const text =
                        "Демонтаж: Любое по согласованию";

                    await ctx.reply(
                        text
                    );

                    const reply =
                        await askDeepSeek(
                            text,
                            `tg_${chatId}`,
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
                    "demount_deadline"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    await ctx.reply(
                        "Демонтаж: До определённого времени. До какого? (введите время)"
                    );

                    awaitingTime.set(
                        chatId,
                        "demount"
                    );

                    return;
                }


                // --------------------------------------------
                // CONTACT MANAGER
                // --------------------------------------------

                if (
                    data ===
                    "contact_manager"
                ) {
                    manualMode[
                        chatId
                    ] = true;

                    await ctx.answerCbQuery(
                        "Заявка отправлена!"
                    );

                    await ctx.reply(
                        "Спасибо! Менеджер скоро свяжется с вами."
                    );

                    lastActiveClient[
                        ADMIN_CHAT_ID
                    ] = chatId;

                    await notifyAdmin(
                        `📞 Клиент ${ctx.from.first_name} (@${ctx.from.username || "нет"}, ID: ${chatId}) запросил менеджера.`
                    );

                    return;
                }


                // --------------------------------------------
                // SEND FILES
                // --------------------------------------------

                if (
                    data ===
                    "send_tz"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    await ctx.reply(
                        "Отлично! Отправьте все файлы (ТЗ, райдеры, схемы), и я передам их в отдел подготовки КП."
                    );

                    const key =
                        `tg_${chatId}`;

                    ensureSession(
                        key,
                        ctx.from.first_name
                    );

                    sessions[key].push({
                        role:
                            "system",

                        content:
                            "Клиент хочет отправить файлы."
                    });

                    saveSession(key);

                    return;
                }


                // --------------------------------------------
                // START SURVEY
                // --------------------------------------------

                if (
                    data ===
                    "start_survey"
                ) {
                    await ctx.answerCbQuery();

                    try {
                        await ctx.editMessageReplyMarkup(
                            undefined
                        );
                    } catch {}

                    await ctx.reply(
                        "Хорошо, давайте обсудим ваше мероприятие. 🎭 Выберите формат мероприятия:",
                        getFormatKeyboard()
                    );

                    return;
                }

                await ctx.answerCbQuery();
            } catch (error) {
                console.error(
                    "❌ Telegram callback error:",
                    error.stack ||
                    error.message
                );

                try {
                    await ctx.answerCbQuery(
                        "Произошла ошибка"
                    );
                } catch {}
            }
        }
    );


    // ========================================================
    // TELEGRAM TEXT
    // ========================================================

    telegramBot.on(
        "text",
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
                ADMIN_CHAT_ID &&
                String(user.id) ===
                    String(ADMIN_CHAT_ID)
            ) {
                return next();
            }

            lastActiveClient[
                ADMIN_CHAT_ID
            ] = user.id;

            await notifyAdmin(
                `📩 Сообщение от ${user.first_name} (@${user.username || "нет"}, ID: ${user.id}):\n\n${userMessage}`
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

            if (timeAwaiting) {
                awaitingTime.delete(
                    chatId
                );

                const fullMessage =
                    timeAwaiting ===
                    "mount"
                        ? `Монтаж: Ночью/рано утром, точное время: ${userMessage}`
                        : `Демонтаж: До определённого времени, точное время: ${userMessage}`;

                try {
                    await ctx.sendChatAction(
                        "typing"
                    );

                    const reply =
                        await askDeepSeek(
                            fullMessage,
                            `tg_${chatId}`,
                            user.first_name
                        );

                    await handleTelegramAIReply(
                        ctx,
                        reply,
                        chatId
                    );
                } catch (error) {
                    console.error(
                        "❌ Telegram DeepSeek:",
                        error.stack ||
                        error.message
                    );

                    await ctx.reply(
                        "Извините, произошла техническая ошибка."
                    );
                }

                return;
            }

            const lowerMessage =
                userMessage.toLowerCase();

            const addPortfolio =
                PORTFOLIO_KEYWORDS.some(
                    keyword =>
                        lowerMessage.includes(
                            keyword
                        )
                );

            try {
                await ctx.sendChatAction(
                    "typing"
                );

                const reply =
                    await askDeepSeek(
                        userMessage,
                        `tg_${chatId}`,
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
                    "❌ Telegram DeepSeek:",
                    error.stack ||
                    error.message
                );

                await ctx.reply(
                    "Извините, произошла техническая ошибка."
                );
            }
        }
    );


    // ========================================================
    // TELEGRAM START
    // ========================================================

    telegramBot.start(
        async ctx => {
            const chatId =
                ctx.chat.id;

            ensureSession(
                `tg_${chatId}`,
                ctx.from.first_name
            );

            await ctx.reply(
                "Здравствуйте! Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».\n\n" +
                "Если у вас есть готовые файлы с полной информацией по мероприятию (ТЗ, райдеры, даты, любые другие файлы), вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.\n\n" +
                "Или мы можем обсудить ваше мероприятие, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.\n\n" +
                "С чего начнём?",

                Markup.inlineKeyboard([
                    [
                        Markup.button.callback(
                            "📎 Отправить файлы",
                            "send_tz"
                        )
                    ],
                    [
                        Markup.button.callback(
                            "💬 Продолжить диалог",
                            "start_survey"
                        )
                    ]
                ])
            );
        }
    );


    // ========================================================
    // TELEGRAM ADMIN COMMANDS
    // ========================================================

    telegramBot.command(
        "reply",
        async ctx => {
            if (
                !ADMIN_CHAT_ID ||
                String(ctx.from.id) !==
                    String(ADMIN_CHAT_ID)
            ) {
                return;
            }

            const targetId =
                lastActiveClient[
                    ADMIN_CHAT_ID
                ];

            if (!targetId) {
                await ctx.reply(
                    "Нет активного клиента."
                );

                return;
            }

            const text =
                ctx.message.text
                    .split(" ")
                    .slice(1)
                    .join(" ");

            if (!text) {
                await ctx.reply(
                    "Напишите текст после /reply"
                );

                return;
            }

            try {
                await telegramBot.telegram.sendMessage(
                    targetId,
                    text
                );

                await ctx.reply(
                    "✅ Отправлено"
                );
            } catch (error) {
                console.error(
                    "Ошибка /reply:",
                    error.message
                );

                await ctx.reply(
                    "❌ Ошибка отправки."
                );
            }
        }
    );


    telegramBot.command(
        "resume",
        async ctx => {
            if (
                !ADMIN_CHAT_ID ||
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
                "Автоответы возобновлены."
            );
        }
    );


    telegramBot.command(
        "portfolio",
        async ctx => {
            await ctx.reply(
                PORTFOLIO_TEXT ||
                "Портфолио временно недоступно."
            );
        }
    );


    // ========================================================
    // TELEGRAM DOCUMENT
    // ========================================================

    telegramBot.on(
        "document",
        async ctx => {
            const chatId =
                ctx.chat.id;

            const key =
                `tg_${chatId}`;

            ensureSession(
                key,
                ctx.from.first_name
            );

            const waitingForFiles =
                sessions[key].some(
                    item =>
                        item.content ===
                        "Клиент хочет отправить файлы."
                );

            const user =
                ctx.from;

            const doc =
                ctx.message.document;

            await ctx.reply(
                "Спасибо! Файл получен, я передаю его менеджеру."
            );

            if (
                ADMIN_CHAT_ID
            ) {
                try {
                    await telegramBot.telegram.sendDocument(
                        ADMIN_CHAT_ID,
                        doc.file_id,
                        {
                            caption:
                                `📎 Файл от ${user.first_name} (@${user.username || "нет"}, ID: ${user.id})\n` +
                                `Имя файла: ${doc.file_name || "неизвестно"}\n` +
                                `Ожидался по ТЗ: ${waitingForFiles ? "да" : "нет"}`
                        }
                    );
                } catch (error) {
                    console.error(
                        "Ошибка пересылки файла:",
                        error.message
                    );
                }
            }

            sessions[key] =
                sessions[key].filter(
                    item =>
                        item.content !==
                        "Клиент хочет отправить файлы."
                );

            saveSession(key);
        }
    );


    // ========================================================
    // TELEGRAM PHOTO
    // ========================================================

    telegramBot.on(
        "photo",
        async ctx => {
            const user =
                ctx.from;

            const photos =
                ctx.message.photo;

            if (
                !photos ||
                !photos.length
            ) {
                return;
            }

            const largest =
                photos[
                    photos.length - 1
                ];

            await ctx.reply(
                "Спасибо! Я передал ваше фото менеджеру."
            );

            if (
                ADMIN_CHAT_ID
            ) {
                try {
                    await telegramBot.telegram.sendPhoto(
                        ADMIN_CHAT_ID,
                        largest.file_id,
                        {
                            caption:
                                `📷 Фото от ${user.first_name} (@${user.username || "нет"}, ID: ${user.id})`
                        }
                    );
                } catch (error) {
                    console.error(
                        "Ошибка пересылки фото:",
                        error.message
                    );
                }
            }
        }
    );
}


// ============================================================
// BITRIX OFFSET
// ============================================================

let bitrixOffset = null;

let bitrixPolling = false;

let shuttingDown = false;


function loadBitrixOffset() {
    if (
        !fs.existsSync(
            OFFSET_FILE
        )
    ) {
        console.log(
            "ℹ️ Bitrix offset отсутствует. Первый запрос будет без offset."
        );

        bitrixOffset = null;

        return;
    }

    try {
        const data =
            JSON.parse(
                fs.readFileSync(
                    OFFSET_FILE,
                    "utf8"
                )
            );

        if (
            Number.isInteger(
                data.offset
            )
        ) {
            bitrixOffset =
                data.offset;

            console.log(
                "✅ Bitrix offset загружен:",
                bitrixOffset
            );
        } else {
            bitrixOffset = null;
        }
    } catch (error) {
        console.error(
            "❌ Ошибка загрузки Bitrix offset:",
            error.message
        );

        bitrixOffset = null;
    }
}


function saveBitrixOffset(
    newOffset
) {
    try {
        fs.writeFileSync(
            OFFSET_FILE,
            JSON.stringify(
                {
                    offset:
                        newOffset,

                    savedAt:
                        new Date().toISOString()
                },
                null,
                2
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "❌ Ошибка сохранения Bitrix offset:",
            error.message
        );
    }
}


// ============================================================
// BITRIX REST
// ============================================================

async function bitrixCall(
    method,
    params = {}
) {
    if (
        !BITRIX_WEBHOOK_URL
    ) {
        throw new Error(
            "BITRIX_WEBHOOK_URL отсутствует."
        );
    }

    const base =
        BITRIX_WEBHOOK_URL.replace(
            /\/+$/,
            ""
        );

    const url =
        `${base}/${method}`;

    console.log(
        "➡️ BITRIX API:",
        method
    );

    try {
        const response =
            await fetch(
                url,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            params
                        )
                }
            );

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
            !response.ok ||
            data.error
        ) {
            throw new Error(
                `Bitrix HTTP ${response.status}: ${
                    data.error ||
                    "UNKNOWN_ERROR"
                } — ${
                    data.error_description ||
                    ""
                }`
            );
        }

        return data.result;
    } catch (error) {
        console.error(
            "❌ BITRIX API ERROR:",
            error.message
        );

        throw error;
    }
}


// ============================================================
// BITRIX BOT CHECK
// ============================================================

async function checkBitrixBot() {
    if (
        !BITRIX_WEBHOOK_URL ||
        !BITRIX_BOT_TOKEN
    ) {
        console.log(
            "ℹ️ Bitrix transport отключён."
        );

        return false;
    }

    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "🤖 ПРОВЕРКА BITRIX BOT"
    );
    console.log(
        "========================================"
    );

    const result =
        await bitrixCall(
            "imbot.v2.Bot.get",
            {
                botId:
                    BITRIX_BOT_ID,

                botToken:
                    BITRIX_BOT_TOKEN
            }
        );

    const bot =
        result?.bot ||
        result;

    console.log(
        "BOT ID:",
        bot?.id
    );

    console.log(
        "BOT CODE:",
        bot?.code
    );

    console.log(
        "OPENLINE:",
        bot?.isSupportOpenline
    );

    console.log(
        "EVENT MODE:",
        bot?.eventMode
    );

    if (
        Number(bot?.id) !==
        BITRIX_BOT_ID
    ) {
        throw new Error(
            `Bitrix вернул Bot ID ${bot?.id}, ожидался ${BITRIX_BOT_ID}.`
        );
    }

    if (
        bot?.eventMode !==
        "fetch"
    ) {
        console.warn(
            "⚠️ ВНИМАНИЕ: Bot eventMode сейчас:",
            bot?.eventMode
        );

        console.warn(
            "⚠️ Этот код ожидает FETCH."
        );
    }

    console.log(
        "✅ Bitrix bot доступен."
    );

    return true;
}


// ============================================================
// BITRIX GET EVENTS
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
        "imbot.v2.Event.get",
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
            text || ""
        ).trim();

    if (!cleanText) {
        return null;
    }

    console.log("");
    console.log(
        "📤 BITRIX SEND MESSAGE"
    );

    console.log(
        "DIALOG:",
        dialogId
    );

    console.log(
        "MESSAGE:",
        cleanText.slice(0, 1000)
    );

    const result =
        await bitrixCall(
            "imbot.v2.Chat.Message.send",
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

    console.log(
        "✅ Bitrix сообщение отправлено."
    );

    return result;
}


// ============================================================
// BITRIX EVENT HANDLER
// ============================================================

async function handleBitrixEvent(
    event
) {
    console.log("");
    console.log(
        "========================================"
    );
    console.log(
        "📥 BITRIX EVENT"
    );
    console.log(
        "========================================"
    );

    console.log(
        "EVENT ID:",
        event?.eventId
    );

    console.log(
        "EVENT TYPE:",
        event?.type ||
        event?.event
    );

    const data =
        event?.data || {};

    const message =
        data.message || {};

    const chat =
        data.chat || {};

    const user =
        data.user || {};

    const bot =
        data.bot || {};

    console.log(
        "BOT ID:",
        bot.id
    );

    console.log(
        "CHAT ID:",
        message.chatId ||
        chat.id ||
        "unknown"
    );

    console.log(
        "DIALOG ID:",
        chat.dialogId ||
        "unknown"
    );

    console.log(
        "ENTITY TYPE:",
        chat.entityType ||
        "unknown"
    );

    console.log(
        "USER:",
        user.firstName ||
        user.name ||
        "unknown"
    );

    console.log(
        "TEXT:",
        String(
            message.text ||
            ""
        ).slice(0, 1000)
    );


    const eventType =
        event?.type ||
        event?.event;

    if (
        eventType !==
        "ONIMBOTV2MESSAGEADD"
    ) {
        console.log(
            "ℹ️ Это не ONIMBOTV2MESSAGEADD. Пропускаем."
        );

        return;
    }


    if (
        bot.id &&
        String(bot.id) !==
            String(BITRIX_BOT_ID)
    ) {
        console.warn(
            "⚠️ Событие относится к другому боту."
        );

        return;
    }


    const clientText =
        String(
            message.text ||
            ""
        ).trim();

    if (!clientText) {
        console.log(
            "ℹ️ Пустое сообщение."
        );

        return;
    }


    // Не фильтруем entityType === LINES.
    //
    // Это специально.
    //
    // В предыдущих версиях именно такой фильтр
    // мог отбрасывать реальные события.
    //
    // Сначала доказываем транспорт.
    // После стабилизации можно разделить
    // OpenLine и внутренний Bitrix chat.


    const dialogId =
        chat.dialogId ||
        message.chatId ||
        chat.id;

    if (
        dialogId === undefined ||
        dialogId === null
    ) {
        throw new Error(
            "Bitrix event не содержит dialogId/chatId."
        );
    }


    const userFirstName =
        user.firstName ||
        user.name ||
        "клиент";


    const sessionKey =
        `b24_${dialogId}`;


    const lowerText =
        clientText.toLowerCase();

    const addPortfolio =
        PORTFOLIO_KEYWORDS.some(
            keyword =>
                lowerText.includes(
                    keyword
                )
        );


    console.log(
        "➡️ Отправляем сообщение в DeepSeek..."
    );


    let reply;

    try {
        reply =
            await askDeepSeek(
                clientText,
                sessionKey,
                userFirstName,
                addPortfolio
            );
    } catch (error) {
        console.error(
            "❌ DeepSeek для Bitrix:",
            error.stack ||
            error.message
        );

        reply =
            "Извините, произошла техническая ошибка. Пожалуйста, повторите сообщение немного позже.";
    }


    console.log(
        "➡️ Отправляем ответ обратно в Bitrix..."
    );


    await sendBitrixMessage(
        dialogId,
        reply
    );


    console.log(
        "✅ BITRIX EVENT COMPLETE"
    );
}


// ============================================================
// BITRIX POLL
// ============================================================

async function pollBitrix() {
    if (
        bitrixPolling ||
        shuttingDown
    ) {
        return;
    }

    if (
        !BITRIX_WEBHOOK_URL ||
        !BITRIX_BOT_TOKEN
    ) {
        return;
    }

    bitrixPolling = true;

    try {
        console.log("");
        console.log(
            "----------------------------------------"
        );

        console.log(
            "🔄 BITRIX FETCH POLL"
        );

        console.log(
            "BOT ID:",
            BITRIX_BOT_ID
        );

        console.log(
            "OFFSET:",
            bitrixOffset === null
                ? "FIRST"
                : bitrixOffset
        );

        const result =
            await getBitrixEvents();

        const events =
            Array.isArray(
                result?.events
            )
                ? result.events
                : [];

        const nextOffset =
            result?.nextOffset;

        const hasMore =
            Boolean(
                result?.hasMore
            );

        console.log(
            "📦 EVENTS:",
            events.length
        );

        console.log(
            "NEXT OFFSET:",
            nextOffset
        );

        console.log(
            "HAS MORE:",
            hasMore
        );


        for (
            const event
            of events
        ) {
            try {
                await handleBitrixEvent(
                    event
                );
            } catch (error) {
                console.error(
                    "❌ Ошибка обработки Bitrix event:",
                    error.stack ||
                    error.message
                );

                // ВАЖНО:
                //
                // Мы НЕ двигаем offset при ошибке
                // обработки события.
                //
                // Это позволяет повторить событие.
                throw error;
            }
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

            console.log(
                "➡️ OFFSET UPDATED:",
                bitrixOffset
            );
        }


        if (hasMore) {
            setImmediate(
                pollBitrix
            );
        }
    } catch (error) {
        console.error(
            "❌ BITRIX FETCH ERROR:",
            error.stack ||
            error.message
        );
    } finally {
        bitrixPolling =
            false;
    }
}


// ============================================================
// BITRIX LOOP
// ============================================================

let bitrixInterval = null;


function startBitrixPolling() {
    if (
        !BITRIX_WEBHOOK_URL ||
        !BITRIX_BOT_TOKEN
    ) {
        console.log(
            "ℹ️ Bitrix polling отключён."
        );

        return;
    }

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🚀 BITRIX FETCH LOOP STARTED"
    );

    console.log(
        "========================================"
    );

    pollBitrix();

    bitrixInterval =
        setInterval(
            pollBitrix,
            BITRIX_POLL_INTERVAL_MS
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
                if (
                    req.method ===
                        "GET" &&
                    req.url ===
                        "/"
                ) {
                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "text/plain; charset=utf-8"
                        }
                    );

                    res.end(
                        "MLK AI Bot is running."
                    );

                    return;
                }


                if (
                    req.method ===
                        "GET" &&
                    req.url ===
                        "/health"
                ) {
                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "application/json; charset=utf-8"
                        }
                    );

                    res.end(
                        JSON.stringify(
                            {
                                ok:
                                    true,

                                telegram:
                                    Boolean(
                                        TELEGRAM_BOT_TOKEN
                                    ),

                                bitrix:
                                    Boolean(
                                        BITRIX_WEBHOOK_URL &&
                                        BITRIX_BOT_TOKEN
                                    ),

                                bitrixBotId:
                                    BITRIX_BOT_ID,

                                bitrixOffset:
                                    bitrixOffset,

                                bitrixPolling:
                                    bitrixPolling,

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
                        "Content-Type":
                            "text/plain; charset=utf-8"
                    }
                );

                res.end(
                    "Not Found"
                );
            } catch (error) {
                console.error(
                    "HTTP error:",
                    error.message
                );

                res.writeHead(
                    500
                );

                res.end(
                    "Internal Server Error"
                );
            }
        }
    );


// ============================================================
// TELEGRAM LAUNCH
// ============================================================

async function startTelegram() {
    if (
        !telegramBot
    ) {
        console.log(
            "⚠️ Telegram не запускается: токен отсутствует."
        );

        return;
    }

    while (
        !shuttingDown
    ) {
        try {
            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "🚀 STARTING TELEGRAM BOT"
            );

            console.log(
                "========================================"
            );

            await telegramBot.launch({
                dropPendingUpdates:
                    false
            });

            console.log(
                "✅ TELEGRAM BOT STARTED"
            );

            await notifyAdmin(
                "✅ MLK бот запущен и работает."
            );

            return;
        } catch (error) {
            console.error(
                "❌ Telegram launch error:",
                error.stack ||
                error.message
            );

            if (
                shuttingDown
            ) {
                return;
            }

            console.log(
                "↻ Повтор запуска Telegram через 5 секунд..."
            );

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
// START
// ============================================================

async function start() {
    loadSessions();

    loadBitrixOffset();

    server.listen(
        PORT,
        "0.0.0.0",
        async () => {
            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "🚀 SERVER STARTED"
            );

            console.log(
                "PORT:",
                PORT
            );

            console.log(
                "========================================"
            );


            // ------------------------------------------------
            // BITRIX
            // ------------------------------------------------

            if (
                BITRIX_WEBHOOK_URL &&
                BITRIX_BOT_TOKEN
            ) {
                try {
                    await checkBitrixBot();

                    startBitrixPolling();
                } catch (error) {
                    console.error(
                        "❌ Bitrix startup error:",
                        error.stack ||
                        error.message
                    );

                    console.error(
                        "⚠️ Telegram продолжит запускаться."
                    );
                }
            }


            // ------------------------------------------------
            // TELEGRAM
            // ------------------------------------------------

            startTelegram();


            console.log("");
            console.log(
                "========================================"
            );

            console.log(
                "🎉 MLK AI BOT READY"
            );

            console.log(
                "========================================"
            );

            console.log(
                "TELEGRAM:",
                telegramBot
                    ? "ENABLED"
                    : "DISABLED"
            );

            console.log(
                "BITRIX:",
                BITRIX_WEBHOOK_URL &&
                BITRIX_BOT_TOKEN
                    ? "ENABLED"
                    : "DISABLED"
            );

            console.log(
                "DEEPSEEK:",
                DEEPSEEK_API_KEY
                    ? "ENABLED"
                    : "DISABLED"
            );

            console.log(
                "========================================"
            );
        }
    );
}


// ============================================================
// ERRORS
// ============================================================

process.on(
    "unhandledRejection",
    reason => {
        console.error(
            "❌ UNHANDLED REJECTION:",
            reason?.stack ||
            reason?.message ||
            reason
        );
    }
);


process.on(
    "uncaughtException",
    error => {
        console.error(
            "❌ UNCAUGHT EXCEPTION:",
            error.stack ||
            error.message
        );
    }
);


// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {
    if (
        shuttingDown
    ) {
        return;
    }

    shuttingDown =
        true;

    console.log("");
    console.log(
        `🛑 ${signal} — завершаем работу...`
    );


    if (
        bitrixInterval
    ) {
        clearInterval(
            bitrixInterval
        );

        bitrixInterval =
            null;
    }


    if (
        telegramBot
    ) {
        try {
            telegramBot.stop(
                signal
            );
        } catch {}
    }


    server.close(
        () => {
            console.log(
                "✅ HTTP server closed."
            );

            process.exit(
                0
            );
        }
    );


    setTimeout(
        () => {
            process.exit(
                0
            );
        },
        5000
    );
}


process.once(
    "SIGTERM",
    () =>
        shutdown(
            "SIGTERM"
        )
);

process.once(
    "SIGINT",
    () =>
        shutdown(
            "SIGINT"
        )
);


// ============================================================
// RUN
// ============================================================

start().catch(
    error => {
        console.error(
            "❌ FATAL START ERROR:",
            error.stack ||
            error.message
        );

        process.exit(1);
    }
);
```
