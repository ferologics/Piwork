<script lang="ts">
export interface ExtensionUiRequest {
    id: string;
    method: string;
    title?: string;
    message?: string;
    options?: string[];
    placeholder?: string;
    prefill?: string;
}

interface Props {
    request: ExtensionUiRequest;
    sending: boolean;
    onconfirm: (confirmed: boolean) => void;
    onselect: (value: string) => void;
    onsubmit: (value: string) => void;
    oncancel: () => void;
}

let { request, sending, onconfirm, onselect, onsubmit, oncancel }: Props = $props();
let inputValue = $state("");

// Reset input when request changes
$effect(() => {
    inputValue = request.prefill ?? "";
});
</script>

<div class="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
    <div class="text-sm font-medium text-foreground">
        {request.title ?? "Action required"}
    </div>
    {#if request.message}
        <div class="mt-1">{request.message}</div>
    {/if}
    <div class="mt-2 text-[11px] text-muted-foreground">
        Method: {request.method}
    </div>
    
    {#if request.method === "confirm"}
        <div class="mt-3 flex gap-2">
            <button
                class="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                onclick={() => onconfirm(true)}
                disabled={sending}
            >
                Confirm
            </button>
            <button
                class="rounded-md bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-60"
                onclick={() => onconfirm(false)}
                disabled={sending}
            >
                Deny
            </button>
            <button
                class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                onclick={oncancel}
                disabled={sending}
            >
                Cancel
            </button>
        </div>
    {:else if request.method === "select"}
        <div class="mt-3 flex flex-wrap gap-2">
            {#each request.options ?? [] as option}
                <button
                    class="rounded-md bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-60"
                    onclick={() => onselect(option)}
                    disabled={sending}
                >
                    {option}
                </button>
            {/each}
            <button
                class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                onclick={oncancel}
                disabled={sending}
            >
                Cancel
            </button>
        </div>
    {:else if request.method === "input"}
        <div class="mt-3 space-y-2">
            <input
                class="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                placeholder={request.placeholder ?? "Enter a value"}
                bind:value={inputValue}
            />
            <div class="flex gap-2">
                <button
                    class="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    onclick={() => onsubmit(inputValue)}
                    disabled={sending}
                >
                    Submit
                </button>
                <button
                    class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                    onclick={oncancel}
                    disabled={sending}
                >
                    Cancel
                </button>
            </div>
        </div>
    {:else if request.method === "editor"}
        <div class="mt-3 space-y-2">
            <textarea
                class="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                rows="4"
                bind:value={inputValue}
            ></textarea>
            <div class="flex gap-2">
                <button
                    class="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    onclick={() => onsubmit(inputValue)}
                    disabled={sending}
                >
                    Submit
                </button>
                <button
                    class="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60"
                    onclick={oncancel}
                    disabled={sending}
                >
                    Cancel
                </button>
            </div>
        </div>
    {:else}
        <div class="mt-3 flex gap-2">
            <button
                class="rounded-md bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-60"
                onclick={oncancel}
                disabled={sending}
            >
                Dismiss
            </button>
        </div>
    {/if}
</div>
