<script lang="ts">
import { Trash2 } from "@lucide/svelte";

interface AuthEntry {
    provider: string;
    entryType: string;
}

interface Props {
    entries: AuthEntry[];
    loading: boolean;
    disabled: boolean;
    ondelete: (provider: string) => void;
}

let { entries, loading, disabled, ondelete }: Props = $props();

function formatEntryType(entryType: string) {
    return entryType === "api_key" ? "API key" : entryType;
}
</script>

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
                            onclick={() => ondelete(entry.provider)}
                            disabled={disabled}
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
