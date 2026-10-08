// Shared cryptographic verification for Razorpay Webhooks (Node & Deno compatible)
export async function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody)
  );
  const hashArray = Array.from(new Uint8Array(signatureBytes));
  const expectedSignature = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedSignature.toLowerCase() === signature.toLowerCase();
}
