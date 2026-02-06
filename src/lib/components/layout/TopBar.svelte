<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { dev } from "$app/environment";
import { Settings, PanelLeft, PanelRight } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
import { runtimeDebugStore, type RuntimeDebugState } from "$lib/stores/runtimeDebugStore";
import type { TaskMetadata } from "$lib/types/task";

let {
    showLeftRail = $bindable(true),
    showRightPanel = $bindable(false),
    onOpenSettings = null,
}: {
    showLeftRail?: boolean;
    showRightPanel?: boolean;
    onOpenSettings?: (() => void) | null;
} = $props();

let activeTask: TaskMetadata | null = $state(null);
let runtimeDebug: RuntimeDebugState = $state({
    activeTaskId: null,
    sessionId: null,
    sessionName: null,
    currentCwd: null,
    workingFolderRelative: null,
    updatedAt: 0,
});

let unsubscribeActive: (() => void) | null = null;
let unsubscribeRuntimeDebug: (() => void) | null = null;

function shortId(value: string | null): string | null {
    return value ? value.slice(0, 8) : null;
}

function shouldShowSessionChip(): boolean {
    if (!activeTask) {
        return false;
    }

    if (runtimeDebug.sessionId && runtimeDebug.sessionId !== activeTask.id) {
        return true;
    }

    if (runtimeDebug.sessionName && runtimeDebug.sessionName !== activeTask.id) {
        return true;
    }

    return false;
}

function sessionChipValue(): string | null {
    if (runtimeDebug.sessionId) {
        return shortId(runtimeDebug.sessionId);
    }

    return runtimeDebug.sessionName;
}

onMount(() => {
    unsubscribeActive = taskStore.activeTask.subscribe((value) => {
        activeTask = value;
    });

    unsubscribeRuntimeDebug = runtimeDebugStore.subscribe((value) => {
        runtimeDebug = value;
    });
});

onDestroy(() => {
    unsubscribeActive?.();
    unsubscribeRuntimeDebug?.();
});
</script>

<header class="flex h-12 items-center justify-between border-b border-border bg-background px-4">
    <div class="flex items-center gap-2">
        <button
            class="rounded-md p-2 hover:bg-accent {showLeftRail ? 'bg-accent' : ''}"
            aria-label="Toggle tasks"
            onclick={() => (showLeftRail = !showLeftRail)}
        >
            <PanelLeft class="h-4 w-4" />
        </button>
        <span class="text-lg font-semibold">Piwork</span>
        <span class="text-sm text-muted-foreground">
            {activeTask ? activeTask.title || "Untitled task" : "No active task"}
        </span>

        {#if dev && activeTask}
            <div class="hidden items-center gap-1.5 md:flex">
                <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={activeTask.id}>
                    task {shortId(activeTask.id)}
                </span>

                {#if runtimeDebug.activeTaskId && runtimeDebug.activeTaskId !== activeTask.id}
                    <span
                        class="rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300"
                        title={`runtime active task: ${runtimeDebug.activeTaskId}`}
                    >
                        runtime mismatch
                    </span>
                {/if}

                {#if shouldShowSessionChip()}
                    <span
                        class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={runtimeDebug.sessionName ?? runtimeDebug.sessionId ?? ""}
                    >
                        session {sessionChipValue()}
                    </span>
                {/if}

                {#if runtimeDebug.currentCwd}
                    <span
                        class="max-w-44 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={runtimeDebug.currentCwd}
                    >
                        cwd {runtimeDebug.currentCwd}
                    </span>
                {/if}
            </div>
        {/if}
    </div>

    <div class="flex items-center gap-2">
        <span class="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-600">Network</span>
        <button
            class="rounded-md p-2 hover:bg-accent {showRightPanel ? 'bg-accent' : ''}"
            aria-label="Toggle panel"
            onclick={() => (showRightPanel = !showRightPanel)}
        >
            <PanelRight class="h-4 w-4" />
        </button>
        <button class="rounded-md p-2 hover:bg-accent" aria-label="Settings" onclick={() => onOpenSettings?.()}>
            <Settings class="h-4 w-4" />
        </button>
    </div>
</header>
