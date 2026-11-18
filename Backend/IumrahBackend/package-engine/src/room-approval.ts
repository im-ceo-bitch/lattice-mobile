import type { Env } from './env';
import type { NuiteePackageRoom } from './nuitee-hotels';
import type { PricingTravelers } from './pricing';
export type RoomApproval = {packageID:string;revision:number};
// Approval alone is not inventory: only production, freshly prebooked supplier rooms
// for the identical approved hotel/date/party scope can lift the normal adult limit.
export function roomApprovalMatches(saved:any, request:any, travelers:PricingTravelers, rooms:NuiteePackageRoom[]):boolean {
  const t=saved?.input?.travelers, stay=saved?.stay, sel=saved?.selection;
  if(!t||!stay||!sel||request?.adults!==travelers.adults||request?.rooms!==travelers.rooms||travelers.adults<=travelers.rooms*5) return false;
  if(['adults','children','infants'].some(key=>t[key]!==travelers[key as keyof PricingTravelers])) return false;
  if(rooms.length!==travelers.rooms*(saved.input.includeMadinah?2:1)||rooms.some(r=>r.tariffSource!=='production'||!r.prebookId))return false;
  return rooms.every(r=>r.city==='makkah'?r.hotelId===sel.makkahHotelId&&r.checkin===stay.makkahCheckIn&&r.checkout===stay.makkahCheckOut:r.city==='madinah'&&saved.input.includeMadinah&&r.hotelId===sel.madinahHotelId&&r.checkin===stay.madinahCheckIn&&r.checkout===stay.madinahCheckOut);
}
async function hash(token:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('client-saved-package:v1:'+token));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}
export async function findRoomApproval(request:Request,env:Env,travelers:PricingTravelers,rooms:NuiteePackageRoom[]):Promise<RoomApproval|null>{
  const id=request.headers.get('x-package-id')||'', token=request.headers.get('x-package-owner')||'';
  if(!env.BOOKINGS_DB||!/^PKG-[A-F0-9-]{36}$/.test(id)||!/^\w{64}$/.test(token)||!(/^[a-f0-9]{64}$/.test(token)))return null;
  const rows=await env.BOOKINGS_DB.prepare("SELECT r.revision,r.adults,r.rooms,v.snapshot_json FROM business_offers o JOIN client_package_room_requests r ON r.package_id=o.id JOIN client_saved_package_versions v ON v.package_id=r.package_id AND v.revision=r.revision WHERE o.id=? AND o.request_hash=? AND o.source='client' AND o.state='active' AND r.state='approved' ORDER BY r.revision DESC LIMIT 20").bind(id,await hash(token)).all<{revision:number;adults:number;rooms:number;snapshot_json:string}>();
  for(const row of rows.results||[]){if(roomApprovalMatches(JSON.parse(row.snapshot_json),row,travelers,rooms))return {packageID:id,revision:row.revision};}
  return null;
}
export async function verifyRoomApproval(env:Env,approval:RoomApproval,travelers:PricingTravelers,rooms:NuiteePackageRoom[]){
 if(!env.BOOKINGS_DB)return false;
 const row=await env.BOOKINGS_DB.prepare("SELECT r.adults,r.rooms,v.snapshot_json FROM business_offers o JOIN client_package_room_requests r ON r.package_id=o.id JOIN client_saved_package_versions v ON v.package_id=r.package_id AND v.revision=r.revision WHERE o.id=? AND r.revision=? AND o.source='client' AND o.state IN ('active','converted') AND r.state='approved'").bind(approval.packageID,approval.revision).first<{adults:number;rooms:number;snapshot_json:string}>();
 return !!row&&roomApprovalMatches(JSON.parse(row.snapshot_json),row,travelers,rooms);
}
