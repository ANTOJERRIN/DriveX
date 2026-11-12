import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDeployment} from '../scripts/check-deployment.mjs';
import {createNeonServer} from '../backend/neon/http.mjs';

test('public deployment check exercises the Neon HTTP runtime without a session',async t=>{
 const server=createNeonServer({
  pool:{query:async()=>({rows:[{ready:true}]})},
  siteOrigin:'https://school.example.test',authUrl:'https://auth.example.neon.tech',
  fetcher:async()=>Response.json(null)
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const results=await checkDeployment('http://127.0.0.1:'+server.address().port);
 assert.equal(results.length,3);
 assert.ok(results.every(result=>result.ok),JSON.stringify(results));
});

test('deployment check rejects legacy config, static fallbacks, failed readiness and unexpected sessions',async()=>{
 const good=path=>path==='/config.mjs'?new Response("export const config = {provider:'neon'};",{headers:{'Content-Type':'text/javascript'}}):Response.json(path==='/healthz'?{ready:true}:{signedIn:false});
 for(const [path,bad] of [
  ['/config.mjs',()=>new Response("export const config = {supabaseUrl:'https://fixture.supabase.co'};",{headers:{'Content-Type':'text/javascript'}})],
  ['/healthz',()=>new Response('<html>static fallback</html>',{headers:{'Content-Type':'text/html'}})],
  ['/healthz',()=>Response.json({ready:false},{status:503})],
  ['/healthz',()=>Response.json({ready:false})],
  ['/api/auth/get-session',()=>Response.json({signedIn:true})],
  ['/api/auth/get-session',()=>Response.json({})],
  ['/api/auth/get-session',()=>{throw Error('private upstream details');}]
 ]){
  const results=await checkDeployment('https://school.example.test',{fetcher:async(url,options)=>{
   assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
   assert.equal(options.headers,undefined);
   return url.pathname===path?bad():good(url.pathname);
  }});
  assert.deepEqual(results.filter(result=>!result.ok).map(result=>result.path),[path]);
 }
});

test('deployment check accepts only an application origin',async()=>{
 for(const origin of ['https://user:private@example.test','https://example.test/path','https://example.test?secret=value','http://example.test']){
  await assert.rejects(checkDeployment(origin),/application origin/);
 }
});
