import type { Env } from './env';
type Json = Record<string, any>;
export function hotelLanguage(value: unknown): string {
  const language = typeof value === 'string' ? value.toLowerCase() : 'en';
  return ['en','ru','uz','uz-cyrl','ar','tr','id','ms'].includes(language) ? language : 'en';
}
export function uzbekCyrillic(value: string): string {
  const letters: Record<string,string> = {a:'а',b:'б',d:'д',e:'е',f:'ф',g:'г',h:'ҳ',i:'и',j:'ж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'қ',r:'р',s:'с',t:'т',u:'у',v:'в',x:'х',y:'й',z:'з',sh:'ш',ch:'ч',yo:'ё',yu:'ю',ya:'я',"o'":'ў',"g'":'ғ',"'":'ъ'};
  return value.replace(/[‘’ʻʼ`]/g,"'").replace(/o'|g'|sh|ch|yo|yu|ya|[a-z']/gi, token => {
    const translated = letters[token.toLowerCase()] ?? token;
    return token[0] === token[0].toUpperCase() && /[A-Z]/.test(token[0]) ? translated.toUpperCase() : translated;
  });
}
/** Translate descriptive text only. IDs, prices, URLs, brand names, dates and
 * cancellation amounts/deadlines are deliberately outside the translation set. */
export async function translateHotelText(env: Env, source: Json, language: string): Promise<Json> {
  if (language === 'en' || !env.HOTEL_TRANSLATION_API_KEY) return source;
  const copy = JSON.parse(JSON.stringify(source));
  const slots: Array<{object: any; key: string | number; text: string}> = [];
  const add = (object: any, key: string | number) => {
    if (typeof object?.[key] === 'string' && object[key].trim()) slots.push({object,key,text:object[key]});
  };
  for (const key of ['description','importantInformation']) add(copy,key);
  (copy.amenities ?? []).forEach((_: unknown, i: number) => add(copy.amenities,i));
  for (const room of copy.rooms ?? []) {
    add(room,'name'); add(room,'description');
    (room.amenities ?? []).forEach((_: unknown,i:number)=>add(room.amenities,i));
  }
  for (const policy of copy.policies ?? []) { add(policy,'title'); add(policy,'description'); }
  for (const rate of copy.rates ?? []) {
    add(rate,'roomName'); add(rate,'mealPlan'); add(rate,'cancellationDescription');
  }
  const texts = [...new Set(slots.map(slot=>slot.text))];
  if (!texts.length) return copy;
  // Bound cost; fail atomically rather than partially translating policies.
  if (texts.length > 128 || texts.join('').length > 30000) throw new Error('HOTEL_TRANSLATION_SIZE_LIMIT');
  const response = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(env.HOTEL_TRANSLATION_API_KEY), {
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({q:texts,source:'en',target:language === 'uz-cyrl' ? 'uz' : language,format:'text'}),
    signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('HOTEL_TRANSLATION_UNAVAILABLE');
  const result = await response.json() as Json;
  const translated = result?.data?.translations;
  if (!Array.isArray(translated) || translated.length !== texts.length || translated.some(x=>typeof x.translatedText !== 'string')) throw new Error('HOTEL_TRANSLATION_INVALID');
  const map = new Map(texts.map((text,i)=>[text, language === 'uz-cyrl' ? uzbekCyrillic(translated[i].translatedText) : translated[i].translatedText]));
  for (const slot of slots) slot.object[slot.key] = map.get(slot.text);
  return copy;
}

// Stable facility names remain localized even when the provider omits translations.
export function localizeKnownAmenities(source: Json, language: string): Json {
  if (language === 'en') return source;
  const names: Record<string, [string,string]> = {
    "wifi available":["Wi-Fi доступен", "Wi-Fi mavjud"],
    "meeting/banquet facilities":["Конференц-залы и банкетные залы", "Konferensiya va banket zallari"],
    "non smoking throughout":["Курение запрещено на всей территории", "Butun hududda chekish taqiqlangan"],
    "accessible parking":["Парковка для гостей с ограниченной подвижностью", "Harakatlanishi cheklangan mehmonlar uchun avtoturargoh"],
    "shuttle service (free)":["Бесплатный трансфер", "Bepul transfer"],
    "staff adhere to local safety protocols":["Персонал соблюдает местные правила безопасности", "Xodimlar mahalliy xavfsizlik qoidalariga amal qiladi"],
    "physical distancing rules followed":["Соблюдается физическая дистанция", "Jismoniy masofa saqlanadi"],
    "hand sanitizer in guest room and key areas":["Антисептик в номерах и общественных зонах", "Xonalarda va umumiy joylarda antiseptik"],
    "cashless payment available":["Доступна безналичная оплата", "Naqdsiz to‘lov mavjud"],
    "first aid kit available":["Есть аптечка первой помощи", "Birinchi yordam qutisi mavjud"],
    "contactless check in/check out":["Бесконтактный заезд и выезд", "Kontaktsiz kirish va chiqish"],
    "shared stationery like menus, pens are removed":["Общие меню и письменные принадлежности убраны", "Umumiy menyu va yozuv anjomlari olib tashlangan"],
    "process in place to check health of guests":["Предусмотрена проверка здоровья гостей", "Mehmonlar salomatligini tekshirish tartibi mavjud"],
    "access to health care professionals":["Доступ к медицинским специалистам", "Tibbiyot mutaxassislariga murojaat qilish imkoniyati"],
    "screens / barriers between staff and guests for safety":["Защитные экраны между персоналом и гостями", "Xodimlar va mehmonlar orasida himoya to‘siqlari"],
    "face masks for guests available":["Маски для гостей", "Mehmonlar uchun niqoblar mavjud"],
    "thermometers for guests provided by property":["Отель предоставляет гостям термометры", "Mehmonlar uchun termometrlar mavjud"],
    "mobile app for room service":["Заказ обслуживания номера через приложение", "Ilova orqali xonaga xizmat buyurtma qilish"],
    "single room":["Одноместный номер", "Bir kishilik xona"],
    "double room":["Двухместный номер", "Ikki kishilik xona"],
    "twin room":["Номер с двумя отдельными кроватями", "Ikkita alohida karavotli xona"],
    "triple room":["Трёхместный номер", "Uch kishilik xona"],
    "quad room":["Четырёхместный номер", "To‘rt kishilik xona"],
    "quadruple room":["Четырёхместный номер", "To‘rt kishilik xona"],
    "room only":["Без питания", "Ovqatlanishsiz"],
    "half board":["Полупансион", "Yarim pansion"],
    "full board":["Полный пансион", "To‘liq pansion"],
    "all inclusive":["Всё включено", "Barchasi kiritilgan"],
    "no meals":["Без питания", "Ovqatlanishsiz"],
    'free wifi':['Бесплатный Wi-Fi','Bepul Wi-Fi'], 'wifi':['Wi-Fi','Wi-Fi'],
    'free wi fi':['Бесплатный Wi-Fi','Bepul Wi-Fi'], 'wireless internet':['Беспроводной интернет','Simsiz internet'],
    'bar':['Бар','Bar'], 'restaurant':['Ресторан','Restoran'], 'room service':['Обслуживание номеров','Xonaga xizmat ko‘rsatish'],
    '24 hour front desk':['Круглосуточная стойка регистрации','24 soatlik qabulxona'],
    '24 hour reception':['Круглосуточная стойка регистрации','24 soatlik qabulxona'],
    'air conditioning':['Кондиционер','Konditsioner'], 'parking':['Парковка','Avtoturargoh'],
    'free parking':['Бесплатная парковка','Bepul avtoturargoh'], 'private parking':['Частная парковка','Xususiy avtoturargoh'],
    'fitness centre':['Фитнес-центр','Fitnes markazi'], 'fitness center':['Фитнес-центр','Fitnes markazi'],
    'gym':['Тренажёрный зал','Trenajyor zali'], 'swimming pool':['Бассейн','Basseyn'],
    'indoor pool':['Крытый бассейн','Yopiq basseyn'], 'outdoor pool':['Открытый бассейн','Ochiq basseyn'],
    'spa':['Спа','Spa'], 'sauna':['Сауна','Sauna'], 'laundry':['Прачечная','Kir yuvish xizmati'],
    'dry cleaning':['Химчистка','Kimyoviy tozalash'], 'daily housekeeping':['Ежедневная уборка','Kundalik tozalash'],
    'non smoking rooms':['Номера для некурящих','Chekilmaydigan xonalar'], 'family rooms':['Семейные номера','Oilaviy xonalar'],
    'airport shuttle':['Трансфер из аэропорта','Aeroport transferi'], 'shuttle service':['Трансфер','Transfer xizmati'],
    'luggage storage':['Хранение багажа','Bagaj saqlash'], 'concierge service':['Консьерж','Konsyerj xizmati'],
    'currency exchange':['Обмен валюты','Valyuta ayirboshlash'], 'business centre':['Бизнес-центр','Biznes markazi'],
    'business center':['Бизнес-центр','Biznes markazi'], 'lift':['Лифт','Lift'], 'elevator':['Лифт','Lift'],
    'facilities for disabled guests':['Удобства для гостей с ограниченной подвижностью','Harakatlanishi cheklangan mehmonlar uchun qulayliklar'],
    'safety deposit box':['Сейф','Seyf'], 'terrace':['Терраса','Terrasa'], 'garden':['Сад','Bog‘'],
    'breakfast':['Завтрак','Nonushta'], 'breakfast included':['Завтрак включён','Nonushta kiritilgan']
  };
  const translate = (value: string) => {
    const key = value.toLowerCase().replace(/[-–_]/g,' ').replace(/\s+/g,' ').trim();
    const pair = names[key];
    if (!pair) return value;
    if (language === 'ru') return pair[0];
    if (language === 'uz' || language === 'uz-cyrl') return language === 'uz' ? pair[1] : uzbekCyrillic(pair[1]);
    return value;
  };
  return {...source, amenities:[...new Set((source.amenities ?? []).map(translate))],
    rooms:(source.rooms ?? []).map((room:Json)=>({...room,name:typeof room.name === 'string' ? translate(room.name) : room.name,amenities:[...new Set((room.amenities ?? []).map(translate))]})),
    rates:(source.rates ?? []).map((rate:Json)=>({...rate,roomName:translate(rate.roomName ?? ''),mealPlan:translate(rate.mealPlan ?? '')}))};
}
