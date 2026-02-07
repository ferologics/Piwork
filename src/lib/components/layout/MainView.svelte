<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Send, Paperclip, FolderOpen, Loader2, X } from "@lucide/svelte";
import { devLog } from "$lib/utils/devLog";
import { MessageAccumulator } from "$lib/rpc";
import type { RpcPayload, ConversationState } from "$lib/rpc";
import { taskStore } from "$lib/stores/taskStore";
import { artifactRefreshStore } from "$lib/stores/artifactRefreshStore";
import { runtimeDebugStore } from "$lib/stores/runtimeDebugStore";
import type { TaskMetadata } from "$lib/types/task";
import FolderSelector from "$lib/components/FolderSelector.svelte";
import QuickStartTiles from "$lib/components/QuickStartTiles.svelte";
import ExtensionUiDialog from "$lib/components/ExtensionUiDialog.svelte";
import type { ExtensionUiRequest } from "$lib/components/ExtensionUiDialog.svelte";
import {
    RuntimeService,
    type RuntimeServiceSnapshot,
    type RuntimeGetStateResult,
    type RuntimeTaskState,
} from "$lib/services/runtimeService";
import { previewStore, type PreviewSelection } from "$lib/stores/previewStore";

let { previewOpen = false }: { previewOpen?: boolean } = $props();

let prompt = $state("");
let textareaEl: HTMLTextAreaElement | undefined = $state();
let runtimeService: RuntimeService | null = $state(null);
let unsubscribeRuntimeService: (() => void) | null = null;
let messageAccumulator = new MessageAccumulator();
let conversation = $state<ConversationState>(messageAccumulator.getState());
let promptSending = $state(false);
let promptInFlight = $state(false);
let rpcConnected = $state(false);
let rpcConnecting = $state(false);
let rpcError = $state<string | null>(null);
let hasConnectedOnce = $state(false);
let rpcAuthHint = $state<string | null>(null);
let rpcLoginUrl = $state<string | null>(null);
let openingLoginUrl = $state(false);
let copyingLoginUrl = $state(false);
let loginCopied = $state(false);
let loginPromptVisible = $state(false);
let loginPromptedUrl = $state<string | null>(null);
let loginPromptCountdown = $state<number | null>(null);
let autoOpenLogin = $state(false);
let rpcStateInfo = $state<string | null>(null);
let rpcStateRequested = $state(false);
let rpcModelsRequested = $state(false);
let pendingUiRequest = $state<ExtensionUiRequest | null>(null);
let pendingUiQueue = $state<ExtensionUiRequest[]>([]);

let pendingUiSending = $state(false);
let vmLogPath = $state<string | null>(null);
let openingLog = $state(false);

interface DevToast {
    id: number;
    message: string;
}

let devToasts = $state<DevToast[]>([]);
let devToastCounter = 0;
const DEV_TOAST_TTL_MS = 5000;

// Task/runtime tracking
let currentTaskId = $state<string | null>(null);
let currentWorkingFolder = $state<string | null>(null);
let activeTask = $state<TaskMetadata | null>(null);
let currentSessionFile = $state<string | null>(null);
let workspaceRoot = $state<string | null>(null);
let taskSwitching = $state(false);
let unsubscribeActiveTask: (() => void) | null = null;

interface PreviewReadResponse {
    path: string;
    mimeType: string;
    encoding: "utf8" | "base64";
    content: string;
    truncated: boolean;
    size: number;
}

let previewSelection = $state<PreviewSelection>({
    isOpen: false,
    taskId: null,
    relativePath: null,
    requestId: 0,
    source: "preview",
    artifactSource: null,
});
let previewLoading = $state(false);
let previewError = $state<string | null>(null);
let previewContent = $state<PreviewReadResponse | null>(null);
let unsubscribePreview: (() => void) | null = null;
let previewRequestId = 0;

interface ModelOption {
    id: string;
    label: string;
    provider: string | null;
}

let availableModels = $state<ModelOption[]>([]);
let selectedModelId = $state("");
let modelsLoading = $state(false);
let modelsError = $state<string | null>(null);

const MAX_HEIGHT = 200;
const LOGIN_PROMPT_SECONDS = 5;
const LOGIN_AUTO_OPEN_KEY = "piwork:auto-open-login";

let loginPromptTimer: ReturnType<typeof setInterval> | null = null;

function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, MAX_HEIGHT) + "px";
    textareaEl.style.overflowY = textareaEl.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}

function canSendPrompt(ignorePending = false) {
    if (!rpcConnected || taskSwitching || conversation.isAgentRunning || promptInFlight) {
        return false;
    }

    if (!ignorePending && promptSending) {
        return false;
    }

    return true;
}

function handleInputKeydown(e: KeyboardEvent) {
    // Enter sends, Shift+Enter adds newline
    if (e.key === "Enter" && !e.shiftKey) {
        if (!canSendPrompt()) {
            return;
        }

        e.preventDefault();
        void sendPrompt();
    }
}

function pushRpcMessage(message: string) {
    // Log to console for debugging (visible in terminal)
    devLog("RPC", message);
    maybeCaptureLoginUrl(message);
}

function pushDevToast(message: string) {
    if (!import.meta.env.DEV) {
        return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
        return;
    }

    const id = ++devToastCounter;
    devToasts = [...devToasts, { id, message: trimmed }];

    setTimeout(() => {
        devToasts = devToasts.filter((toast) => toast.id !== id);
    }, DEV_TOAST_TTL_MS);
}

function extractUrl(message: string) {
    const match = message.match(/https?:\/\/[^\s)]+/);
    return match?.[0] ?? null;
}

function maybeCaptureLoginUrl(message: string) {
    const url = extractUrl(message);
    if (!url) return;

    const lower = message.toLowerCase();
    if (lower.includes("login") || lower.includes("oauth") || lower.includes("authorize")) {
        if (rpcLoginUrl !== url) {
            rpcLoginUrl = url;
            loginCopied = false;
            copyingLoginUrl = false;
            startLoginPrompt(url);
        }
    }
}

function stopLoginCountdown() {
    loginPromptCountdown = null;

    if (loginPromptTimer) {
        clearInterval(loginPromptTimer);
        loginPromptTimer = null;
    }
}

