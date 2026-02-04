<script lang="ts">
import { openPath } from "@tauri-apps/plugin-opener";

const {
    runtimeDir,
    manifestPath,
    qemuAvailable = null,
    qemuPath = null,
    accelAvailable = null,
    error = null,
    onRecheck = null,
} = $props<{
    runtimeDir: string;
    manifestPath: string;
    qemuAvailable?: boolean | null;
    qemuPath?: string | null;
    accelAvailable?: boolean | null;
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
            <div>
                <div class="text-xs uppercase tracking-wide text-muted-foreground">QEMU</div>
                {#if qemuAvailable}
                    <div class="mt-1 text-xs text-emerald-400">Installed</div>
                    {#if qemuPath}
                        <code class="mt-1 block rounded-md bg-muted px-3 py-2 text-xs">{qemuPath}</code>
                    {/if}
                {:else}
                    <div class="mt-1 text-xs text-destructive">Not found</div>
                    <div class="mt-1 text-xs text-muted-foreground">Install with: brew install qemu</div>
                {/if}
            </div>
            <div>
                <div class="text-xs uppercase tracking-wide text-muted-foreground">Hardware acceleration</div>
                {#if accelAvailable === null}
                    <div class="mt-1 text-xs text-muted-foreground">Unknown</div>
                {:else if accelAvailable}
                    <div class="mt-1 text-xs text-emerald-400">Available</div>
                {:else}
                    <div class="mt-1 text-xs text-destructive">Unavailable</div>
                {/if}
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
