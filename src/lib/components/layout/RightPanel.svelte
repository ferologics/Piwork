<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Activity, FolderOpen, Link, ChevronDown } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
import type { TaskMetadata } from "$lib/types/task";

type CardId = "progress" | "folder" | "context";

let expanded = $state<Record<CardId, boolean>>({
    progress: true,
    folder: true,
    context: false,
});

let activeTask: TaskMetadata | null = $state(null);
let unsubscribeActive: (() => void) | null = null;

function toggle(id: CardId) {
    expanded[id] = !expanded[id];
}

const cards: { id: CardId; label: string; icon: typeof Activity }[] = [
    { id: "progress", label: "Progress", icon: Activity },
    { id: "folder", label: "Working Folder", icon: FolderOpen },
    { id: "context", label: "Context", icon: Link },
];

onMount(() => {
    unsubscribeActive = taskStore.activeTask.subscribe((value) => {
        activeTask = value;
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
                        {:else if card.id === "folder"}
                            <button class="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2 text-xs hover:bg-accent">
                                <FolderOpen class="h-3.5 w-3.5" />
                                Select folder
                            </button>
                        {:else if card.id === "context"}
                            <p>No connectors enabled</p>
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}
    </div>
</aside>
