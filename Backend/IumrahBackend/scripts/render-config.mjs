// Explicit configuration. Never guesses production bindings, changes existing
// routes by default, creates databases, or deploys without an operator action.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uuid = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value || '');
const truthy = value => value === '1' || value === 'true';
export function buildConfig(env = process.env) {
  const dbs = [
    ['HOTELS_DB','HOTELS_DB_ID',env.HOTELS_DB_NAME || 'iumrah-hotels','../HotelsWorker/migrations'],
    ['BOOKINGS_DB','BOOKINGS_DB_ID',env.BOOKINGS_DB_NAME,'../CoreMigration/migrations'],
    ['FLIGHTS_DB','FLIGHTS_DB_ID',env.FLIGHTS_DB_NAME || 'iumrah-flights','../FlightHubWorker/migrations']
  ];
  for (const [binding,key,name] of dbs) {
    if (!uuid(env[key])) throw Error(`${key} must be the UUID of the existing ${binding} D1 database; never create a replacement`);
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw Error(`Invalid database name for ${binding}: set BOOKINGS_DB_NAME`);
  }
  const ids = dbs.map(([,key])=>env[key].toLowerCase());
  if (new Set(ids).size !== ids.length) throw Error('D1 database bindings must be three DISTINCT UUIDs');
  const bucket = env.HOTELS_MEDIA_BUCKET || 'none';
  if (bucket !== 'none' && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)) throw Error('HOTELS_MEDIA_BUCKET_INVALID');
  const routesEnabled = truthy(env.IUMRAH_ENABLE_ROUTE_CUTOVER);
  const cronEnabled = truthy(env.IUMRAH_ENABLE_SCHEDULED_JOBS);
  if (routesEnabled && !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ZONE_ID || '')) throw Error('CLOUDFLARE_ZONE_ID_REQUIRED_FOR_CUTOVER');
  const zoneID = env.CLOUDFLARE_ZONE_ID;
  const patterns = [
    'iumrah.app/api/admin/ziyarats*', 'iumrah.app/api/catalog/ziyarats*',
    'iumrah.app/api/admin/hotels*', 'iumrah.app/api/catalog/hotels*',
    'iumrah.app/flights-feed/*',
    'iumrah.app/.well-known/oauth-protected-resource*',
    'iumrah.app/.well-known/oauth-authorization-server*',
    'iumrah.app/api/flight-hub*'
  ];
  const config = {
    $schema:'./node_modules/wrangler/config-schema.json',
    name:'iumrah-backend',
    main:'src/index.js',
    compatibility_date:'2026-11-10',
    compatibility_flags:['nodejs_compat'],
    workers_dev:true,
    keep_vars:true,
    routes: routesEnabled ? patterns.map(pattern=>({pattern,zone_id:zoneID})) : [],
    triggers:{crons:cronEnabled ? ['15 1 * * *','0 3 * * *'] : []},
    d1_databases: dbs.map(([binding,key,database_name,migrations_dir])=>({binding,database_name,database_id:env[key],...(binding==='BOOKINGS_DB'?{}:{migrations_dir})})),
    r2_buckets:bucket==='none'?[]:[{binding:'HOTELS_MEDIA',bucket_name:bucket}],
    ai:{binding:'AI'},
    browser:{binding:'BROWSER'},
    images:{binding:'IMAGES'},
    workflows:[{name:'iumrah-backend-hotel-import',binding:'HOTEL_IMPORT_WORKFLOW',class_name:'HotelImportWorkflow'}],
    vars:{
      APPLE_BUNDLE_ID: 'com.iumrah.app',
      GOOGLE_SERVER_CLIENT_ID: env.GOOGLE_SERVER_CLIENT_ID || '863185716777-8tec2kuch1qkra1f1coikpi20j6is65f.apps.googleusercontent.com',
      IUMRAH_PUBLIC_ID_ORIGIN: 'https://iumrah.app',
      ACCOUNT_EMAIL_FROM: env.ACCOUNT_EMAIL_FROM || 'security@iumrah.app',
      ACCOUNT_EMAIL_REPLY_TO: env.ACCOUNT_EMAIL_REPLY_TO || 'support@iumrah.app',
      APPLE_TEAM_ID:env.APPLE_TEAM_ID || 'HVT4U96286',
      IGNAV_MONTHLY_REQUEST_BUDGET:env.IGNAV_MONTHLY_REQUEST_BUDGET || '6000',
      INTELLIGENCE_REPORT_CADENCE_DAYS:env.INTELLIGENCE_REPORT_CADENCE_DAYS || '1',
      AUTH_SESSION_URL:env.AUTH_SESSION_URL || 'https://iumrah.app/api/auth/staff/session',
      BOOKINGS_ADMIN_URL:env.BOOKINGS_ADMIN_URL || 'https://iumrah.app/api/admin/bookings',
      BOOKINGS_PUBLIC_URL:env.BOOKINGS_PUBLIC_URL || 'https://iumrah.app/api/bookings'
    }
  };
  return config;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const cfg = buildConfig();
    const target = new URL('../wrangler.generated.jsonc',import.meta.url);
    fs.writeFileSync(target,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});
    console.log(`Generated ${fileURLToPath(target)}: Worker=${cfg.name}, routes=${cfg.routes.length}, crons=${cfg.triggers.crons.length}`);
    console.log('No deployment, routing, database migration or secret changes were performed.');
  } catch (error) { console.error('CONFIG_REJECTED:',error.message); process.exitCode=1; }
}
