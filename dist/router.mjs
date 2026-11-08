import {navigation} from './presentation.mjs';

// URLs contain only a screen name. Identity and permissions always come from the server.
export function createRouter({window: browser=globalThis.window,onChange=()=>{}}={}) {
 let role=null,pending=false,current='overview';
 const allowed=page=>!!role&&(pending?page==='overview':navigation[role]?.some(([id])=>id===page));
 const read=()=>{
  const match=/^#\/([a-z]+)$/.exec(browser.location.hash||'');
  return match&&allowed(match[1])?match[1]:'overview';
 };
 const write=(page,replace)=>{
  const url=browser.location.pathname+(browser.location.search||'')+(page?'#/'+page:'');
  browser.history[replace?'replaceState':'pushState'](null,'',url);
 };
 const changed=()=>{
  if(!role)return;
  if(browser.location.hash==='#main-content'){write(current,true);return;}
  const next=read();
  if(browser.location.hash!=='#/'+next)write(next,true);
  if(next!==current){current=next;onChange(next);}
 };
 browser.addEventListener('popstate',changed);
 browser.addEventListener('hashchange',changed);
 return {
  activate(nextRole,{pending:waiting=false}={}) {
   role=navigation[nextRole]?nextRole:null;pending=waiting;current=read();
   if(role&&browser.location.hash!=='#/'+current)write(current,true);
   return current;
  },
  go(page) {
   if(!allowed(page)||page===current)return false;
   write(page,false);current=page;onChange(page);return true;
  },
  reset(){role=null;pending=false;current='overview';write('',true);},
  dispose(){browser.removeEventListener('popstate',changed);browser.removeEventListener('hashchange',changed);},
 };
}
