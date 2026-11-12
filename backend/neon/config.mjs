// Keep Neon credentials in the Node backend. Never include this module in dist/.
export function readNeonConfig(env=process.env) {
 const message='Set DATABASE_URL, HTTPS APP_ORIGIN and NEON_AUTH_BASE_URL (or NEON_AUTH_URL).';
 try {
  const site=new URL(env.APP_ORIGIN);
  const auth=new URL(env.NEON_AUTH_BASE_URL||env.NEON_AUTH_URL);
  if(!env.DATABASE_URL||auth.protocol!=='https:'||!auth.hostname.endsWith('.neon.tech')||site.protocol!=='https:'||site.href!==site.origin+'/')throw Error(message);
  return {site,auth,databaseUrl:env.DATABASE_URL};
 } catch {
  // URL parsing errors can include the supplied value. Report names only.
  throw Error(message);
 }
}
