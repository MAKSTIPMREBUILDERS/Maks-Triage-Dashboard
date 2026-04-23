import { getStore } from "@netlify/blobs";

const HUBSPOT_API = "https://api.hubapi.com";
const SUPPORT_PIPELINE = "4706688";
const PIPELINE_STAGE_OPEN = "15378592";

// Priority classification rules — derived from content analysis
function classifyPriority(ticket) {
  const subject = (ticket.properties.subject || "").toLowerCase();
  const content = (ticket.properties.content || "").toLowerCase();
  const text = subject + " " + content;

  // On fire — legal threats, refund demands, safety issues, explicit anger
  if (
    text.includes("chargeback") ||
    text.includes("proceed with") ||
    text.includes("full refund") && text.includes("return") ||
    text.includes("no more excuses") ||
    text.includes("need answers") ||
    text.includes("tired of being") ||
    ticket.properties.hs_ticket_priority === "URGENT" ||
    (text.includes("refund") && text.includes("called") && text.includes("twice"))
  ) {
    return "fire";
  }

  // Core/refund — cores and rentals that we owe money back on
  if (
    text.includes("core return") ||
    text.includes("core refund") ||
    text.includes("rental refund") ||
    text.includes("already returned") ||
    text.includes("core deposit") ||
    text.includes("return label") ||
    (text.includes("core") && text.includes("refund")) ||
    (subject.includes("cra-") || subject.includes("core")) ||
    (text.includes("rental") && (text.includes("refund") || text.includes("returned")))
  ) {
    return "core";
  }

  // Hot — warranty, defective parts, shop customers waiting
  if (
    text.includes("warranty") ||
    text.includes("defective") ||
    text.includes("not working") ||
    text.includes("does not work") ||
    text.includes("incorrect") ||
    text.includes("wrong part") ||
    text.includes("loaner") ||
    text.includes("exchange")
  ) {
    return "hot";
  }

  // Stale — old purchases out of warranty
  if (text.match(/20(1[5-9]|2[0-3])/) && text.includes("bought")) {
    return "stale";
  }

  return "warm";
}

// Draft response generator — heuristic-based starting points
function generateDraft(ticket, priority) {
  const subject = ticket.properties.subject || "";
  const content = ticket.properties.content || "";
  const text = (subject + " " + content).toLowerCase();

  if (priority === "fire" && text.includes("chargeback")) {
    return `Hi — this is Mak. I am sorry you had to escalate to get my attention. We are going to make this right today.\n\nI am authorizing the full refund. Please ship the unit(s) back with the prepaid label we will email within the hour. Refund will hit your card within 3 business days of receipt, and I will personally review what went wrong on our end.\n\nPlease hold the chargeback and let us handle it the normal way.\n\nMak — 818-798-5558`;
  }

  if (priority === "core" && text.includes("already returned")) {
    return `You are right — I checked our receiving log. I am sorry for the automated reminder email, that should not have gone out. The core credit has been issued back to the original payment method and will post within 3-5 business days.\n\nWe will flag your account so this does not happen again. Thanks for your patience.`;
  }

  if (priority === "core" && text.includes("rental")) {
    return `Hi — I pulled up your file and you are correct, this should have been processed when we received it. Apologies for the delay.\n\nThe refund has been queued today and will post back to your card within 3-5 business days. You will get a confirmation email within the hour.`;
  }

  if (priority === "core" && (text.includes("label") || text.includes("return"))) {
    return `No problem — we will get you a fresh return label. I am emailing you a prepaid FedEx label right now. You can pack the core in any box, just make sure it is taped securely. Drop it at any FedEx location.\n\nOnce we receive and inspect the core, your core deposit will be refunded within 3-5 business days. Thanks for sending it back.`;
  }

  if (priority === "hot" && text.includes("warranty")) {
    return `Hi — yes, your order is within our warranty period. Here is the exchange process:\n\n1. I am emailing you a prepaid return label in the next few minutes\n2. Ship your current unit back using that label\n3. Once we receive and test it, we either rework it (48 hour turnaround) or ship a tested replacement\n\nTotal time from when you ship: about 1 week. Questions? Text us at 818-208-4234.`;
  }

  if (priority === "hot" && text.includes("loaner")) {
    return `We do have loaner units available for warranty work. Here is the plan: I am emailing you a prepaid return label right now, plus we will ship you a loaner unit same-day so you are not stuck without the truck. Install the loaner when it arrives, then ship yours to us. Turnaround on the rework will be 48 hours from when we receive it.\n\nIs the shipping address on the original order still good?`;
  }

  if (priority === "hot" && (text.includes("wrong") || text.includes("incorrect"))) {
    return `I am sorry — this should have been handled on day one. Let me look up your order right now and confirm the correct part for your vehicle. I will get back to you today with a confirmed ship date on the right unit, overnight at no cost to you, and a prepaid return label for the wrong one.\n\nIf you prefer a full refund instead, just say the word and we will process it today. Your call.`;
  }

  if (priority === "stale") {
    return `I am sorry to hear this happened. While your purchase is outside our standard warranty window, I do not want to leave you stranded. Here is what I can offer:\n\n(1) A 50% discount on a rebuild of your current unit (you ship it in, we make it right) or (2) a 25% discount on a new replacement. Either way, let me know and I will send you what you need.\n\nAgain, I am sorry — this is not the experience we want any customer to have.`;
  }

  return `Hi — thanks for reaching out. Let me pull up your order and get back to you today with a clear next step. If this is urgent, please call us at 818-798-5558 and reference your order number.`;
}

