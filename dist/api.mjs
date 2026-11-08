import { config as publicConfig } from './config.mjs';
import { validatePublicConfig } from './public-config.mjs';

// Dependency injection is used only by isolated tests. The application uses browser defaults.
export function createApi({ config = publicConfig, fetcher = (...args) => fetch(...args), storage: suppliedStorage, location: suppliedLocation, history: suppliedHistory } = {}) {
  let session = null, refreshing = null, callbackError = '', sessionEpoch = 0;
  let storage = suppliedStorage;
  if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch { storage = null; } }
  const storageKey = 'drivex-auth-v1';
  const currentLocation = () => suppliedLocation || globalThis.location;
  const currentHistory = () => suppliedHistory || globalThis.history;
  try { session = JSON.parse(storage?.getItem(storageKey) || 'null'); } catch {}
  const configured = () => {
    try { validatePublicConfig(config.supabaseUrl, config.publishableKey); return true; }
    catch { return false; }
  };
  const signedIn = () => !!session?.access_token;
  function save(value) {
    session = value?.access_token ? {
      ...value, expires_at: value.expires_at || Math.floor(Date.now() / 1000) + (value.expires_in || 3600),
    } : null;
    try {
      if (session) storage?.setItem(storageKey, JSON.stringify(session));
      else storage?.removeItem(storageKey);
    } catch {}
  }
  async function request(path, body, { token, method = 'POST' } = {}) {
    if (!configured()) throw Error('The school database is not connected yet.');
    let response;
    try {
      response = await fetcher(config.supabaseUrl + path, {
        method,
        headers: { apikey: config.publishableKey, ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw Error('DriveX could not reach the server. Check your connection or contact the school.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = Error((data?.code === 'PGRST202' ? 'The school database needs an update. Contact the school.' : '') || data?.error_description || data?.message || data?.msg || (typeof data?.error === 'string' ? data.error : '') || 'The request could not be completed. Please try again.');
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }
  async function token() {
    if (!session) throw Error('Please sign in.');
    const epoch = sessionEpoch;
    if (session.expires_at * 1000 < Date.now() + 60000) {
      if (!refreshing || refreshing.epoch !== epoch) {
        const flight = {epoch};
        flight.promise = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
          .then(value => {
            if (epoch !== sessionEpoch) throw Error('Your session changed. Please sign in again.');
            save(value);
          }).catch(error => {
            // Connectivity and service failures are retryable. Only an invalid session signs out.
            if (epoch === sessionEpoch && [400,401,403].includes(error.status)) { sessionEpoch++; save(null); }
            throw error;
          }).finally(() => { if (refreshing === flight) refreshing = null; });
        refreshing = flight;
      }
      await refreshing.promise;
    }
    if (epoch !== sessionEpoch) throw Error('Your session changed. Please sign in again.');
    if (!session?.access_token) throw Error('Your session expired. Please sign in again.');
    return session.access_token;
  }
  async function login(email, password) {
    const epoch = ++sessionEpoch;
    const value = await request('/auth/v1/token?grant_type=password', { email, password });
    if (epoch !== sessionEpoch) throw Error('Your session changed. Please sign in again.');
    save(value);
  }
  async function signup(name, email, password, phone, role = 'student', specialty = '') {
    const epoch = ++sessionEpoch;
    const value = await request('/auth/v1/signup?redirect_to=' + encodeURIComponent(currentLocation().origin + '/'), { email, password, data: { name, phone, role, specialty } });
    if (epoch !== sessionEpoch) throw Error('Your session changed. Please sign in again.');
    if (value?.access_token) save(value);
    return !!value?.access_token;
  }
  async function logout() {
    const existingToken = session?.access_token;
    sessionEpoch++; save(null);
    if (existingToken) await request('/auth/v1/logout', undefined, { token: existingToken });
  }
  const recover = email => request('/auth/v1/recover?redirect_to=' + encodeURIComponent(currentLocation().origin + '/'), { email });
  const changePassword = async password => request('/auth/v1/user', { password }, { method: 'PUT', token: await token() });
  function handleCallback() {
    const loc = currentLocation(), hash = new URLSearchParams((loc.hash || '').slice(1));
    callbackError = '';
    if (hash.has('error')) {
      callbackError = hash.get('error_description') || 'This sign-in link has expired. Request a new link.';
      currentHistory()?.replaceState(null, '', loc.pathname);
      return false;
    }
    if (hash.has('access_token') && hash.has('refresh_token')) {
      sessionEpoch++;
      save({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: Number(hash.get('expires_in')) || 3600 });
      currentHistory()?.replaceState(null, '', loc.pathname);
      return hash.get('type') === 'recovery';
    }
    return false;
  }
  const rpc = async (action, payload = {}) => request('/rest/v1/rpc/drivex', { action, payload }, { token: await token() });
  const invokeFunction = async (name, payload = {}) => request(`/functions/v1/${name}`, payload, { token: await token() });
  return { configured, signedIn, login, signup, logout, recover, changePassword, handleCallback, getCallbackError: () => callbackError, rpc, invokeFunction };
}

export const { configured, signedIn, login, signup, logout, recover, changePassword, handleCallback, getCallbackError, rpc, invokeFunction } = createApi();
