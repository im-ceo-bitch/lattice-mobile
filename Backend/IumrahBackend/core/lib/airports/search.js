// Ported from iumrah-web-main 5.zip: lib/airports/search.ts
import { requestEnv, backendFetch } from "../../runtime.js";
import database from "../../data/airports.js";
const db = database;
const CYRILLIC_MAP = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
    я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h"
};
function transliterateCyrillic(value) {
    return Array.from(value.toLowerCase())
        .map((char) => CYRILLIC_MAP[char] ?? char)
        .join("");
}
export function normalizeAirportQuery(value) {
    const transliterated = transliterateCyrillic(value);
    return transliterated
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
function airportSearchText(airport) {
    return normalizeAirportQuery([
        airport.iata,
        airport.icao ?? "",
        airport.city,
        airport.name,
        airport.country,
        airport.countryCode,
        airport.region,
        ...airport.aliases,
    ].join(" "));
}
const prepared = db.airports.map((airport) => ({
    airport,
    text: airportSearchText(airport),
    city: normalizeAirportQuery(airport.city),
    name: normalizeAirportQuery(airport.name),
    country: normalizeAirportQuery(airport.country),
}));
function scoreMatch(query, airport, text, city, name) {
    const raw = query.toUpperCase();
    let score = 0;
    if (airport.iata === raw)
        score += 10000;
    if (airport.icao === raw)
        score += 9000;
    if (city === query)
        score += 5000;
    if (city.startsWith(query))
        score += 2500;
    if (name.startsWith(query))
        score += 1800;
    if (text.includes(` ${query} `) || text.startsWith(`${query} `) || text.endsWith(` ${query}`))
        score += 1200;
    if (text.includes(query))
        score += 500;
    if (airport.type === "large")
        score += 300;
    else if (airport.type === "medium")
        score += 150;
    score += Math.min(airport.score / 100, 250);
    return score;
}
export function searchAirports(input, limit = 8) {
    const query = normalizeAirportQuery(input);
    if (!query)
        return [];
    return prepared
        .map(({ airport, text, city, name }) => ({
        airport,
        score: scoreMatch(query, airport, text, city, name),
    }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.airport.iata.localeCompare(b.airport.iata))
        .slice(0, limit)
        .map((entry) => entry.airport);
}
export function getAirportByIata(iata) {
    const code = iata.trim().toUpperCase();
    return db.airports.find((airport) => airport.iata === code) ?? null;
}
export function isValidAirportSelection(value) {
    return Boolean(value?.iata && getAirportByIata(value.iata));
}
export function sameAirport(a, b) {
    return Boolean(a && b && a.iata === b.iata);
}
export const airportCount = db.meta.recordCount;
