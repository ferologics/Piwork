<script lang="ts">
import { FolderOpen, ChevronDown, Plus } from "@lucide/svelte";
import { open } from "@tauri-apps/plugin-dialog";
import { taskStore } from "$lib/stores/taskStore";

interface Props {
    value: string | null;
    onchange: (folder: string | null) => void;
    disabled?: boolean;
}

let { value, onchange, disabled = false }: Props = $props();

let isOpen = $state(false);
let recentFolders = $state<string[]>([]);

// Subscribe to recent folders
const unsubscribe = taskStore.recentFolders.subscribe((folders) => {
    recentFolders = folders;
});

function formatFolderName(path: string): string {
    const parts = path.split("/");
    const name = parts[parts.length - 1] || parts[parts.length - 2] || path;
    const parent = parts[parts.length - 2];
    if (parent && parent !== name) {
        return `${parent}/${name}`;
    }
    return name;
}

function toggle() {
    if (disabled) return;
    isOpen = !isOpen;
}

function close() {
    isOpen = false;
}

function selectFolder(folder: string) {
    onchange(folder);
    taskStore.addRecentFolder(folder);
    close();
}

function clearFolder() {
    onchange(null);
    close();
}

async function chooseFolder() {
    close();
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: "Choose working folder",
        });
        if (selected && typeof selected === "string") {
            onchange(selected);
            taskStore.addRecentFolder(selected);
        }
    } catch (e) {
        console.error("Folder picker error:", e);
    }
}

// Close on click outside
function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".folder-selector")) {
        close();
    }
}

$effect(() => {
    if (isOpen) {
        document.addEventListener("click", handleClickOutside);
        return () => document.removeEventListener("click", handleClickOutside);
    }
});
</script>

<div class="folder-selector relative">
    <button
        type="button"
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent disabled:opacity-50"
        onclick={toggle}
        {disabled}
    >
        <FolderOpen class="h-4 w-4 text-muted-foreground" />
        <span class="max-w-40 truncate text-muted-foreground">
            {value ? formatFolderName(value) : "No folder"}
        </span>
        <ChevronDown class="h-3 w-3 text-muted-foreground" />
    </button>

    {#if isOpen}
        <div
            class="absolute bottom-full left-0 mb-1 w-72 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
            {#if recentFolders.length > 0}
                <div class="px-2 py-1 text-xs font-medium text-muted-foreground">Recent</div>
                {#each recentFolders as folder}
                    <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onclick={() => selectFolder(folder)}
                    >
                        <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div class="min-w-0 flex-1">
                            <div class="truncate font-medium">{formatFolderName(folder)}</div>
                            <div class="truncate text-xs text-muted-foreground">{folder}</div>
                        </div>
                        {#if folder === value}
                            <span class="text-primary">✓</span>
                        {/if}
                    </button>
                {/each}
                <div class="my-1 border-t border-border"></div>
            {/if}

            <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onclick={chooseFolder}
            >
                <Plus class="h-4 w-4 text-muted-foreground" />
                <span>Choose a different folder</span>
            </button>

            {#if value}
                <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                    onclick={clearFolder}
                >
                    <span class="h-4 w-4"></span>
                    <span>No folder (chat only)</span>
                </button>
            {/if}
        </div>
    {/if}
</div>
