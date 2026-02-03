<script lang="ts">
import { Plus, MessageSquare } from "@lucide/svelte";

// Placeholder tasks for skeleton
const tasks = [
    { id: "1", title: "Organize Downloads", status: "done" as const },
    { id: "2", title: "Summarize meeting notes", status: "running" as const },
    { id: "3", title: "Convert images to PDF", status: "queued" as const },
];

const statusColors = {
    queued: "bg-muted-foreground",
    running: "bg-blue-500",
    blocked: "bg-yellow-500",
    done: "bg-green-500",
    failed: "bg-red-500",
};
</script>

<aside class="flex h-full w-56 flex-col border-r border-border bg-sidebar">
    <div class="p-3">
        <button class="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus class="h-4 w-4" />
            New Task
        </button>
    </div>

    <nav class="flex-1 overflow-y-auto px-2">
        <ul class="space-y-1">
            {#each tasks as task}
                <li>
                    <button class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent">
                        <span class="h-2 w-2 rounded-full {statusColors[task.status]}"></span>
                        <MessageSquare class="h-4 w-4 text-muted-foreground" />
                        <span class="flex-1 truncate text-left">{task.title}</span>
                    </button>
                </li>
            {/each}
        </ul>
    </nav>
</aside>
