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

// Lazy load MainView to avoid blocking initial render
let MainView: typeof import("./MainView.svelte").default | null = $state(null);

async function loadMainView() {
    devLog("AppShell", "loadMainView start");
    if (MainView) return;
    const module = await import("./MainView.svelte");
    MainView = module.default;
    devLog("AppShell", "loadMainView done");
}

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
let showSettings = $state(false);
let runtimeStatus = $state<RuntimeStatus | null>(null);
let runtimeError = $state<string | null>(null);
let checkingRuntime = $state(false);

async function loadRuntimeStatus() {
    devLog("AppShell", "loadRuntimeStatus start");
    checkingRuntime = true;
    runtimeError = null;

    try {
        devLog("AppShell", "invoking runtime_status...");
        runtimeStatus = await invoke<RuntimeStatus>("runtime_status");
        devLog("AppShell", `runtime_status returned: ${runtimeStatus?.status}`);
    } catch (error) {
        devLog("AppShell", `runtime_status error: ${error}`);
        runtimeError = error instanceof Error ? error.message : String(error);
        runtimeStatus = null;
    } finally {
        devLog("AppShell", "loadRuntimeStatus done");
        checkingRuntime = false;
    }
}

onMount(() => {
    devLog("AppShell", "onMount");
    void loadRuntimeStatus().then(() => {
        devLog("AppShell", `after loadRuntimeStatus, status=${runtimeStatus?.status}`);
        if (runtimeStatus?.status === "ready") {
            void loadMainView();
        }
    });
    void taskStore.load().catch((error) => {
        devLog("AppShell", `taskStore.load error: ${error}`);
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
        <TopBar bind:showLeftRail bind:showRightPanel onOpenSettings={() => (showSettings = true)} />
        <div class="flex flex-1 overflow-hidden">
            {#if showLeftRail}
                <LeftRail />
            {/if}
            {#if MainView}
                <MainView />
            {:else}
                <div class="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>
            {/if}
            {#if showRightPanel}
                <RightPanel />
            {/if}
        </div>
    </div>
    <SettingsModal open={showSettings} onClose={() => (showSettings = false)} />
{/if}
