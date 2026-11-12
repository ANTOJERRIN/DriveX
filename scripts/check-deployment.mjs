import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Public, anonymous requests only. Never send credentials or print response bodies.
export async function checkDeployment(origin,{fetcher=fetch}={}){
 const base=new URL(origin);
 const local=base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname);
 if((base.protocol!=='https:'&&!local)||base.href!==base.origin+'/'||base.username||base.password)throw Error('Use an HTTPS application origin (HTTP is allowed on localhost).');
 const checks=[
  ['/config.mjs',async response=>/\bprovider\s*:\s*(['"])neon\1/.test(await response.text())&&/javascript/.test(response.headers.get('content-type')||'')],
  ['/healthz',async response=>(await response.json())?.ready===true],
  ['/api/auth/get-session',async response=>(await response.json())?.signedIn===false]
 ];
 const results=await Promise.all(checks.map(async([path,validate])=>{
  try{
   const response=await fetcher(new URL(path,base),{redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
   const json=path!=='/config.mjs';
   const ok=response.status===200&&(!json||/application\/json\b/i.test(response.headers.get('content-type')||''))&&await validate(response);
   return {path,ok:!!ok,status:response.status};
  }catch{return {path,ok:false,status:null};}
 }));
 return results;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error('Usage: npm run deploy:smoke -- https://your-app.onrender.com');
  const results=await checkDeployment(process.argv[2]);
  for(const result of results)console.log(`${result.ok?'PASS':'FAIL'} ${result.path} (${result.status===null?'request failed':'HTTP '+result.status})`);
  console.log('Public readiness only; account sign-in, cookies and historical data still require acceptance checks.');
  if(results.some(result=>!result.ok))process.exitCode=1;
 }catch(error){
  console.error(error instanceof TypeError?'Invalid application origin.':error.message);
  process.exitCode=1;
 }
}
