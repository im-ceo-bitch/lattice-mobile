import type { D1Like } from "./d1";
import type { Env } from "./env";

export type SaudiCity = "Makkah" | "Madinah";
export type StayPolicy = "balanced" | "hotelFirst";

export type VerifiedFlightSchedule = {
  outbound: {
    origin: string;
    destination: string;
    departureAt: string;
    arrivalAt: string;
  };
  inbound?: {
    origin: string;
    destination: string;
    departureAt: string;
    arrivalAt: string;
  } | null;
};

export type AuthoritativeStayPlan = {
  timezone: "Asia/Riyadh";
  source: "verifiedFlightTimes" | "requestedNightsFallback" | "selectedSupplierStays";
  firstCity: SaudiCity;
  lastCity: SaudiCity;
  totalNights: number;
  totalDays: number;
  makkahNights: number;
  madinahNights: number;
  makkahCheckIn: string;
  makkahCheckOut: string;
  madinahCheckIn: string | null;
  madinahCheckOut: string | null;
  hotelReadyAt: string | null;
  leaveHotelAt: string | null;
  earlyArrivalNight: boolean;
};

export type PlannerInput = {
  includeMadinah: boolean;
  requestedMakkahNights: number;
  requestedMadinahNights: number;
  stayPolicy: StayPolicy;
  schedule: VerifiedFlightSchedule | null;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

const SAUDI_TZ = "Asia/Riyadh";
const AIRPORT_EXIT_MINUTES = 120;
const AIRPORT_CHECKIN_BUFFER_MINUTES = 180;
const JED_MAKKAH_TRANSFER_MINUTES = 105;
const MED_CITY_TRANSFER_MINUTES = 40;
const INTERCITY_ROAD_MINUTES = 300;
const INTERCITY_HARAMAIN_DOOR_TO_DOOR_MINUTES = 210;
const STANDARD_CHECKIN_MINUTE = 15 * 60;
const STANDARD_CHECKOUT_MINUTE = 12 * 60;

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function localParts(date: Date): LocalParts {
  const values: Record<string, number> = {};
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAUDI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  for (const part of parts) {
    if (["year", "month", "day", "hour", "minute"].includes(part.type)) values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function dateString(parts: Pick<LocalParts, "year" | "month" | "day">) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDate(date: Date) {
  return dateString(localParts(date));
}

function localTime(date: Date) {
  const p = localParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function localDateTime(date: Date) {
  return `${localDate(date)}T${localTime(date)}:00+03:00`;
}

function dateOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function previousDay(value: string) {
  return addDays(value, -1);
}

function cityForAirport(code: string, fallback: SaudiCity): SaudiCity {
  return code.trim().toUpperCase() === "MED" ? "Madinah" : fallback;
}

function firstCityForSchedule(schedule: VerifiedFlightSchedule | null): SaudiCity {
  return schedule?.outbound.destination.trim().toUpperCase() === "MED" ? "Madinah" : "Makkah";
}

function airportCityTransferMinutes(airport: string, city: SaudiCity) {
  const code = airport.trim().toUpperCase();
  if (code === "MED" && city === "Madinah") return MED_CITY_TRANSFER_MINUTES;
  if (code === "JED" && city === "Makkah") return JED_MAKKAH_TRANSFER_MINUTES;
  // Cross-city airport transfers are intentionally conservative. They are used
  // when a valid fare arrives/departs through the opposite Saudi gateway, so
  // the itinerary never pretends a Makkah hotel is 40 minutes from MED or a
  // Madinah hotel is 105 minutes from JED.
  return INTERCITY_ROAD_MINUTES;
}

function plannedLastHotelCity(firstCity: SaudiCity, includeMadinah: boolean) {
  if (!includeMadinah) return firstCity;
  return firstCity === "Madinah" ? "Makkah" : "Madinah";
}

function splitNights(totalNights: number, includeMadinah: boolean, stayPolicy: StayPolicy, requestedMakkah: number, requestedMadinah: number) {
  if (!includeMadinah || totalNights <= 1) return { makkah: totalNights, madinah: 0 };

  if (stayPolicy === "hotelFirst" && totalNights >= 4) {
    const madinah = Math.min(2, Math.max(1, totalNights - 2));
    return { makkah: Math.max(1, totalNights - madinah), madinah };
  }

  const requestedTotal = requestedMakkah + requestedMadinah;
  if (requestedTotal > 1 && requestedMadinah > 0) {
    const ratio = requestedMadinah / requestedTotal;
    const madinah = clampInt(totalNights * ratio, 1, totalNights - 1);
    return { makkah: totalNights - madinah, madinah };
  }

  const makkah = clampInt(Math.ceil(totalNights * 0.6), 1, totalNights - 1);
  return { makkah, madinah: totalNights - makkah };
}

function fallbackPlan(input: PlannerInput): AuthoritativeStayPlan {
  const requestedTotal = Math.max(1, input.requestedMakkahNights + (input.includeMadinah ? input.requestedMadinahNights : 0));
  const split = splitNights(requestedTotal, input.includeMadinah, input.stayPolicy, input.requestedMakkahNights, input.requestedMadinahNights);
  const firstCity = firstCityForSchedule(input.schedule);
  const lastCity = split.madinah > 0 ? plannedLastHotelCity(firstCity, true) : firstCity;
  const arrival = parseInstant(input.schedule?.outbound.arrivalAt);
  const hotelReady = arrival
    ? addMinutes(arrival, AIRPORT_EXIT_MINUTES + airportCityTransferMinutes(input.schedule?.outbound.destination ?? "JED", firstCity))
    : null;
  const start = hotelReady ? localDate(hotelReady) : localDate(new Date());
  const end = addDays(start, requestedTotal);
  return buildStayWindows({
    source: "requestedNightsFallback",
    firstCity,
    lastCity,
    totalNights: requestedTotal,
    split,
    startDate: start,
    endDate: end,
    hotelReady,
    leaveHotel: null,
    earlyArrivalNight: false,
  });
}

function buildStayWindows(args: {
  source: AuthoritativeStayPlan["source"];
  firstCity: SaudiCity;
  lastCity: SaudiCity;
  totalNights: number;
  split: { makkah: number; madinah: number };
  startDate: string;
  endDate: string;
  hotelReady: Date | null;
  leaveHotel: Date | null;
  earlyArrivalNight: boolean;
}): AuthoritativeStayPlan {
  let makkahCheckIn: string;
  let makkahCheckOut: string;
  let madinahCheckIn: string | null = null;
  let madinahCheckOut: string | null = null;

  if (args.split.madinah <= 0) {
    makkahCheckIn = args.startDate;
    makkahCheckOut = args.endDate;
  } else if (args.firstCity === "Madinah") {
    madinahCheckIn = args.startDate;
    madinahCheckOut = addDays(args.startDate, args.split.madinah);
    makkahCheckIn = madinahCheckOut;
    makkahCheckOut = args.endDate;
  } else {
    makkahCheckIn = args.startDate;
    makkahCheckOut = addDays(args.startDate, args.split.makkah);
    madinahCheckIn = makkahCheckOut;
    madinahCheckOut = args.endDate;
  }

  return {
    timezone: SAUDI_TZ,
    source: args.source,
    firstCity: args.firstCity,
    lastCity: args.lastCity,
    totalNights: args.totalNights,
    totalDays: args.totalNights + 1,
    makkahNights: args.split.makkah,
    madinahNights: args.split.madinah,
    makkahCheckIn,
    makkahCheckOut,
    madinahCheckIn,
    madinahCheckOut,
    hotelReadyAt: args.hotelReady ? localDateTime(args.hotelReady) : null,
    leaveHotelAt: args.leaveHotel ? localDateTime(args.leaveHotel) : null,
    earlyArrivalNight: args.earlyArrivalNight,
  };
}

/**
 * Derives hotel nights from verified provider flight timestamps. The server never
 * trusts a client-supplied fare or time for billing. A very large discrepancy
 * falls back to the already-selected night count so corrupted inventory cannot
 * unexpectedly reprice a booking by several nights.
 */
export function deriveAuthoritativeStayPlan(input: PlannerInput): AuthoritativeStayPlan {
  const fallback = fallbackPlan(input);
  const outboundArrival = parseInstant(input.schedule?.outbound.arrivalAt);
  const inboundDeparture = parseInstant(input.schedule?.inbound?.departureAt);
  if (!outboundArrival || !inboundDeparture || inboundDeparture <= outboundArrival) return fallback;

  const firstAirport = input.schedule?.outbound.destination ?? "JED";
  const lastAirport = input.schedule?.inbound?.origin ?? "JED";
  const firstCity = firstCityForSchedule(input.schedule);
  const plannedLastCity = plannedLastHotelCity(firstCity, input.includeMadinah);
  const hotelReady = addMinutes(outboundArrival, AIRPORT_EXIT_MINUTES + airportCityTransferMinutes(firstAirport, firstCity));
  const leaveHotel = addMinutes(inboundDeparture, -(AIRPORT_CHECKIN_BUFFER_MINUTES + airportCityTransferMinutes(lastAirport, plannedLastCity)));
  if (leaveHotel <= hotelReady) return fallback;

  const readyParts = localParts(hotelReady);
  const readyMinute = readyParts.hour * 60 + readyParts.minute;
  const readyDate = dateString(readyParts);
  const earlyArrivalNight = readyMinute < STANDARD_CHECKOUT_MINUTE;
  const reservationStart = earlyArrivalNight ? previousDay(readyDate) : readyDate;
  const reservationEnd = localDate(leaveHotel);
  const computedNights = dateOrdinal(reservationEnd) - dateOrdinal(reservationStart);
  const requestedTotal = Math.max(1, input.requestedMakkahNights + (input.includeMadinah ? input.requestedMadinahNights : 0));

  if (computedNights < 1 || computedNights > 30 || Math.abs(computedNights - requestedTotal) > 2) return fallback;
  if (input.includeMadinah && computedNights < 2) return fallback;

  const split = splitNights(computedNights, input.includeMadinah, input.stayPolicy, input.requestedMakkahNights, input.requestedMadinahNights);
  const lastCity = split.madinah > 0 ? plannedLastHotelCity(firstCity, true) : firstCity;
  return buildStayWindows({
    source: "verifiedFlightTimes",
    firstCity,
    lastCity,
    totalNights: computedNights,
    split,
    startDate: reservationStart,
    endDate: reservationEnd,
    hotelReady,
    leaveHotel,
    earlyArrivalNight,
  });
}

export type BookingItineraryEvent = {
  id: string;
  bookingID: string;
  dateLocal: string;
  sortOrder: number;
  title: string;
  subtitle: string;
  icon: string;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  timeLocal: string | null;
  endTimeLocal: string | null;
  kind: string;
};

type BookingPayload = Record<string, any>;

type Language = "ru" | "en" | "uz" | "uz-Cyrl" | "tr" | "id" | "ar";

function normalizeLanguage(value: string | null): Language {
  const v = String(value ?? "ru").trim();
  if (v.toLowerCase().split(/[-_]/)[0] === "en") return "en";
  if (v.toLowerCase().split(/[-_]/)[0] === "tr") return "tr";
  if (v.toLowerCase().split(/[-_]/)[0] === "id") return "id";
  if (v.toLowerCase().split(/[-_]/)[0] === "ar") return "ar";
  if (/^uz[-_]cyrl/i.test(v)) return "uz-Cyrl";
  if (v.toLowerCase().split(/[-_]/)[0] === "uz") return "uz";
  return "ru";
}

const COPY = {
  ru: {
    arrival: "Прилёт в Саудовскую Аравию",
    airportExit: "Паспортный контроль и багаж",
    transferHotel: "Трансфер в отель",
    checkIn: "Заселение в отель",
    rest: "Отдых после дороги",
    umrah: "Умра",
    umrahBody: "Ихрам · таваф · са’й",
    madinahZiyarat: "Зиярат в Медине",
    madinahBody: "Мечеть Пророка ﷺ и места зиярата",
    makkahZiyarat: "Зиярат в Мекке",
    makkahBody: "Исторические места Мекки",
    intercityMakkah: "Переезд в Мекку",
    intercityMadinah: "Переезд в Медину",
    checkout: "Выезд из отеля",
    airportTransfer: "Трансфер в аэропорт",
    flightHome: "Вылет домой",
    haramain: "Haramain · отель → вокзал → отель",
    road: "Междугородний трансфер",
    makkah: "Мекка",
    madinah: "Медина",
    jeddah: "Джидда",
  },
  en: {
    arrival: "Arrival in Saudi Arabia", airportExit: "Immigration and baggage", transferHotel: "Transfer to hotel", checkIn: "Hotel check-in", rest: "Rest after travel", umrah: "Umrah", umrahBody: "Ihram · tawaf · sa’i", madinahZiyarat: "Madinah ziyarat", madinahBody: "Prophet’s Mosque ﷺ and ziyarat sites", makkahZiyarat: "Makkah ziyarat", makkahBody: "Historic sites of Makkah", intercityMakkah: "Transfer to Makkah", intercityMadinah: "Transfer to Madinah", checkout: "Hotel check-out", airportTransfer: "Airport transfer", flightHome: "Flight home", haramain: "Haramain · hotel → station → hotel", road: "Intercity transfer", makkah: "Makkah", madinah: "Madinah", jeddah: "Jeddah",
  },
  uz: {
    arrival: "Saudiya Arabistoniga yetib kelish", airportExit: "Pasport nazorati va bagaj", transferHotel: "Mehmonxonaga transfer", checkIn: "Mehmonxonaga joylashish", rest: "Yo‘ldan keyin dam olish", umrah: "Umra", umrahBody: "Ihram · tavof · sa’y", madinahZiyarat: "Madina ziyorati", madinahBody: "Payg‘ambar masjidi ﷺ va ziyorat joylari", makkahZiyarat: "Makka ziyorati", makkahBody: "Makkadagi tarixiy joylar", intercityMakkah: "Makkaga yo‘l", intercityMadinah: "Madinaga yo‘l", checkout: "Mehmonxonadan chiqish", airportTransfer: "Aeroportga transfer", flightHome: "Uyga parvoz", haramain: "Haramain · mehmonxona → vokzal → mehmonxona", road: "Shaharlararo transfer", makkah: "Makka", madinah: "Madina", jeddah: "Jidda",
  },
  tr: {
    arrival: "Suudi Arabistan’a varış", airportExit: "Pasaport kontrolü ve bagaj teslimi", transferHotel: "Otele transfer", checkIn: "Otele giriş", rest: "Yolculuk sonrası dinlenme", umrah: "Umre", umrahBody: "İhram · tavaf · sa’y", madinahZiyarat: "Medine ziyaretleri", madinahBody: "Mescid-i Nebevî ﷺ ve ziyaret yerleri", makkahZiyarat: "Mekke ziyaretleri", makkahBody: "Mekke’nin tarihî yerleri", intercityMakkah: "Mekke’ye transfer", intercityMadinah: "Medine’ye transfer", checkout: "Otelden çıkış", airportTransfer: "Havalimanına transfer", flightHome: "Dönüş uçuşu", haramain: "Haremeyn · otel → istasyon → otel", road: "Şehirler arası transfer", makkah: "Mekke", madinah: "Medine", jeddah: "Cidde",
  },
  ar: {
    arrival: "الوصول إلى المملكة العربية السعودية",
    airportExit: "الجوازات واستلام الأمتعة",
    transferHotel: "الانتقال إلى الفندق",
    checkIn: "تسجيل الوصول إلى الفندق",
    rest: "الراحة بعد السفر",
    umrah: "العمرة",
    umrahBody: "الإحرام · الطواف · السعي",
    madinahZiyarat: "زيارة معالم المدينة المنورة",
    madinahBody: "المسجد النبوي ﷺ والمعالم التاريخية",
    makkahZiyarat: "زيارة معالم مكة المكرمة",
    makkahBody: "المعالم التاريخية في مكة المكرمة",
    intercityMakkah: "الانتقال إلى مكة المكرمة",
    intercityMadinah: "الانتقال إلى المدينة المنورة",
    checkout: "تسجيل المغادرة من الفندق",
    airportTransfer: "الانتقال إلى المطار",
    flightHome: "رحلة العودة",
    haramain: "قطار الحرمين · الفندق ← المحطة ← الفندق",
    road: "التنقل بين المدن",
    makkah: "مكة المكرمة",
    madinah: "المدينة المنورة",
    jeddah: "جدة",
  },
  id: {
    arrival: "Tiba di Arab Saudi", airportExit: "Pemeriksaan imigrasi dan pengambilan bagasi", transferHotel: "Transfer ke hotel", checkIn: "Check-in hotel", rest: "Istirahat setelah perjalanan", umrah: "Umrah", umrahBody: "Ihram · tawaf · sa’i", madinahZiyarat: "Ziarah di Madinah", madinahBody: "Masjid Nabawi ﷺ dan tempat ziarah", makkahZiyarat: "Ziarah di Makkah", makkahBody: "Tempat bersejarah di Makkah", intercityMakkah: "Perjalanan ke Makkah", intercityMadinah: "Perjalanan ke Madinah", checkout: "Check-out hotel", airportTransfer: "Transfer ke bandara", flightHome: "Penerbangan pulang", haramain: "Haramain · hotel → stasiun → hotel", road: "Transfer antarkota", makkah: "Makkah", madinah: "Madinah", jeddah: "Jeddah",
  },
  "uz-Cyrl": {
    arrival: "Саудия Арабистонига етиб келиш", airportExit: "Паспорт назорати ва багаж", transferHotel: "Меҳмонхонага трансфер", checkIn: "Меҳмонхонага жойлашиш", rest: "Йўлдан кейин дам олиш", umrah: "Умра", umrahBody: "Иҳром · тавоф · саъй", madinahZiyarat: "Мадина зиёрати", madinahBody: "Пайғамбар масжиди ﷺ ва зиёрат жойлари", makkahZiyarat: "Макка зиёрати", makkahBody: "Маккадаги тарихий жойлар", intercityMakkah: "Маккага йўл", intercityMadinah: "Мадинага йўл", checkout: "Меҳмонхонадан чиқиш", airportTransfer: "Аэропортга трансфер", flightHome: "Уйга парвоз", haramain: "Haramain · меҳмонхона → вокзал → меҳмонхона", road: "Шаҳарлараро трансфер", makkah: "Макка", madinah: "Мадина", jeddah: "Жидда",
  },
} as const;

function atSaudiLocal(dateStringValue: string, hour: number, minute: number) {
  // Saudi Arabia is UTC+03:00 year-round.
  return new Date(`${dateStringValue}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`);
}

function comfortableUmrahStart(checkIn: Date) {
  const candidate = addMinutes(checkIn, 180);
  const p = localParts(candidate);
  const minute = p.hour * 60 + p.minute;
  const day = localDate(candidate);
  if (minute < 7 * 60) return atSaudiLocal(day, 9, 0);
  if (minute <= 18 * 60) return candidate;
  if (minute <= 21 * 60) return atSaudiLocal(day, 22, 0);
  return atSaudiLocal(addDays(day, 1), 9, 0);
}

function roundUpToHalfHour(date: Date) {
  const p = localParts(date);
  const roundedMinute = p.minute === 0 ? 0 : p.minute <= 30 ? 30 : 60;
  if (roundedMinute < 60) return atSaudiLocal(localDate(date), p.hour, roundedMinute);
  const nextHour = addMinutes(date, 60 - p.minute);
  const n = localParts(nextHour);
  return atSaudiLocal(localDate(nextHour), n.hour, 0);
}

function fitThreeHourActivity(checkIn: Date, boundary: Date | null, minimumRestMinutes = 360): Date | null {
  const nextMorning = atSaudiLocal(addDays(localDate(checkIn), 1), 9, 0);
  const earliest = roundUpToHalfHour(addMinutes(checkIn, minimumRestMinutes));
  const preferred = nextMorning >= earliest ? nextMorning : earliest;
  if (!boundary || addMinutes(preferred, 180) <= boundary) return preferred;
  if (addMinutes(earliest, 180) <= boundary) return earliest;
  return null;
}

function bookingObject(rawJSON: string): BookingPayload {
  const raw = JSON.parse(rawJSON || "{}") as BookingPayload;
  return raw.booking && typeof raw.booking === "object" ? raw.booking : raw;
}

function scheduleFromBooking(booking: BookingPayload): VerifiedFlightSchedule | null {
  const trace = booking.generatorTrace ?? {};
  const outbound = trace.outbound;
  if (!outbound || !parseInstant(outbound.departureAt) || !parseInstant(outbound.arrivalAt)) return null;
  const inbound = trace.inbound;
  return {
    outbound: {
      origin: String(outbound.origin ?? booking.route?.originCode ?? ""),
      destination: String(outbound.destination ?? booking.route?.outboundDestination ?? ""),
      departureAt: String(outbound.departureAt),
      arrivalAt: String(outbound.arrivalAt),
    },
    inbound: inbound && parseInstant(inbound.departureAt) && parseInstant(inbound.arrivalAt) ? {
      origin: String(inbound.origin ?? booking.route?.returnOrigin ?? ""),
      destination: String(inbound.destination ?? booking.route?.originCode ?? ""),
      departureAt: String(inbound.departureAt),
      arrivalAt: String(inbound.arrivalAt),
    } : null,
  };
}

function hotelName(booking: BookingPayload, city: SaudiCity) {
  return city === "Makkah" ? String(booking.hotelNames?.makkah ?? "") : String(booking.hotelNames?.madinah ?? "");
}

function cityName(copy: typeof COPY[Language], city: SaudiCity) {
  return city === "Makkah" ? copy.makkah : copy.madinah;
}

function event(id: string, bookingID: string, kind: string, when: Date, end: Date | null, title: string, subtitle: string, icon: string, location: string): BookingItineraryEvent {
  const p = localParts(when);
  return {
    id,
    bookingID,
    dateLocal: dateString(p),
    sortOrder: p.hour * 60 + p.minute,
    title,
    subtitle,
    icon,
    location,
    notes: "",
    createdAt: "",
    updatedAt: "",
    timeLocal: localTime(when),
    endTimeLocal: end ? localTime(end) : null,
    kind,
  };
}

export function buildBookingItinerary(bookingID: string, booking: BookingPayload, languageValue: string | null): { stayPlan: AuthoritativeStayPlan; items: BookingItineraryEvent[] } {
  const language = normalizeLanguage(languageValue);
  const copy = COPY[language];
  const schedule = scheduleFromBooking(booking);
  const requestedMakkah = Math.max(1, Number(booking.stay?.makkahNights ?? 1));
  const requestedMadinah = Math.max(0, Number(booking.stay?.madinahNights ?? 0));
  const includeMadinah = Boolean(booking.input?.includeMadinah ?? requestedMadinah > 0);
  const stayPolicy: StayPolicy = booking.stayPolicy === "hotelFirst" ? "hotelFirst" : "balanced";
  const stayPlan = deriveAuthoritativeStayPlan({
    includeMadinah,
    requestedMakkahNights: requestedMakkah,
    requestedMadinahNights: requestedMadinah,
    stayPolicy,
    schedule,
  });

  const items: BookingItineraryEvent[] = [];
  if (!schedule) return { stayPlan, items };
  if (!schedule.inbound && String(booking.input?.flightTripType ?? "roundTrip") !== "oneWay") {
    // Old booking rows without a return-flight trace are better served by the
    // operational itinerary than by a partial server timeline.
    return { stayPlan, items };
  }
  const outboundArrival = parseInstant(schedule.outbound.arrivalAt)!;
  const airportExit = addMinutes(outboundArrival, AIRPORT_EXIT_MINUTES);
  const firstCity = stayPlan.firstCity;
  const firstHotelArrival = addMinutes(airportExit, airportCityTransferMinutes(schedule.outbound.destination, firstCity));
  const firstCityLabel = cityName(copy, firstCity);

  items.push(event(`${bookingID}-arrival`, bookingID, "arrival", outboundArrival, null, copy.arrival, `${schedule.outbound.origin} → ${schedule.outbound.destination}`, "airplane.arrival", firstCityLabel));
  items.push(event(`${bookingID}-airport-exit`, bookingID, "airportExit", outboundArrival, airportExit, copy.airportExit, `${AIRPORT_EXIT_MINUTES} min`, "suitcase.fill", firstCityLabel));
  items.push(event(`${bookingID}-hotel-transfer`, bookingID, "hotelTransfer", airportExit, firstHotelArrival, copy.transferHotel, hotelName(booking, firstCity), "car.fill", firstCityLabel));

  let firstCheckIn = firstHotelArrival;
  const firstReadyParts = localParts(firstHotelArrival);
  const firstReadyMinute = firstReadyParts.hour * 60 + firstReadyParts.minute;
  if (firstReadyMinute >= STANDARD_CHECKOUT_MINUTE && firstReadyMinute < STANDARD_CHECKIN_MINUTE) {
    firstCheckIn = atSaudiLocal(localDate(firstHotelArrival), 15, 0);
  }
  items.push(event(`${bookingID}-first-checkin`, bookingID, "hotelCheckIn", firstCheckIn, null, copy.checkIn, hotelName(booking, firstCity), "building.2.fill", firstCityLabel));

  let makkahCheckInInstant: Date | null = firstCity === "Makkah" ? firstCheckIn : null;
  let madinahCheckInInstant: Date | null = firstCity === "Madinah" ? firstCheckIn : null;
  let intercityTransferStart: Date | null = null;

  if (includeMadinah && stayPlan.madinahNights > 0) {
    const switchDate = firstCity === "Madinah" ? stayPlan.madinahCheckOut : stayPlan.makkahCheckOut;
    if (switchDate) {
      const firstCheckout = atSaudiLocal(switchDate, 11, 0);
      items.push(event(`${bookingID}-first-checkout`, bookingID, "hotelCheckOut", firstCheckout, null, copy.checkout, hotelName(booking, firstCity), "door.left.hand.open", firstCityLabel));
      const transferStart = atSaudiLocal(switchDate, 11, 30);
      intercityTransferStart = transferStart;
      const haramain = Array.isArray(booking.includedServices) && booking.includedServices.includes("haramainTrain");
      const transferMinutes = haramain ? INTERCITY_HARAMAIN_DOOR_TO_DOOR_MINUTES : INTERCITY_ROAD_MINUTES;
      const transferEnd = addMinutes(transferStart, transferMinutes);
      const secondCity: SaudiCity = firstCity === "Madinah" ? "Makkah" : "Madinah";
      items.push(event(
        `${bookingID}-intercity`, bookingID, "intercityTransfer", transferStart, transferEnd,
        secondCity === "Makkah" ? copy.intercityMakkah : copy.intercityMadinah,
        haramain ? copy.haramain : copy.road,
        haramain ? "tram.fill" : "car.fill",
        cityName(copy, secondCity),
      ));
      const checkIn = localParts(transferEnd).hour * 60 + localParts(transferEnd).minute < STANDARD_CHECKIN_MINUTE
        ? atSaudiLocal(localDate(transferEnd), 15, 0)
        : transferEnd;
      items.push(event(`${bookingID}-second-checkin`, bookingID, "hotelCheckIn", checkIn, null, copy.checkIn, hotelName(booking, secondCity), "building.2.fill", cityName(copy, secondCity)));
      if (secondCity === "Makkah") makkahCheckInInstant = checkIn;
      else madinahCheckInInstant = checkIn;
    }
  }

  const finalAirportTransferStart = schedule.inbound
    ? addMinutes(parseInstant(schedule.inbound.departureAt)!, -(AIRPORT_CHECKIN_BUFFER_MINUTES + airportCityTransferMinutes(schedule.inbound.origin, stayPlan.lastCity)))
    : null;

  if (makkahCheckInInstant) {
    const umrahStart = comfortableUmrahStart(makkahCheckInInstant);
    const umrahEnd = addMinutes(umrahStart, 210);
    items.push(event(`${bookingID}-umrah`, bookingID, "umrah", umrahStart, umrahEnd, copy.umrah, copy.umrahBody, "moon.stars.fill", copy.makkah));
    if (booking.customization?.ziyaratMakkah !== false) {
      const boundary = firstCity === "Makkah" && intercityTransferStart ? intercityTransferStart : finalAirportTransferStart;
      const start = fitThreeHourActivity(umrahEnd, boundary, 480);
      if (start) {
        items.push(event(`${bookingID}-makkah-ziyarat`, bookingID, "makkahZiyarat", start, addMinutes(start, 180), copy.makkahZiyarat, copy.makkahBody, "building.columns.fill", copy.makkah));
      }
    }
  }

  if (madinahCheckInInstant && booking.customization?.ziyaratMadinah !== false) {
    const boundary = firstCity === "Madinah" && intercityTransferStart ? intercityTransferStart : finalAirportTransferStart;
    const start = fitThreeHourActivity(madinahCheckInInstant, boundary, 360);
    if (start) {
      items.push(event(`${bookingID}-madinah-ziyarat`, bookingID, "madinahZiyarat", start, addMinutes(start, 180), copy.madinahZiyarat, copy.madinahBody, "building.columns.fill", copy.madinah));
    }
  }

  if (schedule.inbound) {
    const inboundDeparture = parseInstant(schedule.inbound.departureAt)!;
    const lastCity = stayPlan.lastCity;
    const lastCityLabel = cityName(copy, lastCity);
    const airportTransferStart = finalAirportTransferStart!;
    const checkoutDay = localDate(airportTransferStart);
    const standardCheckout = atSaudiLocal(checkoutDay, 12, 0);
    const pickupCheckout = addMinutes(airportTransferStart, -30);
    const checkout = pickupCheckout < standardCheckout ? pickupCheckout : standardCheckout;
    items.push(event(`${bookingID}-checkout`, bookingID, "hotelCheckOut", checkout, null, copy.checkout, hotelName(booking, lastCity), "door.left.hand.open", lastCityLabel));
    const airportArrival = addMinutes(airportTransferStart, airportCityTransferMinutes(schedule.inbound.origin, lastCity));
    items.push(event(`${bookingID}-airport-transfer`, bookingID, "airportTransfer", airportTransferStart, airportArrival, copy.airportTransfer, `${lastCityLabel} → ${schedule.inbound.origin}`, "car.fill", schedule.inbound.origin === "MED" ? copy.madinah : copy.jeddah));
    items.push(event(`${bookingID}-flight-home`, bookingID, "flightHome", inboundDeparture, null, copy.flightHome, `${schedule.inbound.origin} → ${schedule.inbound.destination}`, "airplane.departure", schedule.inbound.origin === "MED" ? copy.madinah : copy.jeddah));
  }

  items.sort((a, b) => a.dateLocal === b.dateLocal ? a.sortOrder - b.sortOrder : a.dateLocal.localeCompare(b.dateLocal));
  return { stayPlan, items };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorizedBooking(request: Request, bookingID: string, env: Env): Promise<{ payload_json: string } | null> {
  if (!env.BOOKINGS_DB) return null;
  const bookingToken = String(request.headers.get("x-booking-token") ?? "").trim();
  if (bookingToken.length >= 24 && bookingToken.length <= 128) {
    const hash = await sha256Hex(bookingToken);
    const row = await env.BOOKINGS_DB.prepare(
      "SELECT payload_json FROM bookings WHERE id=?1 AND access_token_hash=?2 LIMIT 1",
    ).bind(bookingID, hash).first<{ payload_json: string }>();
    if (row) return row;
  }

  const auth = String(request.headers.get("authorization") ?? "").trim();
  if (!auth.toLowerCase().startsWith("bearer ") || !env.HOTELS_DB) return null;
  const accountToken = auth.slice(7).trim();
  if (!accountToken || accountToken.length > 256) return null;
  const hash = await sha256Hex(accountToken);
  const session = await env.HOTELS_DB.prepare(
    `SELECT pilgrim_id FROM iumrah_account_sessions
     WHERE token_hash=?1 AND revoked_at IS NULL AND expires_at>?2 LIMIT 1`,
  ).bind(hash, new Date().toISOString()).first<{ pilgrim_id: number }>();
  const pilgrimID = Number(session?.pilgrim_id ?? 0);
  if (!pilgrimID) return null;
  const owned = await env.HOTELS_DB.prepare(
    "SELECT booking_id FROM pilgrim_trips WHERE booking_id=?1 AND pilgrim_id=?2 LIMIT 1",
  ).bind(bookingID, pilgrimID).first<{ booking_id: string }>();
  if (!owned) return null;
  return env.BOOKINGS_DB.prepare("SELECT payload_json FROM bookings WHERE id=?1 LIMIT 1").bind(bookingID).first<{ payload_json: string }>();
}

export async function getBookingItineraryPlan(request: Request, bookingID: string, env: Env, url: URL): Promise<Response> {
  if (!env.BOOKINGS_DB) return json({ ok: false, error: "BOOKING_DB_NOT_CONFIGURED" }, 503);
  try {
    const row = await authorizedBooking(request, bookingID, env);
    if (!row) return json({ ok: false, error: "BOOKING_AUTH_INVALID" }, 401);
    const booking = bookingObject(row.payload_json);
    const planned = buildBookingItinerary(bookingID, booking, url.searchParams.get("lang"));
    return json({ ok: true, bookingID, timezone: SAUDI_TZ, stayPlan: planned.stayPlan, items: planned.items });
  } catch (error) {
    console.error("booking-itinerary-plan-failed", bookingID, error);
    return json({ ok: false, error: error instanceof Error ? error.message : "ITINERARY_PLAN_FAILED" }, 500);
  }
}
