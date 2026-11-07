import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function files(directory) {
 const result=[];
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  const path=`${directory}/${entry.name}`;
  if(entry.isDirectory())result.push(...await files(path));else if(entry.name.endsWith('.mjs'))result.push(path);
 }
 return result;
}
const paths=(await Promise.all(['dist','scripts','tests','supabase/functions/_shared'].map(files))).flat();
for(const path of paths) {
 const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
 if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
}
console.log(`Syntax checks passed for ${paths.length} JavaScript modules.`);
