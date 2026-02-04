<script lang="ts">
interface Props {
    onselect: (prompt: string) => void;
}

let { onselect }: Props = $props();

const tiles = [
    { emoji: "📄", label: "Create a file", prompt: "Create a new file for me" },
    { emoji: "📊", label: "Crunch data", prompt: "Help me analyze and crunch some data" },
    { emoji: "🖼️", label: "Make a prototype", prompt: "Help me make a prototype" },
    { emoji: "📁", label: "Organize files", prompt: "Help me organize my files" },
    { emoji: "📅", label: "Prep for a meeting", prompt: "Help me prep for a meeting" },
    { emoji: "✉️", label: "Draft a message", prompt: "Help me draft a message" },
];
</script>

<div class="flex flex-col items-center justify-center py-12 px-4">
    <div class="text-4xl mb-4">✨</div>
    <h2 class="text-2xl font-semibold mb-8">Let's knock something off your list</h2>
    
    <div class="grid grid-cols-3 gap-3 w-full max-w-2xl">
        {#each tiles as tile}
            <button
                class="flex items-center gap-3 p-4 rounded-lg bg-muted/50 hover:bg-muted text-left transition-colors"
                onclick={() => onselect(tile.prompt)}
            >
                <span class="text-xl">{tile.emoji}</span>
                <span class="text-sm font-medium">{tile.label}</span>
            </button>
        {/each}
    </div>
</div>
