export type PackageTier = "economy" | "standard" | "comfort" | "luxury";
export type TripType = "roundTrip" | "oneWay";
export type TransferVehicle = "malibu" | "carnival" | "yukon" | null;

export type PricingTravelers = { adults: number; children: number; infants: number; rooms: number };
export type PricingMeals = { makkahLunch: boolean; makkahDinner: boolean; madinahDinner: boolean };

export type VerifiedJourneyFare = {
  candidateId: string;
  amount: number;
  currency: "USD";
  fareScope: "totalParty" | "perPassenger";
  providerId: string;
  observedAt: string;
  travelDate: string;
  normalizedGroupUsd: number;
};

export type PricingHotelInput = {
  amountUsd: number;
  unit: "perRoomNight";
  nights: number;
  hotelId: string;
  roomId: string | null;
  pricingMode: string;
};

export type GeneratorPricingSnapshot = {
  nuiteeRooms?: import("./nuitee-hotels").NuiteePackageRoom[];
  bookingAllowed?: boolean;
  quoteId: string;
  pricingVersion: string;
  currency: "USD";
  context: {
    tier: PackageTier;
    tripType: TripType;
    includeMadinah: boolean;
    totalDays: number;
    travelers: PricingTravelers;
    roomCount: number;
    vehicleCount: number;
  };
  selectedPricingInputs: {
    journeyFare: VerifiedJourneyFare;
    outbound: null;
    inbound: null;
    makkahHotel: PricingHotelInput;
    madinahHotel: PricingHotelInput | null;
  };
  components: Array<{ code: string; label: string; supplierCostUsd: number }>;
  totals: {
    supplierCostUsd: number;
    markupRate: number;
    markupAmountUsd: number;
    subtotalAfterMarkupUsd: number;
    paymentFeeRate: number;
    paymentFeeAmountUsd: number;
    calculatedSellingPriceUsd: number;
    publicPricePerPilgrimUsd: number;
    publicTotalUsd: number;
    roundingDifferenceUsd: number;
    estimatedProfitUsd: number;
  };
};

export type ServerQuoteInput = {
  tier: PackageTier;
  tripType: TripType;
  includeMadinah: boolean;
  travelers: PricingTravelers;
  meals: PricingMeals;
  transferVehicle: TransferVehicle;
  includeHaramainTrain: boolean;
  haramainFareClass: "economy" | "business";
  haramainTicketCount: number;
  journeyFare: VerifiedJourneyFare;
  makkahHotel: PricingHotelInput;
  madinahHotel: PricingHotelInput | null;
};

export type CalculatedPackageQuote = {
  totalPackagePrice: number;
  pricePerPerson: number;
  currency: "USD";
  isEstimated: true;
  quoteId: string;
  snapshot: GeneratorPricingSnapshot;
};

const STANDARD_MARKUP = 0.25;
const LUXURY_MARKUP = 0.35;
const PAYMENT_FEE = 0.02;
const ROUNDING_STEP = 5;
const ECONOMY_STANDARD_MEAL = 15;
const COMFORT_OPTIONAL_MEAL = 30;
const LUXURY_OPTIONAL_MEAL = 50;
const VISA = 120;
const MAKKAH_ZIYARAT = 100;
const MADINAH_ZIYARAT = 100;
const ACCOMPANIMENT_WITH_MADINAH = 300;
const ACCOMPANIMENT_MAKKAH_ONLY = 100;
const TRANSFER = 300;

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function publicRound(value: number) {
  return Math.max(ROUNDING_STEP, Math.round(value / ROUNDING_STEP) * ROUNDING_STEP);
}

function transferCapacity(vehicle: TransferVehicle) {
  if (vehicle === "malibu") return 3;
  if (vehicle === "carnival") return 7;
  if (vehicle === "yukon") return 6;
  return 3;
}

function transferLabel(vehicle: TransferVehicle) {
  if (vehicle === "malibu") return "Трансфер · Chevrolet Malibu";
  if (vehicle === "carnival") return "Трансфер · Kia Carnival";
  if (vehicle === "yukon") return "Трансфер · GMC Yukon";
  return "Трансферы";
}

function mealLabel(tier: PackageTier, includeMadinah: boolean, meals: PricingMeals) {
  if (tier === "economy" || tier === "standard") return "Питание";
  const values = ["завтрак включён"];
  if (meals.makkahLunch) values.push("Мекка: обед");
  if (meals.makkahDinner) values.push("Мекка: ужин");
  if (includeMadinah && meals.madinahDinner) values.push("Медина: ужин");
  return `Питание · ${values.join(" · ")}`;
}

