<script lang="ts">
import { onDestroy } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, X } from "@lucide/svelte";

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

const providerOptions = [
    { id: "anthropic", label: "Anthropic" },
    { id: "openai", label: "OpenAI" },
    { id: "google", label: "Google" },
    { id: "mistral", label: "Mistral" },
    { id: "groq", label: "Groq" },
    { id: "cerebras", label: "Cerebras" },
    { id: "xai", label: "xAI" },
    { id: "openrouter", label: "OpenRouter" },
    { id: "ai_gateway", label: "Vercel AI Gateway" },
    { id: "zai", label: "ZAI" },
    { id: "opencode", label: "OpenCode Zen" },
    { id: "huggingface", label: "Hugging Face" },
    { id: "kimi", label: "Kimi" },
    { id: "minimax", label: "MiniMax" },
    { id: "minimax_cn", label: "MiniMax (China)" },
];

let profile = $state("default");
let provider = $state("");
let apiKey = $state("");
let entries = $state<AuthStoreEntry[]>([]);
let storePath = $state<string | null>(null);
let loading = $state(false);
let saving = $state(false);
let error = $state<string | null>(null);
let notice = $state<string | null>(null);
let commandNotice = $state<string | null>(null);
let copyingCommand = $state(false);
let commandCopied = $state(false);
let newProfile = $state("");
let profileNotice = $state<string | null>(null);
let profileError = $state<string | null>(null);
let profileTimer: ReturnType<typeof setTimeout> | null = null;
let profileSetTimer: ReturnType<typeof setTimeout> | null = null;

const PROFILE_STORAGE_KEY = "piwork:auth-profile";

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let commandTimer: ReturnType<typeof setTimeout> | null = null;

async function loadEntries() {
    loading = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_list", { profile });
        entries = summary.entries;
        storePath = summary.path;
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        loading = false;
    }
}

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

function clearCommandNotice() {
    commandNotice = null;
    if (commandTimer) {
        clearTimeout(commandTimer);
        commandTimer = null;
    }
}

function setCommandNotice(message: string) {
    commandNotice = message;
    if (commandTimer) {
        clearTimeout(commandTimer);
    }
    commandTimer = setTimeout(() => {
        commandNotice = null;
    }, 3000);
}

function resetCommandCopy() {
    copyingCommand = false;
    commandCopied = false;
    clearCommandNotice();
}

function clearProfileNotice() {
    profileNotice = null;
    if (profileTimer) {
        clearTimeout(profileTimer);
        profileTimer = null;
    }
}

function setProfileNotice(message: string) {
    profileNotice = message;
    if (profileTimer) {
        clearTimeout(profileTimer);
    }
    profileTimer = setTimeout(() => {
        profileNotice = null;
    }, 3000);
}

function clearProfileSetNotice() {
    profileError = null;
    if (profileSetTimer) {
        clearTimeout(profileSetTimer);
        profileSetTimer = null;
    }
}

function setProfileError(message: string) {
    profileError = message;
    if (profileSetTimer) {
        clearTimeout(profileSetTimer);
    }
    profileSetTimer = setTimeout(() => {
        profileError = null;
    }, 3000);
}

function buildAuthCommand() {
    return `PIWORK_COPY_AUTH=1 PIWORK_AUTH_PROFILE=${profile} mise run runtime-install-dev`;
}

function persistProfile() {
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, profile);
    } catch {
        // Ignore storage errors.
    }
}

function handleProfileChange() {
    clearProfileSetNotice();
    clearProfileNotice();
    persistProfile();
    void loadEntries();
}

async function addProfile() {
    const trimmed = newProfile.trim();
    if (!trimmed) {
        setProfileError("Profile name required.");
        return;
    }

    profile = trimmed;
    newProfile = "";
    setProfileNotice(`Switched to ${trimmed}`);
    clearProfileSetNotice();
    clearProfileNotice();
    persistProfile();
    await loadEntries();
}

async function copyAuthCommand() {
    if (copyingCommand) return;

    if (!navigator?.clipboard) {
        setCommandNotice("Clipboard unavailable");
        return;
    }

    copyingCommand = true;
    commandCopied = false;

    try {
        await navigator.clipboard.writeText(buildAuthCommand());
        commandCopied = true;
        setCommandNotice("Command copied.");
    } catch {
        setCommandNotice("Failed to copy command.");
    } finally {
        copyingCommand = false;
    }
}

async function saveApiKey() {
    const trimmedProvider = provider.trim();
    const trimmedKey = apiKey.trim();

    if (!trimmedProvider || !trimmedKey) {
        error = "Provider and API key are required.";
        return;
    }

    saving = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_set_api_key", {
            profile,
            provider: trimmedProvider,
            key: trimmedKey,
        });
        entries = summary.entries;
        storePath = summary.path;
        apiKey = "";
        provider = trimmedProvider;
        setNotice("API key saved.");
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        saving = false;
    }
}

async function deleteProvider(target: string) {
    saving = true;
    error = null;

    try {
        const summary = await invoke<AuthStoreSummary>("auth_store_delete", {
            profile,
            provider: target,
        });
        entries = summary.entries;
        storePath = summary.path;
        setNotice("Provider removed.");
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    } finally {
        saving = false;
    }
}

function formatEntryType(entryType: string) {
    if (entryType === "api_key") return "API key";
    return entryType;
}

$effect(() => {
    if (open) {
        void loadEntries();
    } else {
        error = null;
        clearNotice();
        resetCommandCopy();
        clearProfileNotice();
        clearProfileSetNotice();
        apiKey = "";
        newProfile = "";
    }
});

$effect(() => {
    if (!open) return;

    try {
        const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (stored && stored !== profile) {
            profile = stored;
        }
    } catch {
        // Ignore storage errors.
    }
});

