import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePublicConfig } from '../dist/public-config.mjs';
if(process.argv.includes('--neon')) {
 writeFileSync(resolve('dist/config.mjs'),"// Public provider selection only. Database credentials stay on the server.\nexport const config = Object.freeze({provider:'neon'});\n",'utf8');
 console.log('Generated Neon provider configuration; no database credentials included.');
 process.exit(0);
}
let supabaseUrl=process.env.SUPABASE_URL||'';
let publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
if((!supabaseUrl||!publishableKey)&&existsSync('.env')) {
 for(const line of readFileSync('.env','utf8').split('\n')) {
  const match=line.trim().match(/^([A-Z_]+)\s*=\s*(.*)$/);
  if(!match)continue;
  const value=match[2].trim().replace(/^(["'])(.*)\1$/,'$2');
  if(match[1]==='SUPABASE_URL'&&!supabaseUrl)supabaseUrl=value;
  if(['SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].includes(match[1])&&!publishableKey)publishableKey=value;
 }
}
try {
 const config=validatePublicConfig(supabaseUrl,publishableKey);
 writeFileSync(resolve('dist/config.mjs'),'// Generated public configuration. Never place secrets here.\nexport const config = Object.freeze('+JSON.stringify(config,null,2)+');\n','utf8');
 console.log('Generated dist/config.mjs with validated public configuration.');
} catch(error) {console.error('Build error: '+error.message);process.exit(1);}
