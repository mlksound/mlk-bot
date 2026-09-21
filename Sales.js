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
    // FLOOR / LIFT
    // --------------------------------------------------------

    if (
        p.place !== 'indoor'
    ) {
        p.floor = null;
        p.lift = null;
        p.liftDimensions = null;
    }


    // --------------------------------------------------------
    // LIFT DIMENSIONS
    // --------------------------------------------------------

    if (
        p.lift !== 'has_lift'
    ) {
        p.liftDimensions = null;
    }


    // --------------------------------------------------------
    // MOUNT TIME
    // --------------------------------------------------------

    if (
        p.mount !== 'night'
    ) {
        p.mountTime = null;
    }


    // --------------------------------------------------------
    // DEMOUNT TIME
    // --------------------------------------------------------

    if (
        p.demount !== 'deadline'
    ) {
        p.demountTime = null;
    }
}


// ============================================================
// CALCULATE MISSING
// ============================================================
//
// Порядок здесь — это фактический порядок воронки.
//
// 1. Формат
// 2. Уровень / гости
// 3. Персонал
// 4. Даты
// 5. Адрес
// 6. Место
// 7. Этаж
// 8. Лифт
// 9. Размеры лифта
// 10. Оборудование
// 11. Монтаж
// 12. Демонтаж
//
// Важно:
// функция возвращает только ПЕРВОЕ реально необходимое
// действие, кроме специальных случаев.
//

