import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readNeonConfig} from '../backend/neon/config.mjs';

const settings={APP_ORIGIN:'https://drivex.example',DATABASE_URL:'postgres://local-test-only',NEON_AUTH_BASE_URL:'https://branch.neonauth.c-2.us-east-1.aws.neon.tech/neondb/auth'};

test('backend accepts Neon CLI auth variable and preserves legacy deployments',()=>{
 const config=readNeonConfig(settings);
 assert.equal(config.auth.href,settings.NEON_AUTH_BASE_URL);
 assert.equal(config.databaseUrl,settings.DATABASE_URL);
 assert.equal(config.site.origin,settings.APP_ORIGIN);
 assert.equal(readNeonConfig({...settings,NEON_AUTH_BASE_URL:undefined,NEON_AUTH_URL:settings.NEON_AUTH_BASE_URL}).auth.href,settings.NEON_AUTH_BASE_URL);
 assert.equal(readNeonConfig({...settings,NEON_AUTH_URL:'https://legacy.neon.tech/auth'}).auth.href,settings.NEON_AUTH_BASE_URL);
});

test('backend rejects missing settings and unsafe URLs without exposing values',()=>{
 for(const override of [
  {DATABASE_URL:''},{APP_ORIGIN:undefined},{NEON_AUTH_BASE_URL:undefined},
  {APP_ORIGIN:'http://drivex.example'},{APP_ORIGIN:'https://drivex.example/path'},
  {NEON_AUTH_BASE_URL:'http://branch.neon.tech/auth'},
  {NEON_AUTH_BASE_URL:'https://neon.tech.attacker.example/auth'},
  {NEON_AUTH_BASE_URL:'private-invalid-value'},
 ]){
  assert.throws(()=>readNeonConfig({...settings,...override}),error=>
   error.message==='Set DATABASE_URL, HTTPS APP_ORIGIN and NEON_AUTH_BASE_URL (or NEON_AUTH_URL).');
 }
});

test('Neon start command loads .env.local and respects deployment environment overrides',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'drivex-neon-env-'));
 try {
  await writeFile(join(directory,'.env.local'),Object.entries(settings).map(([key,value])=>`${key}=${value}`).join('\n'));
  const moduleUrl=new URL('../backend/neon/config.mjs',import.meta.url).href;
  const source=`import {readNeonConfig} from ${JSON.stringify(moduleUrl)}; const c=readNeonConfig(); if(c.site.origin!=='https://deployment.example'||!c.databaseUrl||!c.auth)process.exit(1);`;
  const env={...process.env,APP_ORIGIN:'https://deployment.example'};
  delete env.DATABASE_URL;delete env.NEON_AUTH_BASE_URL;delete env.NEON_AUTH_URL;
  const result=spawnSync(process.execPath,['--env-file-if-exists=.env.local','--input-type=module','-e',source],{cwd:directory,env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 } finally {await rm(directory,{recursive:true,force:true});}
});
