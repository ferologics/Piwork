<script lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onDestroy, onMount } from "svelte";
import { Activity, FolderOpen, Link, ChevronDown, RefreshCw, FileText, Image, ExternalLink } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
import { previewStore } from "$lib/stores/previewStore";
import { artifactRefreshStore } from "$lib/stores/artifactRefreshStore";
import type { TaskMetadata } from "$lib/types/task";

type CardId = "progress" | "workingFolder" | "scratchpad" | "context";

interface ArtifactFileEntry {
    source: "outputs" | "uploads";
    path: string;
    size: number;
    modifiedAt: number;
    readOnly: boolean;
}

interface ArtifactListResponse {
    files: ArtifactFileEntry[];
    truncated: boolean;
}

interface WorkingFileEntry {
    path: string;
    size: number;
    modifiedAt: number;
}

interface PreviewListResponse {
    root: string;
    files: WorkingFileEntry[];
    truncated: boolean;
}

let expanded = $state<Record<CardId, boolean>>({
    progress: true,
    workingFolder: true,
    scratchpad: true,
    context: false,
});

let activeTask: TaskMetadata | null = $state(null);
let unsubscribeActive: (() => void) | null = null;
let unsubscribeArtifactRefresh: (() => void) | null = null;

let files = $state<ArtifactFileEntry[]>([]);
let filesTruncated = $state(false);
let filesLoading = $state(false);
let scratchpadError = $state<string | null>(null);

let workingFiles = $state<WorkingFileEntry[]>([]);
let workingFilesTruncated = $state(false);
let workingFilesLoading = $state(false);
let workingFilesError = $state<string | null>(null);

let workingFolderError = $state<string | null>(null);
let openingWorkingFolder = $state(false);

