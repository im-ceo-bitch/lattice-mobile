// Ported from iumrah-web-main 5.zip: lib/domain.ts
import { requestEnv, backendFetch } from "../runtime.js";
export const languages = ["ru", "uz", "uz-cyrl", "en", "tr", "id", "ms"];
export const defaultLanguage = "ru";
export function isLanguage(value) {
    return languages.includes(value);
}
export function travelerCount(travelers) {
    return travelers.adults + travelers.children + travelers.infants;
}
export function isIsoDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
export function isTripInput(value) {
    if (!value || typeof value !== "object")
        return false;
    const input = value;
    const travelers = input.travelers;
    if (!travelers)
        return false;
    const integer = (item, min, max) => typeof item === "number" && Number.isInteger(item) && item >= min && item <= max;
    return (typeof input.from === "string" &&
        input.from.trim().length >= 2 &&
        input.from.trim().length <= 80 &&
        isIsoDate(input.startDate) &&
        isIsoDate(input.endDate) &&
        input.endDate > input.startDate &&
        (input.originCode === undefined || /^[A-Z]{3}$/.test(input.originCode)) &&
        (input.arrivalAirportCode === undefined || input.arrivalAirportCode === "JED" || input.arrivalAirportCode === "MED") &&
        (input.cabinClass === undefined || input.cabinClass === "economy" || input.cabinClass === "business") &&
        (input.preferredPlan === undefined || input.preferredPlan === "economy" || input.preferredPlan === "standard" || input.preferredPlan === "comfort" || input.preferredPlan === "luxury") &&
        (input.stayPreference === undefined || input.stayPreference === "value" || input.stayPreference === "near" || input.stayPreference === "walkable") &&
        (input.flexibleDays === 0 || input.flexibleDays === 1 || input.flexibleDays === 2 || input.flexibleDays === 3) &&
        (input.hotelPreference === "1" || input.hotelPreference === "2" || input.hotelPreference === "3" || input.hotelPreference === "4" || input.hotelPreference === "5") &&
        typeof input.includeMadinah === "boolean" &&
        integer(travelers.adults, 1, 9) &&
        integer(travelers.children, 0, 8) &&
        integer(travelers.infants, 0, 8) &&
        integer(travelers.rooms, 1, 9) &&
        travelers.adults + travelers.children + travelers.infants <= 9 &&
        travelers.infants <= travelers.adults);
}
