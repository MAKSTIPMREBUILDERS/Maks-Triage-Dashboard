import { getStore } from "@netlify/blobs";

function parseUser(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    if (!payload.email) return null;
    return {
      email: payload.email,
      name: payload.user_metadata?.full_name || payload.email.split("@")[0]
    };
  } catch {
    return null;
  }
}

export default async function handler(req, context) {
  const user = context.clientContext?.user
    ? {
        email: context.clientContext.user.email,
        name: context.clientContext.user.user_metadata?.full_name || context.clientContext.user.email.split("@")[0]
      }
    : parseUser(req);

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

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
        by: user.name,
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
