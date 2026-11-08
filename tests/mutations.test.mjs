import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationRunner} from '../dist/mutations.mjs';

test('saved writes survive refresh failures without replay and remain blocked until reads succeed',async()=>{
 let writes=0,reads=0,saved=0,offline=true;
 const runner=createMutationRunner({refresh:async()=>{reads++;if(offline)throw Error('offline');}});
 const operation=async()=>{writes++;return {id:'saved-booking'};};
 const result=await runner.run(operation,{onSaved:()=>saved++});
 assert.equal(result.status,'saved_refresh_failed');assert.equal(result.value.id,'saved-booking');assert.equal(saved,1);
 assert.equal(runner.blocked,true);assert.equal((await runner.run(operation)).status,'blocked');assert.equal(writes,1);
 assert.equal((await runner.reconcile()).status,'refresh_failed');assert.equal(runner.needsRefresh,true);
 offline=false;assert.equal((await runner.reconcile()).status,'refreshed');assert.equal(writes,1);assert.equal(reads,3);assert.equal(runner.blocked,false);
 assert.equal((await runner.run(operation)).status,'saved');assert.equal(writes,2);
});

test('lost write responses and server outages require reconciliation; explicit rejections allow correction',async()=>{
 let reads=0;
 const runner=createMutationRunner({refresh:async()=>reads++});
 assert.equal((await runner.run(async()=>{throw Error('response lost');})).status,'unknown');
 assert.equal(reads,0);assert.equal(runner.blocked,true);
 await runner.reconcile();
 const invalid=Object.assign(Error('Invalid hours'),{status:400});
 assert.equal((await runner.run(async()=>{throw invalid;})).status,'rejected');assert.equal(runner.blocked,false);assert.equal(reads,1);
 assert.equal((await runner.run(async()=>{throw Object.assign(Error('unavailable'),{status:503});})).status,'unknown');assert.equal(runner.blocked,true);
});

test('double submissions are blocked and sign-out discards late results without locking the new session',async()=>{
 let finishOld,finishNew,reads=0,saved=0;
 const runner=createMutationRunner({refresh:async()=>reads++});
 const old=runner.run(()=>new Promise(resolve=>finishOld=resolve),{onSaved:()=>saved++});
 assert.equal(runner.busy,true);assert.equal((await runner.run(async()=>{})).status,'blocked');assert.equal((await runner.reconcile()).status,'blocked');
 runner.reset();assert.equal(runner.blocked,false);
 const current=runner.run(()=>new Promise(resolve=>finishNew=resolve),{onSaved:()=>saved++});
 finishOld({id:'old'});assert.equal((await old).status,'stale');assert.equal(runner.busy,true);assert.equal(saved,0);assert.equal(reads,0);
 finishNew({id:'current'});assert.equal((await current).status,'saved');assert.equal(saved,1);assert.equal(reads,1);assert.equal(runner.blocked,false);
});

test('a stale refresh failure cannot poison a new session',async()=>{
 let rejectRefresh;
 const runner=createMutationRunner({refresh:()=>new Promise((_,reject)=>rejectRefresh=reject)});
 const old=runner.run(async()=>({id:'old'}));await Promise.resolve();runner.reset();
 rejectRefresh(Error('old network error'));assert.equal((await old).status,'stale');assert.equal(runner.needsRefresh,false);assert.equal(runner.busy,false);
});

test('a superseded workspace read cannot unlock writes before current data is applied',async()=>{
 let loaded=false;
 const runner=createMutationRunner({refresh:async()=>loaded});
 assert.equal((await runner.run(async()=>({id:'saved'}))).status,'saved_refresh_failed');assert.equal(runner.blocked,true);
 assert.equal((await runner.reconcile()).status,'refresh_failed');assert.equal(runner.blocked,true);
 loaded=true;assert.equal((await runner.reconcile()).status,'refreshed');assert.equal(runner.blocked,false);
});
