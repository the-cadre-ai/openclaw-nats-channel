// Main entry — built against the openclaw 2026.5.x plugin SDK.
// See: https://docs.openclaw.ai/plugins/sdk-channel-plugins
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { natsChannelPlugin, PLUGIN_ID } from "./src/channel.js";
const entry = defineChannelPluginEntry({
    id: PLUGIN_ID,
    name: "OpenClaw NATS Channel",
    description: "Bridge NATS subjects to the OpenClaw chat model. Inbound NATS messages are treated as prompts; LLM responses are published back to NATS.",
    plugin: natsChannelPlugin,
});
export default entry;
//# sourceMappingURL=index.js.map