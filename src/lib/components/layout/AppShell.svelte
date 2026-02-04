<script lang="ts">
import { onMount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { devLog } from "$lib/utils/devLog";
import SetupRequired from "$lib/components/SetupRequired.svelte";
import { taskStore } from "$lib/stores/taskStore";
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

onMount(() => {
    devLog("AppShell", "onMount");
    void loadRuntimeStatus();
    void taskStore.load().catch((error) => {
        devLog("AppShell", `taskStore.load error: ${error}`);
    });
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
{/if}