function setAutoOpenLogin(enabled: boolean) {
    autoOpenLogin = enabled;

    try {
        localStorage.setItem(LOGIN_AUTO_OPEN_KEY, enabled ? "true" : "false");
    } catch {
        // Ignore storage errors.
    }

    if (!enabled) {
        stopLoginCountdown();
        return;
    }

    if (rpcLoginUrl && loginPromptVisible && loginPromptedUrl === rpcLoginUrl) {
        startLoginPrompt(rpcLoginUrl);
    }
}

function clearLoginPrompt() {
    loginPromptVisible = false;
    loginPromptedUrl = null;
    stopLoginCountdown();
}

function startLoginPrompt(url: string) {
    clearLoginPrompt();
    loginPromptVisible = true;
    loginPromptedUrl = url;

    if (!autoOpenLogin) {
        loginPromptCountdown = null;
        return;
    }

    loginPromptCountdown = LOGIN_PROMPT_SECONDS;

    loginPromptTimer = setInterval(() => {
        if (!loginPromptVisible || loginPromptedUrl !== url || loginPromptCountdown === null) {
            clearLoginPrompt();
            return;
        }

        if (loginPromptCountdown <= 1) {
            clearLoginPrompt();
            void openLoginUrl();
            return;
        }

        loginPromptCountdown -= 1;
    }, 1000);
}

function updateAuthHint(message: string) {
    const lower = message.toLowerCase();
    const needsAuth =
        lower.includes("auth") ||
        lower.includes("login") ||
        lower.includes("api key") ||
        lower.includes("credential") ||
        lower.includes("unauthorized") ||
        lower.includes("token");

    if (!needsAuth) return;

    rpcAuthHint =
        "Auth required. Import credentials from pi in Settings, then restart runtime. Fallback: `mise run runtime-build-auth` (optional `PIWORK_AUTH_PATH=...`).";

    maybeCaptureLoginUrl(message);
}

function resolveModelOption(model: unknown) {
    if (!model || typeof model !== "object") return null;

    const entry = model as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : typeof entry.model === "string" ? entry.model : null;
    if (!id) return null;

    const label = typeof entry.name === "string" ? entry.name : id;
    const provider = typeof entry.provider === "string" ? entry.provider : null;

    return { id, label, provider } satisfies ModelOption;
}

function parseStringArray(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const filtered = value.filter((item) => typeof item === "string") as string[];
    return filtered.length > 0 ? filtered : undefined;
}

function parseExtensionUiRequest(payload: Record<string, unknown>): ExtensionUiRequest | null {
    const id = typeof payload.id === "string" ? payload.id : null;
    const method = typeof payload.method === "string" ? payload.method : null;

    if (!id || !method) return null;

    return {
        id,
        method,
        title: typeof payload.title === "string" ? payload.title : undefined,
        message: typeof payload.message === "string" ? payload.message : undefined,
        options: parseStringArray(payload.options),
        placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
        prefill: typeof payload.prefill === "string" ? payload.prefill : undefined,
    };
}

function applyRuntimeSnapshot(snapshot: RuntimeServiceSnapshot) {
    const wasTaskSwitching = taskSwitching;
    const previousTaskId = currentTaskId;

    rpcConnected = snapshot.rpcConnected;
    rpcConnecting = snapshot.rpcConnecting;
    rpcError = snapshot.rpcError;
    currentTaskId = snapshot.currentTaskId;
    currentWorkingFolder = snapshot.currentWorkingFolder;
    currentSessionFile = snapshot.currentSessionFile;
    workspaceRoot = snapshot.workspaceRoot;
    taskSwitching = snapshot.taskSwitching;

    if (!snapshot.rpcConnected || previousTaskId !== currentTaskId) {
        promptSending = false;
        promptInFlight = false;
    }

    if (snapshot.rpcConnected) {
        hasConnectedOnce = true;
    }

    if (wasTaskSwitching && !taskSwitching) {
        void requestState();
        void requestAvailableModels();
    }
}

function getRpcClient() {
    return runtimeService?.getRpcClient() ?? null;
}

function queueUiRequest(request: ExtensionUiRequest) {
    if (!pendingUiRequest) {
        pendingUiRequest = request;
        return;
    }
    pendingUiQueue = [...pendingUiQueue, request];
}

function clearUiRequest() {
    pendingUiRequest = null;
    pendingUiSending = false;

    if (pendingUiQueue.length > 0) {
        const [next, ...rest] = pendingUiQueue;
        pendingUiQueue = rest;
        pendingUiRequest = next;
    }
}

async function sendUiResponse(response: Record<string, unknown>) {
    if (!runtimeService || !pendingUiRequest || pendingUiSending) return;
    pendingUiSending = true;

    try {
        await runtimeService.sendExtensionUiResponse({
            id: pendingUiRequest.id,
            ...response,
        });
    } finally {
        clearUiRequest();
    }
}

async function handleUiConfirm(confirmed: boolean) {
    await sendUiResponse({ confirmed });
}

async function handleUiSelect(value: string) {
    await sendUiResponse({ value });
}

async function handleUiSubmit(value: string) {
    await sendUiResponse({ value });
}

async function handleUiCancel() {
    await sendUiResponse({ cancelled: true });
}

async function sendLogin() {
    const sent = await sendPrompt("/login");
    if (sent) {
        pushRpcMessage("[info] Sent /login");
    }
}

function ensureModelOption(option: ModelOption) {
    if (availableModels.some((model) => model.id === option.id)) {
        return;
    }

    availableModels = [option, ...availableModels];
}

async function refreshVmLogPath() {
    vmLogPath = await RuntimeService.refreshVmLogPath();
}

async function openVmLog() {
    if (!vmLogPath || openingLog) return;
    openingLog = true;

    try {
        await openPath(vmLogPath);
    } finally {
        openingLog = false;
    }
}

async function openLoginUrl() {
    if (!rpcLoginUrl || openingLoginUrl) return;
    openingLoginUrl = true;
    clearLoginPrompt();

    try {
        await openUrl(rpcLoginUrl);
    } finally {
        openingLoginUrl = false;
    }
}

function dismissLoginPrompt() {
    clearLoginPrompt();
}

