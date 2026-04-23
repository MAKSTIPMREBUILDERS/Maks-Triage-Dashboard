import { getStore } from "@netlify/blobs";

export default async function handler(req, context) {
  if (!context.clientContext?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const user = context.clientContext.user;
  const userName = user.user_metadata?.full_name || user.email.split("@")[0];

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { ticketId, action } = await req.json();
    if (!ticketId || !action) {
      return new Response(JSON.stringify({ error: "Missing ticketId or action" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const state = getStore({ name: "triage-state", consistency: "strong" });
    const handled = (await state.get("handled", { type: "json" })) || {};

    if (action === "mark") {
      handled[ticketId] = {
        by: userName,
        email: user.email,
        at: new Date().toISOString()
      };
    } else if (action === "unmark") {
      delete handled[ticketId];
    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    await state.setJSON("handled", handled);

    return new Response(JSON.stringify({ success: true, handled }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("handled function failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
