// Setup entry — lightweight onboarding-only export.
// See: https://docs.openclaw.ai/plugins/sdk-channel-plugins
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { natsChannelPlugin } from "./src/channel.js";
export default defineSetupPluginEntry(natsChannelPlugin);
//# sourceMappingURL=setup-entry.js.map