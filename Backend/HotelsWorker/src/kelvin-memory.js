// Canonical, owner-scoped memory. Only Kelvin tables are mutated.
export const memorySchema=[`CREATE TABLE IF NOT EXISTS kelvin_memory_records (
 owner TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,
 trust TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,cutoff_seq INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner,id))`, `CREATE INDEX IF NOT EXISTS kelvin_records_owner ON kelvin_memory_records(owner,deleted,id)`,
 `CREATE TABLE IF NOT EXISTS kelvin_memory_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,id TEXT NOT NULL,action TEXT NOT NULL,version INTEGER NOT NULL,at INTEGER NOT NULL)`,
 `CREATE TRIGGER IF NOT EXISTS kelvin_memory_insert_audit AFTER INSERT ON kelvin_memory_records BEGIN
 INSERT INTO kelvin_memory_audit(owner,id,action,version,at) VALUES(NEW.owner,NEW.id,'save',NEW.version,NEW.updated_at); END`,
 `CREATE TRIGGER IF NOT EXISTS kelvin_memory_update_audit AFTER UPDATE ON kelvin_memory_records BEGIN
 INSERT INTO kelvin_memory_audit(owner,id,action,version,at) VALUES(NEW.owner,NEW.id,CASE WHEN NEW.deleted=1 THEN 'delete' WHEN OLD.trust='candidate' AND NEW.trust='owner' THEN 'confirm' ELSE 'correct' END,NEW.version,NEW.updated_at);
 DELETE FROM kelvin_memory WHERE owner=NEW.owner AND id=NEW.id; END`];