function mealCost(input: ServerQuoteInput, totalDays: number, makkahNights: number, madinahNights: number) {
  const people = Math.max(0, input.travelers.adults + input.travelers.children);
  if (people === 0) return 0;
  if (input.tier === "economy" || input.tier === "standard") {
    return ECONOMY_STANDARD_MEAL * Math.max(1, totalDays) * people;
  }
  const unit = input.tier === "comfort" ? COMFORT_OPTIONAL_MEAL : LUXURY_OPTIONAL_MEAL;
  let total = 0;
  if (input.meals.makkahLunch) total += unit * Math.max(1, makkahNights) * people;
  if (input.meals.makkahDinner) total += unit * Math.max(1, makkahNights) * people;
  if (input.includeMadinah && input.meals.madinahDinner) total += unit * Math.max(0, madinahNights) * people;
  return total;
}

export function calculatePackageQuote(input: ServerQuoteInput): CalculatedPackageQuote {
  const travelers = input.travelers.adults + input.travelers.children + input.travelers.infants;
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 9) throw new Error("INVALID_TRAVELERS");
  if (!Number.isInteger(input.travelers.rooms) || input.travelers.rooms < 1 || input.travelers.rooms > 9) throw new Error("INVALID_ROOMS");
  if (input.includeMadinah && !input.madinahHotel) throw new Error("MADINAH_HOTEL_REQUIRED");
  if (!input.includeMadinah && input.madinahHotel) throw new Error("UNEXPECTED_MADINAH_HOTEL");

  const makkahNights = Math.max(1, input.makkahHotel.nights);
  const madinahNights = input.includeMadinah ? Math.max(0, input.madinahHotel?.nights ?? 0) : 0;
  const totalDays = Math.max(1, makkahNights + madinahNights + 1);
  const rooms = input.travelers.rooms;
  const vehicleCapacity = transferCapacity(input.transferVehicle);
  const vehicleCount = Math.max(1, Math.ceil(travelers / vehicleCapacity));

  const flights = input.journeyFare.fareScope === "perPassenger"
    ? input.journeyFare.amount * travelers
    : input.journeyFare.normalizedGroupUsd;
  if (!Number.isFinite(flights) || flights <= 0) throw new Error("INVALID_FLIGHT_FARE");

  const makkahHotelCost = input.makkahHotel.amountUsd * rooms * makkahNights;
  const madinahHotelCost = input.includeMadinah && input.madinahHotel
    ? input.madinahHotel.amountUsd * rooms * madinahNights
    : 0;
  const visa = VISA * travelers;
  const meals = mealCost(input, totalDays, makkahNights, madinahNights);
  const guide = input.includeMadinah ? ACCOMPANIMENT_WITH_MADINAH : ACCOMPANIMENT_MAKKAH_ONLY;
  const ziyarat = MAKKAH_ZIYARAT + (input.includeMadinah ? MADINAH_ZIYARAT : 0);
  const supplierCost = flights + makkahHotelCost + madinahHotelCost + visa + meals + TRANSFER + guide + ziyarat;
  if (!Number.isFinite(supplierCost) || supplierCost <= 0) throw new Error("INVALID_COMPONENTS");

  const markupRate = input.tier === "luxury" ? LUXURY_MARKUP : STANDARD_MARKUP;
  const markupAmount = supplierCost * markupRate;
  const subtotal = supplierCost + markupAmount;
  const calculatedBaseSelling = subtotal / (1 - PAYMENT_FEE);
  const roundedBasePerPerson = publicRound(calculatedBaseSelling / travelers);
  const roundedBaseTotal = roundedBasePerPerson * travelers;
  const vehicleUpgrade = input.transferVehicle === "yukon" && input.includeMadinah ? 750 : 0;
  const requestedTrainTickets = Math.max(0, Math.min(input.haramainTicketCount, input.travelers.adults + input.travelers.children));
  const trainSeat = input.haramainFareClass === "business" ? 200 : 150;
  const trainAddOn = input.includeMadinah && input.includeHaramainTrain ? requestedTrainTickets * trainSeat : 0;
  const publicAddOns = vehicleUpgrade + trainAddOn;
  const publicTotal = roundedBaseTotal + publicAddOns;
  const perPerson = publicTotal / travelers;
  const calculatedSelling = calculatedBaseSelling + publicAddOns;
  const paymentFeeAmount = calculatedBaseSelling - subtotal;
  const roundingDifference = publicTotal - calculatedSelling;
  const estimatedProfit = roundedBaseTotal - supplierCost - paymentFeeAmount;
  const quoteId = `server-${crypto.randomUUID().toLowerCase()}`;

  const components: GeneratorPricingSnapshot["components"] = [
    { code: input.tripType === "roundTrip" ? "flight_roundtrip" : "flight_outbound", label: input.tripType === "roundTrip" ? "Авиаперелёт туда-обратно" : "Авиабилет туда", supplierCostUsd: money(flights) },
    { code: "makkah_hotel", label: "Отель в Мекке", supplierCostUsd: money(makkahHotelCost) },
  ];
  if (input.includeMadinah) components.push({ code: "madinah_hotel", label: "Отель в Медине", supplierCostUsd: money(madinahHotelCost) });
  components.push(
    { code: "visa", label: "Визы", supplierCostUsd: money(visa) },
    { code: "meals", label: mealLabel(input.tier, input.includeMadinah, input.meals), supplierCostUsd: money(meals) },
    { code: "transfers", label: transferLabel(input.transferVehicle), supplierCostUsd: TRANSFER },
  );
  if (vehicleUpgrade > 0) components.push({ code: "vip_transfer_upgrade", label: "GMC Yukon · VIP upgrade (+$750 public)", supplierCostUsd: 0 });
  if (trainAddOn > 0) components.push({ code: "haramain_train_addon", label: `Поезд Haramain · public add-on +$${money(trainAddOn)}`, supplierCostUsd: 0 });
  components.push({ code: "accompaniment", label: "Сопровождение", supplierCostUsd: guide });
  components.push({ code: "ziyarat_makkah", label: "Зиярат в Мекке", supplierCostUsd: MAKKAH_ZIYARAT });
  if (input.includeMadinah) components.push({ code: "ziyarat_madinah", label: "Зиярат в Медине", supplierCostUsd: MADINAH_ZIYARAT });
  components.push({ code: "care", label: "iumrah Care", supplierCostUsd: 0 });

  const snapshot: GeneratorPricingSnapshot = {
    quoteId,
    pricingVersion: "server-expedia-package-v9",
    currency: "USD",
    context: {
      tier: input.tier,
      tripType: input.tripType,
      includeMadinah: input.includeMadinah,
      totalDays,
      travelers: input.travelers,
      roomCount: rooms,
      vehicleCount,
    },
    selectedPricingInputs: {
      journeyFare: { ...input.journeyFare, normalizedGroupUsd: money(flights) },
      outbound: null,
      inbound: null,
      makkahHotel: input.makkahHotel,
      madinahHotel: input.includeMadinah ? input.madinahHotel : null,
    },
    components,
    totals: {
      supplierCostUsd: money(supplierCost),
      markupRate,
      markupAmountUsd: money(markupAmount),
      subtotalAfterMarkupUsd: money(subtotal),
      paymentFeeRate: PAYMENT_FEE,
      paymentFeeAmountUsd: money(paymentFeeAmount),
      calculatedSellingPriceUsd: money(calculatedSelling),
      publicPricePerPilgrimUsd: money(perPerson),
      publicTotalUsd: money(publicTotal),
      roundingDifferenceUsd: money(roundingDifference),
      estimatedProfitUsd: money(estimatedProfit),
    },
  };

  return {
    totalPackagePrice: snapshot.totals.publicTotalUsd,
    pricePerPerson: snapshot.totals.publicPricePerPilgrimUsd,
    currency: "USD",
    isEstimated: true,
    quoteId,
    snapshot,
  };
}

