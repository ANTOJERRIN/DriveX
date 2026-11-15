import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {workspaceView} from '../dist/layout.mjs';
import {navigation} from '../dist/presentation.mjs';

test('glossy workspace keeps labelled navigation, current page, skip target and sign out for every role',()=>{
 for(const role of ['student','instructor','admin']) {
  const html=workspaceView({me:{role,name:'<Learner>'},page:'lessons',body:'<h1>Lessons</h1>'});
  for(const [id,label] of navigation[role]) {
   assert.ok(html.includes(`data-nav="${id}"`));
   assert.ok(html.includes(`<span>${label}</span>`));
  }
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.match(html,/aria-hidden="true"/);
  assert.match(html,/href="#main-content"/);
  assert.match(html,/id="main-content"/);
  assert.match(html,/id="logout"/);
  assert.ok(!html.includes('<Learner>'));
 }
 const pending=workspaceView({me:{role:'instructor',name:'Pending'},page:'overview',body:'Awaiting approval',pending:true});
 assert.ok(!pending.includes('data-nav='));
 assert.match(pending,/id="logout"/);
});

test('online and offline entry points load a real compiled local Tailwind stylesheet',async()=>{
 const css=await readFile(new URL('../dist/waterflow.css',import.meta.url),'utf8');
 assert.match(css,/tailwindcss v4/);
 assert.ok(!css.includes('@apply'));
 for(const file of ['index.html','offline.html']) {
  const html=await readFile(new URL('../dist/'+file,import.meta.url),'utf8');
  assert.match(html,/href="\/waterflow.css"/);
  assert.ok(!html.includes('cdn.tailwindcss.com'));
 }
});
