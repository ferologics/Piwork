<script lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onDestroy, onMount } from "svelte";
import { Activity, FolderOpen, Link, ChevronDown, RefreshCw, FileText, Image } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
import { previewStore } from "$lib/stores/previewStore";
import type { TaskMetadata } from "$lib/types/task";

type CardId = "progress" | "downloads" | "context";

interface PreviewFileEntry {
    path: string;
    size: number;
    modifiedAt: number;
}

interface PreviewListResponse {
    root: string;
    files: PreviewFileEntry[];
    truncated: boolean;
}

let expanded = $state<Record<CardId, boolean>>({
    progress: true,
    downloads: true,
    context: false,
});

let activeTask: TaskMetadata | null = $state(null);
let unsubscribeActive: (() => void) | null = null;

let filesRoot = $state<string | null>(null);
let files = $state<PreviewFileEntry[]>([]);
let filesTruncated = $state(false);
let filesLoading = $state(false);
let filesError = $state<string | null>(null);
let lastFilesKey = "";
let filesRequestId = 0;

const cards: { id: CardId; label: string; icon: typeof Activity }[] = [
    { id: "progress", label: "Progress", icon: Activity },
    { id: "downloads", label: "Downloads", icon: FolderOpen },
    { id: "context", label: "Context", icon: Link },
];

function toggle(id: CardId) {
    expanded[id] = !expanded[id];
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearFilesState() {
    filesRoot = null;
    files = [];
    filesTruncated = false;
    filesError = null;
    filesLoading = false;
}

async function loadFiles(): Promise<void> {
    if (!activeTask?.id || !activeTask.workingFolder) {
        clearFilesState();
        return;
    }

    const requestId = ++filesRequestId;
    filesLoading = true;
    filesError = null;

    try {
        const result = await invoke<PreviewListResponse>("task_preview_list", {
            taskId: activeTask.id,
        });

        if (requestId !== filesRequestId) {
            return;
        }

        filesRoot = result.root;
        files = result.files;
        filesTruncated = result.truncated;
    } catch (error) {
        if (requestId !== filesRequestId) {
            return;
        }

        filesError = error instanceof Error ? error.message : String(error);
        files = [];
        filesRoot = null;
        filesTruncated = false;
    } finally {
        if (requestId === filesRequestId) {
            filesLoading = false;
        }
    }
}

function openPreview(path: string) {
    if (!activeTask?.id) {
        return;
    }

    previewStore.open(activeTask.id, path);
}

onMount(() => {
    unsubscribeActive = taskStore.activeTask.subscribe((value) => {
        activeTask = value;

        const nextKey = `${value?.id ?? ""}:${value?.workingFolder ?? ""}`;
        if (nextKey === lastFilesKey) {
            return;
        }

        lastFilesKey = nextKey;
        void loadFiles();
    });
});

onDestroy(() => {
    unsubscribeActive?.();
});
</script>

<aside class="flex h-full w-72 flex-col overflow-y-auto border-l border-border bg-background p-3">
    <div class="space-y-2">
        {#each cards as card}
            <div class="rounded-lg border border-border bg-card">
                <button
                    class="flex w-full items-center gap-2 p-3 text-left text-sm font-medium"
                    onclick={() => toggle(card.id)}
                >
                    <card.icon class="h-4 w-4 text-muted-foreground" />
                    <span class="flex-1">{card.label}</span>
                    <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform {expanded[card.id] ? 'rotate-180' : ''}" />
                </button>

                {#if expanded[card.id]}
                    <div class="border-t border-border px-3 py-3 text-sm text-muted-foreground">
                        {#if card.id === "progress"}
                            {#if activeTask}
                                <p class="font-medium text-foreground">{activeTask.title || "Untitled task"}</p>
                                <p class="text-xs text-muted-foreground">Status: {activeTask.status}</p>
                            {:else}
                                <p>No active task</p>
                            {/if}
                        {:else if card.id === "downloads"}
                            {#if !activeTask}
                                <p>No active task</p>
                            {:else if !activeTask.workingFolder}
                                <p>No working folder selected.</p>
                            {:else}
                                <div class="space-y-3">
                                    <div class="space-y-1">
                                        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Task Folder</div>
                                        <div class="rounded-md bg-muted px-2 py-1 text-xs text-foreground break-all">
                                            {activeTask.workingFolder}
                                        </div>
                                        {#if filesRoot}
                                            <div class="text-[10px] text-muted-foreground break-all">root: {filesRoot}</div>
                                        {/if}
                                    </div>

                                    <div class="flex items-center justify-between">
                                        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">
                                            Files {files.length > 0 ? `(${files.length})` : ""}
                                        </div>
                                        <button
                                            class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-60"
                                            onclick={loadFiles}
                                            disabled={filesLoading}
                                        >
                                            <RefreshCw class="h-3 w-3 {filesLoading ? 'animate-spin' : ''}" />
                                            Refresh
                                        </button>
                                    </div>

                                    {#if filesError}
                                        <div class="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                                            {filesError}
                                        </div>
                                    {/if}

                                    {#if filesTruncated}
                                        <div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                                            File list truncated for responsiveness.
                                        </div>
                                    {/if}

                                    <div class="max-h-56 overflow-y-auto rounded-md border border-border">
                                        {#if filesLoading && files.length === 0}
                                            <div class="px-2 py-2 text-xs text-muted-foreground">Loading files…</div>
                                        {:else if files.length === 0}
                                            <div class="px-2 py-2 text-xs text-muted-foreground">No files to preview.</div>
                                        {:else}
                                            {#each files as file}
                                                <button
                                                    class="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-xs hover:bg-accent last:border-b-0"
                                                    onclick={() => openPreview(file.path)}
                                                >
                                                    {#if file.path.endsWith('.png') || file.path.endsWith('.jpg') || file.path.endsWith('.jpeg') || file.path.endsWith('.gif') || file.path.endsWith('.webp') || file.path.endsWith('.svg')}
                                                        <Image class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    {:else}
                                                        <FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                    {/if}
                                                    <span class="min-w-0 flex-1 truncate">{file.path}</span>
                                                    <span class="shrink-0 text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>
                                                </button>
                                            {/each}
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        {:else if card.id === "context"}
                            <div class="space-y-2 text-xs">
                                <div class="rounded-md border border-border bg-muted/50 px-2 py-2">
                                    <p class="font-medium text-foreground">Scoped local mode (MVP)</p>
                                    <ul class="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                                        <li>Access is scoped to the active task folder under your workspace root.</li>
                                        <li>Traversal and symlink escape attempts are blocked by policy.</li>
                                        <li>This is not yet a hardened sandbox for hostile code.</li>
                                    </ul>
                                </div>
                                <p>No connectors enabled.</p>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}
    </div>
</aside>
