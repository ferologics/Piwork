import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RpcClient, RpcEvent, RpcListener } from "$lib/rpc/types";

export class TauriRpcClient implements RpcClient {
    private unlisten: (() => void) | null = null;
    private listeners = new Set<RpcListener>();

    async connect() {
        if (this.unlisten) return;
        const unlisten = await listen<{ event: string; message: string }>("vm_event", ({ payload }) => {
            const event: RpcEvent = {
                type: payload.event,
                message: payload.message,
            };
            this.listeners.forEach((listener) => listener(event));
        });
        this.unlisten = unlisten;

        await invoke("vm_start");
    }

    async disconnect() {
        if (this.unlisten) {
            this.unlisten();
            this.unlisten = null;
        }
        await invoke("vm_stop");
    }

    async send(command: Record<string, unknown>) {
        await invoke("rpc_send", { message: JSON.stringify(command) });
    }

    subscribe(listener: RpcListener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
