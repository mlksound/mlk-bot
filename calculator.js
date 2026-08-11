// ================================================================
// calculator.js — модуль расчёта стоимости услуг MLK
// ================================================================

// ---------- БАЗА ОБОРУДОВАНИЯ ----------
const EQUIPMENT_DB = {
  'Подиум 6x3м, ступени': { cat: 'Комплекты', model: 'Alustage 2x1м (9шт)', price: 150 },
  'Подиум 8x4м, ступени': { cat: 'Комплекты', model: 'Alustage 2x1м (16шт)', price: 210 },
  'Звук RCF Evox, пульт, 2 микрофона': { cat: 'Комплекты', model: 'RCF Evox 8 + Studiomaster + Mipro', price: 180 },
  'Звук JBL (sub+top), пульт, 2 микрофона': { cat: 'Комплекты', model: 'JBL MRX518S + SRX712', price: 220 },
  'Свет 18 приборов, контроллер, коммутация': { cat: 'Комплекты', model: 'G1beam(4)+Wash(4)+LedBar(8)', price: 280 },
  'Экран 3x2м p2.84, конструкция, коммутация': { cat: 'Комплекты', model: 'YESTECH 6S', price: 350 },
  'Экран 4x2.5м p5.95, конструкция, коммутация': { cat: 'Комплекты', model: 'YESTECH Magic stage 7', price: 450 },
  'Сцена 12.5x10м (крыша)': { cat: 'Сцена', model: 'Alustage GR 13.5x11м', price: 1200 },
  'Сцена 10.5x7м (арка)': { cat: 'Сцена', model: 'Alustage AR 11.5x7м', price: 750 },
  'Сцена 8.5x6м (крыша)': { cat: 'Сцена', model: 'Alustage 9.5x7м', price: 520 },
  'Сцена 6x4м (односкатная)': { cat: 'Сцена', model: 'Alustage STR 7.2x4.2м', price: 350 },
  'Крылья портальные 3-5м': { cat: 'Сцена', model: 'боковые, ферма 390x390', price: 300 },
  'Одежда сцены (полотно 8-12м)': { cat: 'Сцена', model: 'сетка антиосадки', price: 35 },
  'Одежда сцены (полотно 4-6м)': { cat: 'Сцена', model: 'сетка антиосадки', price: 17 },
  'Еврокуб 1000л (пригруз)': { cat: 'Сцена', model: 'ёмкость', price: 32 },
  'Бетонный блок 150кг': { cat: 'Сцена', model: 'блок', price: 25 },
  'Модуль подиума 2x1м': { cat: 'Подиум', model: 'Aludeck SCA03', price: 15 },
  'Модуль подиума 2x0.5м': { cat: 'Подиум', model: 'Aludeck SCA03', price: 12 },
  'Модуль подиума 1x0.5м': { cat: 'Подиум', model: 'Aludeck SCA03', price: 10 },
  'Нога телескопическая 1.2-2.2м': { cat: 'Подиум', model: 'TLE-12', price: 0.33 },
  'Нога телескопическая 1.0-1.8м': { cat: 'Подиум', model: 'TLE-10', price: 0.33 },
  'Нога телескопическая 0.8-1.4м': { cat: 'Подиум', model: 'TLE-08', price: 0.27 },
  'Ограждение подиума 2x1м': { cat: 'Подиум', model: 'комплект', price: 3 },
  'Ступень лестницы 1м': { cat: 'Подиум', model: 'ступень', price: 5 },
  'Тент 12x1.45 (юбка сцены)': { cat: 'Подиум', model: 'тент', price: 25 },
  'Модуль линейного массива TTL33': { cat: 'Звук', model: 'RCF TTL33', price: 32 },
  'Сабвуфер 2x18"': { cat: 'Звук', model: 'RCF V218-S', price: 40 },
  'Акустика 2x15"+4"': { cat: 'Звук', model: 'RCF V45', price: 27 },
  'Акустика 15"+3"': { cat: 'Звук', model: 'RCF V35/JBL VRX 915', price: 20 },
  'Акустика 12"+3"': { cat: 'Звук', model: 'JBL SRX 712M', price: 15 },
  'Акустика RCF EVOX 8': { cat: 'Звук', model: 'RCF EVOX 8', price: 47 },
  'Усилитель 2-х канальный': { cat: 'Звук', model: 'RCF/Crown', price: 14 },
  'Усилитель 4-х канальный': { cat: 'Звук', model: 'RCF QPS9600', price: 25 },
  'Цифровой процессор RCF DX': { cat: 'Звук', model: 'RCF DX', price: 15 },
  'Цифровой микшер Midas M32': { cat: 'Звук', model: 'Midas M32', price: 75 },
  'Стейджбокс Midas DL32': { cat: 'Звук', model: 'Midas DL32', price: 30 },
  'Микшерный пульт 16вх': { cat: 'Звук', model: 'Soundcraft/Studiomaster', price: 23 },
  'Радиомикрофон Shure/AKG/Mipro': { cat: 'Звук', model: 'Shure / AKG / Mipro', price: 13 },
  'Радиосистема Mipro с головным': { cat: 'Звук', model: 'ACT-747B + ACT-72T', price: 23 },
  'Система ушного мониторинга': { cat: 'Звук', model: 'Shure/Sennheiser/Mipro', price: 30 },
  'Микрофонная стойка "журавль"': { cat: 'Звук', model: 'K&M / Athletic', price: 1.8 },
  'Прямая микрофонная стойка': { cat: 'Звук', model: 'K&M / Athletic', price: 2 },
  'Стойка для акустики': { cat: 'Звук', model: 'K&M / Athletic', price: 3 },
  'Микрофон Shure SM58/Beta58': { cat: 'Бэклайн', model: 'Shure', price: 5 },
  'Микрофон Shure SM57/Beta57': { cat: 'Бэклайн', model: 'Shure', price: 5 },
  'Микрофон AKG C5': { cat: 'Бэклайн', model: 'AKG', price: 6 },
  'Микрофон Senheiser e602': { cat: 'Бэклайн', model: 'Senheiser', price: 5 },
  'Барабанная установка pro': { cat: 'Бэклайн', model: 'Pearl / Sonor', price: 98 },
  'Гитарный комбо Fender': { cat: 'Бэклайн', model: 'stage112', price: 22 },
  'Басовый комбо Hartke': { cat: 'Бэклайн', model: '810XL + HA-5500', price: 36 },
  'Клавишная стойка 2-х ярусная': { cat: 'Бэклайн', model: 'Athletic KB-S', price: 8 },
  'Стойка для нот (пюпитр)': { cat: 'Бэклайн', model: 'Athletic NP-3', price: 2 },
  'Кабель XLR-XLR 1-5м': { cat: 'Бэклайн', model: 'XLR', price: 1.5 },
  'Кабель XLR-XLR 10-15м': { cat: 'Бэклайн', model: 'XLR', price: 2 },
  'Кабель XLR-XLR 20-30м': { cat: 'Бэклайн', model: 'XLR', price: 3 },
  'Катушка XLR 50м': { cat: 'Бэклайн', model: 'XLR', price: 7 },
  'Мультикор 24/8 50-70м': { cat: 'Бэклайн', model: 'мультикор', price: 28 },
  'Кабель Jack-Jack 5-10м': { cat: 'Бэклайн', model: 'Jack', price: 1 },
  'Di-box': { cat: 'Бэклайн', model: 'DI', price: 1.8 },
  'Ноутбук': { cat: 'Бэклайн', model: 'ноутбук', price: 20 },
  'Wi-Fi роутер': { cat: 'Бэклайн', model: 'роутер', price: 8 },
  'Экран p2.84 indoor (1м²)': { cat: 'Экран', model: 'Yestech MS6S', price: 50 },
  'Экран p5.95 outdoor (1м²)': { cat: 'Экран', model: 'Yestech MS7', price: 50 },
  'Экран p6.66 outdoor (1м²)': { cat: 'Экран', model: 'Palami', price: 40 },
  'Экран p3.9 outdoor (1м²)': { cat: 'Экран', model: 'outdoor', price: 75 },
  'Медиасервер Hippotizer Boreal': { cat: 'Экран', model: 'Hippotizer', price: 270 },
  'Медиасервер Hippotizer Karst': { cat: 'Экран', model: 'Hippotizer', price: 180 },
  'Контроллер Novastar MCTRL600': { cat: 'Экран', model: 'Novastar', price: 17 },
  'Видеопроцессор LVP605': { cat: 'Экран', model: 'VD-WALL', price: 20 },
  'Видеопроцессор Novastar VX4S': { cat: 'Экран', model: 'Novastar', price: 23 },
  'Кабель CAT5e 20-30м': { cat: 'Экран', model: 'CAT5e', price: 5 },
  'Катушка CAT5e 50/70м': { cat: 'Экран', model: 'CAT5e', price: 8 },
  'Кабель HDMI-HDMI 5-10м': { cat: 'Экран', model: 'HDMI', price: 2.5 },
  'Кабель HDMI-HDMI 50м': { cat: 'Экран', model: 'HDMI', price: 12 },
  'Риггингбар': { cat: 'Экран', model: 'риггинг', price: 3.5 },
  'Телескопическое крепление': { cat: 'Экран', model: 'крепление', price: 4 },
  'Световая голова spot 300W': { cat: 'Свет', model: 'Chauvet Rogue R3', price: 35 },
  'Световая голова perf spot 600W': { cat: 'Свет', model: 'Fineart 600L PERF', price: 52 },
  'Световая голова wash 37x15W': { cat: 'Свет', model: 'Chauvet/Fineart', price: 35 },
  'Световая голова wash 19x15W': { cat: 'Свет', model: 'Taurus GMB19', price: 17 },
  'Световая голова beam 230W': { cat: 'Свет', model: 'Chauvet Rogue R2X', price: 35 },
  'Световая голова beam led': { cat: 'Свет', model: 'SGM G-1 beam', price: 15 },
  'Световой прибор par 180W': { cat: 'Свет', model: 'SGM P-2', price: 18 },
  'Световой прибор wash 400W': { cat: 'Свет', model: 'SGM P5/Q7', price: 23 },
  'Световой прибор strobe 360W': { cat: 'Свет', model: 'SGM X5', price: 17 },
  'Световой прибор blinder 4x100W': { cat: 'Свет', model: 'Chauvet Strike 4', price: 20 },
  'Световой прибор bar led': { cat: 'Свет', model: 'LL-L126 Wall Washer', price: 12 },
  'Генератор дыма Antari F-7E': { cat: 'Свет', model: 'Antari F-7E', price: 40 },
  'Хейзер Antari HZ-500E': { cat: 'Свет', model: 'Antari HZ-500E', price: 38 },
  'Генератор дыма с LED': { cat: 'Свет', model: 'Antari M-7RGBAE', price: 23 },
  'Пульт Chamsys MQ80': { cat: 'Свет', model: 'Chamsys MQ80', price: 80 },
  'Пульт Chamsys MQ60': { cat: 'Свет', model: 'Chamsys MQ60', price: 60 },
  'DMX сплиттер': { cat: 'Свет', model: 'DMX', price: 10 },
  'Art-net процессор Chauvet NETXII': { cat: 'Свет', model: 'Chauvet NETXII', price: 30 },
  'Штатив для осветительных приборов': { cat: 'Свет', model: 'штатив', price: 4 },
  'Телескопический T-подъёмник 4м': { cat: 'Свет', model: 'T-подъёмник', price: 25 },
  'Тотем 1.5-2м': { cat: 'Свет', model: 'тотем', price: 16 },
  'Кабель DMX 1-5м': { cat: 'Свет', model: 'DMX', price: 1.5 },
  'Кабель DMX 10-20м': { cat: 'Свет', model: 'DMX', price: 2 },
  'Кабель DMX 25-30м': { cat: 'Свет', model: 'DMX', price: 3 },
  'Катушка DMX 50м': { cat: 'Свет', model: 'DMX', price: 5 },
  'Клэмп': { cat: 'Свет', model: 'клэмп', price: 1.25 },
  'Тросик страховочный': { cat: 'Свет', model: 'тросик', price: 0.65 },
  'Дистрибьютор 125А 380V (P-BOX)': { cat: '380V', model: 'PBF125P18U', price: 70 },
  'Дистрибьютор 125А 380V (CUBe4)': { cat: '380V', model: 'CUBe4', price: 55 },
  'Дистрибьютор 63А 380V (SSX)': { cat: '380V', model: 'P-BOX SSX 63А', price: 35 },
  'Дистрибьютор 63А 380V (CEE)': { cat: '380V', model: '63А CEE', price: 30 },
  'Дистрибьютор 32А 380V': { cat: '380V', model: '32А', price: 12 },
  'Колодка 32А 380V': { cat: '380V', model: '32А колодка', price: 7 },
  'Кабель 125А 380В 20-30м': { cat: '380V', model: '125А кабель', price: 30 },
  'Кабель 125А 380В 50м': { cat: '380V', model: '125А кабель', price: 34 },
  'Кабель 63А 380В 20-30м': { cat: '380V', model: '63А кабель', price: 18 },
  'Кабель 63А 380В 50м': { cat: '380V', model: '63А кабель', price: 25 },
  'Кабель 32А 380В 20-30м': { cat: '380V', model: '32А кабель', price: 12 },
  'Кабель 32А 380В 50м': { cat: '380V', model: '32А кабель', price: 20 },
  'Колодка Socapex (19-pin)': { cat: '380V', model: 'Socapex', price: 10 },
  'Кабель Socapex 20м': { cat: '380V', model: 'Socapex', price: 14 },
  'Кабель-канал 4 канала': { cat: '380V', model: 'CP-4L', price: 4 },
  'Радиостанция Motorola DP1000': { cat: '380V', model: 'Motorola', price: 6 },
  'Палатка': { cat: '380V', model: 'палатка', price: 21 },
  'Пригруз 25кг': { cat: '380V', model: 'пригруз', price: 3 },
  'Гибридный кабель 40м': { cat: '380V', model: 'гибрид', price: 22 },
  'Гибридный кабель 60м': { cat: '380V', model: 'гибрид', price: 31 },
};

