// Never retry a write automatically: a lost response may follow a committed transaction.
export function createMutationRunner({refresh}) {
 let running=false,needsRefresh=false,version=0;
 return {
  get busy(){return running;},
  get needsRefresh(){return needsRefresh;},
  get blocked(){return running||needsRefresh;},
  reset(){version++;running=false;needsRefresh=false;},
  async run(operation,{onSaved=()=>{}}={}){
   if(running||needsRefresh)return {status:'blocked'};
   const request=version;running=true;let value;
   try{
    try{value=await operation();}
    catch(error){
     if(request!==version)return {status:'stale'};
     needsRefresh=!error.status||error.status>=500;
     return {status:needsRefresh?'unknown':'rejected',error};
    }
    if(request!==version)return {status:'stale'};
    onSaved(value);
    try{if(await refresh()===false)throw Error('A newer workspace refresh is still in progress.');}
    catch(error){
     if(request!==version)return {status:'stale'};
     needsRefresh=true;return {status:'saved_refresh_failed',value,error};
    }
    return request===version?{status:'saved',value}:{status:'stale'};
   }finally{if(request===version)running=false;}
  },
  async reconcile(){
   if(running)return {status:'blocked'};
   const request=version;running=true;
   try{
    if(await refresh()===false)throw Error('A newer workspace refresh is still in progress.');
    if(request!==version)return {status:'stale'};
    needsRefresh=false;return {status:'refreshed'};
   }catch(error){
    if(request!==version)return {status:'stale'};
    needsRefresh=true;return {status:'refresh_failed',error};
   }finally{if(request===version)running=false;}
  },
 };
}