export type StorefrontPreviewQuoteInput = {
  tier: PackageTier;
  travelers: number;
  rooms: number;
  flightFarePerTravelerUsd: number;
  hotelNightlyUsd: number;
  hotelNights: number;
};

/**
 * Server-only undated hotel-card preview. This preserves the existing storefront
 * number exactly, but keeps markup/payment/service arithmetic out of iOS/Web.
 * It is display-only; a dated configurator always requests /api/package/quote
 * before a booking can be finalized.
 */
export function calculateStorefrontPreviewQuote(input: StorefrontPreviewQuoteInput) {
  const travelers = Math.max(1, Math.trunc(input.travelers));
  const rooms = Math.max(1, Math.trunc(input.rooms));
  const nights = Math.max(1, Math.trunc(input.hotelNights));
  if (travelers > 9 || rooms > 9 || !Number.isFinite(input.flightFarePerTravelerUsd) || input.flightFarePerTravelerUsd <= 0 ||
      !Number.isFinite(input.hotelNightlyUsd) || input.hotelNightlyUsd <= 0) {
    throw new Error("INVALID_STOREFRONT_COMPONENTS");
  }

  const flights = input.flightFarePerTravelerUsd * travelers;
  const hotel = input.hotelNightlyUsd * rooms * nights;
  const visa = VISA * travelers;
  const meals = input.tier === "economy" || input.tier === "standard"
    ? ECONOMY_STANDARD_MEAL * (nights + 1) * travelers
    : 0;
  const supplierCost = flights + hotel + visa + meals + TRANSFER + ACCOMPANIMENT_WITH_MADINAH + MAKKAH_ZIYARAT + MADINAH_ZIYARAT;
  if (!Number.isFinite(supplierCost) || supplierCost <= 0) throw new Error("INVALID_STOREFRONT_COMPONENTS");

  const markupRate = input.tier === "luxury" ? LUXURY_MARKUP : STANDARD_MARKUP;
  const subtotal = supplierCost * (1 + markupRate);
  const calculatedSelling = subtotal / (1 - PAYMENT_FEE);
  const pricePerPerson = publicRound(calculatedSelling / travelers);
  const totalPackagePrice = pricePerPerson * travelers;
  return {
    totalPackagePrice: money(totalPackagePrice),
    pricePerPerson: money(pricePerPerson),
    currency: "USD" as const,
    isEstimated: true as const,
    quoteId: `storefront-server-${crypto.randomUUID().toLowerCase()}`,
  };
}
