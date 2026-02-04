<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Send, Paperclip, FolderOpen, ChevronDown } from "@lucide/svelte";
import { TauriRpcClient } from "$lib/rpc";
import type { RpcEvent } from "$lib/rpc";

let prompt = $state("");
let textareaEl: HTMLTextAreaElement | undefined = $state();
let selectedModel = $state("claude-opus-4-5");
let rpcClient: TauriRpcClient | null = $state(null);
let rpcMessages = $state<string[]>([]);
let rpcStreaming = $state("");
let rpcConnected = $state(false);
let rpcConnecting = $state(false);
let rpcError = $state<string | null>(null);
let vmLogPath = $state<string | null>(null);
let openingLog = $state(false);

interface VmStatusResponse {
    status: "starting" | "ready" | "stopped";
    rpcPath: string | null;
    logPath: string | null;
}

const models = [
    { id: "claude-opus-4-5", label: "Opus 4.5" },
    { id: "gpt-5.2", label: "GPT 5.2" },
    { id: "gemini-3-pro", label: "Gemini 3" },
    { id: "kimi-2.5", label: "Kimi 2.5" },
];

const MAX_HEIGHT = 200;

function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, MAX_HEIGHT) + "px";
    textareaEl.style.overflowY = textareaEl.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}

function pushRpcMessage(message: string) {
    rpcMessages = [...rpcMessages, message];
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

function handleRpcPayload(payload: Record<string, unknown>) {
    const type = payload.type;

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

    if (type === "response" && payload.success === false) {
        const error = payload.error;
        if (typeof error === "string") {
            pushRpcMessage(`[error] ${error}`);
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
        return;
    }

    if (event.type === "error") {
        rpcError = typeof event.message === "string" ? event.message : "Runtime error";
        rpcConnected = false;
        void refreshVmLogPath();
        return;
    }

    if (event.type === "rpc" && typeof event.message === "string") {
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
                            bind:value={selectedModel}
                            class="appearance-none rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent cursor-pointer"
                        >
                            {#each models as model}
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
