import { invoke } from "@tauri-apps/api/core";
import { TauriRpcClient } from "$lib/rpc";
import { devLog } from "$lib/utils/devLog";
import type { ContentBlock, ConversationMessage, ConversationState, RpcEvent } from "$lib/rpc";
import type { TaskMetadata } from "$lib/types/task";

const POLL_INTERVAL_MS = 100;
const TASK_SWITCH_TIMEOUT_MS = 5000;
const RPC_READY_TIMEOUT_MS = 6000;
const RPC_COMMAND_TIMEOUT_MS = 5000;
const TASK_STATE_MOUNT_CHECK_TIMEOUT_MS = 1500;
const SESSION_DIR_CREATE_TIMEOUT_MS = 2000;
const SESSION_WRITE_TIMEOUT_MS = 5000;
const SESSION_SWITCH_TIMEOUT_MS = 3000;

export const TASK_SESSION_FILE = "/mnt/taskstate/session.json";

export type RuntimeMode = "v1" | "v2_taskd";

export interface RuntimeFlags {
    runtimeV2Taskd: boolean;
    runtimeV2Sync: boolean;
    mode: RuntimeMode;
}

export interface RuntimeServiceSnapshot {
    rpcConnected: boolean;
    rpcConnecting: boolean;
    rpcError: string | null;
    currentTaskId: string | null;
    currentWorkingFolder: string | null;
    currentSessionFile: string | null;
    taskSwitching: boolean;
    mode: RuntimeMode;
    runtimeV2Taskd: boolean;
    runtimeV2Sync: boolean;
}

interface VmStatusResponse {
    status: "starting" | "ready" | "stopped";
    rpcPath: string | null;
    logPath: string | null;
}

