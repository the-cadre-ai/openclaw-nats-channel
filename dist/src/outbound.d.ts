import type { NatsChannelConfig } from "./config.js";
import type { NatsClient } from "./nats-client.js";
export interface OutboundContext {
    inboundSubject: string;
    inboundEnvelopeId: string;
    inboundReplyTo?: string;
}
export interface SendTextParams {
    ctx: OutboundContext;
    text: string;
    pluginId: string;
}
export interface MessageReceipt {
    id: string;
    subject: string;
}
export declare function sendText(client: NatsClient, config: NatsChannelConfig, params: SendTextParams): Promise<MessageReceipt>;
//# sourceMappingURL=outbound.d.ts.map