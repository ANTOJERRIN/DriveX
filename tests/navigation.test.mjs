import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouter} from '../dist/router.mjs';
import {authView} from '../dist/auth-view.mjs';
import {workspaceView,pageTitle} from '../dist/layout.mjs';
import {disableButtons} from '../dist/controls.mjs';

function browserFixture(hash='') {
 const location={pathname:'/',search:'?source=school',hash};
 const handlers=new Map(),history=['/'+location.search+hash];let index=0;
 const update=url=>{const parsed=new URL(url,'https://school.test');Object.assign(location,{pathname:parsed.pathname,search:parsed.search,hash:parsed.hash});};
 const dispatch=event=>{for(const handler of handlers.get(event)||[])handler();};
 return {location,addEventListener:(name,handler)=>{if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler);},removeEventListener:(name,handler)=>handlers.get(name)?.delete(handler),
  history:{replaceState:(_,__,url)=>{history[index]=url;update(url);},pushState:(_,__,url)=>{history.splice(++index,history.length,url);update(url);},back:()=>{if(index){update(history[--index]);dispatch('popstate');dispatch('hashchange');}},forward:()=>{if(index<history.length-1){update(history[++index]);dispatch('popstate');dispatch('hashchange');}}},
  hashChange:hash=>{location.hash=hash;dispatch('hashchange');},
 };
}

test('screen links survive refresh, preserve query strings and support Back/Forward once per change',()=>{
 const browser=browserFixture('#/payments'),seen=[];
 const router=createRouter({window:browser,onChange:page=>seen.push(page)});
 assert.equal(router.activate('student'),'payments');
 assert.equal(router.go('book'),true);assert.equal(browser.location.hash,'#/book');assert.equal(browser.location.search,'?source=school');
 assert.equal(router.go('book'),false);
 browser.history.back();assert.deepEqual(seen,['book','payments']);
 browser.history.forward();assert.deepEqual(seen,['book','payments','book']);
 router.dispose();
 const refreshed=createRouter({window:browser});assert.equal(refreshed.activate('student'),'book');refreshed.dispose();
});

test('navigation rejects cross-role links, malformed fragments and unapproved instructor screens',()=>{
 const browser=browserFixture('#/fleet'),seen=[];
 const router=createRouter({window:browser,onChange:page=>seen.push(page)});
 assert.equal(router.activate('student'),'overview');assert.equal(browser.location.hash,'#/overview');
 assert.equal(router.go('fleet'),false);assert.equal(router.go('notifications'),false);
 router.go('payments');browser.hashChange('#/instructors');assert.equal(browser.location.hash,'#/overview');
 browser.hashChange('#/book?admin=true');assert.equal(browser.location.hash,'#/overview');
 assert.equal(router.activate('instructor',{pending:true}),'overview');assert.equal(router.go('learners'),false);
 browser.hashChange('#/earnings');assert.equal(browser.location.hash,'#/overview');
 router.reset();browser.hashChange('#/fleet');assert.equal(router.go('fleet'),false);
 assert.equal(router.activate('unknown'),'overview');assert.equal(router.go('overview'),false);
 router.dispose();
});

test('skip-to-content keeps the active screen and disposed routers stop observing history',()=>{
 const browser=browserFixture('#/lessons'),seen=[];
 const router=createRouter({window:browser,onChange:page=>seen.push(page)});
 router.activate('student');browser.hashChange('#main-content');assert.equal(browser.location.hash,'#/lessons');assert.deepEqual(seen,[]);
 router.dispose();browser.hashChange('#/payments');assert.deepEqual(seen,[]);
});

test('auth screens cover account creation, recovery, setup and escaped status messages',()=>{
 const signup=authView({ready:true,mode:'signup',door:'instructor',message:'<img onerror=alert(1)>'});
 assert.match(signup,/reviewed before you can accept learners/);assert.match(signup,/autocomplete="new-password"/);
 assert.match(signup,/value="instructor" selected/);assert.ok(!signup.includes('<img'));
 assert.ok(!signup.includes('value="admin"'));
 const recover=authView({ready:true,mode:'recover'});assert.match(recover,/Send reset link/);assert.ok(!recover.includes('name="password"'));assert.ok(!recover.includes('data-door'));
 const password=authView({ready:true,mode:'password'});assert.match(password,/Save password/);assert.ok(!password.includes('name="email"'));
 const setup=authView({ready:false});assert.match(setup,/Setup required/);assert.ok(!setup.includes('<form'));
});

test('workspace chrome keeps role navigation, pending access and page titles separate from page content',()=>{
 const html=workspaceView({me:{role:'student',name:'<script>private</script>'},page:'payments',body:'<section>Receipts</section>'});
 assert.match(html,/aria-current="page">Payments/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('data-nav="fleet"'));assert.match(html,/<section>Receipts<\/section>/);
 const pending=workspaceView({me:{role:'instructor',name:'Applicant'},page:'overview',pending:true,body:'Waiting'});
 assert.ok(!pending.includes('<nav'));assert.match(pending,/id="logout"/);
 assert.equal(pageTitle('student','payments'),'Payments · DriveX');assert.equal(pageTitle('admin','fleet'),'Training fleet · DriveX');
});

test('failed actions restore enabled controls without enabling unavailable slots or replaced screens',()=>{
 const submit={disabled:false,isConnected:true},takenSlot={disabled:true,isConnected:true},oldScreen={disabled:false,isConnected:true};
 const restore=disableButtons({querySelectorAll:()=>[submit,takenSlot,oldScreen]});
 assert.equal(submit.disabled,true);assert.equal(takenSlot.disabled,true);
 oldScreen.isConnected=false;restore();
 assert.equal(submit.disabled,false);assert.equal(takenSlot.disabled,true);assert.equal(oldScreen.disabled,true);
});
