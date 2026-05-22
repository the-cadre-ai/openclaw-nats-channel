import { buildSigned, encode } from "./envelope.js";
import { resolveOutboundSubject } from "./subject.js";
export async function sendText(client, config, params) {
    const subject = params.ctx.inboundReplyTo ??
        resolveOutboundSubject(params.ctx.inboundSubject, config.inbound.subject, config.outbound.subjectTemplate);
    const payload = { text: params.text };
    const envelope = buildSigned({
        payload,
        inReplyTo: params.ctx.inboundEnvelopeId,
        sender: params.pluginId,
        secret: config.security.hmacSecret,
    });
    await client.publish(subject, encode(envelope));
    return { id: envelope.id, subject };
}
//# sourceMappingURL=outbound.js.map