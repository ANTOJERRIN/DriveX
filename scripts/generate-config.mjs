import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// 1. Read environment variables (check process.env first, then fallback to .env file if running locally)
let supabaseUrl = process.env.SUPABASE_URL || "";
let publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if ((!supabaseUrl || !publishableKey) && existsSync(".env")) {
  try {
    const envLines = readFileSync(".env", "utf8").split("\n");
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [k, ...v] = trimmed.split("=");
      const val = v.join("=").trim().replace(/^["']|["']$/g, "");
      if (k.trim() === "SUPABASE_URL" && !supabaseUrl) supabaseUrl = val;
      if ((k.trim() === "SUPABASE_PUBLISHABLE_KEY" || k.trim() === "SUPABASE_ANON_KEY") && !publishableKey) {
        publishableKey = val;
      }
    }
  } catch {}
}

// 2. Validate URL
if (!supabaseUrl) {
  console.error("❌ Build error: SUPABASE_URL environment variable is required.");
  process.exit(1);
}

const urlPattern = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/;
if (!urlPattern.test(supabaseUrl)) {
  console.error(`❌ Build error: Invalid SUPABASE_URL: "${supabaseUrl}". Must match https://<project-ref>.supabase.co`);
  process.exit(1);
}
supabaseUrl = supabaseUrl.replace(/\/$/, "");

// 3. Validate Publishable Key (Ensure it's NOT a service_role or secret key)
if (!publishableKey) {
  console.error("❌ Build error: SUPABASE_PUBLISHABLE_KEY environment variable is required.");
  process.exit(1);
}

if (publishableKey.startsWith("sb_secret_")) {
  console.error("❌ SECURITY ALERT: A service-role or secret key was provided! Never use secret keys in frontend builds.");
  process.exit(1);
}

if (publishableKey.startsWith("ey")) {
  try {
    const payload = JSON.parse(Buffer.from(publishableKey.split(".")[1], "base64").toString("utf8"));
    if (payload.role === "service_role") {
      console.error("❌ SECURITY ALERT: A service_role JWT was detected! Only anon or publishable keys are allowed in client builds.");
      process.exit(1);
    }
  } catch {}
}

// 4. Write dist/config.mjs
const content = `// Generated at build time by scripts/generate-config.mjs. Do not commit secrets.
export const config = Object.freeze({
  supabaseUrl: ${JSON.stringify(supabaseUrl)},
  publishableKey: ${JSON.stringify(publishableKey)},
});
`;

writeFileSync(resolve("dist", "config.mjs"), content, "utf8");
console.log(`✅ dist/config.mjs successfully generated for ${supabaseUrl}`);
