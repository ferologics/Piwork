<script lang="ts">
import { onMount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import SetupRequired from "$lib/components/SetupRequired.svelte";
import { taskStore } from "$lib/stores/taskStore";
import TopBar from "./TopBar.svelte";
import LeftRail from "./LeftRail.svelte";
import MainView from "./MainView.svelte";
import RightPanel from "./RightPanel.svelte";

interface RuntimeStatus {
    status: "missing" | "ready";
    runtimeDir: string;
    manifestPath: string;
    qemuAvailable: boolean;
    qemuPath: string | null;
    accelAvailable: boolean | null;
}

// TODO: default to false in prod
let showLeftRail = $state(true);
let showRightPanel = $state(true);
let runtimeStatus = $state<RuntimeStatus | null>(null);
let runtimeError = $state<string | null>(null);
let checkingRuntime = $state(false);

async function loadRuntimeStatus() {
    checkingRuntime = true;
    runtimeError = null;

    try {
        runtimeStatus = await invoke<RuntimeStatus>("runtime_status");
    } catch (error) {
        runtimeError = error instanceof Error ? error.message : String(error);
        runtimeStatus = null;
    } finally {
        checkingRuntime = false;
    }
}

onMount(() => {
    void loadRuntimeStatus();
    void taskStore.load().catch((error) => {
        console.error("Failed to load tasks", error);
    });
});
</script>

{#if checkingRuntime && !runtimeStatus}
    <div class="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking runtime…
    </div>
{:else if runtimeStatus && runtimeStatus.status === "missing"}
    <SetupRequired
        runtimeDir={runtimeStatus.runtimeDir}
        manifestPath={runtimeStatus.manifestPath}
        qemuAvailable={runtimeStatus.qemuAvailable}
        qemuPath={runtimeStatus.qemuPath}
        accelAvailable={runtimeStatus.accelAvailable}
        error={runtimeError}
        onRecheck={loadRuntimeStatus}
    />
{:else if runtimeError}
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
        <TopBar bind:showLeftRail bind:showRightPanel />
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
{/if}
