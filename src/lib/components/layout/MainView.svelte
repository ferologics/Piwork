<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Send, Paperclip, FolderOpen, ChevronDown } from "@lucide/svelte";
import { TauriRpcClient } from "$lib/rpc";
import type { RpcEvent } from "$lib/rpc";

let prompt = $state("");
let textareaEl: HTMLTextAreaElement | undefined = $state();
let rpcClient: TauriRpcClient | null = $state(null);
let rpcMessages = $state<string[]>([]);
let rpcStreaming = $state("");
let rpcConnected = $state(false);
let rpcConnecting = $state(false);
let rpcError = $state<string | null>(null);
let rpcAuthHint = $state<string | null>(null);
let rpcLoginUrl = $state<string | null>(null);
let openingLoginUrl = $state(false);
let copyingLoginUrl = $state(false);
let loginCopied = $state(false);
let rpcStateInfo = $state<string | null>(null);
let rpcStateRequested = $state(false);
let rpcModelsRequested = $state(false);
let pendingUiRequest = $state<ExtensionUiRequest | null>(null);
let pendingUiQueue = $state<ExtensionUiRequest[]>([]);
let pendingUiInput = $state("");
let pendingUiSending = $state(false);
let vmLogPath = $state<string | null>(null);
let openingLog = $state(false);

interface ModelOption {
    id: string;
    label: string;
    provider: string | null;
}

interface ExtensionUiRequest {
    id: string;
    method: string;
    title?: string;
    message?: string;
    options?: string[];
    placeholder?: string;
    prefill?: string;
    notifyType?: string;
    statusKey?: string;
    statusText?: string;
    widgetKey?: string;
    widgetLines?: string[];
    widgetPlacement?: string;
}

const fallbackModels: ModelOption[] = [
    { id: "claude-opus-4-5", label: "Opus 4.5", provider: null },
    { id: "gpt-5.2", label: "GPT 5.2", provider: null },
    { id: "gemini-3-pro", label: "Gemini 3", provider: null },
    { id: "kimi-2.5", label: "Kimi 2.5", provider: null },
];

let availableModels = $state<ModelOption[]>([...fallbackModels]);
let selectedModelId = $state(fallbackModels[0]?.id ?? "");

interface VmStatusResponse {
    status: "starting" | "ready" | "stopped";
    rpcPath: string | null;
    logPath: string | null;
}

const MAX_HEIGHT = 200;

function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, MAX_HEIGHT) + "px";
    textareaEl.style.overflowY = textareaEl.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}

function pushRpcMessage(message: string) {
    rpcMessages = [...rpcMessages, message];
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
        rpcLoginUrl = url;
    }
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
        notifyType: typeof payload.notifyType === "string" ? payload.notifyType : undefined,
        statusKey: typeof payload.statusKey === "string" ? payload.statusKey : undefined,
        statusText: typeof payload.statusText === "string" ? payload.statusText : undefined,
        widgetKey: typeof payload.widgetKey === "string" ? payload.widgetKey : undefined,
        widgetLines: parseStringArray(payload.widgetLines),
        widgetPlacement: typeof payload.widgetPlacement === "string" ? payload.widgetPlacement : undefined,
    } satisfies ExtensionUiRequest;
}

function queueUiRequest(request: ExtensionUiRequest) {
    if (!pendingUiRequest) {
        pendingUiRequest = request;
        pendingUiInput = request.prefill ?? "";
        return;
    }

    pendingUiQueue = [...pendingUiQueue, request];
}

