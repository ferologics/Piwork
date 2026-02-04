import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { devLog } from "$lib/utils/devLog";
import type { RpcClient, RpcEvent, RpcListener } from "$lib/rpc/types";

export class TauriRpcClient implements RpcClient {
    private unlisten: (() => void) | null = null;
    private listeners = new Set<RpcListener>();

    async connect() {
        devLog("RpcClient", "connect start");
        if (this.unlisten) return;
        devLog("RpcClient", "setting up event listener");
        const unlisten = await listen<{ event: string; message: string }>("vm_event", ({ payload }) => {
            devLog("RpcClient", `vm_event: ${payload.event}`);
            const event: RpcEvent = {
                type: payload.event,
                message: payload.message,
            };
            this.listeners.forEach((listener) => listener(event));
        });
        this.unlisten = unlisten;

        devLog("RpcClient", "calling vm_start");
        await invoke("vm_start");
        devLog("RpcClient", "vm_start returned");
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
