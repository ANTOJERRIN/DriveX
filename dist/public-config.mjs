// Only public configuration belongs in the static site. Shared with the build validator.
export function validatePublicConfig(url, key) {
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('SUPABASE_URL must be a valid Supabase URL.'); }
  const hosted = parsed.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) && !parsed.port;
  const local = parsed.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) && !!parsed.port;
  if ((!hosted && !local) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw Error('Use a Supabase project URL or a local Supabase development URL.');
  let valid = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!valid && typeof key === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try { const payload = JSON.parse(atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/'))); valid = payload.role === 'anon'; } catch {}
  }
  if (!valid) throw Error('Only a publishable key or an anon JWT is allowed in frontend configuration.');
  return Object.freeze({supabaseUrl:parsed.origin,publishableKey:key});
}
