<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Send, Paperclip, FolderOpen, Loader2 } from "@lucide/svelte";
import { devLog } from "$lib/utils/devLog";
import { TauriRpcClient, MessageAccumulator } from "$lib/rpc";
import type { RpcEvent, RpcPayload, ConversationState, ContentBlock } from "$lib/rpc";
import { taskStore } from "$lib/stores/taskStore";
import type { TaskMetadata } from "$lib/types/task";
import FolderSelector from "$lib/components/FolderSelector.svelte";
import QuickStartTiles from "$lib/components/QuickStartTiles.svelte";
import ExtensionUiDialog from "$lib/components/ExtensionUiDialog.svelte";
import type { ExtensionUiRequest } from "$lib/components/ExtensionUiDialog.svelte";

let prompt = $state("");
let textareaEl: HTMLTextAreaElement | undefined = $state();
let rpcClient: TauriRpcClient | null = $state(null);
let messageAccumulator = new MessageAccumulator();
let conversation = $state<ConversationState>(messageAccumulator.getState());
let rpcConnected = $state(false);
let rpcConnecting = $state(false);
let rpcError = $state<string | null>(null);
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

// Task tracking
let currentTaskId = $state<string | null>(null);
let currentWorkingFolder = $state<string | null>(null);
let unsubscribeActiveTask: (() => void) | null = null;

interface ModelOption {
    id: string;
    label: string;
    provider: string | null;
}

// Preferred model patterns - filter to just these
const PREFERRED_MODEL_PATTERNS = ["claude-opus-4-5", "gpt-5.2-codex", "gemini-3-pro"];

const fallbackModels: ModelOption[] = [
    { id: "claude-opus-4-5", label: "Opus 4.5", provider: "anthropic" },
    { id: "gpt-5.2-codex", label: "GPT 5.2", provider: "openai-codex" },
    { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", provider: "google-gemini-cli" },
];

function isPreferredModel(id: string): boolean {
    return PREFERRED_MODEL_PATTERNS.some((pattern) => id.includes(pattern) || id.startsWith(pattern.split("-")[0]));
}

let availableModels = $state<ModelOption[]>([...fallbackModels]);
let selectedModelId = $state(fallbackModels[0]?.id ?? "");

interface VmStatusResponse {
    status: "starting" | "ready" | "stopped";
    rpcPath: string | null;
    logPath: string | null;
}

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

function handleInputKeydown(e: KeyboardEvent) {
    // Enter sends, Shift+Enter adds newline
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendPrompt();
    }
}

function pushRpcMessage(message: string) {
    // Log to console for debugging (visible in terminal)
    devLog("RPC", message);
    maybeCaptureLoginUrl(message);
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
        "Auth required. Rebuild the dev runtime with PIWORK_COPY_AUTH=1 (or PIWORK_AUTH_PATH=~/.pi/agent/auth.json), then restart the app.";

    maybeCaptureLoginUrl(message);
}

