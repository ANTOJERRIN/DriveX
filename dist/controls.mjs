// Preserve deliberately unavailable actions when a failed request unlocks the form.
export function disableButtons(root) {
 const buttons=[...root.querySelectorAll('button')].map(button=>[button,button.disabled]);
 buttons.forEach(([button])=>button.disabled=true);
 return ()=>buttons.forEach(([button,disabled])=>{if(button.isConnected)button.disabled=disabled;});
}