async function copyLoginUrl() {
    if (!rpcLoginUrl || copyingLoginUrl) return;

    if (!navigator?.clipboard) {
        pushRpcMessage("[error] Clipboard unavailable");
        return;
    }

    copyingLoginUrl = true;
    loginCopied = false;

    try {
        await navigator.clipboard.writeText(rpcLoginUrl);
        loginCopied = true;
        setTimeout(() => {
            loginCopied = false;
        }, 2000);
    } catch {
        pushRpcMessage("[error] Failed to copy login URL");
    } finally {
        copyingLoginUrl = false;
    }
}

function getActiveRuntimeTask(state: RuntimeGetStateResult): RuntimeTaskState | null {
    if (state.activeTaskId) {
        const active = state.tasks.find((task) => task.taskId === state.activeTaskId) ?? null;
        if (active) {
            return active;
        }
    }

    return state.tasks.find((task) => task.state === "active") ?? null;
}

async function requestState() {
    if (!runtimeService || rpcStateRequested || taskSwitching) return;

    rpcStateRequested = true;

    try {
        const state = await runtimeService.runtimeGetState();
        rpcStateInfo = formatStateInfo(state);
        runtimeDebugStore.updateFromRuntimeState(state);

        const activeTaskState = getActiveRuntimeTask(state);
        promptInFlight = activeTaskState?.promptInFlight === true;

        const activeOption = activeTaskState ? resolveModelOption(activeTaskState) : null;

        if (activeOption) {
            ensureModelOption(activeOption);
            selectedModelId = activeOption.id;
        } else if (!availableModels.some((model) => model.id === selectedModelId)) {
            selectedModelId = availableModels[0]?.id ?? "";
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushRpcMessage(`[error] ${message}`);
        updateAuthHint(message);
        rpcStateInfo = null;
        runtimeDebugStore.clear();
    } finally {
        rpcStateRequested = false;
    }
}

function isTransientModelLoadError(message: string) {
    return message.includes("pi exited") && message.includes("SIGTERM");
}

async function requestAvailableModels() {
    if (!runtimeService || rpcModelsRequested) return;

    if (!currentTaskId || taskSwitching || !rpcConnected) {
        return;
    }

    rpcModelsRequested = true;
    modelsLoading = true;
    modelsError = null;

    try {
        const result = await runtimeService.piGetAvailableModels();
        const mapped = result.models
            .map((model) => resolveModelOption(model))
            .filter((model): model is ModelOption => Boolean(model));

        availableModels = mapped;

        if (mapped.length === 0) {
            selectedModelId = "";
            return;
        }

        if (!mapped.some((model) => model.id === selectedModelId)) {
            selectedModelId = mapped[0].id;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isTransientModelLoadError(message) || taskSwitching || !rpcConnected) {
            devLog("MainView", `Ignoring transient model load error: ${message}`);
            return;
        }

        modelsError = message;
        availableModels = [];
        selectedModelId = "";
        pushRpcMessage(`[error] ${message}`);
        updateAuthHint(message);
    } finally {
        rpcModelsRequested = false;
        modelsLoading = false;
    }
}

async function handleModelChange() {
    if (!runtimeService || modelsLoading) return;

    const selected = availableModels.find((model) => model.id === selectedModelId) ?? null;
    if (!selected) {
        return;
    }

    if (!selected.provider) {
        modelsError = "Selected model provider is unknown.";
        pushRpcMessage("[error] Selected model provider is unknown.");
        return;
    }

    try {
        const updated = await runtimeService.piSetModel(selected.provider, selected.id);
        const option = resolveModelOption(updated);

        let persistedProvider = selected.provider;
        let persistedModelId = selected.id;

        if (option) {
            ensureModelOption(option);
            selectedModelId = option.id;
            persistedProvider = option.provider ?? persistedProvider;
            persistedModelId = option.id;
        }

        if (activeTask && currentTaskId === activeTask.id) {
            await taskStore.upsert({
                ...activeTask,
                provider: persistedProvider,
                model: persistedModelId,
                updatedAt: new Date().toISOString(),
            });
        }

        modelsError = null;
        void requestState();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        modelsError = message;
        pushRpcMessage(`[error] ${message}`);
        updateAuthHint(message);
    }
}

function formatStateInfo(state: RuntimeGetStateResult | null) {
    if (!state) return null;

    const activeTaskState = getActiveRuntimeTask(state);
    const parts: string[] = [];

    if (activeTaskState?.model) {
        parts.push(`Model: ${activeTaskState.model}`);
    }

    if (activeTaskState?.taskId) {
        parts.push(`Task: ${activeTaskState.taskId.slice(0, 8)}`);
    } else if (state.activeTaskId) {
        parts.push(`Task: ${state.activeTaskId.slice(0, 8)}`);
    }

    if (activeTaskState) {
        parts.push(`Streaming: ${activeTaskState.promptInFlight ? "yes" : "no"}`);
    }

    return parts.length > 0 ? parts.join(" · ") : null;
}

function handleRpcPayload(payload: Record<string, unknown>) {
    const type = typeof payload.type === "string" ? payload.type : null;

    if (type) {
        messageAccumulator.processEvent(payload as RpcPayload);
        conversation = messageAccumulator.getState();
    }

    if (type === "agent_start" || type === "turn_start") {
        promptInFlight = true;
    }

    if (type === "turn_end" || type === "agent_end") {
        promptInFlight = false;
    }

    if (type === "agent_end" && currentTaskId) {
        void taskStore.saveConversation(currentTaskId, messageAccumulator.serialize());
        devLog("MainView", "Auto-saved conversation after agent_end");
    }

    if (type && (type === "tool_execution_end" || type === "turn_end" || type === "agent_end") && currentTaskId) {
        artifactRefreshStore.request(currentTaskId, type);
    }

    if (type === "turn_end" || type === "agent_end") {
        void requestState();
    }

    if (type === "response" && payload.success === false) {
        const error = payload.error;
        if (typeof error === "string") {
            pushRpcMessage(`[error] ${error}`);
            updateAuthHint(error);
        }
        return;
    }

    if (type === "event") {
        const eventName = typeof payload.event === "string" ? payload.event : null;
        const eventTaskId = typeof payload.taskId === "string" ? payload.taskId : null;

        if (eventName === "task_ready" && eventTaskId) {
            artifactRefreshStore.request(eventTaskId, "task_ready");
            void requestState();
            void requestAvailableModels();
        }

        return;
    }

    if (type === "extension_ui_request") {
        const request = parseExtensionUiRequest(payload);
        if (!request) {
            pushRpcMessage("[ui] Received malformed UI request");
            return;
        }

        if (request.method === "notify") {
            const message = request.message ?? "Notification";
            pushRpcMessage(`[notify] ${message}`);
            return;
        }

        if (request.message) {
            maybeCaptureLoginUrl(request.message);
        }
        if (request.title) {
            maybeCaptureLoginUrl(request.title);
        }

        if (request.method === "setStatus") {
            const statusKey = typeof payload.statusKey === "string" ? payload.statusKey : "status";
            const statusText = typeof payload.statusText === "string" ? payload.statusText : "";
            pushRpcMessage(`[status] ${statusKey}: ${statusText}`);
            return;
        }

        if (request.method === "setWidget") {
            const widgetKey = typeof payload.widgetKey === "string" ? payload.widgetKey : "widget";
            pushRpcMessage(`[widget] ${widgetKey}`);
            return;
        }

        queueUiRequest(request);
        pushRpcMessage(`[ui] ${request.method} requested`);
    }
}

async function initializeRuntimeService() {
    if (runtimeService) {
        return;
    }

    runtimeService = new RuntimeService({
        onConnected: () => {
            rpcAuthHint = null;
            rpcLoginUrl = null;
            loginCopied = false;
            copyingLoginUrl = false;
            clearLoginPrompt();
            void requestState();
            void requestAvailableModels();
        },
        onError: (message) => {
            rpcAuthHint = null;
            rpcLoginUrl = null;
            loginCopied = false;
            copyingLoginUrl = false;
            clearLoginPrompt();
            rpcStateInfo = null;
            rpcStateRequested = false;
            rpcModelsRequested = false;
            modelsLoading = false;
            modelsError = null;
            availableModels = [];
            selectedModelId = "";
            runtimeDebugStore.clear();
            pushDevToast(message);
            void refreshVmLogPath();
        },
        onRpcPayload: handleRpcPayload,
        onRawRpcMessage: pushRpcMessage,
        onStateRefreshRequested: () => {
            void requestState();
        },
    });

    unsubscribeRuntimeService = runtimeService.subscribe(applyRuntimeSnapshot);
    devLog("MainView", "Runtime initialized");
}

async function connectRpc() {
    if (!runtimeService) return;

    rpcAuthHint = null;
    rpcLoginUrl = null;
    loginCopied = false;
    copyingLoginUrl = false;
    clearLoginPrompt();
    rpcStateInfo = null;
    rpcStateRequested = false;
    rpcModelsRequested = false;
    modelsLoading = false;
    modelsError = null;
    availableModels = [];
    selectedModelId = "";
    runtimeDebugStore.clear();
    pendingUiRequest = null;
    pendingUiQueue = [];
    pendingUiSending = false;

    await runtimeService.connectRpc();
}

async function disconnectRpc() {
    if (!runtimeService) return;

    await runtimeService.disconnectRpc();
    rpcAuthHint = null;
    rpcLoginUrl = null;
    loginCopied = false;
    copyingLoginUrl = false;
    clearLoginPrompt();
    rpcStateInfo = null;
    rpcStateRequested = false;
    rpcModelsRequested = false;
    modelsLoading = false;
    modelsError = null;
    availableModels = [];
    selectedModelId = "";
    runtimeDebugStore.clear();
    pendingUiRequest = null;
    pendingUiQueue = [];
    pendingUiSending = false;
}

async function sendPrompt(message?: string): Promise<boolean> {
    if (!runtimeService) return false;

    const content = (message ?? prompt).trim();
    if (!content) return false;

    if (!canSendPrompt()) {
        return false;
    }

    promptSending = true;

    try {
        // Auto-create task if none active
        if (!currentTaskId) {
            const title = content.length > 50 ? content.substring(0, 50) + "…" : content;
            const task = taskStore.create(title, currentWorkingFolder);
            await taskStore.upsert(task);
            taskStore.setActive(task.id);
            devLog("MainView", `Auto-created task: ${task.id} with folder: ${currentWorkingFolder}`);
        }

        try {
            await runtimeService.waitForTaskSwitchComplete();
            await runtimeService.waitForRpcReady();
        } catch (error) {
            devLog("MainView", `Prompt blocked until runtime ready: ${error}`);
            return false;
        }

        if (!getRpcClient() || !canSendPrompt(true)) {
            return false;
        }

        if (currentTaskId && activeTask && activeTask.title === "New Task" && conversation.messages.length === 0) {
            const nextTitle = content.length > 50 ? `${content.substring(0, 50)}…` : content;
            await taskStore.upsert({
                ...activeTask,
                title: nextTitle,
                updatedAt: new Date().toISOString(),
            });
        }

        // Add user message to conversation
        messageAccumulator.addUserMessage(content);
        conversation = messageAccumulator.getState();

        promptInFlight = true;
        await runtimeService.sendPrompt(content);
        prompt = "";
        return true;
    } catch (error) {
        promptInFlight = false;
        devLog("MainView", `Prompt send failed: ${error}`);
        return false;
    } finally {
        promptSending = false;
    }
}

function shellQuote(value: string): string {
    return `'${value.split("'").join(`'"'"'`)}'`;
}

function normalizeHarnessRelativePath(rawPath: string): string | null {
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
        return null;
    }

    const normalized = trimmed
        .replace(/^\.\//, "")
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$|^\/+/, "");

    if (!normalized || normalized === ".") {
        return null;
    }

    if (normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
        return null;
    }

    if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) {
        return null;
    }

    return normalized;
}

