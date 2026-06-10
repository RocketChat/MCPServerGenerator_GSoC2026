import { formatCapabilityGuide } from "./capability-guide.js";
import type { CapabilityGuideSource } from "../parser/index.js";

export async function handleGetCapabilityGuide(parser: CapabilityGuideSource) {
  try {
    const endpoints = await parser.listEndpoints(parser.getAvailableDomains());
    const guide = formatCapabilityGuide(endpoints);
    return {
      content: [{ type: "text" as const, text: guide }],
    };
  } catch (err) {
    const domains = parser.getAvailableDomains();
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Failed to generate capability guide: ${err instanceof Error ? err.message : String(err)}\n\n` +
            `Available domains: ${domains.join(", ")}`,
        },
      ],
      isError: true,
    };
  }
}
