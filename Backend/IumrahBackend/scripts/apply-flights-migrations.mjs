// Called by the already-existing `npm run deploy` step. No workflow changes.
// Fail closed: never deploy schema-dependent code after a failed FLIGHTS_DB migration.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const config = new URL('../wrangler.generated.jsonc', import.meta.url);
if (!fs.existsSync(config)) throw Error('Run npm run render before deploying');
const parsed=JSON.parse(fs.readFileSync(config,'utf8'));
if(parsed.name!=='iumrah-backend'||!parsed.d1_databases?.some(d=>d.binding==='FLIGHTS_DB'&&d.database_name==='iumrah-flights'))throw Error('UNEXPECTED_TARGET: FLIGHTS_DB binding must be iumrah-flights');
for(const file of ['0001_flight_hub.sql','0002_fare_reconciliation.sql','0003_monitor_task_checks.sql','0004_itinerary_catalog.sql','0005_catalog_sources.sql','0006_catalog_route_guard.sql']) {
 const source=fileURLToPath(new URL(`../../FlightHubWorker/migrations/${file}`,import.meta.url));
 console.log(`Applying additive FLIGHTS_DB schema ${file}`);
 const r=spawnSync('npx',['wrangler','d1','execute','FLIGHTS_DB','--remote','--file',source,'--config',fileURLToPath(config)],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url)),shell:false});
 if(r.status!==0) throw Error(`FLIGHTS_DB_MIGRATION_FAILED:${file}:${r.status}`);
}
