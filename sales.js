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
const crypto = require('crypto');

const {
    initStorage,
    loadSalesState,
    saveSalesState,
    deleteSalesState
} = require('./storage.js');

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
        label: 'Концерты & Фестивали (Open air, городские праздники, гастрольные туры, сольные выступления, шоу-программы)'
    },

    conferences: {
        value: 'conferences',
        label: 'Конференции & Презентации & TV-проекты (Бизнес-форумы, презентации продуктов, пресс-конференции, саммиты, конгрессы, семинары, кинофестивали, премии, телевизионные программы)'
    },

    corporate: {
        value: 'corporate',
        label: 'Корпоративы & Торжества (Юбилеи, тимбилдинги, свадьбы, выездные мероприятия, награждения, открытия магазинов и заведений)'
    },

    exhibitions: {
        value: 'exhibitions',
        label: 'Выставки (Промо-акции, стенды компаний, презентационные зоны, конференц-зоны)'
    },

    sports: {
        value: 'sports',
        label: 'Спортивные мероприятия (Спортивные матчи, турниры, спартакиады, спортивные праздники, марафоны)'
    }
};


const LEVELS = {
    standard: {
        value: 'standard',
        label: 'Стандартный',
        description: 'обычные требования к оборудованию и документации'
    },

    high: {
        value: 'high',
        label: 'Высокие требования',
        description: 'повышенные требования к оборудованию и документации, прямые ТВ-трансляции'
    },

    highest: {
        value: 'highest',
        label: 'Высший уровень',
        description: 'с высшими должностными лицами, масштабные и международные мероприятия'
    }
};


