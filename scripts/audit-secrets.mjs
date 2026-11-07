import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Recognizable, nonfunctional fixture literals used by the test suite, never real credentials.
const fixtures=new Set(['sb_secret_fixture','sb_secret_never_expose','rzp_live_fixture','fixture-private','fixture-webhook','test-service']);
export function scanText(source) {
 const kinds=new Set();
 for(const match of source.matchAll(/\b(?:sb_secret_[A-Za-z0-9_-]+|rzp_live_[A-Za-z0-9]+)\b/g)) {
  if(!fixtures.has(match[0]))kinds.add(match[0].startsWith('sb_secret_')?'Supabase secret key':'Razorpay live key');
 }
 for(const match of source.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
  try {if(JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString('utf8')).role==='service_role')kinds.add('service-role JWT');}catch{}
 }
 for(const match of source.matchAll(/\b(?:RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["']([^"'\r\n]+)["']/g)) {
  if(!fixtures.has(match[1])&&!/^(?:\.\.\.|<[^>]+>|YOUR_[A-Z_]+)$/.test(match[1]))kinds.add('literal server credential');
 }
 return [...kinds];
}
function git(args) {
 const result=spawnSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
 if(result.status!==0)throw Error('Git inspection failed; secret audit is incomplete.');
 return result.stdout;
}
export function audit() {
 const findings=[];
 const files=git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean);
 for(const file of files) {
  if(/^\.env(?:\.|$)/.test(file)&&file!=='.env.example'){findings.push({file,kind:'tracked/private env file'});continue;}
  if(!/\.(?:mjs|js|ts|sql|md|json|ya?ml|toml|example)$/.test(file)&&file!=='.gitignore')continue;
  for(const kind of scanText(readFileSync(file,'utf8')))findings.push({file,kind});
 }
 const history=git(['log','--all','--format=__COMMIT__%h','--no-ext-diff','-p','--','.']);
 let commit='',file='';
 for(const line of history.split('\n')) {
  if(line.startsWith('__COMMIT__')){commit=line.slice(10);continue;}
  if(line.startsWith('+++ b/')){file=line.slice(6);continue;}
  if(line.startsWith('--- a/')){file=line.slice(6);continue;}
  if((line.startsWith('+')||line.startsWith('-'))&&!line.startsWith('+++')&&!line.startsWith('---')) {
   for(const kind of scanText(line.slice(1)))findings.push({commit,file,kind});
  }
 }
 const envHistory=git(['log','--all','--format=__COMMIT__%h','--name-only','--','.env','.env.*']);
 for(const line of envHistory.split('\n')){
  if(line.startsWith('__COMMIT__'))commit=line.slice(10);
  else if(line.startsWith('.env')&&line!=='.env.example')findings.push({commit,file:line,kind:'private env file in history'});
 }
 const unique=[...new Map(findings.map(f=>[JSON.stringify(f),f])).values()];
 // Report identifiers only. Never print the matched credential or a source line.
 if(unique.length){for(const finding of unique)console.error(JSON.stringify(finding));throw Error(`${unique.length} potential credential locations require review.`);}
 const commits=git(['rev-list','--all','--count']).trim();
 console.log(`Secret audit: ${files.length} files and ${commits} Git commits inspected; no credential matches.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{audit();}catch(error){console.error(error.message);process.exitCode=1;}
}
