import {createHash} from 'node:crypto';
export function resourceFingerprint(account,dbs,buckets){
 const canonical=[String(account||'').toLowerCase(),...['HOTELS_DB','BOOKINGS_DB','FLIGHTS_DB'].map(k=>String(dbs[k]||'').toLowerCase()),...['HOTELS_MEDIA','PASSPORTS'].map(k=>String(buckets[k]||''))];
 return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
