import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../dist/api.mjs';

function clientFixture(fetcher) {
 const store=new Map([['drivex-auth-v1',JSON.stringify({access_token:'fixture-old',refresh_token:'fixture-refresh',expires_at:1})]]);
 const storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
 return {store,api:createApi({config:{supabaseUrl:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'},storage,fetcher})};
}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
const fresh=access_token=>({access_token,refresh_token:'fixture-refresh',expires_in:3600});

test('network, throttling and server refresh failures preserve the session for a later retry',async()=>{
 for(const failure of ['network',429,503]) {
  let refreshes=0;
  const {api,store}=clientFixture(async url=>{
   if(url.includes('refresh_token')){
    if(++refreshes===1){if(failure==='network')throw Error('offline');return response({message:'Temporarily unavailable'},failure);}
    return response(fresh('fixture-new'));
   }
   return response([]);
  });
  await assert.rejects(api.rpc('snapshot'));assert.equal(api.signedIn(),true);assert.equal(store.size,1);
  await api.rpc('snapshot');assert.equal(refreshes,2);assert.equal(JSON.parse(store.get('drivex-auth-v1')).access_token,'fixture-new');
 }
});

test('invalid refresh credentials remove the unusable session',async()=>{
 for(const status of [400,401,403]){
  const {api,store}=clientFixture(async()=>response({message:'Invalid refresh token'},status));
  await assert.rejects(api.rpc('snapshot'),/Invalid refresh token/);assert.equal(api.signedIn(),false);assert.equal(store.size,0);
 }
});

test('sign-out invalidates an in-flight refresh before its response can restore login or call the dispatcher',async()=>{
 let finishRefresh,rpcCalls=0;
 const {api,store}=clientFixture(async url=>{
  if(url.includes('refresh_token'))return new Promise(resolve=>finishRefresh=resolve);
  if(url.includes('/rpc/'))rpcCalls++;
  return response({});
 });
 const pending=api.rpc('snapshot');await api.logout();assert.equal(api.signedIn(),false);
 finishRefresh(response(fresh('fixture-late')));
 await assert.rejects(pending,/session changed/);assert.equal(api.signedIn(),false);assert.equal(store.size,0);assert.equal(rpcCalls,0);
});

test('an old refresh failure and a delayed logout cannot erase a newer login',async()=>{
 let finishRefresh,finishLogout;
 const {api,store}=clientFixture(async url=>{
  if(url.includes('refresh_token'))return new Promise(resolve=>finishRefresh=resolve);
  if(url.includes('/logout'))return new Promise(resolve=>finishLogout=resolve);
  if(url.includes('grant_type=password'))return response(fresh('fixture-other-account'));
  return response([]);
 });
 const stale=api.rpc('snapshot'),logout=api.logout();
 await api.login('other@example.test','fixture-password');finishRefresh(response({message:'Invalid refresh token'},400));
 await assert.rejects(stale,/Invalid refresh token/);finishLogout(response({}));await logout;
 await api.rpc('snapshot');assert.equal(JSON.parse(store.get('drivex-auth-v1')).access_token,'fixture-other-account');
});

test('a delayed sign-in response cannot restore a session after sign-out',async()=>{
 let finishLogin;
 const {api}=clientFixture(async url=>url.includes('grant_type=password')?new Promise(resolve=>finishLogin=resolve):response({}));
 const pending=api.login('learner@example.test','fixture-password');await api.logout();finishLogin(response(fresh('fixture-late')));
 await assert.rejects(pending,/session changed/);assert.equal(api.signedIn(),false);
});
