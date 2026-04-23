import { getStore } from "@netlify/blobs";

const HUBSPOT_API = "https://api.hubapi.com";

let ownersCache = null;
let ownersCacheAt = 0;
const OWNERS_CACHE_TTL = 5 * 60 * 1000;

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

async function getOwners(token) {
  if (ownersCache && (Date.now() - ownersCacheAt < OWNERS_CACHE_TTL)) {
    return ownersCache;
  }
  const response = await fetch(`${HUBSPOT_API}/crm/v3/owners?limit=100`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Failed to fetch owners: ${response.status}`);
  const data = await response.json();
  ownersCache = data.results || [];
  ownersCacheAt = Date.now();
  return ownersCache;
}

async function updateTicketOwner(token, ticketId, ownerId) {
  const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/tickets/${ticketId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties: { hubspot_owner_id: String(ownerId) }})
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HubSpot update failed: ${response.status} ${err}`);
  }
  return response.json();
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

  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    if (req.method === "GET") {
      const owners = await getOwners(token);
      return new Response(JSON.stringify({
        owners: owners
          .filter(o => !o.archived)
          .map(o => ({
            id: o.id,
            name: [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || `Owner ${o.id}`,
            email: o.email
          }))
      }), { status: 200, headers: { "Content-Type": "application/json" }});
    }

    if (req.method === "POST") {
      const { ticketId, ownerId } = await req.json();
      if (!ticketId || !ownerId) {
        return new Response(JSON.stringify({ error: "Missing ticketId or ownerId" }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      await updateTicketOwner(token, ticketId, ownerId);

      const cache = getStore({ name: "triage-cache", consistency: "strong" });
      const cached = await cache.get("tickets", { type: "json" });
      if (cached) {
        const ticket = cached.tickets.find(t => t.id === ticketId);
        if (ticket) {
          ticket.hubspot_owner_id = String(ownerId);
          await cache.setJSON("tickets", cached);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("assign-owner failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
