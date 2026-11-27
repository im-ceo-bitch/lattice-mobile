// Kelvin speech only. Never expose provider credentials or forward chat history.
export const voices = new Set('Charon Orus Algenib Alnilam Schedar Iapetus Kore Sulafat Achernar Puck Zephyr Fenrir Leda Aoede Callirrhoe Autonoe Enceladus Umbriel Algieba Despina Erinome Rasalgethi Laomedeia Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager'.split(' '));
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff'};
const fail = (error,status) => Response.json({ok:false,error},{status,headers});
const MODEL = 'gemini-3.8-flash-tts';
export async function kelvinSpeech(request,env,owner,{fetcher=fetch}={}) {
 if(request.method==='GET') return Response.json({ok:true,configured:!!String(env.KELVIN_GEMINI_API_KEY||'').trim(),model:MODEL},{headers});
 if(request.method!=='POST') return fail('METHOD_NOT_ALLOWED',405);
 if(Number(request.headers.get('content-length')||0)>16000) return fail('INVALID_SPEECH_REQUEST',400);
 let input;
 try { const raw=await request.text(); if(raw.length>16000) throw Error(); input=JSON.parse(raw); } catch { return fail('INVALID_SPEECH_REQUEST',400); }
 const text=typeof input?.text==='string'?input.text.trim():'';
 if(input?.consent!==true||!voices.has(input?.voice)||!text||text.length>1500) return fail('INVALID_SPEECH_REQUEST',400);
 if(/AIza[A-Za-z0-9_-]{30,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]+|\b\d{6,}:[A-Za-z0-9_-]{20,}|\b[a-f0-9]{64}\b/i.test(text)) return fail('DO_NOT_SEND_SECRETS',400);
 const key=String(env.KELVIN_GEMINI_API_KEY||'').trim(); if(!key) return fail('GEMINI_KEY_MISSING',503);
 // Atomic quota per authenticated owner and UTC day. Attempts count, including failures.
 const db=env.HOTELS_DB; const day=new Date().toISOString().slice(0,10);
 try {
  await db.prepare('CREATE TABLE IF NOT EXISTS kelvin_voice_quota (owner TEXT PRIMARY KEY, day TEXT NOT NULL, attempts INTEGER NOT NULL)').run();
  const used=await db.prepare('INSERT INTO kelvin_voice_quota(owner,day,attempts) VALUES(?,?,1) ON CONFLICT(owner) DO UPDATE SET day=excluded.day, attempts=CASE WHEN kelvin_voice_quota.day=excluded.day THEN kelvin_voice_quota.attempts+1 ELSE 1 END WHERE kelvin_voice_quota.day<>excluded.day OR kelvin_voice_quota.attempts<100 RETURNING attempts').bind(owner,day).first();
  if(!used) return fail('KELVIN_VOICE_DAILY_LIMIT',429);
 } catch { return fail('KELVIN_VOICE_UNAVAILABLE',503); }
 try {
  const res=await fetcher('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(55000),body:JSON.stringify({model:MODEL,input:[{type:'user_input',content:[{type:'text',text}]}],response_format:{type:'audio',mime_type:'audio/wav',sample_rate:24000},generation_config:{speech_config:[{voice:input.voice}]},store:false})});
  if(!res.ok) return fail(res.status===429?'GEMINI_VOICE_RATE_LIMIT':res.status===401||res.status===403?'GEMINI_VOICE_ACCESS_DENIED':'GEMINI_VOICE_FAILED',res.status===429?429:502);
  const output=await res.json();
  const audio=(output.steps||[]).filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).filter(p=>p.type==='audio').at(-1);
  if(typeof audio?.data!=='string'||audio.data.length>20_000_000) return fail('GEMINI_VOICE_INVALID_AUDIO',502);
  const bytes=Uint8Array.from(atob(audio.data),c=>c.charCodeAt(0));
  if(bytes.length<44||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||String.fromCharCode(...bytes.subarray(8,12))!=='WAVE') return fail('GEMINI_VOICE_INVALID_AUDIO',502);
  return new Response(bytes,{headers:{...headers,'content-type':'audio/wav'}});
 } catch { return fail('GEMINI_VOICE_UNAVAILABLE',502); }
}
