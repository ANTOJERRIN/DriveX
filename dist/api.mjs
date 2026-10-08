import { config } from "./config.mjs";
let session = null,
  refreshing = null;
const storageKey = "drivex-auth-v1";
try {
  session = JSON.parse(sessionStorage.getItem(storageKey) || "null");
} catch {}
export const configured = () =>
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl) &&
  !!config.publishableKey;
function save(value) {
  session = value?.access_token
    ? {
        ...value,
        expires_at:
          value.expires_at ||
          Math.floor(Date.now() / 1000) + (value.expires_in || 3600),
      }
    : null;
  try {
    if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
    else sessionStorage.removeItem(storageKey);
  } catch {}
}
export const signedIn = () => !!session?.access_token;
async function request(path, body, { token, method = "POST" } = {}) {
  if (!configured()) throw Error("DriveX’s database is not connected yet.");
  const response = await fetch(config.supabaseUrl + path, {
    method,
    headers: {
      apikey: config.publishableKey,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = Error(
      data?.msg ||
        data?.error_description ||
        data?.message ||
        "The request could not be completed. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
async function token() {
  if (!session) throw Error("Please sign in.");
  if (session.expires_at * 1000 < Date.now() + 60000) {
    if (!refreshing)
      refreshing = request("/auth/v1/token?grant_type=refresh_token", {
        refresh_token: session.refresh_token,
      })
        .then(save)
        .catch((e) => {
          save(null);
          throw e;
        })
        .finally(() => (refreshing = null));
    await refreshing;
  }
  return session.access_token;
}
export async function login(email, password) {
  const value = await request("/auth/v1/token?grant_type=password", {
    email,
    password,
  });
  save(value);
}
export async function signup(name, email, password, phone) {
  const value = await request("/auth/v1/signup", {
    email,
    password,
    data: { name, phone },
  });
  if (value?.access_token) save(value);
  return !!value?.access_token;
}
export async function logout() {
  const t = session?.access_token;
  try {
    if (t) await request("/auth/v1/logout", undefined, { token: t });
  } finally {
    save(null);
  }
}
export async function recover(email) {
  return request(
    "/auth/v1/recover?redirect_to=" + encodeURIComponent(location.origin + "/"),
    { email },
  );
}
export async function changePassword(password) {
  await request(
    "/auth/v1/user",
    { password },
    { method: "PUT", token: await token() },
  );
}
export function handleCallback() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has("access_token") && hash.has("refresh_token")) {
    save({
      access_token: hash.get("access_token"),
      refresh_token: hash.get("refresh_token"),
      expires_in: Number(hash.get("expires_in")) || 3600,
    });
    const recovery = hash.get("type") === "recovery";
    history.replaceState(null, "", location.pathname);
    return recovery;
  }
  return false;
}
export async function rpc(action, payload = {}) {
  return request(
    "/rest/v1/rpc/drivex",
    { action, payload },
    { token: await token() },
  );
}
