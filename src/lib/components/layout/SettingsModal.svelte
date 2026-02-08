<script lang="ts">
import { onDestroy } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { X } from "@lucide/svelte";

const CUSTOM_PROVIDER_ID = "__custom__";

const KNOWN_PROVIDERS = [
    { id: "anthropic", label: "Anthropic (Claude)" },
    { id: "openai-codex", label: "OpenAI (Codex)" },
    { id: "google-gemini-cli", label: "Google (Gemini CLI)" },
] as const;

const {
    open = false,
    onClose = null,
    onApplyAuthChanges = null,
} = $props<{
    open?: boolean;
    onClose?: (() => void) | null;
    onApplyAuthChanges?: (() => void | Promise<void>) | null;
}>();

interface AuthStoreEntry {
    provider: string;
    entryType: string;
}

interface AuthStoreSummary {
    path: string;
    entries: AuthStoreEntry[];
}

let entries = $state<AuthStoreEntry[]>([]);
let storePath = $state<string | null>(null);
let loading = $state(false);
let savingApiKey = $state(false);
let deletingProvider = $state<string | null>(null);
let importingAuth = $state(false);
let applyingAuthChanges = $state(false);
let openingStorePath = $state(false);
let providerSelection = $state<string>(KNOWN_PROVIDERS[0].id);
let customProvider = $state("");
let apiKey = $state("");
let showApiKey = $state(false);
let error = $state<string | null>(null);
let notice = $state<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let wasOpen = $state(false);

function clearNotice() {
    notice = null;
    if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
    }
}

function setNotice(message: string) {
    notice = message;

    if (noticeTimer) {
        clearTimeout(noticeTimer);
    }

    noticeTimer = setTimeout(() => {
        notice = null;
    }, 3000);
}

function formatEntryType(entryType: string) {
    return entryType === "api_key" ? "API key" : entryType;
}

function selectedProvider() {
    if (providerSelection === CUSTOM_PROVIDER_ID) {
        return customProvider.trim();
    }

    return providerSelection.trim();
}

function resetApiKeyForm() {
    providerSelection = KNOWN_PROVIDERS[0].id;
    customProvider = "";
    apiKey = "";
    showApiKey = false;
}

async function loadAuthStatus() {
    loading = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_list");
        entries = summary.entries;
        storePath = summary.path;
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        loading = false;
    }
}

async function saveApiKey() {
    if (savingApiKey) return;

    const provider = selectedProvider();
    const key = apiKey.trim();

    if (!provider) {
        error = "Provider is required.";
        return;
    }

    if (!key) {
        error = "API key is required.";
        return;
    }

    savingApiKey = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_set_api_key", {
            provider,
            key,
        });

        entries = summary.entries;
        storePath = summary.path;
        apiKey = "";
        showApiKey = false;
        setNotice(`Saved API key for ${provider}`);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        savingApiKey = false;
    }
}

async function removeProvider(provider: string) {
    if (!provider || deletingProvider) return;

    deletingProvider = provider;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_delete", { provider });
        entries = summary.entries;
        storePath = summary.path;
        setNotice(`Removed ${provider}`);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        deletingProvider = null;
    }
}

async function importPiAuth() {
    if (importingAuth) return;

    importingAuth = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_import_pi");
        entries = summary.entries;
        storePath = summary.path;
        setNotice("Imported ~/.pi/agent/auth.json");
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        importingAuth = false;
    }
}

async function requestApplyAuthChanges() {
    if (applyingAuthChanges) return;

    applyingAuthChanges = true;
    error = null;

    try {
        if (!onApplyAuthChanges) {
            throw new Error("Auth apply handler is unavailable in this view.");
        }

        await onApplyAuthChanges();
        setNotice("Requested runtime restart to apply auth changes.");
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        applyingAuthChanges = false;
    }
}

async function openAuthStorePath() {
    if (!storePath || openingStorePath) return;

    openingStorePath = true;

    try {
        await openPath(storePath);
    } finally {
        openingStorePath = false;
    }
}

function initializeOpen() {
    clearNotice();
    error = null;
    resetApiKeyForm();
    void loadAuthStatus();
}

function resetOnClose() {
    clearNotice();
    error = null;
    loading = false;
    savingApiKey = false;
    deletingProvider = null;
    importingAuth = false;
    applyingAuthChanges = false;
    openingStorePath = false;
    resetApiKeyForm();
}

$effect(() => {
    if (open && !wasOpen) {
        wasOpen = true;
        initializeOpen();
        return;
    }

    if (!open && wasOpen) {
        wasOpen = false;
        resetOnClose();
    }
});

onDestroy(() => {
    if (noticeTimer) {
        clearTimeout(noticeTimer);
    }
});
</script>