function clearUiRequest() {
    pendingUiRequest = null;
    pendingUiInput = "";
    pendingUiSending = false;

    if (pendingUiQueue.length > 0) {
        const [next, ...rest] = pendingUiQueue;
        pendingUiQueue = rest;
        pendingUiRequest = next;
        pendingUiInput = next.prefill ?? "";
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

async function handleUiSubmit() {
    await sendUiResponse({ value: pendingUiInput });
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

    try {
        await openUrl(rpcLoginUrl);
    } finally {
        openingLoginUrl = false;
    }
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
                    .filter((model): model is ModelOption => Boolean(model));

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
            const statusText = request.statusText ?? "";
            pushRpcMessage(`[status] ${request.statusKey ?? "status"}: ${statusText}`);
            return;
        }

        if (request.method === "setWidget") {
            pushRpcMessage(`[widget] ${request.widgetKey ?? "widget"}`);
            return;
        }

        queueUiRequest(request);
        pushRpcMessage(`[ui] ${request.method} requested`);
        return;
    }

    if (type === "message_update") {
        const event = payload.assistantMessageEvent as Record<string, unknown> | undefined;
        const eventType = event?.type;

        if (eventType === "text_delta" && typeof event?.delta === "string") {
            rpcStreaming += event.delta;
            return;
        }

        if (eventType === "text_end" && typeof event?.content === "string") {
            rpcStreaming = event.content;
            pushRpcMessage(rpcStreaming);
            rpcStreaming = "";
            return;
        }

        if (eventType === "done") {
            if (rpcStreaming) {
                pushRpcMessage(rpcStreaming);
                rpcStreaming = "";
            }
            return;
        }
    }

    if (type === "message_end") {
        const message = payload.message as Record<string, unknown> | undefined;
        const content = extractMessageContent(message);
        if (content) {
            pushRpcMessage(content);
            rpcStreaming = "";
            return;
        }
    }

    if (type === "tool_execution_start") {
        const toolName = payload.toolName;
        if (typeof toolName === "string") {
            pushRpcMessage(`[tool] ${toolName}`);
            return;
        }
    }

    const message = extractFallbackMessage(payload);
    if (message) {
        pushRpcMessage(message);
    }
}

function extractMessageContent(message: Record<string, unknown> | undefined) {
    if (!message) return null;

    if (typeof message.content === "string") {
        return message.content;
    }

    if (Array.isArray(message.content)) {
        const parts = message.content
            .filter((part) => typeof part === "object" && part !== null)
            .map((part) => part as Record<string, unknown>)
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text as string);

        if (parts.length > 0) {
            return parts.join("");
        }
    }

    return null;
}

function extractFallbackMessage(payload: Record<string, unknown>) {
    if (typeof payload.content === "string") return payload.content;
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.type === "string") return `[${payload.type}]`;

    return null;
}

