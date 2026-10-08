import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { enrollment_id } = await req.json();
    if (!enrollment_id) {
      return new Response(JSON.stringify({ error: "enrollment_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";

    if (!razorpayKeyId || !razorpayKeySecret) {
      return new Response(
        JSON.stringify({ error: "Razorpay credentials not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Supabase RPC to verify user and get payment details
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/drivex`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "my_payments",
        payload: {},
      }),
    });

    if (!rpcRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to verify enrollment" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentsList = await rpcRes.json();
    const targetPayment = paymentsList.find((p: any) => p.enrollment_id === enrollment_id);

    if (!targetPayment) {
      return new Response(JSON.stringify({ error: "Enrollment payment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountPaise = targetPayment.amount_inr * 100;

    // Create Razorpay Order
    const basicAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `enr_${enrollment_id.slice(0, 16)}`,
        notes: {
          enrollment_id: enrollment_id,
        },
      }),
    });

    if (!rzpRes.ok) {
      const err = await rzpRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err.error?.description || "Failed to create Razorpay order" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const order = await rzpRes.json();

    return new Response(
      JSON.stringify({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: razorpayKeyId,
        plan_name: targetPayment.plan_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
