// Preserve deliberately unavailable actions when a failed request unlocks the form.
export function disableButtons(root) {
 const buttons=[...root.querySelectorAll('button')].map(button=>[button,button.disabled]);
 buttons.forEach(([button])=>button.disabled=true);
 return ()=>buttons.forEach(([button,disabled])=>{if(button.isConnected)button.disabled=disabled;});
}

// Navigation and read-only refresh remain available while writes await reconciliation.
export function lockMutations(root,locked) {
 if(!locked)return;
 root.querySelectorAll('[data-enroll],[data-pay],[data-theory],[data-practical],[data-instructor],[data-vehicle],[data-cancel],[data-assess],[data-receipt],[data-refund],[data-legacy-refund],[data-resource],[data-unblock],[data-retry-notice],[data-recommendation-feedback],#reserve,#add-instructor,#add-vehicle,#action-form button,#hours-form button,#block-date-form button').forEach(button=>button.disabled=true);
}