let lastTaskContextKey = "";
let filesRequestId = 0;
let workingFilesRequestId = 0;
let scratchpadRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let workingFolderRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const cards: { id: CardId; label: string; icon: typeof Activity }[] = [
    { id: "progress", label: "Progress", icon: Activity },
    { id: "workingFolder", label: "Working folder", icon: FolderOpen },
    { id: "scratchpad", label: "Scratchpad", icon: FolderOpen },
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

function folderBasename(path: string): string {
    const trimmed = path.replace(/\/+$/, "");
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || path;
}

function cardTitle(card: CardId): string {
    if (card !== "workingFolder") {
        return cards.find((entry) => entry.id === card)?.label ?? "";
    }

    if (activeTask?.workingFolder) {
        return folderBasename(activeTask.workingFolder);
    }

    return "Working folder";
}

function clearFilesState() {
    files = [];
    filesTruncated = false;
    scratchpadError = null;
    filesLoading = false;
}

function clearWorkingFilesState() {
    workingFiles = [];
    workingFilesTruncated = false;
    workingFilesError = null;
    workingFilesLoading = false;
}

async function loadFiles(): Promise<void> {
    if (!activeTask?.id) {
        clearFilesState();
        return;
    }

    const requestId = ++filesRequestId;
    filesLoading = true;
    scratchpadError = null;

    try {
        const result = await invoke<ArtifactListResponse>("task_artifact_list", {
            taskId: activeTask.id,
        });

        if (requestId !== filesRequestId) {
            return;
        }

        files = result.files;
        filesTruncated = result.truncated;
    } catch (error) {
        if (requestId !== filesRequestId) {
            return;
        }

        scratchpadError = error instanceof Error ? error.message : String(error);
        files = [];
        filesTruncated = false;
    } finally {
        if (requestId === filesRequestId) {
            filesLoading = false;
        }
    }
}

async function loadWorkingFiles(): Promise<void> {
    if (!activeTask?.id || !activeTask.workingFolder) {
        clearWorkingFilesState();
        return;
    }

    const requestId = ++workingFilesRequestId;
    workingFilesLoading = true;
    workingFilesError = null;

    try {
        const result = await invoke<PreviewListResponse>("task_preview_list", {
            taskId: activeTask.id,
        });

        if (requestId !== workingFilesRequestId) {
            return;
        }

        workingFiles = result.files;
        workingFilesTruncated = result.truncated;
    } catch (error) {
        if (requestId !== workingFilesRequestId) {
            return;
        }

        workingFilesError = error instanceof Error ? error.message : String(error);
        workingFiles = [];
        workingFilesTruncated = false;
    } finally {
        if (requestId === workingFilesRequestId) {
            workingFilesLoading = false;
        }
    }
}

function openPreview(file: ArtifactFileEntry) {
    if (!activeTask?.id) {
        return;
    }

    previewStore.open(activeTask.id, file.path, {
        source: "artifact",
        artifactSource: file.source,
    });
}

function openWorkingPreview(file: WorkingFileEntry) {
    if (!activeTask?.id) {
        return;
    }

    previewStore.open(activeTask.id, file.path, { source: "preview" });
}

async function openWorkingFolderInFinder() {
    const folder = activeTask?.workingFolder;
    if (!folder || openingWorkingFolder) {
        return;
    }

    openingWorkingFolder = true;
    workingFolderError = null;

    try {
        await invoke("open_path_in_finder", { path: folder });
    } catch (error) {
        workingFolderError = error instanceof Error ? error.message : String(error);
    } finally {
        openingWorkingFolder = false;
    }
}

function scheduleLoadFiles(delayMs = 200) {
    if (scratchpadRefreshTimer) {
        clearTimeout(scratchpadRefreshTimer);
    }

    scratchpadRefreshTimer = setTimeout(() => {
        scratchpadRefreshTimer = null;
        void loadFiles();
    }, delayMs);
}

function scheduleLoadWorkingFiles(delayMs = 200) {
    if (workingFolderRefreshTimer) {
        clearTimeout(workingFolderRefreshTimer);
    }

    workingFolderRefreshTimer = setTimeout(() => {
        workingFolderRefreshTimer = null;
        void loadWorkingFiles();
    }, delayMs);
}

onMount(() => {
    unsubscribeActive = taskStore.activeTask.subscribe((value) => {
        activeTask = value;
        workingFolderError = null;

        const nextKey = `${value?.id ?? ""}|${value?.workingFolder ?? ""}`;
        if (nextKey === lastTaskContextKey) {
            return;
        }

        lastTaskContextKey = nextKey;
        void loadFiles();
        void loadWorkingFiles();
    });

    unsubscribeArtifactRefresh = artifactRefreshStore.subscribe((event) => {
        if (!activeTask?.id) {
            return;
        }

        if (!event.taskId || event.taskId !== activeTask.id) {
            return;
        }

        scheduleLoadFiles(150);
        scheduleLoadWorkingFiles(150);
    });
});

onDestroy(() => {
    unsubscribeActive?.();
    unsubscribeArtifactRefresh?.();

    if (scratchpadRefreshTimer) {
        clearTimeout(scratchpadRefreshTimer);
        scratchpadRefreshTimer = null;
    }

    if (workingFolderRefreshTimer) {
        clearTimeout(workingFolderRefreshTimer);
        workingFolderRefreshTimer = null;
    }
});
</script>

<aside class="flex h-full w-72 flex-col overflow-y-auto border-l border-border bg-background p-3">
    <div class="space-y-2">
        {#each cards as card}
            <div class="rounded-lg border border-border bg-card">
                <div class="flex w-full items-center gap-1 p-3 text-sm font-medium">
                    <button
                        class="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onclick={() => toggle(card.id)}
                    >
                        <card.icon class="h-4 w-4 text-muted-foreground" />
                        <span class="truncate">{cardTitle(card.id)}</span>
                    </button>

                    {#if card.id === "workingFolder" && activeTask?.workingFolder}
                        <button
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:opacity-60"
                            onclick={openWorkingFolderInFinder}
                            disabled={openingWorkingFolder}
                            title="Open in Finder"
                            aria-label="Open in Finder"
                        >
                            <ExternalLink class="h-3.5 w-3.5" />
                        </button>
                    {/if}

                    <button
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                        onclick={() => toggle(card.id)}
                        aria-label={expanded[card.id] ? "Collapse card" : "Expand card"}
                    >
                        <ChevronDown class="h-4 w-4 transition-transform {expanded[card.id] ? 'rotate-180' : ''}" />
                    </button>
                </div>

                {#if expanded[card.id]}
                    <div class="border-t border-border px-3 py-3 text-sm text-muted-foreground">
                        {#if card.id === "progress"}
                            {#if activeTask}
                                <p class="font-medium text-foreground">{activeTask.title || "Untitled task"}</p>
                                <p class="text-xs text-muted-foreground">Status: {activeTask.status}</p>
                            {:else}
                                <p>No active task</p>
                            {/if}
                        {:else if card.id === "workingFolder"}
                            {#if !activeTask}
                                <p>No active task</p>
                            {:else}
                                <div class="space-y-2">
                                    {#if activeTask.workingFolder}
                                        <div class="rounded-md bg-muted px-2 py-1 text-xs text-foreground break-all">
                                            {activeTask.workingFolder}
                                        </div>

                                        {#if workingFolderError}
                                            <div class="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                                                {workingFolderError}
                                            </div>
                                        {/if}

                                        {#if workingFilesError}
                                            <div class="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                                                {workingFilesError}
                                            </div>
                                        {/if}

                                        {#if workingFilesTruncated}
                                            <div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                                                Working-folder file list truncated for responsiveness.
                                            </div>
                                        {/if}

                                        <div class="space-y-1">
                                            <div class="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                                                <span>Files {workingFiles.length > 0 ? `(${workingFiles.length})` : ""}</span>
                                                {#if workingFilesLoading}
                                                    <span class="inline-flex items-center gap-1 normal-case tracking-normal text-[10px] text-muted-foreground">
                                                        <RefreshCw class="h-3 w-3 animate-spin" />
                                                        Updating…
                                                    </span>
                                                {/if}
                                            </div>

                                            <div class="max-h-48 overflow-y-auto rounded-md border border-border">
                                                {#if workingFilesLoading && workingFiles.length === 0}
                                                    <div class="px-2 py-2 text-xs text-muted-foreground">Loading files…</div>
                                                {:else if workingFiles.length === 0}
                                                    <div class="px-2 py-2 text-xs text-muted-foreground">No files in working folder yet.</div>
                                                {:else}
                                                    {#each workingFiles as file}
                                                        <button
                                                            class="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-xs hover:bg-accent last:border-b-0"
                                                            onclick={() => openWorkingPreview(file)}
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
                                    {:else}
                                        <div class="rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground">
                                            No working folder set for this task.
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {:else if card.id === "scratchpad"}
                            {#if !activeTask}
                                <p>No active task</p>
                            {:else}
                                <div class="space-y-3">
                                    <div class="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                                        <span>Files {files.length > 0 ? `(${files.length})` : ""}</span>
                                        {#if filesLoading}
                                            <span class="inline-flex items-center gap-1 normal-case tracking-normal text-[10px] text-muted-foreground">
                                                <RefreshCw class="h-3 w-3 animate-spin" />
                                                Updating…
                                            </span>
                                        {/if}
                                    </div>

                                    {#if scratchpadError}
                                        <div class="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                                            {scratchpadError}
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
                                            <div class="px-2 py-2 text-xs text-muted-foreground">No scratchpad files yet.</div>
                                        {:else}
                                            {#each files as file}
                                                <button
                                                    class="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-xs hover:bg-accent last:border-b-0"
                                                    onclick={() => openPreview(file)}
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
