import type { NatsChannelConfig } from "./config.js";
import { buildSigned, encode, type OutboundPayload } from "./envelope.js";
import type { NatsClient } from "./nats-client.js";
import { resolveOutboundSubject } from "./subject.js";

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

export async function sendText(
  client: NatsClient,
  config: NatsChannelConfig,
  params: SendTextParams,
): Promise<MessageReceipt> {
  const subject =
    params.ctx.inboundReplyTo ??
    resolveOutboundSubject(
      params.ctx.inboundSubject,
      config.inbound.subject,
      config.outbound.subjectTemplate,
    );

  const payload: OutboundPayload = { text: params.text };
  const envelope = buildSigned<OutboundPayload>({
    payload,
    inReplyTo: params.ctx.inboundEnvelopeId,
    sender: params.pluginId,
    secret: config.security.hmacSecret,
  });

  await client.publish(subject, encode(envelope));
  return { id: envelope.id, subject };
}
