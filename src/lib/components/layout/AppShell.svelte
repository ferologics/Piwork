<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { devLog } from "$lib/utils/devLog";
import SetupRequired from "$lib/components/SetupRequired.svelte";
import { taskStore } from "$lib/stores/taskStore";
import { devMode } from "$lib/stores/devMode.svelte";
import TopBar from "./TopBar.svelte";
import SettingsModal from "./SettingsModal.svelte";
import LeftRail from "./LeftRail.svelte";
import RightPanel from "./RightPanel.svelte";
import MainView from "./MainView.svelte";

interface RuntimeStatus {
    status: "missing" | "ready";
    runtimeDir: string;
    manifestPath: string;
    qemuAvailable: boolean;
    qemuPath: string | null;
    accelAvailable: boolean | null;
}

let showLeftRail = $state(true);
let showRightPanel = $state(true);
let showSettings = $state(false);
let runtimeStatus = $state<RuntimeStatus | null>(null);
let runtimeError = $state<string | null>(null);
let checkingRuntime = $state(true);

async function loadRuntimeStatus() {
    devLog("AppShell", "loadRuntimeStatus");
    checkingRuntime = true;
    runtimeError = null;

    try {
        runtimeStatus = await invoke<RuntimeStatus>("runtime_status");
        devLog("AppShell", `runtime_status: ${runtimeStatus?.status}`);
    } catch (error) {
        devLog("AppShell", `runtime_status error: ${error}`);
        runtimeError = error instanceof Error ? error.message : String(error);
        runtimeStatus = null;
    } finally {
        checkingRuntime = false;
    }
}

function handleKeydown(e: KeyboardEvent) {
    // Cmd+Shift+D (Mac) or Ctrl+Shift+D (Win/Linux) toggles dev panel
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        devMode.toggle();
    }
}

onMount(() => {
    devLog("AppShell", "onMount");
    void loadRuntimeStatus();
    void taskStore.load().catch((error) => {
        devLog("AppShell", `taskStore.load error: ${error}`);
    });

    if (devMode.isAvailable) {
        window.addEventListener("keydown", handleKeydown);
    }
});

onDestroy(() => {
    if (devMode.isAvailable) {
        window.removeEventListener("keydown", handleKeydown);
    }
});
</script>

{#if checkingRuntime}
    <div class="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking runtime…
    </div>
{:else if runtimeStatus?.status === "missing" || runtimeError}
    <SetupRequired
        runtimeDir={runtimeStatus?.runtimeDir ?? ""}
        manifestPath={runtimeStatus?.manifestPath ?? ""}
        qemuAvailable={runtimeStatus?.qemuAvailable ?? false}
        qemuPath={runtimeStatus?.qemuPath ?? null}
        accelAvailable={runtimeStatus?.accelAvailable ?? null}
        error={runtimeError}
        onRecheck={loadRuntimeStatus}
    />
{:else}
    <div class="flex h-screen flex-col overflow-hidden">
        <TopBar bind:showLeftRail bind:showRightPanel onOpenSettings={() => (showSettings = true)} />
        <div class="flex flex-1 overflow-hidden">
            {#if showLeftRail}
                <LeftRail />
            {/if}
            <MainView />
            {#if showRightPanel}
                <RightPanel />
            {/if}
        </div>
    </div>
    <SettingsModal open={showSettings} onClose={() => (showSettings = false)} />

    <!-- Dev panel (Cmd+Shift+D to toggle) -->
    {#if devMode.isAvailable && devMode.showPanel}
        <div class="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur">
            <div class="flex items-center justify-between border-b border-border px-3 py-1">
                <span class="text-xs font-medium text-muted-foreground">Dev: RPC Log ({devMode.log.length})</span>
                <div class="flex gap-2">
                    <button
                        class="text-xs text-muted-foreground hover:text-foreground"
                        onclick={() => devMode.clearLog()}
                    >
                        Clear
                    </button>
                    <button
                        class="text-xs text-muted-foreground hover:text-foreground"
                        onclick={() => devMode.toggle()}
                    >
                        Close
                    </button>
                </div>
            </div>
            <div class="max-h-48 overflow-auto p-2 font-mono text-[10px] text-muted-foreground">
                {#each devMode.log as entry}
                    <div class="truncate hover:whitespace-normal">{entry}</div>
                {/each}
                {#if devMode.log.length === 0}
                    <div class="italic">No RPC events yet</div>
                {/if}
            </div>
        </div>
    {/if}
{/if}