async function writeWorkingFileForTest(relativePath: string, content: string): Promise<void> {
    if (!runtimeService) {
        devLog("TestHarness", "write_working_file ignored: runtime service unavailable");
        return;
    }

    if (!currentTaskId) {
        devLog("TestHarness", "write_working_file ignored: no active task");
        return;
    }

    const normalizedRelativePath = normalizeHarnessRelativePath(relativePath);
    if (!normalizedRelativePath) {
        devLog("TestHarness", `write_working_file rejected path: ${relativePath}`);
        return;
    }

    const targetPath = `/mnt/workdir/${normalizedRelativePath}`;
    const command = `TARGET=${shellQuote(targetPath)}; PARENT="${"$"}{TARGET%/*}"; if [ "$PARENT" != "$TARGET" ]; then mkdir -p "$PARENT"; fi; printf '%s' ${shellQuote(content)} > "$TARGET"`;

    try {
        await runtimeService.waitForTaskSwitchComplete(15_000);
        await runtimeService.waitForRpcReady(15_000);
        await runtimeService.send({
            id: `test_write_working_file_${Date.now()}`,
            type: "system_bash",
            payload: {
                command,
            },
        });
    } catch (error) {
        devLog("TestHarness", `write_working_file failed: ${error}`);
    }
}

