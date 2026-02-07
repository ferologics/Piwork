import { invoke } from "@tauri-apps/api/core";
import { TauriRpcClient } from "$lib/rpc";
import { devLog } from "$lib/utils/devLog";
import type { RpcEvent } from "$lib/rpc";
import type { TaskMetadata } from "$lib/types/task";

const POLL_INTERVAL_MS = 100;
const TASK_SWITCH_TIMEOUT_MS = 5000;
const RPC_READY_TIMEOUT_MS = 20_000;
const RPC_COMMAND_TIMEOUT_MS = 5000;
const MODEL_RPC_COMMAND_TIMEOUT_MS = 35_000;

export interface RuntimeServiceSnapshot {
    rpcConnected: boolean;
    rpcConnecting: boolean;
    rpcError: string | null;
    currentTaskId: string | null;
    currentWorkingFolder: string | null;
    currentSessionFile: string | null;
    workspaceRoot: string | null;
    taskSwitching: boolean;
}

export type RuntimeTaskBootstrapStatus = "not_started" | "pending" | "ready" | "errored";

export interface RuntimeTaskState {
    taskId: string;
    state: string;
    provider: string | null;
    model: string | null;
    thinkingLevel: string | null;
    promptInFlight: boolean;
    sessionFile: string | null;
    taskDir: string | null;
    outputsDir: string | null;
    uploadsDir: string | null;
    workDir: string | null;
    currentCwd: string | null;
    workingFolderRelative: string | null;
    bootstrapStatus: RuntimeTaskBootstrapStatus | null;
    bootstrapError: string | null;
    bootstrapUpdatedAt: string | null;
}

export interface RuntimeGetStateResult {
    activeTaskId: string | null;
    tasks: RuntimeTaskState[];
}

export interface RuntimeDiagResult {
    [key: string]: unknown;
}

export interface PiModelOption {
    id: string;
    name: string;
    provider: string | null;
}

interface VmStatusResponse {
    status: "starting" | "ready" | "stopped";
    rpcPath: string | null;
    logPath: string | null;
}

interface WorkingFolderValidation {
    folder: string;
    workspaceRoot: string;
    relativePath: string;
}

