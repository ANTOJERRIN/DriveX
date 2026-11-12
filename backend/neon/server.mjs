import pg from 'pg';
import {createNeonServer} from './http.mjs';

if(!process.env.DATABASE_URL)throw Error('Set the restricted DATABASE_URL for DriveX.');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,query_timeout:10000});
const servicePool=process.env.NEON_SERVICE_DATABASE_URL?new pg.Pool({connectionString:process.env.NEON_SERVICE_DATABASE_URL,max:2,connectionTimeoutMillis:5000,query_timeout:10000}):null;
const server=createNeonServer({pool,servicePool,siteOrigin:process.env.APP_ORIGIN,authUrl:process.env.NEON_AUTH_URL});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');
async function shutdown(){
 server.close(async()=>{await Promise.all([pool.end(),servicePool?.end()]);});
 setTimeout(()=>process.exit(1),15000).unref();
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
