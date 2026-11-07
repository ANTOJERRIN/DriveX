export async function registerPwa({window:win=globalThis.window,navigator:nav=globalThis.navigator,document:doc=globalThis.document,secure=globalThis.isSecureContext}={}) {
 const banner=doc.querySelector('#connection-status'),button=doc.querySelector('#install-app');let installEvent;
 const connection=()=>{if(banner){banner.hidden=nav.onLine!==false;banner.textContent='You are offline. Lesson and payment actions need a connection; shown information may be out of date.';}};
 win.addEventListener('online',connection);win.addEventListener('offline',connection);connection();
 win.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;if(button)button.hidden=false;});
 win.addEventListener('appinstalled',()=>{installEvent=null;if(button)button.hidden=true;});
 if(button)button.onclick=async()=>{
  if(!installEvent)return;const prompt=installEvent;installEvent=null;button.hidden=true;
  try{await prompt.prompt();await prompt.userChoice;}catch{}
 };
 if(!secure||!nav.serviceWorker)return null;
 try{return await nav.serviceWorker.register('/sw.js',{scope:'/'});}catch{return null;}
}