function handleRpcEvent(event: RpcEvent) {
    if (event.type === "ready") {
        rpcConnected = true;
        rpcError = null;
        rpcAuthHint = null;
        rpcLoginUrl = null;
        loginCopied = false;
        copyingLoginUrl = false;
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
    if (rpcClient || rpcConnecting) return;
    rpcConnecting = true;
    rpcError = null;
    rpcAuthHint = null;
    rpcLoginUrl = null;
    loginCopied = false;
    copyingLoginUrl = false;
    rpcStateInfo = null;
    rpcStateRequested = false;
    rpcModelsRequested = false;
    pendingUiRequest = null;
    pendingUiQueue = [];
    pendingUiInput = "";
    pendingUiSending = false;

    const client = new TauriRpcClient();
    client.subscribe(handleRpcEvent);

    try {
        await client.connect();
        rpcClient = client;
    } catch (error) {
        rpcError = error instanceof Error ? error.message : String(error);
        rpcConnected = false;
        void refreshVmLogPath();
        await client.disconnect().catch(() => undefined);
    } finally {
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
    rpcStateInfo = null;
    rpcStateRequested = false;
    rpcModelsRequested = false;
    pendingUiRequest = null;
    pendingUiQueue = [];
    pendingUiInput = "";
    pendingUiSending = false;
}

async function sendPrompt() {
    if (!rpcClient) return;
    const content = prompt.trim();
    if (!content) return;

    await rpcClient.send({ type: "prompt", message: content });
    prompt = "";
}

onMount(() => {
    void connectRpc();
    void refreshVmLogPath();
});

onDestroy(() => {
    void disconnectRpc();
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
                <div class="rounded-lg border border-border bg-card p-4">
                    <div class="text-sm font-medium">RPC output</div>
                    {#if rpcStateInfo}
                        <div class="mt-1 text-[11px] text-muted-foreground">{rpcStateInfo}</div>
                    {:else if rpcStateRequested}
                        <div class="mt-1 text-[11px] text-muted-foreground">Loading state…</div>
                    {/if}
                    {#if rpcAuthHint}
                        <div class="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                            {rpcAuthHint}
                        </div>
                        {#if rpcLoginUrl}
                            <code class="mt-2 block rounded-md bg-muted px-2 py-1 text-[11px]">{rpcLoginUrl}</code>
                        {/if}
                        <div class="mt-2 flex flex-wrap gap-2">
                            {#if rpcLoginUrl}
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
                            {/if}
                            <button
                                class="rounded-md bg-secondary px-3 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                onclick={sendLogin}
                                disabled={!rpcConnected}
                            >
                                Send /login
                            </button>
                        </div>
                    {/if}
                    <div class="mt-2 space-y-2 text-xs text-muted-foreground">
                        {#if rpcMessages.length === 0 && !rpcStreaming}
                            <div>No events yet.</div>
                        {:else}
                            {#each rpcMessages as message}
                                <div class="break-words rounded-md bg-muted px-2 py-1">{message}</div>
                            {/each}
                            {#if rpcStreaming}
                                <div class="break-words rounded-md bg-muted/60 px-2 py-1 italic">{rpcStreaming}</div>
                            {/if}
                        {/if}
                    </div>
                    {#if pendingUiRequest}
                        <div class="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                            <div class="text-sm font-medium text-foreground">
                                {pendingUiRequest.title ?? "Action required"}
                            </div>
                            {#if pendingUiRequest.message}
                                <div class="mt-1">{pendingUiRequest.message}</div>
                            {/if}
                            <div class="mt-2 text-[11px] text-muted-foreground">
                                Method: {pendingUiRequest.method}
                            </div>
                            {#if pendingUiRequest.method === "confirm"}
                                <div class="mt-3 flex gap-2">
                                    <button
                                        class="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                                        onclick={() => handleUiConfirm(true)}
                                        disabled={pendingUiSending}
                                    >
                                        Confirm
                                    </button>
                                    <button
                                        class="rounded-md bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-60"
                                        onclick={() => handleUiConfirm(false)}
                                        disabled={pendingUiSending}
                                    >
                                        Deny
                                    </button>
                                    <button
                                        class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                                        onclick={handleUiCancel}
                                        disabled={pendingUiSending}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            {:else if pendingUiRequest.method === "select"}
                                <div class="mt-3 flex flex-wrap gap-2">
                                    {#each pendingUiRequest.options ?? [] as option}
                                        <button
                                            class="rounded-md bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-60"
                                            onclick={() => handleUiSelect(option)}
                                            disabled={pendingUiSending}
                                        >
                                            {option}
                                        </button>
                                    {/each}
                                    <button
                                        class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                                        onclick={handleUiCancel}
                                        disabled={pendingUiSending}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            {:else if pendingUiRequest.method === "input"}
                                <div class="mt-3 space-y-2">
                                    <input
                                        class="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                                        placeholder={pendingUiRequest.placeholder ?? "Enter a value"}
                                        bind:value={pendingUiInput}
                                    />
                                    <div class="flex gap-2">
                                        <button
                                            class="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                                            onclick={handleUiSubmit}
                                            disabled={pendingUiSending}
                                        >
                                            Submit
                                        </button>
                                        <button
                                            class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                                            onclick={handleUiCancel}
                                            disabled={pendingUiSending}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            {:else if pendingUiRequest.method === "editor"}
                                <div class="mt-3 space-y-2">
                                    <textarea
                                        class="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                                        rows="4"
                                        bind:value={pendingUiInput}
                                    ></textarea>
                                    <div class="flex gap-2">
                                        <button
                                            class="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                                            onclick={handleUiSubmit}
                                            disabled={pendingUiSending}
                                        >
                                            Submit
                                        </button>
                                        <button
                                            class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                                            onclick={handleUiCancel}
                                            disabled={pendingUiSending}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            {:else}
                                <div class="mt-3 flex gap-2">
                                    <button
                                        class="rounded-md bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-60"
                                        onclick={handleUiCancel}
                                        disabled={pendingUiSending}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            {/if}
                        </div>
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
                    placeholder="What would you like to do?"
                    rows="1"
                    class="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                    style="overflow-y: hidden;"
                ></textarea>
                <div class="flex items-center justify-between">
                    <button class="rounded-md p-1.5 hover:bg-accent" aria-label="Attach file">
                        <Paperclip class="h-4 w-4 text-muted-foreground" />
                    </button>
                    <div class="flex items-center gap-2">
                        <select
                            bind:value={selectedModelId}
                            onchange={handleModelChange}
                            class="appearance-none rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent cursor-pointer"
                        >
                            {#each availableModels as model}
                                <option value={model.id}>{model.label}</option>
                            {/each}
                        </select>
                        <button
                            class="rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            disabled={!prompt.trim() || !rpcConnected}
                            onclick={sendPrompt}
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
