import {esc,navigation} from './presentation.mjs';

export const brand='<div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div>';
export function workspaceView({me,page,body,pending=false}) {
 const role=me.role;
 return `<a class="skip-link" href="#main-content">Skip to content</a><div class="shell"><aside class="side">${brand}<small>${esc(role==='student'?'Learner':role)} portal</small>${!pending?`<nav class="nav" aria-label="Main navigation">${navigation[role].map(([id,label])=>`<button data-nav="${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav>`:''}<div class="side-bottom"><p>${esc(me.name)}</p><button class="link" id="logout">Sign out</button></div></aside><main class="content" id="main-content">${body}<footer class="footer">DriveX · Guided learning, confident driving</footer></main></div>`;
}
export function pageTitle(role,page) {
 return `${navigation[role]?.find(([id])=>id===page)?.[1]||'Overview'} · DriveX`;
}
