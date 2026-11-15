import {esc,navigation} from './presentation.mjs';

export const brand='<div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div>';
const navPaths={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',plans:'M4 5h16v15H4z M8 3v4 M16 3v4 M8 11h8 M8 15h5',book:'M4 5h16v15H4z M8 3v4 M16 3v4 M8 13h8 M12 9v8',lessons:'M4 5h16v15H4z M8 3v4 M16 3v4 M4 9h16 M8 13h3',syllabus:'M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3z M12 6v15',payments:'M3 5h18v14H3z M3 10h18 M7 15h4',learners:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M20 8v6 M17 11h6',availability:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',fleet:'M5 6h14l2 9v5h-3v-3H6v3H3v-5z M4 12h16 M7 15h1 M16 15h1',notifications:'M3 5h18v14H3z M3 5l9 8 9-8'};
const navIcon=id=>`<svg class="nav-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${navPaths[id]||navPaths.learners}"/></svg>`;
export function workspaceView({me,page,body,pending=false}) {
 const role=me.role;
 const portal=role==='student'?'Learner':role==='instructor'?'Instructor':'Admin';
 return `<a class="skip-link" href="#main-content">Skip to content</a><div class="shell"><aside class="side">${brand}<small>${esc(role==='student'?'Learner':role)} portal</small>${!pending?`<nav class="nav" aria-label="Main navigation">${navigation[role].map(([id,label])=>`<button data-nav="${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${navIcon(id)}<span>${label}</span></button>`).join('')}</nav>`:''}<div class="side-bottom"><p>${esc(me.name)}</p><button class="link" id="logout">Sign out</button></div></aside><main class="content" id="main-content"><div class="workspace-top"><p>Your journey. <strong>A little further, every day.</strong></p><span class="workspace-badge">${portal} workspace</span></div>${body}<footer class="footer">DriveX · Guided learning, confident driving</footer></main></div>`;
}
export function pageTitle(role,page) {
 return `${navigation[role]?.find(([id])=>id===page)?.[1]||'Overview'} · DriveX`;
}
