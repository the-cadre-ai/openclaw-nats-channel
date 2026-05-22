import type { NatsChannelConfig } from "./config.js";
import { type InboundPayload, type NatsEnvelope } from "./envelope.js";
import type { InboundMessage } from "./nats-client.js";
export type RejectReason = "decode" | "missing-prompt" | "unsigned" | "bad-signature" | "stale" | "not-allowed";
export interface AcceptedInbound {
    ok: true;
    subject: string;
    reply?: string;
    envelope: NatsEnvelope<InboundPayload>;
}
export interface RejectedInbound {
    ok: false;
    reason: RejectReason;
    detail?: string;
}
export type InboundDecision = AcceptedInbound | RejectedInbound;
export declare function preProcess(msg: InboundMessage, config: NatsChannelConfig, now?: Date): InboundDecision;
export declare function sessionKey(subject: string, sender: string | undefined): string;
//# sourceMappingURL=inbound.d.ts.map