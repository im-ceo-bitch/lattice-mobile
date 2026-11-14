// Operational booking identity, owned by HOTELS_DB. Never identify a user by unverified contact data.
export const ALLOCATE_BOOKING_NUMBER_SQL = `INSERT INTO booking_number_sequence(id,next_number)
VALUES(1, COALESCE((SELECT MAX(booking_number)+2 FROM pilgrim_trips),2))
ON CONFLICT(id) DO UPDATE SET next_number=MAX(booking_number_sequence.next_number+1,excluded.next_number)
RETURNING next_number-1 AS booking_number`;
export async function allocateBookingNumber(db) {
  const row=await db.prepare(ALLOCATE_BOOKING_NUMBER_SQL).first();
  const number=Number(row?.booking_number||0);
  if(!Number.isSafeInteger(number)||number<=0)throw Error('BOOKING_NUMBER_ALLOCATION_FAILED');
  return number;
}
export async function ensureBookingIdentity(db,{bookingID,identity,status,startDate,endDate,snapshot,now,tripID}) {
  let trip=await db.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if(!trip){
    const number=await allocateBookingNumber(db);
    // Both statements execute in one D1 transaction. A concurrent winner is reused;
    // never create a second pilgrim for the same booking or an orphan on insert failure.
    await db.batch([
      db.prepare(`INSERT INTO pilgrims(first_name,last_name,display_name,phone,email,created_at,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pilgrim_trips WHERE booking_id=?)`)
        .bind(identity.firstName||'',identity.lastName||'',identity.displayName||'Паломник',identity.phone||'',identity.email||'',now,now,bookingID),
      db.prepare(`INSERT INTO pilgrim_trips(id,booking_id,booking_number,pilgrim_id,status,start_date,end_date,booking_snapshot_json,pricing_snapshot_json,created_at,updated_at)
        SELECT ?,?,?,last_insert_rowid(),?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pilgrim_trips WHERE booking_id=?)`)
        .bind(tripID,bookingID,number,status,startDate,endDate,snapshot,'{}',now,now,bookingID)
    ]);
    trip=await db.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  }
  if(trip&&!Number(trip.booking_number)){
    const number=await allocateBookingNumber(db);
    await db.prepare('UPDATE pilgrim_trips SET booking_number=? WHERE booking_id=? AND (booking_number IS NULL OR booking_number<=0)').bind(number,bookingID).run();
    trip=await db.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  }
  if(!trip||!Number(trip.booking_number)||!Number(trip.pilgrim_id))throw Error('BOOKING_IDENTITY_NOT_READY');
  return trip;
}