let testPromptUnlisten: (() => void) | null = null;
let testInjectMessageUnlisten: (() => void) | null = null;
let testFolderUnlisten: (() => void) | null = null;
let testTaskUnlisten: (() => void) | null = null;
let testCreateTaskUnlisten: (() => void) | null = null;
let testDeleteAllTasksUnlisten: (() => void) | null = null;
let testDumpStateUnlisten: (() => void) | null = null;
let testStateSnapshotUnlisten: (() => void) | null = null;
let testOpenPreviewUnlisten: (() => void) | null = null;
let testWriteWorkingFileUnlisten: (() => void) | null = null;
let testSendLoginUnlisten: (() => void) | null = null;
let testRuntimeDiagUnlisten: (() => void) | null = null;

function buildTestStateSnapshot() {
    const runtimeDebug = get(runtimeDebugStore);

    const bootScreenVisible = !rpcConnected && !hasConnectedOnce;
    const reconfigureBannerVisible = !rpcConnected && hasConnectedOnce;
    const quickStartVisible = conversation.messages.length === 0 && !conversation.isAgentRunning;

    const runtimeMismatchVisible = Boolean(
        activeTask &&
            runtimeDebug.activeTaskId &&
            runtimeDebug.currentCwd &&
            runtimeDebug.activeTaskId !== "__legacy__" &&
            runtimeDebug.activeTaskId !== activeTask.id,
    );

    const workingFolderFileRowCount =
        typeof document === "undefined"
            ? 0
            : document.querySelectorAll('[data-test-id="working-folder-file-row"]').length;
    const workingFolderLoadingVisible =
        typeof document === "undefined"
            ? false
            : Boolean(document.querySelector('[data-test-id="working-folder-loading"]'));
    const workingFolderEmptyVisible =
        typeof document === "undefined"
            ? false
            : Boolean(document.querySelector('[data-test-id="working-folder-empty"]'));

    return {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        task: {
            currentTaskId,
            activeTaskId: activeTask?.id ?? null,
            currentWorkingFolder,
            currentSessionFile,
            workspaceRoot,
        },
        runtime: {
            rpcConnected,
            rpcConnecting,
            rpcError,
            hasConnectedOnce,
            taskSwitching,
        },
        conversation: {
            messageCount: conversation.messages.length,
            isAgentRunning: conversation.isAgentRunning,
            hasError: Boolean(conversation.error),
        },
        composer: {
            promptLength: prompt.length,
            promptSending,
            promptInFlight,
            canSendPrompt: canSendPrompt(),
        },
        ui: {
            bootScreenVisible,
            reconfigureBannerVisible,
            quickStartVisible,
            loginPromptVisible,
            pendingUiRequest: Boolean(pendingUiRequest),
        },
        models: {
            count: availableModels.length,
            ids: availableModels.map((model) => model.id),
            loading: modelsLoading,
            error: modelsError,
            selectedModelId,
        },
        preview: {
            isOpen: previewSelection.isOpen,
            taskId: previewSelection.taskId,
            relativePath: previewSelection.relativePath,
            source: previewSelection.source,
            artifactSource: previewSelection.artifactSource,
            loading: previewLoading,
            error: previewError,
        },
        runtimeDebug: {
            activeTaskId: runtimeDebug.activeTaskId,
            currentCwd: runtimeDebug.currentCwd,
            workingFolderRelative: runtimeDebug.workingFolderRelative,
            mismatchVisible: runtimeMismatchVisible,
        },
        panels: {
            workingFolderFileRowCount,
            workingFolderLoadingVisible,
            workingFolderEmptyVisible,
        },
    };
}

