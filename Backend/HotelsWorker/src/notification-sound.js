export const BRAND_NOTIFICATION_SOUND = 'iumrah-notification.wav';
const validMode = value => value === 'iumrah' || value === 'system';
const environment = value => value === 'development' ? 'development' : 'production';
const key = (token, topic, env) => JSON.stringify([token, topic, environment(env)]);
const schema = `CREATE TABLE IF NOT EXISTS notification_sound_preferences_v1 (
  device_token TEXT NOT NULL, app_bundle_id TEXT NOT NULL, environment TEXT NOT NULL,
  sound_mode TEXT NOT NULL CHECK(sound_mode IN ('iumrah','system')), updated_at TEXT NOT NULL,
  PRIMARY KEY(device_token,app_bundle_id,environment)
)`;

// Only existing validated device registration handlers call this function.
// Old clients omit soundMode: do not overwrite their existing choice.
async function writeNotificationSound(db, token, topic, env, mode, overwrite) {
  if (!validMode(mode) || !token || !/^[0-9a-f]{32,256}$/i.test(token)) return null;
  try {
    await db.prepare(schema).run();
    const conflict = overwrite ? 'DO UPDATE SET sound_mode=excluded.sound_mode,updated_at=excluded.updated_at' : 'DO NOTHING';
    await db.prepare(`INSERT INTO notification_sound_preferences_v1(device_token,app_bundle_id,environment,sound_mode,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(device_token,app_bundle_id,environment) ${conflict}`)
      .bind(token,topic,environment(env),mode,new Date().toISOString()).run();
    return overwrite ? mode : (await db.prepare('SELECT sound_mode FROM notification_sound_preferences_v1 WHERE device_token=? AND app_bundle_id=? AND environment=?').bind(token,topic,environment(env)).first())?.sound_mode ?? null;
  } catch {
    // Registration / booking creation is more important than optional sound customization.
    console.warn('NOTIFICATION_SOUND_SYNC_FAILED');
    return null;
  }
}
export function saveNotificationSound(db, token, topic, env, mode) {
  return writeNotificationSound(db, token, topic, env, mode, true);
}
// A verified checkout can seed a newly granted token before its first push. It must
// never overwrite a newer preference already synchronized by the settings screen.
export function seedNotificationSound(db, token, topic, env, mode) {
  return writeNotificationSound(db, token, topic, env, mode, false);
}

// Batched lookup avoids extra D1 subrequests per device. Legacy or missing schema -> default sound.
export async function loadNotificationSounds(db, rows) {
  const tokens = [...new Set(rows.map(row => row.device_token).filter(Boolean))];
  const sounds = new Map();
  for (let i=0; i<tokens.length; i+=40) {
    const chunk=tokens.slice(i,i+40);
    try {
      const result=await db.prepare(`SELECT device_token,app_bundle_id,environment,sound_mode FROM notification_sound_preferences_v1 WHERE device_token IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all();
      for (const row of result.results||[]) sounds.set(key(row.device_token,row.app_bundle_id,row.environment),row.sound_mode);
    } catch { /* A preference must never prevent delivery of a notification. */ }
  }
  return sounds;
}
export function appleNotificationSound(sounds, device, topic) {
  return sounds.get(key(device.device_token,topic,device.environment)) === 'iumrah' ? BRAND_NOTIFICATION_SOUND : 'default';
}