const kinds=new Set(['personal','business','episodic','decision','task','research']); // customer deliberately excluded
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(x);
export const secretLike=x=>/\b\d{6,}:[A-Za-z0-9_-]{20,}|sk-(?:ant-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+|\b[a-f0-9]{64}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(x);
const rows=async s=>(await s.all()).results||[];
export async function migrateMemory(db,owner){
 // Never resurrect a deleted record; migration is scoped to the authenticated owner.
 await db.prepare(`INSERT OR IGNORE INTO kelvin_memory_records(owner,id,kind,content,trust,source,created_at,updated_at)
 SELECT owner,id,'personal',content,'owner','legacy-note',created_at,created_at FROM kelvin_memory WHERE owner=?`).bind(owner).run();
}
export async function memoryContext(db,owner){
 await migrateMemory(db,owner);
 const cutoff=await db.prepare('SELECT COALESCE(MAX(cutoff_seq),0) AS n FROM kelvin_memory_records WHERE owner=?').bind(owner).first();
 const records=await rows(db.prepare(`SELECT id,kind,content,trust,source,created_at,updated_at,version FROM kelvin_memory_records WHERE owner=? AND deleted=0 ORDER BY updated_at DESC,id LIMIT 1001`).bind(owner));
 if(records.length>1000)throw new Error('MEMORY_CAPACITY');
 return {records,cutoff:Number(cutoff.n)};
}
export async function memoryAction(db,owner,action,b,source,tokenHash=null){
 await migrateMemory(db,owner);
 if(action==='list'){
  const after=b?.after??'';if(typeof after!=='string'||after.length>100)return [400,{error:'INVALID_CURSOR'}];
  const list=await rows(db.prepare('SELECT id,kind,content,trust,source,created_at,updated_at,version FROM kelvin_memory_records WHERE owner=? AND deleted=0 AND id>? ORDER BY id LIMIT 51').bind(owner,after));
  return [200,{records:list.slice(0,50),next:list.length>50?list[49].id:null}];
 }
 if(!validId(b?.id))return [400,{error:'INVALID_MEMORY_ID'}];
 const prior=await db.prepare('SELECT * FROM kelvin_memory_records WHERE owner=? AND id=?').bind(owner,b.id).first();
 if(action==='save'||action==='correct'||action==='candidate'){
  if(!kinds.has(b.kind)||typeof b.content!=='string'||!b.content.trim()||new TextEncoder().encode(b.content).length>2000||secretLike(b.content))return [400,{error:'INVALID_MEMORY'}];
 }
 if(['save','candidate'].includes(action)&&prior)return prior.deleted||prior.content!==b.content.trim()||prior.kind!==b.kind?[409,{error:'MEMORY_ID_CONFLICT'}]:[200,{id:prior.id,version:prior.version}];
 if(!['save','correct','delete','candidate','confirm'].includes(action))return [404,{error:'NOT_FOUND'}];
 if(!['save','candidate'].includes(action)&&(!prior||prior.deleted))return [404,{error:'MEMORY_NOT_FOUND'}];
 if(!['save','candidate'].includes(action)&&(!Number.isSafeInteger(b.version)||prior.version!==b.version))return [409,{error:'MEMORY_VERSION_CONFLICT'}];
 // Mutations during an active inference are refused, except for that worker's own
 // explicitly claimed memory command. The claim lease is verified, not model-controlled.
 const t=Date.now();let job=null;
 if(source==='worker'&&b.job){job=await db.prepare("SELECT request_id,source,prompt FROM kelvin_turns WHERE owner=? AND request_id=? AND lease=? AND status='running' AND lease_until>?").bind(owner,b.job,b.lease,t).first();if(!job)return [409,{error:'LEASE_LOST'}];}
 if(action==='candidate'&&(!job||!['telegram','app'].includes(job.source)||!job.prompt.includes(b.content.trim())))return [403,{error:'CANDIDATE_SOURCE_REQUIRED'}];
 if(action==='confirm'&&prior.trust!=='candidate')return [409,{error:'NOT_A_CANDIDATE'}];
 // When a lease was provided it must still be current at the mutation itself.
 // Token revocation/rotation fences the write at the SQL statement, not just before it.
 let guard=`NOT EXISTS(SELECT 1 FROM kelvin_turns WHERE owner=? AND status='running' AND lease_until>? AND NOT(request_id=COALESCE(?, '') AND lease=COALESCE(?, '')))`;
 const args=[owner,t,job?.request_id??null,job?b.lease:null];
 if(tokenHash){guard+=' AND EXISTS(SELECT 1 FROM kelvin_links WHERE owner=? AND token_hash=?)';args.push(owner,tokenHash);}
 if(job){guard+=" AND EXISTS(SELECT 1 FROM kelvin_turns WHERE owner=? AND request_id=? AND lease=? AND status='running' AND lease_until>?)";args.push(owner,job.request_id,b.lease,t);}
 const provenance=job?`${job.source}:${job.request_id}`:source;
 let stmt;
 if(['save','candidate'].includes(action))stmt=db.prepare(`INSERT INTO kelvin_memory_records(owner,id,kind,content,trust,source,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} AND (SELECT COUNT(*) FROM kelvin_memory_records WHERE owner=?)<1000 ON CONFLICT(owner,id) DO NOTHING RETURNING version`).bind(owner,b.id,b.kind,b.content.trim(),action==='candidate'?'candidate':'owner',provenance,t,t,...args,owner);
 else stmt=db.prepare(`UPDATE kelvin_memory_records SET content=?,kind=?,trust=?,deleted=?,version=version+1,updated_at=?,cutoff_seq=CASE WHEN ?='confirm' THEN cutoff_seq ELSE (SELECT COALESCE(MAX(seq),0) FROM kelvin_turns WHERE owner=?) END WHERE owner=? AND id=? AND version=? AND deleted=0 AND ${guard} RETURNING version`).bind(action==='delete'?'':action==='confirm'?prior.content:b.content.trim(),['delete','confirm'].includes(action)?prior.kind:b.kind,action==='delete'?prior.trust:'owner',action==='delete'?1:0,t,action,owner,owner,b.id,b.version,...args);
 // SQLite triggers atomically persist a metadata-only audit and scrub the legacy row.
 const result=await stmt.first();if(!result)return [409,{error:'MEMORY_BUSY_OR_CONFLICT'}];
 return [200,{id:b.id,version:result.version}];
}
