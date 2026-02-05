import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { devLog } from "$lib/utils/devLog";
import type { RpcClient, RpcEvent, RpcListener } from "$lib/rpc/types";

export class TauriRpcClient implements RpcClient {
    private unlisten: (() => void) | null = null;
    private listeners = new Set<RpcListener>();
    private connecting = false;

    async connect(workingFolder?: string | null, taskId?: string | null) {
        devLog("RpcClient", `connect start, workingFolder: ${workingFolder ?? "none"}, taskId: ${taskId ?? "none"}`);
        if (this.unlisten || this.connecting) {
            devLog("RpcClient", "already connected or connecting");
            return;
        }
        this.connecting = true;

        try {
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
            const result = await invoke<{ status: string }>("vm_start", {
                workingFolder: workingFolder ?? null,
                taskId: taskId ?? null,
            });
            devLog("RpcClient", `vm_start returned: ${JSON.stringify(result)}`);

            // If VM was already running and ready, emit a synthetic ready event
            if (result?.status === "ready") {
                devLog("RpcClient", "VM already ready, emitting ready event");
                const event: RpcEvent = { type: "ready", message: "" };
                this.listeners.forEach((listener) => listener(event));
            }
        } finally {
            this.connecting = false;
        }
    }

    async disconnect() {
        // Just detach the event listener - don't stop VM
        // VM persists across HMR, we just reconnect
        if (this.unlisten) {
            this.unlisten();
            this.unlisten = null;
        }
        this.connecting = false;
    }

    async stopVm() {
        // Actually stop the VM (for app close, not HMR)
        this.disconnect();
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