{#if open}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
            class="absolute inset-0 bg-black/40"
            type="button"
            aria-label="Close settings"
            onclick={() => onClose?.()}
        ></button>

        <div class="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg">
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-lg font-semibold">Settings</h2>
                    <p class="text-sm text-muted-foreground">Authentication</p>
                </div>
                <button class="rounded-md p-2 hover:bg-accent" aria-label="Close" onclick={() => onClose?.()}>
                    <X class="h-4 w-4" />
                </button>
            </div>

            <div class="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Auth is API-key first for now. Add provider keys here, then apply auth changes.
                <span class="font-medium">Import from pi</span> stays available as convenience.
            </div>

            <div class="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <div class="text-sm font-medium">Add provider API key</div>

                <div class="mt-3 space-y-3">
                    <div class="space-y-1">
                        <label class="text-xs text-muted-foreground" for="api-key-provider">Provider</label>
                        <select
                            id="api-key-provider"
                            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            bind:value={providerSelection}
                        >
                            {#each KNOWN_PROVIDERS as option}
                                <option value={option.id}>{option.label}</option>
                            {/each}
                            <option value={CUSTOM_PROVIDER_ID}>Custom provider id…</option>
                        </select>
                    </div>

                    {#if providerSelection === CUSTOM_PROVIDER_ID}
                        <div class="space-y-1">
                            <label class="text-xs text-muted-foreground" for="custom-provider">Custom provider id</label>
                            <input
                                id="custom-provider"
                                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                                placeholder="provider-id"
                                bind:value={customProvider}
                            />
                        </div>
                    {/if}

                    <div class="space-y-1">
                        <label class="text-xs text-muted-foreground" for="api-key-value">API key</label>
                        <div class="flex gap-2">
                            <input
                                id="api-key-value"
                                class="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                                type={showApiKey ? "text" : "password"}
                                placeholder="sk-..."
                                autocomplete="off"
                                bind:value={apiKey}
                            />
                            <button
                                class="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80"
                                type="button"
                                onclick={() => (showApiKey = !showApiKey)}
                            >
                                {showApiKey ? "Hide" : "Show"}
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        class="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                        onclick={saveApiKey}
                        disabled={savingApiKey}
                    >
                        {savingApiKey ? "Saving…" : "Save API key"}
                    </button>
                    <button
                        class="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80 disabled:opacity-60"
                        onclick={resetApiKeyForm}
                        disabled={savingApiKey}
                    >
                        Reset form
                    </button>
                </div>
            </div>

            <div class="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-sm font-medium">Current auth status</div>
                    <span
                        class="rounded-full px-2 py-1 text-[11px] font-medium {loading
                            ? 'bg-secondary text-muted-foreground'
                            : entries.length > 0
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/15 text-amber-300'}"
                    >
                        {#if loading}
                            Checking…
                        {:else if entries.length > 0}
                            Configured
                        {:else}
                            Not configured
                        {/if}
                    </span>
                </div>

                <div class="mt-3 text-xs text-muted-foreground">
                    {#if loading}
                        Checking stored providers…
                    {:else if entries.length === 0}
                        No providers found in the default auth store yet.
                    {:else}
                        Found {entries.length} provider{entries.length === 1 ? "" : "s"} in default auth store.
                    {/if}
                </div>

                {#if entries.length > 0}
                    <div class="mt-3 space-y-2">
                        {#each entries as entry}
                            <div class="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                                <div>
                                    <div class="text-sm font-medium text-foreground">{entry.provider}</div>
                                    <div class="text-xs text-muted-foreground">{formatEntryType(entry.entryType)}</div>
                                </div>
                                <button
                                    class="rounded-md bg-secondary px-2 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                    type="button"
                                    onclick={() => removeProvider(entry.provider)}
                                    disabled={Boolean(deletingProvider)}
                                >
                                    {deletingProvider === entry.provider ? "Removing…" : "Remove"}
                                </button>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if storePath}
                    <div class="mt-3 text-[11px] text-muted-foreground">
                        <span class="uppercase tracking-wide">Storage</span>
                        <code class="mt-1 block rounded-md bg-muted px-2 py-1">{storePath}</code>
                    </div>
                {/if}

                <div class="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        class="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                        onclick={requestApplyAuthChanges}
                        disabled={applyingAuthChanges || !onApplyAuthChanges}
                    >
                        {applyingAuthChanges ? "Applying…" : "Apply auth changes"}
                    </button>

                    <button
                        class="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80 disabled:opacity-60"
                        onclick={loadAuthStatus}
                        disabled={loading}
                    >
                        {loading ? "Refreshing…" : "Refresh"}
                    </button>

                    <button
                        class="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80 disabled:opacity-60"
                        onclick={openAuthStorePath}
                        disabled={!storePath || openingStorePath}
                    >
                        {openingStorePath ? "Opening…" : "Open auth file"}
                    </button>
                </div>
            </div>

            <div class="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <div class="text-sm font-medium">Import from existing pi setup (optional)</div>
                <p class="mt-2 text-xs text-muted-foreground">
                    Merge credentials from <span class="font-mono">~/.pi/agent/auth.json</span> into Piwork's default auth
                    store.
                </p>
                <div class="mt-3">
                    <button
                        class="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80 disabled:opacity-60"
                        onclick={importPiAuth}
                        disabled={importingAuth}
                    >
                        {importingAuth ? "Importing…" : "Import from pi"}
                    </button>
                </div>
            </div>

            {#if notice}
                <div class="mt-3 text-xs text-emerald-400">{notice}</div>
            {/if}

            {#if error}
                <div class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    {error}
                </div>
            {/if}
        </div>
    </div>
{/if}
