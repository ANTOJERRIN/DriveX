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

    // Handle payment.captured or order.paid
    if (event === "payment.captured" || event === "order.paid") {
      const payment = payload.payload?.payment?.entity;
      const bookingId = payment?.notes?.booking_id;
      const paymentId = payment?.id;
      const orderId = payment?.order_id;

      if (!bookingId || !paymentId) {
        return new Response(
          JSON.stringify({ message: "Ignored event: missing booking_id or payment_id" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      // Call database dispatch RPC with confirm_online_payment action
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/drivex`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "confirm_online_payment",
          payload: {
            booking: bookingId,
            payment_id: paymentId,
            order_id: orderId,
          },
        }),
      });

      if (!rpcRes.ok) {
        const error = await rpcRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: error.message || "Failed to confirm payment" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const result = await rpcRes.json();
      return new Response(JSON.stringify({ status: "success", result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "ignored" }), {
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