function calculateMissing(state) {

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
    // 2. LEVEL / GUEST COUNT
    // --------------------------------------------------------

    if (
        p.eventType === 'concerts' ||
        p.eventType === 'sports'
    ) {

        if (!p.eventLevel) {

            missing.push({
                field: 'eventLevel',
                action: 'ask_level'
            });

            return missing;
        }

    } else if (
        p.eventType === 'corporate'
    ) {

        if (
            p.guestCount === null ||
            p.guestCount === undefined
        ) {

            missing.push({
                field: 'guestCount',
                action: 'ask_guest_count'
            });

            return missing;
        }
    }


    // --------------------------------------------------------
    // 3. PERSONNEL
    // --------------------------------------------------------

    if (!p.personnel) {

        missing.push({
            field: 'personnel',
            action: 'ask_personnel'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 4. DATES
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
    // 5. LOCATION
    // --------------------------------------------------------

    if (!p.location) {

        missing.push({
            field: 'location',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 6. PLACE
    // --------------------------------------------------------

    if (!p.place) {

        missing.push({
            field: 'place',
            action: 'ask_place'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 7. FLOOR
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
    // 8. LIFT
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
    // 9. LIFT DIMENSIONS
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
    // 10. EQUIPMENT
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
    // 11. MOUNT
    // --------------------------------------------------------

    if (!p.mount) {

        missing.push({
            field: 'mount',
            action: 'ask_mount'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 12. DEMOUNT
    // --------------------------------------------------------

    if (!p.demount) {

        missing.push({
            field: 'demount',
            action: 'ask_demount'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 13. NIGHT / EARLY MOUNT TIME
    // --------------------------------------------------------

    if (
        p.mount === 'night' &&
        !p.mountTime
    ) {

        missing.push({
            field: 'mountTime',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 14. DEMOUNT DEADLINE
    // --------------------------------------------------------

    if (
        p.demount === 'deadline' &&
        !p.demountTime
    ) {

        missing.push({
            field: 'demountTime',
            action: 'text_question'
        });

        return missing;
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
        'ask_guest_count'
    ) {

        return {
            type: 'text_question',
            field: 'guestCount'
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


    // 2. Находим первый JSON object
    const firstBrace =
        text.indexOf('{');

    const lastBrace =
        text.lastIndexOf('}');


    if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
    ) {

        const candidate =
            text.slice(
                firstBrace,
                lastBrace + 1
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
// DEEPSEEK EXTRACTION
// ============================================================

async function extractClientData(
    state,
    userText
) {

    const system = `
Ты — аналитический слой AI-консультанта MLK.

Твоя задача — НЕ вести диалог и НЕ задавать вопросы.

Твоя задача — только определить, какую информацию о клиенте
и проекте он сообщил в последнем сообщении.

Верни ТОЛЬКО JSON.

Разрешённые значения:

eventType:
- concerts
- conferences
- corporate
- exhibitions
- sports

eventLevel:
- standard
- high
- highest

place:
- outdoor
- indoor
- covered

lift:
- has_lift
- stairs
- unknown

personnel:
- management
- duty_technician
- installation_dismantling
- other

mount:
- any
- night

demount:
- any
- deadline

equipment:
- sound
- led
- light
- stage
- all

Если поле в последнем сообщении НЕ было указано —
НЕ включай его в JSON.

Если клиент явно сказал, что не знает значение,
можно использовать "unknown".

Если клиент исправляет ранее сказанное значение —
верни новое значение.

Структура:

{
  "client": {
    "name": "..."
  },
  "project": {
    "eventType": "...",
    "eventLevel": "...",
    "guestCount": 0,
    "dateStart": "YYYY-MM-DD",
    "dateEnd": "YYYY-MM-DD",
    "readyDate": "YYYY-MM-DD",
    "location": "...",
    "place": "...",
    "floor": 3,
    "lift": "...",
    "liftDimensions": "...",
    "equipment": [],
    "equipmentDetails": "...",
    "personnel": "...",
    "personnelDetails": "...",
    "mount": "...",
    "mountTime": "...",
    "demount": "...",
    "demountTime": "...",
    "clientRequest": "...",
    "additionalInfo": "..."
  }
}

Важно:

- Не додумывай.
- Не извлекай информацию из старой истории, если её нет
  в последнем сообщении.
- Не меняй значения только потому, что они кажутся логичными.
- Даты приводи к YYYY-MM-DD, если дата однозначно понятна.
`;


    const context = {
        currentProject:
            state.project,

        currentClient:
            state.client,

        userMessage:
            userText
    };


    const messages = [

        {
            role: 'system',
            content: system
        },

        {
            role: 'user',
            content:
                JSON.stringify(
                    context,
                    null,
                    2
                )
        }

    ];


    const raw =
        await callDeepSeek(
            messages,
            {
                temperature: 0,
                max_tokens: 1000
            }
        );


    const parsed =
        extractJSON(raw);


    if (!parsed) {

        console.warn(
            '⚠️ Sales Engine: DeepSeek не вернул JSON:',
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
    userText
) {

    const system = `
Определи намерение последнего сообщения клиента
в контексте диалога с консультантом MLK.

Верни ТОЛЬКО JSON:

{
  "intent": "..."
}

Разрешённые значения:

- qualification
- question
- equipment_question
- portfolio_question
- objection
- manager_request
- greeting
- correction
- other

Правила:

qualification —
клиент сообщает данные проекта.

question —
клиент задаёт общий вопрос.

equipment_question —
вопрос про оборудование, технические возможности,
комплектацию.

portfolio_question —
вопрос о реализованных проектах MLK.

objection —
сомнение, возражение, недоверие.

manager_request —
клиент прямо просит менеджера / человека.

correction —
клиент исправляет ранее сообщённые данные.

greeting —
приветствие без содержательной информации.

other —
если ничего выше не подходит.

Не додумывай.
`;


    const messages = [

        {
            role: 'system',
            content: system
        },

        {
            role: 'user',
            content:
                JSON.stringify({
                    project:
                        state.project,

                    history:
                        state.history.slice(
                            -10
                        ),

                    message:
                        userText
                })
        }

    ];


    try {

        const raw =
            await callDeepSeek(
                messages,
                {
                    temperature: 0,
                    max_tokens: 100
                }
            );


        const parsed =
            extractJSON(raw);


        if (
            parsed &&
            parsed.intent
        ) {
            return String(
                parsed.intent
            );
        }

    } catch (error) {

        console.warn(
            '⚠️ Ошибка определения intent:',
            error.message
        );
    }


    return 'other';
}


// ============================================================
// BUILD AI CONTEXT
// ============================================================

function buildSalesContext(
    state
) {

    return {

        client: state.client,

        project: state.project,

        intent: state.intent,

        missing: state.missing,

        stage: state.stage,

        history:
            state.history.slice(
                -MAX_HISTORY
            )

    };
}


// ============================================================
// BUILD CONTROLLED QUESTION
// ============================================================
//
// Здесь JS определяет, ЧТО спрашивать.
//
// DeepSeek определяет только КАК это сформулировать.
//

function buildControlledQuestion(
    state
) {

    const missing =
        calculateMissing(state);

    if (!missing.length) {
        return null;
    }


    const first =
        missing[0];


    switch (first.field) {

        case 'eventType':
            return 'Подскажите, пожалуйста, какой у вас формат мероприятия?';

        case 'eventLevel':
            return 'Какой уровень технического оснащения планируется?';

        case 'guestCount':
            return 'Подскажите, пожалуйста, ориентировочное количество гостей.';

        case 'personnel':
            return 'Какой формат технического персонала вам нужен?';

        case 'dateStart':
            return 'Выберите, пожалуйста, дату начала мероприятия.';

        case 'dateEnd':
            return 'Выберите, пожалуйста, дату окончания мероприятия.';

        case 'readyDate':
            return 'К какой дате оборудование должно быть готово на площадке?';

        case 'location':
            return 'Подскажите, пожалуйста, адрес площадки.';

        case 'place':
            return 'Мероприятие будет проходить на улице или в помещении?';

        case 'floor':
            return 'На каком этаже находится площадка?';

        case 'lift':
            return 'Есть ли на площадке грузовой лифт?';

        case 'liftDimensions':
            return 'Подскажите, пожалуйста, размеры грузового лифта.';

        case 'equipment':
            return 'Какое оборудование вам необходимо?';

        case 'mount':
            return 'Когда удобно выполнить монтаж?';

        case 'demount':
            return 'Когда планируется демонтаж?';

        case 'mountTime':
            return 'Подскажите, пожалуйста, во сколько можно начать монтаж.';

        case 'demountTime':
            return 'До какого времени необходимо завершить демонтаж?';

        default:
            return 'Подскажите, пожалуйста, дополнительную информацию по проекту.';
    }
}


// ============================================================
// BUILD AI RESPONSE
// ============================================================

async function generateAssistantText(
    state,
    userText
) {

    const controlledQuestion =
        buildControlledQuestion(
            state
        );


    const salesContext =
        buildSalesContext(
            state
        );


    const system = `
${SYSTEM_PROMPT}

------------------------------------------------------------
SALES ENGINE CONTEXT
------------------------------------------------------------

Ты работаешь внутри Sales Engine MLK.

Текущий контекст проекта:

${JSON.stringify(
    salesContext,
    null,
    2
)}

------------------------------------------------------------
ВАЖНЫЕ ПРАВИЛА
------------------------------------------------------------

1. JS Sales Engine является источником истины
   по состоянию проекта и порядку квалификации.

2. Не задавай повторно вопросы, на которые уже есть ответ.

3. Не придумывай оборудование, цены, кейсы,
   характеристики или условия.

4. Не называй стоимость, если она не предоставлена
   явно в исходных данных.

5. Если клиент спрашивает о портфолио —
   используй только portfolio.txt.

6. Если клиент задал содержательный вопрос,
   сначала ответь на него, а затем мягко продолжи
   квалификацию.

7. Если клиент исправляет информацию —
   принимай новую информацию без спора.

8. Если следующий обязательный вопрос определён JS,
   не заменяй его другим вопросом.

9. Не перечисляй клиенту всю внутреннюю структуру
   Sales Engine.

10. Общайся естественно, коротко и по делу.

------------------------------------------------------------
ТЕКУЩИЙ КОНТРОЛИРУЕМЫЙ ВОПРОС
------------------------------------------------------------

${
    controlledQuestion ||
    'Квалификация завершена.'
}

------------------------------------------------------------
PORTFOLIO
------------------------------------------------------------

${PORTFOLIO_TEXT}
`;


    const messages = [

        {
            role: 'system',
            content: system
        }

    ];


    // История разговора
    for (
        const item of
        state.history.slice(
            -12
        )
    ) {

        if (
            item.role === 'user'
        ) {

            messages.push({
                role: 'user',
                content:
                    item.content
            });

        } else if (
            item.role === 'assistant'
        ) {

            messages.push({
                role: 'assistant',
                content:
                    item.content
            });
        }
    }


    // Текущее сообщение
    if (userText) {

        messages.push({
            role: 'user',
            content: userText
        });
    }


    try {

        return await callDeepSeek(
            messages,
            {
                temperature: 0.4,
                max_tokens: 700
            }
        );

    } catch (error) {

        console.error(
            '❌ Sales Engine DeepSeek response error:',
            error.message
        );


        // Даже если DeepSeek временно недоступен,
        // Sales Engine продолжает управлять воронкой.

        return controlledQuestion ||
            'Подскажите, пожалуйста, дополнительную информацию по проекту.';
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
        'ЗАЯВКА MLK — ГОТОВА К ПОДГОТОВКЕ КП'
    );

    lines.push('');


    // --------------------------------------------------------
    // CLIENT
    // --------------------------------------------------------

    lines.push(
        `Клиент: ${
            state.client.name ||
            'Не указано'
        }`
    );

    lines.push('');


    // --------------------------------------------------------
    // EVENT
    // --------------------------------------------------------

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


    lines.push('');


    // --------------------------------------------------------
    // DATES
    // --------------------------------------------------------

    lines.push(
        'ДАТЫ:'
    );


    lines.push(
        `Начало: ${
            p.dateStart ||
            'Не указано'
        }`
    );


    lines.push(
        `Окончание: ${
            p.dateEnd ||
            'Не указано'
        }`
    );


    lines.push(
        `Готовность: ${
            p.readyDate ||
            'Не указано'
        }`
    );


    lines.push('');


    // --------------------------------------------------------
    // LOCATION
    // --------------------------------------------------------

    lines.push(
        'МЕСТО:'
    );


    lines.push(
        `Адрес: ${
            p.location ||
            'Не указано'
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


    lines.push('');


    // --------------------------------------------------------
    // EQUIPMENT
    // --------------------------------------------------------

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


    lines.push('');


    // --------------------------------------------------------
    // MOUNT / DEMOUNT
    // --------------------------------------------------------

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


    lines.push('');


    if (
        p.clientRequest
    ) {

        lines.push(
            'ЗАПРОС КЛИЕНТА:'
        );

        lines.push(
            p.clientRequest
        );

        lines.push('');
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

        lines.push('');
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
        `• Тип места: ${getPlaceLabel(p.place)}`
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
            `• Лифт: ${
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
            `• Размеры лифта: ${p.liftDimensions}`
        );
    }


    lines.push('');


    lines.push(
        '• Оборудование:'
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
                `  — ${item}`
            );
        }

    } else {

        lines.push(
            '  — Не указано'
        );
    }


    if (
        p.equipmentDetails
    ) {

        lines.push(
            `• Дополнительно: ${p.equipmentDetails}`
        );
    }


    lines.push('');


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
        'Все основные данные зафиксированы.'
    );


    lines.push(
        'Мы передадим информацию в отдел подготовки КП.'
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
                'Подъём: Не знаю'
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
        },


        ask_equipment: {

            sound:
                'Оборудование: Звуковое оборудование',

            led:
                'Оборудование: Светодиодные экраны',

            light:
                'Оборудование: Световое оборудование',

            stage:
                'Оборудование: Сценические конструкции',

            all:
                'Оборудование: Полный комплекс'
        }

    };


    const group =
        map[message.tag];


    if (!group) {
        return '';
    }


    if (
        Array.isArray(
            message.value
        )
    ) {

        return message.value
            .map(
                value =>
                    group[value]
            )
            .filter(Boolean)
            .join('\n');
    }


    if (
        message.value &&
        group[message.value]
    ) {

        return group[
            message.value
        ];
    }


    return '';
}


// ============================================================
// START MESSAGE
// ============================================================

function getGreeting(
    state
) {

    const name =
        state.client.name ||
        '';


    return `Здравствуйте${
        name
            ? `, ${name}`
            : ''
    }! Рад приветствовать вас в MLK. Меня зовут Дмитрий, я ваш менеджер по техническому оснащению мероприятий «под ключ».

Если у вас есть готовое техническое задание, райдер или любые другие файлы, вы можете отправить их мне, и я сразу передам их в отдел подготовки КП.

Если же вы пока не знаете всех деталей, я задам несколько уточняющих вопросов — это займёт всего пару минут и поможет подготовить для вас точное и честное предложение.

С чего начнём?`;
}


// ============================================================
// START ACTIONS
// ============================================================

function getStartActions() {

    return [

        {
            type: 'send_files'
        },

        {
            type: 'quick_reply',
            tag: 'ask_format'
        }

    ];
}


// ============================================================
// PROCESS START
// ============================================================

function processStart(
    clientId,
    clientName = ''
) {

    const state =
        resetSalesClient(
            clientId,
            clientName
        );


    const text =
        getGreeting(
            state
        );


    addHistory(
        state,
        'assistant',
        text
    );


    state.lastAction =
        'ask_format';

    state.updatedAt =
        new Date().toISOString();


    return {

        text,

        actions:
            getStartActions(),

        project:
            state.project,

        missing:
            calculateMissing(
                state
            ),

        stage:
            'greeting',

        intent:
            'greeting',

        readyForManager:
            false,

        managerSummary:
            null
    };
}


// ============================================================
// APPLY ACTION
// ============================================================

function applyAction(
    state,
    message
) {

    if (
        message.type !== 'action'
    ) {
        return '';
    }


    const tag =
        message.tag;

    const value =
        message.value;


    if (
        tag === 'ask_format' &&
        value &&
        EVENT_TYPES[value]
    ) {

        state.project.eventType =
            value;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_level' &&
        value &&
        LEVELS[value]
    ) {

        state.project.eventLevel =
            value;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_personnel' &&
        value &&
        PERSONNEL[value]
    ) {

        state.project.personnel =
            value;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_place' &&
        value &&
        PLACES[value]
    ) {

        state.project.place =
            value;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_lift' &&
        value
    ) {

        if (
            value === 'has_lift' ||
            value === 'stairs' ||
            value === 'unknown'
        ) {

            state.project.lift =
                value;

            return actionToText(
                message
            );
        }
    }


    if (
        tag === 'ask_equipment'
    ) {

        if (
            Array.isArray(value)
        ) {

            const equipment =
                normalizeEquipment(
                    value
                );

            if (
                equipment.length
            ) {

                state.project.equipment =
                    equipment;

                return actionToText(
                    message
                );
            }
        }


        if (
            value &&
            EQUIPMENT[value]
        ) {

            state.project.equipment =
                [value];

            return actionToText(
                message
            );
        }
    }


    if (
        tag === 'ask_mount' &&
        value &&
        MOUNT[value]
    ) {

        state.project.mount =
            value;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_demount' &&
        value &&
        DEMOUNT[value]
    ) {

        state.project.demount =
            value;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_date_start'
    ) {

        if (value) {

            state.project.dateStart =
                String(value);

            return `Дата начала: ${value}`;
        }
    }


    if (
        tag === 'ask_date_end'
    ) {

        if (value) {

            state.project.dateEnd =
                String(value);

            return `Дата окончания: ${value}`;
        }
    }


    if (
        tag === 'ask_ready_date'
    ) {

        if (value) {

            state.project.readyDate =
                String(value);

            return `Дата готовности оборудования: ${value}`;
        }
    }


    return '';
}


// ============================================================
// FILE PROCESSING
// ============================================================

async function processFileMessage(
    state,
    message
) {

    const fileName =
        message.fileName ||
        'файл';


    addHistory(
        state,
        'user',
        `[Файл: ${fileName}]`
    );


    // Если bot.js когда-нибудь передаст извлечённый
    // текст файла — Sales Engine сможет его проанализировать.
    //
    // Сейчас намеренно не придумываем extraction,
    // потому что transport-слой должен сам решить,
    // как извлекать текст из PDF/DOCX/XLSX.

    if (
        message.fileText
    ) {

        const extracted =
            await extractClientData(
                state,
                message.fileText
            );

        mergeProjectData(
            state,
            extracted
        );

        cleanDependentFields(
            state
        );
    }


    state.updatedAt =
        new Date().toISOString();


    return `Файл «${fileName}» получил. Я передам его в отдел подготовки КП и учту информацию из него при работе с заявкой.`;
}


// ============================================================
// PREPARE RESULT
// ============================================================

function prepareResult(
    state,
    text,
    intent
) {

    const missing =
        calculateMissing(
            state
        );


    state.missing =
        missing;


    state.intent =
        intent;


    state.stage =
        calculateStage(
            state,
            intent,
            missing
        );


    state.updatedAt =
        new Date().toISOString();


    const readyForManager =
        missing.length === 0;


    let finalText =
        text;


    if (
        readyForManager &&
        state.stage !== 'manager_handoff'
    ) {

        finalText =
            buildClientSummary(
                state
            );
    }


    return {

        text:
            finalText,

        actions:
            readyForManager
                ? [
                    {
                        type: 'quick_reply',
                        tag: 'manager_handoff'
                    }
                ]
                : getActions(
                    state
                ),

        project:
            state.project,

        missing,

        stage:
            state.stage,

        intent,

        readyForManager,

        managerSummary:
            readyForManager
                ? buildManagerSummary(
                    state
                )
                : null
    };
}


// ============================================================
// PROCESS SALES MESSAGE
// ============================================================

async function processSalesMessage(
    clientId,
    message
) {

    const normalized =
        normalizeMessage(
            message
        );


    // --------------------------------------------------------
    // CLIENT NAME
    // --------------------------------------------------------

    const clientName =
        normalized.clientName ||
        '';


    // --------------------------------------------------------
    // GET STATE
    // --------------------------------------------------------

    const state =
        getSalesState(
            clientId,
            clientName
        );


    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    if (
        normalized.type === 'start'
    ) {

        return processStart(
            clientId,
            clientName
        );
    }


    // --------------------------------------------------------
    // FIRST REAL MESSAGE
    // --------------------------------------------------------

    let initialGreeting =
        null;


    if (
        state.history.length === 0
    ) {

        const startResult =
            processStart(
                clientId,
                clientName
            );

        initialGreeting =
            startResult.text;
    }


    // --------------------------------------------------------
    // FILE
    // --------------------------------------------------------

    if (
        normalized.type === 'file'
    ) {

        const fileText =
            await processFileMessage(
                state,
                normalized
            );


        const missing =
            calculateMissing(
                state
            );


        state.missing =
            missing;


        const actions =
            getActions(
                state
            );


        const text =
            initialGreeting
                ? `${initialGreeting}\n\n${fileText}`
                : fileText;


        return {

            text,

            actions,

            project:
                state.project,

            missing,

            stage:
                state.stage,

            intent:
                'qualification',

            readyForManager:
                missing.length === 0,

            managerSummary:
                missing.length === 0
                    ? buildManagerSummary(
                        state
                    )
                    : null
        };
    }


    // --------------------------------------------------------
    // ACTION
    // --------------------------------------------------------

    let userText = '';


    if (
        normalized.type === 'action'
    ) {

        userText =
            actionToText(
                normalized
            );


        const applied =
            applyAction(
                state,
                normalized
            );


        if (
            applied
        ) {
            userText =
                applied;
        }

    } else {

        userText =
            normalized.text ||
            '';
    }


    // --------------------------------------------------------
    // EMPTY
    // --------------------------------------------------------

    if (!userText) {

        const fallback =
            buildControlledQuestion(
                state
            );


        return {

            text:
                initialGreeting
                    ? `${initialGreeting}\n\n${fallback}`
                    : fallback,

            actions:
                getActions(
                    state
                ),

            project:
                state.project,

            missing:
                calculateMissing(
                    state
                ),

            stage:
                state.stage,

            intent:
                'other',

            readyForManager:
                false,

            managerSummary:
                null
        };
    }


    // --------------------------------------------------------
    // ADD USER HISTORY
    // --------------------------------------------------------

    addHistory(
        state,
        'user',
        userText
    );


    // --------------------------------------------------------
    // AI EXTRACTION
    // --------------------------------------------------------

    try {

        const extracted =
            await extractClientData(
                state,
                userText
            );


        mergeProjectData(
            state,
            extracted
        );


        cleanDependentFields(
            state
        );

    } catch (error) {

        console.warn(
            '⚠️ Sales Engine extraction error:',
            error.message
        );
    }


    // --------------------------------------------------------
    // INTENT
    // --------------------------------------------------------

    let intent =
        'qualification';


    try {

        intent =
            await detectIntent(
                state,
                userText
            );

    } catch (error) {

        console.warn(
            '⚠️ Sales Engine intent error:',
            error.message
        );
    }


    // --------------------------------------------------------
    // MANAGER REQUEST
    // --------------------------------------------------------

    if (
        intent === 'manager_request'
    ) {

        const text =
            'Конечно. Передам ваш запрос менеджеру.';


        addHistory(
            state,
            'assistant',
            text
        );


        const result =
            prepareResult(
                state,
                text,
                intent
            );


        if (
            initialGreeting
        ) {

            result.text =
                `${initialGreeting}\n\n${result.text}`;
        }


        return result;
    }


    // --------------------------------------------------------
    // GENERATE RESPONSE
    // --------------------------------------------------------

    let assistantText = '';


    try {

        assistantText =
            await generateAssistantText(
                state,
                userText
            );

    } catch (error) {

        console.warn(
            '⚠️ Sales Engine response error:',
            error.message
        );

        assistantText =
            buildControlledQuestion(
                state
            ) ||
            'Спасибо. Информация зафиксирована.';
    }


    // --------------------------------------------------------
    // HISTORY
    // --------------------------------------------------------

    addHistory(
        state,
        'assistant',
        assistantText
    );


    // --------------------------------------------------------
    // RESULT
    // --------------------------------------------------------

    const result =
        prepareResult(
            state,
            assistantText,
            intent
        );


    // --------------------------------------------------------
    // INITIAL GREETING
    // --------------------------------------------------------

    if (
        initialGreeting
    ) {

        result.text =
            `${initialGreeting}\n\n${result.text}`;
    }


    return result;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    processSalesMessage,

    processStart,

    getSalesState,

    resetSalesClient,

    deleteSalesClient,

    addHistory,

    getHistory,

    calculateMissing,

    getNextAction,

    getActions,

    buildManagerSummary,

    buildClientSummary,

    EVENT_TYPES,

    LEVELS,

    PERSONNEL,

    PLACES,

    EQUIPMENT,

    MOUNT,

    DEMOUNT

};
objection:
клиент сомневается, возражает, не хочет отвечать, выражает недоверие.

correction:
клиент исправляет ранее сообщённую информацию.

manager_request:
клиент просит связать его с менеджером или человеком.

file_submission:
клиент отправляет файл или сообщает о наличии ТЗ/райдера.

Если сообщение одновременно содержит данные проекта и вопрос,
выбирай наиболее содержательный intent.

Верни ТОЛЬКО JSON:

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
                            'Ты классификатор намерения. Верни только JSON.'
                    },

                    {
                        role: 'user',
                        content:
                            JSON.stringify({
                                currentProject:
                                    state.project,

                                history:
                                    state.history.slice(
                                        -10
                                    ),

                                message
                            })
                    },

                    {
                        role: 'system',
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
            parsed.intent
        ) {

            return String(
                parsed.intent
            );
        }

    } catch (error) {

        console.warn(
            '⚠️ Ошибка detectIntent:',
            error.message
        );
    }


    return 'new_request';
}


// ============================================================
// BUILD CONVERSATION CONTEXT
// ============================================================

function buildConversationContext(
    state
) {

    return `
ТЕКУЩЕЕ СОСТОЯНИЕ ПРОЕКТА:

${JSON.stringify(
    state.project,
    null,
    2
)}

ИНФОРМАЦИЯ О КЛИЕНТЕ:

${JSON.stringify(
    state.client,
    null,
    2
)}

НЕДОСТАЮЩАЯ ИНФОРМАЦИЯ:

${JSON.stringify(
    state.missing,
    null,
    2
)}

ТЕКУЩИЙ ЭТАП:

${state.stage}

ПОСЛЕДНЕЕ ДЕЙСТВИЕ:

${state.lastAction || 'нет'}
`;
}


// ============================================================
// GENERATE ASSISTANT RESPONSE
// ============================================================
//
// Важный принцип:
//
// DeepSeek НЕ решает, какое поле спрашивать.
//
// JS Sales Engine уже определил missing/action.
//
// DeepSeek только формулирует естественный ответ.
//

async function generateAssistantResponse(
    state,
    userMessage
) {

    const missing =
        calculateMissing(
            state
        );


    state.missing =
        missing;


    const nextAction =
        getNextAction(
            state
        );


    const controlledQuestion =
        buildControlledQuestion(
            state
        );


    const context =
        buildConversationContext(
            state
        );


    const system = `
${SYSTEM_PROMPT}

============================================================
SALES ENGINE
============================================================

Ты работаешь внутри Sales Engine компании MLK.

Ты — Дмитрий, консультант по техническому оснащению
мероприятий «под ключ».

Твоя задача — вести естественный диалог с клиентом,
отвечать на его вопросы и помогать собрать информацию
для подготовки коммерческого предложения.

============================================================
ЖЁСТКИЕ ПРАВИЛА
============================================================

1. Не выдумывай факты.

2. Не выдумывай стоимость.

3. Не называй цены, если их нет в переданном контексте.

4. Не придумывай характеристики оборудования.

5. Не придумывай кейсы MLK.

6. Для портфолио используй только PORTFOLIO ниже.

7. Если клиент уже сообщил информацию —
   не спрашивай её повторно.

8. Если клиент исправил информацию —
   используй новое значение.

9. Если клиент задаёт вопрос,
   сначала ответь на него.

10. После ответа продолжай квалификацию,
    если это уместно.

11. Не показывай клиенту внутренние названия полей:
    eventType, eventLevel, guestCount и т.п.

12. Не сообщай клиенту внутреннюю логику Sales Engine.

13. Не говори, что ты AI, если клиент напрямую
    об этом не спрашивает.

14. Всегда обращайся к клиенту на «Вы».

15. Если имя клиента известно,
    используй его естественно, но не в каждом сообщении.

16. MLK работает с техническим оснащением
    мероприятий «под ключ».

17. Не обещай того, чего нет в контексте.

============================================================
ТЕКУЩИЙ КОНТЕКСТ
============================================================

${context}

============================================================
СЛЕДУЮЩИЙ КОНТРОЛИРУЕМЫЙ ШАГ
============================================================

${JSON.stringify(
    nextAction,
    null,
    2
)}

============================================================
КОНТРОЛИРУЕМЫЙ ВОПРОС
============================================================

${
    controlledQuestion ||
    'Квалификация завершена.'
}

============================================================
ПОРТФОЛИО MLK
============================================================

${PORTFOLIO_TEXT}

============================================================
ПОСЛЕДНЕЕ СООБЩЕНИЕ КЛИЕНТА
============================================================

${userMessage}

============================================================
ФОРМАТ ОТВЕТА
============================================================

Напиши только готовый текст сообщения клиенту.

Не добавляй:
- JSON;
- технические комментарии;
- внутренние названия полей;
- анализ;
- инструкции для менеджера.

Ответ должен быть естественным и достаточно коротким.
`;


    const messages = [
        {
            role: 'system',
            content: system
        }
    ];


    // Добавляем историю, но не всю бесконечно.
    for (
        const item of
        state.history.slice(-16)
    ) {

        if (
            item.role === 'user'
        ) {

            messages.push({
                role: 'user',
                content:
                    item.content
            });

        } else if (
            item.role === 'assistant'
        ) {

            messages.push({
                role: 'assistant',
                content:
                    item.content
            });
        }
    }


    // Текущее сообщение отдельно,
    // чтобы DeepSeek точно его видел.
    messages.push({
        role: 'user',
        content:
            userMessage
    });


    try {

        const answer =
            await callDeepSeek(
                messages,
                {
                    temperature: 0.4,
                    max_tokens: 700
                }
            );


        return answer;

    } catch (error) {

        console.error(
            '❌ generateAssistantResponse:',
            error.message
        );


        // DeepSeek недоступен —
        // Sales Engine всё равно продолжает воронку.
        return controlledQuestion ||
            'Спасибо, информацию зафиксировал. Подскажите, пожалуйста, дополнительные детали по проекту.';
    }
}


// ============================================================
// CONTROLLED FALLBACK TEXT
// ============================================================

function getFallbackQuestion(
    state
) {

    const question =
        buildControlledQuestion(
            state
        );


    if (question) {
        return question;
    }


    return 'Спасибо, информацию зафиксировал.';
}


// ============================================================
// MANAGER HANDOFF
// ============================================================

function isManagerRequest(
    intent,
    text
) {

    if (
        intent === 'manager_request'
    ) {
        return true;
    }


    const normalized =
        String(text || '')
            .toLowerCase()
            .trim();


    const patterns = [

        'позовите менеджера',

        'свяжите с менеджером',

        'соедините с менеджером',

        'нужен менеджер',

        'хочу менеджера',

        'хочу поговорить с менеджером',

        'с человеком',

        'живого человека',

        'свяжите с человеком',

        'позовите человека'

    ];


    return patterns.some(
        pattern =>
            normalized.includes(
                pattern
            )
    );
}


// ============================================================
// READY FOR MANAGER
// ============================================================

function isReadyForManager(
    state
) {

    return (
        calculateMissing(
            state
        ).length === 0
    );
}


// ============================================================
// PROCESS ACTION MESSAGE
// ============================================================

async function processActionMessage(
    state,
    message
) {

    const actionText =
        applyAction(
            state,
            message
        );


    if (!actionText) {

        return prepareResult(
            state,
            getFallbackQuestion(
                state
            ),
            'new_request'
        );
    }


    addHistory(
        state,
        'user',
        actionText,
        {
            source: 'telegram_action'
        }
    );


    // После нажатия кнопки клиент может
    // сразу закрыть несколько зависимостей.
    cleanDependentFields(
        state
    );


    const intent =
        'new_request';


    let responseText = '';


    try {

        responseText =
            await generateAssistantResponse(
                state,
                actionText
            );

    } catch (error) {

        responseText =
            getFallbackQuestion(
                state
            );
    }


    addHistory(
        state,
        'assistant',
        responseText
    );


    return prepareResult(
        state,
        responseText,
        intent
    );
}


// ============================================================
// PROCESS TEXT MESSAGE
// ============================================================

async function processTextMessage(
    state,
    text
) {

    const cleanText =
        String(text || '')
            .trim();


    if (!cleanText) {

        return prepareResult(
            state,
            getFallbackQuestion(
                state
            ),
            'new_request'
        );
    }


    // --------------------------------------------------------
    // MANAGER REQUEST
    // --------------------------------------------------------

    let intent =
        'new_request';


    try {

        intent =
            await detectIntent(
                state,
                cleanText
            );

    } catch (error) {

        console.warn(
            '⚠️ Intent fallback:',
            error.message
        );
    }


    if (
        isManagerRequest(
            intent,
            cleanText
        )
    ) {

        addHistory(
            state,
            'user',
            cleanText
        );


        const response =
            'Конечно. Передам ваш запрос менеджеру.';


        addHistory(
            state,
            'assistant',
            response
        );


        state.stage =
            'manager_handoff';


        state.updatedAt =
            new Date().toISOString();


        return {

            text:
                response,

            actions: [

                {
                    type: 'manager_handoff'
                }

            ],

            project:
                state.project,

            missing:
                calculateMissing(
                    state
                ),

            stage:
                'manager_handoff',

            intent:
                'manager_request',

            readyForManager:
                true,

            managerSummary:
                buildManagerSummary(
                    state
                )
        };
    }


    // --------------------------------------------------------
    // USER HISTORY
    // --------------------------------------------------------

    addHistory(
        state,
        'user',
        cleanText
    );


    // --------------------------------------------------------
    // EXTRACT
    // --------------------------------------------------------

    let extracted = {};


    try {

        extracted =
            await extractProjectData(
                state,
                cleanText
            );

    } catch (error) {

        console.warn(
            '⚠️ Extraction error:',
            error.message
        );
    }


    // --------------------------------------------------------
    // MERGE
    // --------------------------------------------------------

    mergeProjectData(
        state,
        extracted
    );


    // --------------------------------------------------------
    // CLEAN DEPENDENCIES
    // --------------------------------------------------------

    cleanDependentFields(
        state
    );


    // --------------------------------------------------------
    // SAVE INTENT
    // --------------------------------------------------------

    state.intent =
        intent;


    // --------------------------------------------------------
    // CLIENT REQUEST
    // --------------------------------------------------------

    if (
        !state.project.clientRequest &&
        intent === 'new_request'
    ) {

        state.project.clientRequest =
            cleanText;
    }


    // --------------------------------------------------------
    // RESPONSE
    // --------------------------------------------------------

    let responseText = '';


    try {

        responseText =
            await generateAssistantResponse(
                state,
                cleanText
            );

    } catch (error) {

        console.warn(
            '⚠️ Response error:',
            error.message
        );

        responseText =
            getFallbackQuestion(
                state
            );
    }


    // --------------------------------------------------------
    // READY?
    // --------------------------------------------------------

    const ready =
        isReadyForManager(
            state
        );


    if (ready) {

        responseText =
            buildClientSummary(
                state
            );
    }


    addHistory(
        state,
        'assistant',
        responseText
    );


    // --------------------------------------------------------
    // PREPARE RESULT
    // --------------------------------------------------------

    return {

        text:
            responseText,

        actions:
            ready
                ? [
                    {
                        type: 'quick_reply',
                        tag: 'manager_handoff'
                    }
                ]
                : getActions(
                    state
                ),

        project:
            state.project,

        missing:
            calculateMissing(
                state
            ),

        stage:
            ready
                ? 'summary'
                : calculateStage(
                    state,
                    intent,
                    calculateMissing(
                        state
                    )
                ),

        intent,

        readyForManager:
            ready,

        managerSummary:
            ready
                ? buildManagerSummary(
                    state
                )
                : null
    };
}


// ============================================================
// MAIN PROCESSOR
// ============================================================

async function processSalesMessage(
    clientId,
    message
) {

    const normalized =
        normalizeMessage(
            message
        );


    // --------------------------------------------------------
    // CLIENT NAME
    // --------------------------------------------------------
    //
    // ВАЖНО:
    // bot.js может передавать имя клиента вместе с сообщением.
    //

    const clientName =
        normalized.clientName ||
        '';


    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    if (
        normalized.type === 'start'
    ) {

        return processStart(
            clientId,
            clientName
        );
    }


    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    const state =
        getSalesState(
            clientId,
            clientName
        );


    // --------------------------------------------------------
    // FIRST REAL MESSAGE
    // --------------------------------------------------------
    //
    // Если клиент впервые пишет не через /start,
    // всё равно сначала формируем приветствие.
    //

    let initialGreeting =
        null;


    if (
        state.history.length === 0
    ) {

        const startResult =
            processStart(
                clientId,
                clientName
            );


        initialGreeting =
            startResult.text;
    }


    // --------------------------------------------------------
    // FILE
    // --------------------------------------------------------

    if (
        normalized.type === 'file'
    ) {

        const fileText =
            await processFileMessage(
                state,
                normalized
            );


        const missing =
            calculateMissing(
                state
            );


        state.missing =
            missing;


        const result = {

            text:
                initialGreeting
                    ? `${initialGreeting}\n\n${fileText}`
                    : fileText,

            actions:
                getActions(
                    state
                ),

            project:
                state.project,

            missing,

            stage:
                state.stage,

            intent:
                'file_submission',

            readyForManager:
                missing.length === 0,

            managerSummary:
                missing.length === 0
                    ? buildManagerSummary(
                        state
                    )
                    : null
        };


        return result;
    }


    // --------------------------------------------------------
    // ACTION
    // --------------------------------------------------------

    if (
        normalized.type === 'action'
    ) {

        const result =
            await processActionMessage(
                state,
                normalized
            );


        if (
            initialGreeting
        ) {

            result.text =
                `${initialGreeting}\n\n${result.text}`;
        }


        return result;
    }


    // --------------------------------------------------------
    // TEXT
    // --------------------------------------------------------

    const result =
        await processTextMessage(
            state,
            normalized.text
        );


    if (
        initialGreeting
    ) {

        result.text =
            `${initialGreeting}\n\n${result.text}`;
    }


    return result;
}


// ============================================================
// BUILD MANAGER SUMMARY — SHORT
// ============================================================

function buildShortManagerSummary(
    state
) {

    const p =
        state.project;


    const equipment =
        getEquipmentLabels(
            p.equipment
        );


    return [
        `Клиент: ${state.client.name || 'Не указано'}`,

        `Формат: ${getEventLabel(p.eventType)}`,

        p.eventLevel
            ? `Уровень: ${getLevelLabel(p.eventLevel)}`
            : null,

        p.guestCount !== null
            ? `Гостей: ${p.guestCount}`
            : null,

        `Персонал: ${getPersonnelLabel(p.personnel)}`,

        `Дата: ${p.dateStart || '—'} → ${p.dateEnd || '—'}`,

        `Готовность: ${p.readyDate || '—'}`,

        `Адрес: ${p.location || '—'}`,

        `Место: ${getPlaceLabel(p.place)}`,

        p.floor !== null
            ? `Этаж: ${p.floor}`
            : null,

        p.lift
            ? `Лифт: ${p.lift}`
            : null,

        p.liftDimensions
            ? `Размеры лифта: ${p.liftDimensions}`
            : null,

        `Оборудование: ${
            equipment.length
                ? equipment.join(', ')
                : '—'
        }`,

        `Монтаж: ${
            MOUNT[p.mount]?.label ||
            p.mount ||
            '—'
        }`,

        p.mountTime
            ? `Время монтажа: ${p.mountTime}`
            : null,

        `Демонтаж: ${
            DEMOUNT[p.demount]?.label ||
            p.demount ||
            '—'
        }`,

        p.demountTime
            ? `Время демонтажа: ${p.demountTime}`
            : null
    ]
        .filter(Boolean)
        .join('\n');
}


// ============================================================
// PUBLIC HELPERS
// ============================================================

function getClientProject(
    clientId
) {

    const state =
        getSalesState(
            clientId
        );


    return state.project;
}


function getClientName(
    clientId
) {

    const state =
        getSalesState(
            clientId
        );


    return state.client.name || '';
}


function setClientName(
    clientId,
    name
) {

    const state =
        getSalesState(
            clientId
        );


    state.client.name =
        cleanString(name) || '';


    state.updatedAt =
        new Date().toISOString();


    return state;
}


// ============================================================
// UPDATE PROJECT FIELD
// ============================================================

function updateProjectField(
    clientId,
    field,
    value
) {

    const state =
        getSalesState(
            clientId
        );


    if (
        !Object.prototype.hasOwnProperty.call(
            state.project,
            field
        )
    ) {

        return state;
    }


    state.project[field] =
        value;


    cleanDependentFields(
        state
    );


    state.updatedAt =
        new Date().toISOString();


    return state;
}


// ============================================================
// ADD EQUIPMENT
// ============================================================

function addEquipment(
    clientId,
    equipment
) {

    const state =
        getSalesState(
            clientId
        );


    const normalized =
        normalizeEquipment(
            Array.isArray(equipment)
                ? equipment
                : [equipment]
        );


    for (
        const item of
        normalized
    ) {

        if (
            !state.project.equipment.includes(
                item
            )
        ) {

            state.project.equipment.push(
                item
            );
        }
    }


    state.updatedAt =
        new Date().toISOString();


    return state;
}


// ============================================================
// ADD CLIENT HISTORY
// ============================================================

function addClientHistory(
    clientId,
    role,
    text,
    meta = {}
) {

    const state =
        getSalesState(
            clientId
        );


    addHistory(
        state,
        role,
        text,
        meta
    );


    state.updatedAt =
        new Date().toISOString();


    return state;
}


// ============================================================
// GET CLIENT HISTORY
// ============================================================

function getClientHistory(
    clientId
) {

    const state =
        getSalesState(
            clientId
        );


    return [
        ...state.history
    ];
}


// ============================================================
// GET SALES CONTEXT
// ============================================================

function getSalesContext(
    clientId
) {

    const state =
        getSalesState(
            clientId
        );


    return {

        client:
            {
                ...state.client
            },

        project:
            {
                ...state.project,
                equipment:
                    Array.isArray(
                        state.project.equipment
                    )
                        ? [
                            ...state.project.equipment
                        ]
                        : []
            },

        intent:
            state.intent,

        missing:
            calculateMissing(
                state
            ),

        stage:
            state.stage,

        lastAction:
            state.lastAction,

        managerNotified:
            state.managerNotified,

        updatedAt:
            state.updatedAt
    };
}


// ============================================================
// MANAGER SUMMARY EXPORT
// ============================================================

function getManagerSummary(
    clientId
) {

    const state =
        getSalesState(
            clientId
        );


    return buildManagerSummary(
        state
    );
}


// ============================================================
// MANAGER NOTIFICATION FLAG
// ============================================================

function setManagerNotified(
    clientId,
    value = true
) {

    const state =
        getSalesState(
            clientId
        );


    state.managerNotified =
        Boolean(value);


    state.updatedAt =
        new Date().toISOString();


    return state;
}


// ============================================================
// SET LAST ACTION
// ============================================================

function setLastAction(
    clientId,
    action
) {

    const state =
        getSalesState(
            clientId
        );


    state.lastAction =
        action || null;


    state.updatedAt =
        new Date().toISOString();


    return state;
}


// ============================================================
// GET FULL STATE
// ============================================================

function getFullSalesState(
    clientId
) {

    const state =
        getSalesState(
            clientId
        );


    return state;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    // Main Sales Engine
    processSalesMessage,

    processStart,

    // State
    getSalesState,
    getFullSalesState,
    resetSalesClient,
    deleteSalesClient,

    // Client
    getClientName,
    setClientName,

    // Project
    getClientProject,
    updateProjectField,
    addEquipment,

    // History
    addHistory,
    addClientHistory,
    getHistory,
    getClientHistory,

    // Sales context
    getSalesContext,

    // Actions / funnel
    calculateMissing,
    getNextAction,
    getActions,

    // Manager
    buildManagerSummary,
    buildShortManagerSummary,
    getManagerSummary,
    setManagerNotified,

    // State helpers
    setLastAction,

    // Constants
    EVENT_TYPES,
    LEVELS,
    PERSONNEL,
    PLACES,
    EQUIPMENT,
    MOUNT,
    DEMOUNT

};

    if (
        !message ||
        typeof message !== 'object'
    ) {

        return {
            type: 'text',
            text: ''
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