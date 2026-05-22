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
export declare class NatsClient {
    private readonly opts;
    private nc?;
    private subs;
    constructor(opts: NatsClientOptions);
    connect(): Promise<void>;
    subscribe(subject: string, queue: string, handler: InboundHandler): Promise<void>;
    publish(subject: string, data: Uint8Array): Promise<void>;
    drain(): Promise<void>;
}
//# sourceMappingURL=nats-client.d.ts.map