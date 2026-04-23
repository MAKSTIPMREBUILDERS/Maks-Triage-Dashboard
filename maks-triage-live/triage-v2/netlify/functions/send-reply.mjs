import { getStore } from "@netlify/blobs";

const HUBSPOT_API = "https://api.hubapi.com";

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

async function getTicketContact(token, ticketId) {
  const response = await fetch(
    `${HUBSPOT_API}/crm/v4/objects/tickets/${ticketId}/associations/contacts`,
    { headers: { "Authorization": `Bearer ${token}` }}
  );
  if (!response.ok) return null;
  const data = await response.json();
  if (!data.results || data.results.length === 0) return null;

  const contactId = data.results[0].toObjectId;
  const contactResponse = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname`,
    { headers: { "Authorization": `Bearer ${token}` }}
  );
  if (!contactResponse.ok) return null;
  return contactResponse.json();
}

async function createEmailEngagement(token, ticketId, contact, body, senderEmail, senderName) {
  if (!contact?.properties?.email) {
    throw new Error("No email address associated with this ticket's contact");
  }

  const now = Date.now();
  const engagementPayload = {
    properties: {
      hs_timestamp: now,
      hs_email_direction: "EMAIL",
      hs_email_status: "SENT",
      hs_email_subject: `Re: ${contact.properties.firstname ? "Your inquiry" : "Your support request"}`,
      hs_email_text: body,
      hs_email_html: body.replace(/\n/g, "<br>"),
      hs_email_headers: JSON.stringify({
        from: { email: senderEmail, firstName: senderName },
        to: [{ email: contact.properties.email }]
      })
    },
    associations: [
      {
        to: { id: ticketId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 227 }]
      },
      {
        to: { id: contact.id },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }]
      }
    ]
  };

  const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/emails`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(engagementPayload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to log email engagement: ${response.status} ${err}`);
  }
  return response.json();
}

async function addNoteToTicket(token, ticketId, noteText) {
  const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/notes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: {
        hs_timestamp: Date.now(),
        hs_note_body: noteText
      },
      associations: [{
        to: { id: ticketId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 228 }]
      }]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to add note: ${response.status} ${err}`);
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { ticketId, body, mode } = await req.json();
    if (!ticketId || !body) {
      return new Response(JSON.stringify({ error: "Missing ticketId or body" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    if (mode === "note") {
      const noteText = `[Draft reply staged by ${user.name} via Triage Dashboard]\n\n${body}`;
      await addNoteToTicket(token, ticketId, noteText);

      return new Response(JSON.stringify({
        success: true,
        mode: "note",
        message: "Draft saved as a note on the ticket in HubSpot. Review and send from HubSpot's reply editor."
      }), { status: 200, headers: { "Content-Type": "application/json" }});
    }

    const contact = await getTicketContact(token, ticketId);
    if (!contact) {
      const noteText = `[Draft reply from ${user.name}] — could not find associated contact, saved as note instead:\n\n${body}`;
      await addNoteToTicket(token, ticketId, noteText);
      return new Response(JSON.stringify({
        success: true,
        mode: "note",
        message: "No contact email found. Saved as note on the ticket instead."
      }), { status: 200, headers: { "Content-Type": "application/json" }});
    }

    await createEmailEngagement(token, ticketId, contact, body, user.email, user.name);

    const state = getStore({ name: "triage-state", consistency: "strong" });
    const replies = (await state.get("replies", { type: "json" })) || {};
    replies[ticketId] = { by: user.name, at: new Date().toISOString() };
    await state.setJSON("replies", replies);

    return new Response(JSON.stringify({
      success: true,
      mode: "email",
      sentTo: contact.properties.email,
      message: `Email logged to ${contact.properties.email} and associated with ticket.`
    }), { status: 200, headers: { "Content-Type": "application/json" }});
  } catch (err) {
    console.error("send-reply failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