interface PendingRpcResponse {
    resolve: (payload: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

interface RuntimeServiceCallbacks {
    onRpcPayload?: (payload: Record<string, unknown>) => void;
    onRawRpcMessage?: (message: string) => void;
    onConnected?: () => void;
    onError?: (message: string) => void;
    onStateRefreshRequested?: () => void;
}

interface TaskSwitchDeps {
    saveConversationForTask(taskId: string | null): Promise<void>;
    loadConversationForTask(taskId: string | null): Promise<void>;
    getConversationState(): ConversationState;
}

interface FolderChangeDeps {
    persistWorkingFolderForActiveTask(folder: string | null): Promise<void>;
    getConversationState(): ConversationState;
}

function normalizeFlags(flags: Partial<RuntimeFlags> | null | undefined): RuntimeFlags {
    const runtimeV2Taskd = flags?.runtimeV2Taskd === true;
    const runtimeV2Sync = runtimeV2Taskd && flags?.runtimeV2Sync === true;

    return {
        runtimeV2Taskd,
        runtimeV2Sync,
        mode: runtimeV2Taskd ? "v2_taskd" : "v1",
    };
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function contentBlockToSessionText(block: ContentBlock): string | null {
    switch (block.type) {
        case "text": {
            const text = block.text.trim();
            return text.length > 0 ? text : null;
        }
        case "tool_call": {
            const name = (block.name || "tool").trim();
            const input = block.input.trim();
            return input.length > 0 ? `[tool:${name}] ${input}` : `[tool:${name}]`;
        }
        case "tool_result": {
            const output = block.output.trim();
            if (output.length === 0) {
                return null;
            }
            return block.isError ? `[tool-error] ${output}` : output;
        }
        default:
            return null;
    }
}

function conversationToSessionJsonl(taskId: string, messages: ConversationMessage[]): string {
    const now = new Date().toISOString();
    const lines: string[] = [
        JSON.stringify({
            type: "session",
            version: 3,
            id: taskId,
            timestamp: now,
            cwd: "/",
        }),
    ];

    let parentId: string | null = null;

    for (const message of messages) {
        if (message.role !== "user") {
            continue;
        }

        const text = message.blocks
            .map(contentBlockToSessionText)
            .filter((part): part is string => Boolean(part))
            .join("\n\n")
            .trim();

        if (!text) {
            continue;
        }

        const entryId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
        lines.push(
            JSON.stringify({
                type: "message",
                id: entryId,
                parentId,
                timestamp: new Date().toISOString(),
                message: {
                    role: "user",
                    content: [{ type: "text", text }],
                    timestamp: Date.now(),
                },
            }),
        );

        parentId = entryId;
    }

    return `${lines.join("\n")}\n`;
}

function rpcBashExitCode(response: Record<string, unknown>): number {
    if (response.type !== "response" || response.command !== "bash") {
        return 0;
    }

    const data = typeof response.data === "object" && response.data ? (response.data as Record<string, unknown>) : null;
    return typeof data?.exitCode === "number" ? data.exitCode : 0;
}

function ensureRpcCommandSuccess(response: Record<string, unknown>, label: string) {
    if (response.type !== "response") {
        return;
    }

    if (response.success === false) {
        const error = typeof response.error === "string" ? response.error : `${label} failed`;
        throw new Error(error);
    }

    if (response.command === "bash") {
        const exitCode = rpcBashExitCode(response);
        if (exitCode !== 0) {
            const data =
                typeof response.data === "object" && response.data ? (response.data as Record<string, unknown>) : null;
            const output = typeof data?.output === "string" ? data.output.trim() : "";
            throw new Error(output || `${label} failed with exit code ${exitCode}`);
        }
    }
}

export class RuntimeService {
    private callbacks: RuntimeServiceCallbacks;
    private snapshot: RuntimeServiceSnapshot;
    private listeners = new Set<(snapshot: RuntimeServiceSnapshot) => void>();
    private rpcClient: TauriRpcClient | null = null;
    private pendingRpcResponses = new Map<string, PendingRpcResponse>();

    constructor(flags: RuntimeFlags, callbacks: RuntimeServiceCallbacks = {}) {
        const normalized = normalizeFlags(flags);
        this.callbacks = callbacks;
        this.snapshot = {
            rpcConnected: false,
            rpcConnecting: false,
            rpcError: null,
            currentTaskId: null,
            currentWorkingFolder: null,
            currentSessionFile: null,
            taskSwitching: false,
            mode: normalized.mode,
            runtimeV2Taskd: normalized.runtimeV2Taskd,
            runtimeV2Sync: normalized.runtimeV2Sync,
        };
    }

    static async loadFlags(): Promise<RuntimeFlags> {
        try {
            const flags = await invoke<RuntimeFlags>("runtime_flags");
            return normalizeFlags(flags);
        } catch {
            return normalizeFlags(null);
        }
    }

    static async refreshVmLogPath(): Promise<string | null> {
        try {
            const status = await invoke<VmStatusResponse>("vm_status");
            return status.logPath;
        } catch {
            return null;
        }
    }

    subscribe(listener: (snapshot: RuntimeServiceSnapshot) => void) {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): RuntimeServiceSnapshot {
        return this.snapshot;
    }

    getRpcClient(): TauriRpcClient | null {
        return this.rpcClient;
    }

    async send(command: Record<string, unknown>) {
        if (!this.rpcClient) {
            throw new Error("RPC client unavailable");
        }

        await this.rpcClient.send(command);
    }

    async connectRpc() {
        devLog("RuntimeService", "connectRpc start");
        if (this.rpcClient || this.snapshot.rpcConnecting) {
            return;
        }

        this.patch({ rpcConnecting: true, rpcError: null });

        const client = new TauriRpcClient();
        this.rpcClient = client;
        client.subscribe((event) => this.handleRpcEvent(event));

        try {
            devLog(
                "RuntimeService",
                `calling client.connect with folder: ${this.snapshot.currentWorkingFolder ?? "none"}, task: ${
                    this.snapshot.currentTaskId ?? "none"
                }`,
            );
            await this.connectForMode(client);
            devLog("RuntimeService", "client.connect returned");
        } catch (error) {
            devLog("RuntimeService", `connectRpc error: ${error}`);
            const message = error instanceof Error ? error.message : String(error);
            this.patch({ rpcConnected: false, rpcError: message });
            this.clearPendingRpcResponses(message || "Failed to connect RPC");
            this.rpcClient = null;
            this.callbacks.onError?.(message);
            await client.disconnect().catch(() => undefined);
        } finally {
            devLog("RuntimeService", "connectRpc done");
            this.patch({ rpcConnecting: false });
        }
    }

    async disconnectRpc() {
        if (!this.rpcClient) {
            return;
        }

        await this.rpcClient.disconnect();
        this.clearPendingRpcResponses("RPC disconnected");
        this.rpcClient = null;
        this.patch({
            rpcConnected: false,
            rpcError: null,
        });
    }

    async waitForTaskSwitchComplete(timeoutMs = TASK_SWITCH_TIMEOUT_MS): Promise<void> {
        await this.waitForCondition(() => !this.snapshot.taskSwitching, timeoutMs, "Task switch still in progress");
    }

    async waitForRpcReady(timeoutMs = RPC_READY_TIMEOUT_MS): Promise<void> {
        await this.waitForCondition(() => this.snapshot.rpcConnected, timeoutMs, "RPC not ready");
    }

    async handleTaskSwitch(newTask: TaskMetadata | null, deps: TaskSwitchDeps): Promise<void> {
        if (this.snapshot.mode === "v2_taskd") {
            await this.handleTaskSwitchV2Taskd(newTask, deps);
            return;
        }

        await this.handleTaskSwitchV1(newTask, deps);
    }

    async handleFolderChange(folder: string | null, deps: FolderChangeDeps): Promise<void> {
        if (this.snapshot.mode === "v2_taskd") {
            await this.handleFolderChangeV2Taskd(folder, deps);
            return;
        }

        await this.handleFolderChangeV1(folder, deps);
    }

    private async connectForMode(client: TauriRpcClient) {
        if (this.snapshot.mode === "v2_taskd") {
            devLog("RuntimeService", "runtime_v2_taskd enabled; using v2 compatibility adapter");
            await client.connect(this.snapshot.currentWorkingFolder, this.snapshot.currentTaskId);
            return;
        }

        await client.connect(this.snapshot.currentWorkingFolder, this.snapshot.currentTaskId);
    }

    private async handleTaskSwitchV1(newTask: TaskMetadata | null, deps: TaskSwitchDeps) {
        const newTaskId = newTask?.id ?? null;
        const oldTaskId = this.snapshot.currentTaskId;
        const previousFolder = this.snapshot.currentWorkingFolder;

        if (newTaskId === oldTaskId) {
            return;
        }

        devLog("RuntimeService", `Task switch: ${oldTaskId} -> ${newTaskId}`);

        this.patch({ taskSwitching: true });

        try {
            await deps.saveConversationForTask(oldTaskId);
            await deps.loadConversationForTask(newTaskId);

            const nextFolder = newTask?.workingFolder ?? null;
            this.patch({
                currentTaskId: newTaskId,
                currentWorkingFolder: nextFolder,
                currentSessionFile: newTaskId ? TASK_SESSION_FILE : null,
            });

            if (!newTaskId || !this.rpcClient) {
                return;
            }

            const folderChanged = nextFolder !== previousFolder;
            const reason = folderChanged
                ? "Restarting VM for task switch (folder change)..."
                : "Restarting VM for task switch...";

            await this.restartVm(reason);
            await this.ensureTaskSessionReady(newTaskId, TASK_SESSION_FILE, deps.getConversationState());
        } finally {
            this.patch({ taskSwitching: false });
        }
    }

    private async handleTaskSwitchV2Taskd(newTask: TaskMetadata | null, deps: TaskSwitchDeps) {
        devLog("RuntimeService", "runtime_v2_taskd task switch requested; using v1 compatibility path");
        await this.handleTaskSwitchV1(newTask, deps);
    }

    private async handleFolderChangeV1(folder: string | null, deps: FolderChangeDeps) {
        this.patch({
            currentWorkingFolder: folder,
            taskSwitching: true,
        });
        devLog("RuntimeService", `Working folder changed: ${folder}`);

        try {
            await deps.persistWorkingFolderForActiveTask(folder);
            await this.restartVm("Restarting VM with new folder...");

            if (this.snapshot.currentTaskId) {
                await this.ensureTaskSessionReady(
                    this.snapshot.currentTaskId,
                    TASK_SESSION_FILE,
                    deps.getConversationState(),
                );
            }
        } finally {
            this.patch({ taskSwitching: false });
        }
    }

    private async handleFolderChangeV2Taskd(folder: string | null, deps: FolderChangeDeps) {
        devLog("RuntimeService", "runtime_v2_taskd folder change requested; using v1 compatibility path");
        await this.handleFolderChangeV1(folder, deps);
    }

    private emitSnapshot() {
        for (const listener of this.listeners) {
            listener(this.snapshot);
        }
    }

    private patch(next: Partial<RuntimeServiceSnapshot>) {
        this.snapshot = { ...this.snapshot, ...next };
        this.emitSnapshot();
    }

    private markConnected() {
        if (this.snapshot.rpcConnected) {
            return;
        }

        this.patch({
            rpcConnected: true,
            rpcError: null,
        });
        this.callbacks.onConnected?.();
    }

    private handleRpcEvent(event: RpcEvent) {
        if (event.type === "ready") {
            this.markConnected();
            return;
        }

        if (event.type === "error") {
            const message = typeof event.message === "string" ? event.message : "Runtime error";
            this.patch({
                rpcError: message,
                rpcConnected: false,
            });
            this.clearPendingRpcResponses(message);
            this.callbacks.onError?.(message);
            return;
        }

        if (event.type === "rpc" && typeof event.message === "string") {
            this.markConnected();

            try {
                const parsed = JSON.parse(event.message) as Record<string, unknown>;
                this.resolvePendingRpcResponse(parsed);
                this.callbacks.onRpcPayload?.(parsed);
            } catch {
                this.callbacks.onRawRpcMessage?.(event.message);
            }
        }
    }

    private clearPendingRpcResponses(reason: string) {
        for (const [id, pending] of this.pendingRpcResponses) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(reason));
            this.pendingRpcResponses.delete(id);
        }
    }

    private resolvePendingRpcResponse(payload: Record<string, unknown>) {
        if (payload.type !== "response") {
            return;
        }

        const responseId = typeof payload.id === "string" ? payload.id : null;
        if (!responseId) {
            return;
        }

        const pending = this.pendingRpcResponses.get(responseId);
        if (!pending) {
            return;
        }

        clearTimeout(pending.timeout);
        this.pendingRpcResponses.delete(responseId);
        pending.resolve(payload);
    }

    private async sendRpcCommandWithResponse(
        command: Record<string, unknown>,
        timeoutMs = RPC_COMMAND_TIMEOUT_MS,
    ): Promise<Record<string, unknown>> {
        if (!this.rpcClient) {
            throw new Error("RPC client unavailable");
        }

        const id = crypto.randomUUID();
        const client = this.rpcClient;

        return await new Promise<Record<string, unknown>>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRpcResponses.delete(id);
                reject(new Error(`RPC command timed out: ${String(command.type ?? "unknown")}`));
            }, timeoutMs);

