import {
  connect,
  type NatsConnection,
  type Subscription,
} from "@nats-io/transport-node";

export interface NatsClientOptions {
  servers: string | string[];
  /** Optional bearer token. Omit for servers configured without auth. */
  token?: string;
}

export interface InboundMessage {
  subject: string;
  reply?: string;
  data: Uint8Array;
  headers?: Record<string, string[]>;
}

export type InboundHandler = (msg: InboundMessage) => Promise<void> | void;

export class NatsClient {
  private nc?: NatsConnection;
  private subs: Subscription[] = [];

  constructor(private readonly opts: NatsClientOptions) {}

  async connect(): Promise<void> {
    this.nc = await connect({
      servers: this.opts.servers,
      ...(this.opts.token ? { token: this.opts.token } : {}),
    });
  }

  async subscribe(
    subject: string,
    queue: string,
    handler: InboundHandler,
  ): Promise<void> {
    if (!this.nc) throw new Error("NatsClient.connect() not called");
    const sub = this.nc.subscribe(subject, { queue });
    this.subs.push(sub);
    (async () => {
      for await (const m of sub) {
        try {
          const headers: Record<string, string[]> | undefined = m.headers
            ? Object.fromEntries(
                [...m.headers.keys()].map((k) => [k, m.headers!.values(k)]),
              )
            : undefined;
          await handler({
            subject: m.subject,
            reply: m.reply,
            data: m.data,
            headers,
          });
        } catch (err) {
          // Swallow per-message failures so the subscription stays alive.
          // Real logging is wired by core via the plugin host.
          console.error("[nats-channel] inbound handler error", err);
        }
      }
    })().catch((err) =>
      console.error("[nats-channel] subscription loop error", err),
    );
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    if (!this.nc) throw new Error("NatsClient.connect() not called");
    this.nc.publish(subject, data);
    await this.nc.flush();
  }

  async drain(): Promise<void> {
    if (!this.nc) return;
    await this.nc.drain();
    this.nc = undefined;
    this.subs = [];
  }
}