onDestroy(() => {
    if (noticeTimer) {
        clearTimeout(noticeTimer);
    }
    if (commandTimer) {
        clearTimeout(commandTimer);
    }
    if (profileTimer) {
        clearTimeout(profileTimer);
    }
    if (profileSetTimer) {
        clearTimeout(profileSetTimer);
    }
});
</script>

{#if open}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 relative">
        <button
            class="absolute inset-0 bg-black/40"
            type="button"
            aria-label="Close settings"
            onclick={() => onClose?.()}
        ></button>
        <div class="relative w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-lg">
            <div class="flex items-center justify-between">
                <div>
                    <h2 class="text-lg font-semibold">Settings</h2>
                    <p class="text-sm text-muted-foreground">Manage auth providers and API keys.</p>
                </div>
                <button class="rounded-md p-2 hover:bg-accent" aria-label="Close" onclick={() => onClose?.()}>
                    <X class="h-4 w-4" />
                </button>
            </div>

            <div class="mt-6 space-y-4">
                <div class="rounded-lg border border-border bg-muted/30 p-4">
                    <div class="text-sm font-medium">API Keys</div>
                    <div class="mt-1 text-xs text-muted-foreground">Profile: {profile}</div>
                    <div class="mt-3 grid gap-2 text-xs">
                        <label class="grid gap-1">
                            <span class="text-muted-foreground">Profile</span>
                            <input
                                class="rounded-md border border-border bg-background px-3 py-2 text-sm"
                                placeholder="default"
                                bind:value={profile}
                                onblur={handleProfileChange}
                                onkeydown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleProfileChange();
                                    }
                                }}
                            />
                        </label>
                        <div class="flex flex-wrap items-center gap-2">
                            <input
                                class="rounded-md border border-border bg-background px-3 py-2 text-sm"
                                placeholder="New profile"
                                bind:value={newProfile}
                            />
                            <button
                                class="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80 disabled:opacity-60"
                                onclick={addProfile}
                                disabled={!newProfile.trim()}
                            >
                                Add profile
                            </button>
                        </div>
                        {#if profileNotice}
                            <div class="text-[11px] text-emerald-400">{profileNotice}</div>
                        {/if}
                        {#if profileError}
                            <div class="text-[11px] text-destructive">{profileError}</div>
                        {/if}
                    </div>
                    {#if storePath}
                        <div class="mt-2 text-[11px] text-muted-foreground">
                            <span class="uppercase tracking-wide">Storage</span>
                            <code class="mt-1 block rounded-md bg-muted px-2 py-1">{storePath}</code>
                        </div>
                    {/if}
                    <div class="mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                        <div class="text-[11px] uppercase tracking-wide">Dev runtime auth</div>
                        <code class="mt-2 block rounded-md bg-muted px-2 py-1">{buildAuthCommand()}</code>
                        <div class="mt-2 flex flex-wrap items-center gap-2">
                            <button
                                class="rounded-md bg-secondary px-2 py-1 text-[11px] hover:bg-secondary/80 disabled:opacity-60"
                                onclick={copyAuthCommand}
                                disabled={copyingCommand}
                            >
                                {commandCopied
                                    ? "Copied"
                                    : copyingCommand
                                        ? "Copying…"
                                        : "Copy command"}
                            </button>
                            {#if commandNotice}
                                <span class="text-[11px] text-muted-foreground">{commandNotice}</span>
                            {/if}
                        </div>
                    </div>

                    <div class="mt-4 grid gap-3">
                        <label class="grid gap-1 text-xs">
                            <span class="text-muted-foreground">Provider</span>
                            <input
                                class="rounded-md border border-border bg-background px-3 py-2 text-sm"
                                list="provider-options"
                                placeholder="anthropic"
                                bind:value={provider}
                            />
                        </label>
                        <datalist id="provider-options">
                            {#each providerOptions as option}
                                <option value={option.id}>{option.label}</option>
                            {/each}
                        </datalist>
                        <label class="grid gap-1 text-xs">
                            <span class="text-muted-foreground">API key</span>
                            <input
                                class="rounded-md border border-border bg-background px-3 py-2 text-sm"
                                type="password"
                                placeholder="sk-..."
                                bind:value={apiKey}
                            />
                        </label>
                        <div class="flex items-center gap-2">
                            <button
                                class="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                                onclick={saveApiKey}
                                disabled={saving || !provider.trim() || !apiKey.trim()}
                            >
                                {saving ? "Saving…" : "Save API key"}
                            </button>
                            {#if notice}
                                <span class="text-xs text-emerald-400">{notice}</span>
                            {/if}
                        </div>
                        {#if error}
                            <div class="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                                {error}
                            </div>
                        {/if}
                    </div>
                </div>

                <div class="rounded-lg border border-border bg-card">
                    <div class="border-b border-border px-4 py-3 text-sm font-medium">Saved providers</div>
                    <div class="px-4 py-3 text-sm text-muted-foreground">
                        {#if loading}
                            <div>Loading providers…</div>
                        {:else if entries.length === 0}
                            <div>No providers saved yet.</div>
                        {:else}
                            <div class="space-y-2">
                                {#each entries as entry}
                                    <div class="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                                        <div>
                                            <div class="text-sm font-medium text-foreground">{entry.provider}</div>
                                            <div class="text-xs text-muted-foreground">{formatEntryType(entry.entryType)}</div>
                                        </div>
                                        <button
                                            class="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-60"
                                            onclick={() => deleteProvider(entry.provider)}
                                            disabled={saving}
                                            aria-label="Remove provider"
                                        >
                                            <Trash2 class="h-4 w-4" />
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}
