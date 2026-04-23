import { getStore } from "@netlify/blobs";

export default async function handler(req, context) {
  if (!context.clientContext?.user) {
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
        message: "No ticket data yet. The scheduled refresh runs every 5 minutes, or hit /api/refresh manually."
      }), { status: 200, headers: { "Content-Type": "application/json" }});
    }

    return new Response(JSON.stringify({
      tickets: cached.tickets,
      handled: handled || {},
      fetchedAt: cached.fetchedAt,
      count: cached.count,
      currentUser: {
        email: context.clientContext.user.email,
        name: context.clientContext.user.user_metadata?.full_name || context.clientContext.user.email.split("@")[0]
      }
    }), { status: 200, headers: { "Content-Type": "application/json" }});
  } catch (err) {
    console.error("get-tickets failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
