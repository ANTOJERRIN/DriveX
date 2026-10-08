import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyWebhookSignature } from "../_shared/crypto.mjs";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const signature = req.headers.get("x-razorpay-signature") || "";
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";

    const rawBody = await req.text();

    const isValid = await verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;
    const eventId = payload.event_id || `evt_${Date.now()}`;

    // Handle payment.captured or order.paid
    if (event === "payment.captured" || event === "order.paid") {
      const payment = payload.payload?.payment?.entity;
      const orderId = payment?.order_id;
      const paymentId = payment?.id;
      const amountPaise = payment?.amount;

      if (!orderId || !paymentId) {
        return new Response(
          JSON.stringify({ message: "Ignored event: missing order_id or payment_id" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      // Call public.confirm_payment_server RPC
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_payment_server`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_provider_order_id: orderId,
          p_provider_payment_id: paymentId,
          p_amount_paise: amountPaise,
          p_event_id: eventId,
        }),
      });

      if (!rpcRes.ok) {
        const error = await rpcRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: error.message || "Failed to confirm payment on server" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await rpcRes.json();
      return new Response(JSON.stringify({ status: "success", result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "ignored", event }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
