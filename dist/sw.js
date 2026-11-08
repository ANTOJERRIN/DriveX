/* Cache only this public shell. Auth, config, application modules and API responses never enter this cache. */
const CACHE='drivex-shell-v1';
const ASSETS=['/offline.html','/styles.css','/product.css','/icons/icon.svg','/icons/icon-180.png','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('drivex-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||request.headers?.has('authorization'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')||new Response('DriveX is offline. Reconnect to access your account.',{status:503,headers:{'Content-Type':'text/plain'}})));return;
 }
 if(url.search||!ASSETS.includes(url.pathname))return;
 event.respondWith(fetch(request).then(async response=>{
  const expected=url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.html')?'text/html':'image/';
  if(response.ok&&response.headers.get('Content-Type')?.includes(expected)){
   const cache=await caches.open(CACHE);await cache.put(url.pathname,response.clone());
  }
  return response;
 }).catch(()=>caches.match(url.pathname)));
});
