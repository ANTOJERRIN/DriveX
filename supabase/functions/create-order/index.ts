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

    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
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

    // Call Supabase RPC to verify booking ownership and get order details securely
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/drivex`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "get_order_details",
        payload: { booking: booking_id },
      }),
    });

    if (!rpcRes.ok) {
      const err = await rpcRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err.message || "Failed to fetch booking details" }),
        { status: rpcRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bookingDetails = await rpcRes.json();
    const amountPaise = bookingDetails.amount_paise; // Server-authoritative amount

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
        receipt: booking_id,
        notes: {
          booking_id: booking_id,
          student_name: bookingDetails.student_name,
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
        student: {
          name: bookingDetails.student_name,
          phone: bookingDetails.student_phone,
          email: bookingDetails.student_email,
        },
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