// Assignment suggestion based on content
function suggestAssignee(ticket, priority) {
  const text = ((ticket.properties.subject || "") + " " + (ticket.properties.content || "")).toLowerCase();

  if (priority === "fire") {
    if (text.includes("chargeback") || text.includes("legal")) return "Mak personally";
    return "Mak or senior tech";
  }
  if (priority === "core") return "Niel Jay";
  if (text.includes("warranty") || text.includes("exchange")) return "Kent";
  if (text.includes("dealer") || text.includes("parts advisor")) return "Euna";
  if (text.includes("callback") || text.includes("called")) return "Dexter";
  return "Kent";
}

// Extract a meaningful customer name
function extractCustomer(ticket) {
  const subject = ticket.properties.subject || "";
  const content = ticket.properties.content || "";

  // Try pulling a name from subject patterns like "- Name" or "#Order Name"
  const subjMatch = subject.match(/- ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/);
  if (subjMatch) return subjMatch[1];

  // Try pulling from email signatures
  const sigMatch = content.match(/(?:thanks|regards|best|sincerely),?\s*\n\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
  if (sigMatch) return sigMatch[1];

  // Try "From: Name" or "Hi, I'm Name"
  const nameMatch = content.match(/(?:from|name is|i am)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (nameMatch) return nameMatch[1];

  return subject.slice(0, 60) || "Customer";
}

// Extract order number
function extractOrder(ticket) {
  const text = (ticket.properties.subject || "") + " " + (ticket.properties.content || "");
  const match = text.match(/(?:order|#|REP-|RMA-|EXC-|REN-|CRA-|E-)[\s#]*([A-Z0-9-]{4,})/i);
  return match ? match[0].slice(0, 25) : "";
}

// Extract phone number
function extractPhone(ticket) {
  const content = ticket.properties.content || "";
  const match = content.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
  return match ? match[1].replace(/[-.\s]/g, "-") : "";
}

// Calculate days waiting
function daysWaiting(timestamp) {
  if (!timestamp) return 0;
  const then = new Date(timestamp).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function buildReason(ticket, priority, days) {
  const text = ((ticket.properties.subject || "") + " " + (ticket.properties.content || "")).toLowerCase();

  if (priority === "fire") {
    if (text.includes("chargeback")) return `Chargeback threat after ${days} days. Formal refund demand.`;
    if (text.includes("no more excuses")) return "Customer patience exhausted. Repeat business relationship at risk.";
    if (ticket.properties.hs_ticket_priority === "URGENT") return "Tagged URGENT in HubSpot.";
    return `Customer demanding resolution after ${days} days of waiting.`;
  }
  if (priority === "core") {
    if (text.includes("already returned")) return "Customer says core was already returned. Automated reminders going to wrong people.";
    if (text.includes("rental")) return "Rental return refund pending. Money we owe back.";
    return "Core or rental refund waiting. Direct cost if not processed.";
  }
  if (priority === "hot") {
    if (text.includes("warranty")) return "Warranty claim within coverage window.";
    if (text.includes("defective") || text.includes("not working")) return "Defective part, exchange needed.";
    return `Customer waiting ${days} days for warranty or exchange resolution.`;
  }
  if (priority === "stale") return "Out-of-warranty complaint. Handle gently to avoid negative review.";
  return `Open for ${days} days.`;
}

async function fetchTicketsFromHubSpot(token) {
  const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/tickets/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [
          { propertyName: "hs_last_message_from_visitor", operator: "EQ", value: "true" },
          { propertyName: "hs_pipeline", operator: "EQ", value: SUPPORT_PIPELINE },
          { propertyName: "hs_pipeline_stage", operator: "EQ", value: PIPELINE_STAGE_OPEN }
        ]
      }],
      properties: [
        "subject", "content", "hs_pipeline_stage", "hs_ticket_priority",
        "createdate", "hubspot_owner_id", "hs_last_message_from_visitor",
        "hs_last_message_received_at", "hs_lastcontacted", "hs_lastmodifieddate"
      ],
      sorts: [{ propertyName: "hs_last_message_received_at", direction: "ASCENDING" }],
      limit: 100
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HubSpot API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.results || [];
}

function processTicket(ticket) {
  const priority = classifyPriority(ticket);
  const days = daysWaiting(ticket.properties.hs_last_message_received_at);
  const waitedLabel = days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;

  return {
    id: ticket.id,
    hubspot_owner_id: ticket.properties.hubspot_owner_id || null,
    p: priority,
    cust: extractCustomer(ticket),
    order: extractOrder(ticket),
    phone: extractPhone(ticket),
    waited: waitedLabel,
    daysWaiting: days,
    waitingSince: ticket.properties.hs_last_message_received_at,
    assign: suggestAssignee(ticket, priority),
    reason: buildReason(ticket, priority, days),
    snippet: (ticket.properties.content || "").slice(0, 280).replace(/\s+/g, " ").trim() || ticket.properties.subject || "",
    subject: ticket.properties.subject || "",
    draft: generateDraft(ticket, priority)
  };
}

export default async function handler(req, context) {
  const token = Netlify.env.get("HUBSPOT_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "HUBSPOT_TOKEN not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const tickets = await fetchTicketsFromHubSpot(token);
    const processed = tickets.map(processTicket);

    const store = getStore({ name: "triage-cache", consistency: "strong" });
    await store.setJSON("tickets", {
      tickets: processed,
      fetchedAt: new Date().toISOString(),
      count: processed.length
    });

    return new Response(JSON.stringify({
      success: true,
      count: processed.length,
      fetchedAt: new Date().toISOString()
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("refresh-tickets failed:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

export const config = {
  schedule: "*/5 * * * *"
};
