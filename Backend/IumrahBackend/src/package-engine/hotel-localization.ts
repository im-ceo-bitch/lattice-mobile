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
