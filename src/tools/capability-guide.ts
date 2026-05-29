import type { CompactEndpoint } from "../parser/index.js";

// Hints for commonly confused endpoints.
export const ENDPOINT_ANNOTATIONS: Record<string, string> = {
  "post-api-v1-chat_postMessage":
    "resolves #channel and @user names; processes @here/@all mentions; use when sending by channel name",
  "post-api-v1-chat_sendMessage":
    "needs rid (room ID, NOT user ID); supports tmid for threads; does NOT resolve @here, @all, @user mentions or #channel names — use postMessage if you need mention pings or channel-name lookup; to DM a user use postMessage with channel=@username instead",
  "get-api-v1-chat_search":
    "searches message text content by keyword in a room",

  "get-api-v1-im_history": "time-range filter: oldest/latest",
  "get-api-v1-im_messages": "paginated; no time filter",
  "get-api-v1-chat_getDiscussions": "use rooms_getDiscussions instead",

  "get-api-v1-channels_list": "all channels; sortable; full objects with _id",
  "get-api-v1-channels_list_joined": "only user's joined channels",
  "get-api-v1-rooms_getDiscussions": "preferred over chat variant",
  "get-api-v1-channels_history": "time-range: oldest/latest params",
  "get-api-v1-groups_history": "time-range; private groups",
  "get-api-v1-channels_messages": "paginated; public channels",
  "get-api-v1-groups_messages": "paginated; private groups",

  "post-api-v1-users_create": "admin-only",
  "post-api-v1-users_register": "self-registration",

  "get-api-v1-engagement-dashboard-messages-top-five-popular-channels":
    "max 5; no _id; analytics only",
};

// Notes shown before domain entries.
export const DOMAIN_NOTES: Record<string, string> = {
  rooms:
    "channels_* = public only. groups_* = private only. rooms_* = any type. Prefer rooms_* when type unknown.",
};

export function formatCapabilityGuide(endpoints: CompactEndpoint[]): string {
  if (endpoints.length === 0) {
    return "No endpoints found.";
  }

  const byDomain = new Map<string, Map<string, string>>();

  for (const ep of endpoints) {
    let entries = byDomain.get(ep.domain);
    if (!entries) {
      entries = new Map();
      byDomain.set(ep.domain, entries);
    }
    if (!entries.has(ep.summary)) {
      entries.set(ep.summary, ep.operationId);
    }
  }

  const sections: string[] = [];
  for (const [domain, entries] of byDomain) {
    const items = [...entries].map(([summary, opId]) => {
      const hint = ENDPOINT_ANNOTATIONS[opId];
      return hint ? `${summary} (${hint}) → ${opId}` : `${summary} → ${opId}`;
    });
    const note = DOMAIN_NOTES[domain];
    sections.push(
      note
        ? `## ${domain}\n${note}\n${items.join(", ")}`
        : `## ${domain}\n${items.join(", ")}`,
    );
  }

  return (
    `── Capability Guide ──\n\n` +
    sections.join("\n\n") +
    `\n\nUse the operationIds (after →) in workflow steps. Call get_endpoint_schemas with your chosen operationIds to get exact request/response schemas.`
  );
}
