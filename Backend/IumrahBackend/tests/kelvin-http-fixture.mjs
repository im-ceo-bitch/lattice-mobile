// Standalone, loopback-only integration fixture. Not a production service.
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {kelvinAdmin,kelvinInternal} from '../../HotelsWorker/src/kelvin.js';
const sql=new DatabaseSync(':memory:');
function wrap(q,args=[]){return {bind:(...v)=>wrap(q,v),run:async()=>({meta:sql.prepare(q).run(...args)}),first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)})};}
const env={HOTELS_DB:{prepare:wrap,batch:async list=>{for(const x of list)await x.run();}}};
const server=http.createServer(async(req,res)=>{
 try{
  const parts=[];for await(const part of req)parts.push(part);
  const body=Buffer.concat(parts);const r=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body})});
  const response=req.url.startsWith('/api/internal/')?await kelvinInternal(r,env):await kelvinAdmin(r,env,{login:'integration-test',role:'superadmin'},{session_id:'fixture'});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch(e){res.writeHead(500);res.end(JSON.stringify({ok:false,error:'FIXTURE_FAILURE'}));console.error(e.name);}
});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
