import {chatScope,chatScopeSQL,chatScopeVersion} from "./care-identity.js";
// Booking authorization must be completed by the caller before using this module.
export async function incrementalChatPage(db, bookingID, url) {
  const params = new URL(url).searchParams;
  const raw = params.get('after');
  if (raw === null) return null; // legacy clients retain their existing contract
  if (!/^\d{1,15}$/.test(raw)) throw new Error('INVALID_CHAT_CURSOR');
  const scope=typeof bookingID==='string'?chatScope(bookingID):bookingID;
  const q=chatScopeSQL(scope);
  const scopeVersion=await chatScopeVersion(db,scope);
  const reset=scope.pilgrimID && params.get('scope')!==scopeVersion && (params.has('scope')||raw==='0'||new URL(url).pathname.includes('/client/chats/account/'));
  const after = reset?0:Number(raw);
  if (!Number.isSafeInteger(after)) throw new Error('INVALID_CHAT_CURSOR');
  const result = await db.prepare(`SELECT rowid AS chat_cursor, * FROM business_chat_messages
    WHERE ${q.sql} AND rowid>? ORDER BY rowid ASC LIMIT 201`).bind(...q.args, after).all();
  const rows = result.results || [];
  const hasMore = rows.length > 200;
  const page = rows.slice(0,200);
  const nextCursor = page.length ? String(page[page.length-1].chat_cursor) : String(after);
  const ids = [...new Set(params.getAll('unread').filter(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id)))].slice(0,80);
  let staffReadMessageIDs = [];
  if (ids.length) {
    const read = await db.prepare(`SELECT id FROM business_chat_messages WHERE ${q.sql} AND sender_type='client' AND read_by_staff=1 AND id IN (${ids.map(()=>'?').join(',')})`).bind(...q.args,...ids).all();
    staffReadMessageIDs = (read.results || []).map(row=>row.id);
  }
  return {page,nextCursor,hasMore,staffReadMessageIDs,scopeVersion,reset:!!reset};
}
