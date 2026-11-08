import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWorkspace,createWorkspaceLoader} from '../dist/workspace.mjs';

function api(role,{approval_status='approved',instructors=[]}={}){
 const calls=[];
 const rpc=async(action,payload)=>{
  calls.push({action,payload});
  if(action==='snapshot')return {me:{role,approval_status},instructors};
  return action.includes('overview')||action==='dashboard'?{count:1}:[];
 };
 return {rpc,calls};
}

test('each role loads its own complete workspace exclusively through dispatcher actions',async()=>{
 const expected={student:['snapshot','my_lessons','my_payments','dashboard','learning_recommendations'],instructor:['snapshot','instructor_learners','instructor_earnings','instructor_overview','working_hours'],admin:['snapshot','admin_lessons','my_payments','admin_overview','working_hours','notification_status']};
 for(const role of Object.keys(expected)){
  const {rpc,calls}=api(role,{instructors:[{id:'teacher'}]});
  const result=await loadWorkspace(rpc);
  assert.deepEqual(calls.map(c=>c.action),expected[role]);assert.equal(result.state.me.role,role);assert.equal(result.pending,false);
  if(role==='admin')assert.deepEqual(calls.find(c=>c.action==='working_hours').payload,{instructor_id:'teacher'});
 }
});

test('unapproved instructors load no protected portal data and unknown roles are rejected',async()=>{
 for(const approval_status of ['pending','rejected']){
  const {rpc,calls}=api('instructor',{approval_status});
  const result=await loadWorkspace(rpc);assert.equal(result.pending,true);assert.deepEqual(calls.map(c=>c.action),['snapshot']);
  assert.deepEqual(result.payments,[]);assert.deepEqual(result.learners,[]);
 }
 await assert.rejects(loadWorkspace(async()=>null),/could not be loaded/);
 await assert.rejects(loadWorkspace(api('owner').rpc),/could not be loaded/);
});

test('admin schedule selection survives reload and handles an empty instructor roster',async()=>{
 let fixture=api('admin',{instructors:[{id:'first'},{id:'second'}]});
 let loaded=await loadWorkspace(fixture.rpc,{selectedInstructor:'second'});assert.equal(loaded.selectedInstructor,'second');
 fixture=api('admin');loaded=await loadWorkspace(fixture.rpc,{selectedInstructor:'removed'});
 assert.equal(loaded.hours,null);assert.equal(loaded.selectedInstructor,'');assert.ok(!fixture.calls.some(c=>c.action==='working_hours'));
});

test('a newer refresh wins and sign-out invalidation suppresses stale workspace data and errors',async()=>{
 const requests=[],applied=[];
 const rpc=async action=>action==='snapshot'?new Promise((resolve,reject)=>requests.push({resolve,reject})):[];
 const loader=createWorkspaceLoader({rpc,onLoad:value=>applied.push(value.state.me.name)});
 const first=loader.load(),second=loader.load();
 requests[1].resolve({me:{role:'student',name:'Current account'}});assert.equal(await second,true);
 requests[0].resolve({me:{role:'student',name:'Previous account'}});assert.equal(await first,false);assert.deepEqual(applied,['Current account']);
 const signedOut=loader.load();loader.invalidate();requests[2].resolve({me:{role:'student',name:'Signed out account'}});
 assert.equal(await signedOut,false);assert.deepEqual(applied,['Current account']);
 const staleError=loader.load();loader.invalidate();requests[3].reject(Error('Old request failed'));
 assert.equal(await staleError,false);assert.deepEqual(applied,['Current account']);
});

test('failed partial loads never publish a mixed workspace and permit a later retry',async()=>{
 let failing=true,applied=0;
 const loader=createWorkspaceLoader({rpc:async action=>{
  if(action==='snapshot')return {me:{role:'student'}};
  if(action==='my_payments'&&failing)throw Error('Payment history unavailable');
  return [];
 },onLoad:()=>applied++});
 await assert.rejects(loader.load(),/Payment history unavailable/);assert.equal(applied,0);
 failing=false;assert.equal(await loader.load(),true);assert.equal(applied,1);
});