function resolveModelOption(model: Record<string, unknown> | undefined) {
    if (!model) return null;

    const id = typeof model.id === "string" ? model.id : null;
    if (!id) return null;

    const label = typeof model.name === "string" ? model.name : id;
    const provider = typeof model.provider === "string" ? model.provider : null;

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
    if (!rpcClient || !pendingUiRequest || pendingUiSending) return;
    pendingUiSending = true;

    try {
        await rpcClient.send({ type: "extension_ui_response", id: pendingUiRequest.id, ...response });
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
    if (!rpcClient) return;
    await rpcClient.send({ type: "prompt", message: "/login" });
    pushRpcMessage("[info] Sent /login");
}

function ensureModelOption(option: ModelOption) {
    if (availableModels.some((model) => model.id === option.id)) {
        return;
    }

    availableModels = [option, ...availableModels];
}

async function refreshVmLogPath() {
    try {
        const status = await invoke<VmStatusResponse>("vm_status");
        vmLogPath = status.logPath;
    } catch {
        vmLogPath = null;
    }
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

async function requestState() {
    if (!rpcClient || rpcStateRequested) return;
    rpcStateRequested = true;
    await rpcClient.send({ type: "get_state" });
}

async function requestAvailableModels() {
    if (!rpcClient || rpcModelsRequested) return;
    rpcModelsRequested = true;
    await rpcClient.send({ type: "get_available_models" });
}

async function handleModelChange() {
    if (!rpcClient) return;

    const selected = availableModels.find((model) => model.id === selectedModelId) ?? null;
    if (!selected?.provider) {
        pushRpcMessage("[info] Model provider unknown; waiting for available models.");
        return;
    }

    await rpcClient.send({ type: "set_model", provider: selected.provider, modelId: selected.id });
}

function formatStateInfo(data: Record<string, unknown> | undefined) {
    if (!data) return null;

    let modelName: string | null = null;
    if (typeof data.model === "object" && data.model !== null) {
        const model = data.model as Record<string, unknown>;
        if (typeof model.name === "string") {
            modelName = model.name;
        } else if (typeof model.id === "string") {
            modelName = model.id;
        }
    }

    const sessionName = typeof data.sessionName === "string" ? data.sessionName : null;
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
    const isStreaming = typeof data.isStreaming === "boolean" ? data.isStreaming : null;

    const parts: string[] = [];
    if (modelName) {
        parts.push(`Model: ${modelName}`);
    }
    if (sessionName) {
        parts.push(`Session: ${sessionName}`);
    } else if (sessionId) {
        parts.push(`Session: ${sessionId.slice(0, 8)}`);
    }
    if (isStreaming !== null) {
        parts.push(`Streaming: ${isStreaming ? "yes" : "no"}`);
    }

    return parts.length > 0 ? parts.join(" · ") : null;
}

function handleRpcPayload(payload: Record<string, unknown>) {
    // Feed to message accumulator for proper conversation tracking
    messageAccumulator.processEvent(payload as RpcPayload);
    conversation = messageAccumulator.getState();

    // Auto-save conversation when agent completes a turn
    if (payload.type === "agent_end" && currentTaskId) {
        void taskStore.saveConversation(currentTaskId, messageAccumulator.serialize());
        devLog("MainView", `Auto-saved conversation after agent_end`);
    }

    const type = payload.type;

    if (type === "response") {
        const command = typeof payload.command === "string" ? payload.command : null;

        if (command === "get_state") {
            rpcStateRequested = false;

            if (payload.success === true) {
                const data = payload.data as Record<string, unknown> | undefined;
                const info = formatStateInfo(data);
                rpcStateInfo = info;

                const model =
                    typeof data?.model === "object" && data.model !== null
                        ? (data.model as Record<string, unknown>)
                        : null;
                const option = model ? resolveModelOption(model) : null;
                if (option) {
                    ensureModelOption(option);
                    selectedModelId = option.id;
                }
            } else {
                const error = payload.error;
                if (typeof error === "string") {
                    pushRpcMessage(`[error] ${error}`);
                    updateAuthHint(error);
                } else {
                    pushRpcMessage("[error] get_state failed");
                }
                rpcStateInfo = null;
            }

            return;
        }

        if (command === "get_available_models") {
            rpcModelsRequested = false;

            if (payload.success === true) {
                const data = payload.data as Record<string, unknown> | undefined;
                const models = Array.isArray(data?.models) ? data?.models : [];
                const mapped = models
                    .filter((model) => typeof model === "object" && model !== null)
                    .map((model) => resolveModelOption(model as Record<string, unknown>))
                    .filter((model): model is ModelOption => Boolean(model))
                    .filter((model) => isPreferredModel(model.id));

                if (mapped.length > 0) {
                    availableModels = mapped;
                    if (!mapped.some((model) => model.id === selectedModelId)) {
                        selectedModelId = mapped[0].id;
                    }
                }
            } else {
                const error = payload.error;
                if (typeof error === "string") {
                    pushRpcMessage(`[error] ${error}`);
                    updateAuthHint(error);
                } else {
                    pushRpcMessage("[error] get_available_models failed");
                }
            }

            return;
        }

        if (command === "set_model") {
            if (payload.success === true) {
                const data = payload.data as Record<string, unknown> | undefined;
                const option = data ? resolveModelOption(data) : null;
                if (option) {
                    ensureModelOption(option);
                    selectedModelId = option.id;
                }
                void requestState();
            } else {
                const error = payload.error;
                if (typeof error === "string") {
                    pushRpcMessage(`[error] ${error}`);
                    updateAuthHint(error);
                } else {
                    pushRpcMessage("[error] set_model failed");
                }
            }

            return;
        }

        if (payload.success === false) {
            const error = payload.error;
            if (typeof error === "string") {
                pushRpcMessage(`[error] ${error}`);
                updateAuthHint(error);
                return;
            }
        }
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
        return;
    }

    // message_update, message_end, tool_execution events are handled by MessageAccumulator
}

function handleRpcEvent(event: RpcEvent) {
    if (event.type === "ready") {
        rpcConnected = true;
        rpcError = null;
        rpcAuthHint = null;
        rpcLoginUrl = null;
        loginCopied = false;
        copyingLoginUrl = false;
        clearLoginPrompt();
        void requestState();
        void requestAvailableModels();
        return;
    }

    if (event.type === "error") {
        rpcError = typeof event.message === "string" ? event.message : "Runtime error";
        rpcConnected = false;
        rpcAuthHint = null;
        rpcLoginUrl = null;
        loginCopied = false;
        copyingLoginUrl = false;
        clearLoginPrompt();
        rpcStateInfo = null;
        rpcStateRequested = false;
        void refreshVmLogPath();
        return;
    }

    if (event.type === "rpc" && typeof event.message === "string") {
        if (!rpcConnected) {
            rpcConnected = true;
            rpcError = null;
            rpcAuthHint = null;
            rpcLoginUrl = null;
            loginCopied = false;
            copyingLoginUrl = false;
            clearLoginPrompt();
            void requestState();
            void requestAvailableModels();
        }

        try {
            const parsed = JSON.parse(event.message) as Record<string, unknown>;
            handleRpcPayload(parsed);
        } catch {
            pushRpcMessage(event.message);
        }
    }
}

async function connectRpc() {
    devLog("MainView", "connectRpc start");
    if (rpcClient || rpcConnecting) return;
    rpcConnecting = true;
    rpcError = null;
    rpcAuthHint = null;
    rpcLoginUrl = null;
    loginCopied = false;
    copyingLoginUrl = false;
    clearLoginPrompt();
    rpcStateInfo = null;
    rpcStateRequested = false;
    rpcModelsRequested = false;
    pendingUiRequest = null;
    pendingUiQueue = [];
    pendingUiSending = false;

    const client = new TauriRpcClient();
    rpcClient = client; // Set early so handlers can use it
    client.subscribe(handleRpcEvent);

    try {
        devLog("MainView", `calling client.connect with folder: ${currentWorkingFolder ?? "none"}`);
        await client.connect(currentWorkingFolder);
        devLog("MainView", "client.connect returned");
    } catch (error) {
        devLog("MainView", `connectRpc error: ${error}`);
        rpcError = error instanceof Error ? error.message : String(error);
        rpcConnected = false;
        rpcClient = null; // Clear on error
        void refreshVmLogPath();
        await client.disconnect().catch(() => undefined);
    } finally {
        devLog("MainView", "connectRpc done");
        rpcConnecting = false;
    }
}

async function disconnectRpc() {
    if (!rpcClient) return;
    await rpcClient.disconnect();
    rpcClient = null;
    rpcConnected = false;
    rpcError = null;
    rpcAuthHint = null;
    rpcLoginUrl = null;
    loginCopied = false;
    copyingLoginUrl = false;
    clearLoginPrompt();
    rpcStateInfo = null;
    rpcStateRequested = false;
    rpcModelsRequested = false;
    pendingUiRequest = null;
    pendingUiQueue = [];
    pendingUiSending = false;
}

async function sendPrompt(message?: string) {
    if (!rpcClient) return;
    const content = (message ?? prompt).trim();
    if (!content) return;

    // Auto-create task if none active
    if (!currentTaskId) {
        const title = content.length > 50 ? content.substring(0, 50) + "…" : content;
        const task = taskStore.create(title, currentWorkingFolder);
        await taskStore.upsert(task);
        taskStore.setActive(task.id);
        currentTaskId = task.id;
        devLog("MainView", `Auto-created task: ${task.id} with folder: ${currentWorkingFolder}`);
    }

    // Add user message to conversation
    messageAccumulator.addUserMessage(content);
    conversation = messageAccumulator.getState();

    await rpcClient.send({ type: "prompt", message: content });
    prompt = "";
}

let testPromptUnlisten: (() => void) | null = null;
let testFolderUnlisten: (() => void) | null = null;

async function handleTaskSwitch(newTask: TaskMetadata | null) {
    const newTaskId = newTask?.id ?? null;
    const oldTaskId = currentTaskId;

    // Skip if same task
    if (newTaskId === oldTaskId) return;

    devLog("MainView", `Task switch: ${oldTaskId} -> ${newTaskId}`);

    // Save current conversation to old task
    if (oldTaskId && messageAccumulator.getState().messages.length > 0) {
        try {
            await taskStore.saveConversation(oldTaskId, messageAccumulator.serialize());
            devLog("MainView", `Saved conversation to task ${oldTaskId}`);
        } catch (e) {
            devLog("MainView", `Failed to save conversation: ${e}`);
        }
    }

    // Reset and load new task's conversation
    messageAccumulator.reset();
    conversation = messageAccumulator.getState();

    if (newTaskId) {
        try {
            const saved = await taskStore.loadConversation(newTaskId);
            if (saved) {
                messageAccumulator.loadState(saved);
                conversation = messageAccumulator.getState();
                devLog("MainView", `Loaded conversation for task ${newTaskId}`);
            }
        } catch (e) {
            devLog("MainView", `Failed to load conversation: ${e}`);
        }
    }

    currentTaskId = newTaskId;
    currentWorkingFolder = newTask?.workingFolder ?? null;
}

async function handleFolderChange(folder: string | null) {
    currentWorkingFolder = folder;
    devLog("MainView", `Working folder changed: ${folder}`);

    // Update task if we have one
    if (currentTaskId) {
        const list = await invoke<TaskMetadata[]>("task_store_list");
        const task = list.find((t) => t.id === currentTaskId);
        if (task) {
            await taskStore.upsert({
                ...task,
                workingFolder: folder,
                updatedAt: new Date().toISOString(),
            });
        }
    }

    // Restart VM with new folder mount
    if (rpcClient) {
        devLog("MainView", "Restarting VM with new folder...");
        rpcConnected = false;
        await rpcClient.stopVm();
        rpcClient = null;
        await connectRpc();
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

    void connectRpc();
    void refreshVmLogPath();

    // Subscribe to active task changes
    unsubscribeActiveTask = taskStore.activeTask.subscribe((task) => {
        void handleTaskSwitch(task);
    });

    // Test harness listeners (dev only)
    if (import.meta.env.DEV) {
        listen<string>("test_prompt", (event) => {
            devLog("TestHarness", `received test_prompt: ${event.payload}`);
            prompt = event.payload;
            void sendPrompt();
        }).then((unlisten) => {
            testPromptUnlisten = unlisten;
        });

        listen<string | null>("test_set_folder", (event) => {
            devLog("TestHarness", `received test_set_folder: ${event.payload}`);
            void handleFolderChange(event.payload);
        }).then((unlisten) => {
            testFolderUnlisten = unlisten;
        });
    }
});

onDestroy(() => {
    // Save conversation before unmounting
    if (currentTaskId && messageAccumulator.getState().messages.length > 0) {
        void taskStore.saveConversation(currentTaskId, messageAccumulator.serialize());
    }
    unsubscribeActiveTask?.();
    void disconnectRpc();
    testPromptUnlisten?.();
    testFolderUnlisten?.();
});
</script>

<main class="flex flex-1 flex-col bg-background">
    <!-- Chat transcript area -->
    <div class="flex-1 overflow-y-auto p-4 mr-2">
        <div class="mx-auto max-w-3xl space-y-4">
            {#if !rpcConnected}
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
                            disabled={!rpcConnected}
                        />
                        <button class="rounded-md p-1.5 hover:bg-accent" aria-label="Attach file">
                            <Paperclip class="h-4 w-4 text-muted-foreground" />
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <select
                            bind:value={selectedModelId}
                            onchange={handleModelChange}
                            class="max-w-32 truncate appearance-none rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent cursor-pointer"
                        >
                            {#each availableModels as model}
                                <option value={model.id}>{model.label}</option>
                            {/each}
                        </select>
                        <button
                            class="rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            disabled={!prompt.trim() || !rpcConnected}
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
</main>
