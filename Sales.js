'use strict';

/**
 * ============================================================
 * MLK SALES ENGINE
 * sales.js
 * ============================================================
 *
 * Это отдельный "мозг продаж".
 *
 * Он НЕ знает ничего о:
 *   - Telegram
 *   - Bitrix24
 *   - Telegraf
 *   - отправке сообщений
 *   - кнопках Telegram
 *
 * Он получает сообщение клиента и возвращает:
 *
 * {
 *   text,
 *   actions,
 *   project,
 *   missing,
 *   stage,
 *   intent,
 *   readyForManager,
 *   managerSummary
 * }
 *
 * bot.js позже будет только:
 *
 * const result = await processSalesMessage(clientId, message);
 *
 * и уже сам отправлять result.text / result.actions.
 *
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG
// ============================================================

const ROOT_DIR = __dirname;

const PROMPT_FILE = path.join(ROOT_DIR, 'promt.txt');
const PORTFOLIO_FILE = path.join(ROOT_DIR, 'portfolio.txt');

const DEEPSEEK_API_KEY = (
    process.env.DEEPSEEK_API_KEY || ''
).trim();

const DEEPSEEK_MODEL = (
    process.env.DEEPSEEK_MODEL || 'deepseek-chat'
).trim();

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

const MAX_HISTORY = 30;


// ============================================================
// LOAD PROMPT / PORTFOLIO
// ============================================================

let SYSTEM_PROMPT = '';
let PORTFOLIO_TEXT = '';

try {
    SYSTEM_PROMPT = fs.readFileSync(
        PROMPT_FILE,
        'utf8'
    ).trim();
} catch (error) {
    console.warn(
        '⚠️ Не удалось загрузить promt.txt:',
        error.message
    );
}

try {
    PORTFOLIO_TEXT = fs.readFileSync(
        PORTFOLIO_FILE,
        'utf8'
    ).trim();
} catch (error) {
    console.warn(
        '⚠️ Не удалось загрузить portfolio.txt:',
        error.message
    );
}


// ============================================================
// CONSTANTS
// ============================================================

const EVENT_TYPES = {
    concerts: {
        value: 'concerts',
        label: 'Концерты & Фестивали'
    },

    conferences: {
        value: 'conferences',
        label: 'Конференции & Презентации & TV-проекты'
    },

    corporate: {
        value: 'corporate',
        label: 'Корпоративы & Торжества'
    },

    exhibitions: {
        value: 'exhibitions',
        label: 'Выставки'
    },

    sports: {
        value: 'sports',
        label: 'Спортивные мероприятия'
    }
};


const LEVELS = {
    standard: {
        value: 'standard',
        label: 'Стандартный'
    },

    high: {
        value: 'high',
        label: 'Высокие требования'
    },

    highest: {
        value: 'highest',
        label: 'Высший уровень'
    }
};


const PERSONNEL = {
    management: {
        value: 'management',
        label: 'Управление оборудованием'
    },

    duty_technician: {
        value: 'duty_technician',
        label: 'Дежурный техник'
    },

    installation_dismantling: {
        value: 'installation_dismantling',
        label: 'Только монтаж-демонтаж'
    },

    other: {
        value: 'other',
        label: 'Другое'
    }
};


const PLACES = {
    outdoor: {
        value: 'outdoor',
        label: 'Улица'
    },

    indoor: {
        value: 'indoor',
        label: 'Помещение'
    },

    covered: {
        value: 'covered',
        label: 'Под навесом'
    }
};


const EQUIPMENT = {
    sound: {
        value: 'sound',
        label: 'Звуковое оборудование'
    },

    led: {
        value: 'led',
        label: 'Светодиодные экраны'
    },

    light: {
        value: 'light',
        label: 'Световое оборудование'
    },

    stage: {
        value: 'stage',
        label: 'Сценические конструкции'
    },

    all: {
        value: 'all',
        label: 'Полный комплекс'
    }
};


const MOUNT = {
    any: {
        value: 'any',
        label: 'Любое по согласованию'
    },

    night: {
        value: 'night',
        label: 'Ночью/рано утром'
    }
};


const DEMOUNT = {
    any: {
        value: 'any',
        label: 'Любое по согласованию'
    },

    deadline: {
        value: 'deadline',
        label: 'До определённого времени'
    }
};


// ============================================================
// CLIENT STATE STORAGE
// ============================================================
//
// Пока намеренно НЕ пишем ничего в bot.js.
// State живёт здесь.
// Позже можно будет заменить storage на отдельный модуль/БД,
// не меняя остальную архитектуру.
//

const salesStates = new Map();


// ============================================================
// CREATE STATE
// ============================================================

function createSalesState(clientId, clientName = '') {

    return {
        client: {
            id: String(clientId || ''),
            name: clientName || ''
        },

        project: {
            eventType: null,
            eventLevel: null,

            guestCount: null,

            dateStart: null,
            dateEnd: null,
            readyDate: null,

            location: null,

            place: null,
            floor: null,

            lift: null,
            liftDimensions: null,

            equipment: [],

            equipmentDetails: null,

            personnel: null,
            personnelDetails: null,

            mount: null,
            mountTime: null,

            demount: null,
            demountTime: null,

            clientRequest: '',
            additionalInfo: ''
        },

        intent: null,

        missing: [],

        stage: 'greeting',

        lastAction: null,

        history: [],

        managerNotified: false,

        updatedAt: null
    };
}


// ============================================================
// GET STATE
// ============================================================

function getSalesState(clientId, clientName = '') {

    const key = String(clientId || '');

    if (!salesStates.has(key)) {
        salesStates.set(
            key,
            createSalesState(key, clientName)
        );
    }

    const state = salesStates.get(key);

    if (
        clientName &&
        !state.client.name
    ) {
        state.client.name = clientName;
    }

    return state;
}


// ============================================================
// DELETE / RESET
// ============================================================

function resetSalesClient(clientId, clientName = '') {

    const key = String(clientId || '');

    const state = createSalesState(
        key,
        clientName
    );

    salesStates.set(
        key,
        state
    );

    return state;
}


function deleteSalesClient(clientId) {

    return salesStates.delete(
        String(clientId || '')
    );
}


// ============================================================
// HISTORY
// ============================================================

function addHistory(
    state,
    role,
    content,
    meta = {}
) {

    if (!content) return;

    state.history.push({
        role,
        content: String(content),
        timestamp: new Date().toISOString(),
        ...meta
    });

    if (
        state.history.length >
        MAX_HISTORY
    ) {
        state.history =
            state.history.slice(
                -MAX_HISTORY
            );
    }
}


function getHistory(state) {
    return state.history;
}


// ============================================================
// HELPERS
// ============================================================

function isUnknown(value) {

    return (
        value === 'unknown' ||
        value === 'не знаю' ||
        value === 'неизвестно'
    );
}


function cleanString(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const result = String(value).trim();

    return result || null;
}


function normalizeNumber(value) {

    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value === 'number' &&
        Number.isFinite(value)
    ) {
        return value;
    }

    const str = String(value)
        .replace(',', '.')
        .trim();

    const match = str.match(
        /\d+(?:\.\d+)?/
    );

    if (!match) return null;

    const number = Number(match[0]);

    return Number.isFinite(number)
        ? number
        : null;
}


function normalizeEquipment(value) {

    if (!Array.isArray(value)) {
        return [];
    }

    const allowed = Object.keys(EQUIPMENT);

    return [
        ...new Set(
            value
                .map(item => String(item).trim())
                .filter(item =>
                    allowed.includes(item)
                )
        )
    ];
}


function getEventLabel(value) {

    return EVENT_TYPES[value]?.label ||
        value ||
        'Не указано';
}


function getLevelLabel(value) {

    return LEVELS[value]?.label ||
        value ||
        'Не указано';
}


function getPersonnelLabel(value) {

    return PERSONNEL[value]?.label ||
        value ||
        'Не указано';
}


function getPlaceLabel(value) {

    return PLACES[value]?.label ||
        value ||
        'Не указано';
}


function getEquipmentLabels(items) {

    if (!Array.isArray(items)) {
        return [];
    }

    return items.map(
        item =>
            EQUIPMENT[item]?.label ||
            item
    );
}


// ============================================================
// NORMALIZE AI DATA
// ============================================================

function normalizeExtractedData(raw) {

    if (
        !raw ||
        typeof raw !== 'object'
    ) {
        return {};
    }

    const data = {};

    // --------------------------------------------------------
    // CLIENT
    // --------------------------------------------------------

    if (raw.client) {

        if (raw.client.name !== undefined) {
            data.client = {
                name: cleanString(
                    raw.client.name
                )
            };
        }
    }


    // --------------------------------------------------------
    // PROJECT
    // --------------------------------------------------------

    const p = raw.project || raw;

    if (p.eventType !== undefined) {

        const value =
            cleanString(p.eventType);

        if (
            value &&
            Object.keys(EVENT_TYPES)
                .includes(value)
        ) {
            data.eventType = value;
        }
    }


    if (p.eventLevel !== undefined) {

        const value =
            cleanString(p.eventLevel);

        if (
            value &&
            Object.keys(LEVELS)
                .includes(value)
        ) {
            data.eventLevel = value;
        }
    }


    if (p.guestCount !== undefined) {

        if (isUnknown(p.guestCount)) {
            data.guestCount = 'unknown';
        } else {
            const number =
                normalizeNumber(
                    p.guestCount
                );

            if (number !== null) {
                data.guestCount = number;
            }
        }
    }


    // --------------------------------------------------------
    // DATES
    // --------------------------------------------------------

    if (p.dateStart !== undefined) {
        data.dateStart =
            cleanString(p.dateStart);
    }

    if (p.dateEnd !== undefined) {
        data.dateEnd =
            cleanString(p.dateEnd);
    }

    if (p.readyDate !== undefined) {
        data.readyDate =
            cleanString(p.readyDate);
    }


    // --------------------------------------------------------
    // LOCATION
    // --------------------------------------------------------

    if (p.location !== undefined) {
        data.location =
            cleanString(p.location);
    }


    // --------------------------------------------------------
    // PLACE
    // --------------------------------------------------------

    if (p.place !== undefined) {

        const value =
            cleanString(p.place);

        if (
            value &&
            Object.keys(PLACES)
                .includes(value)
        ) {
            data.place = value;
        }
    }


    // --------------------------------------------------------
    // FLOOR
    // --------------------------------------------------------

    if (p.floor !== undefined) {

        if (isUnknown(p.floor)) {
            data.floor = 'unknown';
        } else {

            const floor =
                normalizeNumber(
                    p.floor
                );

            if (floor !== null) {
                data.floor = floor;
            }
        }
    }


    // --------------------------------------------------------
    // LIFT
    // --------------------------------------------------------

    if (p.lift !== undefined) {

        const value =
            cleanString(p.lift);

        if (
            value === 'has_lift' ||
            value === 'stairs' ||
            value === 'unknown'
        ) {
            data.lift = value;
        }
    }


    // --------------------------------------------------------
    // LIFT DIMENSIONS
    // --------------------------------------------------------

    if (
        p.liftDimensions !== undefined
    ) {
        data.liftDimensions =
            cleanString(
                p.liftDimensions
            );
    }


    // --------------------------------------------------------
    // EQUIPMENT
    // --------------------------------------------------------

    if (
        p.equipment !== undefined
    ) {

        const equipment =
            normalizeEquipment(
                p.equipment
            );

        if (equipment.length > 0) {
            data.equipment =
                equipment;
        }
    }


    if (
        p.equipmentDetails !== undefined
    ) {
        data.equipmentDetails =
            cleanString(
                p.equipmentDetails
            );
    }


    // --------------------------------------------------------
    // PERSONNEL
    // --------------------------------------------------------

    if (
        p.personnel !== undefined
    ) {

        const value =
            cleanString(p.personnel);

        if (
            value &&
            Object.keys(PERSONNEL)
                .includes(value)
        ) {
            data.personnel = value;
        }
    }


    if (
        p.personnelDetails !== undefined
    ) {
        data.personnelDetails =
            cleanString(
                p.personnelDetails
            );
    }


    // --------------------------------------------------------
    // MOUNT
    // --------------------------------------------------------

    if (p.mount !== undefined) {

        const value =
            cleanString(p.mount);

        if (
            value &&
            Object.keys(MOUNT)
                .includes(value)
        ) {
            data.mount = value;
        }
    }


    if (p.mountTime !== undefined) {
        data.mountTime =
            cleanString(p.mountTime);
    }


    // --------------------------------------------------------
    // DEMOUNT
    // --------------------------------------------------------

    if (
        p.demount !== undefined
    ) {

        const value =
            cleanString(p.demount);

        if (
            value &&
            Object.keys(DEMOUNT)
                .includes(value)
        ) {
            data.demount = value;
        }
    }


    if (
        p.demountTime !== undefined
    ) {
        data.demountTime =
            cleanString(p.demountTime);
    }


    // --------------------------------------------------------
    // ADDITIONAL
    // --------------------------------------------------------

    if (
        p.clientRequest !== undefined
    ) {
        data.clientRequest =
            cleanString(
                p.clientRequest
            );
    }


    if (
        p.additionalInfo !== undefined
    ) {
        data.additionalInfo =
            cleanString(
                p.additionalInfo
            );
    }


    return data;
}


// ============================================================
// MERGE PROJECT DATA
// ============================================================
//
// Важнейшее правило:
//
// Если клиент сказал:
//
// "350 человек"
//
// потом:
//
// "Нет, будет 450"
//
// 450 заменяет 350.
//
// История при этом остаётся.
//

function mergeProjectData(
    state,
    extracted
) {

    if (!extracted) return;

    // Client
    if (
        extracted.client &&
        extracted.client.name
    ) {
        state.client.name =
            extracted.client.name;
    }


    const p = state.project;


    const fields = [
        'eventType',
        'eventLevel',
        'guestCount',
        'dateStart',
        'dateEnd',
        'readyDate',
        'location',
        'place',
        'floor',
        'lift',
        'liftDimensions',
        'equipmentDetails',
        'personnel',
        'personnelDetails',
        'mount',
        'mountTime',
        'demount',
        'demountTime',
        'clientRequest',
        'additionalInfo'
    ];


    for (const field of fields) {

        if (
            extracted[field] !== undefined &&
            extracted[field] !== null &&
            extracted[field] !== ''
        ) {

            p[field] =
                extracted[field];
        }
    }


    // Equipment отдельно
    if (
        Array.isArray(
            extracted.equipment
        )
    ) {

        p.equipment =
            extracted.equipment;
    }
}


// ============================================================
// DEPENDENCY CLEANUP
// ============================================================
//
// Если клиент изменил тип мероприятия:
//
// например:
//
// corporate -> conferences
//
// guestCount больше не нужен.
//
// Если помещение -> улица,
// этаж / лифт больше не нужны.
//

function cleanDependentFields(state) {

    const p = state.project;


    // --------------------------------------------------------
    // LEVEL
    // --------------------------------------------------------

    if (
        p.eventType !== 'concerts' &&
        p.eventType !== 'sports'
    ) {
        p.eventLevel = null;
    }


    // --------------------------------------------------------
    // GUEST COUNT
    // --------------------------------------------------------

    if (
        p.eventType !== 'corporate'
    ) {
        p.guestCount = null;
    }


    // --------------------------------------------------------
    // PLACE
    // --------------------------------------------------------

    if (
        p.place !== 'indoor'
    ) {

        p.floor = null;
        p.lift = null;
        p.liftDimensions = null;
    }


    // --------------------------------------------------------
    // LIFT
    // --------------------------------------------------------

    if (
        p.place === 'indoor' &&
        typeof p.floor === 'number' &&
        p.floor <= 2
    ) {

        p.lift = null;
        p.liftDimensions = null;
    }


    if (
        p.lift !== 'has_lift'
    ) {
        p.liftDimensions = null;
    }


    // --------------------------------------------------------
    // MOUNT TIME
    // --------------------------------------------------------

    if (p.mount !== 'night') {
        p.mountTime = null;
    }


    // --------------------------------------------------------
    // DEMOUNT TIME
    // --------------------------------------------------------

    if (p.demount !== 'deadline') {
        p.demountTime = null;
    }
}


// ============================================================
// CALCULATE MISSING
// ============================================================
//
// Это НЕ DeepSeek.
// Это наш deterministic funnel.
//

function calculateMissing(state) {

    cleanDependentFields(state);

    const p = state.project;

    const missing = [];


    // --------------------------------------------------------
    // 1. EVENT TYPE
    // --------------------------------------------------------

    if (!p.eventType) {

        missing.push({
            field: 'eventType',
            action: 'ask_format'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 2. EVENT LEVEL
    // --------------------------------------------------------

    if (
        (
            p.eventType === 'concerts' ||
            p.eventType === 'sports'
        ) &&
        !p.eventLevel
    ) {

        missing.push({
            field: 'eventLevel',
            action: 'ask_level'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 3. CORPORATE GUEST COUNT
    // --------------------------------------------------------

    if (
        p.eventType === 'corporate' &&
        p.guestCount === null
    ) {

        missing.push({
            field: 'guestCount',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 4. PERSONNEL
    // --------------------------------------------------------

    if (!p.personnel) {

        missing.push({
            field: 'personnel',
            action: 'ask_personnel'
        });

        return missing;
    }


    // "Другое" обязательно описать
    if (
        p.personnel === 'other' &&
        !p.personnelDetails
    ) {

        missing.push({
            field: 'personnelDetails',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 5. DATES
    // --------------------------------------------------------

    if (!p.dateStart) {

        missing.push({
            field: 'dateStart',
            action: 'ask_date_start'
        });

        return missing;
    }


    if (!p.dateEnd) {

        missing.push({
            field: 'dateEnd',
            action: 'ask_date_end'
        });

        return missing;
    }


    if (!p.readyDate) {

        missing.push({
            field: 'readyDate',
            action: 'ask_ready_date'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 6. LOCATION
    // --------------------------------------------------------

    if (!p.location) {

        missing.push({
            field: 'location',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 7. PLACE
    // --------------------------------------------------------

    if (!p.place) {

        missing.push({
            field: 'place',
            action: 'ask_place'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 8. FLOOR
    // --------------------------------------------------------

    if (
        p.place === 'indoor' &&
        p.floor === null
    ) {

        missing.push({
            field: 'floor',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 9. LIFT
    // --------------------------------------------------------

    if (
        p.place === 'indoor' &&
        typeof p.floor === 'number' &&
        p.floor > 2 &&
        !p.lift
    ) {

        missing.push({
            field: 'lift',
            action: 'ask_lift'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 10. LIFT DIMENSIONS
    // --------------------------------------------------------

    if (
        p.lift === 'has_lift' &&
        !p.liftDimensions
    ) {

        missing.push({
            field: 'liftDimensions',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 11. EQUIPMENT
    // --------------------------------------------------------

    if (
        !Array.isArray(p.equipment) ||
        p.equipment.length === 0
    ) {

        missing.push({
            field: 'equipment',
            action: 'ask_equipment'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 12. MOUNT
    // --------------------------------------------------------

    if (!p.mount) {

        missing.push({
            field: 'mount',
            action: 'ask_mount'
        });
    }


    // --------------------------------------------------------
    // 13. DEMOUNT
    // --------------------------------------------------------

    if (!p.demount) {

        missing.push({
            field: 'demount',
            action: 'ask_demount'
        });
    }


    // --------------------------------------------------------
    // 14. MOUNT TIME
    // --------------------------------------------------------

    if (
        p.mount === 'night' &&
        !p.mountTime
    ) {

        missing.push({
            field: 'mountTime',
            action: 'text_question'
        });
    }


    // --------------------------------------------------------
    // 15. DEMOUNT TIME
    // --------------------------------------------------------

    if (
        p.demount === 'deadline' &&
        !p.demountTime
    ) {

        missing.push({
            field: 'demountTime',
            action: 'text_question'
        });
    }


    return missing;
}


// ============================================================
// GET NEXT ACTION
// ============================================================

function getNextAction(state) {

    const missing =
        calculateMissing(state);

    if (!missing.length) {

        return {
            type: 'summary'
        };
    }


    const first =
        missing[0];


    // --------------------------------------------------------
    // TEXT QUESTIONS
    // --------------------------------------------------------

    if (
        first.action ===
        'text_question'
    ) {

        return {
            type: 'text_question',
            field: first.field
        };
    }


    // --------------------------------------------------------
    // QUICK REPLY
    // --------------------------------------------------------

    if (
        first.action ===
        'ask_format'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_format'
        };
    }


    if (
        first.action ===
        'ask_level'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_level'
        };
    }


    if (
        first.action ===
        'ask_personnel'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_personnel'
        };
    }


    if (
        first.action ===
        'ask_place'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_place'
        };
    }


    if (
        first.action ===
        'ask_lift'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_lift'
        };
    }


    if (
        first.action ===
        'ask_equipment'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_equipment'
        };
    }


    if (
        first.action ===
        'ask_mount'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_mount'
        };
    }


    if (
        first.action ===
        'ask_demount'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_demount'
        };
    }


    // --------------------------------------------------------
    // CALENDAR
    // --------------------------------------------------------

    if (
        first.action ===
        'ask_date_start'
    ) {

        return {
            type: 'calendar',
            tag: 'ask_date_start'
        };
    }


    if (
        first.action ===
        'ask_date_end'
    ) {

        return {
            type: 'calendar',
            tag: 'ask_date_end'
        };
    }


    if (
        first.action ===
        'ask_ready_date'
    ) {

        return {
            type: 'calendar',
            tag: 'ask_ready_date'
        };
    }


    return {
        type: 'text_question',
        field: first.field
    };
}


// ============================================================
// GET MULTIPLE ACTIONS
// ============================================================
//
// Для монтажа + демонтажа по ТЗ нужно показать одновременно.
//
// В обычной последовательной воронке достаточно одной
// следующей кнопки.
//

function getActions(state) {

    const missing =
        calculateMissing(state);

    if (!missing.length) {
        return [];
    }


    const actions = [];


    // Если одновременно нужны монтаж и демонтаж,
    // отдаём обе кнопки.
    const mountMissing =
        missing.find(
            x => x.field === 'mount'
        );

    const demountMissing =
        missing.find(
            x => x.field === 'demount'
        );


    if (
        mountMissing &&
        demountMissing
    ) {

        actions.push({
            type: 'quick_reply',
            tag: 'ask_mount'
        });

        actions.push({
            type: 'quick_reply',
            tag: 'ask_demount'
        });

        return actions;
    }


    const next =
        getNextAction(state);


    if (
        next.type !== 'summary'
    ) {
        actions.push(next);
    }


    return actions;
}


// ============================================================
// DEEPSEEK REQUEST
// ============================================================

async function callDeepSeek(
    messages,
    options = {}
) {

    if (!DEEPSEEK_API_KEY) {

        throw new Error(
            'DEEPSEEK_API_KEY не задан.'
        );
    }


    const response =
        await fetch(
            DEEPSEEK_URL,
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json',

                    'Authorization':
                        `Bearer ${DEEPSEEK_API_KEY}`
                },

                body: JSON.stringify({

                    model:
                        options.model ||
                        DEEPSEEK_MODEL,

                    messages,

                    stream: false,

                    temperature:
                        options.temperature ??
                        0.2,

                    max_tokens:
                        options.max_tokens ||
                        1200
                })
            }
        );


    if (!response.ok) {

        const raw =
            await response.text();

        throw new Error(
            `DeepSeek HTTP ${response.status}: ${raw.slice(0, 1000)}`
        );
    }


    const data =
        await response.json();


    if (data.error) {

        throw new Error(
            `DeepSeek API error: ${
                data.error.message ||
                JSON.stringify(data.error)
            }`
        );
    }


    const content =
        data?.choices?.[0]?.message?.content;


    if (!content) {

        throw new Error(
            'DeepSeek вернул пустой ответ.'
        );
    }


    return String(content).trim();
}


// ============================================================
// PARSE JSON FROM AI
// ============================================================

function extractJSON(text) {

    if (!text) {
        return null;
    }


    // 1. ```json ... ```
    const fenced =
        text.match(
            /```json\s*([\s\S]*?)\s*```/i
        );

    if (fenced) {

        try {
            return JSON.parse(
                fenced[1]
            );
        } catch (_) {}
    }


    // 2. Найти первый объект
    const first =
        text.indexOf('{');

    const last =
        text.lastIndexOf('}');


    if (
        first !== -1 &&
        last !== -1 &&
        last > first
    ) {

        const candidate =
            text.slice(
                first,
                last + 1
            );

        try {
            return JSON.parse(
                candidate
            );
        } catch (_) {}
    }


    return null;
}


// ============================================================
// EXTRACTION PROMPT
// ============================================================

function buildExtractionPrompt(
    state,
    message
) {

    return `
Ты работаешь как модуль извлечения данных для CRM Sales Engine компании MLK.

Твоя задача — НЕ вести диалог и НЕ задавать вопросы.

Твоя задача:
1. внимательно прочитать сообщение клиента;
2. учитывать уже собранные данные;
3. извлечь из НОВОГО сообщения все данные о мероприятии;
4. если клиент исправляет старое значение — вернуть НОВОЕ значение;
5. если клиент явно говорит "не знаю", "пока не знаю", "не определились" — вернуть "unknown";
6. не придумывать отсутствующие данные;
7. вернуть только JSON.

ВАЖНО:
Одно сообщение клиента может содержать сразу много параметров.
Нужно извлечь ВСЕ параметры, которые в нём есть.

ТЕКУЩЕЕ СОСТОЯНИЕ:
${JSON.stringify(state.project, null, 2)}

ИМЯ КЛИЕНТА:
${state.client.name || 'неизвестно'}

НОВОЕ СООБЩЕНИЕ:
${message}

Допустимые eventType:
- concerts = Концерты & Фестивали
- conferences = Конференции & Презентации & TV-проекты
- corporate = Корпоративы & Торжества
- exhibitions = Выставки
- sports = Спортивные мероприятия

Допустимые eventLevel:
- standard
- high
- highest

Допустимые personnel:
- management
- duty_technician
- installation_dismantling
- other

Допустимые place:
- outdoor
- indoor
- covered

Допустимые lift:
- has_lift
- stairs
- unknown

Допустимое оборудование:
- sound
- led
- light
- stage
- all

Допустимый mount:
- any
- night

Допустимый demount:
- any
- deadline

Формат JSON:

{
  "client": {
    "name": null
  },
  "project": {
    "eventType": null,
    "eventLevel": null,
    "guestCount": null,
    "dateStart": null,
    "dateEnd": null,
    "readyDate": null,
    "location": null,
    "place": null,
    "floor": null,
    "lift": null,
    "liftDimensions": null,
    "equipment": [],
    "equipmentDetails": null,
    "personnel": null,
    "personnelDetails": null,
    "mount": null,
    "mountTime": null,
    "demount": null,
    "demountTime": null,
    "clientRequest": null,
    "additionalInfo": null
  }
}

Правила:
- null означает: в НОВОМ сообщении этого параметра нет.
- Не копируй автоматически старое значение.
- Возвращай только то, что удалось извлечь из нового сообщения.
- Если клиент явно исправляет значение, верни новое значение.
- Даты сохраняй максимально точно. Если клиент сказал "20 декабря" и год очевиден из контекста, укажи дату с годом.
- Если точный год нельзя определить надёжно, сохрани фразу клиента.
- guestCount может быть числом, диапазоном/строкой или "unknown".
- floor может быть числом или "unknown".
- clientRequest — краткая суть исходного запроса клиента, если она есть.
- additionalInfo — полезная информация, которая не подходит под остальные поля.

Верни ТОЛЬКО JSON.
`;
}


// ============================================================
// EXTRACT PROJECT DATA
// ============================================================

async function extractProjectData(
    state,
    message
) {

    const prompt =
        buildExtractionPrompt(
            state,
            message
        );


    const raw =
        await callDeepSeek(
            [
                {
                    role: 'system',
                    content:
                        'Ты строгий JSON-модуль извлечения данных. Никогда не добавляй пояснения вне JSON.'
                },

                {
                    role: 'user',
                    content: prompt
                }
            ],
            {
                temperature: 0,
                max_tokens: 1400
            }
        );


    const parsed =
        extractJSON(raw);


    if (!parsed) {

        console.warn(
            '⚠️ Не удалось распарсить extraction JSON:',
            raw
        );

        return {};
    }


    return normalizeExtractedData(
        parsed
    );
}


// ============================================================
// INTENT DETECTION
// ============================================================

async function detectIntent(
    state,
    message
) {

    const prompt = `
Определи намерение клиента в текущем сообщении.

Допустимые значения:

new_request
question
price_question
equipment_question
portfolio_question
objection
correction
manager_request
file_submission

Правила:

new_request:
клиент описывает новое мероприятие или хочет заказать оснащение.

question:
обычный вопрос о работе MLK.

price_question:
клиент спрашивает цену, стоимость, бюджет.

equipment_question:
вопрос именно об оборудовании, технических возможностях, характеристиках.

portfolio_question:
клиент спрашивает об опыте, проектах, кейсах, клиентах, примерах работ.

objection:
сомнение или возражение: дорого, почему так, не уверен, сравниваю, зачем столько и т.п.

correction:
клиент явно исправляет ранее сообщённые данные.

manager_request:
клиент хочет поговорить с человеком / менеджером.

file_submission:
сообщение связано с передачей ТЗ, райдера или файла.

new_request имеет приоритет, если клиент одновременно сообщает новые параметры проекта.

ТЕКУЩЕЕ СОСТОЯНИЕ:
${JSON.stringify(state.project, null, 2)}

СООБЩЕНИЕ:
${message}

Верни только JSON:

{
  "intent": "..."
}
`;


    try {

        const raw =
            await callDeepSeek(
                [
                    {
                        role: 'system',
                        content:
                            'Определи intent и верни только JSON.'
                    },

                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                {
                    temperature: 0,
                    max_tokens: 150
                }
            );


        const parsed =
            extractJSON(raw);


        if (
            parsed &&
            typeof parsed.intent === 'string'
        ) {

            const allowed = [
                'new_request',
                'question',
                'price_question',
                'equipment_question',
                'portfolio_question',
                'objection',
                'correction',
                'manager_request',
                'file_submission'
            ];


            if (
                allowed.includes(
                    parsed.intent
                )
            ) {
                return parsed.intent;
            }
        }

    } catch (error) {

        console.warn(
            '⚠️ Ошибка определения intent:',
            error.message
        );
    }


    return 'new_request';
}


// ============================================================
// RESPONSE PROMPT
// ============================================================
//
// Здесь DeepSeek уже формулирует человеческий ответ.
//
// Но он НЕ имеет права решать:
//   - какой следующий вопрос;
//   - какие кнопки показать;
//   - что считается заполненным.
//

function buildResponsePrompt(
    state,
    clientMessage,
    intent,
    nextAction
) {

    let portfolioBlock = '';

    if (
        intent === 'portfolio_question' ||
        intent === 'equipment_question' ||
        intent === 'question' ||
        intent === 'objection'
    ) {

        if (PORTFOLIO_TEXT) {

            portfolioBlock = `
ПОРТФОЛИО MLK.
Используй только эти реальные проекты.
Ничего не выдумывай.

${PORTFOLIO_TEXT}
`;
        }
    }


    return `
Ты — Дмитрий, менеджер по продажам компании MLK.

Общайся естественно, профессионально и доброжелательно.
Строго на «Вы».
Если имя клиента известно — можно обращаться по имени.

Ты НЕ управляешь воронкой.
Следующий вопрос уже определён программой.

ТЕКУЩИЙ ПРОЕКТ:
${JSON.stringify(state.project, null, 2)}

НАМЕРЕНИЕ КЛИЕНТА:
${intent}

СООБЩЕНИЕ КЛИЕНТА:
${clientMessage}

СЛЕДУЮЩЕЕ ДЕЙСТВИЕ ПРОГРАММЫ:
${JSON.stringify(nextAction, null, 2)}

${portfolioBlock}

ВАЖНЫЕ ПРАВИЛА:

1. Не выдумывай информацию.

2. Не называй цену самостоятельно.
Если клиент спрашивает стоимость, объясни, что точная стоимость зависит от параметров проекта и будет рассчитана менеджером при подготовке КП.

3. MLK работает с техническим оснащением мероприятий «под ключ».
Если клиент просит просто сдать отдельный микрофон, пульт или другое оборудование в аренду — вежливо объясни, что MLK не сдаёт оборудование отдельно, а работает с комплексным техническим обеспечением мероприятия.

4. Если клиент сообщил новые параметры — не задавай повторно вопрос, на который он уже ответил.

5. Если клиент исправил ранее сообщённую информацию — спокойно используй новое значение.

6. Не перечисляй все собранные данные после каждого сообщения.
Итог нужен только когда квалификация полностью закончена.

7. Не используй технические названия вроде "eventType", "missing", "Sales Engine".

8. Не показывай клиенту JSON.

9. Если следующий шаг — вопрос текстом, задай именно этот вопрос естественной фразой.

10. Если следующий шаг — кнопка или календарь, текст должен только подвести к этому действию.
Саму кнопку создавать не нужно.

11. Если информации уже достаточно для ответа на вопрос клиента, сначала ответь на него, затем мягко продолжи квалификацию.

12. Если клиент говорит, что чего-то не знает, не дави на него. Можно принять неизвестное значение и двигаться дальше.

13. Если клиент просит менеджера — не спорь. Подтверди передачу менеджеру.

14. Если речь идёт о портфолио — используй только реальные проекты из переданного портфолио.

15. Не утверждай наличие конкретной модели оборудования, если её нет в предоставленной информации.

16. Не рассчитывай стоимость.

17. Не пиши длинные ответы. Обычно 1–4 коротких абзаца.

Сформулируй только готовый текст ответа клиенту.
`;
}


// ============================================================
// GENERATE NATURAL RESPONSE
// ============================================================

async function generateResponse(
    state,
    clientMessage,
    intent,
    nextAction
) {

    const prompt =
        buildResponsePrompt(
            state,
            clientMessage,
            intent,
            nextAction
        );


    return await callDeepSeek(
        [
            {
                role: 'system',
                content:
                    SYSTEM_PROMPT ||
                    'Ты Дмитрий, менеджер MLK.'
            },

            {
                role: 'user',
                content: prompt
            }
        ],
        {
            temperature: 0.65,
            max_tokens: 800
        }
    );
}


// ============================================================
// TEXT QUESTIONS
// ============================================================

function getTextQuestion(
    field,
    state
) {

    const name =
        state.client.name
            ? `${state.client.name}, `
            : '';


    switch (field) {

        case 'guestCount':
            return `${name}подскажите, пожалуйста, сколько гостей планируется на мероприятии?`;


        case 'personnelDetails':
            return `${name}подскажите, пожалуйста, какой именно персонал Вам потребуется?`;


        case 'floor':
            return `${name}подскажите, пожалуйста, на каком этаже будет проходить мероприятие?`;


        case 'liftDimensions':
            return `${name}подскажите, пожалуйста, размеры грузового лифта (ширина × глубина × высота), если они известны.`;


        case 'location':
            return `${name}подскажите, пожалуйста, точный адрес проведения мероприятия.`;


        case 'mountTime':
            return `${name}подскажите, пожалуйста, до какого времени должен завершиться ночной/ранний монтаж? Например: 06:00.`;


        case 'demountTime':
            return `${name}подскажите, пожалуйста, до какого времени должен завершиться демонтаж? Например: 18:00.`;


        default:
            return `${name}подскажите, пожалуйста, эту информацию.`;
    }
}


// ============================================================
// ACTION QUESTION OVERRIDE
// ============================================================
//
// Важный момент.
//
// Для обязательных вопросов мы не позволяем DeepSeek
// случайно спросить что-то другое.
//
// Но перед вопросом можно использовать natural response,
// если это вопрос клиента.
//

function buildControlledQuestion(
    action,
    state
) {

    if (!action) {
        return null;
    }


    if (
        action.type ===
        'text_question'
    ) {

        return getTextQuestion(
            action.field,
            state
        );
    }


    switch (action.tag) {

        case 'ask_format':
            return 'Подскажите, пожалуйста, какой формат мероприятия планируется.';


        case 'ask_level':
            return 'Подскажите, пожалуйста, какой уровень требований у мероприятия.';


        case 'ask_personnel':
            return 'Какой персонал потребуется на мероприятии?';


        case 'ask_place':
            return 'Где будет проходить мероприятие — на улице, в помещении или под навесом?';


        case 'ask_lift':
            return 'Есть ли на объекте грузовой лифт для подъёма оборудования?';


        case 'ask_equipment':
            return 'Какое оборудование необходимо? Можно выбрать несколько вариантов.';


        case 'ask_mount':
            return 'Какое время монтажа Вам подходит — любое по согласованию или ночью/рано утром?';


        case 'ask_demount':
            return 'Какое время демонтажа Вам подходит — любое по согласованию или до определённого времени?';


        case 'ask_date_start':
            return 'Укажите, пожалуйста, дату начала мероприятия.';


        case 'ask_date_end':
            return 'Укажите, пожалуйста, дату окончания мероприятия.';


        case 'ask_ready_date':
            return 'И к какой дате и времени оборудование должно быть полностью готово?';


        default:
            return null;
    }
}


// ============================================================
// MANAGER SUMMARY
// ============================================================

function buildManagerSummary(
    state
) {

    const p =
        state.project;


    const lines = [];


    lines.push(
        'ЗАЯВКА MLK'
    );


    lines.push(
        ''
    );


    lines.push(
        `Клиент: ${
            state.client.name ||
            'Не указано'
        }`
    );


    lines.push(
        `ID: ${
            state.client.id ||
            'Не указан'
        }`
    );


    lines.push(
        ''
    );


    lines.push(
        'МЕРОПРИЯТИЕ:'
    );


    lines.push(
        `Формат: ${
            getEventLabel(
                p.eventType
            )
        }`
    );


    if (
        p.eventLevel
    ) {

        lines.push(
            `Уровень: ${
                getLevelLabel(
                    p.eventLevel
                )
            }`
        );
    }


    if (
        p.guestCount !== null
    ) {

        lines.push(
            `Количество гостей: ${
                p.guestCount
            }`
        );
    }


    lines.push(
        `Персонал: ${
            getPersonnelLabel(
                p.personnel
            )
        }`
    );


    if (
        p.personnelDetails
    ) {

        lines.push(
            `Персонал / детали: ${
                p.personnelDetails
            }`
        );
    }


    lines.push(
        ''
    );


    lines.push(
        'ДАТЫ:'
    );


    lines.push(
        `Начало: ${
            p.dateStart || 'Не указано'
        }`
    );


    lines.push(
        `Окончание: ${
            p.dateEnd || 'Не указано'
        }`
    );


    lines.push(
        `Готовность: ${
            p.readyDate || 'Не указано'
        }`
    );


    lines.push(
        ''
    );


    lines.push(
        'МЕСТО:'
    );


    lines.push(
        `Адрес: ${
            p.location || 'Не указано'
        }`
    );


    lines.push(
        `Тип места: ${
            getPlaceLabel(
                p.place
            )
        }`
    );


    if (
        p.floor !== null
    ) {

        lines.push(
            `Этаж: ${p.floor}`
        );
    }


    if (
        p.lift
    ) {

        lines.push(
            `Лифт: ${
                p.lift === 'has_lift'
                    ? 'Есть грузовой лифт'
                    : p.lift === 'stairs'
                        ? 'Носить по лестнице'
                        : p.lift
            }`
        );
    }


    if (
        p.liftDimensions
    ) {

        lines.push(
            `Размеры лифта: ${
                p.liftDimensions
            }`
        );
    }


    lines.push(
        ''
    );


    lines.push(
        'ОБОРУДОВАНИЕ:'
    );


    if (
        Array.isArray(p.equipment) &&
        p.equipment.length
    ) {

        for (
            const item of
            getEquipmentLabels(
                p.equipment
            )
        ) {

            lines.push(
                `• ${item}`
            );
        }

    } else {

        lines.push(
            'Не указано'
        );
    }


    if (
        p.equipmentDetails
    ) {

        lines.push(
            `Дополнительно: ${
                p.equipmentDetails
            }`
        );
    }


    lines.push(
        ''
    );


    lines.push(
        'МОНТАЖ / ДЕМОНТАЖ:'
    );


    lines.push(
        `Монтаж: ${
            MOUNT[p.mount]?.label ||
            p.mount ||
            'Не указано'
        }`
    );


    if (
        p.mountTime
    ) {

        lines.push(
            `Время монтажа: ${
                p.mountTime
            }`
        );
    }


    lines.push(
        `Демонтаж: ${
            DEMOUNT[p.demount]?.label ||
            p.demount ||
            'Не указано'
        }`
    );


    if (
        p.demountTime
    ) {

        lines.push(
            `Время демонтажа: ${
                p.demountTime
            }`
        );
    }


    lines.push(
        ''
    );


    if (
        p.clientRequest
    ) {

        lines.push(
            'ЗАПРОС КЛИЕНТА:'
        );

        lines.push(
            p.clientRequest
        );

        lines.push(
            ''
        );
    }


    if (
        p.additionalInfo
    ) {

        lines.push(
            'ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ:'
        );

        lines.push(
            p.additionalInfo
        );

        lines.push(
            ''
        );
    }


    lines.push(
        'Статус: готово к подготовке КП'
    );


    lines.push(
        'КП готовится в рабочие дни: Пн–Пт, 9:00–17:00.'
    );


    return lines.join('\n');
}


// ============================================================
// SUMMARY FOR CLIENT
// ============================================================

function buildClientSummary(
    state
) {

    const p =
        state.project;


    const lines = [];


    const name =
        state.client.name
            ? `${state.client.name}, `
            : '';


    lines.push(
        `${name}подведу итог по мероприятию:`
    );


    lines.push('');


    lines.push(
        `• Формат: ${getEventLabel(p.eventType)}`
    );


    if (
        p.eventLevel
    ) {

        lines.push(
            `• Уровень: ${getLevelLabel(p.eventLevel)}`
        );
    }


    if (
        p.guestCount !== null
    ) {

        lines.push(
            `• Гостей: ${p.guestCount}`
        );
    }


    lines.push(
        `• Персонал: ${getPersonnelLabel(p.personnel)}`
    );


    if (
        p.personnelDetails
    ) {

        lines.push(
            `• Персонал: ${p.personnelDetails}`
        );
    }


    lines.push(
        `• Дата начала: ${p.dateStart}`
    );


    lines.push(
        `• Дата окончания: ${p.dateEnd}`
    );


    lines.push(
        `• Готовность оборудования: ${p.readyDate}`
    );


    lines.push(
        `• Адрес: ${p.location}`
    );


    lines.push(
        `• Место: ${getPlaceLabel(p.place)}`
    );


    if (
        p.floor !== null
    ) {

        lines.push(
            `• Этаж: ${p.floor}`
        );
    }


    if (
        p.lift
    ) {

        lines.push(
            `• Подъём оборудования: ${
                p.lift === 'has_lift'
                    ? 'грузовой лифт'
                    : p.lift === 'stairs'
                        ? 'по лестнице'
                        : p.lift
            }`
        );
    }


    if (
        p.liftDimensions
    ) {

        lines.push(
            `• Размеры лифта: ${p.liftDimensions}`
        );
    }


    lines.push(
        `• Оборудование: ${
            getEquipmentLabels(
                p.equipment
            ).join(', ')
        }`
    );


    lines.push(
        `• Монтаж: ${
            MOUNT[p.mount]?.label ||
            p.mount
        }`
    );


    if (
        p.mountTime
    ) {

        lines.push(
            `• Время монтажа: ${p.mountTime}`
        );
    }


    lines.push(
        `• Демонтаж: ${
            DEMOUNT[p.demount]?.label ||
            p.demount
        }`
    );


    if (
        p.demountTime
    ) {

        lines.push(
            `• Время демонтажа: ${p.demountTime}`
        );
    }


    lines.push('');


    lines.push(
        'Спасибо! Все основные данные собраны. На их основе отдел подготовки КП сможет подготовить предложение.'
    );


    lines.push(
        'КП готовится в рабочие дни: Пн–Пт, 9:00–17:00.'
    );


    return lines.join('\n');
}


// ============================================================
// STAGE
// ============================================================

function calculateStage(
    state,
    intent,
    missing
) {

    if (
        intent === 'manager_request'
    ) {
        return 'manager_handoff';
    }


    if (
        !state.history.length
    ) {
        return 'greeting';
    }


    if (
        !missing.length
    ) {
        return 'summary';
    }


    if (
        intent === 'objection'
    ) {
        return 'objection';
    }


    if (
        intent === 'question' ||
        intent === 'equipment_question' ||
        intent === 'portfolio_question'
    ) {
        return 'clarification';
    }


    return 'qualification';
}


// ============================================================
// FILE MESSAGE NORMALIZATION
// ============================================================

function normalizeMessage(message) {

    if (
        typeof message === 'string'
    ) {

        return {
            type: 'text',
            text: message.trim()
        };
    }


    if (
        !message ||
        typeof message !== 'object'
    ) {

        return {
            type: 'text',
            text: ''
        };
    }


    return {
        type:
            message.type ||
            'text',

        text:
            message.text ||
            '',

        tag:
            message.tag ||
            null,

        value:
            message.value ??
            null,

        fileName:
            message.fileName ||
            null,

        fileText:
            message.fileText ||
            ''
    };
}


// ============================================================
// ACTION -> HUMAN TEXT FOR AI
// ============================================================

function actionToText(
    message
) {

    if (
        message.type !== 'action'
    ) {
        return '';
    }


    const map = {

        ask_format: {
            concerts:
                'Формат: Концерты & Фестивали',

            conferences:
                'Формат: Конференции & Презентации & TV-проекты',

            corporate:
                'Формат: Корпоративы & Торжества',

            exhibitions:
                'Формат: Выставки',

            sports:
                'Формат: Спортивные мероприятия'
        },

        ask_level: {
            standard:
                'Уровень: Стандартный',

            high:
                'Уровень: Высокие требования',

            highest:
                'Уровень: Высший уровень'
        },

        ask_personnel: {
            management:
                'Персонал: Управление оборудованием',

            duty_technician:
                'Персонал: Дежурный техник',

            installation_dismantling:
                'Персонал: Только монтаж-демонтаж',

            other:
                'Персонал: Другое'
        },

        ask_place: {
            outdoor:
                'Место: Улица',

            indoor:
                'Место: Помещение',

            covered:
                'Место: Под навесом'
        },

        ask_lift: {
            has_lift:
                'Подъём: Есть грузовой лифт',

            stairs:
                'Подъём: Нужно носить по лестнице',

            unknown:
                'Подъём: Неизвестно'
        },

        ask_mount: {
            any:
                'Монтаж: Любое по согласованию',

            night:
                'Монтаж: Ночью/рано утром'
        },

        ask_demount: {
            any:
                'Демонтаж: Любое по согласованию',

            deadline:
                'Демонтаж: До определённого времени'
        }
    };


    const tag =
        message.tag;

    const value =
        String(
            message.value ??
            ''
        );


    if (
        map[tag] &&
        map[tag][value]
    ) {
        return map[tag][value];
    }


    // Equipment
    if (
        tag === 'ask_equipment'
    ) {

        if (
            Array.isArray(
                message.value
            )
        ) {

            return `Выбрано оборудование: ${
                getEquipmentLabels(
                    message.value
                ).join(', ')
            }`;
        }

        if (
            value === 'done'
        ) {
            return 'Оборудование выбрано.';
        }
    }


    return `${tag}: ${value}`;
}


// ============================================================
// PROCESS START
// ============================================================

async function processStart(
    clientId,
    clientName
) {

    const state =
        resetSalesClient(
            clientId,
            clientName
        );


    const name =
        clientName ||
        'клиент';


    const text =
        `Здравствуйте, ${name}! Рад приветствовать вас в MLK. Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».

Если у вас есть готовое техническое задание, райдер или любые другие файлы, вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.

Если же вы пока не знаете всех деталей, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.

С чего начнём?`;


    addHistory(
        state,
        'assistant',
        text
    );


    const actions = [
        {
            type: 'quick_reply',
            tag: 'send_files'
        },

        {
            type: 'quick_reply',
            tag: 'ask_format'
        }
    ];


    state.stage = 'qualification';
    state.lastAction = actions[1];
    state.updatedAt =
        new Date().toISOString();


    return {
        text,
        actions,
        project: state.project,
        missing: calculateMissing(state),
        stage: state.stage,
        intent: 'new_request',
        readyForManager: false,
        managerSummary: null
    };
}


// ============================================================
// MAIN API
// ============================================================

async function processSalesMessage(
    clientId,
    message
) {

    const normalized =
        normalizeMessage(
            message
        );


    const state =
        getSalesState(
            clientId
        );


    state.updatedAt =
        new Date().toISOString();


    // ========================================================
    // START
    // ========================================================

    if (
        normalized.type === 'start'
    ) {

        return processStart(
            clientId,
            normalized.clientName ||
                state.client.name ||
                ''
        );
    }


    // ========================================================
    // FILE
    // ========================================================

    if (
        normalized.type === 'file'
    ) {

        const fileText =
            normalized.fileText ||
            normalized.text ||
            '';


        addHistory(
            state,
            'user',
            `[Файл: ${
                normalized.fileName ||
                'без названия'
            }] ${fileText}`
        );


        // Если из файла удалось получить текст,
        // отправляем его в extraction.
        if (fileText) {

            try {

                const extracted =
                    await extractProjectData(
                        state,
                        fileText
                    );

                mergeProjectData(
                    state,
                    extracted
                );

            } catch (error) {

                console.warn(
                    '⚠️ Ошибка extraction файла:',
                    error.message
                );
            }
        }


        const missing =
            calculateMissing(
                state
            );


        state.intent =
            'file_submission';


        state.stage =
            missing.length
                ? 'qualification'
                : 'summary';


        const text =
            missing.length
                ? 'Спасибо, файл получил. Я учту информацию из него при подготовке заявки. Если каких-то данных будет не хватать, я уточню их.'
                : buildClientSummary(state);


        addHistory(
            state,
            'assistant',
            text
        );


        const actions =
            missing.length
                ? getActions(state)
                : [];


        if (
            !missing.length
        ) {

            state.lastAction = {
                type: 'summary'
            };

        } else {

            state.lastAction =
                actions[0] ||
                null;
        }


        return {
            text,
            actions,
            project: state.project,
            missing,
            stage: state.stage,
            intent: state.intent,
            readyForManager:
                missing.length === 0,
            managerSummary:
                missing.length === 0
                    ? buildManagerSummary(state)
                    : null
        };
    }


    // ========================================================
    // ACTION / BUTTON
    // ========================================================

    let clientText =
        normalized.text;


    if (
        normalized.type === 'action'
    ) {

        clientText =
            actionToText(
                normalized
            );
    }


    clientText =
        String(
            clientText || ''
        ).trim();


    if (!clientText) {

        throw new Error(
            'processSalesMessage: пустое сообщение клиента.'
        );
    }


    // ========================================================
    // HISTORY
    // ========================================================

    addHistory(
        state,
        'user',
        clientText,
        {
            inputType:
                normalized.type
        }
    );


    // ========================================================
    // FIRST USER REQUEST
    // ========================================================

    const isFirstUserMessage =
        state.history.filter(
            item =>
                item.role === 'user'
        ).length === 1;


    // ========================================================
    // EXTRACTION
    // ========================================================

    let extracted = {};


    try {

        extracted =
            await extractProjectData(
                state,
                clientText
            );

    } catch (error) {

        console.error(
            '❌ Sales extraction error:',
            error.message
        );
    }


    // ========================================================
    // SAVE INITIAL REQUEST
    // ========================================================

    if (
        !state.project.clientRequest &&
        (
            extracted.clientRequest ||
            isFirstUserMessage
        )
    ) {

        state.project.clientRequest =
            extracted.clientRequest ||
            clientText;
    }


    // ========================================================
    // MERGE
    // ========================================================

    mergeProjectData(
        state,
        extracted
    );


    // ========================================================
    // INTENT
    // ========================================================

    let intent =
        normalized.intent ||
        null;


    if (!intent) {

        try {

            intent =
                await detectIntent(
                    state,
                    clientText
                );

        } catch (error) {

            console.warn(
                '⚠️ Intent error:',
                error.message
            );

            intent =
                'new_request';
        }
    }


    state.intent =
        intent;


    // ========================================================
    // MANAGER REQUEST
    // ========================================================

    if (
        intent ===
        'manager_request'
    ) {

        state.stage =
            'manager_handoff';


        const text =
            'Конечно. Я передам запрос менеджеру, чтобы он связался с Вами и продолжил обсуждение.';


        addHistory(
            state,
            'assistant',
            text
        );


        state.lastAction = {
            type: 'manager_handoff'
        };


        return {
            text,
            actions: [
                {
                    type:
                        'manager_handoff'
                }
            ],
            project: state.project,
            missing:
                calculateMissing(state),
            stage:
                state.stage,
            intent,
            readyForManager:
                false,
            managerSummary:
                buildManagerSummary(state)
        };
    }


    // ========================================================
    // MISSING
    // ========================================================

    const missing =
        calculateMissing(
            state
        );


    // ========================================================
    // COMPLETE
    // ========================================================

    if (
        missing.length === 0
    ) {

        state.stage =
            'summary';


        const text =
            buildClientSummary(
                state
            );


        addHistory(
            state,
            'assistant',
            text
        );


        state.lastAction = {
            type: 'summary'
        };


        return {
            text,
            actions: [],
            project: state.project,
            missing: [],
            stage: 'summary',
            intent,
            readyForManager: true,
            managerSummary:
                buildManagerSummary(
                    state
                )
        };
    }


    // ========================================================
    // NEXT ACTION
    // ========================================================

    const actions =
        getActions(
            state
        );


    const nextAction =
        actions[0] ||
        null;


    // ========================================================
    // NATURAL RESPONSE
    // ========================================================

    let text = '';


    try {

        // Если клиент просто сообщил данные,
        // можно дать короткий естественный ответ.
        //
        // Если же это обычный вопрос / возражение /
        // вопрос об оборудовании / портфолио —
        // DeepSeek должен сначала ответить по сути.

        text =
            await generateResponse(
                state,
                clientText,
                intent,
                nextAction
            );

    } catch (error) {

        console.error(
            '❌ Sales response error:',
            error.message
        );


        // Безопасный fallback:
        text =
            'Спасибо, информацию зафиксировал.';
    }


    // ========================================================
    // CONTROLLED NEXT QUESTION
    // ========================================================
    //
    // Важно:
    // если AI случайно задал другой вопрос,
    // мы не доверяем ему управление воронкой.
    //
    // Для qualification-сообщений добавляем
    // контролируемый следующий вопрос.
    //

    const needsControlledQuestion =
        (
            intent === 'new_request' ||
            intent === 'correction'
        );


    if (
        needsControlledQuestion &&
        nextAction
    ) {

        const controlled =
            buildControlledQuestion(
                nextAction,
                state
            );


        if (controlled) {

            // Если AI уже практически задал тот же
            // вопрос, не дублируем.
            const lowerAI =
                text.toLowerCase();


            const lowerControlled =
                controlled.toLowerCase();


            const hasUsefulQuestion =
                lowerAI.includes('?') &&
                (
                    lowerAI.includes(
                        lowerControlled
                            .slice(0, 20)
                    )
                );


            if (!hasUsefulQuestion) {

                text =
                    `${text}\n\n${controlled}`;
            }
        }
    }


    // ========================================================
    // STAGE
    // ========================================================

    state.stage =
        calculateStage(
            state,
            intent,
            missing
        );


    state.lastAction =
        nextAction;


    // ========================================================
    // HISTORY
    // ========================================================

    addHistory(
        state,
        'assistant',
        text
    );


    // ========================================================
    // RETURN
    // ========================================================

    return {
        text,

        actions,

        project:
            state.project,

        missing,

        stage:
            state.stage,

        intent,

        readyForManager:
            false,

        managerSummary:
            buildManagerSummary(
                state
            )
    };
}


// ============================================================
// DEBUG / TEST HELPERS
// ============================================================

function getDebugState(
    clientId
) {

    const state =
        salesStates.get(
            String(clientId || '')
        );


    if (!state) {
        return null;
    }


    return JSON.parse(
        JSON.stringify(state)
    );
}


function listSalesClients() {

    return [
        ...salesStates.keys()
    ];
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    // Main API
    processSalesMessage,

    // State
    createSalesState,
    getSalesState,
    resetSalesClient,
    deleteSalesClient,

    // History
    addHistory,
    getHistory,

    // Funnel
    calculateMissing,
    getNextAction,
    getActions,

    // Summary
    buildManagerSummary,
    buildClientSummary,

    // AI modules
    extractProjectData,
    detectIntent,

    // Constants
    EVENT_TYPES,
    LEVELS,
    PERSONNEL,
    PLACES,
    EQUIPMENT,
    MOUNT,
    DEMOUNT,

    // Debug
    getDebugState,
    listSalesClients
};