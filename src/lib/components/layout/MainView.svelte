<script lang="ts">
import { Send, Paperclip, FolderOpen, ChevronDown } from "@lucide/svelte";

let prompt = $state("");
let textareaEl: HTMLTextAreaElement | undefined = $state();
let selectedModel = $state("claude-opus-4-5");

const models = [
    { id: "claude-opus-4-5", label: "Opus 4.5" },
    { id: "gpt-5.2", label: "GPT 5.2" },
    { id: "gemini-3-pro", label: "Gemini 3" },
    { id: "kimi-2.5", label: "Kimi 2.5" },
];

const MAX_HEIGHT = 200;

function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, MAX_HEIGHT) + "px";
    textareaEl.style.overflowY = textareaEl.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}
</script>

<main class="flex flex-1 flex-col bg-background">
    <!-- Chat transcript area -->
    <div class="flex-1 overflow-y-auto p-4 mr-2">
        <div class="mx-auto max-w-3xl space-y-4">
            <!-- Empty state -->
            <div class="flex h-full flex-col items-center justify-center py-20 text-center">
                <FolderOpen class="mb-4 h-12 w-12 text-muted-foreground" />
                <h2 class="mb-2 text-lg font-medium">Pick a folder to start</h2>
                <p class="mb-6 text-sm text-muted-foreground">Select a folder to work in, then describe what you'd like to do.</p>

                <div class="grid gap-2">
                    <button class="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/80">Organize Downloads</button>
                    <button class="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/80">Receipts → Spreadsheet</button>
                    <button class="rounded-md bg-secondary px-4 py-2 text-sm hover:bg-secondary/80">Notes → Summary Report</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Composer -->
    <div class="border-t border-border p-4">
        <div class="mx-auto max-w-3xl">
            <div class="flex flex-col gap-2 rounded-lg border border-input bg-background p-2">
                <textarea
                    bind:this={textareaEl}
                    bind:value={prompt}
                    oninput={autoGrow}
                    placeholder="What would you like to do?"
                    rows="1"
                    class="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                    style="overflow-y: hidden;"
                ></textarea>
                <div class="flex items-center justify-between">
                    <button class="rounded-md p-1.5 hover:bg-accent" aria-label="Attach file">
                        <Paperclip class="h-4 w-4 text-muted-foreground" />
                    </button>
                    <div class="flex items-center gap-2">
                        <select
                            bind:value={selectedModel}
                            class="appearance-none rounded-md bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent cursor-pointer"
                        >
                            {#each models as model}
                                <option value={model.id}>{model.label}</option>
                            {/each}
                        </select>
                        <button
                            class="rounded-md bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            disabled={!prompt.trim()}
                            aria-label="Send"
                        >
                            <Send class="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>
