<script lang="ts">
import { openPath } from "@tauri-apps/plugin-opener";

const { runtimeDir, manifestPath, error = null, onRecheck = null } = $props<{
    runtimeDir: string;
    manifestPath: string;
    error?: string | null;
    onRecheck?: (() => void) | null;
}>();

let opening = $state(false);

async function openRuntimeDir() {
    if (!runtimeDir) return;
    opening = true;
    try {
        await openPath(runtimeDir);
    } finally {
        opening = false;
    }
}
</script>

<div class="flex h-screen items-center justify-center bg-background p-6">
    <div class="w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-sm">
        <div class="space-y-3">
            <h1 class="text-xl font-semibold">Runtime setup required</h1>
            <p class="text-sm text-muted-foreground">
                Piwork needs a local runtime pack before tasks can run. Drop the runtime pack into the
                folder below, then click “Recheck”.
            </p>
        </div>

        <div class="mt-4 space-y-2 text-sm">
            <div>
                <div class="text-xs uppercase tracking-wide text-muted-foreground">Runtime folder</div>
                <code class="mt-1 block rounded-md bg-muted px-3 py-2 text-xs">{runtimeDir}</code>
            </div>
            <div>
                <div class="text-xs uppercase tracking-wide text-muted-foreground">Manifest path</div>
                <code class="mt-1 block rounded-md bg-muted px-3 py-2 text-xs">{manifestPath}</code>
            </div>
            {#if error}
                <div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                </div>
            {/if}
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
            <button
                class="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-secondary/80 disabled:opacity-60"
                onclick={openRuntimeDir}
                disabled={!runtimeDir || opening}
            >
                {opening ? "Opening…" : "Open runtime folder"}
            </button>
            <button
                class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                onclick={() => onRecheck?.()}
            >
                Recheck
            </button>
        </div>
    </div>
</div>
