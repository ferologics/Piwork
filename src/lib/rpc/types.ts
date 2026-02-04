export type RpcEvent = Record<string, unknown> & {
    type: string;
};

export type RpcListener = (event: RpcEvent) => void;

export interface RpcClient {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(command: Record<string, unknown>): Promise<void>;
    subscribe(listener: RpcListener): () => void;
}