interface PendingRpcResponse {
    resolve: (payload: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

interface PendingTaskSwitch {
    taskId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

class TaskdError extends Error {
    code: string;
    retryable: boolean;

    constructor(code: string, message: string, retryable = false) {
        super(message);
        this.name = "TaskdError";
        this.code = code;
        this.retryable = retryable;
    }
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
}

interface FolderChangeDeps {
    persistWorkingFolderForActiveTask(folder: string | null): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function taskdSessionFileForTask(taskId: string): string {
    return `/sessions/${taskId}/session.json`;
}

function inferProviderFromModel(modelId: string | null | undefined): string | null {
    if (!modelId) {
        return null;
    }

    if (modelId.startsWith("claude")) {
        return "anthropic";
    }

    if (modelId.startsWith("gpt")) {
        return "openai-codex";
    }

    if (modelId.startsWith("gemini")) {
        return "google-gemini-cli";
    }

    return null;
}

function parseString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parseBootstrapStatus(value: unknown): RuntimeTaskBootstrapStatus | null {
    if (value === "not_started" || value === "pending" || value === "ready" || value === "errored") {
        return value;
    }

    return null;
}

function parseRuntimeTaskState(entry: unknown): RuntimeTaskState | null {
    if (!isRecord(entry)) {
        return null;
    }

    const taskId = parseString(entry.taskId);
    const state = parseString(entry.state);

    if (!taskId || !state) {
        return null;
    }

    return {
        taskId,
        state,
        provider: parseString(entry.provider),
        model: parseString(entry.model),
        thinkingLevel: parseString(entry.thinkingLevel),
        promptInFlight: entry.promptInFlight === true,
        sessionFile: parseString(entry.sessionFile),
        taskDir: parseString(entry.taskDir),
        outputsDir: parseString(entry.outputsDir),
        uploadsDir: parseString(entry.uploadsDir),
        workDir: parseString(entry.workDir),
        currentCwd: parseString(entry.currentCwd),
        workingFolderRelative: parseString(entry.workingFolderRelative),
        bootstrapStatus: parseBootstrapStatus(entry.bootstrapStatus),
        bootstrapError: parseString(entry.bootstrapError),
        bootstrapUpdatedAt: parseString(entry.bootstrapUpdatedAt),
    };
}

function parsePiModelOption(entry: unknown): PiModelOption | null {
    if (!isRecord(entry)) {
        return null;
    }

    const id = parseString(entry.id);
    if (!id) {
        return null;
    }

    return {
        id,
        name: parseString(entry.name) ?? id,
        provider: parseString(entry.provider),
    };
}

export class RuntimeService {
    private callbacks: RuntimeServiceCallbacks;
    private snapshot: RuntimeServiceSnapshot;
    private listeners = new Set<(snapshot: RuntimeServiceSnapshot) => void>();
    private rpcClient: TauriRpcClient | null = null;
    private pendingRpcResponses = new Map<string, PendingRpcResponse>();
    private pendingTaskSwitch: PendingTaskSwitch | null = null;
    private lastTaskReadyAt = new Map<string, number>();
    private workspaceRootInitialized = false;
    private workspaceRootLocked = false;
    private vmWorkspaceRoot: string | null = null;

    constructor(callbacks: RuntimeServiceCallbacks = {}) {
        this.callbacks = callbacks;
        this.snapshot = {
            rpcConnected: false,
            rpcConnecting: false,
            rpcError: null,
            currentTaskId: null,
            currentWorkingFolder: null,
            currentSessionFile: null,
            workspaceRoot: null,
            taskSwitching: false,
        };
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

    async runtimeGetState(): Promise<RuntimeGetStateResult> {
        await this.waitForRpcReady();
        const result = await this.sendTaskdCommand("runtime_get_state", {});
        const tasks = Array.isArray(result.tasks)
            ? result.tasks.map(parseRuntimeTaskState).filter((task): task is RuntimeTaskState => Boolean(task))
            : [];

        return {
            activeTaskId: parseString(result.activeTaskId),
            tasks,
        };
    }

    async runtimeDiag(): Promise<RuntimeDiagResult> {
        await this.waitForRpcReady();
        const result = await this.sendTaskdCommand("runtime_diag", {}, 10_000);
        return result;
    }

    async piGetAvailableModels(): Promise<{ models: PiModelOption[] }> {
        await this.waitForRpcReady();
        const result = await this.sendTaskdCommand("pi_get_available_models", {}, MODEL_RPC_COMMAND_TIMEOUT_MS);
        const models = Array.isArray(result.models)
            ? result.models.map(parsePiModelOption).filter((model): model is PiModelOption => Boolean(model))
            : [];

        return { models };
    }

    async piSetModel(provider: string, modelId: string): Promise<PiModelOption> {
        const normalizedProvider = provider.trim();
        const normalizedModelId = modelId.trim();

        if (!normalizedProvider || !normalizedModelId) {
            throw new Error("provider and modelId are required");
        }

        await this.waitForRpcReady();
        const result = await this.sendTaskdCommand(
            "pi_set_model",
            {
                provider: normalizedProvider,
                modelId: normalizedModelId,
            },
            MODEL_RPC_COMMAND_TIMEOUT_MS,
        );

        const selected = parsePiModelOption(result);
        if (!selected) {
            return {
                id: normalizedModelId,
                name: normalizedModelId,
                provider: normalizedProvider,
            };
        }

        return selected;
    }

    async sendExtensionUiResponse(payload: Record<string, unknown>): Promise<void> {
        await this.waitForRpcReady();
        await this.sendTaskdCommand("extension_ui_response", payload);
    }

    async sendPrompt(message: string) {
        const content = message.trim();
        if (!content) {
            throw new Error("Prompt message is empty");
        }

        await this.waitForRpcReady();
        const promptId = crypto.randomUUID();
        const result = await this.sendTaskdCommand(
            "prompt",
            {
                message: content,
                promptId,
            },
            RPC_COMMAND_TIMEOUT_MS,
        );

        if (result.accepted !== true) {
            throw new TaskdError("TASK_NOT_READY", "Prompt was not accepted", true);
        }
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
            await this.connectRuntime(client);
            devLog("RuntimeService", "client.connect returned");
        } catch (error) {
            devLog("RuntimeService", `connectRpc error: ${error}`);
            const message = error instanceof Error ? error.message : String(error);
            this.patch({ rpcConnected: false, rpcError: message });
            this.clearPendingRpcResponses(message || "Failed to connect RPC");
            this.rpcClient = null;
            this.vmWorkspaceRoot = null;
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
        this.vmWorkspaceRoot = null;
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
        await this.handleTaskSwitchRuntime(newTask, deps);
    }

    async handleFolderChange(folder: string | null, deps: FolderChangeDeps): Promise<void> {
        await this.handleFolderChangeRuntime(folder, deps);
    }

    private async connectRuntime(client: TauriRpcClient) {
        await this.ensureWorkspaceRootInitialized();
        const folderForConnect = this.snapshot.workspaceRoot ?? this.snapshot.currentWorkingFolder;

        await client.connect(folderForConnect, this.snapshot.currentTaskId);
        this.vmWorkspaceRoot = folderForConnect ?? null;
    }

    private async ensureWorkspaceRootInitialized() {
        if (this.workspaceRootInitialized) {
            return;
        }

        this.workspaceRootInitialized = true;

        try {
            const workspaceRoot = await invoke<string | null>("runtime_workspace_root");
            if (typeof workspaceRoot === "string" && workspaceRoot.trim().length > 0) {
                this.workspaceRootLocked = true;
                this.patch({ workspaceRoot });
            } else {
                this.workspaceRootLocked = false;
            }
        } catch (error) {
            this.workspaceRootLocked = false;
            devLog("RuntimeService", `Failed to resolve workspace root: ${error}`);
        }
    }

    private async restartVmWithWorkspaceRoot(): Promise<void> {
        const client = this.rpcClient;
        if (!client) {
            throw new Error("RPC client unavailable");
        }

        devLog(
            "RuntimeService",
            `Restarting VM to apply workspace root mount: ${this.snapshot.workspaceRoot ?? "(none)"}`,
        );

        this.clearPendingRpcResponses("VM restarting");
        this.patch({
            rpcConnected: false,
            rpcError: null,
        });

        await client.stopVm();
        this.vmWorkspaceRoot = null;
        await this.connectRuntime(client);
        await this.waitForRpcReady();
    }

    private async validateWorkingFolder(folder: string): Promise<WorkingFolderValidation> {
        const trimmed = folder.trim();
        if (!trimmed) {
            throw new Error("Working folder is required");
        }

        await this.ensureWorkspaceRootInitialized();

        const result = await invoke<WorkingFolderValidation>("runtime_validate_working_folder", {
            folder: trimmed,
            workspaceRoot: this.workspaceRootLocked ? this.snapshot.workspaceRoot : null,
        });

        const validatedFolder = typeof result?.folder === "string" ? result.folder : null;
        const workspaceRoot = typeof result?.workspaceRoot === "string" ? result.workspaceRoot : null;
        const relativePath = typeof result?.relativePath === "string" ? result.relativePath : null;

        if (!validatedFolder || !workspaceRoot || relativePath === null) {
            throw new Error("Invalid working folder validation response");
        }

        if (workspaceRoot !== this.snapshot.workspaceRoot) {
            this.patch({ workspaceRoot });
        }

        return {
            folder: validatedFolder,
            workspaceRoot,
            relativePath,
        };
    }

    private async handleTaskSwitchRuntime(newTask: TaskMetadata | null, deps: TaskSwitchDeps) {
        const newTaskId = newTask?.id ?? null;
        const oldTaskId = this.snapshot.currentTaskId;

        if (newTaskId === oldTaskId) {
            return;
        }

        devLog("RuntimeService", `Task switch: ${oldTaskId} -> ${newTaskId}`);
        this.patch({ taskSwitching: true, rpcError: null });

        try {
            await deps.saveConversationForTask(oldTaskId);
            await deps.loadConversationForTask(newTaskId);

            const nextFolder = newTask?.workingFolder ?? null;
            this.patch({
                currentTaskId: newTaskId,
                currentWorkingFolder: nextFolder,
                currentSessionFile: newTaskId ? taskdSessionFileForTask(newTaskId) : null,
            });

            if (!newTaskId || !newTask) {
                return;
            }

            await this.waitForRpcReady();

            let taskForRuntime = newTask;
            if (newTask.workingFolder) {
                const validated = await this.validateWorkingFolder(newTask.workingFolder);
                if (validated.folder !== newTask.workingFolder) {
                    taskForRuntime = {
                        ...newTask,
                        workingFolder: validated.folder,
                    };
                    this.patch({ currentWorkingFolder: validated.folder });
                }
            }

            const requiredWorkspaceRoot = this.snapshot.workspaceRoot;
            if (newTask.workingFolder && requiredWorkspaceRoot && this.vmWorkspaceRoot !== requiredWorkspaceRoot) {
                await this.restartVmWithWorkspaceRoot();
            }

            await this.ensureTaskdTaskReady(taskForRuntime);
            await this.switchTaskdTask(newTaskId);
            this.callbacks.onStateRefreshRequested?.();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.patch({ rpcError: message });
            this.callbacks.onError?.(message);
            throw error;
        } finally {
            this.patch({ taskSwitching: false });
        }
    }

    private async handleFolderChangeRuntime(folder: string | null, deps: FolderChangeDeps) {
        const taskId = this.snapshot.currentTaskId;
        const previousFolder = this.snapshot.currentWorkingFolder;
        const hasBoundFolder = Boolean(taskId && previousFolder);

        if (hasBoundFolder) {
            const requestedFolder = typeof folder === "string" ? folder.trim() : "";
            if (!requestedFolder || requestedFolder !== previousFolder) {
                throw new Error("Working folder is locked for this task. Create a new task to use a different folder.");
            }
            return;
        }

        const requestedFolder = typeof folder === "string" ? folder.trim() : "";
        if (!requestedFolder) {
            if (!taskId) {
                this.patch({ currentWorkingFolder: null });
            }
            return;
        }

        if (!taskId) {
            const validated = await this.validateWorkingFolder(requestedFolder);
            this.patch({ currentWorkingFolder: validated.folder });
            devLog("RuntimeService", `Draft working folder set: ${validated.folder}`);
            return;
        }

        this.patch({ taskSwitching: true, rpcError: null });

        try {
            const validated = await this.validateWorkingFolder(requestedFolder);
            const nextFolder = validated.folder;
            const nextRelativePath = validated.relativePath;

            if (previousFolder === nextFolder) {
                return;
            }

            this.patch({ currentWorkingFolder: nextFolder });
            await deps.persistWorkingFolderForActiveTask(nextFolder);

            if (!this.snapshot.rpcConnected) {
                devLog(
                    "RuntimeService",
                    "Initial working folder set while runtime disconnected; apply deferred until task resume",
                );
                return;
            }

            devLog("RuntimeService", `Applying initial working folder for active task ${taskId}: ${nextFolder}`);
            await this.waitForRpcReady();

            const requiredWorkspaceRoot = this.snapshot.workspaceRoot;
            if (requiredWorkspaceRoot && this.vmWorkspaceRoot !== requiredWorkspaceRoot) {
                await this.restartVmWithWorkspaceRoot();
            }

            await this.stopTaskdTaskIfPresent(taskId);
            await this.sendTaskdCommand("create_or_open_task", {
                taskId,
                workingFolder: nextFolder,
                workingFolderRelative: nextRelativePath,
            });
            await this.switchTaskdTask(taskId);
            this.callbacks.onStateRefreshRequested?.();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.patch({ rpcError: message });
            this.callbacks.onError?.(message);
            throw error;
        } finally {
            this.patch({ taskSwitching: false });
        }
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
                this.handleTaskdEvent(parsed);
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

        this.rejectPendingTaskSwitch(new Error(reason));
    }

    private resolvePendingRpcResponse(payload: Record<string, unknown>) {
        const responseId = typeof payload.id === "string" ? payload.id : null;
        if (!responseId) {
            return;
        }

        const isTaskdResponse = typeof payload.ok === "boolean";
        if (!isTaskdResponse) {
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

    private rejectPendingTaskSwitch(error: Error) {
        if (!this.pendingTaskSwitch) {
            return;
        }

        const pending = this.pendingTaskSwitch;
        pending.reject(error);
    }

    private waitForTaskReadyEvent(taskId: string, startedAt: number, timeoutMs = TASK_SWITCH_TIMEOUT_MS) {
        const readyAt = this.lastTaskReadyAt.get(taskId);
        if (typeof readyAt === "number" && readyAt >= startedAt) {
            return Promise.resolve();
        }

        this.rejectPendingTaskSwitch(new TaskdError("SWITCH_TIMEOUT", "Task switch superseded", true));

        return new Promise<void>((resolve, reject) => {
            const pending: PendingTaskSwitch = {
                taskId,
                timeout: setTimeout(() => {
                    if (this.pendingTaskSwitch === pending) {
                        this.pendingTaskSwitch = null;
                    }
                    reject(new TaskdError("SWITCH_TIMEOUT", `Timed out waiting for task_ready (${taskId})`, true));
                }, timeoutMs),
                resolve: () => {
                    if (this.pendingTaskSwitch === pending) {
                        this.pendingTaskSwitch = null;
                    }
                    clearTimeout(pending.timeout);
                    resolve();
                },
                reject: (error: Error) => {
                    if (this.pendingTaskSwitch === pending) {
                        this.pendingTaskSwitch = null;
                    }
                    clearTimeout(pending.timeout);
                    reject(error);
                },
            };

            this.pendingTaskSwitch = pending;
        });
    }

    private handleTaskdEvent(payload: Record<string, unknown>) {
        if (payload.type !== "event") {
            return;
        }

        const eventName = typeof payload.event === "string" ? payload.event : null;
        const taskId = typeof payload.taskId === "string" ? payload.taskId : null;

        if (!eventName || !taskId) {
            return;
        }

        if (eventName === "task_ready") {
            this.lastTaskReadyAt.set(taskId, Date.now());
            if (this.pendingTaskSwitch?.taskId === taskId) {
                this.pendingTaskSwitch.resolve();
            }
            return;
        }

        if (eventName !== "task_error") {
            return;
        }

        if (this.pendingTaskSwitch?.taskId !== taskId) {
            return;
        }

        const errorPayload = isRecord(payload.payload) ? payload.payload : {};
        const code = typeof errorPayload.code === "string" ? errorPayload.code : "INTERNAL_ERROR";
        const message =
            typeof errorPayload.message === "string" ? errorPayload.message : `Task switch failed for ${taskId}`;
        const retryable = code === "TASK_NOT_READY" || code === "SWITCH_TIMEOUT";

        this.pendingTaskSwitch.reject(new TaskdError(code, message, retryable));
    }

    private async sendTaskdCommand(
        type: string,
        payload: Record<string, unknown>,
        timeoutMs = RPC_COMMAND_TIMEOUT_MS,
    ): Promise<Record<string, unknown>> {
        const response = await this.sendRpcCommandWithResponse(
            {
                type,
                payload,
            },
            timeoutMs,
        );

        if (!isRecord(response) || typeof response.ok !== "boolean") {
            throw new TaskdError("INTERNAL_ERROR", `Invalid taskd response for ${type}`);
        }

        if (!response.ok) {
            const errorPayload = isRecord(response.error) ? response.error : {};
            const code = typeof errorPayload.code === "string" ? errorPayload.code : "INTERNAL_ERROR";
            const message = typeof errorPayload.message === "string" ? errorPayload.message : `${type} failed`;
            const retryable = errorPayload.retryable === true;
            throw new TaskdError(code, message, retryable);
        }

        return isRecord(response.result) ? response.result : {};
    }

    private async buildCreateOrOpenTaskPayload(task: TaskMetadata): Promise<Record<string, unknown>> {
        const model = typeof task.model === "string" ? task.model : null;
        const explicitProvider = typeof task.provider === "string" ? task.provider.trim() : "";
        const provider = explicitProvider || inferProviderFromModel(model);
        const thinkingLevel = typeof task.thinkingLevel === "string" ? task.thinkingLevel : null;
        const configuredWorkingFolder = typeof task.workingFolder === "string" ? task.workingFolder : null;

        let workingFolder: string | null = null;
        let workingFolderRelative: string | null = null;

        if (configuredWorkingFolder) {
            const validated = await this.validateWorkingFolder(configuredWorkingFolder);
            workingFolder = validated.folder;
            workingFolderRelative = validated.relativePath;
        }

        const payload: Record<string, unknown> = {
            taskId: task.id,
            workingFolder,
            workingFolderRelative,
        };

        if (provider) {
            payload.provider = provider;
        }
        if (model) {
            payload.model = model;
        }
        if (thinkingLevel) {
            payload.thinkingLevel = thinkingLevel;
        }

        return payload;
    }

    private async stopTaskdTaskIfPresent(taskId: string) {
        try {
            await this.sendTaskdCommand("stop_task", { taskId });
        } catch (error) {
            if (error instanceof TaskdError && error.code === "TASK_NOT_FOUND") {
                return;
            }

            throw error;
        }
    }

    private async ensureTaskdTaskReady(task: TaskMetadata) {
        const payload = await this.buildCreateOrOpenTaskPayload(task);
        const desiredWorkingFolderRelative =
            typeof payload.workingFolderRelative === "string" ? payload.workingFolderRelative : null;

        const stateResult = await this.sendTaskdCommand("runtime_get_state", {});
        const taskEntries = Array.isArray(stateResult.tasks) ? stateResult.tasks : [];
        const existing = taskEntries.find((entry) => {
            if (!isRecord(entry)) {
                return false;
            }

            return entry.taskId === task.id;
        });

        const existingState = isRecord(existing) && typeof existing.state === "string" ? existing.state : null;
        const existingWorkingFolderRelative =
            isRecord(existing) && typeof existing.workingFolderRelative === "string"
                ? existing.workingFolderRelative
                : null;

        if (existingState && ["ready", "idle", "active"].includes(existingState)) {
            if (existingWorkingFolderRelative === desiredWorkingFolderRelative) {
                return;
            }

            devLog(
                "RuntimeService",
                `Task ${task.id} working folder changed (${existingWorkingFolderRelative ?? "(scratch)"} -> ${
                    desiredWorkingFolderRelative ?? "(scratch)"
                }); restarting task process`,
            );

            await this.stopTaskdTaskIfPresent(task.id);
            await this.sendTaskdCommand("create_or_open_task", payload);
            return;
        }

        if (existingState && !["missing", "stopped", "errored"].includes(existingState)) {
            throw new TaskdError("TASK_NOT_READY", `task ${task.id} is ${existingState}`, true);
        }

        await this.sendTaskdCommand("create_or_open_task", payload);
    }

    private async switchTaskdTask(taskId: string) {
        const switchStartedAt = Date.now();
        const waitForReady = this.waitForTaskReadyEvent(taskId, switchStartedAt, TASK_SWITCH_TIMEOUT_MS);

        let switchAck: Record<string, unknown>;
        try {
            switchAck = await this.sendTaskdCommand("switch_task", { taskId });
        } catch (error) {
            this.rejectPendingTaskSwitch(error instanceof Error ? error : new Error(String(error)));
            await waitForReady.catch(() => undefined);
            throw error;
        }

        const status = typeof switchAck.status === "string" ? switchAck.status : null;
        if (status !== "switching") {
            const invalidAckError = new TaskdError("INTERNAL_ERROR", "switch_task returned invalid status");
            this.rejectPendingTaskSwitch(invalidAckError);
            await waitForReady.catch(() => undefined);
            throw invalidAckError;
        }

        await waitForReady;
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
}
