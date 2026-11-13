import type { Env } from './env';
import type { D1Like } from './d1';

// Notification state is independent of account sign-in and SMS registration.
// Subscription rows are only created after an email OTP and booking-token check.
const base = 'https://iumrah.app';
export type BookingMailLocale = 'ru' | 'uz' | 'uz-cyrl' | 'en';
export function mailLocale(raw: unknown): BookingMailLocale {
  const l = String(raw ?? '').toLowerCase().replace('_', '-');
  if (l === 'uz-cyrl' || l === 'uz-cyrillic') return 'uz-cyrl';
  if (l === 'uz' || l === 'uz-latn' || l === 'uz-uz') return 'uz';
  return l.startsWith('ru') ? 'ru' : l.startsWith('en') ? 'en' : 'en';
}
export async function ensureBookingMailSchema(db: D1Like) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS iumrah_guest_booking_email_challenges (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, salt TEXT NOT NULL, code_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip_hash TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT, verification_token_hash TEXT UNIQUE,
    proof_expires_at TEXT, consumed_at TEXT, booking_id TEXT
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_guest_booking_email_rate
    ON iumrah_guest_booking_email_challenges(email,created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS iumrah_booking_email_subscriptions (
    booking_id TEXT PRIMARY KEY, email TEXT NOT NULL, locale TEXT NOT NULL,
    verified_at TEXT NOT NULL, last_sent_status TEXT,
    lease_token TEXT, lease_until TEXT, last_sent_at TEXT, last_error TEXT
  )`).run();
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, v => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v] ?? v));
}
function safeHttps(value: unknown): string | null {
  const raw=String(value ?? '').trim();
  if (!raw || raw.startsWith('//')) return null;
  try {
    const url = raw.startsWith('/') ? new URL(raw, base) : new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.length > 3 && url.hostname.length < 180 ? url.toString() : null;
  } catch { return null; }
}
const text = {
  ru: { head: 'Заявка на Умру получена', intro: 'Подождите, пока система повторно проверит наличие всех компонентов. Наличие мест и цены на авиабилеты и отели могут меняться несколько раз в день.', noPay: 'Сейчас вы ничего не оплачиваете. Оплата станет доступна только после повторного подтверждения наличия всех компонентов.', booking: 'Бронирование', guest:'Паломник', package:'Пакет', days:'Продолжительность', people:'Путешественники', total:'Итоговая стоимость', per:'На одного человека', priceNote:'Предварительная стоимость, подлежит проверке', hotelM:'Отель в Мекке', hotelD:'Отель в Медине', flight:'Перелёт', next:'Что дальше', nextBody:'Мы перепроверяем авиабилеты, отели и остальные услуги. Статус обновится автоматически.', telegram:'Подключите Telegram', telegramBody:'Получайте обновления поездки, статусы бронирования, уведомления о документах и билетах. Уведомления также доступны в приложении и по электронной почте.', connect:'Подключить Telegram', view:'Открыть бронирование', support:'Нужна помощь?', footer:'Транзакционное письмо о вашем бронировании iumrah.', available:'Доступность подтверждена', availableBody:'Компоненты поездки проверены. Теперь можно перейти к оплате и предоставить паспортные данные.', paid:'Оплата подтверждена', paidBody:'Оплата получена, бронирование подтверждено. Мы продолжаем подготовку поездки.', ready:'Документы готовы', readyBody:'Документы для вашей поездки подготовлены. Откройте бронирование для безопасного просмотра.', traveling:'Вы в поездке', travelingBody:'Желаем благополучной Умры! Информация о поездке доступна в вашем бронировании.', checking:'Проверяем доступность', payment:'Ожидается оплата и данные паспорта', confirmed:'Оплачено и подтверждено', docs:'Документы готовы', trip:'В поездке', status:'Статус' },
  en: { head:'Your Umrah booking request was received', intro:'Please wait while we recheck availability for every component. Flight and hotel prices and availability can change several times a day.', noPay:'You pay nothing now. Payment becomes available only after every component is reconfirmed.', booking:'Booking', guest:'Pilgrim', package:'Package', days:'Duration', people:'Travelers', total:'Total package price', per:'Per person', priceNote:'Indicative price, subject to reconfirmation', hotelM:'Makkah hotel', hotelD:'Madinah hotel', flight:'Flights', next:'What happens next', nextBody:'We are checking flights, hotels, and remaining services. Your status will update automatically.', telegram:'Connect Telegram', telegramBody:'Get trip updates, booking statuses, documents and ticket alerts. Updates are also available in the app and by email.', connect:'Connect Telegram', view:'View booking', support:'Need assistance?', footer:'A transactional message about your iumrah booking.', available:'Availability confirmed', availableBody:'Trip components have been checked. You can now proceed to payment and provide passport details.', paid:'Payment confirmed', paidBody:'Payment received and booking confirmed. We are preparing your trip.', ready:'Documents ready', readyBody:'Your travel documents are ready. Open your booking to view them securely.', traveling:'You are on your trip', travelingBody:'Wishing you a blessed Umrah! Your trip details are available in your booking.', checking:'Checking availability', payment:'Awaiting payment and passport details', confirmed:'Paid and confirmed', docs:'Documents ready', trip:'On trip', status:'Status' },
  uz: { head:'Umra uchun arizangiz qabul qilindi', intro:'Tizim barcha xizmatlarning mavjudligini qayta tekshirguncha kuting. Aviabilet va mehmonxona narxlari hamda mavjudligi kun davomida bir necha marta o‘zgarishi mumkin.', noPay:'Hozir hech qanday to‘lov qilmaysiz. To‘lov barcha xizmatlar mavjudligi qayta tasdiqlangandan keyin ochiladi.', booking:'Bron', guest:'Ziyoratchi', package:'Paket', days:'Davomiyligi', people:'Yo‘lovchilar', total:'Umumiy narx', per:'Bir kishi uchun', priceNote:'Narx dastlabki, qayta tasdiqlanadi', hotelM:'Makkadagi mehmonxona', hotelD:'Madinadagi mehmonxona', flight:'Parvoz', next:'Keyingi qadam', nextBody:'Aviabiletlar, mehmonxonalar va xizmatlar qayta tekshiriladi. Holat avtomatik yangilanadi.', telegram:'Telegramni ulang', telegramBody:'Safar yangiliklari, bron holati, hujjatlar va chiptalar haqida xabarlar oling. Xabarlar ilova va emailingizga ham keladi.', connect:'Telegramni ulash', view:'Bronni ko‘rish', support:'Yordam kerakmi?', footer:'iumrah broningiz haqidagi xizmat xabari.', available:'Mavjudlik tasdiqlandi', availableBody:'Safar xizmatlari tekshirildi. Endi to‘lov va pasport ma’lumotlarini yuborishingiz mumkin.', paid:'To‘lov tasdiqlandi', paidBody:'To‘lov qabul qilindi va bron tasdiqlandi. Safaringiz tayyorlanmoqda.', ready:'Hujjatlar tayyor', readyBody:'Safar hujjatlari tayyor. Ularni xavfsiz ko‘rish uchun bronni oching.', traveling:'Siz safardasiz', travelingBody:'Umrangiz muborak bo‘lsin! Safar ma’lumotlari broningizda mavjud.', checking:'Mavjudlik tekshirilmoqda', payment:'To‘lov va pasport kutilmoqda', confirmed:'To‘langan va tasdiqlangan', docs:'Hujjatlar tayyor', trip:'Safarda', status:'Holat' },
  'uz-cyrl': { head:'Умра учун аризангиз қабул қилинди', intro:'Тизим барча хизматларнинг мавжудлигини қайта текширгунча кутинг. Авиабилет ва меҳмонхона нархлари ҳамда мавжудлиги кун давомида бир неча марта ўзгариши мумкин.', noPay:'Ҳозир ҳеч қандай тўлов қилмайсиз. Тўлов барча хизматлар мавжудлиги қайта тасдиқлангандан кейин очилади.', booking:'Брон', guest:'Зиёратчи', package:'Пакет', days:'Давомийлиги', people:'Йўловчилар', total:'Умумий нарх', per:'Бир киши учун', priceNote:'Нарх дастлабки, қайта тасдиқланади', hotelM:'Маккадаги меҳмонхона', hotelD:'Мадинадаги меҳмонхона', flight:'Парвоз', next:'Кейинги қадам', nextBody:'Авиабилетлар, меҳмонхоналар ва хизматлар қайта текширилади. Ҳолат автоматик янгиланади.', telegram:'Telegramни уланг', telegramBody:'Сафар янгиликлари, брон ҳолати, ҳужжатлар ва чипталар ҳақида хабарлар олинг. Хабарлар илова ва электрон почтангизга ҳам келади.', connect:'Telegramни улаш', view:'Бронни кўриш', support:'Ёрдам керакми?', footer:'iumrah брон ҳақидаги хизмат хабари.', available:'Мавжудлик тасдиқланди', availableBody:'Сафар хизматлари текширилди. Энди тўлов ва паспорт маълумотларини юборишингиз мумкин.', paid:'Тўлов тасдиқланди', paidBody:'Тўлов қабул қилинди ва брон тасдиқланди. Сафарингиз тайёрланмоқда.', ready:'Ҳужжатлар тайёр', readyBody:'Сафар ҳужжатлари тайёр. Уларни хавфсиз кўриш учун бронни очинг.', traveling:'Сиз сафардасиз', travelingBody:'Умрангиз муборак бўлсин! Сафар маълумотлари бронда мавжуд.', checking:'Мавжудлик текширилмоқда', payment:'Тўлов ва паспорт кутилмоқда', confirmed:'Тўланган ва тасдиқланган', docs:'Ҳужжатлар тайёр', trip:'Сафарда', status:'Ҳолат' },
} as const;
export type MailStage = 'checking'|'available'|'paid'|'ready'|'traveling';
export function resolveMailStage(raw: unknown): MailStage | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[-\s]/g,'_');
  if (['new','availability_check','pending','requested','request_received','new_request','awaiting_availability','availability_check','checking','checking_availability','pending_verification','pending_availability'].includes(s)) return 'checking';
  if (['available','availability_confirmed','waiting_payment','awaiting_payment','confirmed_available','awaiting_payment_and_passport','pending_payment','payment_pending'].includes(s)) return 'available';
  if (['confirmed','paid','paid_confirmed','payment_confirmed','booking_confirmed','payment_completed'].includes(s)) return 'paid';
  if (['documents_ready','ready','ready_to_travel','travel_ready'].includes(s)) return 'ready';
  if (['in_trip','in_progress','traveling','travelling','on_trip'].includes(s)) return 'traveling';
  return null; // Never send incorrect payment messages for unknown status values.
}
function obj(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function str(value: unknown, max = 160): string { return String(value ?? '').trim().slice(0,max); }
function money(value: unknown): string | null { const x=Number(value); return Number.isFinite(x) && x>0 ? `$${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(x)}` : null; }
// Email copy is deliberately independent from the iOS UI. Localized labels must be
// explicit: a request received is NOT a confirmed flight/hotel reservation.
const detailLabels: Record<BookingMailLocale, {
  dates: string; duration: string; day: string; days: string; night: string; nights: string;
  flights: string; outbound: string; inbound: string; flightNumber: string; route: string;
  stopsDirect: string; stop: string; stops: string; timeZoneNote: string;
  support: string; email: string; phoneUZ: string; phoneSA: string; telegram: string;
  whatsapp: string; supportDetail: string; initialPrice: string; bookingStage: string;
}> = {
  ru: { dates:'Даты поездки', duration:'Продолжительность', day:'день', days:'дней', night:'ночь', nights:'ночей', flights:'Авиабилеты', outbound:'Рейс туда', inbound:'Обратный рейс', flightNumber:'Рейс', route:'Маршрут', stopsDirect:'Прямой рейс', stop:'пересадка', stops:'пересадки', timeZoneNote:'Время местное для аэропортов', support:'Связаться с iumrah', email:'Написать на почту', phoneUZ:'Телефон · Узбекистан', phoneSA:'Телефон · Саудовская Аравия', telegram:'Telegram', whatsapp:'WhatsApp', supportDetail:'Мы поможем с бронированием и подготовкой поездки.', initialPrice:'Цена предварительная — окончательная сумма будет подтверждена после проверки.', bookingStage:'Номер заявки' },
  en: { dates:'Travel dates', duration:'Trip duration', day:'day', days:'days', night:'night', nights:'nights', flights:'Flights', outbound:'Outbound flight', inbound:'Return flight', flightNumber:'Flight', route:'Route', stopsDirect:'Nonstop', stop:'stop', stops:'stops', timeZoneNote:'Times are local to each airport', support:'Contact iumrah', email:'Email us', phoneUZ:'Phone · Uzbekistan', phoneSA:'Phone · Saudi Arabia', telegram:'Telegram', whatsapp:'WhatsApp', supportDetail:'We can help with your booking and travel preparations.', initialPrice:'Indicative price — the final amount is confirmed after rechecking availability.', bookingStage:'Request number' },
  uz: { dates:'Safar sanalari', duration:'Safar davomiyligi', day:'kun', days:'kun', night:'tun', nights:'tun', flights:'Parvozlar', outbound:'Borish reysi', inbound:'Qaytish reysi', flightNumber:'Reys', route:'Yo‘nalish', stopsDirect:'To‘g‘ridan-to‘g‘ri', stop:'almashish', stops:'almashish', timeZoneNote:'Vaqt aeroportlarning mahalliy vaqtida', support:'iumrah bilan bog‘lanish', email:'Emailga yozish', phoneUZ:'Telefon · O‘zbekiston', phoneSA:'Telefon · Saudiya Arabistoni', telegram:'Telegram', whatsapp:'WhatsApp', supportDetail:'Bron va safarga tayyorgarlik bo‘yicha yordam beramiz.', initialPrice:'Narx dastlabki — yakuniy summa qayta tekshiruvdan so‘ng tasdiqlanadi.', bookingStage:'Ariza raqami' },
  'uz-cyrl': { dates:'Сафар саналари', duration:'Сафар давомийлиги', day:'кун', days:'кун', night:'тун', nights:'тун', flights:'Парвозлар', outbound:'Бориш рейси', inbound:'Қайтиш рейси', flightNumber:'Рейс', route:'Йўналиш', stopsDirect:'Тўғридан-тўғри', stop:'алмашиш', stops:'алмашиш', timeZoneNote:'Вақт аэропортларнинг маҳаллий вақтида', support:'iumrah билан боғланиш', email:'Email ёзиш', phoneUZ:'Телефон · Ўзбекистон', phoneSA:'Телефон · Саудия Арабистони', telegram:'Telegram', whatsapp:'WhatsApp', supportDetail:'Брон ва сафарга тайёргарлик бўйича ёрдам берамиз.', initialPrice:'Нарх дастлабки — якуний сумма қайта текширувдан сўнг тасдиқланади.', bookingStage:'Ариза рақами' },
};
function infoCell(key: string, value: unknown): string {
  return value ? `<tr><td style="padding:11px 4px;color:#747987;font-size:13px;vertical-align:top">${esc(key)}</td><td align="right" style="padding:11px 4px;font-size:14px;font-weight:700;vertical-align:top;word-break:break-word">${esc(value)}</td></tr>` : '';
}
function blockTitle(title: string): string { return `<h3 style="font-size:18px;line-height:1.3;margin:0 0 14px;color:#181b23">${esc(title)}</h3>`; }
function hotelCard(title: string, name: string, image?: string | null): string {
  if (!name) return '';
  // Table-based layout and inline styles are intentionally used for Gmail / Apple Mail.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e6e8ef;border-radius:18px;overflow:hidden;margin:12px 0 0;border-collapse:separate"><tr><td>${image ? `<img alt="${esc(name)}" src="${esc(image)}" width="560" style="display:block;width:100%;max-width:100%;height:auto;max-height:260px;object-fit:cover;border:0"/>` : ''}<div style="padding:17px 18px 19px"><div style="font-size:12px;color:#858b97;margin-bottom:6px">${esc(title)}</div><div style="font-size:17px;line-height:1.4;color:#171a22;font-weight:750">${esc(name)}</div></div></td></tr></table>`;
}
const airportTimeZones: Record<string,string> = {
  TAS:'Asia/Tashkent',FEG:'Asia/Tashkent',NMA:'Asia/Tashkent',AZN:'Asia/Tashkent',SKD:'Asia/Tashkent',
  BHK:'Asia/Tashkent',KSQ:'Asia/Tashkent',TMJ:'Asia/Tashkent',UGC:'Asia/Tashkent',
  JED:'Asia/Riyadh',MED:'Asia/Riyadh',TIF:'Asia/Riyadh',RUH:'Asia/Riyadh',DMM:'Asia/Riyadh',
};
const intlLocales:Record<BookingMailLocale,string>={ru:'ru-RU',en:'en-GB',uz:'uz-UZ','uz-cyrl':'uz-Cyrl-UZ'};
function dateOnly(raw: unknown, locale: BookingMailLocale): string {
  const s=str(raw,32);
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(!match)return s;
  const date=new Date(`${s}T12:00:00Z`);
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==s)return s;
  return new Intl.DateTimeFormat(intlLocales[locale],{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
}
function stayDuration(stay:Record<string,unknown>, input:Record<string,unknown>, locale:BookingMailLocale):string {
  const l=detailLabels[locale];
  let days=Number(stay.totalDays), nights=Number(stay.totalNights);
  const start=str(input.startDate,10), end=str(input.endDate,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(start)&&/^\d{4}-\d{2}-\d{2}$/.test(end)){
    const span=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
    if(Number.isInteger(span)&&span>=0&&span<365){
      if(!Number.isInteger(days)||days<=0)days=span+1;
      if(!Number.isInteger(nights)||nights<0)nights=span;
    }
  }
  const dayWord=locale==='ru'?(days%10===1&&days%100!==11?'день':days%10>=2&&days%10<=4&&(days%100<12||days%100>14)?'дня':'дней'):days===1?l.day:l.days;
  const nightWord=locale==='ru'?(nights%10===1&&nights%100!==11?'ночь':nights%10>=2&&nights%10<=4&&(nights%100<12||nights%100>14)?'ночи':'ночей'):nights===1?l.night:l.nights;
  const parts=[];
  if(Number.isInteger(days)&&days>0&&days<366)parts.push(`${days} ${dayWord}`);
  if(Number.isInteger(nights)&&nights>=0&&nights<366)parts.push(`${nights} ${nightWord}`);
  return parts.join(' · ');
}
function localFlightDate(raw:unknown, airport:unknown, locale:BookingMailLocale):{date:string;time:string;zoneKnown:boolean} {
  const value=str(raw,60), code=str(airport,6).toUpperCase(), timeZone=airportTimeZones[code];
  if(!value)return {date:'',time:'',zoneKnown:false};
  // BookingGeneratorFlightSnapshot dates are ISO-8601 with Z. Never label UTC as local
  // for an airport whose time zone we have not identified.
  const dt=new Date(value);
  if(!Number.isFinite(dt.getTime()))return {date:'',time:'',zoneKnown:false};
  const zone=timeZone??'UTC';
  const d=new Intl.DateTimeFormat(intlLocales[locale],{day:'numeric',month:'short',year:'numeric',timeZone:zone}).format(dt);
  const t=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:zone}).format(dt);
  return {date:d,time:t+(timeZone?'':' UTC'),zoneKnown:!!timeZone};
}
function airlineInitials(value:unknown):string {
  return str(value,24).replace(/[^\p{L}\p{N}]/gu,'').slice(0,2).toUpperCase()||'✈';
}
function flightCard(label:string, trace:Record<string,unknown>, locale:BookingMailLocale):string {
  const l=detailLabels[locale];
  const orig=str(trace.origin,30),dest=str(trace.destination,30);
  const segments=Array.isArray(trace.segments)?trace.segments.slice(0,8).map(obj):[];
  const airline=str(trace.airline,120) || str(segments[0]?.airline,120);
  const flightNumbers=str(trace.flightNumbers,120) || segments.map(s=>str(s.flightNumber,30)).filter(Boolean).join(' / ');
  const depart=localFlightDate(trace.departureAt,orig,locale),arrive=localFlightDate(trace.arrivalAt,dest,locale);
  if(!orig&&!dest&&!flightNumbers&&!airline)return '';
  const stops=Number(trace.stops), hasStops=Number.isInteger(stops)&&stops>=0&&stops<=12;
  const stopsLabel=hasStops?(stops===0?l.stopsDirect:`${stops} ${stops===1?l.stop:l.stops}`):'';
  const duration=Number(trace.durationMinutes);
  const durationLabel=Number.isInteger(duration)&&duration>0&&duration<7200?`${Math.floor(duration/60)}h ${String(duration%60).padStart(2,'0')}m`:'';
  const segmentRows=segments.length>1?`<tr><td style="border-top:1px solid #eaecf1;padding:13px 17px 16px"><div style="font-size:11px;color:#7a808c;margin-bottom:7px">${esc(l.route)}</div>${segments.map(s=>{
    const code=[str(s.origin,10),str(s.destination,10)].filter(Boolean).join(' → ');
    const details=[str(s.airline,60),str(s.flightNumber,30)].filter(Boolean).join(' · ');
    return `<div style="padding:5px 0;font-size:12px;line-height:1.5;color:#4b5260"><b style="color:#22252c">${esc(code)}</b>${details?' &nbsp; '+esc(details):''}</div>`;
  }).join('')}</td></tr>`:'';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8ef;background:#ffffff;border-radius:18px;border-collapse:separate;overflow:hidden;margin:12px 0"><tr><td style="padding:17px 17px 14px"><div style="font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#6636D9;margin-bottom:14px">${esc(label)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="42" style="vertical-align:middle"><div style="background:#f0ecfc;border-radius:12px;width:40px;height:40px;text-align:center;line-height:40px;color:#6636D9;font-weight:800;font-size:13px">${esc(airlineInitials(str(segments[0]?.airlineCode,5)||airline))}</div></td><td style="padding-left:10px;vertical-align:middle"><div style="font-size:15px;font-weight:750;color:#171a22">${esc(airline||l.flights)}</div>${flightNumbers?`<div style="font-size:12px;color:#737986;margin-top:3px">${esc(l.flightNumber)} ${esc(flightNumbers)}</div>`:''}</td></tr></table></td></tr><tr><td style="background:#f8f9fc;padding:16px 17px 15px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="42%" style="vertical-align:top"><div style="font-size:25px;font-weight:850;letter-spacing:-.6px">${esc(depart.time||orig||'—')}</div>${depart.time?`<div style="font-size:15px;font-weight:750;margin-top:2px">${esc(orig)}</div>`:''}<div style="font-size:11px;color:#777f8d;margin-top:5px">${esc(depart.date)}</div></td><td align="center" width="16%" style="vertical-align:middle;font-size:20px;color:#6636D9">&#9992;</td><td width="42%" align="right" style="vertical-align:top"><div style="font-size:25px;font-weight:850;letter-spacing:-.6px">${esc(arrive.time||dest||'—')}</div>${arrive.time?`<div style="font-size:15px;font-weight:750;margin-top:2px">${esc(dest)}</div>`:''}<div style="font-size:11px;color:#777f8d;margin-top:5px">${esc(arrive.date)}</div></td></tr></table>${stopsLabel||durationLabel?`<div style="margin-top:15px;color:#68707e;font-size:12px">${esc([stopsLabel,durationLabel].filter(Boolean).join(' · '))}</div>`:''}</td></tr>${segmentRows}</table>`;
}
function normalizePhone(raw:unknown):{href:string;label:string;digits:string}|null {
  const label=str(raw,40); if(!/^\+?[0-9][0-9\s()\-]{6,22}$/.test(label))return null;
  const digits=label.replace(/\D/g,'');if(digits.length<8||digits.length>15)return null;
  return {href:'tel:+'+digits,label,digits};
}
function telegramLink(raw:unknown):string|null {
  const value=str(raw,120).trim();
  const username=value.replace(/^@/,'');
  if(/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username))return `https://t.me/${username}`;
  try { const url=new URL(value);if(url.protocol==='https:'&&url.hostname.toLowerCase()==='t.me'&&/^\/[A-Za-z0-9_]{5,32}\/?$/.test(url.pathname)&&!url.search&&!url.hash)return url.toString(); }catch{};
  return null;
}
export type BookingEmailContacts = { phoneUZ?:string; phoneSA?:string; telegram?:string; whatsapp?:string };
function supportRow(label:string,value:string,href:string):string {
  return `<tr><td style="padding:6px 0"><a href="${esc(href)}" style="display:block;text-decoration:none;border:1px solid #e8e9ef;border-radius:12px;padding:12px 14px;color:#1b1e27"><span style="font-size:11px;color:#7d838f;display:block;margin-bottom:4px">${esc(label)}</span><b style="font-size:14px">${esc(value)}</b></a></td></tr>`;
}
function supportCard(locale:BookingMailLocale,contacts:BookingEmailContacts):string {
  const l=detailLabels[locale],uz=normalizePhone(contacts.phoneUZ),sa=normalizePhone(contacts.phoneSA);
  const tg=telegramLink(contacts.telegram);
  const wa=normalizePhone(contacts.whatsapp);
  const channels=[
    supportRow(l.email,'support@iumrah.app','mailto:support@iumrah.app'),
    ...(uz?[supportRow(l.phoneUZ,uz.label,uz.href)]:[]),
    ...(sa?[supportRow(l.phoneSA,sa.label,sa.href)]:[]),
    ...(tg?[supportRow(l.telegram,contacts.telegram||'Telegram',tg)]:[]),
    ...(wa?[supportRow(l.whatsapp,wa.label,'https://wa.me/'+wa.digits)]:[]),
  ].join('');
  return `<div style="margin-top:24px">${blockTitle(l.support)}<p style="color:#737986;font-size:13px;line-height:1.6;margin:0 0 11px">${esc(l.supportDetail)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${channels}</table></div>`;
}
export type BookingEmailSnapshot = { bookingID:string; bookingNumber?:string; status:string; payload:Record<string,unknown>; priceConfirmed?:boolean; makkahImage?:string|null; madinahImage?:string|null };
export function renderBookingEmail(snapshot: BookingEmailSnapshot, locale: BookingMailLocale, stage: MailStage, contacts:BookingEmailContacts={}) {
  const c=text[locale],l=detailLabels[locale];
  const payload=snapshot.payload,booking=obj(payload.booking),data=Object.keys(booking).length?booking:payload;
  const profile=obj(data.pilgrimProfile??payload.pilgrimProfile);
  const input=obj(data.input),people=obj(input.travelers),hotels=obj(data.hotelNames);
  const stay=obj(data.stay);
  const count=[people.adults,people.children,people.infants].map(v=>Number(v)||0).reduce((a,b)=>a+(b>=0?b:0),0);
  const total=money(data.totalUsd),per=money(data.perPilgrimUsd)??(count>0&&Number(data.totalUsd)>0?money(Number(data.totalUsd)/count):null);
  const name=[str(profile.firstName,80),str(profile.lastName,80)].filter(Boolean).join(' ');
  const plan=str(data.planId||input.preferredPlan);
  const planNames:Record<string,Record<BookingMailLocale,string>>={economy:{ru:'Эконом',en:'Economy',uz:'Ekonom','uz-cyrl':'Эконом'},standard:{ru:'Стандарт',en:'Standard',uz:'Standart','uz-cyrl':'Стандарт'},comfort:{ru:'Комфорт',en:'Comfort',uz:'Komfort','uz-cyrl':'Комфорт'},luxury:{ru:'Люкс',en:'Luxury',uz:'Lyuks','uz-cyrl':'Люкс'}};
  const packageName=planNames[plan.toLowerCase()]?.[locale]??plan;
  const trace=obj(data.generatorTrace??payload.generatorTrace);
  const traceMakkah=obj(trace.makkahHotel),traceMadinah=obj(trace.madinahHotel);
  const makkahName=str(hotels.makkah||data.makkahHotel||traceMakkah.hotelName);
  const madinahName=str(hotels.madinah||data.madinahHotel||traceMadinah.hotelName);
  const flightSummary=str(data.flight);
  const displayNumber=str(snapshot.bookingNumber||snapshot.bookingID,24).replace(/[\r\n]/g,'');
  const url='https://iumrah.app/booking';
  const notice=stage==='checking'?c.noPay:stage==='available'?c.availableBody:stage==='paid'?c.paidBody:stage==='ready'?c.readyBody:c.travelingBody;
  const heading=stage==='checking'?c.head:stage==='available'?c.available:stage==='paid'?c.paid:stage==='ready'?c.ready:c.traveling;
  const stepStatus=stage==='checking'?c.checking:stage==='available'?c.payment:stage==='paid'?c.confirmed:stage==='ready'?c.docs:c.trip;
  const statusColor=stage==='checking'?'#b76b16':stage==='available'?'#1e6cba':stage==='paid'?'#238453':stage==='ready'?'#238453':'#6636D9';
  const subject=`iumrah · ${heading} · ${displayNumber}`;
  const dates=[dateOnly(input.startDate,locale),dateOnly(input.endDate,locale)].filter(Boolean).join(' → ');
  const duration=stayDuration(stay,input,locale);
  const rows=infoCell(l.bookingStage,displayNumber)+infoCell(c.guest,name)+infoCell(c.package,packageName)+infoCell(l.duration,duration)+infoCell(l.dates,dates)+infoCell(c.people,count>0?String(count):'')+infoCell(c.total,total)+infoCell(c.per,per);
  const outbound=flightCard(l.outbound,obj(trace.outbound),locale),inbound=flightCard(l.inbound,obj(trace.inbound),locale);
  const flightTimesNotice=(outbound||inbound)&&[obj(trace.outbound),obj(trace.inbound)].filter(f=>str(f.departureAt)&&str(f.arrivalAt)).every(f=>airportTimeZones[str(f.origin,6).toUpperCase()]&&airportTimeZones[str(f.destination,6).toUpperCase()])
    ?`<p style="font-size:11px;color:#858b97;margin:10px 3px 0">${esc(l.timeZoneNote)}</p>`:'';
  const flightHTML=outbound||inbound?`${blockTitle(l.flights)}${outbound}${inbound}${flightTimesNotice}`:flightSummary?`${blockTitle(l.flights)}<div style="border:1px solid #e6e8ef;border-radius:18px;padding:17px 18px;color:#333946;font-size:14px;line-height:1.6">${esc(flightSummary)}</div>`:'';
  const telegram=telegramLink(contacts.telegram);
  const logo=`${base}/api/package/email-brand/logo.png`;
  const html=`<!doctype html><html lang="${locale}" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head><body style="margin:0;padding:0;background:#f3f4f7;color:#171a22;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f7"><tr><td align="center" style="padding:20px 10px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:600px;border-collapse:separate;background:#fff;border:1px solid #e9eaf0;border-radius:24px;overflow:hidden"><tr><td style="background:#181a21;padding:22px 22px 19px"><img src="${logo}" width="126" alt="iumrah" style="display:block;width:126px;height:auto;max-width:100%;border:0"><div style="color:#c4bfda;font-size:12px;margin-top:15px">${esc(l.bookingStage)} <b style="color:#fff">${esc(displayNumber)}</b></div></td></tr><tr><td style="padding:27px 22px 10px"><div style="font-size:12px;color:${statusColor};font-weight:800;letter-spacing:.2px">● ${esc(stepStatus)}</div><h1 style="font-size:27px;line-height:1.25;margin:13px 0 12px;letter-spacing:-.45px;color:#181a20">${esc(heading)}</h1><p style="font-size:14px;line-height:1.7;color:#646b77;margin:0 0 15px">${esc(stage==='checking'?c.intro:notice)}</p>${stage==='checking'?`<div style="background:#edf8f0;border-radius:15px;padding:15px 16px;font-size:13px;line-height:1.65;color:#27583b;font-weight:650">✓ ${esc(c.noPay)}</div>`:''}<div style="margin:27px 0 6px">${blockTitle(c.booking)}<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #eceef2">${rows}</table>${total&&!snapshot.priceConfirmed?`<p style="color:#838893;font-size:12px;line-height:1.55;margin:12px 4px 0">${esc(l.initialPrice)}</p>`:''}</div>${makkahName||madinahName?`<div style="margin-top:25px">${blockTitle(locale==='ru'?'Отели':locale==='en'?'Hotels':locale==='uz'?'Mehmonxonalar':'Меҳмонхоналар')}${hotelCard(c.hotelM,makkahName,snapshot.makkahImage)}${hotelCard(c.hotelD,madinahName,snapshot.madinahImage)}</div>`:''}${flightHTML?`<div style="margin-top:26px">${flightHTML}</div>`:''}<div style="background:#f8f9fc;border:1px solid #e9eaf0;border-radius:17px;padding:18px;margin-top:25px">${blockTitle(c.next)}<p style="font-size:13px;line-height:1.65;color:#656e79;margin:0">${esc(stage==='checking'?c.nextBody:notice)}</p></div><div style="text-align:center;margin:25px 0 24px"><a href="${url}" style="display:block;background:#181a21;border-radius:999px;padding:15px 20px;text-decoration:none;color:#fff;font-weight:750;font-size:14px">${esc(c.view)} →</a></div><div style="background:#edf8ff;border:1px solid #d9ecff;border-radius:17px;padding:18px"><div style="font-weight:750;color:#1c2d3e;font-size:15px">${esc(c.telegram)}</div><p style="font-size:13px;line-height:1.6;color:#53697e;margin:9px 0 15px">${esc(c.telegramBody)}</p><a href="${url}" style="display:inline-block;border-radius:999px;background:#229ed9;padding:12px 20px;color:#fff;font-size:13px;font-weight:750;text-decoration:none">${esc(c.connect)}</a></div>${supportCard(locale,contacts)}</td></tr><tr><td style="background:#f6f7fa;padding:22px;color:#818692;font-size:11px;line-height:1.7"><b style="color:#252934;font-size:14px">iumrah</b><br>${esc(c.footer)}<br><a href="${base}" style="color:#595d71">iumrah.app</a></td></tr></table></td></tr></table></body></html>`;
  const flightText=[obj(trace.outbound),obj(trace.inbound)].map((f,i)=>{
    if(!Object.keys(f).length)return '';
    return `${i===0?l.outbound:l.inbound}: ${[str(f.airline),str(f.flightNumbers),[str(f.origin),str(f.destination)].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')}`;
  }).filter(Boolean).join('\n');
  const phones=[normalizePhone(contacts.phoneUZ),normalizePhone(contacts.phoneSA)].filter((v):v is NonNullable<typeof v>=>!!v).map(v=>v.label).join(', ');
  const plain=[heading,`${l.bookingStage}: ${displayNumber}`,stage==='checking'?c.intro:notice,`${c.guest}: ${name}`,`${c.package}: ${packageName}`,`${l.duration}: ${duration}`,`${l.dates}: ${dates}`,`${c.people}: ${count||'-'}`,`${c.total}: ${total??'-'}`,`${c.per}: ${per??'-'}`,!snapshot.priceConfirmed?l.initialPrice:'',`${c.hotelM}: ${makkahName}`,`${c.hotelD}: ${madinahName}`,flightText||flightSummary,stage==='checking'?c.noPay:'',stage==='checking'?c.nextBody:notice,c.telegramBody,`${c.view}: ${url}`,`${l.support}: support@iumrah.app`,phones,telegram||''].filter(Boolean).join('\n\n');
  return {subject,html,text:plain};
}
function fromAddress(env:Env){return String(env.ACCOUNT_EMAIL_FROM||'security@iumrah.app').trim();}
export async function sendResend(env:Env,email:string,copy:{subject:string;html:string;text:string},key:string):Promise<void>{
  if(!env.RESEND_API_KEY)throw new Error('RESEND_API_KEY_MISSING');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','Idempotency-Key':key.slice(0,255)},body:JSON.stringify({from:`iumrah <${fromAddress(env)}>`,to:[email],reply_to:env.ACCOUNT_EMAIL_REPLY_TO||'support@iumrah.app',...copy})});
  if(!response.ok) throw new Error(`EMAIL_SEND_${response.status}`);
}
export async function sendBookingEmailStatus(env:Env,bookingID:string):Promise<'sent'|'skipped'|'retry'> {
  if(!env.HOTELS_DB||!env.BOOKINGS_DB||!env.RESEND_API_KEY)return 'skipped';
  const db=env.HOTELS_DB;
  await ensureBookingMailSchema(db);
  const sub=await db.prepare('SELECT booking_id,email,locale,last_sent_status,lease_until FROM iumrah_booking_email_subscriptions WHERE booking_id=?1').bind(bookingID).first<{booking_id:string;email:string;locale:string;last_sent_status:string|null;lease_until:string|null}>();
  if(!sub)return 'skipped';
  const booking=await env.BOOKINGS_DB.prepare('SELECT id,status,payload_json FROM bookings WHERE id=?1 LIMIT 1').bind(bookingID).first<{id:string;status:string;payload_json:string}>();
  if(!booking){await db.prepare('DELETE FROM iumrah_booking_email_subscriptions WHERE booking_id=?1').bind(bookingID).run();return 'skipped';}
  const payload=obj(JSON.parse(booking.payload_json||'{}'));
  const operational=await db.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=?1 LIMIT 1').bind(bookingID).first<{status:string;booking_number?:number|string;booking_display_number?:string}>().catch(()=>null);
  const status=resolveMailStage(operational?.status)||resolveMailStage(booking.status)||resolveMailStage(payload.status)||resolveMailStage(obj(payload.booking).status);
  if(!status||status===sub.last_sent_status)return 'skipped';
  const now=new Date().toISOString();const leaseUntil=new Date(Date.now()+3*60_000).toISOString();const lease=crypto.randomUUID();
  // Lease prevents concurrent cron and attach from sending the same status.
  const claim=await db.prepare(`UPDATE iumrah_booking_email_subscriptions SET lease_token=?1,lease_until=?2
    WHERE booking_id=?3 AND (lease_until IS NULL OR lease_until<?4) AND (last_sent_status IS NULL OR last_sent_status<>?5)`).bind(lease,leaseUntil,bookingID,now,status).run();
  if(Number(claim.meta?.changes??0)!==1)return 'skipped';
  try {
    const bookingNo=operational?.booking_display_number || (operational?.booking_number != null ? `#${String(operational.booking_number).padStart(4,'0')}` : undefined);
    const confirmed=Number((operational as Record<string,unknown>|null)?.confirmed_total_usd ?? (operational as Record<string,unknown>|null)?.final_total_usd ?? 0);
    const snapshot:BookingEmailSnapshot={bookingID,bookingNumber:bookingNo,status,payload,priceConfirmed:Number.isFinite(confirmed)&&confirmed>0};
    if(snapshot.priceConfirmed){
      const data=obj(payload.booking);
      const travelers=obj(obj(data.input).travelers);
      const count=Number(travelers.adults??0)+Number(travelers.children??0)+Number(travelers.infants??0);
      // Operational confirmed price takes priority over an earlier indicative quote.
      if(Object.keys(data).length){ data.totalUsd=confirmed;data.perPilgrimUsd=count>0?confirmed/count:data.perPilgrimUsd;payload.booking=data; }
      else { payload.totalUsd=confirmed;payload.perPilgrimUsd=count>0?confirmed/count:payload.perPilgrimUsd; }
    }
    const current=obj(payload.booking);
    const hotelIds=obj(current.selection??payload.selection);
    const primary=obj(current.hotelSelection??payload.hotelSelection);
    const secondary=obj(current.madinahHotelSelection??payload.madinahHotelSelection);
    snapshot.makkahImage=safeHttps(primary.coverImageURL)??await findHotelImage(db,hotelIds.makkahHotelId??primary.hotelId);
    snapshot.madinahImage=safeHttps(secondary.coverImageURL)??await findHotelImage(db,hotelIds.madinahHotelId??secondary.hotelId);
    // Resend idempotency key is stable per booking and status. No duplicate on retries.
    await sendResend(env,sub.email,renderBookingEmail(snapshot,mailLocale(sub.locale),status,{phoneUZ:env.BOOKING_SUPPORT_PHONE_UZ,phoneSA:env.BOOKING_SUPPORT_PHONE_SA,telegram:env.BOOKING_SUPPORT_TELEGRAM,whatsapp:env.BOOKING_SUPPORT_WHATSAPP}),`iumrah-${bookingID}-${status}-${sub.email}`);
    await db.prepare(`UPDATE iumrah_booking_email_subscriptions SET last_sent_status=?1,last_sent_at=?2,last_error=NULL,lease_until=NULL,lease_token=NULL
      WHERE booking_id=?3 AND lease_token=?4`).bind(status,new Date().toISOString(),bookingID,lease).run();
    return 'sent';
  }catch(e){
    const error=e instanceof Error?e.message:'EMAIL_ERROR';
    await db.prepare(`UPDATE iumrah_booking_email_subscriptions SET lease_until=NULL,lease_token=NULL,last_error=?1 WHERE booking_id=?2 AND lease_token=?3`).bind(error.slice(0,90),bookingID,lease).run();
    console.error('booking-email-retry',bookingID,error);return 'retry';
  }
}
async function findHotelImage(db:D1Like, id:unknown):Promise<string|null>{
  const hotelID=str(id,100);if(!hotelID)return null;
  try{
    const row=await db.prepare('SELECT * FROM hotels WHERE id=?1 LIMIT 1').bind(hotelID).first<Record<string,unknown>>();
    if(!row)return null;
    for(const k of ['cover_image_url','cover_photo_url','image_url','photo_url','hero_image','coverUrl','thumbnail_url']){const url=safeHttps(row[k]);if(url)return url;}
    for(const k of ['photos_json','images_json','photos','images']){
      let val=row[k];if(typeof val==='string'){try{val=JSON.parse(val);}catch{val=null;}}
      if(Array.isArray(val))for(const image of val.slice(0,5)) { const url=safeHttps(typeof image==='string'?image:obj(image).url||obj(image).src);if(url)return url; }
    }
  }catch(e){console.warn('booking-hotel-image-unavailable',hotelID);}
  return null;
}
export async function flushBookingStatusEmails(env:Env):Promise<void>{
  if(!env.HOTELS_DB||!env.BOOKINGS_DB||!env.RESEND_API_KEY)return;
  await ensureBookingMailSchema(env.HOTELS_DB);
  await env.HOTELS_DB.prepare('DELETE FROM iumrah_guest_booking_email_challenges WHERE expires_at<?1').bind(new Date(Date.now()-7*24*3600_000).toISOString()).run();
  const rows=await env.HOTELS_DB.prepare(`SELECT booking_id FROM iumrah_booking_email_subscriptions ORDER BY verified_at DESC LIMIT 3000`).all<{booking_id:string}>();
  for(const item of rows.results??[]){await sendBookingEmailStatus(env,item.booking_id);}
}