// ---------- КОЭФФИЦИЕНТЫ ----------
const COEFF = {
  eventFormat: { concert: 1.0, conference: 0.9, banquet: 0.9, exhibition: 0.9, sport: 1.0 },
  eventLevel: { standard: 1.0, high: 1.25, top: 1.5 },
  serviceType: { full: 1.0, delivery: 0.8, rental: 0.8, pickup: 0.8 },
  setupLocation: { indoor: 1.0, shelter: 1.25, outdoor: 1.5 },
  surface: { hard_flat: 1.0, hard_multi: 1.2, soft_flat: 1.3, soft_uneven: 1.5 },
  access: { ramp: 1.0, good: 2.0, poor: 2.5 },
  manualMove: { roll: 1.0, floor2: 1.5, floor3: 2.0, manual: 1.5 },
  distance: { minsk: 1.0, outside: 1.25 },
};

// ---------- ОСНОВНАЯ ФУНКЦИЯ РАСЧЁТА ----------
function calcPrice(params) {
  // 1. Коэффициенты
  const coeffFormat = COEFF.eventFormat[params.format] || 1;
  const coeffLevel = COEFF.eventLevel[params.level] || 1;
  const coeffService = COEFF.serviceType[params.serviceType] || 1;
  const coeffLoc = (COEFF.setupLocation[params.location] || 1) *
                   (COEFF.surface[params.surface] || 1) *
                   (COEFF.access[params.access] || 1) *
                   (COEFF.manualMove[params.manualMove] || 1);
  const coeffDist = COEFF.distance[params.distance] || 1;

  let days = 1;
  try {
    const start = new Date(params.readyDate);
    const end = new Date(params.endDate);
    if (start && end && end > start) {
      const diff = (end - start) / (1000 * 60 * 60 * 24);
      days = Math.ceil(diff) || 1;
    }
  } catch (_) {}
  let coeffDuration = 1;
  if (days > 40) coeffDuration = 1.15;
  else if (days > 15) coeffDuration = 1.08;
  else if (days > 3) coeffDuration = 1.02;

  const totalCoeff = coeffFormat * coeffLevel * coeffService * coeffLoc * coeffDist * coeffDuration;

  // 2. Оборудование
  let equipTotal = 0;
  const equipDetails = [];
  if (params.equipment && params.equipment.length > 0) {
    for (const item of params.equipment) {
      const dbItem = EQUIPMENT_DB[item.name];
      if (!dbItem) continue;
      const price = dbItem.price;
      const total = price * item.qty * item.days;
      equipTotal += total;
      equipDetails.push({
        name: item.name,
        model: dbItem.model,
        qty: item.qty,
        days: item.days,
        price: price,
        total: total
      });
    }
  }
  const equipAdjusted = equipTotal * totalCoeff;

  // 3. Персонал
  const p = params.personnel || {};
  const tech = parseInt(p.techGroup) || 0;
  const shifts = parseInt(p.shiftCount) || 1;
  const rate = parseFloat(p.shiftRate) || 0;
  const qual = parseFloat(p.qualLevel) || 1;
  const duty = parseInt(p.dutyTech) || 0;
  const op = parseInt(p.opPult) || 0;
  const sound = parseInt(p.soundEng) || 0;
  const video = parseInt(p.videoEng) || 0;
  const light = parseInt(p.lightArtist) || 0;
  const daily = parseFloat(p.dailyRate) || 0;
  const lodging = parseFloat(p.lodgingRate) || 0;

  const md = tech * shifts * rate * qual;
  const serviceRate = 200;
  const serviceStaff = duty + op + sound + video + light;
  const service = serviceStaff * shifts * serviceRate * qual;
  const totalStaff = tech + serviceStaff;
  const travel = totalStaff * shifts * daily + totalStaff * shifts * lodging;
  const personnelTotal = md + service + travel;

  // 4. Услуги
  const s = params.services || {};
  const cargoTrips = parseInt(s.cargoTrips) || 0;
  const cargoPrice = parseFloat(s.cargoPrice) || 0;
  const staffTrips = parseInt(s.staffTrips) || 0;
  const staffTripPrice = parseFloat(s.staffTripPrice) || 0;
  const other = parseFloat(s.otherServices) || 0;
  const cargoTotal = cargoTrips * cargoPrice;
  const staffTotal = staffTrips * staffTripPrice;
  const servicesTotal = cargoTotal + staffTotal + other;

  // 5. Налоги и итог
  const tax = params.taxes || {};
  const discount = parseFloat(tax.discountPercent) || 0;
  const usn = parseFloat(tax.usnRate) || 0;
  const fszn = parseFloat(tax.fsznRate) || 0;

  const subtotal = equipAdjusted + personnelTotal + servicesTotal;
  const revenue = subtotal * (1 - discount / 100);
  const taxUsn = revenue * (usn / 100);
  const taxFszn = personnelTotal * (fszn / 100);
  const totalTax = taxUsn + taxFszn;
  const grandTotal = revenue + totalTax;

  return {
    coefficients: {
      format: coeffFormat,
      level: coeffLevel,
      service: coeffService,
      location: coeffLoc * coeffDist,
      duration: coeffDuration,
      total: totalCoeff
    },
    days: days,
    equipment: {
      items: equipDetails,
      subtotal: equipTotal,
      adjusted: equipAdjusted
    },
    personnel: {
      md: md,
      service: service,
      travel: travel,
      total: personnelTotal
    },
    services: {
      cargo: cargoTotal,
      staff: staffTotal,
      other: other,
      total: servicesTotal
    },
    subtotal: subtotal,
    discountPercent: discount,
    revenue: revenue,
    taxes: {
      usn: taxUsn,
      fszn: taxFszn,
      total: totalTax
    },
    grandTotal: grandTotal
  };
}

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
function searchEquipment(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results = [];
  for (const [name, data] of Object.entries(EQUIPMENT_DB)) {
    if (name.toLowerCase().includes(q) || data.model.toLowerCase().includes(q)) {
      results.push({ name, ...data });
    }
  }
  return results.slice(0, 20);
}

function getAllEquipmentNames() {
  return Object.keys(EQUIPMENT_DB);
}

// ---------- ЭКСПОРТ ----------
module.exports = {
  EQUIPMENT_DB,
  COEFF,
  calcPrice,
  searchEquipment,
  getAllEquipmentNames,
};