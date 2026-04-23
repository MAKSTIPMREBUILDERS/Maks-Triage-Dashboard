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

  try {
    const cache = getStore({ name: "triage-cache", consistency: "strong" });
    const state = getStore({ name: "triage-state", consistency: "strong" });

    const [cached, handled] = await Promise.all([
      cache.get("tickets", { type: "json" }),
      state.get("handled", { type: "json" })
    ]);

    if (!cached) {
      return new Response(JSON.stringify({
        tickets: [],
        handled: {},
        fetchedAt: null,
        empty: true,
        message: "No ticket data yet. Click Refresh now to fetch from HubSpot."
      }), { status: 200, headers: { "Content-Type": "application/json" }});
    }

    return new Response(JSON.stringify({
      tickets: cached.tickets,
      handled: handled || {},
      fetchedAt: cached.fetchedAt,
      count: cached.count,
      currentUser: user
    }), { status: 200, headers: { "Content-Type": "application/json" }});
  } catch (err) {
    console.error("get-tickets failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
