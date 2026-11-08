import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {registerPwa} from '../dist/pwa.mjs';
import {parseWorkingHours,availabilityView,notificationsView} from '../dist/scheduling.mjs';
import {learnerOverview,bookView,plansView} from '../dist/portals/learner.mjs';
import {instructorOverview,learnersView} from '../dist/portals/instructor.mjs';
import {adminOverview,instructorsView,fleetView} from '../dist/portals/admin.mjs';

test('PWA manifest, icons and public offline shell are real assets',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../dist/manifest.webmanifest',import.meta.url),'utf8'));
 assert.equal(manifest.start_url,'/');assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons){const bytes=await readFile(new URL('../dist'+icon.src,import.meta.url));const size=Number(icon.sizes.split('x')[0]);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);assert.equal(bytes.subarray(1,4).toString(),'PNG');}
 const offline=await readFile(new URL('../dist/offline.html',import.meta.url),'utf8');assert.match(offline,/You’re offline/);assert.ok(!offline.includes('app.mjs'));assert.ok(!offline.includes('config.mjs'));
});

test('service worker caches only the public shell and never caches account or API responses',async()=>{
 const handlers={},stores=new Map(),puts=[];let online=true,claimed=false;
 const cache=name=>{if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {addAll:async paths=>{for(const path of paths){const source=await readFile(new URL('../dist'+path,import.meta.url));map.set(path,new Response(source));}},put:async(key,value)=>{puts.push(key);map.set(key,value);}};};
 const caches={open:async name=>cache(name),keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),match:async key=>{for(const store of stores.values())if(store.has(key))return store.get(key).clone();}};
 stores.set('drivex-shell-old',new Map());stores.set('another-app',new Map());
 runInNewContext(await readFile(new URL('../dist/sw.js',import.meta.url),'utf8'),{self:{location:{origin:'https://fixture.test'},clients:{claim:async()=>{claimed=true;}},skipWaiting:async()=>{},addEventListener:(name,handler)=>handlers[name]=handler},caches,URL,Response,fetch:async request=>{if(!online)throw Error('offline');if(request.url.endsWith('/product.css'))return new Response('body{color:green}',{headers:{'Content-Type':'text/css'}});return new Response('PRIVATE ACCOUNT RESPONSE',{headers:{'Content-Type':'text/html'}});}});
 let pending;handlers.install({waitUntil:p=>pending=p});await pending;handlers.activate({waitUntil:p=>pending=p});await pending;
 assert.equal(claimed,true);assert.equal(stores.has('drivex-shell-old'),false);assert.equal(stores.has('another-app'),true);
 const dispatch=(path,{mode='cors',method='GET',authorization=false}={})=>{let response;handlers.fetch({request:{url:path.startsWith('https:')?path:'https://fixture.test'+path,mode,method,headers:{has:()=>authorization}},respondWith:p=>response=p});return response;};
 const account=await dispatch('/',{mode:'navigate'});assert.match(await account.text(),/PRIVATE/);assert.deepEqual(puts,[]);
 for(const path of ['/config.mjs','/app.mjs','/rest/v1/rpc/drivex','/auth/v1/token','/styles.css?token=private','https://other.test/private'])assert.equal(dispatch(path),undefined);
 assert.equal(dispatch('/styles.css',{authorization:true}),undefined);assert.equal(dispatch('/offline.html',{method:'POST'}),undefined);
 await dispatch('/product.css');assert.deepEqual(puts,['/product.css']);
 await dispatch('/icons/icon.svg');assert.deepEqual(puts,['/product.css']);
 online=false;const fallback=await dispatch('/',{mode:'navigate'});const text=await fallback.text();assert.match(text,/You’re offline/);assert.ok(!text.includes('PRIVATE'));
 assert.equal(await (await dispatch('/product.css')).text(),'body{color:green}');
 for(const store of stores.values())store.delete('/offline.html');assert.equal((await dispatch('/',{mode:'navigate'})).status,503);
});

test('PWA registration exposes offline status and waits for an install gesture',async()=>{
 const events={},banner={},button={hidden:true};let registrations=0,prompts=0;
 const nav={onLine:false,serviceWorker:{register:async(path,options)=>{assert.equal(path,'/sw.js');assert.equal(options.scope,'/');registrations++;return {};}}};
 await registerPwa({window:{addEventListener:(name,callback)=>events[name]=callback},navigator:nav,document:{querySelector:selector=>selector==='#connection-status'?banner:button},secure:true});
 assert.equal(registrations,1);assert.equal(banner.hidden,false);assert.match(banner.textContent,/out of date/);
 events.beforeinstallprompt({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'dismissed'})});assert.equal(button.hidden,false);assert.equal(prompts,0);
 await button.onclick();assert.equal(prompts,1);assert.equal(button.hidden,true);nav.onLine=true;events.online();assert.equal(banner.hidden,true);
});

test('role view extraction keeps every portal renderable and new controls escape notes',()=>{
 const state={me:{id:'teacher',name:'Learner',role:'student'},bookings:[],plans:[],instructors:[],vehicles:[],active_enrollment:null};
 for(const html of [learnerOverview({state,course:[],metrics:{}}),plansView({state}),bookView({state}),instructorOverview({state,metrics:{},filter:'all'}),learnersView({learners:[]}),instructorsView({state}),fleetView({state}),adminOverview({metrics:{}})])assert.equal(typeof html,'string');
 const hours={instructor_id:'teacher',hours:[{weekday:1,start:'08:30',end:'12:30'}],blocked_dates:[{date:'2026-11-20',reason:'<img onerror=alert(1)>'}]};
 const html=availabilityView({state:{...state,me:{role:'instructor'}},hours});assert.ok(!html.includes('<img onerror'));assert.ok(html.includes('08:30-12:30'));
 const fields=new Map([['day_1','08:30-12:30, 14:00-18:00']]);assert.equal(parseWorkingHours(fields).length,2);fields.set('day_2','29:00-30:00');assert.throws(()=>parseWorkingHours(fields),/time windows/);
 assert.match(notificationsView({scheduler:{installed:false,worker_configured:false},counts:{pending:0,due:0,sent:0,failed:0},jobs:[]}),/needs server setup/);
});
