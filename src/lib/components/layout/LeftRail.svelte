<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Plus, MessageSquare, MoreHorizontal, Pencil, Archive } from "@lucide/svelte";
import { taskStore } from "$lib/stores/taskStore";
import type { TaskMetadata } from "$lib/types/task";

let tasks = $state<TaskMetadata[]>([]);
let visibleTasks = $state<TaskMetadata[]>([]);
let activeTaskId = $state<string | null>(null);
let unsubscribe: (() => void) | null = null;
let unsubscribeActive: (() => void) | null = null;
let creating = $state(false);
let menuTaskId = $state<string | null>(null);
let editingTaskId = $state<string | null>(null);
let editingTitle = $state("");
let savingTask = $state(false);

const statusColors: Record<string, string> = {
    queued: "bg-muted-foreground",
    running: "bg-blue-500",
    blocked: "bg-yellow-500",
    done: "bg-green-500",
    failed: "bg-red-500",
    archived: "bg-muted-foreground",
};

onMount(() => {
    unsubscribe = taskStore.subscribe((value) => {
        tasks = value;
        visibleTasks = value.filter((task) => task.status !== "archived");
    });

    unsubscribeActive = taskStore.activeTaskId.subscribe((value) => {
        activeTaskId = value;
    });

    const handleClick = () => {
        menuTaskId = null;
    };

    window.addEventListener("click", handleClick);

    return () => {
        window.removeEventListener("click", handleClick);
    };
});

onDestroy(() => {
    unsubscribe?.();
    unsubscribeActive?.();
});

async function handleNewTask() {
    if (creating) return;
    creating = true;

    try {
        const task = taskStore.create("New Task");
        await taskStore.upsert(task);
        taskStore.setActive(task.id);
    } finally {
        creating = false;
    }
}

function openMenu(taskId: string, event: MouseEvent) {
    event.stopPropagation();
    menuTaskId = menuTaskId === taskId ? null : taskId;
}

function startRename(task: TaskMetadata, event: MouseEvent) {
    event.stopPropagation();
    editingTaskId = task.id;
    editingTitle = task.title || "";
    menuTaskId = null;
}

async function commitRename(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
        editingTaskId = null;
        return;
    }

    const title = editingTitle.trim();
    if (!title || title === task.title) {
        editingTaskId = null;
        return;
    }

    if (savingTask) return;
    savingTask = true;

    try {
        await taskStore.upsert({
            ...task,
            title,
            updatedAt: new Date().toISOString(),
        });
    } finally {
        savingTask = false;
        editingTaskId = null;
    }
}

function cancelRename() {
    editingTaskId = null;
    editingTitle = "";
}

async function archiveTask(task: TaskMetadata, event: MouseEvent) {
    event.stopPropagation();
    if (savingTask || task.status === "archived") return;
    savingTask = true;
    menuTaskId = null;

    try {
        await taskStore.upsert({
            ...task,
            status: "archived",
            updatedAt: new Date().toISOString(),
        });
    } finally {
        savingTask = false;
    }
}
</script>

<aside class="flex h-full w-56 flex-col border-r border-border bg-sidebar overflow-hidden">
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
            {#if visibleTasks.length === 0}
                <li class="px-3 py-2 text-xs text-muted-foreground">No tasks yet</li>
            {:else}
                {#each visibleTasks as task}
                    <li class="relative">
                        <div
                            class="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent"
                            class:bg-sidebar-accent={activeTaskId === task.id}
                        >
                            <button
                                class="flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm overflow-hidden"
                                type="button"
                                onclick={() => taskStore.setActive(task.id)}
                                aria-current={activeTaskId === task.id ? "true" : "false"}
                            >
                                <span
                                    class="h-2 w-2 shrink-0 rounded-full {statusColors[task.status] ?? "bg-muted-foreground"}"
                                ></span>
                                <MessageSquare class="h-4 w-4 shrink-0 text-muted-foreground" />
                                {#if editingTaskId === task.id}
                                    <input
                                        class="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                                        bind:value={editingTitle}
                                        onkeydown={(event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                void commitRename(task.id);
                                            }
                                            if (event.key === "Escape") {
                                                event.preventDefault();
                                                cancelRename();
                                            }
                                        }}
                                        onblur={() => void commitRename(task.id)}
                                    />
                                {:else}
                                    <span class="truncate text-left">{task.title || "Untitled task"}</span>
                                {/if}
                            </button>
                            <button
                                class="rounded-md p-2 text-muted-foreground hover:bg-accent"
                                onclick={(event) => openMenu(task.id, event)}
                                aria-label="Task menu"
                            >
                                <MoreHorizontal class="h-4 w-4" />
                            </button>
                        </div>
                        {#if menuTaskId === task.id}
                            <div
                                class="absolute right-2 top-full z-10 mt-1 w-40 rounded-md border border-border bg-popover p-1 text-xs shadow-lg"
                                role="menu"
                            >
                                <button
                                    class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                                    onclick={(event) => startRename(task, event)}
                                >
                                    <Pencil class="h-3.5 w-3.5" />
                                    Rename
                                </button>
                                <button
                                    class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-destructive hover:bg-accent"
                                    onclick={(event) => archiveTask(task, event)}
                                >
                                    <Archive class="h-3.5 w-3.5" />
                                    Archive
                                </button>
                            </div>
                        {/if}
                    </li>
                {/each}
            {/if}
        </ul>
    </nav>
</aside>
