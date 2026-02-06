<script lang="ts">
import { onDestroy } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { X } from "@lucide/svelte";

const { open = false, onClose = null } = $props<{
    open?: boolean;
    onClose?: (() => void) | null;
}>();

interface AuthStoreEntry {
    provider: string;
    entryType: string;
}

interface AuthStoreSummary {
    path: string;
    entries: AuthStoreEntry[];
}

const DEFAULT_PROFILE = "default";
const RUNTIME_BUILD_AUTH_COMMAND = "PIWORK_COPY_AUTH=1 mise run runtime-build-auth";

let entries = $state<AuthStoreEntry[]>([]);
let storePath = $state<string | null>(null);
let loading = $state(false);
let importingAuth = $state(false);
let openingStorePath = $state(false);
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

async function loadAuthStatus() {
    loading = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_list", {
            profile: DEFAULT_PROFILE,
        });
        entries = summary.entries;
        storePath = summary.path;
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        loading = false;
    }
}

async function importPiAuth() {
    if (importingAuth) return;

    importingAuth = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_import_pi", {
            profile: DEFAULT_PROFILE,
        });
        entries = summary.entries;
        storePath = summary.path;
        setNotice("Imported ~/.pi/agent/auth.json");
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        importingAuth = false;
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
    void loadAuthStatus();
}

function resetOnClose() {
    clearNotice();
    error = null;
    loading = false;
    importingAuth = false;
    openingStorePath = false;
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
                    <p class="text-sm text-muted-foreground">Authentication (MVP)</p>
                </div>
                <button class="rounded-md p-2 hover:bg-accent" aria-label="Close" onclick={() => onClose?.()}>
                    <X class="h-4 w-4" />
                </button>
            </div>

            <div class="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                For MVP, auth comes from either imported host credentials (<span class="font-mono">~/.pi/agent/auth.json</span>)
                or baked runtime auth (<span class="font-mono">{RUNTIME_BUILD_AUTH_COMMAND}</span>).
            </div>

            <div class="mt-6 rounded-lg border border-border bg-muted/30 p-4">
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
                            <div class="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                                <div class="text-sm font-medium text-foreground">{entry.provider}</div>
                                <div class="text-xs text-muted-foreground">{formatEntryType(entry.entryType)}</div>
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
                        onclick={importPiAuth}
                        disabled={importingAuth}
                    >
                        {importingAuth ? "Importing…" : "Import from pi"}
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

                {#if notice}
                    <div class="mt-3 text-xs text-emerald-400">{notice}</div>
                {/if}

                {#if error}
                    <div class="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                        {error}
                    </div>
                {/if}
            </div>

            <div class="mt-3 text-xs text-muted-foreground">
                After auth changes, restart runtime if the current task session is already running.
            </div>
        </div>
    </div>
{/if}