async function collectRuntimeDiagForTest(): Promise<Record<string, unknown>> {
    if (!runtimeService) {
        return {
            error: "Runtime service unavailable",
        };
    }

    try {
        return await runtimeService.runtimeDiag();
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function replyRuntimeDiagForTest(requestId: string): Promise<void> {
    const diag = await collectRuntimeDiagForTest();

    await invoke("test_runtime_diag_reply", {
        requestId,
        diag,
    }).catch((error) => {
        devLog("TestHarness", `failed to send runtime diag: ${error}`);
    });
}

async function saveConversationForTask(taskId: string | null): Promise<void> {
    if (!taskId || messageAccumulator.getState().messages.length === 0) {
        return;
    }

    const list = get(taskStore);
    const hasTask = list.some((task) => task.id === taskId);
    if (!hasTask) {
        return;
    }

    try {
        await taskStore.saveConversation(taskId, messageAccumulator.serialize());
        devLog("MainView", `Saved conversation to task ${taskId}`);
    } catch (error) {
        devLog("MainView", `Failed to save conversation: ${error}`);
    }
}

async function loadConversationForTask(taskId: string | null): Promise<void> {
    messageAccumulator.reset();
    conversation = messageAccumulator.getState();

    if (!taskId) {
        return;
    }

    try {
        const saved = await taskStore.loadConversation(taskId);
        if (!saved) {
            return;
        }

        messageAccumulator.loadState(saved);
        conversation = messageAccumulator.getState();
        devLog("MainView", `Loaded conversation for task ${taskId}`);
    } catch (error) {
        devLog("MainView", `Failed to load conversation: ${error}`);
    }
}

async function persistWorkingFolderForActiveTask(folder: string | null): Promise<void> {
    if (!currentTaskId) {
        return;
    }

    const list = await invoke<TaskMetadata[]>("task_store_list");
    const task = list.find((item) => item.id === currentTaskId);
    if (!task) {
        return;
    }

    await taskStore.upsert({
        ...task,
        workingFolder: folder,
        updatedAt: new Date().toISOString(),
    });
}

async function handleTaskSwitch(newTask: TaskMetadata | null): Promise<void> {
    if (!runtimeService) {
        return;
    }

    try {
        await runtimeService.handleTaskSwitch(newTask, {
            saveConversationForTask,
            loadConversationForTask,
        });
    } catch (error) {
        devLog("MainView", `Task switch failed: ${error}`);
    }
}

async function handleFolderChange(folder: string | null): Promise<void> {
    if (!runtimeService) {
        return;
    }

    const requestedFolder = typeof folder === "string" ? folder.trim() : "";

    try {
        if (!currentTaskId && requestedFolder) {
            const task = taskStore.create("New Task");
            await taskStore.upsert(task);
            await handleTaskSwitch(task);
            taskStore.setActive(task.id);
        }

        await runtimeService.handleFolderChange(requestedFolder || null, {
            persistWorkingFolderForActiveTask,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        devLog("MainView", `Folder change failed: ${message}`);
        pushDevToast(`Folder change failed: ${message}`);
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function closePreview() {
    previewStore.close();
}

async function loadPreviewForSelection(selection: PreviewSelection): Promise<void> {
    previewSelection = selection;
    const requestId = ++previewRequestId;

    if (!selection.isOpen || !selection.taskId || !selection.relativePath) {
        previewError = null;
        previewContent = null;
        previewLoading = false;
        return;
    }

    if (selection.taskId !== currentTaskId) {
        taskStore.setActive(selection.taskId);
    }

    previewLoading = true;
    previewError = null;

    try {
        const response =
            selection.source === "artifact"
                ? await invoke<PreviewReadResponse>("task_artifact_read", {
                      taskId: selection.taskId,
                      source: selection.artifactSource ?? "outputs",
                      relativePath: selection.relativePath,
                  })
                : await invoke<PreviewReadResponse>("task_preview_read", {
                      taskId: selection.taskId,
                      relativePath: selection.relativePath,
                  });

        if (requestId !== previewRequestId) {
            return;
        }

        previewContent = response;
    } catch (error) {
        if (requestId !== previewRequestId) {
            return;
        }

        previewError = error instanceof Error ? error.message : String(error);
        previewContent = null;
    } finally {
        if (requestId === previewRequestId) {
            previewLoading = false;
        }
    }
}

onMount(() => {
    try {
        const stored = localStorage.getItem(LOGIN_AUTO_OPEN_KEY);
        if (stored === "true") {
            autoOpenLogin = true;
        } else if (stored === "false") {
            autoOpenLogin = false;
        }
    } catch {
        // Ignore storage errors.
    }

    void (async () => {
        try {
            await initializeRuntimeService();
            await connectRpc();

            // Subscribe to active task changes
            unsubscribeActiveTask = taskStore.activeTask.subscribe((task) => {
                activeTask = task;
                void handleTaskSwitch(task);
            });

            unsubscribePreview = previewStore.subscribe((selection) => {
                void loadPreviewForSelection(selection);
            });
        } catch (error) {
            devLog("MainView", `Failed to initialize runtime service: ${error}`);
        }
    })();

    void refreshVmLogPath();

    // Test harness listeners (dev only)
    if (import.meta.env.DEV) {
        listen<string>("test_prompt", (event) => {
            devLog("TestHarness", `received test_prompt: ${event.payload}`);
            prompt = event.payload;
            void sendPrompt();
        }).then((unlisten) => {
            testPromptUnlisten = unlisten;
        });

        listen<string>("test_inject_message", (event) => {
            const content = event.payload.trim();
            if (!content) {
                return;
            }

            devLog("TestHarness", `received test_inject_message: ${content}`);
            messageAccumulator.addUserMessage(content);
            conversation = messageAccumulator.getState();
        }).then((unlisten) => {
            testInjectMessageUnlisten = unlisten;
        });

        listen<string | null>("test_set_folder", (event) => {
            devLog("TestHarness", `received test_set_folder: ${event.payload}`);
            void handleFolderChange(event.payload);
        }).then((unlisten) => {
            testFolderUnlisten = unlisten;
        });

        listen<string | null>("test_set_task", (event) => {
            devLog("TestHarness", `received test_set_task: ${event.payload}`);
            taskStore.setActive(event.payload ?? null);
        }).then((unlisten) => {
            testTaskUnlisten = unlisten;
        });

        listen("test_send_login", () => {
            devLog("TestHarness", "received test_send_login");
            void sendLogin();
        }).then((unlisten) => {
            testSendLoginUnlisten = unlisten;
        });

        listen<{ title?: string | null; workingFolder?: string | null }>("test_create_task", (event) => {
            const title = event.payload?.title ?? "New Task";
            const folder = event.payload?.workingFolder ?? null;
            devLog("TestHarness", `received test_create_task: ${title}`);

            const task = taskStore.create(title, folder);
            void taskStore.upsert(task).then(() => {
                taskStore.setActive(task.id);
            });
        }).then((unlisten) => {
            testCreateTaskUnlisten = unlisten;
        });

        listen("test_delete_all_tasks", () => {
            devLog("TestHarness", "received test_delete_all_tasks");
            void taskStore.deleteAll();
        }).then((unlisten) => {
            testDeleteAllTasksUnlisten = unlisten;
        });

        listen("test_dump_state", () => {
            const messageCount = conversation.messages.length;
            const hasStreaming = conversation.isAgentRunning;
            devLog(
                "TestHarness",
                `state: task=${currentTaskId ?? "none"} session=${currentSessionFile ?? "none"} folder=${
                    currentWorkingFolder ?? "none"
                } root=${workspaceRoot ?? "none"} messages=${messageCount} streaming=${hasStreaming} switching=${taskSwitching}`,
            );
        }).then((unlisten) => {
            testDumpStateUnlisten = unlisten;
        });

        listen<{ requestId?: string | null }>("test_state_snapshot_request", (event) => {
            const requestId = event.payload?.requestId;
            if (!requestId) {
                return;
            }

            const snapshot = buildTestStateSnapshot();
            void invoke("test_state_snapshot_reply", {
                requestId,
                snapshot,
            }).catch((error) => {
                devLog("TestHarness", `failed to send state snapshot: ${error}`);
            });
        }).then((unlisten) => {
            testStateSnapshotUnlisten = unlisten;
        });

        listen<{ requestId?: string | null }>("test_runtime_diag_request", (event) => {
            const requestId = event.payload?.requestId;
            if (!requestId) {
                return;
            }

            void replyRuntimeDiagForTest(requestId);
        }).then((unlisten) => {
            testRuntimeDiagUnlisten = unlisten;
        });

        listen<{ taskId?: string | null; relativePath?: string | null }>("test_open_preview", (event) => {
            const taskId = event.payload?.taskId ?? null;
            const relativePath = event.payload?.relativePath ?? null;
            devLog("TestHarness", `received test_open_preview: task=${taskId} path=${relativePath}`);

            if (taskId && relativePath) {
                previewStore.open(taskId, relativePath);
            }
        }).then((unlisten) => {
            testOpenPreviewUnlisten = unlisten;
        });

        listen<{ relativePath?: string | null; content?: string | null }>("test_write_working_file", (event) => {
            const relativePath = event.payload?.relativePath ?? null;
            const content = typeof event.payload?.content === "string" ? event.payload.content : "";

            devLog("TestHarness", `received test_write_working_file: ${relativePath}`);

            if (!relativePath) {
                return;
            }

            void writeWorkingFileForTest(relativePath, content);
        }).then((unlisten) => {
            testWriteWorkingFileUnlisten = unlisten;
        });
    }
});

onDestroy(() => {
    // Save conversation before unmounting
    if (currentTaskId && messageAccumulator.getState().messages.length > 0) {
        void taskStore.saveConversation(currentTaskId, messageAccumulator.serialize());
    }
    unsubscribeActiveTask?.();
    unsubscribePreview?.();
    unsubscribeRuntimeService?.();
    void disconnectRpc();
    testPromptUnlisten?.();
    testInjectMessageUnlisten?.();
    testFolderUnlisten?.();
    testTaskUnlisten?.();
    testSendLoginUnlisten?.();
    testCreateTaskUnlisten?.();
    testDeleteAllTasksUnlisten?.();
    testDumpStateUnlisten?.();
    testStateSnapshotUnlisten?.();
    testRuntimeDiagUnlisten?.();
    testOpenPreviewUnlisten?.();
    testWriteWorkingFileUnlisten?.();
});
</script>

<main class="flex min-h-0 flex-1 bg-background">
    <div class="flex min-h-0 flex-1 flex-col {previewOpen && previewSelection.isOpen ? 'border-r border-border' : ''}">
    <!-- Chat transcript area -->
    <div class="flex-1 overflow-y-auto p-4 mr-2">
        <div class="mx-auto max-w-3xl space-y-4">
            {#if !rpcConnected && !hasConnectedOnce}
                <div class="flex h-full flex-col items-center justify-center py-20 text-center">
                    <FolderOpen class="mb-4 h-12 w-12 text-muted-foreground" />
                    <h2 class="mb-2 text-lg font-medium">Booting runtime…</h2>
                    <p class="mb-6 text-sm text-muted-foreground">
                        {#if rpcConnecting}
                            Starting VM…
                        {:else if rpcError}
                            Failed to start runtime: {rpcError}
                        {:else}
                            Waiting for the VM to signal READY.
                        {/if}
                    </p>
                    {#if rpcError}
                        <div class="flex flex-col items-center gap-2">
                            {#if vmLogPath}
                                <code class="rounded-md bg-muted px-3 py-1 text-[11px]">{vmLogPath}</code>
                                <button
                                    class="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/80 disabled:opacity-60"
                                    onclick={openVmLog}
                                    disabled={openingLog}
                                >
                                    {openingLog ? "Opening log…" : "Open QEMU log"}
                                </button>
                            {/if}
                            <button
                                class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                                onclick={connectRpc}
                                disabled={rpcConnecting}
                            >
                                Retry
                            </button>
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="flex-1 flex flex-col">
                    {#if !rpcConnected}
                        <div class="mt-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                            {#if rpcConnecting || taskSwitching}
                                Reconfiguring runtime…
                            {:else if rpcError}
                                Runtime disconnected: {rpcError}
                            {:else}
                                Runtime disconnected.
                            {/if}
                        </div>
                    {/if}

                    {#if rpcAuthHint}
                        <div class="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                            {rpcAuthHint}
                        </div>
                        <div class="mt-2 flex flex-wrap gap-2">
                            <button
                                class="rounded-md bg-secondary px-3 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                onclick={sendLogin}
                                disabled={!rpcConnected}
                            >
                                Send /login
                            </button>
                        </div>
                    {/if}
                    {#if rpcLoginUrl}
                        {#if loginPromptVisible && loginPromptedUrl === rpcLoginUrl}
                            <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <span>
                                    {#if loginPromptCountdown !== null}
                                        Auto-opening in {loginPromptCountdown}s.
                                    {:else}
                                        Login URL detected.
                                    {/if}
                                </span>
                                <button
                                    class="rounded-md bg-secondary px-2 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                    onclick={openLoginUrl}
                                    disabled={openingLoginUrl}
                                >
                                    Open now
                                </button>
                                <button
                                    class="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-60"
                                    onclick={dismissLoginPrompt}
                                    disabled={openingLoginUrl}
                                >
                                    Dismiss
                                </button>
                            </div>
                        {/if}
                        <code class="mt-2 block rounded-md bg-muted px-2 py-1 text-[11px]">{rpcLoginUrl}</code>
                        <div class="mt-2 flex flex-wrap gap-2">
                            <button
                                class="rounded-md bg-secondary px-3 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                onclick={openLoginUrl}
                                disabled={openingLoginUrl}
                            >
                                {openingLoginUrl ? "Opening login…" : "Open login URL"}
                            </button>
                            <button
                                class="rounded-md bg-secondary px-3 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                onclick={copyLoginUrl}
                                disabled={copyingLoginUrl}
                            >
                                {loginCopied
                                    ? "Copied"
                                    : copyingLoginUrl
                                        ? "Copying…"
                                        : "Copy URL"}
                            </button>
                            <button
                                class="rounded-md px-3 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-60"
                                onclick={() => setAutoOpenLogin(!autoOpenLogin)}
                                title="When on, login links auto-open after a short countdown."
                            >
                                Auto-open: {autoOpenLogin ? "On" : "Off"}
                            </button>
                        </div>
                    {/if}
                    <!-- Chat messages -->
                    <div class="mt-4 space-y-4">
                        {#if conversation.messages.length === 0 && !conversation.isAgentRunning}
                            <QuickStartTiles onselect={sendPrompt} />
                        {:else}
                            {#each conversation.messages as message}
                                {@const hasContent = message.blocks.length > 0 || message.isStreaming}
                                {#if message.role === 'user' || hasContent}
                                <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
                                    <div class="max-w-[80%] rounded-lg px-3 py-2 {message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}">
                                        {#each message.blocks as block}
                                            {#if block.type === 'text'}
                                                <div class="text-sm whitespace-pre-wrap">{block.text}</div>
                                            {:else if block.type === 'thinking' && !block.isCollapsed}
                                                <div class="text-xs text-muted-foreground italic border-l-2 border-muted-foreground/30 pl-2 my-1">
                                                    {block.text}
                                                </div>
                                            {:else if block.type === 'tool_call'}
                                                <div class="text-xs text-muted-foreground my-1 flex items-center gap-1">
                                                    {#if block.isStreaming}
                                                        <Loader2 class="h-3 w-3 animate-spin" />
                                                    {/if}
                                                    <span class="font-mono">{block.name}</span>
                                                </div>
                                            {:else if block.type === 'tool_result' && block.isError}
                                                <div class="text-xs text-red-400 my-1">
                                                    Error: {block.output}
                                                </div>
                                            {/if}
                                        {/each}
                                        {#if message.isStreaming && message.blocks.length === 0}
                                            <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
                                        {/if}
                                    </div>
                                </div>
                                {/if}
                            {/each}
                            {#if conversation.isAgentRunning && !conversation.messages.some(m => m.isStreaming)}
                                <div class="flex justify-start">
                                    <div class="rounded-lg bg-muted px-3 py-2">
                                        <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
                                    </div>
                                </div>
                            {/if}
                        {/if}
                        {#if conversation.error}
                            <div class="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
                                {conversation.error}
                            </div>
                        {/if}
                    </div>

                    {#if pendingUiRequest}
                        <ExtensionUiDialog
                            request={pendingUiRequest}
                            sending={pendingUiSending}
                            onconfirm={handleUiConfirm}
                            onselect={handleUiSelect}
                            onsubmit={handleUiSubmit}
                            oncancel={handleUiCancel}
                        />
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <!-- Composer -->
    <div class="border-t border-border p-4">
        <div class="mx-auto max-w-3xl">
            <div class="flex flex-col gap-2 rounded-lg border border-input bg-background p-2">
                <textarea
                    bind:this={textareaEl}
                    bind:value={prompt}
                    oninput={autoGrow}
                    onkeydown={handleInputKeydown}
                    placeholder="What would you like to do?"
                    rows="1"
                    class="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                    style="overflow-y: hidden;"
                ></textarea>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1">
                        <FolderSelector
                            value={currentWorkingFolder}
                            onchange={handleFolderChange}
                            disabled={!rpcConnected || Boolean(activeTask?.workingFolder)}
                            locked={Boolean(activeTask?.workingFolder)}
                        />
                        <button class="rounded-md p-1.5 hover:bg-accent" aria-label="Attach file">
                            <Paperclip class="h-4 w-4 text-muted-foreground" />
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="flex flex-col items-end gap-0.5">
                            <select
                                bind:value={selectedModelId}
                                onchange={handleModelChange}
                                disabled={!rpcConnected || modelsLoading || !!modelsError || availableModels.length === 0}
                                class="max-w-40 truncate appearance-none rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {#if modelsLoading}
                                    <option value="">Loading models…</option>
                                {:else if modelsError}
                                    <option value="">Model load failed</option>
                                {:else if availableModels.length === 0}
                                    <option value="">No models available</option>
                                {:else}
                                    {#each availableModels as model}
                                        <option value={model.id}>{model.label}</option>
                                    {/each}
                                {/if}
                            </select>

                            {#if modelsError}
                                <span class="max-w-52 truncate text-[10px] text-red-400" title={modelsError}>
                                    {modelsError}
                                </span>
                            {:else if !modelsLoading && availableModels.length === 0}
                                <span class="text-[10px] text-muted-foreground">No models available</span>
                            {/if}
                        </div>

                        <button
                            class="rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            disabled={!prompt.trim() || !canSendPrompt()}
                            onclick={() => sendPrompt()}
                            aria-label="Send"
                        >
                            <Send class="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    </div>

    {#if previewOpen && previewSelection.isOpen}
        <aside class="flex min-h-0 w-1/2 flex-col bg-background">
            <div class="flex items-center justify-between border-b border-border px-3 py-2">
                <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-foreground">
                        {previewSelection.relativePath ?? "Preview"}
                    </div>
                    {#if previewContent}
                        <div class="text-[11px] text-muted-foreground">
                            {previewContent.mimeType} · {formatBytes(previewContent.size)}
                        </div>
                    {/if}
                </div>
                <button
                    class="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                    onclick={closePreview}
                    aria-label="Close preview"
                >
                    <X class="h-4 w-4" />
                </button>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-3">
                {#if previewLoading}
                    <div class="text-sm text-muted-foreground">Loading preview…</div>
                {:else if previewError}
                    <div class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                        {previewError}
                    </div>
                {:else if previewContent}
                    {#if previewContent.encoding === "utf8"}
                        <pre class="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs text-foreground">{previewContent.content}</pre>
                    {:else if previewContent.mimeType.startsWith("image/")}
                        <img
                            src={`data:${previewContent.mimeType};base64,${previewContent.content}`}
                            alt={previewContent.path}
                            class="max-h-[80vh] w-full rounded-md border border-border object-contain bg-muted"
                        />
                    {:else}
                        <div class="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                            Binary preview is not supported yet for this file type.
                        </div>
                    {/if}

                    {#if previewContent.truncated}
                        <div class="mt-2 text-[11px] text-amber-300">
                            Preview content truncated for responsiveness.
                        </div>
                    {/if}
                {:else}
                    <div class="text-sm text-muted-foreground">No preview selected.</div>
                {/if}
            </div>
        </aside>
    {/if}

    {#if import.meta.env.DEV && devToasts.length > 0}
        <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
            {#each devToasts as toast (toast.id)}
                <div class="rounded-md border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs text-red-100 shadow">
                    {toast.message}
                </div>
            {/each}
        </div>
    {/if}
</main>