            this.pendingRpcResponses.set(id, { resolve, reject, timeout });

            void client.send({ id, ...command }).catch((error) => {
                clearTimeout(timeout);
                this.pendingRpcResponses.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }

    private async isTaskStateMounted() {
        const response = await this.sendRpcCommandWithResponse(
            {
                type: "bash",
                command: "grep -F ' /mnt/taskstate ' /proc/mounts >/dev/null",
            },
            TASK_STATE_MOUNT_CHECK_TIMEOUT_MS,
        );

        if (response.type !== "response" || response.command !== "bash") {
            return false;
        }

        return rpcBashExitCode(response) === 0;
    }

    private async restoreTaskSessionInVm(taskId: string, sessionPath: string, state: ConversationState) {
        if (!this.rpcClient || !this.snapshot.rpcConnected) {
            return;
        }

        const slashIndex = sessionPath.lastIndexOf("/");
        const sessionDir = slashIndex >= 0 ? sessionPath.slice(0, slashIndex) : "/tmp/piwork/sessions";

        const mkdirResponse = await this.sendRpcCommandWithResponse(
            {
                type: "bash",
                command: `mkdir -p ${shellQuote(sessionDir)}`,
            },
            SESSION_DIR_CREATE_TIMEOUT_MS,
        );
        ensureRpcCommandSuccess(mkdirResponse, "mkdir session dir");

        if (state.messages.length > 0) {
            const sessionJsonl = conversationToSessionJsonl(taskId, state.messages);

            let delimiter = `__PIWORK_SESSION_${crypto.randomUUID().replaceAll("-", "_")}__`;
            while (sessionJsonl.includes(delimiter)) {
                delimiter = `__PIWORK_SESSION_${crypto.randomUUID().replaceAll("-", "_")}__`;
            }

            const writeResponse = await this.sendRpcCommandWithResponse(
                {
                    type: "bash",
                    command: `cat > ${shellQuote(sessionPath)} <<'${delimiter}'\n${sessionJsonl}${delimiter}\n`,
                },
                SESSION_WRITE_TIMEOUT_MS,
            );
            ensureRpcCommandSuccess(writeResponse, "write session file");
            devLog("RuntimeService", `Hydrated VM session for task ${taskId}`);
        }

        const switchResponse = await this.sendRpcCommandWithResponse(
            {
                type: "switch_session",
                sessionPath,
            },
            SESSION_SWITCH_TIMEOUT_MS,
        );
        ensureRpcCommandSuccess(switchResponse, "switch_session");
        devLog("RuntimeService", `Switched RPC session to ${sessionPath}`);

        this.callbacks.onStateRefreshRequested?.();
    }

    private async ensureTaskSessionReady(taskId: string, sessionPath: string, state: ConversationState) {
        await this.waitForRpcReady().catch(() => undefined);
        if (!this.rpcClient || !this.snapshot.rpcConnected) {
            return;
        }

        try {
            const mounted = await this.isTaskStateMounted();
            if (mounted) {
                devLog("RuntimeService", "Task state mount detected; using persisted session file");
                this.callbacks.onStateRefreshRequested?.();
                return;
            }

            devLog("RuntimeService", "Task state mount missing; hydrating session from host transcript");
            await this.restoreTaskSessionInVm(taskId, sessionPath, state);
        } catch (error) {
            devLog("RuntimeService", `Failed to prepare task session: ${error}`);
        }
    }

    private async waitForCondition(condition: () => boolean, timeoutMs: number, timeoutMessage: string): Promise<void> {
        if (condition()) {
            return;
        }

        const startedAt = Date.now();
        await new Promise<void>((resolve, reject) => {
            const timer = setInterval(() => {
                if (condition()) {
                    clearInterval(timer);
                    resolve();
                    return;
                }

                if (Date.now() - startedAt > timeoutMs) {
                    clearInterval(timer);
                    reject(new Error(timeoutMessage));
                }
            }, POLL_INTERVAL_MS);
        });
    }

    private async restartVm(reason: string) {
        if (!this.rpcClient) {
            return;
        }

        devLog("RuntimeService", reason);
        this.patch({ rpcConnected: false });
        await this.rpcClient.stopVm();
        this.rpcClient = null;
        await this.connectRpc();
    }
}
