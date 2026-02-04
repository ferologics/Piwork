import type { RpcClient, RpcEvent, RpcListener } from "$lib/rpc/types";

export interface MockRpcOptions {
    delayMs?: number;
}

export class MockRpcClient implements RpcClient {
    private listeners = new Set<RpcListener>();
    private timers: Array<ReturnType<typeof setTimeout>> = [];
    private events: RpcEvent[];
    private delayMs: number;

    public sentCommands: Record<string, unknown>[] = [];

    constructor(events: RpcEvent[], options: MockRpcOptions = {}) {
        this.events = events;
        this.delayMs = options.delayMs ?? 20;
    }

    static fromJsonl(jsonl: string, options: MockRpcOptions = {}) {
        const events = parseJsonl(jsonl);
        return new MockRpcClient(events, options);
    }

    async connect(_workingFolder?: string | null, _sessionFile?: string | null) {
        this.startStreaming();
    }

    async disconnect() {
        this.stopStreaming();
    }

    async stopVm() {
        this.stopStreaming();
    }

    async send(command: Record<string, unknown>) {
        this.sentCommands.push(command);
    }

    subscribe(listener: RpcListener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private startStreaming() {
        this.stopStreaming();

        this.events.forEach((event, index) => {
            const timer = setTimeout(() => {
                this.emit(event);
            }, this.delayMs * index);
            this.timers.push(timer);
        });
    }

    private stopStreaming() {
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers = [];
    }

    private emit(event: RpcEvent) {
        this.listeners.forEach((listener) => listener(event));
    }
}

export function parseJsonl(jsonl: string) {
    return jsonl
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RpcEvent);
}
