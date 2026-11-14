// A conversation is an authenticated pilgrim, or an unclaimed booking. Historical
// booking messages stay in place; account access is derived from current ownership.
export const accountChatKey = id => `care-pilgrim:${Number(id)}`;
export const accountIDFromChatKey = key => /^care-pilgrim:[1-9]\d{0,7}$/.test(key) ? Number(key.slice(13)) : null;
export function chatScope(key, pilgrimID = null) {
  return pilgrimID ? {key:accountChatKey(pilgrimID),pilgrimID:Number(pilgrimID)} : {key,pilgrimID:null};
}
export function chatScopeSQL(scope, column='booking_id') {
  return scope.pilgrimID ? {sql:`(${column}=? OR ${column} IN (SELECT booking_id FROM pilgrim_trips WHERE pilgrim_id=?))`,args:[scope.key,scope.pilgrimID]} : {sql:`${column}=?`,args:[scope.key]};
}
export async function staffChatScope(db,key) {
  const direct=accountIDFromChatKey(key);
  if(direct){const row=await db.prepare('SELECT pilgrim_id FROM iumrah_accounts WHERE pilgrim_id=?').bind(direct).first();return row?chatScope(key,direct):null;}
  const row=await db.prepare('SELECT t.pilgrim_id,a.pilgrim_id AS account_id FROM pilgrim_trips t LEFT JOIN iumrah_accounts a ON a.pilgrim_id=t.pilgrim_id WHERE t.booking_id=?').bind(key).first();
  if(row) return chatScope(key,row.account_id||null);
  // Preserve staff access to old booking threads, but do not create arbitrary threads.
  const old=await db.prepare('SELECT booking_id FROM business_chat_threads WHERE booking_id=?').bind(key).first();
  return old?chatScope(key):null;
}
export async function chatScopeVersion(db,scope) {
  if(!scope.pilgrimID)return 'booking-v1';
  const rows=await db.prepare('SELECT booking_id FROM pilgrim_trips WHERE pilgrim_id=? ORDER BY booking_id').bind(scope.pilgrimID).all();
  const bytes=new TextEncoder().encode(JSON.stringify([scope.key,...(rows.results||[]).map(r=>r.booking_id)]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
// Account push targets must have a live session, not merely a historical booking token.
export async function carePushTargets(db,key,bundle,now=new Date().toISOString()) {
  const direct=accountIDFromChatKey(key);
  const scope=direct?chatScope(key,direct):await staffChatScope(db,key);
  if(scope?.pilgrimID){
    const rows=await db.prepare(`SELECT d.device_token,d.environment,d.app_bundle_id,d.locale,d.installation_id
      FROM client_notification_devices d JOIN iumrah_account_sessions s ON s.token_hash=d.account_session_hash AND s.pilgrim_id=d.pilgrim_id
      WHERE d.pilgrim_id=? AND d.is_authenticated=1 AND d.enabled=1 AND d.app_bundle_id=? AND d.device_token IS NOT NULL
      AND s.revoked_at IS NULL AND s.expires_at>? ORDER BY d.updated_at DESC LIMIT 50`).bind(scope.pilgrimID,bundle,now).all();
    return {scope,rows:rows.results||[]};
  }
  const rows=await db.prepare(`SELECT s.device_token,s.environment,s.app_bundle_id,s.locale,NULL AS installation_id
    FROM client_push_subscriptions s WHERE s.booking_id=? AND s.enabled=1 AND s.app_bundle_id=?
    AND NOT EXISTS (SELECT 1 FROM client_notification_devices d WHERE d.device_token=s.device_token AND d.is_authenticated=1)
    ORDER BY s.updated_at DESC LIMIT 50`).bind(key,bundle).all();
  return {scope:scope||chatScope(key),rows:rows.results||[]};
}
export async function persistCarePushResult(db,device,key,result,now=new Date().toISOString()) {
  if(device.installation_id){
    if(result.ok) await db.prepare('UPDATE client_notification_devices SET last_success_at=?,last_error=NULL WHERE installation_id=? AND device_token=?').bind(now,device.installation_id,device.device_token).run();
    else if(result.response) await db.prepare('UPDATE client_notification_devices SET enabled=?,last_error=? WHERE installation_id=? AND device_token=?').bind(result.disable?0:1,String(result.error||'').slice(0,900),device.installation_id,device.device_token).run();
  }else{
    if(result.ok) await db.prepare('UPDATE client_push_subscriptions SET last_success_at=?,last_error=NULL WHERE device_token=? AND booking_id=?').bind(now,device.device_token,key).run();
    else if(result.response) await db.prepare('UPDATE client_push_subscriptions SET enabled=?,last_error=? WHERE device_token=? AND booking_id=?').bind(result.disable?0:1,String(result.error||'').slice(0,900),device.device_token,key).run();
  }
}