const PERSONNEL = {
    management: {
        value: 'management',
        label: 'Полное управление оборудованием',
        description: 'Полный цикл обслуживания: доставка, монтаж, настройка, работа технических специалистов на оборудовании во время мероприятия (например, управление с пульта), демонтаж и вывоз. На небольшом мероприятии это может быть один специалист; на сложном — звукорежиссёр, художник по свету, видеоинженер и другие техники. Итоговое количество специалистов определяет менеджер проекта.'
    },

    duty_technician: {
        value: 'duty_technician',
        label: 'Дежурный техник',
        description: 'MLK доставляет, монтирует и настраивает оборудование. Во время мероприятия специалист остаётся на площадке, контролирует работу техники и оперативно устраняет неисправности, но не управляет оборудованием и не ведёт программу. Подходит, если постоянное управление не требуется или у заказчика есть свои специалисты для управления.'
    },

    installation_dismantling: {
        value: 'installation_dismantling',
        label: 'Только монтаж-демонтаж',
        description: 'MLK доставляет комплект, профессионально монтирует и настраивает оборудование, затем передаёт его заказчику по акту. Во время мероприятия заказчик самостоятельно управляет техникой. После завершения аренды MLK демонтирует и вывозит комплект.'
    },

    other: {
        value: 'other',
        label: 'Другое',
        description: 'Нестандартный вариант обслуживания, который нужно уточнить с клиентом и передать менеджеру проекта.'
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
    },

    after_event: {
        value: 'after_event',
        label: 'Сразу после мероприятия'
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
// STATE MIGRATION
// ============================================================
// Старые сохранённые состояния не содержат новых полей.

function ensureStateExtras(state) {
    if (!state) return state;
    if (!state.project) state.project = {};
    const p = state.project;
    if (p.multiDay === undefined) p.multiDay = null;
    if (p.readyChoice === undefined) p.readyChoice = null;
    if (p.budget === undefined) p.budget = null;
    if (!state.client) state.client = { id: '', name: '', contacts: '' };
    if (state.client.contacts === undefined) state.client.contacts = '';
    if (!state.optional || typeof state.optional !== 'object') {
        state.optional = { asked: null, budget: null, extra: null, contacts: null };
    }
    if (!state.confirmation || typeof state.confirmation !== 'object') {
        state.confirmation = { status: 'none', editBlock: null };
    }
    if (!state.deferredFields) state.deferredFields = {};
    if (!state.confirmationStatus) state.confirmationStatus = {};
    return state;
}


// ============================================================
// LOAD STATE FROM TURSO
// ============================================================

async function hydrateSalesState(
    clientId,
    clientName = ''
) {
    const key = String(clientId || '');

    if (!key) {
        return createSalesState(
            key,
            clientName
        );
    }

    // Если состояние уже загружено в RAM —
    // Turso повторно не трогаем.
    if (salesStates.has(key)) {
        const state = salesStates.get(key);

        if (
            clientName &&
            !state.client.name
        ) {
            state.client.name = clientName;
        }

        return state;
    }

    const savedState =
        await loadSalesState(key);

    if (savedState) {

        salesStates.set(
            key,
            savedState
        );

        const state =
            salesStates.get(key);

        ensureStateExtras(state);
        if (!state.applicationId) state.applicationId = crypto.randomUUID();
        if (!state.applicationCreatedAt) state.applicationCreatedAt = state.updatedAt || new Date().toISOString();
        if (!state.applicationCode) state.applicationCode = buildApplicationCode(state);

        if (
            clientName &&
            !state.client.name
        ) {
            state.client.name =
                clientName;
        }

        return state;
    }

    const state =
        createSalesState(
            key,
            clientName
        );

    salesStates.set(
        key,
        state
    );

    return state;
}


// ============================================================
// SAVE STATE TO TURSO
// ============================================================

async function persistSalesState(
    state
) {
    if (!state) {
        return;
    }

    try {

        refreshApplicationCode(state);
        await saveSalesState(
            state
        );

    } catch (error) {

        console.warn(
            '⚠️ Sales State save error:',
            error.message
        );
    }
}


// ============================================================
// CREATE STATE
// ============================================================

function createSalesState(clientId, clientName = '') {

    const applicationId = crypto.randomUUID();
    const applicationCreatedAt = new Date().toISOString();

    const state = {
        applicationId,
        applicationCreatedAt,
        applicationCode: '',

        client: {
            id: String(clientId || ''),
            name: clientName || '',
            contacts: ''
        },

        project: {
            eventType: null,
            eventTypeOriginal: null,
            eventLevel: null,

            guestCount: null,

            dateStart: null,
            dateEnd: null,
            readyDate: null,
            readyDateTimeRange: null,

            location: null,

            place: null,
            floor: null,

            lift: null,
            liftDimensions: null,

            equipment: [],

            equipmentDetails: null,

            stageDetails: null,
            stageSurface: null,

            soundDetails: null,
            backline: null,
            soundRider: null,

            lightDetails: null,
            lightFixtures: null,

            ledDetails: null,
            ledContent: null,
            ledSuspension: null,

            additionalServices: null,
            specialConditions: null,

            budget: null,

            multiDay: null,
            readyChoice: null,

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

        // Поля, на которые клиент уже ответил, но значение нельзя надёжно
        // разобрать. Не спрашиваем их повторно в этом диалоге.
        deferredFields: {},

        // Подтверждённость значений: confirmed / tentative / unknown / not_required.
        confirmationStatus: {},

        // Необязательные вопросы после обязательной квалификации.
        optional: {
            asked: null,
            budget: null,
            extra: null,
            contacts: null
        },

        // Подтверждение заявки клиентом: none / awaiting / editing / confirmed.
        confirmation: {
            status: 'none',
            editBlock: null
        },

        stage: 'greeting',

        lastAction: null,

        history: [],

        managerNotified: false,

        updatedAt: null
    };

    state.applicationCode = buildApplicationCode(state);
    return state;
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

function resetSalesClient(
    clientId,
    clientName = ''
) {

    const key =
        String(clientId || '');

    const state =
        createSalesState(
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


function parseIsoDateTime(value) {
    const normalized = String(value || '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const hour = match[4] === undefined ? 0 : Number(match[4]);
    const minute = match[5] === undefined ? 0 : Number(match[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
    return parsed;
}

function hasDateAndTime(value) {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(normalized) && Boolean(parseIsoDateTime(normalized));
}

// Дата может быть сохранена отдельно от времени. Это не означает,
// что этап даты/времени уже завершён.
function hasDateOrDateTime(value) {
    return Boolean(parseIsoDateTime(value));
}

function normalizeExtractedDate(value, sourceText = '') {
    const normalized = String(value || '').trim();
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?$/);
    if (!match || !parseIsoDateTime(normalized)) return null;
    let datePart = match[1];
    const explicitYear = /\b(?:19|20)\d{2}\b/.test(String(sourceText || ''));
    if (!explicitYear) {
        const today = new Date();
        const candidate = parseIsoDateTime(datePart);
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        if (candidate && candidate < todayStart) {
            const [year, month, day] = datePart.split('-').map(Number);
            let nextYear = year;
            do { nextYear += 1; } while (!parseIsoDateTime(`${nextYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) || parseIsoDateTime(`${nextYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) < todayStart);
            datePart = `${nextYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    return `${datePart}${match[2] ? ` ${match[2].padStart(5, '0')}` : ''}`;
}

function formatDateForQuestion(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return `${Number(match[3])} ${months[Number(match[2]) - 1]}`;
}

function buildApplicationCode(state) {
    const createdValue = state?.applicationCreatedAt || state?.updatedAt || new Date().toISOString();
    const createdDate = new Date(createdValue);
    const safeCreated = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
    const dateCode = d => {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', year: '2-digit' }).formatToParts(d);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.day}${values.month}${values.year}`;
    };
    const equipment = Array.isArray(state?.project?.equipment) ? state.project.equipment : [];
    let equipmentCode = 'X';
    if (equipment.includes('all') || ['sound', 'led', 'light', 'stage'].every(item => equipment.includes(item))) equipmentCode = 'F';
    else {
        const letters = [];
        if (equipment.includes('led')) letters.push('V');
        if (equipment.includes('sound')) letters.push('A');
        if (equipment.includes('light')) letters.push('L');
        if (equipment.includes('stage')) letters.push('S');
        if (letters.length) equipmentCode = letters.join('');
    }
    const startValue = String(state?.project?.dateStart || '').trim();
    const startMatch = startValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const startCode = startMatch ? `${startMatch[3]}${startMatch[2]}${startMatch[1].slice(-2)}` : '000000';
    return `MLK-${dateCode(safeCreated)}-${equipmentCode}/${startCode}`;
}

function refreshApplicationCode(state) {
    if (!state) return;
    if (!state.applicationCreatedAt) state.applicationCreatedAt = state.updatedAt || new Date().toISOString();
    state.applicationCode = buildApplicationCode(state);
}

function parseRussianDateRange(text) {
    const value = String(text || '').toLowerCase().replace(/ё/g, 'е');
    const months = {
        января: 1, январь: 1, январе: 1,
        февраля: 2, февраль: 2, феврале: 2,
        марта: 3, март: 3, марте: 3,
        апреля: 4, апрель: 4, апреле: 4,
        мая: 5, май: 5, мае: 5,
        июня: 6, июнь: 6, июне: 6,
        июля: 7, июль: 7, июле: 7,
        августа: 8, август: 8, августе: 8,
        сентября: 9, сентябрь: 9, сентябре: 9,
        октября: 10, октябрь: 10, октябре: 10,
        ноября: 11, ноябрь: 11, ноябре: 11,
        декабря: 12, декабрь: 12, декабре: 12
    };
    const monthPattern = Object.keys(months).join('|');
    const re = new RegExp('(?:с|с\\s*)\\s*(\\d{1,2})\\s+(' + monthPattern + ')(?:\\s+(\\d{4}))?\\s+(?:по|до|—|-)\\s*(\\d{1,2})(?:\\s+(' + monthPattern + '))?(?:\\s+(\\d{4}))?', 'i');
    const m = value.match(re);
    if (!m) return null;
    const startDay = Number(m[1]);
    const startMonth = months[m[2]];
    const endDay = Number(m[4]);
    const endMonth = m[5] ? months[m[5]] : startMonth;
    const now = new Date();
    let startYear = Number(m[3] || m[6] || now.getFullYear());
    let endYear = Number(m[6] || m[3] || startYear);
    if (!m[3] && !m[6]) {
        const startCandidate = new Date(startYear, startMonth - 1, startDay);
        if (startCandidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) startYear += 1;
        endYear = startYear;
        if (endMonth < startMonth) endYear += 1;
    } else if (!m[6] && endMonth < startMonth) {
        endYear = startYear + 1;
    }
    const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { start: iso(startYear, startMonth, startDay), end: iso(endYear, endMonth, endDay) };
}

function parseRussianDateMentions(text) {
    const value = String(text || '').toLowerCase().replace(/ё/g, 'е');
    const months = {
        января: 1, январь: 1, январе: 1, февраля: 2, февраль: 2, феврале: 2,
        марта: 3, март: 3, марте: 3, апреля: 4, апрель: 4, апреле: 4,
        мая: 5, май: 5, мае: 5, июня: 6, июнь: 6, июне: 6,
        июля: 7, июль: 7, июле: 7, августа: 8, август: 8, августе: 8,
        сентября: 9, сентябрь: 9, сентябре: 9, октября: 10, октябрь: 10, октябре: 10,
        ноября: 11, ноябрь: 11, ноябре: 11, декабря: 12, декабрь: 12, декабре: 12
    };
    const monthPattern = Object.keys(months).join('|');
    const regex = new RegExp('\\b(\\d{1,2})\\s*(' + monthPattern + ')(?:\\s+(\\d{4}))?', 'gi');
    const matches = [...value.matchAll(regex)];
    const today = new Date();
    return matches.map((match, index) => {
        const day = Number(match[1]);
        const month = months[match[2]];
        let year = Number(match[3] || today.getFullYear());
        const dateCandidate = y => new Date(y, month - 1, day);
        if (!match[3] && dateCandidate(year) < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
            do { year += 1; } while (dateCandidate(year) < new Date(today.getFullYear(), today.getMonth(), today.getDate()));
        }
        const nextStart = matches[index + 1]?.index ?? value.length;
        const tail = value.slice(match.index + match[0].length, nextStart);
        const time = tail.match(/(?:\b(?:в|к|до)\s*)?(\d{1,2})[:.]([0-5]\d)\b/);
        const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const iso = dateCandidate(year);
        if (iso.getFullYear() !== year || iso.getMonth() !== month - 1 || iso.getDate() !== day) return null;
        return { date: `${isoDate}${time ? ` ${String(Number(time[1])).padStart(2, '0')}:${time[2]}` : ''}`, index: match.index };
    }).filter(Boolean);
}

function applyDirectContextualAnswers(state, text, expectedField = null) {
    const value = String(text || '').trim();
    const lower = value.toLowerCase().replace(/ё/g, 'е');
    if (!value) return;

    // Количество дней, названное клиентом в свободной форме.
    if (state.project.multiDay === null || state.project.multiDay === undefined) {
        if (/(?:в\s+один\s+день|один\s+день|однодневн[а-яё]*|только\s+один\s+день)/i.test(lower)) {
            state.project.multiDay = false;
        } else if (/(?:несколько\s+дней|многодневн[а-яё]*|(?<![а-яё\d])(?:2|3|4|5|6|7|два|три|четыре|пять)\s+дн(?:я|ей)(?![а-яё])|(?<![а-яё])двух\s+дн|(?<![а-яё])тр[её]х\s+дн)/i.test(lower)) {
            state.project.multiDay = true;
        }
    }

    const readinessExpected = expectedField === 'readyDate' || expectedField === 'readyDateTime';
    const hasReadyContext = readinessExpected ||
        /(?:оборудован\w*|все\s+должно\s+стоять|всё\s+должно\s+стоять|конструкц\w*).{0,100}(?:готов\w*|стоя\w*|установлен\w*|к\s*\d{1,2})/i.test(lower) ||
        /(?:должно\s+быть\s+готово|должны\s+быть\s+готовы|всё\s+должно\s+стоять|все\s+должно\s+стоять)/i.test(lower);

    // «В один день» / «мероприятие один день» задаёт ту же дату окончания.
    // Если время окончания неизвестно, calculateMissing спросит только время.
    if (expectedField === 'dateEnd' && /(?:всё?\s+в\s+один\s+день|мероприятие\s+один\s+день|один\s+день\s+только|только\s+один\s+день)/i.test(lower) && hasDateOrDateTime(state.project.dateStart)) {
        const currentEndTime = String(state.project.dateEnd || '').match(/\s+(\d{1,2}:\d{2})$/)?.[1] || '';
        state.project.dateEnd = `${String(state.project.dateStart).slice(0, 10)}${currentEndTime ? ` ${currentEndTime}` : ''}`;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.dateEnd = currentEndTime ? 'confirmed' : 'tentative';
        if (state.deferredFields) delete state.deferredFields.dateEnd;
    }

    // «В этот же день» означает дату текущего мероприятия, а не новую дату.
    if (/(?:в\s+этот\s+же\s+день|того\s+же\s+дня|в\s+тот\s+же\s+день)/i.test(lower) &&
        (expectedField === 'dateEnd' || /окончан|заканч|заверш/i.test(lower)) &&
        hasDateOrDateTime(state.project.dateStart)) {
        const currentEnd = String(state.project.dateEnd || '');
        const currentEndTime = (!hasReadyContext || /(?:окончан|закончится|заверш|до\s+\d{1,2}[:.]\d{2})/i.test(lower)) ? (currentEnd.match(/\s+(\d{1,2}:\d{2})$/)?.[1] || '') : '';
        state.project.dateEnd = `${String(state.project.dateStart).slice(0, 10)}${currentEndTime ? ` ${currentEndTime}` : ''}`;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.dateEnd = 'confirmed';
        if (state.deferredFields) delete state.deferredFields.dateEnd;
    }

    // Время готовности оборудования нельзя принимать за время окончания мероприятия.
    // Если дата готовности не названа, но клиент говорит «в этот же день», используем дату события.
    const mentions = parseRussianDateMentions(value);
    const ambiguousEndDate = expectedField === 'dateEnd' && mentions.length >= 2 && /\b(?:или|либо)\b/i.test(lower);
    if (ambiguousEndDate) {
        // Не выбираем один из нескольких предложенных дней автоматически.
        state.project.dateEnd = null;
        deferField(state, 'dateEnd', `Клиент назвал несколько вариантов даты окончания: ${value}`);
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.dateEnd = 'tentative';
        return;
    }
    if (expectedField === 'readyDate' || expectedField === 'readyDateTime' || hasReadyContext) {
        const firstRangeTime = lower.match(/(?:примерно\s+|около\s+|к\s*|в\s*)+(\d{1,2})(?::([0-5]\d))?/i);
        const secondRangeTime = lower.match(/(?:или|[-–])\s*(?:к|в)?\s*(\d{1,2})(?::([0-5]\d))?/i);
        if (firstRangeTime && secondRangeTime && /\bили\b|[-–]/.test(lower)) {
            const fmt = (m) => `${String(Number(m[1])).padStart(2, '0')}:${String(m[2] || '00').padStart(2, '0')}`;
            let from = fmt(firstRangeTime), to = fmt(secondRangeTime);
            if (to < from) [from, to] = [to, from];
            state.project.readyDateTimeRange = `${from}–${to}`;
            const readyDate = String(state.project.readyDate || '').slice(0, 10) || (mentions.length ? mentions[mentions.length - 1].date.slice(0, 10) : '');
            if (readyDate && /^\d{4}-\d{2}-\d{2}$/.test(readyDate)) {
                state.project.readyDate = `${readyDate} ${from}`;
                state.project.readyDateApproximate = true;
                state.confirmationStatus = state.confirmationStatus || {};
                state.confirmationStatus.readyDate = 'tentative';
                if (state.deferredFields) delete state.deferredFields.readyDate;
            }
        }
    }

    if (hasReadyContext && /(?:\b\d{1,2}:[0-5]\d\b|(?:^|\s)(?:в|к|до|около|примерно)\s*\d{1,2}(?!\d)|(?:^|\s)\d{1,2}\s*(?:утра|дня|вечера|ночи)(?=\s|$|[,.;!?]))/i.test(lower)) {
        let readyDate = mentions.length ? mentions[mentions.length - 1].date.slice(0, 10) : '';
        if (!readyDate && /(?:в\s+этот\s+же\s+день|того\s+же\s+дня|в\s+тот\s+же\s+день)/i.test(lower)) {
            readyDate = String(state.project.dateStart || state.project.dateEnd || '').slice(0, 10);
        }
        if (!readyDate && hasDateOrDateTime(state.project.readyDate)) {
            readyDate = String(state.project.readyDate).slice(0, 10);
        }
        const time = parseTimeAnswer(value);
        if (readyDate && time) {
            if (!state.project.readyDateTimeRange) state.project.readyDate = `${readyDate} ${time}`;
            state.project.readyDateApproximate = Boolean(state.project.readyDateTimeRange) || /(?:около|примерно|приблизительно|ориентировочно|где-то|где то)/i.test(value);
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.readyDate = state.project.readyDateApproximate ? 'tentative' : 'confirmed';
            if (state.deferredFields) delete state.deferredFields.readyDate;
        }
    }

    // В первом описании проекта дата готовности часто указывается отдельной фразой:
    // «С 5 по 8 декабря, всё должно стоять 4 декабря».
    if (hasReadyContext && mentions.length) {
        const readinessMention = mentions[mentions.length - 1];
        const readyDateOnly = readinessMention.date.slice(0, 10);
        if (!state.project.readyDate || !hasDateOrDateTime(state.project.readyDate) ||
            !String(state.project.readyDate).startsWith(readyDateOnly)) {
            state.project.readyDate = readyDateOnly;
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.readyDate = 'confirmed';
            if (state.deferredFields) delete state.deferredFields.readyDate;
        }
    }
    const assignDateIfUseful = (field, candidate) => {
        if (!candidate) return;
        if (!state.project[field] || !hasDateOrDateTime(state.project[field]) || (!hasDateAndTime(state.project[field]) && hasDateAndTime(candidate))) {
            state.project[field] = candidate;
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus[field] = 'confirmed';
            if (state.deferredFields) delete state.deferredFields[field];
        }
    };
    // Если в одном сообщении есть дата готовности, не принимаем её за дату окончания.
    const eventMentions = hasReadyContext && mentions.length >= 2 ? mentions.slice(0, -1) : mentions;
    if (eventMentions.length >= 2) {
        assignDateIfUseful('dateStart', eventMentions[0].date);
        assignDateIfUseful('dateEnd', eventMentions[1].date);
    } else if (eventMentions.length === 1) {
        const candidate = eventMentions[0].date;
        if (expectedField === 'dateEnd' || /(?:окончан|закончится|заверш|до какого времени)/i.test(lower)) assignDateIfUseful('dateEnd', candidate);
        else if (expectedField === 'readyDate' || /(?:готовност|оборудован.{0,20}готово)/i.test(lower)) assignDateIfUseful('readyDate', candidate);
        else if (expectedField === 'dateStart' || /(?:начало|начнется|начнётся|старт|репетиц|^с\s+\d{1,2}\s+(?:январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр))/i.test(lower)) assignDateIfUseful('dateStart', candidate);
    }

    // Диапазон дат из первого описания проекта: «с 5 декабря по 12».
    const range = parseRussianDateRange(value);
    if (range) {
        // Явный диапазон дат в сообщении клиента надёжнее даты, которую мог
        // неточно извлечь LLM. Обновляем даты из текста, сохраняя уже известное время.
        const preserveTime = (currentValue, date) => {
            const time = String(currentValue || '').match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}:\d{2})$/)?.[1];
            return `${date}${time ? ` ${time}` : ''}`;
        };
        state.project.dateStart = preserveTime(state.project.dateStart, range.start);
        state.project.dateEnd = preserveTime(state.project.dateEnd, range.end);
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.dateStart = 'confirmed';
        state.confirmationStatus.dateEnd = 'confirmed';
        if (state.deferredFields) {
            delete state.deferredFields.dateStart;
            delete state.deferredFields.dateEnd;
        }
    }

    // Сохраняем монтаж за день до события и демонтаж после окончания,
    // даже если клиент сообщил это в первом длинном сообщении.
    if (/(?:монтаж|монтир\w*|установк\w*).{0,100}за день(?:\s+до)?/i.test(lower)) {
        state.project.mount = state.project.mount || 'any';
        state.project.mountTime = state.project.mountTime || 'За день до начала мероприятия';
        if (state.deferredFields) { delete state.deferredFields.mount; delete state.deferredFields.mountTime; }
    }
    const meansAfterEvent = /(?:сразу|немедленно|сразу же)\s+после\s+(?:окончания\s+)?(?:мероприятия|события)|после\s+окончания\s+мероприятия/i.test(lower);
    const explicitDemountAfterEvent = meansAfterEvent && (expectedField === 'demount' || /демонтаж|демонтир\w*|сняти\w*/i.test(lower));
    if (explicitDemountAfterEvent || /(?:демонтаж|демонтир\w*|сняти\w*).{0,120}(?:сразу после|после окончания|после конца|около\s*\d{1,2}(?::\d{2})?)/i.test(lower)) {
        const timeMatch = lower.match(/(?:около|примерно|предварительно около)\s*(\d{1,2}(?::\d{2})?)/i);
        if (explicitDemountAfterEvent) {
            state.project.demount = 'after_event';
            state.project.demountTime = null;
        } else {
            state.project.demount = state.project.demount || 'deadline';
            state.project.demountTime = state.project.demountTime || (timeMatch ? `Сразу после окончания мероприятия, ориентировочно ${timeMatch[1]}` : 'Сразу после окончания мероприятия');
        }
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.demount = 'confirmed';
        if (state.deferredFields) { delete state.deferredFields.demount; delete state.deferredFields.demountTime; }
    }

    // Позднее уточнение лифта: «он есть 3 на 2 метра» должно обновлять
    // и тип лифта, и размеры, даже если воронка уже дошла до итогов.
    const historyText = (state.history || []).slice(-10).map(x => `${x.role || ''} ${x.text || x.content || ''}`).join(' ');
    const dims = value.match(/(\d+(?:[,.]\d+)?)\s*(?:м|метр(?:а|ов)?)?\s*(?:×|х|x|на)\s*(\d+(?:[,.]\d+)?)\s*(?:м|метр(?:а|ов)?)?/i);
    if (dims && /(?:лифт|грузов|подъем|подъем|размеры лифта)/i.test(historyText) && /(?:есть|имеется|он есть|грузовой)/i.test(lower)) {
        state.project.lift = 'has_lift';
        state.project.liftDimensions = `${dims[1].replace(',', '.')}×${dims[2].replace(',', '.')} м`;
        if (state.deferredFields) { delete state.deferredFields.lift; delete state.deferredFields.liftDimensions; }
    }
}


function hasExplicitTimeInText(text) {

    if (!text) {
        return false;
    }

    return /\b\d{1,2}[:.]\d{2}\b/.test(
        String(text)
    );
}


function isNotAnAddress(value) {

    if (!value) {
        return true;
    }

    const normalized =
        String(value)
            .trim()
            .toLowerCase()
            .replace(/[.!?]+$/g, '');

    const invalidValues = [
        'улица', 'на улице', 'помещение', 'в помещении', 'под навесом',
        'навес', 'газон', 'трава', 'грунт', 'асфальт', 'плитка'
    ];
    if (invalidValues.includes(normalized)) return true;

    // Не позволяем случайно сохранить фразу с датами/временем как адрес.
    if (/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/i.test(normalized)) return true;
    if (/(?:начало|окончание|закончится|готовность оборудования|дата мероприятия|даты мероприятия)/i.test(normalized) && !/(?:ул\.?|улиц|проспект|пр-т|переулок|проезд|площадь|шоссе|город|г\.)/i.test(normalized)) return true;
    return false;
}


function normalizeNotRequired(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const normalized =
        String(value)
            .trim()
            .toLowerCase()
            .replace(/[.!?]+$/g, '');

    const notRequired = [
        'нет',
        'не требуется',
        'не нужно',
        'не нужен',
        'не нужна',
        'не нужны',
        'не надо',
        'не понадобится'
    ];

    if (
        notRequired.includes(
            normalized
        )
    ) {
        return 'not_required';
    }

    return value;
}


function displayProjectValue(value) {
    if (value === 'not_required') return 'Не требуется';
    if (value === 'unknown' || value === 'не знаю' || value === 'неизвестно') return 'Нужно уточнить';
    return value;
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

    const normalized = value
        .map(item => String(item).trim())
        .filter(item =>
            allowed.includes(item)
        );

    // "Полный комплекс" = все четыре направления
    if (normalized.includes('all')) {
        return [
            'sound',
            'led',
            'light',
            'stage'
        ];
    }

    return [
        ...new Set(normalized)
    ];
}


function getEventLabel(value) {
    if (isUnknown(value)) return 'Нужно уточнить';
    return EVENT_TYPES[value]?.label || value || 'Не указано';
}


function getLevelLabel(value) {
    if (isUnknown(value)) return 'Нужно уточнить';
    return LEVELS[value]?.label || value || 'Не указано';
}


function getPersonnelLabel(value) {
    if (isUnknown(value)) return 'Нужно уточнить';
    return PERSONNEL[value]?.label || value || 'Не указано';
}


function getPlaceLabel(value) {
    if (isUnknown(value)) return 'Нужно уточнить';
    return PLACES[value]?.label || value || 'Не указано';
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


function inferEventTypeFromText(text) {
    const raw = String(text || '').trim().replace(/[.!?]+$/g, '');
    const value = raw.toLowerCase().replace(/ё/g, 'е');
    if (!value) return null;
    const rules = [
        { category: 'exhibitions', re: /(?:выставк|стенд(?:а|е|ы|ов)?(?:\s+(?:компан|фирм|бренд))?|экспозици|промо[- ]?зон|выставочн)/i },
        { category: 'sports', re: /(?:спортивн|матч|турнир|спартакиад|марафон)/i },
        { category: 'corporate', re: /(?:корпоратив|юбиле|свадьб|тимбилдинг|награждени|открыти\s+(?:магазин|заведени))/i },
        { category: 'conferences', re: /(?:конференц|презентац|форум|саммит|конгресс|семинар|телевизионн|tv[- ]?проект|пресс[- ]конференц)/i },
        { category: 'concerts', re: /(?:спектакл|театр|опера|балет|концерт|фестивал|шоу[- ]?программ|выступлени|open\s*air)/i }
    ];
    const found = rules.find(rule => rule.re.test(value));
    if (!found) return null;
    // Короткий ответ сохраняем дословно (например, «Стенд фирмы Комунарка»).
    // В длинном сообщении сохраняем только распознанное название формата.
    let original = raw;
    if (raw.length > 70 || /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/i.test(raw)) {
        const matchedTerm = raw.match(found.re);
        original = matchedTerm ? matchedTerm[0] : raw.slice(0, 70);
    }
    return { category: found.category, original: original.slice(0, 120) };
}

// ============================================================
// NORMALIZE AI DATA
// ============================================================

function normalizeExtractedData(
    raw,
    sourceText = ''
) {

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
        const value = cleanString(p.eventType);
        if (value && Object.keys(EVENT_TYPES).includes(value)) data.eventType = value;
    }

    if (p.eventTypeOriginal !== undefined) {
        data.eventTypeOriginal = cleanString(p.eventTypeOriginal);
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
        } else if (typeof p.guestCount === 'string' && /\d+\s*[–—-]\s*\d+/.test(p.guestCount)) {
            // Диапазон гостей нельзя сводить к одному числу при сохранении состояния.
            data.guestCount = p.guestCount;
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

    for (const field of ['dateStart', 'dateEnd', 'readyDate']) {
        if (p[field] === undefined || p[field] === null || p[field] === '') continue;
        const normalizedDate = normalizeExtractedDate(p[field], sourceText);
        if (normalizedDate) data[field] = normalizedDate;
    }


    // --------------------------------------------------------
    // LOCATION
    // --------------------------------------------------------

    if (p.location !== undefined) {

        const value =
            cleanString(p.location);

        if (
            value &&
            !isNotAnAddress(value)
        ) {
            data.location = value;
        }
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
            value === 'passenger_lift' ||
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
            normalizeNotRequired(
                cleanString(
                    p.equipmentDetails
                )
            );
    }


    // --------------------------------------------------------
    // EQUIPMENT DETAILS
    // --------------------------------------------------------

    if (p.stageDetails !== undefined) {
        data.stageDetails =
            normalizeNotRequired(
                cleanString(
                    p.stageDetails
                )
            );
    }

    if (p.stageSurface !== undefined) {
        data.stageSurface =
            normalizeNotRequired(
                cleanString(
                    p.stageSurface
                )
            );
    }

    if (p.soundDetails !== undefined) {
        data.soundDetails =
            normalizeNotRequired(
                cleanString(
                    p.soundDetails
                )
            );
    }

    if (p.backline !== undefined) {
        data.backline =
            normalizeNotRequired(
                cleanString(
                    p.backline
                )
            );
    }

    if (p.soundRider !== undefined) {
        data.soundRider =
            normalizeNotRequired(
                cleanString(
                    p.soundRider
                )
            );
    }

    if (p.lightDetails !== undefined) {
        data.lightDetails =
            normalizeNotRequired(
                cleanString(
                    p.lightDetails
                )
            );
    }

    if (p.lightFixtures !== undefined) {
        data.lightFixtures =
            normalizeNotRequired(
                cleanString(
                    p.lightFixtures
                )
            );
    }

    if (p.ledDetails !== undefined) {
        data.ledDetails =
            normalizeNotRequired(
                cleanString(
                    p.ledDetails
                )
            );
    }

    if (p.ledContent !== undefined) {
        data.ledContent =
            normalizeNotRequired(
                cleanString(
                    p.ledContent
                )
            );
    }

    if (p.ledSuspension !== undefined) {
        data.ledSuspension =
            normalizeNotRequired(
                cleanString(
                    p.ledSuspension
                )
            );
    }

    if (p.budget !== undefined) {
        const budget = cleanString(p.budget);
        if (budget) data.budget = budget;
    }

    if (p.additionalServices !== undefined) {
        data.additionalServices =
            normalizeNotRequired(
                cleanString(
                    p.additionalServices
                )
            );
    }

    if (p.specialConditions !== undefined) {
        data.specialConditions =
            normalizeNotRequired(
                cleanString(
                    p.specialConditions
                )
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
            normalizeNotRequired(
                cleanString(
                    p.personnelDetails
                )
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
            cleanString(
                p.demountTime
            );
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
    extracted,
    sourceText = ''
) {

    if (!extracted) return;
    if (!state.confirmationStatus) state.confirmationStatus = {};
    const source = String(sourceText || '');
    const hasUncertainty = /\b(?:возможно|наверное|вероятно|скорее всего|предварительно|примерно|ориентировочно|не уверен(?:а)?|не точно|пока не решили|пока не определили|может быть)\b/i.test(source);
    const fieldContext = {
        eventType: /мероприят|концерт|выставк|корпоратив|конференц|фестивал|формат/i,
        eventLevel: /уровен|требован|высш|стандарт/i,
        guestCount: /гост|человек|посетител|участник/i,
        dateStart: /начал|старт|репетиц|дата/i,
        dateEnd: /окончан|заверш|заканч|дата/i,
        readyDate: /готовност|готово к|оборудован/i,
        location: /адрес|площадк|город|улиц/i,
        place: /улиц|помещени|зал|открыт|улице/i,
        floor: /этаж/i,
        lift: /лифт|лестниц|подъ[её]м/i,
        liftDimensions: /лифт|размер/i,
        personnel: /персонал|техник|монтажник|инженер/i,
        stageDetails: /сцен|конструкц|крыша|ферм|подиум/i,
        soundDetails: /звук|артист|групп|фонограмм|спикер/i,
        lightDetails: /свет|подсвет|аплайтинг/i,
        ledDetails: /led|экран|задник|пиксел/i,
        mount: /монтаж|установк/i,
        demount: /демонтаж|сняти/i
    };
    const assignStatus = (field, value) => {
        if (value === 'unknown' || value === 'не знаю' || value === 'неизвестно') state.confirmationStatus[field] = 'unknown';
        else if (value === 'not_required') state.confirmationStatus[field] = 'not_required';
        else if (hasUncertainty && fieldContext[field]?.test(source)) state.confirmationStatus[field] = 'tentative';
        else state.confirmationStatus[field] = 'confirmed';
    };

    // Client
    if (
        extracted.client &&
        extracted.client.name
    ) {
        state.client.name =
            extracted.client.name;
    }


    const p = state.project;

    if (extracted.eventTypeOriginal) p.eventTypeOriginal = extracted.eventTypeOriginal;

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

        'stageDetails',
        'stageSurface',

        'soundDetails',
        'backline',
        'soundRider',

        'lightDetails',
        'lightFixtures',

        'ledDetails',
        'ledContent',
        'ledSuspension',

        'personnel',
        'personnelDetails',

        'mount',
        'mountTime',
        'demount',
        'demountTime',

        'additionalServices',
        'specialConditions',
        'budget',

        'clientRequest',
        'additionalInfo'
    ];


    // Даты нельзя обновлять выводами модели из сообщения, в котором клиент
    // не называл дату. Например, ответ «6 или 7» на вопрос об этаже не должен
    // превращаться в даты начала/окончания мероприятия.
    const sourceHasExplicitDate = /(?:\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./]\d{1,2}(?:[./](?:\d{2}|\d{4}))?\b|\b\d{1,2}\s*(?:январ[а-яё]*|феврал[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йяею][а-яё]*|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|сентябр[а-яё]*|октябр[а-яё]*|ноябр[а-яё]*|декабр[а-яё]*))/i.test(source);

    for (const field of fields) {

        if (['dateStart', 'dateEnd', 'readyDate'].includes(field) && !sourceHasExplicitDate) {
            continue;
        }

        if (
            extracted[field] !== undefined &&
            extracted[field] !== null &&
            extracted[field] !== ''
        ) {

            let incomingValue = extracted[field];

            // Клиент перенёс дату начала, а дату окончания не назвал: если окончание было
            // в тот же или на следующий день, сдвигаем его на столько же дней.
            if (field === 'dateStart' && extracted.dateEnd === undefined && hasDateOrDateTime(p.dateStart) && hasDateOrDateTime(p.dateEnd)) {
                const oldStart = parseIsoDateTime(String(p.dateStart).slice(0, 10));
                const oldEnd = parseIsoDateTime(String(p.dateEnd).slice(0, 10));
                const newStart = parseIsoDateTime(String(incomingValue).slice(0, 10));
                if (oldStart && oldEnd && newStart) {
                    const span = Math.round((oldEnd - oldStart) / 86400000);
                    const delta = Math.round((newStart - oldStart) / 86400000);
                    if (delta !== 0 && span >= 0 && span <= 1) {
                        const newEndDate = addDaysToIsoDate(String(p.dateEnd).slice(0, 10), delta);
                        const endTime = String(p.dateEnd).match(/\s+(\d{1,2}:\d{2})$/)?.[1] || '';
                        if (newEndDate) p.dateEnd = `${newEndDate}${endTime ? ` ${endTime}` : ''}`;
                    }
                }
            }

            // Клиент перенёс только дату: сохраняем ранее названное время.
            if (['dateStart', 'dateEnd', 'readyDate'].includes(field) && /^\d{4}-\d{2}-\d{2}$/.test(String(incomingValue))) {
                const previousTime = String(p[field] || '').match(/\s+(\d{1,2}:\d{2})$/)?.[1];
                if (previousTime) incomingValue = `${incomingValue} ${previousTime}`;
            }

            p[field] = incomingValue;
            if (field === 'readyDate') {
                p.readyDateTimeRange = null;
                if (p.readyChoice !== 'earlier') p.readyChoice = 'custom';
            }
            assignStatus(field, extracted[field]);

            if (state.deferredFields) {
                delete state.deferredFields[field];
            }
        }
    }


    // Equipment отдельно
    //
    // Если оборудование пришло через свободный текст,
    // не затираем уже выбранное оборудование,
    // а добавляем новые позиции.
    //
    // Кнопки работают иначе:
    // applyAction() передаёт полный актуальный
    // список и записывает его напрямую.

    if (
        Array.isArray(
            extracted.equipment
        )
    ) {

        const currentEquipment =
            Array.isArray(p.equipment)
                ? p.equipment
                : [];


        const newEquipment =
            extracted.equipment;


        p.equipment =
            [
                ...new Set([
                    ...currentEquipment,
                    ...newEquipment
                ])
            ];
        const equipmentUncertain = hasUncertainty && /сцен|конструкц|звук|акустик|свет|экран|оборудован|ферм|подиум/i.test(source);
        state.confirmationStatus.equipment = equipmentUncertain ? 'tentative' : 'confirmed';

        if (p.equipment.length && state.deferredFields) {
            delete state.deferredFields.equipment;
        }
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
        if (state.deferredFields) delete state.deferredFields.eventLevel;
    }


    // --------------------------------------------------------
    // GUEST COUNT
    // --------------------------------------------------------

    if (
        p.eventType !== 'corporate'
    ) {
        p.guestCount = null;
        if (state.deferredFields) delete state.deferredFields.guestCount;
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
        if (state.deferredFields) {
            delete state.deferredFields.floor;
            delete state.deferredFields.lift;
            delete state.deferredFields.liftDimensions;
        }
        if (state.confirmationStatus) {
            delete state.confirmationStatus.floor;
            delete state.confirmationStatus.lift;
            delete state.confirmationStatus.liftDimensions;
        }
    }


    // Первый этаж: вопросы о лифте и его размерах не нужны.
    // Если этаж исправили на первый, убираем ранее сохранённые
    // ответы о лифте, чтобы они не влияли на дальнейшую квалификацию.
    if (p.place === 'indoor' && Number(p.floor) === 1) {
        p.lift = null;
        p.liftDimensions = null;
        if (state.deferredFields) {
            delete state.deferredFields.lift;
            delete state.deferredFields.liftDimensions;
        }
        if (state.confirmationStatus) {
            delete state.confirmationStatus.lift;
            delete state.confirmationStatus.liftDimensions;
        }
    }


    // --------------------------------------------------------
    // LIFT DIMENSIONS
    // --------------------------------------------------------

    if (
        p.lift !== 'has_lift'
    ) {
        p.liftDimensions = null;
        if (state.deferredFields) delete state.deferredFields.liftDimensions;
    }


    // --------------------------------------------------------
    // LIFT DIMENSIONS
    // --------------------------------------------------------
    // Размеры нужны только при грузовом лифте и сценических конструкциях.

    if (
        p.place !== 'indoor' ||
        p.lift !== 'has_lift' ||
        !Array.isArray(p.equipment) ||
        !p.equipment.includes('stage')
    ) {
        p.liftDimensions = null;
    }


    // --------------------------------------------------------
    // STAGE
    // --------------------------------------------------------

    if (!p.equipment.includes('stage')) {
        p.stageDetails = null;
        p.stageSurface = null;
        if (state.deferredFields) {
            delete state.deferredFields.stageDetails;
            delete state.deferredFields.stageSurface;
            delete state.deferredFields.liftDimensions;
        }
        if (state.confirmationStatus) {
            delete state.confirmationStatus.stageDetails;
            delete state.confirmationStatus.stageSurface;
            delete state.confirmationStatus.liftDimensions;
        }
    }


    // --------------------------------------------------------
    // STAGE SURFACE
    // --------------------------------------------------------

    if (
        !p.equipment.includes('stage') ||
        p.place !== 'outdoor'
    ) {
        p.stageSurface = null;
    }


    // --------------------------------------------------------
    // SOUND
    // --------------------------------------------------------

    if (!p.equipment.includes('sound')) {
        p.soundDetails = null;
        p.backline = null;
        p.soundRider = null;
        if (state.deferredFields) {
            delete state.deferredFields.soundDetails;
            delete state.deferredFields.backline;
            delete state.deferredFields.soundRider;
        }
        if (state.confirmationStatus) {
            delete state.confirmationStatus.soundDetails;
            delete state.confirmationStatus.backline;
            delete state.confirmationStatus.soundRider;
        }
    }


    // --------------------------------------------------------
    // LIGHT
    // --------------------------------------------------------

    if (!p.equipment.includes('light')) {
        p.lightDetails = null;
        p.lightFixtures = null;
        if (state.deferredFields) {
            delete state.deferredFields.lightDetails;
            delete state.deferredFields.lightFixtures;
        }
        if (state.confirmationStatus) {
            delete state.confirmationStatus.lightDetails;
            delete state.confirmationStatus.lightFixtures;
        }
    }


    // --------------------------------------------------------
    // LED
    // --------------------------------------------------------

    if (!p.equipment.includes('led')) {
        p.ledDetails = null;
        p.ledContent = null;
        p.ledSuspension = null;
        if (state.deferredFields) {
            delete state.deferredFields.ledDetails;
            delete state.deferredFields.ledContent;
            delete state.deferredFields.ledSuspension;
        }
        if (state.confirmationStatus) {
            delete state.confirmationStatus.ledDetails;
            delete state.confirmationStatus.ledContent;
            delete state.confirmationStatus.ledSuspension;
        }
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
// EQUIPMENT DETAIL VALIDATION HELPERS
// ============================================================

function hasExplicitDimensions(value) {
    return /\d+\s*(?:м|метр(?:а|ов)?)?\s*(?:×|х|x|на)\s*\d+/i.test(String(value || ''));
}

// Клиент просит перейти к следующему вопросу или говорит, что уже ответил.
const SKIP_QUESTION_RE = /^(?:ну\s+|давай\s+|давайте\s+)?(?:к\s+следующему(?:\s+вопросу)?|дальше|следующий\s+вопрос|пропустим|пропустить|идем\s+дальше|идём\s+дальше|хватит\s+(?:уже\s+)?(?:спрашивать|уточнять)|уже\s+(?:говорил|сказал)[а-я]*|так\s+я\s+(?:же\s+)?(?:тебе\s+)?(?:уже\s+)?(?:сказал|говорил)[а-я]*(?:\s+уже)?)[\s.!?]*$/i;

function hasLedQuantity(value) {
    const text = String(value || '').toLowerCase().replace(/ё/g, 'е');
    // «3 экрана», «один экран», «два боковых», «центральный экран»,
    // «центральный 8 на 4 и по бокам 2 на 3», «один по центру».
    return (
        /\d+\s*(?:led[- ]?)?экран[а-я]*/.test(text) ||
        /(?:^|[^а-я])(?:один|одна|одно|два|две|три|четыре|пять|шесть|несколько|пара)\s+(?:led[- ]?)?(?:экран[а-я]*|боков[а-я]*|по\s+(?:бокам|центру|сторонам))/.test(text) ||
        /центральн[а-я]*\s+(?:led[- ]?)?экран|боков[а-я]*\s+(?:led[- ]?)?экран[а-я]*|экраны\s+по\s+обеим\s+сторонам/.test(text) ||
        /(?:центральн[а-я]*|боков[а-я]*)\s+\d/.test(text) ||
        /по\s+бокам\s+\d/.test(text)
    );
}

function explicitlyUnknownDimensions(value) {
    return /(?:размер\w*.{0,25}(?:неизвест|не знаю|не определ)|(?:не знаю|пока неизвестно|пока не определено|уточним позже|определим позже|на ваше усмотрение|вы сами решите|решите сами))/i.test(String(value || ''));
}


// ============================================================
// ANSWERED BUT NEEDS FOLLOW-UP
// ============================================================
// Если клиент ответил, но автоматическое извлечение не смогло надёжно
// определить значение, сохраняем его исходный ответ в deferredFields.
// Воронка продолжает работу, а менеджер видит, что нужно уточнить.
function isDeferred(state, field) {
    return Boolean(state && state.deferredFields && state.deferredFields[field]);
}

// Распознаёт как конкретный этаж (3), так и диапазон (2–3).
// Если хотя бы один возможный этаж выше первого, нужно уточнить способ подъёма.
function isAboveFirstFloor(value) {
    if (typeof value === 'number') return value > 1;
    const text = String(value || '').trim();
    if (!text) return false;
    const numbers = text.match(/\d+/g);
    return Boolean(numbers && numbers.some(number => Number(number) > 1));
}

function deferField(state, field, rawAnswer) {
    if (!state.deferredFields) state.deferredFields = {};
    state.deferredFields[field] = String(rawAnswer || '').trim() || 'Ответ требует уточнения';
}

function isConversationalMetaMessage(text) {
    const value = String(text || '').trim();
    return /^(?:ты на связи|вы на связи|точно всё спросил|точно все спросил|а такие мероприятия вы уже работали|позови менеджера|соедини с менеджером|хочу поговорить с менеджером|кто ты|что ты умеешь)(?=$|[\s!?.,])/i.test(value);
}

function preserveUnparsedAnswer(state, field, rawAnswer) {
    const answer = String(rawAnswer || '').trim();
    // Поле передаётся сюда как expectedField, то есть вопрос действительно
    // ожидал этот ответ. Не проверяем calculateMissing повторно: после частичного
    // extraction модель могла изменить другие поля, и такая проверка мешала
    // сохранить ответ на текущий вопрос.
    if (!field || !answer) return false;

    // Поля, на которые клиент отвечает кнопками: первый непонятный текстовый ответ
    // не пропускает вопрос (его просто задают снова с кнопками). Пропускаем
    // поле только после второго непонятного ответа, чтобы не зациклиться.
    const BUTTON_FIELDS = ['eventType', 'equipment', 'eventLevel', 'personnel'];
    if (BUTTON_FIELDS.includes(field)) {
        const current = state.project ? state.project[field] : null;
        const hasValue = Array.isArray(current) ? current.length > 0 : (current !== null && current !== undefined && current !== '');
        if (!hasValue) {
            state.unparsedAttempts = state.unparsedAttempts || {};
            state.unparsedAttempts[field] = (state.unparsedAttempts[field] || 0) + 1;
            if (state.unparsedAttempts[field] < 2) return false;
        }
    }

    // Если этаж уже сохранён как диапазон (например, «2–3»), не переносим
    // его обратно в deferredFields: значение пригодно для следующего шага —
    // уточнения лифта — хотя точный этаж пока предварительный.
    if (field === 'floor' && /\d+\s*[–-]\s*\d+/.test(String(state.project?.floor || ''))) {
        if (state.deferredFields) delete state.deferredFields.floor;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.floor = 'tentative';
        return true;
    }

    // Если extraction уже записал значение текущего поля, не перезаписываем
    // нормализованный результат исходной фразы клиента.
    if (state.project && state.project[field] !== null &&
        state.project[field] !== undefined && state.project[field] !== '') {
        // Не затираем прежнее значение непонятным ответом, но и не теряем
        // сам факт уточнения: менеджер увидит, что клиент поправлял это поле.
        deferField(state, field, `Клиент уточнил: ${answer}. Нужно проверить и при необходимости обновить значение.`);
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus[field] = 'tentative';
        return true;
    }

    const deferredFields = new Set([
        'guestCount', 'personnel', 'place', 'floor', 'lift',
        'dateConflict', 'eventType', 'eventLevel', 'equipment'
    ]);
    const rawTextFields = new Set([
        'location', 'liftDimensions', 'personnelDetails',
        'stageDetails', 'stageSurface', 'soundDetails',
        'soundRider', 'backline', 'lightDetails', 'lightFixtures',
        'ledDetails', 'ledContent', 'ledSuspension',
        'mount', 'mountTime', 'demount', 'demountTime',
        'additionalServices', 'specialConditions'
    ]);
    const isSoundRiderMeta = field === 'soundRider' && (
        /^(?:текстом|файлом|в сообщении|позже|сейчас|пришлю|отправлю|да|есть)$/i.test(answer) ||
        /(?:ты на связи|вы на связи|алло|ау|привет)/i.test(answer)
    );

    if (deferredFields.has(field) || isSoundRiderMeta) {
        deferField(state, field, answer);
        console.log(`[SALES] Field deferred instead of repeated: ${field}`);
        return true;
    }

    if (rawTextFields.has(field)) {
        state.project[field] = answer;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus[field] = 'tentative';
        if (state.deferredFields) delete state.deferredFields[field];
        console.log(`[SALES] Raw answer saved to ${field}`);
        return true;
    }

    return false;
}

const DEFERRED_FIELD_LABELS = {
    eventType: 'Формат мероприятия',
    equipment: 'Не удалось однозначно определить оборудование',
    eventLevel: 'Уровень технических требований',
    guestCount: 'Количество гостей',
    personnel: 'Требуемый персонал',
    dateStart: 'Дата и время начала',
    dateEnd: 'Дата и время окончания',
    readyDate: 'Время готовности оборудования',
    dateConflict: 'Проверка последовательности дат начала и окончания',
    ledDetails: 'Тип, расположение и размеры LED-экранов',
    place: 'Место проведения: улица или помещение',
    eventDays: 'Сколько дней идёт мероприятие',
    floor: 'Этаж площадки',
    lift: 'Тип лифта / способ подъёма',
    liftDimensions: 'Размеры лифта',
    soundRider: 'Звуковой райдер',
    lightFixtures: 'Требования к световым приборам'
};

// ============================================================
// EVENT DAYS HELPERS
// ============================================================

function addDaysToIsoDate(dateOnly, days) {
    const parsed = parseIsoDateTime(String(dateOnly || '').slice(0, 10));
    if (!parsed) return null;
    parsed.setDate(parsed.getDate() + days);
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

// Если готовность выбрана кнопкой («в день мероприятия» / «за день до») и
// клиент перенёс дату начала, переносим и готовность. Дату, которую клиент
// назвал сам, не трогаем.
function syncReadyDate(state) {
    const p = state.project;
    if (!['event_day', 'day_before'].includes(p.readyChoice) || !p.readyDerivedFrom) return;
    if (!hasDateOrDateTime(p.dateStart) || !hasDateOrDateTime(p.readyDate)) return;

    const startDate = String(p.dateStart).slice(0, 10);
    if (startDate === p.readyDerivedFrom) return;

    const derive = d => (p.readyChoice === 'day_before' ? addDaysToIsoDate(d, -1) : d);
    const readyDate = String(p.readyDate).slice(0, 10);

    if (readyDate === derive(p.readyDerivedFrom)) {
        const time = String(p.readyDate).match(/\s+(\d{1,2}:\d{2})$/)?.[1] || '';
        p.readyDate = `${derive(startDate)}${time ? ` ${time}` : ''}`;
    }
    p.readyDerivedFrom = startDate;
}

// Для мероприятия в один день дата окончания равна дате начала
// (или следующему дню, если мероприятие идёт после полуночи).
// Клиент выбирает только время.
function syncEventDays(state) {
    const p = state.project;
    if (p.multiDay !== false || !hasDateOrDateTime(p.dateStart)) return;

    const startDate = String(p.dateStart).slice(0, 10);
    const endDate = hasDateOrDateTime(p.dateEnd) ? String(p.dateEnd).slice(0, 10) : '';
    const endTime = String(p.dateEnd || '').match(/\s+(\d{1,2}:\d{2})$/)?.[1] || '';

    if (!endDate || (endDate !== startDate && endDate !== addDaysToIsoDate(startDate, 1))) {
        p.dateEnd = `${startDate}${endTime ? ` ${endTime}` : ''}`;
    }

    // Мероприятие в один день, но заканчивается после полуночи («до 00:00», «до 2 ночи»):
    // окончание переносим на следующую дату. Границу ставим на 08:00, чтобы опечатку
    // вроде «с 19:00 до 18:00» не принять за ночное окончание.
    const startTime = String(p.dateStart).match(/\s+(\d{1,2}):(\d{2})$/);
    const finalEnd = String(p.dateEnd || '');
    const finalEndTime = finalEnd.match(/\s+(\d{1,2}):(\d{2})$/);

    if (startTime && finalEndTime && finalEnd.slice(0, 10) === startDate) {
        const startMinutes = Number(startTime[1]) * 60 + Number(startTime[2]);
        const endMinutes = Number(finalEndTime[1]) * 60 + Number(finalEndTime[2]);
        if (endMinutes <= startMinutes && endMinutes <= 8 * 60) {
            p.dateEnd = `${addDaysToIsoDate(startDate, 1)} ${finalEndTime[1]}:${finalEndTime[2]}`;
        }
    }
}

// ============================================================
// CALCULATE MISSING
// ============================================================
//
// Порядок здесь — это фактический порядок воронки.
//
// 1. Формат
// 2. Оборудование
// 3. Уровень / гости
// 4. Персонал
// 5. Дата + время начала
// 6. Дата + время окончания
// 7. Готовность оборудования
// 8. Адрес
// 9. Место
// 10. Этаж
// 11. Лифт
// 12. Размеры лифта
// 13. Детали оборудования
// 14. Монтаж
// 15. Демонтаж
// 16. Дополнительные услуги
// 17. Особые условия

function calculateMissing(state) {

    const p = state.project;
    if (!state.deferredFields) state.deferredFields = {};
    if (!Array.isArray(p.equipment)) p.equipment = [];

    const missing = [];

    // --------------------------------------------------------
    // 1. EVENT TYPE
    // --------------------------------------------------------

    if (!p.eventType && !isDeferred(state, 'eventType')) {

        missing.push({
            field: 'eventType',
            action: 'ask_format'
        });

        return missing;
    }


    // --------------------------------------------------------
// 2. EQUIPMENT
// --------------------------------------------------------

if (
    (!Array.isArray(p.equipment) ||
    p.equipment.length === 0) &&
    !isDeferred(state, 'equipment')
) {

    missing.push({
        field: 'equipment',
        action: 'ask_equipment'
    });

    return missing;
}


// --------------------------------------------------------
// 3. LEVEL / GUEST COUNT
// --------------------------------------------------------

if (
    p.eventType === 'concerts' ||
    p.eventType === 'sports'
) {

    if (!p.eventLevel && !isDeferred(state, 'eventLevel')) {

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
        (p.guestCount === null || p.guestCount === undefined) &&
        !isDeferred(state, 'guestCount')
    ) {

        missing.push({
            field: 'guestCount',
            action: 'ask_guest_count'
        });

        return missing;
    }
}


    // --------------------------------------------------------
    // 4. PERSONNEL
    // --------------------------------------------------------

    if (!p.personnel && !isDeferred(state, 'personnel')) {

        missing.push({
            field: 'personnel',
            action: 'ask_personnel'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 4.1 PERSONNEL DETAILS
    // --------------------------------------------------------

    if (
        p.personnel === 'other' &&
        !p.personnelDetails &&
        !isDeferred(state, 'personnelDetails')
    ) {

        missing.push({
            field: 'personnelDetails',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 5. DATES + TIME
    // --------------------------------------------------------
    // Порядок: один день / несколько -> дата начала -> дата окончания
    // (только для нескольких дней) -> время начала и окончания одним вопросом
    // -> готовность оборудования (дата + время, это влияет на стоимость).
    syncEventDays(state);
    syncReadyDate(state);

    const hasStartDate = hasDateOrDateTime(p.dateStart);
    const hasEndDate = hasDateOrDateTime(p.dateEnd);

    if (p.multiDay !== true && p.multiDay !== false) {
        if (hasStartDate && hasEndDate) {
            p.multiDay = String(p.dateStart).slice(0, 10) !== String(p.dateEnd).slice(0, 10);
        } else {
            missing.push({ field: 'eventDays', action: 'ask_days' });
            return missing;
        }
    }

    if (!hasStartDate) {
        missing.push({ field: 'dateStart', action: 'ask_date_start' });
        return missing;
    }

    if (p.multiDay && !hasEndDate) {
        missing.push({ field: 'dateEnd', action: 'ask_date_end' });
        return missing;
    }

    const startHasTime = hasDateAndTime(p.dateStart);
    const endHasTime = hasDateAndTime(p.dateEnd);

    if (!startHasTime && !endHasTime) {
        missing.push({ field: 'eventTimes', action: 'text_question' });
        return missing;
    }
    if (!startHasTime) {
        missing.push({ field: 'dateStartTime', action: 'text_question', dateField: 'dateStart', label: 'начала мероприятия/репетиции', value: p.dateStart });
        return missing;
    }
    if (!endHasTime) {
        missing.push({ field: 'dateEndTime', action: 'text_question', dateField: 'dateEnd', label: 'окончания мероприятия', value: p.dateEnd });
        return missing;
    }

    if (!hasDateOrDateTime(p.readyDate)) {
        missing.push({
            field: 'readyDate',
            action: p.readyChoice === 'earlier' ? 'ask_ready_date' : 'ask_ready_choice'
        });
        return missing;
    }
    if (!hasDateAndTime(p.readyDate)) {
        missing.push({ field: 'readyDateTime', action: 'text_question', dateField: 'readyDate', label: 'готовности оборудования', value: p.readyDate });
        return missing;
    }

    // Не подтверждаем заявку, если окончание стоит раньше начала.
    const startDate = parseIsoDateTime(p.dateStart);
    const endDate = parseIsoDateTime(p.dateEnd);
    if (startDate && endDate && endDate < startDate) {
        missing.push({ field: 'dateConflict', action: 'ask_date_conflict' });
        return missing;
    }

    // Оборудование должно быть готово к началу мероприятия, а не после него.
    // Сохраняем ошибочное значение в deferredFields для менеджера, но убираем
    // его из подтверждённых данных и просим клиента указать корректную готовность.
    const readyDate = parseIsoDateTime(p.readyDate);
    if (startDate && readyDate && readyDate > startDate) {
        const rejectedReadyDate = String(p.readyDate);
        deferField(
            state,
            'readyDate',
            `Указана готовность ${rejectedReadyDate}, но мероприятие начинается ${p.dateStart}. Нужно уточнить дату и время готовности оборудования.`
        );
        p.readyDate = null;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.readyDate = 'tentative';
        missing.push({ field: 'readyDate', action: 'ask_ready_date' });
        return missing;
    }


    // --------------------------------------------------------
    // 6. LOCATION
    // --------------------------------------------------------

    if (!p.location && !isDeferred(state, 'location')) {

        missing.push({
            field: 'location',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 7. PLACE
    // --------------------------------------------------------

    if (!p.place && !isDeferred(state, 'place')) {

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
        p.floor === null &&
        !isDeferred(state, 'floor')
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
    // Помещение + 2 этаж и выше
    // --------------------------------------------------------

    if (
        p.place === 'indoor' &&
        isAboveFirstFloor(p.floor) &&
        !p.lift &&
        !isDeferred(state, 'lift')
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
    // Размеры уточняем только если площадка выше первого этажа,
    // есть грузовой лифт и в заявке присутствуют сценические конструкции.
    // При неизвестном этаже сначала уточняем этаж; на первом этаже
    // вопросы о лифте и его размерах не задаём.
    // --------------------------------------------------------

    if (
        p.place === 'indoor' &&
        isAboveFirstFloor(p.floor) &&
        p.lift === 'has_lift' &&
        Array.isArray(p.equipment) && p.equipment.includes('stage') &&
        !p.liftDimensions &&
        !isDeferred(state, 'liftDimensions')
    ) {

        missing.push({
            field: 'liftDimensions',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 11. EQUIPMENT DETAILS
    // --------------------------------------------------------

    // STAGE
    if (
        p.equipment.includes('stage') &&
        !p.stageDetails &&
        !isDeferred(state, 'stageDetails')
    ) {

        missing.push({
            field: 'stageDetails',
            action: 'text_question'
        });

        return missing;
    }


    // STAGE SURFACE
    if (
        p.equipment.includes('stage') &&
        p.place === 'outdoor' &&
        !p.stageSurface &&
        !isDeferred(state, 'stageSurface')
    ) {

        missing.push({
            field: 'stageSurface',
            action: 'text_question'
        });

        return missing;
    }


    // SOUND
    if (
        p.equipment.includes('sound') &&
        !p.soundDetails &&
        !isDeferred(state, 'soundDetails')
    ) {

        missing.push({
            field: 'soundDetails',
            action: 'text_question'
        });

        return missing;
    }


    // SOUND RIDER
    if (
        p.equipment.includes('sound') &&
        !p.soundRider &&
        !isDeferred(state, 'soundRider')
    ) {

        missing.push({
            field: 'soundRider',
            action: 'ask_sound_rider'
        });

        return missing;
    }


    // BACKLINE
    if (
        p.equipment.includes('sound') &&
        !p.backline &&
        !isDeferred(state, 'backline')
    ) {

        missing.push({
            field: 'backline',
            action: 'text_question'
        });

        return missing;
    }


    // LIGHT
    if (
        p.equipment.includes('light') &&
        !p.lightDetails &&
        !isDeferred(state, 'lightDetails')
    ) {

        missing.push({
            field: 'lightDetails',
            action: 'text_question'
        });

        return missing;
    }


    // LIGHT FIXTURES
    if (
        p.equipment.includes('light') &&
        !p.lightFixtures &&
        !isDeferred(state, 'lightFixtures')
    ) {

        missing.push({
            field: 'lightFixtures',
            action: 'ask_light_fixtures'
        });

        return missing;
    }


    // LED
    // Количество и размеры уточняем, если клиент их ещё не назвал.
    // Если клиент прямо сообщил, что размеры пока неизвестны или решение
    // оставляет специалистам MLK, фиксируем это как отложенное уточнение.
    const ledDimensionsExplicitlyDeferred =
        explicitlyUnknownDimensions(p.ledDetails) ||
        /размеры LED-экрана пока неизвестны|размеры.{0,30}(?:неизвестны|не знаю|уточним позже|определим позже)/i.test(String(state.deferredFields.ledDetails || ''));

    if (
        p.equipment.includes('led') &&
        (!p.ledDetails || ((!hasExplicitDimensions(p.ledDetails) || !hasLedQuantity(p.ledDetails)) && !ledDimensionsExplicitlyDeferred))
    ) {

        missing.push({
            field: 'ledDetails',
            action: 'text_question'
        });

        return missing;
    }


    if (
        p.equipment.includes('led') &&
        !p.ledContent &&
        !isDeferred(state, 'ledContent')
    ) {

        missing.push({
            field: 'ledContent',
            action: 'text_question'
        });

        return missing;
    }


    if (
        p.equipment.includes('led') &&
        !p.ledSuspension &&
        !isDeferred(state, 'ledSuspension')
    ) {

        missing.push({
            field: 'ledSuspension',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 12. MOUNT
    // --------------------------------------------------------

    if (!p.mount && !isDeferred(state, 'mount')) {

        missing.push({
            field: 'mount',
            action: 'ask_mount'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 13. MOUNT TIME
    // --------------------------------------------------------

    if (
        p.mount === 'night' &&
        !p.mountTime &&
        !isDeferred(state, 'mountTime')
    ) {

        missing.push({
            field: 'mountTime',
            action: 'text_question'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 14. DEMOUNT
    // --------------------------------------------------------

    if (!p.demount && !isDeferred(state, 'demount')) {

        missing.push({
            field: 'demount',
            action: 'ask_demount'
        });

        return missing;
    }


    // --------------------------------------------------------
    // 15. DEMOUNT TIME
    // --------------------------------------------------------

    if (
        p.demount === 'deadline' &&
        !p.demountTime &&
        !isDeferred(state, 'demountTime')
    ) {

        missing.push({
            field: 'demountTime',
            action: 'text_question'
        });

        return missing;
    }


    // Дополнительные услуги и особые условия фиксируем, если клиент упоминает их сам.
    // Отдельные финальные вопросы по этим темам намеренно не задаём.

    return missing;
}


// ============================================================
// OPTIONAL STEPS (после обязательной квалификации)
// ============================================================
// Бюджет, «что-то добавить?» и контакты — необязательные вопросы.
// Клиент всегда может их пропустить.

const OPTIONAL_STEPS = ['budget', 'extra', 'contacts'];

const OPTIONAL_QUESTIONS = {
    budget: 'Если у вас есть ориентир по бюджету, напишите его. Это необязательно: можно написать «пропустить».',
    extra: 'Хотите что-то добавить к заявке? Например, особые пожелания или важные детали. Если добавить нечего, напишите «нет».',
    contacts: 'И последнее, тоже необязательно: оставьте телефон и название компании, если хотите, чтобы менеджер мог связаться с вами не только в Telegram. Можно написать «пропустить».'
};

function ensureOptional(state) {
    ensureStateExtras(state);
    return state.optional;
}

function getPendingOptionalStep(state) {
    if (calculateMissing(state).length) return null;
    const optional = ensureOptional(state);
    return OPTIONAL_STEPS.find(step => optional[step] !== 'done' && optional[step] !== 'skipped') || null;
}

function isApplicationComplete(state) {
    return calculateMissing(state).length === 0 && !getPendingOptionalStep(state);
}

function makeButtonsAction(tag, buttons) {
    return { type: 'quick_reply', tag, buttons };
}

function getConfirmActions() {
    return [
        makeButtonsAction('confirm_application', [
            { text: '✅ Подтвердить', value: 'yes' },
            { text: '✏️ Исправить', value: 'edit' }
        ])
    ];
}

function getEditBlockActions() {
    return [
        makeButtonsAction('edit_block', [
            ...Object.entries(EDIT_BLOCKS).map(([value, block]) => ({ text: block.label, value })),
            { text: '← Назад', value: 'back' }
        ])
    ];
}

function getOptionalSkipActions(step) {
    return [makeButtonsAction('optional_skip', [{ text: 'Пропустить', value: step }])];
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
        'ask_sound_rider'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_sound_rider'
        };
    }


    if (
        first.action ===
        'ask_light_fixtures'
    ) {

        return {
            type: 'quick_reply',
            tag: 'ask_light_fixtures'
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


    if (first.action === 'ask_days') {

        return makeButtonsAction('ask_days', [
            { text: 'Один день', value: 'one_day' },
            { text: 'Несколько дней', value: 'multi_day' }
        ]);
    }


    if (first.action === 'ask_ready_choice') {

        return makeButtonsAction('ask_ready_choice', [
            { text: 'В день мероприятия', value: 'event_day' },
            { text: 'За день до', value: 'day_before' },
            { text: 'Раньше / другая дата', value: 'earlier' }
        ]);
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
// GET ACTIONS
// ============================================================
//
// Возвращает одно следующее действие,
// определённое Sales Engine.
//
// Порядок вопросов контролируется calculateMissing().
//

function getActions(state) {

    const missing =
        calculateMissing(state);

    if (!missing.length) {
        return [];
    }

    const next =
        getNextAction(state);

    if (
        next.type === 'summary'
    ) {
        return [];
    }

    if (
        state.lastAction !== 'ask_sound_rider_yes' &&
        state.lastAction !== 'ask_light_fixtures_yes'
    ) {
        state.lastAction =
            missing[0]?.action || null;
    }

    return [next];
}


// ============================================================
// DEEPSEEK REQUEST
// ============================================================

const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 30000;
const DEEPSEEK_RETRIES = Number.isFinite(Number(process.env.DEEPSEEK_RETRIES))
    ? Number(process.env.DEEPSEEK_RETRIES)
    : 1;

// Если DeepSeek только что не отвечал, следующие запросы этого же сообщения
// не должны снова ждать полный таймаут с повторами.
let deepseekLastFailureAt = 0;
const DEEPSEEK_DEGRADED_WINDOW_MS = 30000;
const DEEPSEEK_DEGRADED_TIMEOUT_MS = 8000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callDeepSeek(
    messages,
    options = {}
) {

    if (!DEEPSEEK_API_KEY) {

        throw new Error(
            'DEEPSEEK_API_KEY не задан.'
        );
    }

    const body = {
        model: options.model || DEEPSEEK_MODEL,
        messages,
        stream: false,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.max_tokens || 1200
    };

    // Для служебных запросов (извлечение данных, intent) просим строго JSON.
    if (options.json) {
        body.response_format = { type: 'json_object' };
    }

    const degraded = Date.now() - deepseekLastFailureAt < DEEPSEEK_DEGRADED_WINDOW_MS;
    const maxAttempts = degraded ? 1 : 1 + Math.max(0, options.retries ?? DEEPSEEK_RETRIES);
    const baseTimeout = options.timeoutMs || DEEPSEEK_TIMEOUT_MS;
    const timeoutMs = degraded ? Math.min(baseTimeout, DEEPSEEK_DEGRADED_TIMEOUT_MS) : baseTimeout;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {

            const response = await fetch(
                DEEPSEEK_URL,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                }
            );

            if (!response.ok) {

                const raw = await response.text();
                const error = new Error(
                    `DeepSeek HTTP ${response.status}: ${raw.slice(0, 1000)}`
                );
                // 429 и 5xx имеет смысл повторить, остальные ошибки — нет.
                error.retryable = response.status === 429 || response.status >= 500;
                throw error;
            }

            const data = await response.json();

            if (data.error) {

                const error = new Error(
                    `DeepSeek API error: ${data.error.message || JSON.stringify(data.error)}`
                );
                error.retryable = false;
                throw error;
            }

            const content = data?.choices?.[0]?.message?.content;
            const finishReason = data?.choices?.[0]?.finish_reason || null;

            if (!content) {

                const error = new Error('DeepSeek вернул пустой ответ.');
                error.retryable = true;
                throw error;
            }

            const cleanContent = String(content).trim();
            deepseekLastFailureAt = 0;
            return options.returnMeta ? { content: cleanContent, finishReason } : cleanContent;

        } catch (error) {

            if (error && error.name === 'AbortError') {
                error = new Error(`DeepSeek не ответил за ${Math.round(timeoutMs / 1000)} с.`);
                error.retryable = true;
            }

            const networkError = error && (error.name === 'TypeError' || error.name === 'SyntaxError');
            lastError = error;

            if (!(error.retryable || networkError) || attempt >= maxAttempts) {
                if (error.retryable || networkError) deepseekLastFailureAt = Date.now();
                throw error;
            }

            console.warn(`⚠️ DeepSeek: попытка ${attempt}/${maxAttempts} не удалась (${error.message}). Повтор.`);
            await sleep(600 * attempt);

        } finally {

            clearTimeout(timer);
        }
    }

    throw lastError || new Error('DeepSeek: неизвестная ошибка.');
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

function getTodayInfo() {
    const now = new Date();
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk', year: 'numeric', month: 'numeric', day: 'numeric' }).format(now);
    const weekday = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'long' }).format(now);
    const [y, m, d] = iso.split('-');
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} (${weekday})`;
}

function getLastAssistantMessage(state) {
    const history = state.history || [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') return String(history[i].content || '').slice(0, 600);
    }
    return '';
}

const EDIT_BLOCKS = {
    dates: {
        label: 'Даты и время',
        fields: 'dateStart, dateEnd, readyDate',
        prompt: 'Напишите, что нужно изменить в датах и времени: начало, окончание или готовность оборудования.'
    },
    venue: {
        label: 'Площадка',
        fields: 'location, place, floor, lift, liftDimensions',
        prompt: 'Напишите, что нужно изменить по площадке: адрес, улица или помещение, этаж, лифт.'
    },
    equipment: {
        label: 'Оборудование',
        fields: 'equipment, stageDetails, stageSurface, soundDetails, soundRider, backline, lightDetails, lightFixtures, ledDetails, ledContent, ledSuspension',
        prompt: 'Напишите, что нужно изменить по оборудованию: сцена, звук, свет, экраны.'
    },
    service: {
        label: 'Персонал и монтаж',
        fields: 'personnel, personnelDetails, mount, mountTime, demount, demountTime',
        prompt: 'Напишите, что нужно изменить по персоналу, монтажу или демонтажу.'
    },
    other: {
        label: 'Другое',
        fields: 'eventType, eventLevel, guestCount, budget, additionalInfo, specialConditions',
        prompt: 'Напишите, что нужно изменить: формат мероприятия, количество гостей, бюджет или другие детали.'
    }
};

async function extractClientData(
    state,
    userText,
    hint = {}
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
- passenger_lift
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
- after_event

ВАЖНО ПО МОНТАЖУ И ДЕМОНТАЖУ:

Упоминание клиентом слов «монтаж», «демонтаж»,
«нужен монтаж», «нужен демонтаж» или «монтаж-демонтаж»
САМО ПО СЕБЕ НЕ означает, что поле mount или demount заполнено.

Поле mount можно заполнять ТОЛЬКО если клиент явно
сообщил условия или время монтажа.

Поле demount можно заполнять ТОЛЬКО если клиент явно
сообщил условия или время демонтажа.

Если клиент сказал только «нужен монтаж и демонтаж» —
не заполняй mount и demount.

Если клиент сказал «в любое время» без указания,
относится ли это к монтажу или демонтажу,
не заполняй одновременно оба поля.

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

Если клиент явно ответил "нет", "не требуется", "не нужно",
"не нужен", "не нужна", "не нужны", "не надо" или смысловой
эквивалент для текстового поля, сохрани это как значение
"not_required". Не оставляй такие ответы пустыми.
ВАЖНОЕ ИСКЛЮЧЕНИЕ: ответ «отдельных требований к световым приборам нет»
означает отсутствие специальных требований к типу/количеству, а НЕ то,
что световые приборы не нужны. Сохраняй смысл именно так.

Если клиент исправляет ранее сказанное значение —
верни новое значение.

Если клиент сообщает технические детали оборудования,
распредели их по соответствующим полям:

stageDetails — тип и размеры сценических конструкций,
крыша, боковые уши, подиум, пультовая, фермы и другие конструкции.

stageSurface — поверхность установки сценических конструкций:
плитка, асфальт, грунт, трава и т. п.

soundDetails — группы, коллективы, артисты, ведущие,
спикеры, солисты, живые группы, оркестры, кавер-бэнды,
фонограммы и другие сведения о звуковом обеспечении.

backline — информация о необходимости или составе бэклайна:
мониторы, барабаны, комбо, инструменты и т. п.

soundRider — информация из звукового райдера,
если клиент её сообщил или описал.

lightDetails — задачи по свету:
подсветка сцены, атмосфера, аплайтинг и т. п.

lightFixtures — требования к типу и количеству световых приборов,
если клиент их сообщил.

ledDetails — тип, размеры и количество LED-экранов.
ВАЖНО: размер экрана (например, «экран 3×2 м») — это именно размер,
а не расположение. Никогда не называй размеры «расположением» и не записывай
их в качестве места установки. Если клиент после этого отвечает коротко
«3 на 3», «4×2» и т. п. на уточнение размеров, считай это исправлением размера:
замени старые габариты новыми, не добавляй их как отдельное уточнение.
Если клиент назвал один экран, сохраняй количество 1.

ledContent — информация о том, что планируется транслировать
на LED-экраны.

ledSuspension — возможность подвеса оборудования
или необходимость напольной конструкции.

additionalServices — дополнительные услуги,
спецэффекты, видеотрансляции, выполнение райдера
и другие дополнительные работы.

specialConditions — особые условия:
ночной монтаж/демонтаж, ограничения по въезду,
пропуска, допуски, условия оплаты, требования к документам
и т. п.

Не переноси информацию между этими полями без основания.
Если клиент сообщил конкретную информацию — сохрани её
в наиболее соответствующем поле.

Структура:

{
  "client": {
    "name": "..."
  },
  "project": {
    "eventType": "...",
    "eventLevel": "...",
    "guestCount": 0,
    "dateStart": "YYYY-MM-DD HH:mm",
    "dateEnd": "YYYY-MM-DD HH:mm",
    "readyDate": "YYYY-MM-DD HH:mm",
    "location": "...",
    "place": "...",
    "floor": 3,
    "lift": "...",
    "liftDimensions": "...",
    "equipment": [],
    "equipmentDetails": "...",

    "stageDetails": "...",
    "stageSurface": "...",

    "soundDetails": "...",
    "backline": "...",
    "soundRider": "...",

    "lightDetails": "...",
    "lightFixtures": "...",

    "ledDetails": "...",
    "ledContent": "...",
    "ledSuspension": "...",

    "personnel": "...",
    "personnelDetails": "...",

    "mount": "...",
    "mountTime": "...",

    "demount": "...",
    "demountTime": "...",

    "additionalServices": "...",
    "specialConditions": "...",
    "budget": "...",

    "clientRequest": "...",
    "additionalInfo": "..."
  }
}

Важно:

- Не додумывай.
- Не извлекай информацию из старой истории, если её нет
  в последнем сообщении.
- Не меняй значения только потому, что они кажутся логичными.
- Если клиент сообщил дату и время, сохраняй и дату, и время.
- Не отбрасывай время.
- Используй формат YYYY-MM-DD HH:mm, если дата и время однозначно понятны.
- Если клиент сообщил только дату без времени, сохрани известную дату, но не придумывай время.

КОНТЕКСТ ДИАЛОГА (приходит вместе с сообщением):

- expectedField — поле, о котором бот только что спрашивал клиента.
  Короткие ответы («да», «нет», «3 на 3», «ночью», «к 18», «в субботу»)
  трактуй как ответ на этот вопрос и записывай в expectedField
  (или в связанные с ним поля). Если expectedField равен null —
  опирайся только на явно названные факты.
- lastAssistantQuestion — последний вопрос или сообщение бота.
- today — сегодняшняя дата. Относительные даты («завтра», «в субботу»,
  «через две недели», «в следующую пятницу») вычисляй от today
  и всегда возвращай полную дату YYYY-MM-DD.
- editBlock — если задан, клиент исправляет данные из этого блока
  (в editBlockFields перечислены его поля): записывай новые значения
  именно в эти поля и не трогай остальные.
- Если сообщение клиента — вопрос или просьба, а не сообщение
  с данными о проекте, верни пустой project: {}.
- Не записывай в поля текст вопроса клиента.
`;


    const context = {
        currentProject:
            state.project,

        currentClient:
            state.client,

        expectedField:
            hint.expectedField || null,

        lastAssistantQuestion:
            getLastAssistantMessage(state),

        today:
            getTodayInfo(),

        editBlock:
            hint.editBlock || null,

        editBlockFields:
            hint.editBlock && EDIT_BLOCKS[hint.editBlock]
                ? EDIT_BLOCKS[hint.editBlock].fields
                : null,

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
                max_tokens: 1000,
                json: true
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
        parsed,
        userText
    );
}


// ============================================================
// INTENT DETECTION
// ============================================================

async function detectIntent(
    state,
    userText
) {

    // Такие реплики — продолжение разговора, а не новый ответ на поле заявки.
    if (/^(?:а\s*)?(?:можно|можно ли|разрешите)\s+(?:(?:ещё|еще)\s+)?(?:задать|спросить)\s+(?:(?:ещё|еще)\s+)?вопрос\??$/i.test(String(userText || '').trim()) ||
        /^(?:а\s*)?(?:можно|можно ли)\s+(?:(?:ещё|еще)\s+)?вопрос(?:\s+(?:задать|спросить))?\??$/i.test(String(userText || '').trim())) {
        return 'question';
    }

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
- out_of_scope
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

out_of_scope —
сообщение не относится к техническому оснащению,
подготовке, организации или сопровождению мероприятия
и не связано с заявкой клиента в MLK.

greeting —
приветствие без содержательной информации.

other —
если ничего выше не подходит.

Если сообщение относится к посторонней теме
(например, политика, личные советы, развлечения,
новости, бытовые вопросы и т. п.) —
используй out_of_scope.

Если сообщение связано с мероприятием MLK,
его техническим оснащением, оборудованием,
подготовкой заявки, площадкой, монтажом,
демонтажом, персоналом, техническими требованиями
или портфолио MLK — не используй out_of_scope.

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
                    max_tokens: 100,
                    json: true
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
        const optionalStep = getPendingOptionalStep(state);
        return optionalStep ? OPTIONAL_QUESTIONS[optionalStep] : null;
    }


    const first =
        missing[0];


    switch (first.field) {

        case 'eventDays':
            return 'Мероприятие пройдёт в один день или продлится несколько дней?';

        case 'eventTimes': {
            const startLabel = formatDateForQuestion(state.project.dateStart);
            const endLabel = formatDateForQuestion(state.project.dateEnd);
            const sameDay = startLabel && startLabel === endLabel;
            const when = sameDay
                ? ` ${startLabel}`
                : `${startLabel ? ` ${startLabel}` : ''}${endLabel ? ` и во сколько закончится ${endLabel}` : ''}`;
            if (sameDay) {
                return `Во сколько начнётся мероприятие${when} и во сколько закончится? Можно одним сообщением, например: «с 18:00 до 23:00».`;
            }
            return `Во сколько начнётся мероприятие${when}? Можно одним сообщением, например: «в первый день с 18:00, в последний до 23:00».`;
        }

        case 'eventType':
            return [
                'Подскажите, пожалуйста, какой у вас формат мероприятия?',
                '',
                '• Концерты и фестивали — open air, городские праздники, гастрольные туры, сольные выступления, шоу-программы.',
                '• Конференции, презентации и TV-проекты — бизнес-форумы, презентации продуктов, пресс-конференции, саммиты, конгрессы, семинары, кинофестивали, премии и телевизионные программы.',
                '• Корпоративы и торжества — юбилеи, тимбилдинги, свадьбы, выездные мероприятия, награждения, открытия магазинов и заведений.',
                '• Выставки — промо-акции, стенды компаний, презентационные и конференц-зоны.',
                '• Спортивные мероприятия — матчи, турниры, спартакиады, спортивные праздники и марафоны.',
                '',
                'Выберите наиболее подходящий вариант или опишите мероприятие своими словами.'
            ].join('\n');

        case 'eventLevel':
            return [
                'Какой уровень технических требований у мероприятия?',
                '',
                `• ${LEVELS.standard.label} — ${LEVELS.standard.description}.`,
                `• ${LEVELS.high.label} — ${LEVELS.high.description}.`,
                `• ${LEVELS.highest.label} — мероприятия с высшими должностными лицами, масштабные и международные.`,
                '',
                'Выберите наиболее подходящий вариант.'
            ].join('\n');

        case 'guestCount':
            return 'Подскажите, пожалуйста, ориентировочное количество гостей.';

        case 'personnel':
            return 'Какой персонал вам нужен на мероприятии?';

        case 'personnelDetails':
            return 'Уточните, пожалуйста, какой именно персонал вам требуется.';

        case 'dateStartTime':
            return `Во сколько начнётся мероприятие${formatDateForQuestion(state.project.dateStart) ? ` ${formatDateForQuestion(state.project.dateStart)}` : ''}?`;

        case 'dateEndTime':
            return `Во сколько закончится мероприятие${formatDateForQuestion(state.project.dateEnd) ? ` ${formatDateForQuestion(state.project.dateEnd)}` : ''}?`;

        case 'readyDateTime':
            return `К какому времени оборудование должно быть полностью готово${formatDateForQuestion(state.project.readyDate) ? ` (${formatDateForQuestion(state.project.readyDate)})` : ''}? От этого зависит объём работ и стоимость, поэтому укажите, пожалуйста, точное время.`;

        case 'dateConflict':
            return 'Похоже, дата окончания указана раньше даты начала. Проверьте, пожалуйста, даты начала и окончания и напишите корректный вариант.';

        case 'dateStart':
            return 'Выберите дату начала мероприятия/репетиции.';

        case 'dateEnd':
            if (isDeferred(state, 'dateEnd') && /(?:несколько вариантов|назвал несколько вариантов|либо|\bили\b)/i.test(String(state.deferredFields.dateEnd || ''))) {
                return 'Вы назвали несколько возможных дат окончания. Какую дату считать окончательной? Напишите, пожалуйста, один точный день.';
            }
            return 'Выберите дату окончания мероприятия.';

        case 'readyDate':
            if (isDeferred(state, 'readyDate') && /позже начала мероприятия|начинается .*нужно уточнить дату и время готовности/i.test(String(state.deferredFields.readyDate || ''))) {
                return `Дата готовности оборудования (${String(state.deferredFields.readyDate).match(/Указана готовность ([^,]+)/i)?.[1] || 'указанная ранее'}) позже начала мероприятия (${formatDateForQuestion(state.project.dateStart) || state.project.dateStart}). Оборудование должно быть готово до начала. Уточните, пожалуйста, правильную дату и время готовности.`;
            }
            if (first.action === 'ask_ready_choice') {
                return 'Когда оборудование должно быть полностью готово? Это влияет на стоимость: монтаж накануне и в день мероприятия считаются по-разному. Выберите вариант или сразу напишите дату и время, например: «9 декабря к 18:00».';
            }
            return 'Выберите дату, к которой оборудование должно быть полностью готово.';

        case 'location':
            return 'Подскажите, пожалуйста, адрес площадки и город.';

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

        case 'stageDetails':
            return 'Укажите, пожалуйста, тип и размеры сценических конструкций. Например: конструкция крыши, боковые уши, подиум, пультовая, фермы и другие конструкции.';

        case 'stageSurface':
            return 'Укажите, пожалуйста, поверхность установки конструкций: плитка, асфальт, грунт, трава и т. д.';

        case 'soundDetails':
            return 'Какие группы, коллективы и артисты планируются? Укажите, пожалуйста, ведущих, спикеров, солистов, живые группы, оркестры, кавер-бэнды или использование фонограмм.';

        case 'soundRider':
            if (state.lastAction === 'ask_sound_rider_yes') {
                return 'Тогда, пожалуйста, пришлите звуковой райдер или опишите его требования.';
            }

            return 'Есть ли звуковой райдер?';

        case 'backline':
            return 'Нужно ли оборудование для бэклайна: мониторы, барабаны, комбо, инструменты и т. д.? Если не требуется — так и напишите.';

        case 'lightDetails':
            return 'Какие задачи по свету необходимо решить? Например: подсветка сцены, создание атмосферы в помещении, аплайтинг и т. д.';

        case 'lightFixtures':
            if (state.lastAction === 'ask_light_fixtures_yes') {
                return 'Тогда, пожалуйста, пришлите или опишите требования к типу и количеству световых приборов.';
            }

            return 'Есть ли требования к типу и количеству световых приборов?';

        case 'ledDetails': {
            const ledInfo = String(state.project.ledDetails || '');
            const hasDimensions = hasExplicitDimensions(ledInfo);
            const hasPlacement = /централ\w* экран|боков\w* экран|кулис\w*|юбк\w* сцен|слева|справа|по бокам|над сценой|за сценой|на сцене/i.test(ledInfo);
            if (hasDimensions && !hasPlacement) {
                return `Размер LED-экрана записал: ${ledInfo}. Сколько таких экранов нужно и где они будут расположены?`;
            }
            if (ledInfo) {
                return `Уточните, пожалуйста, количество экранов и размеры каждого. Известные детали: ${ledInfo}. Если размеры пока неизвестны, так и напишите.`;
            }
            return 'Сколько светодиодных экранов потребуется, каких они размеров и где будут расположены: центральный экран, боковые экраны, кулисы или юбки сцены? Если размеры пока неизвестны, так и напишите.';
        }

        case 'ledContent':
            return 'Что планируется транслировать на светодиодные экраны?';

        case 'ledSuspension':
            return 'Есть ли на площадке возможность подвеса оборудования или необходима напольная конструкция? Если подвес не требуется — так и напишите.';

        case 'mount':
            return 'Когда возможен монтаж?';

        case 'demount':
            return 'Когда возможен демонтаж?';

        case 'mountTime':
            return 'Подскажите, пожалуйста, во сколько можно начать монтаж.';

        case 'demountTime':
            return 'До какого времени необходимо завершить демонтаж?';

        case 'additionalServices':
            return 'Есть ли дополнительные услуги или пожелания, которые стоит учесть? Например, спецэффекты, видеотрансляция или работа по райдеру.';

        case 'specialConditions':
            return 'Есть ли особые условия по доступу на площадку, пропускам, оплате или документам?';

        default:
            return 'Подскажите, пожалуйста, дополнительную информацию по проекту.';
    }
}


// ============================================================
// SAFETY: МОДЕЛЬ НЕ ДОЛЖНА ЗАДАВАТЬ СВОЙ ВОПРОС
// ============================================================
// Следующий вопрос задаёт Sales Engine. Промпт запрещает модели задавать
// вопросы. Если она всё же закончила ответ вопросом, а наш вопрос будет
// добавлен, убираем только последнее предложение-вопрос. Остальной текст
// ответа не трогаем.

function dropTrailingModelQuestion(text) {
    const source = String(text || '').trim();
    if (!source) return '';

    const lines = source.split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return '';

    const last = lines[lines.length - 1];
    const sentences = last.split(/(?<=[.!?])\s+/);
    const tail = sentences[sentences.length - 1];

    if (/\?\s*$/.test(tail)) {
        sentences.pop();
        const rest = sentences.join(' ').trim();
        if (rest) lines[lines.length - 1] = rest;
        else lines.pop();
    }

    return lines.join('\n').trim();
}

// Фраза-запрос к клиенту: вопрос или просьба что-то написать/уточнить.
function looksLikeFunnelRequest(sentence) {
    const value = String(sentence || '');
    return /\?/.test(value) ||
        /(?:^|[\s,;:—–-])(?:подскажите|уточните|укажите|расскажите|напишите|выберите|сообщите|опишите|пришлите)(?![а-яё])/i.test(value);
}

function stemTokens(text) {
    const words = String(text || '').toLowerCase().replace(/ё/g, 'е').match(/[а-я]{4,}/g) || [];
    return new Set(words.map(word => word.slice(0, 5)));
}

function overlapRatio(a, b) {
    const left = stemTokens(a);
    const right = stemTokens(b);
    if (!left.size || !right.size) return 0;
    let common = 0;
    for (const token of left) if (right.has(token)) common++;
    return common / Math.min(left.size, right.size);
}

// DeepSeek часто повторяет следующий вопрос воронки своими словами. Вопрос задаёт
// только Sales Engine, поэтому из ответа модели убираем повторы вопроса.
// Подтверждение («Записал: ...») остаётся.
function removeEchoedQuestions(text, engineQuestion, isClientQuestion) {
    const paragraphs = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const kept = [];

    for (const paragraph of paragraphs) {

        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        const index = sentences.findIndex(looksLikeFunnelRequest);

        if (index === -1) {
            kept.push(paragraph);
            continue;
        }

        const questionPart = sentences.slice(index).join(' ');

        // Клиент сам задал вопрос: убираем только то, что повторяет наш вопрос.
        if (isClientQuestion && overlapRatio(questionPart, engineQuestion) < 0.5) {
            kept.push(paragraph);
            continue;
        }

        // Абзац начинается с вопроса: это повтор вопроса воронки, убираем целиком.
        if (index === 0) continue;

        // Подтверждение стояло перед вопросом в том же абзаце: оставляем его и обычные
        // предложения после вопроса. Продолжения вопроса («Например…», «Если…») убираем.
        const rest = [...sentences.slice(0, index)];
        let skipping = true;
        for (const sentence of sentences.slice(index + 1)) {
            if (skipping && (looksLikeFunnelRequest(sentence) || /^(?:например|если|можно|можете|либо|или|допустим|к\s+примеру)(?![а-яё])/i.test(sentence.trim()))) continue;
            skipping = false;
            rest.push(sentence);
        }
        kept.push(rest.join(' '));
    }

    let result = kept.join('\n\n');
    if (isClientQuestion) result = dropTrailingModelQuestion(result);
    return result;
}

function dedupeLines(text) {
    const seen = new Set();
    const out = [];

    for (const raw of String(text || '').split('\n')) {
        const line = raw.replace(/\s+$/, '');
        const key = line.trim();

        if (!key) {
            if (out.length && out[out.length - 1] !== '') out.push('');
            continue;
        }

        // Повторяем только длинные строки: короткие пункты списков не трогаем.
        if (key.length > 20) {
            if (seen.has(key)) continue;
            seen.add(key);
        }

        out.push(line);
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
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

ПРАВИЛА ОБСЛУЖИВАНИЯ ОБОРУДОВАНИЯ MLK

Используй следующие определения, когда клиент спрашивает о вариантах персонала или обслуживания:
- Полное управление оборудованием: MLK доставляет, монтирует и настраивает оборудование; технические специалисты управляют им во время мероприятия; после мероприятия выполняются демонтаж и вывоз. На небольшом мероприятии может работать один специалист, на сложном состав команды больше. Окончательное количество персонала определяет менеджер проекта.
- Дежурный техник: MLK доставляет, монтирует и настраивает оборудование; специалист остаётся на площадке, следит за исправностью и устраняет неисправности, но НЕ управляет оборудованием во время мероприятия. Подходит, если постоянное управление не требуется или у клиента есть свои операторы.
- Только монтаж/демонтаж: MLK доставляет, монтирует и настраивает оборудование, передаёт его клиенту по акту; во время мероприятия клиент управляет им самостоятельно; после аренды MLK демонтирует и вывозит комплект.

Не смешивай эти варианты и не обещай конкретное количество специалистов: оно определяется менеджером проекта. Если клиент выбирает дежурного техника, не говори, что техник будет запускать контент, управлять светом, звуком или экраном. Если такая задача нужна, уточни её и объясни, что для управления требуется соответствующий формат обслуживания.

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
сначала ответь на него по имеющимся данным.

7. Если клиент исправляет информацию —
принимай новую информацию без спора.

8. КРИТИЧЕСКИ ВАЖНО:
ты НЕ определяешь следующий вопрос воронки.

Следующий вопрос полностью определяет
JS Sales Engine.

Текущий контролируемый вопрос передан тебе
только для понимания текущего этапа воронки.

НЕ задавай его самостоятельно.

НЕ задавай никаких других вопросов.

НЕ предлагай следующий этап.

После ответа на сообщение клиента остановись.
Следующий вопрос будет автоматически добавлен
JS Sales Engine.

9. Не перечисляй клиенту всю внутреннюю структуру
   Sales Engine.

10. Общайся естественно, коротко и по делу.
11. Не начинай каждый ответ словом «Принял». Чередуй естественные подтверждения: «Хорошо», «Отлично», «Записал», «Понял вас», «Зафиксировал». Не добавляй подтверждение, если оно не нужно.
12. Если клиент после подведения итога задаёт вопрос, ответь на него по существу и не отправляй итог повторно, если клиент сам не попросил повторить его.
13. На вопросы о компании и опыте MLK опирайся только на реальные сведения из переданного портфолио. Если клиент повторяет вопрос, не повторяй дословно предыдущий ответ: коротко уточни, какую именно информацию он хочет узнать, либо предложи передать вопрос менеджеру. Не выдумывай проекты, артистов, площадки и результаты.
14. Формулируй законченные сообщения. Не обрывай фразу на вводных конструкциях вроде «как только», «тогда», «поэтому», «если хотите»; если не хватает данных для содержательного ответа, используй короткую законченную формулировку.

11. КРИТИЧЕСКИ ВАЖНО: ты не имеешь права создавать
описания, значения, характеристики или классификации,
которых нет в переданных тебе данных.

12. Не придумывай информацию, которой нет в переданных
данных.

13. ОПИСАНИЯ УРОВНЕЙ ТЕХНИЧЕСКОГО ОСНАЩЕНИЯ:

Стандартный —
обычные требования к оборудованию и документации.

Высокие требования —
повышенные требования к оборудованию и документации,
прямые ТВ-трансляции.

Высший уровень —
мероприятия с высшими должностными лицами,
масштабные и международные мероприятия.

Эти описания являются достоверными и могут использоваться
в ответах клиенту.

При этом не придумывай дополнительные характеристики
уровней: конкретный состав оборудования, мощность,
количество приборов, модели техники и другие параметры,
если они отдельно не указаны в данных.

14. Никогда не утверждай, что информация находится
в рабочих материалах, promt.txt, portfolio.txt
или Sales Engine, если эта информация не была
явно передана тебе в текущем контексте.

15. Если не знаешь факт — так и скажи.
Не заменяй отсутствие информации правдоподобным
предположением.

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

------------------------------------------------------------
ИСТОЧНИКИ И ДОСТОВЕРНОСТЬ
------------------------------------------------------------

Используй только информацию, которая явно присутствует
в этом system prompt, SALES ENGINE CONTEXT, PORTFOLIO
или истории диалога.

Если информация отсутствует — не заполняй пробел
своими предположениями.

Наличие названия объекта, категории или варианта
не означает, что тебе известно его содержание.

Никогда не говори клиенту:
«это есть в моих рабочих материалах»,
«это указано в портфолио»,
«это есть в Sales Engine»,
если соответствующий факт действительно
не присутствует в переданном тебе контексте.

------------------------------------------------------------
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

        const response = await callDeepSeek(
            messages,
            {
                temperature: 0.4,
                max_tokens: 700,
                returnMeta: true
            }
        );

        const content = String(response?.content || '').trim();
        const danglingEnding = /(?:как только|тогда|поэтому|если хотите|поскольку|так как|для того чтобы|в случае если|и если|что касается|а также|например)\s*[,—–-]?$/i.test(content);
        if (response?.finishReason === 'length' || danglingEnding) {
            console.warn('[SALES] DeepSeek response looks truncated; replacing with a complete short acknowledgement.');
            return 'Спасибо, я зафиксировал информацию.';
        }

        return content;

    } catch (error) {

        console.error(
            '❌ Sales Engine DeepSeek response error:',
            error.message
        );


        // Воронкой продолжает управлять Sales Engine: сбой обрабатывается
        // выше (честный запасной ответ + следующий вопрос из состояния).
        throw error;
    }
}


// ============================================================
// MANAGER SUMMARY
// ============================================================

function buildManagerSummary(
    state
) {

    refreshApplicationCode(state);
    const p =
        state.project;

    const lines = [];


    lines.push(
        Object.keys(state.deferredFields || {}).length
            ? 'ЗАЯВКА MLK — ЕСТЬ ПУНКТЫ ДЛЯ УТОЧНЕНИЯ'
            : 'ЗАЯВКА MLK — ГОТОВА К ПОДГОТОВКЕ КП'
    );
    lines.push(`Номер заявки: ${state.applicationCode || 'не присвоен'}`);
    lines.push(`Внутренний ID: ${state.applicationId || 'не присвоен'}`);

    const statusLabels = {
        eventType: 'Формат', eventLevel: 'Уровень требований', guestCount: 'Количество гостей',
        dateStart: 'Дата начала', dateEnd: 'Дата окончания', readyDate: 'Готовность оборудования',
        location: 'Адрес площадки', place: 'Тип площадки', floor: 'Этаж', lift: 'Лифт',
        liftDimensions: 'Размеры лифта', equipment: 'Оборудование', personnel: 'Персонал',
        stageDetails: 'Сценические конструкции', soundDetails: 'Звуковая программа',
        lightDetails: 'Задачи по свету', ledDetails: 'LED-экраны', mount: 'Монтаж', demount: 'Демонтаж'
    };
    const statusDisplayValue = field => {
        const value = state.project[field];
        if (field === 'eventType') return state.project.eventTypeOriginal || getEventLabel(value);
        if (['dateStart', 'dateEnd', 'readyDate'].includes(field) && state.project[`${field}Approximate`]) return `ориентировочно ${displayProjectValue(value)}`;
        if (field === 'eventLevel') return getLevelLabel(value);
        if (field === 'personnel') return getPersonnelLabel(value);
        if (field === 'place') return getPlaceLabel(value);
        if (field === 'equipment') return getEquipmentLabels(value).join(', ') || 'уточнить';
        return displayProjectValue(value) || 'уточнить';
    };
    const tentativeStatuses = Object.entries(state.confirmationStatus || {}).filter(([, status]) => status === 'tentative');
    const unknownStatuses = Object.entries(state.confirmationStatus || {}).filter(([, status]) => status === 'unknown');
    const notRequiredStatuses = Object.entries(state.confirmationStatus || {}).filter(([, status]) => status === 'not_required');
    if (tentativeStatuses.length || unknownStatuses.length || notRequiredStatuses.length) {
        lines.push('СТАТУСЫ ПОДТВЕРЖДЕНИЯ:');
        for (const [field] of tentativeStatuses) lines.push(`• Предварительно: ${statusLabels[field] || field} — ${statusDisplayValue(field)}`);
        for (const [field] of unknownStatuses) lines.push(`• Неизвестно / уточнить: ${statusLabels[field] || field}`);
        for (const [field] of notRequiredStatuses) lines.push(`• Не требуется: ${statusLabels[field] || field}`);
    }

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
        `Формат: ${p.eventTypeOriginal || getEventLabel(p.eventType)}`
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
                displayProjectValue(
                    p.personnelDetails
                )
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
            p.readyDateTimeRange && p.readyDate ? `${String(p.readyDate).slice(0, 10)} ${p.readyDateTimeRange}` : (p.readyDate || 'Не указано')
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
                    : p.lift === 'passenger_lift'
                        ? 'Есть только пассажирский лифт'
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
                displayProjectValue(
                    p.equipmentDetails
                )
            }`
        );
    }


    if (p.stageDetails) {

        lines.push(
            `Сценические конструкции: ${
                displayProjectValue(
                    p.stageDetails
                )
            }`
        );
    }


    if (p.stageSurface) {

        lines.push(
            `Поверхность установки: ${
                displayProjectValue(
                    p.stageSurface
                )
            }`
        );
    }


    if (p.soundDetails) {

        lines.push(
            `Звуковая программа: ${
                displayProjectValue(
                    p.soundDetails
                )
            }`
        );
    }


    if (p.backline) {

        lines.push(
            `Бэклайн: ${
                displayProjectValue(
                    p.backline
                )
            }`
        );
    }


    if (p.soundRider) {

        lines.push(
            `Звуковой райдер: ${
                displayProjectValue(
                    p.soundRider
                )
            }`
        );
    }


    if (p.lightDetails) {

        lines.push(
            `Задачи по свету: ${
                displayProjectValue(
                    p.lightDetails
                )
            }`
        );
    }


    if (p.lightFixtures) {

        lines.push(
            `Световые приборы: ${
                displayProjectValue(
                    p.lightFixtures
                )
            }`
        );
    }


    if (p.ledDetails) {

        lines.push(
            `LED-экраны: ${
                displayProjectValue(
                    p.ledDetails
                )
            }`
        );
    }


    if (p.ledContent) {

        lines.push(
            `Контент LED: ${
                displayProjectValue(
                    p.ledContent
                )
            }`
        );
    }


    if (p.ledSuspension) {

        lines.push(
            `Подвес LED: ${
                displayProjectValue(
                    p.ledSuspension
                )
            }`
        );
    }


    if (p.additionalServices) {

        lines.push(
            `Дополнительные услуги: ${
                displayProjectValue(
                    p.additionalServices
                )
            }`
        );
    }


    if (p.specialConditions) {

        lines.push(
            `Особые условия: ${
                displayProjectValue(
                    p.specialConditions
                )
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


    if (p.budget) {
        lines.push(`Ориентир по бюджету: ${displayProjectValue(p.budget)}`);
    }

    if (state.client && state.client.contacts) {
        lines.push(`Контакты клиента: ${state.client.contacts}`);
    }

    if (p.budget || (state.client && state.client.contacts)) {
        lines.push('');
    }

    lines.push(
        state.confirmation && state.confirmation.status === 'confirmed'
            ? 'Клиент подтвердил заявку: да'
            : 'Клиент подтвердил заявку: ещё нет'
    );
    lines.push('');

    const deferredEntries = Object.entries(state.deferredFields || {});
    if (deferredEntries.length) {
        lines.push('ПУНКТЫ, КОТОРЫЕ НУЖНО УТОЧНИТЬ:');
        for (const [field, answer] of deferredEntries) {
            lines.push(`• ${DEFERRED_FIELD_LABELS[field] || field}: ответ клиента — «${answer}»`);
        }
        lines.push('');
    }

    lines.push(
        deferredEntries.length
            ? 'Статус: можно готовить предварительное КП; перечисленные пункты уточнить с клиентом.'
            : 'Статус: готово к подготовке КП'
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

    refreshApplicationCode(state);
    const p =
        state.project;


    const lines = [];


    const name =
        state.client.name
            ? `${state.client.name}, `
            : '';


    lines.push(
        `${name}давайте подведём итог по вашей заявке № ${state.applicationCode || 'MLK — номер уточняется'}:`
    );


    lines.push('');


    lines.push(
        `• Формат: ${p.eventTypeOriginal || getEventLabel(p.eventType)}`
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
            `• Персонал: ${
                displayProjectValue(
                    p.personnelDetails
                )
            }`
        );
    }


    lines.push(
        `• Дата начала: ${p.dateStart || 'уточним с вами'}${p.dateStartApproximate ? ' (ориентировочно)' : ''}`
    );


    lines.push(
        `• Дата окончания: ${p.dateEnd || 'уточним с вами'}${p.dateEndApproximate ? ' (ориентировочно)' : ''}`
    );


    lines.push(
        `• Готовность оборудования: ${p.readyDateTimeRange && p.readyDate ? `${String(p.readyDate).slice(0, 10)} ${p.readyDateTimeRange}` : (p.readyDate || 'уточним с вами')}${p.readyDateApproximate ? ' (ориентировочно)' : ''}`
    );


    lines.push(
        `• Адрес: ${p.location || 'уточним с вами'}`
    );


    lines.push(
        `• Тип места: ${getPlaceLabel(p.place)}`
    );


    if (
        p.floor !== null
    ) {

        lines.push(
            `• Этаж: ${p.floor === 'unknown' ? 'нужно уточнить' : p.floor}`
        );
    }


    if (
        p.lift
    ) {

        lines.push(
            `• Лифт: ${
                p.lift === 'has_lift'
                    ? 'Есть грузовой лифт'
                    : p.lift === 'passenger_lift'
                        ? 'Есть только пассажирский лифт'
                        : p.lift === 'stairs'
                            ? 'Оборудование будут поднимать по лестнице'
                            : p.lift === 'unknown'
                                ? 'Нужно уточнить'
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
            `• Дополнительно: ${
                displayProjectValue(
                    p.equipmentDetails
                )
            }`
        );
    }


    if (p.stageDetails) {

        lines.push(
            `• Сценические конструкции: ${
                displayProjectValue(
                    p.stageDetails
                )
            }`
        );
    }


    if (p.stageSurface) {

        lines.push(
            `• Поверхность установки: ${
                displayProjectValue(
                    p.stageSurface
                )
            }`
        );
    }


    if (p.soundDetails) {

        lines.push(
            `• Звуковая программа: ${
                displayProjectValue(
                    p.soundDetails
                )
            }`
        );
    }


    if (p.backline) {

        lines.push(
            `• Бэклайн: ${
                displayProjectValue(
                    p.backline
                )
            }`
        );
    }


    if (p.soundRider) {

        lines.push(
            `• Звуковой райдер: ${
                displayProjectValue(
                    p.soundRider
                )
            }`
        );
    }


    if (p.lightDetails) {

        lines.push(
            `• Задачи по свету: ${
                displayProjectValue(
                    p.lightDetails
                )
            }`
        );
    }


    if (p.lightFixtures) {

        lines.push(
            `• Световые приборы: ${
                displayProjectValue(
                    p.lightFixtures
                )
            }`
        );
    }


    if (p.ledDetails) {

        lines.push(
            `• LED-экраны: ${
                displayProjectValue(
                    p.ledDetails
                )
            }`
        );
    }


    if (p.ledContent) {

        lines.push(
            `• Контент LED: ${
                displayProjectValue(
                    p.ledContent
                )
            }`
        );
    }


    if (p.ledSuspension) {

        lines.push(
            `• Подвес LED: ${
                displayProjectValue(
                    p.ledSuspension
                )
            }`
        );
    }


    if (p.additionalServices) {

        lines.push(
            `• Дополнительные услуги: ${
                displayProjectValue(
                    p.additionalServices
                )
            }`
        );
    }


    if (p.specialConditions) {

        lines.push(
            `• Особые условия: ${
                displayProjectValue(
                    p.specialConditions
                )
            }`
        );
    }


    lines.push('');


    lines.push(
        `• Монтаж: ${
            MOUNT[p.mount]?.label ||
            displayProjectValue(p.mount) ||
            'уточним с вами'
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
            displayProjectValue(p.demount) ||
            'уточним с вами'
        }`
    );


    if (
        p.demountTime
    ) {

        lines.push(
            `• Время демонтажа: ${p.demountTime}`
        );
    }


    if (p.budget) {
        lines.push(`• Ориентир по бюджету: ${displayProjectValue(p.budget)}`);
    }

    if (p.additionalInfo) {
        lines.push(`• Дополнительно: ${displayProjectValue(p.additionalInfo)}`);
    }

    if (state.client && state.client.contacts) {
        lines.push(`• Контакты: ${state.client.contacts}`);
    }


    lines.push('');


    if (Object.keys(state.deferredFields || {}).length || Object.values(state.confirmationStatus || {}).includes('tentative')) {
        lines.push('Некоторые детали пока предварительные или требуют уточнения с командой MLK.');
    } else {
        lines.push('Все основные данные зафиксированы.');
    }


    lines.push(
        'Пожалуйста, проверьте заявку. Если всё верно, нажмите «Подтвердить». Если нужно что-то изменить, нажмите «Исправить» или просто напишите, что поправить.'
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
        state.confirmation &&
        state.confirmation.status === 'confirmed' &&
        !missing.length
    ) {

        return 'confirmed';
    }


    if (
        !state.history.length
    ) {

        return 'greeting';
    }


    // Даже после завершения квалификации клиент может продолжить разговор.
    // Вопрос не должен превращаться обратно в повторную отправку итога.
    if (
        intent === 'question' ||
        intent === 'equipment_question' ||
        intent === 'portfolio_question'
    ) {

        return 'clarification';
    }


    if (
        intent === 'objection'
    ) {

        return 'objection';
    }


    if (
        !missing.length
    ) {

        return 'summary';
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
            text: message.trim().replace(/,\s+/g, ', ').replace(/,(?=[^\s\d,])/g, ', ').replace(/;\s*/g, '; ').replace(/\s+([,;.!?])/g, '$1')
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
            String(message.text || '').trim().replace(/,\s+/g, ', ').replace(/,(?=[^\s\d,])/g, ', ').replace(/;\s*/g, '; ').replace(/\s+([,;.!?])/g, '$1'),

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
            '',

        clientName:
            message.clientName ||
            message.name ||
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
                `Формат: ${EVENT_TYPES.concerts.label}`,

            conferences:
                `Формат: ${EVENT_TYPES.conferences.label}`,

            corporate:
                `Формат: ${EVENT_TYPES.corporate.label}`,

            exhibitions:
                `Формат: ${EVENT_TYPES.exhibitions.label}`,

            sports:
                `Формат: ${EVENT_TYPES.sports.label}`
        },


        ask_level: {

            standard:
                `Уровень: ${LEVELS.standard.label} (${LEVELS.standard.description})`,

            high:
                `Уровень: ${LEVELS.high.label} (${LEVELS.high.description})`,

            highest:
                `Уровень: ${LEVELS.highest.label} (${LEVELS.highest.description})`
        },


        ask_personnel: {

            management:
                'Персонал: Полное управление оборудованием',

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

            passenger_lift:
                'Подъём: Есть только пассажирский лифт',

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
        },


        ask_days: {

            one_day:
                'Мероприятие: один день',

            multi_day:
                'Мероприятие: несколько дней'
        },


        ask_sound_rider: {

            yes:
                'Звуковой райдер: есть',

            no:
                'Звуковой райдер: нет'
        },


        ask_light_fixtures: {

            yes:
                'Требования к световым приборам: есть',

            no:
                'Требования к световым приборам: нет'
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
    }! 👋

Я Дмитрий, AI-консультант MLK по техническому оснащению мероприятий.

Помогу собрать информацию по вашему проекту и подготовить заявку для команды MLK.

Если у вас уже есть ТЗ, райдер, схема, презентация или другие материалы по проекту — можете отправить их сюда.

Если готовых материалов нет — можем просто обсудить проект здесь, в удобном для вас формате.

Как вам удобнее начать?`;
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
            tag: 'discuss_project'
        }

    ];
}


// ============================================================
// PROCESS START
// ============================================================

async function processStart(
    clientId,
    clientName = '',
    options = {}
) {

    const existing =
        await hydrateSalesState(
            clientId,
            clientName
        );

    ensureStateExtras(existing);

    // Случайный /start не должен стирать собранную заявку.
    if (
        !options.force &&
        hasApplicationProgress(existing)
    ) {

        const text =
            'У вас уже есть начатая заявка. Продолжить с того же места или начать заново? Если начать заново, данные заявки будут сброшены.';

        existing.pendingRestart = true;

        addHistory(
            existing,
            'assistant',
            text
        );

        await persistSalesState(
            existing
        );

        return {
            text,
            actions: [
                makeButtonsAction('restart_confirm', [
                    { text: 'Продолжить', value: 'continue' },
                    { text: 'Начать заново', value: 'restart' }
                ])
            ],
            project: existing.project,
            missing: calculateMissing(existing),
            stage: existing.stage,
            intent: 'greeting',
            readyForManager: false,
            confirmationStatus: existing.confirmation.status,
            managerSummary: null
        };
    }

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
        'start_menu';

    state.updatedAt =
        new Date().toISOString();

    await persistSalesState(
        state
    );


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

        state.project.eventType = value;
        state.project.eventTypeOriginal = null;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.eventType = 'confirmed';
        if (state.deferredFields) delete state.deferredFields.eventType;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_level' &&
        value &&
        LEVELS[value]
    ) {

        state.project.eventLevel = value;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.eventLevel = 'confirmed';
        if (state.deferredFields) delete state.deferredFields.eventLevel;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_personnel' &&
        value &&
        PERSONNEL[value]
    ) {

        state.project.personnel = value;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.personnel = 'confirmed';
        if (state.deferredFields) delete state.deferredFields.personnel;

        return actionToText(
            message
        );
    }


    if (
        tag === 'ask_place' &&
        value &&
        PLACES[value]
    ) {

        state.project.place = value;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.place = 'confirmed';
        if (state.deferredFields) delete state.deferredFields.place;

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
            value === 'passenger_lift' ||
            value === 'stairs' ||
            value === 'unknown'
        ) {

            state.project.lift = value;
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.lift = value === 'unknown' ? 'unknown' : 'confirmed';
            if (state.deferredFields) delete state.deferredFields.lift;

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

                state.project.equipment = equipment;
                state.confirmationStatus = state.confirmationStatus || {};
                state.confirmationStatus.equipment = 'confirmed';
                if (state.deferredFields) delete state.deferredFields.equipment;

                return actionToText(
                    message
                );
            }
        }


        if (
            value &&
            EQUIPMENT[value]
        ) {

            state.project.equipment = [value];
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.equipment = 'confirmed';
            if (state.deferredFields) delete state.deferredFields.equipment;

            return actionToText(
                message
            );
        }
    }


    // SOUND RIDER
    if (
        tag === 'ask_sound_rider' &&
        value
    ) {

        if (value === 'yes') {

            state.lastAction =
                'ask_sound_rider_yes';

            return 'Звуковой райдер есть.';
        }

        if (value === 'no') {

            state.project.soundRider =
                'not_required';
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.soundRider = 'not_required';

            state.lastAction =
                'ask_sound_rider_no';

            return 'Звукового райдера нет.';
        }
    }


    // LIGHT FIXTURES
    if (
        tag === 'ask_light_fixtures' &&
        value
    ) {

        if (value === 'yes') {

            state.lastAction =
                'ask_light_fixtures_yes';

            return 'Требования к световым приборам есть.';
        }

        if (value === 'no') {

            // «Нет отдельных требований» не означает, что световые приборы
            // не нужны: сохраняем отсутствие особых требований, а не отказ.
            state.project.lightFixtures =
                'Отдельных требований к типу и количеству световых приборов нет';
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.lightFixtures = 'confirmed';
            if (state.deferredFields) delete state.deferredFields.lightFixtures;

            state.lastAction =
                'ask_light_fixtures_no';

            return 'Понял вас: отдельных требований к типу и количеству световых приборов нет.';
        }
    }


    if (
        tag === 'ask_mount' &&
        value &&
        MOUNT[value]
    ) {

        state.project.mount =
            value;
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.mount = 'confirmed';

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
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.demount = 'confirmed';

        return actionToText(
            message
        );
    }


    if (tag === 'ask_days' && (value === 'one_day' || value === 'multi_day')) {

        state.project.multiDay = value === 'multi_day';
        state.confirmationStatus = state.confirmationStatus || {};
        state.confirmationStatus.eventDays = 'confirmed';

        return value === 'multi_day'
            ? 'Мероприятие продлится несколько дней.'
            : 'Мероприятие пройдёт в один день.';
    }


    if (tag === 'ask_ready_choice' && value) {

        const startDate = String(state.project.dateStart || '').slice(0, 10);

        if (value === 'event_day' && startDate) {
            state.project.readyDate = startDate;
            state.project.readyDateTimeRange = null;
            state.project.readyChoice = 'event_day';
            state.project.readyDerivedFrom = startDate;
            if (state.deferredFields) delete state.deferredFields.readyDate;
            return 'Оборудование должно быть готово в день мероприятия.';
        }

        if (value === 'day_before' && startDate) {
            state.project.readyDate = addDaysToIsoDate(startDate, -1);
            state.project.readyDateTimeRange = null;
            state.project.readyChoice = 'day_before';
            state.project.readyDerivedFrom = startDate;
            if (state.deferredFields) delete state.deferredFields.readyDate;
            return 'Оборудование должно быть готово за день до мероприятия.';
        }

        state.project.readyChoice = 'earlier';
        return 'Оборудование нужно подготовить раньше, чем за день до мероприятия.';
    }


    if (tag === 'optional_skip' && OPTIONAL_STEPS.includes(value)) {

        ensureOptional(state)[value] = 'skipped';
        return 'Пропустить.';
    }


    if (
        tag === 'ask_date_start'
    ) {

        if (value) {

            state.project.dateStart = String(value);
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.dateStart = 'confirmed';
            if (state.deferredFields) delete state.deferredFields.dateStart;

            return `Дата начала: ${value}`;
        }
    }


    if (
        tag === 'ask_date_end'
    ) {

        if (value) {

            state.project.dateEnd = String(value);
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.dateEnd = 'confirmed';
            if (state.deferredFields) delete state.deferredFields.dateEnd;

            return `Дата окончания: ${value}`;
        }
    }


    if (
        tag === 'ask_ready_date'
    ) {

        if (value) {

            state.project.readyDate = String(value);
            state.project.readyDateTimeRange = null;
            state.confirmationStatus = state.confirmationStatus || {};
            state.confirmationStatus.readyDate = 'confirmed';
            if (state.deferredFields) delete state.deferredFields.readyDate;

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
            extracted,
            message.fileText
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
// NATURAL ACKNOWLEDGEMENT VARIATION
// ============================================================

function varyAcknowledgement(text, state) {
    const source = String(text || '');
    const match = source.match(/^\s*(Принял|Хорошо|Отлично|Записал|Понял вас|Понял|Зафиксировал)([,!:—–-]?)\s*/i);
    if (!match) return source;

    const variants = ['Хорошо', 'Отлично', 'Записал', 'Понял вас', 'Зафиксировал'];
    const recent = (state?.history || []).slice(-8).filter(item => item.role === 'assistant').map(item => {
        const found = String(item.content || item.text || '').match(/^\s*(Хорошо|Отлично|Записал|Понял вас|Зафиксировал|Принял)(?=[,!:—–-]|\s|$)/i);
        return found ? found[1].toLowerCase() : '';
    }).filter(Boolean);
    const available = variants.filter(value => !recent.includes(value.toLowerCase()));
    const choices = available.length ? available : variants;
    const index = Math.max(0, Number(state?.history?.length || 0)) % choices.length;
    const rest = source.slice(match[0].length);
    const punctuation = match[2] || (!rest || /^[.!?]/.test(rest) ? '' : ',');
    return choices[index] + punctuation + rest;
}


function cleanAcknowledgementText(text) {
    let value = String(text || '').trim();
    if (!value) return '';

    // Добавляем пробел после пунктуации, но не разрываем время 19:00.
    value = value
        .replace(/([,;!?])(?=[^\s\d,;!?])/g, '$1 ')
        .replace(/([а-яёa-z])([,;:])(?=\d)/gi, '$1$2 ')
        .replace(/:(?=\S)(?!\d)/g, ': ')
        .replace(/^(\s*(?:Хорошо|Отлично)),\s*[—–-]\s*/i, '$1, ')
        .replace(/^(\s*(?:Записал|Записала|Зафиксировал|Зафиксировала|Понял вас|Понял|Поняла|Принял|Приняла)),\s*[—–-]\s*/i, '$1: ')
        .replace(/^(\s*(?:Записал|Записала|Зафиксировал|Зафиксировала|Понял вас|Понял|Поняла|Принял|Приняла)),\s+(?=[а-яё])/i, '$1: ');

    const ack = '(?:хорошо|отлично|записал(?:а)?|понял(?:а)?(?: вас)?|зафиксировал(?:а)?|принял(?:а)?)';

    // Убираем повтор подтверждения сразу после двоеточия:
    // «Зафиксировал: зафиксировал — персонал...» -> «Зафиксировал: персонал...».
    // DeepSeek иногда возвращает подтверждение и в начале, и внутри сформированной фразы.
    value = value.replace(
        new RegExp('^(\\s*' + ack + ')\\s*[:,]\\s*' + ack + '\\s*[:;,—–-]\\s*', 'i'),
        '$1: '
    );

    // «... — зафиксировал» и «... . Зафиксировал» не должны дублировать подтверждение.
    value = value.replace(new RegExp('\\s*[—–-]\\s*' + ack + '[.!?]*\\s*$', 'i'), '.');
    value = value.replace(new RegExp('([.!?])\\s*' + ack + '[.!?]*\\s*$', 'i'), '$1');

    // «Зафиксировал: спектакль. Записал.» -> одно подтверждение.
    const duplicate = value.match(new RegExp('^\\s*(' + ack + ')\\s*[:,!]\\s*(.+?)\\.\\s*' + ack + '[.!?]*\\s*$', 'i'));
    if (duplicate) value = `${duplicate[1][0].toUpperCase()}${duplicate[1].slice(1)}: ${duplicate[2].trim()}.`;

    // Только пробелы и табуляции: переводы строк (абзацы, списки) не трогаем.
    value = value.replace(/[ \t]+([,.!?;:])/g, '$1').replace(/([,;:])[ \t]{2,}/g, '$1 ');
    return value.trim();
}

// ============================================================
// PREPARE RESULT
// ============================================================

function prepareResult(
    state,
    text,
    intent
) {

    ensureStateExtras(state);
    refreshApplicationCode(state);

    const missing =
        calculateMissing(
            state
        );

    const optionalStep =
        missing.length
            ? null
            : getPendingOptionalStep(state);

    const complete =
        !missing.length && !optionalStep;


    state.missing =
        missing;


    state.intent =
        intent;


    state.stage =
        calculateStage(
            state,
            intent,
            optionalStep ? [{ field: 'optional' }] : missing
        );


    state.updatedAt =
        new Date().toISOString();


    // Заявка собрана. Клиент должен её подтвердить или исправить.
    if (
        complete &&
        state.confirmation.status !== 'confirmed' &&
        state.confirmation.status !== 'editing'
    ) {
        state.confirmation.status = 'awaiting';
    }


    let finalText =
        text;


    if (
        complete &&
        intent === 'qualification' &&
        state.stage === 'summary'
    ) {

        finalText =
            buildClientSummary(
                state
            );
    }


    let actions;

    if (optionalStep) {
        actions = getOptionalSkipActions(optionalStep);
    } else if (complete) {
        if (state.confirmation.status === 'confirmed') actions = [];
        else if (state.confirmation.status === 'editing') actions = getEditBlockActions();
        else actions = getConfirmActions();
    } else {
        actions = getActions(state);
    }


    return {

        text:
            finalText,

        actions,

        project:
            state.project,

        missing,

        stage:
            state.stage,

        intent,

        // Заявка полностью собрана (включая необязательные вопросы).
        // Отправки менеджеру нет: диалог дублируется в Битрикс24.
        readyForManager:
            complete,

        confirmationStatus:
            state.confirmation.status,

        managerSummary:
            complete
                ? buildManagerSummary(
                    state
                )
                : null
    };
}


// ============================================================
// INFER FIELD FOR LATE CORRECTIONS
// ============================================================

function inferCorrectionField(state, text) {
    const value = String(text || '').trim().toLowerCase().replace(/ё/g, 'е');
    if (!value) return null;
    if (/(?:размер\w*.{0,20}лифт|лифт.{0,35}\d+\s*(?:м|метр)?\s*(?:×|х|x|на)\s*\d+)/i.test(value)) return 'liftDimensions';
    if (/\bлифт\b|грузов\s+лифт|пассажирск\s+лифт|по лестниц/i.test(value)) return 'lift';
    if (/демонтаж|демонтир|сняти\w*/i.test(value)) return 'demount';
    if (/монтаж|монтир|установк\w*/i.test(value)) return 'mount';
    if (/led|светодиодн\w* экран|\bэкран\b|пиксел/i.test(value)) return 'ledDetails';
    if (/\b(?:гост\w*|человек\w*|участник\w*)\b/i.test(value)) return 'guestCount';
    if (/(?:дата\s+и\s+время\s+)?окончан\w*.{0,35}(?:поменял\w*|изменил\w*|перенес\w*)|(?:поменял\w*|изменил\w*|перенес\w*).{0,35}(?:дат\w*|врем\w*).{0,25}окончан\w*|дата окончания|заканчива\w*|закончится|по \d{1,2}\s+(?:январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(value)) return 'dateEnd';
    if (/начал\w* мероприяти|дата начала|старт\w* мероприяти|репетиц/i.test(value)) return 'dateStart';
    if (/готовност\w* оборудован|оборудован\w* готов\w*/i.test(value)) return 'readyDate';
    if (/адрес|место проведения|площадк\w* находится/i.test(value)) return 'location';
    if (/этаж/i.test(value)) return 'floor';
    if (/сцен\w* конструкц|ферм\w*|подиум|крыша сцены/i.test(value)) return 'stageDetails';
    if (/персонал|техник\w*|монтажник\w*/i.test(value)) return 'personnel';
    return null;
}


function normalizeKeyboardLayoutToRussian(value) {
    const en = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
    const ru = "йцукенгшщзхъфывапролджэячсмитьбюё";
    const map = new Map([...en].map((char, index) => [char, [...ru][index]]));
    return [...String(value || '').toLowerCase()].map(char => map.get(char) || char).join('');
}

function parseTimeAnswer(text) {
    const source = String(text || '').trim().toLowerCase().replace(/ё/g, 'е');
    const candidates = [source, normalizeKeyboardLayoutToRussian(source)];
    for (const candidate of candidates) {
        let match = candidate.match(/(?:^|\b)(\d{1,2})[:.]([0-5]\d)(?:\b|$)/);
        let hour;
        let minute;
        let period = '';
        if (match) {
            hour = Number(match[1]);
            minute = Number(match[2]);
        } else {
            // В ответе на вопрос о времени клиент часто добавляет пояснение:
            // «в этот же день, только где-то к 17 нужно». Берём время после
            // явного предлога, даже если после числа продолжается предложение.
            match = candidate.match(/(?:^|\s)(?:где[- ]то\s+)?(?:в|к|до|около|примерно)\s*(\d{1,2})(?::([0-5]\d))?\s*(утра|дня|вечера|ночи)?(?=\s|$|[,.;!?])/i);
            if (match) {
                hour = Number(match[1]);
                minute = Number(match[2] || 0);
                period = String(match[3] || '').toLowerCase();
            } else {
                match = candidate.match(/(?:^|\s)(?:(?:в|к|до|около|примерно)\s*)?(\d{1,2})(?:\s*(?:час(?:а|ов)?|ч))?\s*(утра|дня|вечера|ночи)?(?:\s*[.!?,]*)$/i);
            // Клиент может дать время внутри длинной фразы:
            // «около 11 вечера, может в пол двенадцатого».
            // Берём первое явно названное время и сохраняем его как приблизительное,
            // вместо того чтобы повторно задавать тот же вопрос.
                if (!match) {
                    match = candidate.match(/(?:^|\s)(?:около\s+|примерно\s+|может(?:\s+быть)?\s+|возможно\s+|наверное\s+|в\s+)?(\d{1,2})\s*(утра|дня|вечера|ночи)(?=\s|[,.;!?]|$)/i);
                }
                if (!match) continue;
                hour = Number(match[1]);
                minute = 0;
                period = String(match[2] || '').toLowerCase();
            }
        }
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
        if (period === 'утра' && hour === 12) hour = 0;
        else if (period === 'дня' && hour < 12) hour += 12;
        else if (period === 'вечера' && hour < 12) hour += 12;
        else if (period === 'ночи' && hour === 12) hour = 0;
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    return null;
}

function to24h(hourValue, minuteValue, period) {
    let hour = Number(hourValue);
    const minute = Number(minuteValue || 0);
    const p = String(period || '').toLowerCase();
    if (hour > 23 || minute > 59) return null;
    if (p === 'утра' && hour === 12) hour = 0;
    else if ((p === 'дня' || p === 'вечера') && hour < 12) hour += 12;
    else if (p === 'ночи' && hour === 12) hour = 0;
    return { hour, minute, explicitPeriod: Boolean(p) };
}

const fmtTime = t => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

// Время в свободном тексте. Число считается временем, если у него есть минуты,
// перед ним стоит предлог (с, в, к, до, по, около) или после него «утра/вечера/часов».
// Даты («5 декабря», «12.12.2026») пропускаются.
function extractTimeCandidates(source) {
    const result = [];
    const regex = /(?<![\d:.,])(\d{1,2})(?:[:.]([0-5]\d))?(?!\d)/g;
    let match;

    while ((match = regex.exec(source))) {
        const end = match.index + match[0].length;
        const before = source.slice(Math.max(0, match.index - 14), match.index);
        const after = source.slice(end, end + 14);

        if (/^\s*(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря|числа)/.test(after)) continue;
        if (/^\.\d{2}/.test(source.slice(end))) continue;

        const hasMinutes = match[2] !== undefined;
        const prepositionBefore = /(?:^|[\s(,])(?:с|со|c|в|к|до|по|около|примерно)\s*$/i.test(before);
        const periodAfter = after.match(/^\s*(утра|дня|вечера|ночи)/);
        const hourWord = /^\s*(?:час(?:а|ов)?|ч)(?![а-я])/.test(after);

        if (!(hasMinutes || prepositionBefore || periodAfter || hourWord)) continue;

        const parsed = to24h(match[1], match[2], periodAfter ? periodAfter[1] : '');
        if (!parsed) continue;

        result.push({ time: fmtTime(parsed), before });
    }

    return result;
}

// Возвращает { start, end } (строки HH:mm; любая может быть null).
function parseEventTimes(text) {
    const source = String(text || '').toLowerCase().replace(/ё/g, 'е');

    // «с 10 до 18», «10:00-18:00», «с 10 утра до 6 вечера»
    const range = source.match(/(?:^|[^\d:.])(\d{1,2})(?:[:.]([0-5]\d))?\s*(утра|дня|вечера|ночи)?\s*(?:до|по|[-–—])\s*(\d{1,2})(?:[:.]([0-5]\d))?\s*(утра|дня|вечера|ночи)?(?![\d:.]*\d{2,})/);
    if (range) {
        const a = to24h(range[1], range[2], range[3]);
        let b = to24h(range[4], range[5], range[6]);
        if (a && b) {
            // «с 10 до 6» без пометок: скорее всего вечер.
            if (!b.explicitPeriod && !range[5] && b.hour < a.hour && b.hour <= 11 && b.hour + 12 > a.hour) b = { ...b, hour: b.hour + 12 };
            return { start: fmtTime(a), end: fmtTime(b) };
        }
    }

    // «c 15:00 и закончится в 21», «начало в 18:00, конец в 23:30»
    const found = extractTimeCandidates(source);
    if (found.length >= 2) return { start: found[0].time, end: found[1].time };

    if (found.length === 1) {
        const only = found[0];
        const endish = /(?:заканч|окончан|законч|заверш|конец)/.test(source) || /(?:^|\s)до\s*$/.test(only.before);
        const startish = /(?:начал|начн|старт|открыт)/.test(source) || /(?:^|\s)(?:с|со|c)\s*$/i.test(only.before);
        return endish && !startish ? { start: null, end: only.time } : { start: only.time, end: null };
    }

    const single = parseTimeAnswer(text);
    if (single) {
        const refersToEnd = /(?:заканч\w*|окончан\w*|законч\w*|заверш\w*|до\s*\d)/i.test(source) && !/(?:начал\w*|начн\w*|старт\w*)/i.test(source);
        return refersToEnd ? { start: null, end: single } : { start: single, end: null };
    }
    return { start: null, end: null };
}

function applyEventTimes(state, text) {
    const p = state.project;
    syncEventDays(state);
    const parsed = parseEventTimes(text);
    if (!parsed.start && !parsed.end) return false;

    const startDate = String(p.dateStart || '').slice(0, 10);
    const endDate = String(p.dateEnd || '').slice(0, 10);
    if (!parseIsoDateTime(startDate) || !parseIsoDateTime(endDate)) return false;

    const approximate = /(?:около|примерно|приблизительно|ориентировочно|где-то|где то|наверное|вероятно|скорее всего|возможно|может(?:\s+быть)?|не уверен(?:а)?)/i.test(String(text || ''));
    state.confirmationStatus = state.confirmationStatus || {};
    let applied = false;

    let startTime = parsed.start;
    let endTime = parsed.end;

    // Если названо одно время, относим его к тому полю, где времени ещё нет.
    if (startTime && !endTime && hasDateAndTime(p.dateStart) && !hasDateAndTime(p.dateEnd) && !/(?:начал\w*|начн\w*|старт\w*)/i.test(String(text || ''))) {
        endTime = startTime; startTime = null;
    }

    if (startTime) {
        p.dateStart = `${startDate} ${startTime}`;
        p.dateStartApproximate = approximate;
        state.confirmationStatus.dateStart = approximate ? 'tentative' : 'confirmed';
        if (state.deferredFields) delete state.deferredFields.dateStart;
        applied = true;
    }

    if (endTime) {
        let finalEndDate = endDate;
        // Один день, но окончание после полуночи: «с 20:00 до 02:00».
        const effectiveStart = String(p.dateStart).match(/\s+(\d{1,2}:\d{2})$/)?.[1];
        if (p.multiDay === false && effectiveStart && endTime <= effectiveStart && Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5)) <= 8 * 60 && finalEndDate === startDate) {
            finalEndDate = addDaysToIsoDate(startDate, 1) || finalEndDate;
        }
        p.dateEnd = `${finalEndDate} ${endTime}`;
        p.dateEndApproximate = approximate;
        state.confirmationStatus.dateEnd = approximate ? 'tentative' : 'confirmed';
        if (state.deferredFields) delete state.deferredFields.dateEnd;
        applied = true;
    }

    return applied;
}

const TIME_FIELDS = ['eventTimes', 'dateStartTime', 'dateEndTime', 'readyDateTime'];

function applyDirectTimeAnswer(state, expectedField, text) {
    if (expectedField === 'eventTimes') return applyEventTimes(state, text);
    const fieldMap = { dateStartTime: 'dateStart', dateEndTime: 'dateEnd', readyDateTime: 'readyDate' };
    const target = fieldMap[expectedField];
    if (!target) return false;
    const time = parseTimeAnswer(text);
    if (!time) return false;
    let dateOnly = String(state.project[target] || '').slice(0, 10);
    // Готовность часто привязана к дате начала мероприятия («в этот же день»).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) && target === 'readyDate') {
        dateOnly = String(state.project.dateStart || state.project.dateEnd || '').slice(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) || !parseIsoDateTime(dateOnly)) return false;
    state.project[target] = `${dateOnly} ${time}`;
    state.project[`${target}Approximate`] = /(?:около|примерно|приблизительно|ориентировочно|где-то|где то|наверное|вероятно|скорее всего|возможно|может(?:\s+быть)?|не уверен(?:а)?)/i.test(String(text || ''));
    state.confirmationStatus = state.confirmationStatus || {};
    state.confirmationStatus[target] = state.project[`${target}Approximate`] ? 'tentative' : 'confirmed';
    if (state.deferredFields) delete state.deferredFields[target];
    return true;
}


// ============================================================
// APPLICATION SNAPSHOT / CONFIRMATION HELPERS
// ============================================================

const QUESTION_INTENTS = ['question', 'equipment_question', 'portfolio_question', 'objection'];

// Модель иногда называет вопросом обычный ответ про оборудование («есть возможность
// подвесить»). Считаем сообщение вопросом, только если оно им и выглядит.
function looksLikeClientQuestion(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (/\?/.test(value)) return true;
    return /^(?:а\s+)?(?:как|какой|какая|какие|какое|каком|сколько|можно|можете|можешь|есть\s+ли|что|почему|зачем|где|когда|умеете|работаете|делаете|подскажите|подскажи|расскажите|расскажи|объясните|поясните|скажите|скажи|а\s+если)(?![а-яё])/i.test(value);
}

const CONFIRM_RE = /^(?:да[,.\s]*)?(?:подтвержда[а-яё]*|подтверд[а-яё]*|всё\s+верно|все\s+верно|верно|правильно|согласен|согласна|ок|окей|хорошо|да)[\s.!]*$/i;

const EDIT_RE = /^(?:да[,.\s]*)?(?:исправить|исправлю|исправляем|изменить|поменять|поправить|редактировать|внести\s+правки|нужно\s+исправить|хочу\s+исправить|хочу\s+изменить)[\s.!]*$/i;

// Клиент просит начать заявку заново (без точки опоры на \w: кириллица).
const RESTART_RE = /(?:нов(?:ую|ая)\s+заявк|начать\s+(?:всё\s+|все\s+)?заново|начни(?:те)?\s+заново|начинай(?:те)?\s+заново|начать\s+с\s+(?:самого\s+начала|нуля)|давай(?:те)?\s+(?:вообще\s+)?(?:с\s+самого\s+начала|сначала|заново))/i;

// Ответ на вопрос «продолжить или начать заново?»: здесь можно трактовать шире.
const RESTART_ANSWER_RE = /(?:нов[а-яё]*|заново|сначала|с\s+самого\s+начала|с\s+нуля|сброс[а-яё]*|очисти[а-яё]*)/i;
const CONTINUE_RE = /(?:продолж[а-яё]*|оставь(?:те)?\s+(?:как\s+есть|всё)|не\s+(?:надо|нужно)\s+(?:заново|сбрасывать))/i;

// Название блока при исправлении: «дату начала и готовность», «адрес», «монтаж».
const EDIT_BLOCK_KEYWORDS = [
    ['dates', /(?:дат[а-яё]*|врем[а-яё]*|готовност[а-яё]*|начал[а-яё]*|окончани[а-яё]*|календар[а-яё]*)/i],
    ['venue', /(?:адрес[а-яё]*|площадк[а-яё]*|этаж[а-яё]*|лифт[а-яё]*|мест[а-яё]*)/i],
    ['equipment', /(?:оборудовани[а-яё]*|звук[а-яё]*|свет[а-яё]*|экран[а-яё]*|led|сцен[а-яё]*)/i],
    ['service', /(?:персонал[а-яё]*|монтаж[а-яё]*|демонтаж[а-яё]*)/i]
];

function applicationSnapshot(state) {
    const optional = state.optional || {};
    return JSON.stringify({
        project: state.project,
        deferredFields: state.deferredFields,
        confirmationStatus: state.confirmationStatus,
        optional: { budget: optional.budget, extra: optional.extra, contacts: optional.contacts },
        contacts: state.client ? state.client.contacts : ''
    });
}

function hasApplicationProgress(state) {
    const p = state && state.project;
    if (!p) return false;
    return Boolean(
        p.eventType ||
        (Array.isArray(p.equipment) && p.equipment.length) ||
        p.dateStart ||
        p.location ||
        p.personnel ||
        p.guestCount
    );
}

function applyOptionalAnswer(state, step, text) {
    const optional = ensureOptional(state);
    const value = String(text || '').trim();
    const skip = value.length <= 30 &&
        /^(?:нет|ничего|пропусти[а-яё]*|пропуск|пока\s+нет|не\s+знаю|не\s+хочу|не\s+надо|не\s+нужно|позже|потом|без\s+[а-яё]+|-)(?:[\s,.!]|$)/i.test(value);

    if (skip) {
        optional[step] = 'skipped';
        return 'skipped';
    }

    if (step === 'budget') {
        state.project.budget = value;
    } else if (step === 'extra') {
        state.project.additionalInfo = state.project.additionalInfo
            ? `${state.project.additionalInfo}; ${value}`
            : value;
    } else if (step === 'contacts') {
        state.client.contacts = value;
    }

    optional[step] = 'done';
    return 'done';
}

function confirmApplication(state) {
    ensureStateExtras(state);
    state.confirmation.status = 'confirmed';
    state.confirmation.editBlock = null;
    refreshApplicationCode(state);

    const text = `✅ Клиент подтвердил заявку № ${state.applicationCode}.\n\nСпасибо! Менеджер MLK подготовит коммерческое предложение в рабочие дни: Пн–Пт, 9:00–17:00. Если захотите что-то изменить, просто напишите.`;

    addHistory(state, 'assistant', text);
    return prepareResult(state, text, 'confirmation');
}

// Кнопки подтверждения, исправления и «продолжить» после /start.
async function handleControlAction(state, normalized, initialGreeting) {
    ensureStateExtras(state);

    const tag = normalized.tag;
    const value = normalized.value;
    state.pendingRestart = false;
    const withGreeting = result => {
        if (initialGreeting) result.text = `${initialGreeting}\n\n${result.text}`;
        return result;
    };

    if (tag === 'restart_confirm') {
        addHistory(state, 'user', 'Продолжить заявку');
        const question = buildControlledQuestion(state);
        const text = ['Хорошо, продолжаем.', question].filter(Boolean).join('\n\n');
        addHistory(state, 'assistant', text);
        return withGreeting(prepareResult(state, text, 'qualification'));
    }

    if (tag === 'confirm_application') {

        if (!isApplicationComplete(state)) {
            const question = buildControlledQuestion(state);
            const text = question || 'Давайте сначала закончим заявку.';
            addHistory(state, 'assistant', text);
            return withGreeting(prepareResult(state, text, 'qualification'));
        }

        if (value === 'yes') {
            addHistory(state, 'user', 'Подтверждаю заявку');
            return withGreeting(confirmApplication(state));
        }

        addHistory(state, 'user', 'Хочу исправить заявку');
        state.confirmation.status = 'editing';
        state.confirmation.editBlock = null;
        const text = 'Что хотите изменить? Выберите раздел или просто напишите, что нужно поправить.';
        addHistory(state, 'assistant', text);
        return withGreeting(prepareResult(state, text, 'correction'));
    }

    if (tag === 'edit_block') {

        if (value === 'back') {
            addHistory(state, 'user', 'Назад к заявке');
            state.confirmation.status = 'awaiting';
            state.confirmation.editBlock = null;
            const text = buildClientSummary(state);
            addHistory(state, 'assistant', text);
            return withGreeting(prepareResult(state, text, 'qualification'));
        }

        const block = EDIT_BLOCKS[value];
        if (block) {
            addHistory(state, 'user', `Исправить: ${block.label}`);
            state.confirmation.status = 'editing';
            state.confirmation.editBlock = value;
            addHistory(state, 'assistant', block.prompt);
            return withGreeting(prepareResult(state, block.prompt, 'correction'));
        }
    }

    return null;
}


// ============================================================
// PROCESS SALES MESSAGE
// ============================================================

async function processSalesMessageInner(
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

    let state =
        await hydrateSalesState(
            clientId,
            clientName
        );

    ensureStateExtras(state);


    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

    if (
        normalized.type === 'start'
    ) {

        return await processStart(
            clientId,
            clientName
        );
    }

    if (
        normalized.type === 'action' &&
        normalized.tag === 'restart_confirm' &&
        normalized.value === 'restart'
    ) {

        return await processStart(
            clientId,
            clientName,
            { force: true }
        );
    }

    try {

        // --------------------------------------------------------
        // FIRST REAL MESSAGE
        // --------------------------------------------------------

        let initialGreeting =
            null;


        if (
            state.history.length === 0
        ) {

            const startResult =
                await processStart(
                    clientId,
                    clientName
                );

            initialGreeting =
                startResult.text;

            state =
                await hydrateSalesState(
                    clientId,
                    clientName
                );
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

            cleanDependentFields(state);

            const pendingOptional =
                getPendingOptionalStep(
                    state
                );

            let text =
                fileText;

            if (
                pendingOptional
            ) {

                state.optional.asked =
                    pendingOptional;

                text =
                    `${fileText}\n\n${OPTIONAL_QUESTIONS[pendingOptional]}`;
            }

            addHistory(
                state,
                'assistant',
                text
            );

            const result =
                prepareResult(
                    state,
                    text,
                    'qualification'
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
        // ACTION
        // --------------------------------------------------------

        let userText = '';


        // --------------------------------------------------------
        // CONFIRM / EDIT / CONTINUE BUTTONS
        // --------------------------------------------------------

        if (
            normalized.type === 'action' &&
            ['confirm_application', 'edit_block', 'restart_confirm'].includes(normalized.tag)
        ) {

            const controlResult =
                await handleControlAction(
                    state,
                    normalized,
                    initialGreeting
                );

            if (controlResult) {
                return controlResult;
            }
        }


        // --------------------------------------------------------
        // START DISCUSSION FROM START MENU
        // --------------------------------------------------------

        if (
            normalized.type === 'action' &&
            normalized.tag === 'discuss_project'
        ) {

            addHistory(
                state,
                'user',
                'Обсудить проект'
            );

            const question =
                buildControlledQuestion(
                    state
                );


addHistory(
    state,
    'assistant',
    question
);

            return prepareResult(
                state,
                initialGreeting
                    ? `${initialGreeting}\n\n${question}`
                    : question,
                'qualification'
            );
        }


        const applicationBeforeMessage = applicationSnapshot(state);

        // --------------------------------------------------------
        // OTHER ACTIONS
        // --------------------------------------------------------

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

        // Если данные пришли через кнопку,
        // applyAction() уже записал точное значение.
        // Повторно отправлять его в AI extraction нельзя:
        // AI может ошибочно добавить другие поля.

        const isAction =
            normalized.type === 'action';


        let suppressControlledQuestion = false;
        let endDateCorrectionRequest = false;
        let dateStartCorrectionRequest = false;
        let ambiguousEndDateRequest = false;
        let liftDimensionsLaterRequest = false;
        let deterministicAssistantText = '';
        let extractionFailed = false;
        let optionalHandled = false;
        let skipPreserve = false;


        // --------------------------------------------------------
        // ТЕКСТОВЫЕ ОТВЕТЫ НА КНОПКИ (если клиент пишет вместо нажатия)
        // --------------------------------------------------------

        if (!isAction && state.pendingRestart) {

            const answerText = userText.trim();
            const wantsRestart = RESTART_RE.test(answerText) || RESTART_ANSWER_RE.test(answerText);
            const wantsContinue = CONTINUE_RE.test(answerText) && !wantsRestart;

            state.pendingRestart = false;

            if (wantsRestart && !wantsContinue) {
                return await processStart(clientId, clientName, { force: true });
            }

            if (wantsContinue) {
                const resumed = await handleControlAction(
                    state,
                    { tag: 'restart_confirm', value: 'continue' },
                    initialGreeting
                );
                if (resumed) return resumed;
            }
        }

        if (
            !isAction &&
            userText.length <= 80 &&
            hasApplicationProgress(state) &&
            RESTART_RE.test(userText) &&
            !state.pendingRestart
        ) {

            // Явная просьба начать заново: переспрашиваем, чтобы не стереть заявку случайно.
            state.pendingRestart = true;

            const confirmText =
                'Понял. Если начать заново, данные текущей заявки будут сброшены. Начать новую заявку или продолжить текущую?';

            addHistory(state, 'assistant', confirmText);

            return {
                text: confirmText,
                actions: [
                    makeButtonsAction('restart_confirm', [
                        { text: 'Начать заново', value: 'restart' },
                        { text: 'Продолжить', value: 'continue' }
                    ])
                ],
                project: state.project,
                missing: calculateMissing(state),
                stage: state.stage,
                intent: 'greeting',
                readyForManager: false,
                confirmationStatus: state.confirmation.status,
                managerSummary: null
            };
        }

        if (!isAction && isApplicationComplete(state) && state.confirmation.status === 'awaiting' && EDIT_RE.test(userText.trim())) {

            const editResult = await handleControlAction(
                state,
                { tag: 'confirm_application', value: 'edit' },
                initialGreeting
            );
            if (editResult) return editResult;
        }

        if (
            !isAction &&
            state.confirmation.status === 'editing' &&
            !state.confirmation.editBlock &&
            userText.length <= 60 &&
            !/\d/.test(userText)
        ) {

            const matched = EDIT_BLOCK_KEYWORDS.filter(([, re]) => re.test(userText));

            if (matched.length) {

                const blockResult = await handleControlAction(
                    state,
                    { tag: 'edit_block', value: matched[0][0] },
                    initialGreeting
                );
                if (blockResult) return blockResult;
            }
        }


        // --------------------------------------------------------
        // ПОДТВЕРЖДЕНИЕ ЗАЯВКИ ТЕКСТОМ («подтверждаю», «всё верно»)
        // --------------------------------------------------------

        if (
            !isAction &&
            state.confirmation.status === 'awaiting' &&
            CONFIRM_RE.test(userText.trim()) &&
            isApplicationComplete(state)
        ) {

            const confirmed = confirmApplication(state);

            if (initialGreeting) {
                confirmed.text = `${initialGreeting}\n\n${confirmed.text}`;
            }

            return confirmed;
        }


        // --------------------------------------------------------
        // INTENT: определяем ДО извлечения данных, чтобы вопрос клиента
        // не записывался как ответ на поле воронки.
        // --------------------------------------------------------

        let intent =
            'qualification';

        if (!isAction) {

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
        }

        const isQuestionIntent =
            QUESTION_INTENTS.includes(intent) &&
            looksLikeClientQuestion(userText);

        const skipExtraction =
            ['greeting', 'manager_request', 'out_of_scope'].includes(intent);


        // --------------------------------------------------------
        // НЕОБЯЗАТЕЛЬНЫЕ ВОПРОСЫ (бюджет, «что-то добавить?», контакты)
        // --------------------------------------------------------

        const pendingOptional =
            getPendingOptionalStep(state);

        if (
            !isAction &&
            pendingOptional &&
            state.optional.asked === pendingOptional &&
            ['qualification', 'other'].includes(intent)
        ) {

            const outcome =
                applyOptionalAnswer(
                    state,
                    pendingOptional,
                    userText
                );

            deterministicAssistantText =
                outcome === 'skipped'
                    ? 'Хорошо.'
                    : 'Записал.';

            optionalHandled = true;
        }

        if (
            isAction &&
            normalized.tag === 'optional_skip'
        ) {

            deterministicAssistantText = 'Хорошо.';
        }


        if (!isAction && !skipExtraction && !optionalHandled) {

            let expectedField = null;
            suppressControlledQuestion = isConversationalMetaMessage(userText);

            try {

                // Сначала определяем, какой вопрос сейчас ожидает
                // Sales Engine. Это нужно ДО extraction.
                // Для вопроса клиента ожидаемого поля нет: ответ на вопрос не должен
                // попадать в поле воронки.
                expectedField = (isQuestionIntent || ['equipment', 'other'].includes(state.confirmation.editBlock))
                    ? null
                    : (calculateMissing(state)[0]?.field || inferCorrectionField(state, userText));
                endDateCorrectionRequest = expectedField === 'dateEnd' && /(?:дата\s+и\s+время\s+)?окончан\w*.{0,35}(?:поменял\w*|изменил\w*|перенес\w*)|(?:поменял\w*|изменил\w*|перенес\w*).{0,35}(?:дат\w*|врем\w*).{0,25}окончан\w*/i.test(userText);
                const hasExplicitDateInCorrection = parseRussianDateMentions(userText).length > 0 || /\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./]\d{1,2}(?:[./](?:\d{2}|\d{4}))?\b/i.test(userText);
                dateStartCorrectionRequest = expectedField === 'dateStart' && !hasExplicitDateInCorrection && /(?:дата\s+начала|начало\s+мероприятия|дата\s+старта).{0,35}(?:друг\w*|поменял\w*|изменил\w*|перенес\w*)|(?:друг\w*|поменял\w*|изменил\w*|перенес\w*).{0,35}(?:дат\w*\s+начала|начал\w*\s+мероприятия)/i.test(userText);
                ambiguousEndDateRequest = expectedField === 'dateEnd' && parseRussianDateMentions(userText).length >= 2 && /\b(?:или|либо)\b/i.test(userText);
                liftDimensionsLaterRequest = expectedField === 'liftDimensions' && /(?:узнаю|уточню|потом\s+(?:напишу|сообщу)|позже\s+(?:напишу|сообщу)|пока\s+не\s+знаю)/i.test(userText);
                if (dateStartCorrectionRequest && !state.dateStartCorrectionOriginal && hasDateAndTime(state.project.dateStart)) {
                    state.dateStartCorrectionOriginal = String(state.project.dateStart);
                }
                if (endDateCorrectionRequest || dateStartCorrectionRequest || ambiguousEndDateRequest) suppressControlledQuestion = true;

                const extracted =
                    await extractClientData(
                        state,
                        userText,
                        {
                            expectedField,
                            editBlock: state.confirmation.editBlock
                        }
                    );


                // Защита от переноса информации между
                // монтажом и демонтажом.
                if (
                    expectedField === 'mount'
                ) {
                    extracted.demount = undefined;
                }


                if (
                    expectedField === 'demount'
                ) {
                    extracted.mount = undefined;
                }

                // Не позволяем экстрактору самовольно закрыть этапы монтажа/демонтажа
                // по постороннему ответу вроде «вы сами решите».
                // Сохраняем эти поля из дополнительной фразы только при явном указании
                // соответствующего условия или времени.
                const explicitMountCondition = /(?:монтаж|монтировать|монтировк|установк).{0,70}(?:ночью|ночн\w*|рано утром|в любое время|любое время|по согласован\w*|после \d|до \d|с \d|\b\d{1,2}[:.]\d{2}\b)|(?:ночью|рано утром|в любое время|по согласован\w*).{0,70}(?:монтаж|монтировать|установк)/i.test(userText);
                const explicitDemountCondition = /(?:демонтаж|демонтировать|сняти\w*).{0,70}(?:ночью|ночн\w*|рано утром|в любое время|любое время|по согласован\w*|после \d|до \d|с \d|\b\d{1,2}[:.]\d{2}\b)|(?:ночью|рано утром|в любое время|по согласован\w*).{0,70}(?:демонтаж|демонтировать|сняти\w*)/i.test(userText);

                // Контент и подвес LED заполняем только если клиент о них действительно говорит.
                if (expectedField !== 'ledContent' && !/(?:ролик|заставк|видео|логотип|трансляц|презентац|контент|картинк|фото|слайд|камер|реклам)/i.test(userText)) {
                    extracted.ledContent = undefined;
                }
                if (expectedField !== 'ledSuspension' && !/(?:подвес|подвеш|напол|ферм|стойк|треног|крепл)/i.test(userText)) {
                    extracted.ledSuspension = undefined;
                }

                if (expectedField !== 'mount' && !explicitMountCondition) {
                    extracted.mount = undefined;
                    extracted.mountTime = undefined;
                }
                if (expectedField !== 'demount' && !explicitDemountCondition) {
                    extracted.demount = undefined;
                    extracted.demountTime = undefined;
                }

                // Когда ожидаем размеры лифта, ответ с размерами
                // не должен случайно менять уже установленный тип лифта.
                if (expectedField === 'liftDimensions') {
                    extracted.lift = undefined;
                    if (/\d+\s*(?:м|метр(?:а|ов)?)?\s*(?:×|х|x|на)\s*\d+/i.test(userText)) {
                        extracted.liftDimensions = userText.trim();
                    }
                }

                // Не позволяем модели заполнять тип лифта по ответу на другой вопрос
                // (например, «5 или 6» на вопрос об этаже). Нужен ответ о лифте
                // либо явное упоминание лифта в сообщении клиента.
                if (expectedField !== 'lift' && !/лифт/i.test(userText)) {
                    extracted.lift = undefined;
                }

                // Уточняем ответ про лифт по прямому смыслу сообщения.
                // Пассажирский лифт не приравниваем к грузовому.
                if (expectedField === 'lift') {
                    const lower = userText.toLowerCase();
                    if (/(пассажирск|обычн.{0,20}лифт|обычн.{0,20}(не очень больш|небольш|маленьк)|не очень больш.{0,20}лиф|только.{0,20}пассажир)/i.test(lower)) {
                        extracted.lift = 'passenger_lift';
                    } else if (/(грузов.{0,20}(есть|имеется)|есть.{0,20}грузов)/i.test(lower)) {
                        extracted.lift = 'has_lift';
                    } else if (/(по лестниц|носить.{0,20}лестниц|без лифт)/i.test(lower)) {
                        extracted.lift = 'stairs';
                    } else if (/(не знаю|не уверен|не уверена)/i.test(lower)) {
                        extracted.lift = 'unknown';
                    }
                }

                // Если клиент подтвердил, что звуковой райдер есть,
                // но вместо файла описывает требования текстом, сохраняем
                // содержательный ответ напрямую. Короткие ответы вроде
                // «текстом» не считаем самим содержанием райдера.
                if (
                    expectedField === 'soundRider' &&
                    state.lastAction === 'ask_sound_rider_yes'
                ) {
                    const riderReply = userText.trim();
                    const isRiderMetaReply =
                        /^(текстом|файлом|в сообщении|позже|сейчас|пришлю|отправлю|да|есть)$/i.test(riderReply) ||
                        /(ты на связи|вы на связи|алло|ау|привет)/i.test(riderReply);

                    if (isRiderMetaReply) {
                        // Это ответ о способе отправки или проверка связи,
                        // а не сами требования райдера.
                        extracted.soundRider = undefined;
                    } else if (riderReply.length >= 5) {
                        // Содержательный ответ (например, «требования простые»)
                        // фиксируем напрямую, даже если модель не вернула поле.
                        extracted.soundRider = riderReply;
                        state.lastAction = 'ask_sound_rider_received';
                    }
                }

                // Понимаем распространённый профессиональный жаргон по смыслу,
                // даже если extraction не вернул структурированное поле.
                // «Фанера/под фанеру» в контексте артистов означает фонограммы.
                if (
                    expectedField === 'soundDetails' &&
                    /фанер|фонограмм|под\s+фанер/i.test(userText)
                ) {
                    extracted.soundDetails = /в основном|преимущественно|большинств|почти все/i.test(userText)
                        ? 'В основном используются фонограммы'
                        : 'Используются фонограммы';
                }

                // Для световых приборов «нет отдельных требований» не означает
                // «свет не нужен». Не допускаем семантического превращения в not_required.
                if (expectedField === 'lightFixtures' &&
                    /(?:отдельн\w*|особ\w*|конкретн\w*).{0,45}(?:требован\w*|указан\w*).{0,35}(?:нет|не\s+нужн\w*)|(?:нет|не\s+нужн\w*).{0,45}(?:отдельн\w*|особ\w*|конкретн\w*).{0,35}(?:требован\w*|указан\w*)/i.test(userText)) {
                    extracted.lightFixtures = 'Отдельных требований к типу и количеству световых приборов нет';
                }

                // Короткие и разговорные отрицательные ответы на вопрос о бэклайне
                // — полноценный ответ. Принимаем также частые опечатки.
                if (
                    expectedField === 'backline' &&
                    /^\s*(?:нет|не\s+(?:надо|нужн\w*|треб\w*|труб\w*|понадоб\w*)|не\s+треб\w*)\s*[.!?]*\s*$/i.test(userText)
                ) {
                    extracted.backline = 'not_required';
                }

                // Вопрос о конкретной гарнитуре относится к звуковой программе,
                // а не к бэклайну. Не закрываем им вопрос о мониторах/инструментах.
                if (expectedField === 'backline' && /(?:гарнитур|микрофон|mu\s*[- ]?\s*\d|mipro|радиосистем|ведущ\w*).{0,80}(?:подойд|нужн|можно|будет|телесн\w*|бежев\w*)|(?:подойд|нужн|можно|будет).{0,80}(?:гарнитур|микрофон|mu\s*[- ]?\s*\d|mipro)/i.test(userText)) {
                    extracted.backline = undefined;
                    extracted.soundDetails = undefined;
                }

                if (endDateCorrectionRequest || dateStartCorrectionRequest) {
                    extracted.dateStart = undefined;
                    extracted.dateEnd = undefined;
                    extracted.readyDate = undefined;
                }

                const previousLedDetails = state.project.ledDetails;

                // «Контент, причём ваш» в диалоге с Дмитрием означает контент со стороны MLK,
                // а не контент клиента. Не оставляем неоднозначное местоимение в заявке.
                if (expectedField === 'ledContent' && /контент|материал|ролик|видео/i.test(userText) &&
                    /(?:ваш|ваша|ваше|ваши|с\s+вашей\s+стороны|а\s+не\s+наш|не\s+наш)/i.test(userText)) {
                    extracted.ledContent = 'Контент предоставляет команда MLK';
                }

                if (TIME_FIELDS.includes(expectedField)) {
                    extracted.dateStart = undefined;
                    extracted.dateEnd = undefined;
                    extracted.readyDate = undefined;
                }

                const explicitReadyTime = /(?:оборудован\w*|все\s+должно\s+стоять|всё\s+должно\s+стоять|конструкц\w*).{0,100}(?:готов\w*|стоять|установлен\w*|к\s*\d{1,2})/i.test(userText) &&
                    Boolean(parseTimeAnswer(userText));
                if (explicitReadyTime) {
                    extracted.dateStart = undefined;
                    extracted.dateEnd = undefined;
                    extracted.readyDate = undefined;
                }

                const dateMentionsForAmbiguity = parseRussianDateMentions(userText);
                ambiguousEndDateRequest = expectedField === 'dateEnd' && dateMentionsForAmbiguity.length >= 2 && /\b(?:или|либо)\b/i.test(userText);
                if (ambiguousEndDateRequest) {
                    extracted.dateEnd = undefined;
                    extracted.dateStart = undefined;
                    state.project.dateEnd = null;
                    deferField(state, 'dateEnd', `Клиент назвал несколько вариантов даты окончания: ${userText}`);
                    state.confirmationStatus = state.confirmationStatus || {};
                    state.confirmationStatus.dateEnd = 'tentative';
                }

                mergeProjectData(
                    state,
                    extracted,
                    userText
                );

                if (expectedField === 'guestCount') {
                    const guestRange = userText.match(/(?:около\s*)?(\d{1,5})\s*(?:-|–|—|до|по|или)\s*(\d{1,5})\s*(?:человек\w*|гост\w*|участник\w*)?/i);
                    if (guestRange) {
                        state.project.guestCount = `${guestRange[1]}–${guestRange[2]}`;
                        state.confirmationStatus = state.confirmationStatus || {};
                        state.confirmationStatus.guestCount = /или/i.test(userText) ? 'tentative' : 'confirmed';
                    }
                }

                if (expectedField === 'eventType') {
                    const directEventType = inferEventTypeFromText(userText);
                    if (directEventType) {
                        state.project.eventType = directEventType.category;
                        state.project.eventTypeOriginal = directEventType.original;
                        state.confirmationStatus = state.confirmationStatus || {};
                        state.confirmationStatus.eventType = 'confirmed';
                        if (state.deferredFields) delete state.deferredFields.eventType;
                    }
                }

                if (expectedField === 'ledDetails' && explicitlyUnknownDimensions(userText)) {
                    deferField(state, 'ledDetails', `Размеры LED-экрана пока неизвестны; ответ клиента: ${userText}`);
                }

                // «К следующему вопросу», «я же уже сказал»: не зацикливаемся на LED.
                if (expectedField === 'ledDetails' && SKIP_QUESTION_RE.test(userText.trim()) && state.project.ledDetails) {
                    deferField(state, 'ledDetails', 'Размеры LED-экрана пока неизвестны: клиент предложил перейти к следующему вопросу, детали уточнит менеджер');
                    skipPreserve = true;
                }

                // Извлекаем даты, условия монтажа/демонтажа и поздние уточнения лифта
                // непосредственно из формулировки клиента, не полагаясь только на JSON DeepSeek.

                // Любое содержательное уточнение по LED дополняет исходное описание,
                // а не стирает его. Размеры полезны, но не обязательны, если
                // экран описан через сцену/расположение или решение оставлено MLK.
                if (expectedField === 'ledDetails' && previousLedDetails) {
                    const ledReply = userText.trim();
                    const acknowledgementOnly = /^(?:супер|отлично|хорошо|ок|окей|понятно|спасибо|да|ага|класс|замечательно)[.!\s🙏👍🙂😊]*$/i.test(ledReply) || SKIP_QUESTION_RE.test(ledReply);
                    const ledDimensions = ledReply.match(/(\d+(?:[,.]\d+)?)\s*(?:м|метр(?:а|ов)?)?\s*(?:×|х|x|на)\s*(\d+(?:[,.]\d+)?)\s*(?:м|метр(?:а|ов)?)?/i);
                    const isLedCorrection = /не\s+(?:его\s+)?располож\w*.{0,30}(?:а|,)?\s*(?:именно\s*)?(?:его\s*)?размер\w*|не\s+располож\w*.{0,30}размер\w*|нужен\s+один\s+такого\s+размер/i.test(ledReply);
                    // Короткий ответ только с новыми габаритами (например, «3 на 3»)
                    // является исправлением размера, а не дополнительным экраном/расположением.
                    const dimensionsOnlyReply = Boolean(ledDimensions) && /^(?:экран\s*)?\d+(?:[,.]\d+)?\s*(?:м\s*)?(?:×|х|x|на)\s*\d+(?:[,.]\d+)?\s*(?:м)?[.!]?$/i.test(ledReply);
                    if (acknowledgementOnly) {
                        // Реакция на предыдущий ответ не является техническим уточнением.
                    } else if ((isLedCorrection || dimensionsOnlyReply) && ledDimensions) {
                        const width = ledDimensions[1].replace(',', '.');
                        const height = ledDimensions[2].replace(',', '.');
                        state.project.ledDetails = `1 LED-экран размером ${width}×${height} м`;
                        state.confirmationStatus = state.confirmationStatus || {};
                        state.confirmationStatus.ledDetails = 'confirmed';
                        if (state.deferredFields) delete state.deferredFields.ledDetails;
                    } else if (
                        ledReply &&
                        ledReply.toLowerCase() !== String(previousLedDetails).trim().toLowerCase() &&
                        !String(previousLedDetails).toLowerCase().includes(ledReply.toLowerCase())
                    ) {
                        state.project.ledDetails = `${previousLedDetails}; уточнение: ${ledReply}`;

                        // После трёх безуспешных уточнений не мучаем клиента: передаём менеджеру.
                        state.unparsedAttempts = state.unparsedAttempts || {};
                        state.unparsedAttempts.ledDetails = (state.unparsedAttempts.ledDetails || 0) + 1;
                        if (
                            state.unparsedAttempts.ledDetails >= 2 &&
                            (!hasLedQuantity(state.project.ledDetails) || !hasExplicitDimensions(state.project.ledDetails))
                        ) {
                            deferField(state, 'ledDetails', 'Размеры LED-экрана пока неизвестны: количество и размеры нужно уточнить у клиента');
                            skipPreserve = true;
                        }
                    }
                }

                // Надёжный резервный разбор размеров LED: короткий ответ «3 на 3»
                // заменяет размеры, даже если модель перед этим вернула пустое поле.
                if (expectedField === 'ledDetails') {
                    const directLedDimensions = userText.trim().match(/^(?:экран\s*)?(\d+(?:[,.]\d+)?)\s*(?:м\s*)?(?:×|х|x|на)\s*(\d+(?:[,.]\d+)?)\s*(?:м)?[.!]?$/i);
                    if (directLedDimensions) {
                        const width = directLedDimensions[1].replace(',', '.');
                        const height = directLedDimensions[2].replace(',', '.');
                        state.project.ledDetails = `1 LED-экран размером ${width}×${height} м`;
                        state.confirmationStatus = state.confirmationStatus || {};
                        state.confirmationStatus.ledDetails = 'confirmed';
                        if (state.deferredFields) delete state.deferredFields.ledDetails;
                    }
                }

                // Если сейчас ожидался этаж, короткий ответ «3» или «3-й этаж»
                // фиксируем напрямую. Это поле нельзя оставлять на усмотрение LLM.
                if (expectedField === 'floor') {
                    // Не сводим «3 или 4, точно не помню» к одному числу.
                    const floorRange = userText.trim().match(/(?:этаж\s*)?(\d{1,2})\s*(?:или|[-–])\s*(\d{1,2})(?:\s*этаж)?/i);
                    if (floorRange) {
                        // «2 или 3» — это ответ про этаж, а не размер экрана.
                        // Сохраняем оба варианта и продолжаем квалификацию: для любого
                        // этажа выше первого нужно выяснить, есть ли грузовой лифт.
                        state.project.floor = `${floorRange[1]}–${floorRange[2]} (предварительно)`;
                        state.confirmationStatus = state.confirmationStatus || {};
                        state.confirmationStatus.floor = 'tentative';
                        extracted.floor = undefined;
                        if (state.deferredFields) delete state.deferredFields.floor;
                    }
                    // Принимаем короткие варианты: «7», «7-й», «7-й этаж», «этаж 7».
                    const floorMatch = userText.trim().match(/^(?:этаж\s*)?(\d{1,2})(?:\s*[-–]?\s*(?:й|ый|ой)?(?:\s*этаж)?)?[.!]?$/i);
                    const wordFloors = {
                        'первый': 1, 'первый этаж': 1,
                        'второй': 2, 'второй этаж': 2,
                        'третий': 3, 'третий этаж': 3,
                        'четвертый': 4, 'четвёртый': 4,
                        'четвертый этаж': 4, 'четвёртый этаж': 4,
                        'пятый': 5, 'пятый этаж': 5,
                        'шестой': 6, 'шестой этаж': 6,
                        'седьмой': 7, 'седьмой этаж': 7,
                        'восьмой': 8, 'восьмой этаж': 8,
                        'девятый': 9, 'девятый этаж': 9,
                        'десятый': 10, 'десятый этаж': 10
                    };
                    const normalizedFloorText = userText.trim().toLowerCase().replace(/ё/g, 'е');
                    if (floorRange && /не\s*(?:помню|знаю|уверен)|точно\s+не|примерно|возможно/i.test(userText)) {
                        // Диапазон уже сохранён выше.
                    } else if (floorMatch) {
                        state.project.floor = Number(floorMatch[1]);
                        if (state.deferredFields) delete state.deferredFields.floor;
                    } else if (wordFloors[normalizedFloorText] !== undefined) {
                        state.project.floor = wordFloors[normalizedFloorText];
                        if (state.deferredFields) delete state.deferredFields.floor;
                    }
                }

                // Если модель не распознала очевидные размеры,
                // сохраняем ответ клиента без потери исходной формулировки.
                if (
                    expectedField === 'liftDimensions' &&
                    /\d+\s*(?:м|метр(?:а|ов)?)?\s*(?:×|х|x|на)\s*\d+/i.test(userText)
                ) {
                    state.project.liftDimensions = userText.trim();
                    if (state.deferredFields) delete state.deferredFields.liftDimensions;
                }

                // Если клиент поручает решение MLK, это полноценный ответ,
                // а не повод задавать вопрос о подвесе повторно.
                if (
                    expectedField === 'ledSuspension' &&
                    /(?:вы\s*(?:сами\s*)?решите|решите\s*сами|значит.{0,25}вы\s*и\s*решите|на\s*ваше\s*усмотрение|вам\s*виднее|ваша\s*(?:же\s*)?сцена|ваш(?:а|е)?\s*(?:же\s*)?(?:экран|конструкция|решение)|на\s*вашей\s*стороне|определите\s*сами|оставим\s*на\s*вас)/i.test(userText)
                ) {
                    state.project.ledSuspension = 'Способ установки определить специалистам MLK';
                    if (state.deferredFields) delete state.deferredFields.ledSuspension;
                }

                // Если клиент ответил на общий вопрос о датах, не задаём тот же вопрос
                // повторно: нераспознанные части помечаем как требующие ручного уточнения.
                if (TIME_FIELDS.includes(expectedField)) {
                    // Вопрос касается только времени: не позволяем модели перезаписать другие даты.
                    extracted.dateStart = undefined;
                    extracted.dateEnd = undefined;
                    extracted.readyDate = undefined;
                }
                if (expectedField === 'dateConflict') {
                    const startDate = parseIsoDateTime(state.project.dateStart);
                    const endDate = parseIsoDateTime(state.project.dateEnd);
                    if (startDate && endDate && endDate < startDate) deferField(state, 'dateConflict', userText);
                } else if (!suppressControlledQuestion && !endDateCorrectionRequest && !isQuestionIntent && !skipPreserve) {
                    preserveUnparsedAnswer(state, expectedField, userText);
                }

            } catch (error) {

                console.warn(
                    '⚠️ Sales Engine extraction error:',
                    error.message
                );

                extractionFailed = true;

                // Даже при ошибке DeepSeek не возвращаем клиенту тот же вопрос.
                if (!suppressControlledQuestion && !isQuestionIntent && !skipPreserve) {
                    preserveUnparsedAnswer(state, expectedField, userText);
                }
            }

            // Прямой разбор дат запускаем независимо от успеха DeepSeek extraction.
            // Это сохраняет даты из текста даже при временной ошибке AI.
            applyDirectContextualAnswers(state, userText, expectedField);

            // При исправлении даты начала без нового времени сохраняем время,
            // которое было подтверждено до временного/ошибочного исправления.
            // Например: было 5 декабря 11:00, клиент временно назвал 10 декабря,
            // затем поправил только дату на 5 декабря — возвращаем 11:00, а не 10:00.
            if (state.dateStartCorrectionOriginal && expectedField === 'dateStart') {
                const correctionDateMentions = parseRussianDateMentions(userText);
                const explicitCorrectionDate = correctionDateMentions[0]?.date?.slice(0, 10);
                const explicitCorrectionTime = /(?:\b(?:в|к|около|примерно)\s*\d{1,2}(?::[0-5]\d|\s*(?:утра|дня|вечера|ночи)?\b)|\b\d{1,2}:[0-5]\d\b)/i.test(userText);
                if (explicitCorrectionDate && !explicitCorrectionTime) {
                    const originalTime = String(state.dateStartCorrectionOriginal).match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}:\d{2})$/)?.[1];
                    state.project.dateStart = `${explicitCorrectionDate}${originalTime ? ` ${originalTime}` : ''}`;
                    state.confirmationStatus = state.confirmationStatus || {};
                    state.confirmationStatus.dateStart = originalTime ? 'confirmed' : 'tentative';
                    if (state.deferredFields) delete state.deferredFields.dateStart;
                    delete state.dateStartCorrectionOriginal;
                }
            }

            if (TIME_FIELDS.includes(expectedField)) {
                const appliedTime = applyDirectTimeAnswer(state, expectedField, userText);
                if (!appliedTime && !suppressControlledQuestion) {
                    // Не откладываем дату целиком: просим только корректное время повторно.
                    state.confirmationStatus = state.confirmationStatus || {};
                    state.confirmationStatus[expectedField] = 'unknown';
                }
            }

            // Клиент выбрал блок «Исправить» и написал правку: возвращаемся к подтверждению.
            if (state.confirmation.editBlock && !isQuestionIntent) {

                if (
                    state.confirmation.editBlock === 'other' &&
                    /\+?\d[\d\s()\-]{8,}\d/.test(userText)
                ) {
                    state.client.contacts = userText.trim();
                }

                state.confirmation.editBlock = null;
                state.confirmation.status = 'awaiting';
            }
        }


        // После любого изменения состояния
        // пересчитываем зависимости.
        cleanDependentFields(
            state
        );
        refreshApplicationCode(state);


        // INTENT уже определён выше, до извлечения данных.


        // --------------------------------------------------------
        // PERMISSION TO ASK ANOTHER QUESTION
        // --------------------------------------------------------

        if (
            intent === 'question' &&
            /^(?:а\s*)?(?:можно|можно ли|разрешите)\s+(?:(?:ещё|еще)\s+)?(?:задать|спросить)\s+(?:(?:ещё|еще)\s+)?вопрос\??$|^(?:а\s*)?(?:можно|можно ли)\s+(?:(?:ещё|еще)\s+)?вопрос(?:\s+(?:задать|спросить))?\??$/i.test(userText.trim())
        ) {
            const text = 'Конечно! Задавайте, я постараюсь помочь.';
            addHistory(state, 'assistant', text);
            const result = prepareResult(state, text, intent);
            if (initialGreeting) result.text = `${initialGreeting}\n\n${result.text}`;
            return result;
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
        // OUT OF SCOPE
        // --------------------------------------------------------

        if (
            intent === 'out_of_scope'
        ) {

            const text =
                'Я занимаюсь техническим оснащением мероприятий MLK. Давайте лучше вернёмся к вашей заявке.';

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

        if (endDateCorrectionRequest) {
            assistantText = 'Конечно. На какую дату и время теперь нужно перенести окончание мероприятия? Напишите новую дату и время, пожалуйста.';
        } else if (dateStartCorrectionRequest) {
            assistantText = 'Конечно. На какую дату нужно перенести начало мероприятия? Напишите новую дату и время, пожалуйста.';
        } else if (liftDimensionsLaterRequest) {
            assistantText = 'Хорошо, размеры грузового лифта уточним позже.';
        } else if (ambiguousEndDateRequest) {
            assistantText = 'Вы назвали несколько возможных дат окончания. Какую дату считать окончательной? Пока не буду фиксировать один из вариантов без подтверждения.';
        }

        const normalizedUserQuestion = String(userText || '').trim().toLowerCase().replace(/[?!.,]+$/g, '');
        const repeatedPortfolioQuestion = intent === 'portfolio_question' && (state.history || []).slice(0, -1).some(item =>
            item.role === 'user' &&
            String(item.content || item.text || '').trim().toLowerCase().replace(/[?!.,]+$/g, '') === normalizedUserQuestion &&
            normalizedUserQuestion.length > 8
        );

        try {
            if (deterministicAssistantText) {
                assistantText = deterministicAssistantText;
            } else if (endDateCorrectionRequest || dateStartCorrectionRequest || liftDimensionsLaterRequest || ambiguousEndDateRequest) {
                // Ответ задан детерминированно: нужно уточнение/подтверждение, а не догадка модели.
            } else if (repeatedPortfolioQuestion) {
                assistantText = 'Я уже отвечал на этот вопрос и не хочу повторяться или додумывать детали. Если нужны конкретные примеры проектов, площадок или мероприятий, могу передать этот вопрос менеджеру MLK.';
            } else {
                assistantText = await generateAssistantText(state, userText);
            }

        } catch (error) {

            console.warn(
                '⚠️ Sales Engine response error:',
                error.message
            );

            // Если и извлечение данных упало, нельзя говорить, что всё записано.
            assistantText = extractionFailed
                ? 'Извините, произошёл технический сбой, и часть информации могла не сохраниться. Давайте продолжим, а если что-то пропущу, вы сможете поправить.'
                : 'Спасибо. Информация зафиксирована.';
        }


        // --------------------------------------------------------
        // CONTROLLED NEXT QUESTION
        // --------------------------------------------------------

        // JS сам определяет следующий вопрос.
        // DeepSeek больше не имеет права выбирать его.

        const controlledQuestion =
            buildControlledQuestion(
                state
            );


        // Следующий вопрос выбирает только Sales Engine по структурному
        // состоянию. Если модель всё же закончила ответ своим вопросом,
        // убираем только это последнее предложение (остальной ответ не трогаем).
        const deterministicReply =
            endDateCorrectionRequest ||
            dateStartCorrectionRequest ||
            ambiguousEndDateRequest ||
            liftDimensionsLaterRequest;

        let finalAssistantText = endDateCorrectionRequest
            ? 'Конечно. На какую дату и время теперь нужно перенести окончание мероприятия? Напишите новую дату и время, пожалуйста.'
            : dateStartCorrectionRequest
                ? 'Конечно. На какую дату нужно перенести начало мероприятия? Напишите новую дату и время, пожалуйста.'
                : liftDimensionsLaterRequest
                    ? 'Хорошо, размеры грузового лифта уточним позже.'
                    : ambiguousEndDateRequest
                        ? 'Вы назвали несколько возможных дат окончания. Какую дату считать окончательной? Пока не буду фиксировать один из вариантов без подтверждения.'
                        : cleanAcknowledgementText(varyAcknowledgement(
                            String(assistantText || '').trim(),
                            state
                        ));

        const requiredMissing = calculateMissing(state);
        const optionalStep = requiredMissing.length ? null : getPendingOptionalStep(state);
        const applicationComplete = !requiredMissing.length && !optionalStep;

        const questionToAppend = suppressControlledQuestion ? '' : (controlledQuestion || '');
        const applicationChanged = applicationSnapshot(state) !== applicationBeforeMessage;

        if (questionToAppend && !deterministicReply) {
            finalAssistantText = removeEchoedQuestions(finalAssistantText, questionToAppend, isQuestionIntent);
        }

        // Клиент изменил уже подтверждённую заявку: нужно подтвердить заново.
        if (applicationChanged && state.confirmation.status === 'confirmed') {
            state.confirmation.status = 'awaiting';
        }

        // Если заявка собрана и клиент уточнил/исправил данные (или закрыл последний
        // необязательный вопрос), показываем полный итог с кнопками «Подтвердить / Исправить».
        const showSummary = !deterministicReply &&
            applicationComplete &&
            applicationChanged &&
            !['manager_request', 'out_of_scope'].includes(intent);

        if (showSummary) {
            finalAssistantText = buildClientSummary(state);
            state.confirmation.status = 'awaiting';
        }

        // Если Sales Engine всё ещё требует ответ, удаляем заявления модели
        // о завершении заявки/передаче на КП. Это предотвращает противоречие
        // «всё собрано» + повторный обязательный вопрос.
        const completionClaim = /(?:информация по заявке собрана|всё, что нужно для подготовки предложения, собрано|заявка собрана|информация передана на подготовку коммерческого предложения|передаю (?:её )?на подготовку коммерческого предложения|кп готовится в рабочие дни)/i;
        if (questionToAppend && completionClaim.test(finalAssistantText)) {
            const claimIndex = finalAssistantText.search(completionClaim);
            finalAssistantText = finalAssistantText
                .slice(0, claimIndex)
                .trim()
                .replace(/(?:да|хорошо|понял|принял)[,!.:—–\s-]*$/i, '')
                .trim();
        }

        if (questionToAppend && !showSummary) {
            // Клиент задал вопрос: отвечаем и мягко возвращаемся к заявке.
            const bridge = isQuestionIntent && finalAssistantText ? 'Вернёмся к заявке.' : '';
            finalAssistantText = [
                finalAssistantText,
                bridge,
                questionToAppend
            ]
                .filter(Boolean)
                .join('\n\n');

            // Запоминаем, какой необязательный вопрос задан: следующий ответ клиента
            // будет считаться ответом именно на него.
            state.optional.asked = optionalStep || null;
        }

        // Удаляем повторяющиеся длинные строки, сохраняя пустые строки и абзацы.
        finalAssistantText = dedupeLines(cleanAcknowledgementText(finalAssistantText));

        if (!finalAssistantText) {
            finalAssistantText = questionToAppend || 'Спасибо. Информация зафиксирована.';
        }


        // --------------------------------------------------------
        // HISTORY
        // --------------------------------------------------------

        addHistory(
            state,
            'assistant',
            finalAssistantText
        );


        // --------------------------------------------------------
        // RESULT
        // --------------------------------------------------------

        const result =
            prepareResult(
                state,
                finalAssistantText,
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

    } finally {

        await persistSalesState(
            state
        );
    }
}


// ============================================================
// PER-CLIENT QUEUE
// ============================================================
// Клиент может прислать несколько сообщений подряд. Обрабатываем их
// строго по очереди, чтобы состояние и история не перемешивались.

const clientQueues = new Map();

function runInClientQueue(clientId, task) {

    const key = String(clientId || '');
    const previous = clientQueues.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});

    clientQueues.set(key, tail);

    tail.then(() => {
        if (clientQueues.get(key) === tail) clientQueues.delete(key);
    });

    return run;
}

function processSalesMessage(clientId, message) {
    return runInClientQueue(clientId, () => processSalesMessageInner(clientId, message));
}

function processStartQueued(clientId, clientName = '', options = {}) {
    return runInClientQueue(clientId, () => processStart(clientId, clientName, options));
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    processSalesMessage,

    processStart: processStartQueued,

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
