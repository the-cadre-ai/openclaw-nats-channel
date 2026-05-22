import { connect, } from "@nats-io/transport-node";
export class NatsClient {
    opts;
    nc;
    subs = [];
    constructor(opts) {
        this.opts = opts;
    }
    async connect() {
        this.nc = await connect({
            servers: this.opts.servers,
            ...(this.opts.token ? { token: this.opts.token } : {}),
        });
    }
    async subscribe(subject, queue, handler) {
        if (!this.nc)
            throw new Error("NatsClient.connect() not called");
        const sub = this.nc.subscribe(subject, { queue });
        this.subs.push(sub);
        (async () => {
            for await (const m of sub) {
                try {
                    const headers = m.headers
                        ? Object.fromEntries([...m.headers.keys()].map((k) => [k, m.headers.values(k)]))
                        : undefined;
                    await handler({
                        subject: m.subject,
                        reply: m.reply,
                        data: m.data,
                        headers,
                    });
                }
                catch (err) {
                    // Swallow per-message failures so the subscription stays alive.
                    // Real logging is wired by core via the plugin host.
                    console.error("[nats-channel] inbound handler error", err);
                }
            }
        })().catch((err) => console.error("[nats-channel] subscription loop error", err));
    }
    async publish(subject, data) {
        if (!this.nc)
            throw new Error("NatsClient.connect() not called");
        this.nc.publish(subject, data);
        await this.nc.flush();
    }
    async drain() {
        if (!this.nc)
            return;
        await this.nc.drain();
        this.nc = undefined;
        this.subs = [];
    }
}
//# sourceMappingURL=nats-client.js.map