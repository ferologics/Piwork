<script lang="ts">
import { Send, Paperclip, FolderOpen } from "@lucide/svelte";

let prompt = $state("");
</script>

<main class="flex flex-1 flex-col bg-background">
    <!-- Chat transcript area -->
    <div class="flex-1 overflow-y-auto p-4">
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
            <div class="flex items-end gap-2 rounded-lg border border-input bg-background p-2">
                <button class="rounded-md p-2 hover:bg-accent" aria-label="Attach file">
                    <Paperclip class="h-4 w-4 text-muted-foreground" />
                </button>
                <textarea
                    bind:value={prompt}
                    placeholder="What would you like to do?"
                    rows="1"
                    class="flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                ></textarea>
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
</main>
