let sdk;
export async function loadCheckout() {
  if (window.Razorpay) return window.Razorpay;
  if (!sdk) sdk = new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://checkout.razorpay.com/v1/checkout.js';
    script.onload=()=>{if(window.Razorpay)resolve(window.Razorpay);else{script.remove();sdk=null;reject(Error('Checkout did not load.'));}};
    script.onerror=()=>{script.remove();sdk=null;reject(Error('Unable to load checkout. Check your connection.'));};
    document.head.append(script);
  });
  return sdk;
}
// Only the database's webhook-reconciled status counts as payment success.
export async function waitForPayment(enrollmentId,{rpc,delay=ms=>new Promise(r=>setTimeout(r,ms)),attempts=20}) {
  let lastPayment;
  for(let attempt=0;attempt<attempts;attempt++) {
    const payments=await rpc('my_payments');
    const payment=payments.find(p=>p.enrollment_id===enrollmentId);
    lastPayment=payment;
    if(payment?.status==='paid'&&!payment.review_required) return payment;
    // A previous failed attempt may still be stored while a successful retry's webhook arrives.
    await delay(3000);
  }
  if(lastPayment?.status==='failed')throw Error('Payment is marked failed. Check Payments before retrying; a recent attempt may still be reconciling.');
  throw Error('Payment confirmation is pending. Check Payments again shortly; do not pay twice.');
}
export async function checkout(enrollmentId,{invokeFunction,rpc,onPending=()=>{}}) {
  const [order,Razorpay]=await Promise.all([invokeFunction('create-order',{enrollment_id:enrollmentId}),loadCheckout()]);
  return new Promise((resolve,reject)=>{
    let submitted=false;
    const instance=new Razorpay({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'DriveX',description:'Driving lesson plan',
      handler:()=>{submitted=true;onPending();waitForPayment(enrollmentId,{rpc}).then(resolve,reject);},
      modal:{ondismiss:()=>{if(!submitted) reject(Error('Checkout closed. Your plan remains pending until payment is received.'));}},
      theme:{color:'#142c25'},
    });
    // A failed attempt may be retried inside Checkout; dismiss or success finishes this promise.
    instance.open();
  });
}
