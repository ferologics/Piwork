<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Settings, PanelLeft, PanelRight } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
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
let unsubscribeActive: (() => void) | null = null;

onMount(() => {
    unsubscribeActive = taskStore.activeTask.subscribe((value) => {
        activeTask = value;
    });
});

onDestroy(() => {
    unsubscribeActive?.();
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
