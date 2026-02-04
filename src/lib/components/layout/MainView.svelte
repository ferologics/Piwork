<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Send, Paperclip, FolderOpen, ChevronDown } from "@lucide/svelte";
import { TauriRpcClient } from "$lib/rpc";
import type { RpcEvent } from "$lib/rpc";

let prompt = $state("");
let textareaEl: HTMLTextAreaElement | undefined = $state();
let selectedModel = $state("claude-opus-4-5");
let rpcClient: TauriRpcClient | null = $state(null);
let rpcMessages = $state<string[]>([]);
let rpcConnected = $state(false);
let rpcConnecting = $state(false);
let rpcError = $state<string | null>(null);

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

function handleRpcEvent(event: RpcEvent) {
    if (event.type === "ready") {
        rpcConnected = true;
        rpcError = null;
        return;
    }

    if (event.type === "error") {
        rpcError = typeof event.message === "string" ? event.message : "Runtime error";
        rpcConnected = false;
        return;
    }

    if (event.type === "rpc" && typeof event.message === "string") {
        let message = event.message;

        try {
            const parsed = JSON.parse(event.message) as { content?: unknown; message?: unknown; type?: unknown };
            if (typeof parsed?.content === "string") {
                message = parsed.content;
            } else if (typeof parsed?.message === "string") {
                message = parsed.message;
            } else if (typeof parsed?.type === "string") {
                message = `[${parsed.type}]`;
            }
        } catch {
            // Ignore JSON parse errors.
        }

        rpcMessages = [...rpcMessages, message];
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
                        <button
                            class="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/80 disabled:opacity-60"
                            onclick={connectRpc}
                            disabled={rpcConnecting}
                        >
                            Retry
                        </button>
                    {/if}
                </div>
            {:else}
                <div class="rounded-lg border border-border bg-card p-4">
                    <div class="text-sm font-medium">RPC output</div>
                    <div class="mt-2 space-y-2 text-xs text-muted-foreground">
                        {#if rpcMessages.length === 0}
                            <div>No events yet.</div>
                        {:else}
                            {#each rpcMessages as message}
                                <div class="break-words rounded-md bg-muted px-2 py-1">{message}</div>
                            {/each}
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
