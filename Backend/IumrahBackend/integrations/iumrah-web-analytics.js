/**
 * First-party website instrumentation for iumrah.app. Import after consent.
 * This adapter does not record typed text, URLs, query parameters, passport,
 * form contents, device IDs, payment fields or chat content. It is not auto-
 * installed on the live website: website repo integration is required.
 *
 * const analytics = createIumrahWebAnalytics({consent: true});
 * analytics.start('home');
 * analytics.track('search_started', 'flights');
 * analytics.screen('flight_results');
 * analytics.stop(); // clears locally queued data and stops tracking
 */
const ENDPOINT = 'https://iumrah-backend.helloiumrah.workers.dev/api/catalog/hotels/intelligence/events';
const ALLOWED = new Set(['app_first_open','app_open','app_background','screen_view','screen_exit','tap','onboarding_step','onboarding_completed','search_started','search_results','flight_selected','hotel_selected','price_viewed','checkout_started','booking_submitted','booking_completed','error']);
const CODE = /^[A-Za-z0-9_.-]{1,64}$/;

export function createIumrahWebAnalytics({consent=false,endpoint=ENDPOINT,version='web-1'}={}) {
  let active = Boolean(consent);
  let currentScreen = '';
  let startedAt=0;
  let queue=[];
  let inFlight=false;
  let visitorId;
  let sessionId;
  // Never persist an identifier until analytics consent is explicit.
  if(active){
    try {
      visitorId=localStorage.getItem('iumrah.analytics.visitor') || crypto.randomUUID();
      localStorage.setItem('iumrah.analytics.visitor',visitorId);
      sessionId=sessionStorage.getItem('iumrah.analytics.session') || crypto.randomUUID();
      sessionStorage.setItem('iumrah.analytics.session',sessionId);
    } catch {
      visitorId=crypto.randomUUID();sessionId=crypto.randomUUID();
    }
  }
  const clean = value => CODE.test(String(value||'')) ? String(value) : '';
  function track(name,screen='',elementId='',durationMs){
    if(!active||!ALLOWED.has(name))return;
    const event={id:crypto.randomUUID(),name,screen:clean(screen),elementId:clean(elementId),occurredAt:new Date().toISOString()};
    if(name==='screen_exit'&&Number.isInteger(durationMs)&&durationMs>=0&&durationMs<=3600000)event.durationMs=durationMs;
    queue.push(event);
    if(queue.length>150)queue.shift();
    if(queue.length>=10)void flush();
  }
  async function flush(){
    if(!active||inFlight||!queue.length)return;
    inFlight=true;
    const events=queue.splice(0,30);
    try {
      const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({visitorId,sessionId,platform:'web',appVersion:clean(version)||'web',events}),
        mode:'cors',cache:'no-store',keepalive:true,credentials:'omit'});
      if(!r.ok)throw Error('SEND_FAILED');
    } catch {
      queue=[...events,...queue].slice(0,150);
    } finally {inFlight=false;}
  }
  function screen(name){
    if(!active)return;
    const next=clean(name);
    if(!next)return;
    if(currentScreen)track('screen_exit',currentScreen,'',Math.min(3600000,Date.now()-startedAt));
    currentScreen=next;
    startedAt=Date.now();
    track('screen_view',next);
  }
  function start(initialScreen='home'){
    if(!active)return;
    track('app_open',clean(initialScreen));
    screen(initialScreen);
    document.addEventListener('visibilitychange',onVisibility);
    document.addEventListener('click',onClick);
  }
  function onClick(e){
    const el=e.target?.closest?.('[data-iumrah-track]');
    if(!el)return;
    const id=clean(el.getAttribute('data-iumrah-track'));
    if(id)track('tap',currentScreen,id);
  }
  function onVisibility(){
    if(document.visibilityState==='hidden'){
      if(currentScreen)track('screen_exit',currentScreen,'',Math.min(3600000,Date.now()-startedAt));
      track('app_background',currentScreen);
      void flush();
    } else if(document.visibilityState==='visible'&&currentScreen){
      startedAt=Date.now();track('screen_view',currentScreen);
    }
  }
  function stop(){
    active=false;queue=[];currentScreen='';
    document.removeEventListener('visibilitychange',onVisibility);
    document.removeEventListener('click',onClick);
    try{localStorage.removeItem('iumrah.analytics.visitor');sessionStorage.removeItem('iumrah.analytics.session');}catch{}
  }
  return {start,screen,track,flush,stop};
}
