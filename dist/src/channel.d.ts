import { type ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { type NatsChannelConfig } from "./config.js";
export declare const PLUGIN_ID = "openclaw-nats-channel";
export declare const CHANNEL_ID: "nats";
export type ResolvedNatsAccount = NatsChannelConfig & {
    accountId: string;
};
export declare const natsChannelPlugin: ChannelPlugin<ResolvedNatsAccount>;
//# sourceMappingURL=channel.d.ts.map