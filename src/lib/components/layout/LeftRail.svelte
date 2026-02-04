<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Plus, MessageSquare } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
import type { TaskMetadata } from "$lib/types/task";

let tasks = $state<TaskMetadata[]>([]);
let unsubscribe: (() => void) | null = null;
let creating = $state(false);

const statusColors: Record<string, string> = {
    queued: "bg-muted-foreground",
    running: "bg-blue-500",
    blocked: "bg-yellow-500",
    done: "bg-green-500",
    failed: "bg-red-500",
};

onMount(() => {
    unsubscribe = taskStore.subscribe((value) => {
        tasks = value;
    });
});

onDestroy(() => {
    unsubscribe?.();
});

async function handleNewTask() {
    if (creating) return;
    creating = true;

    try {
        const task = taskStore.create("New Task");
        await taskStore.upsert(task);
    } finally {
        creating = false;
    }
}
</script>

<aside class="flex h-full w-56 flex-col border-r border-border bg-sidebar">
    <div class="p-3">
        <button
            class="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            onclick={handleNewTask}
            disabled={creating}
        >
            <Plus class="h-4 w-4" />
            {creating ? "Creating…" : "New Task"}
        </button>
    </div>

    <nav class="flex-1 overflow-y-auto px-2">
        <ul class="space-y-1">
            {#if tasks.length === 0}
                <li class="px-3 py-2 text-xs text-muted-foreground">No tasks yet</li>
            {:else}
                {#each tasks as task}
                    <li>
                        <button class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent">
                            <span
                                class="h-2 w-2 rounded-full {statusColors[task.status] ?? "bg-muted-foreground"}"
                            ></span>
                            <MessageSquare class="h-4 w-4 text-muted-foreground" />
                            <span class="flex-1 truncate text-left">{task.title || "Untitled task"}</span>
                        </button>
                    </li>
                {/each}
            {/if}
        </ul>
    </nav>
</aside>
