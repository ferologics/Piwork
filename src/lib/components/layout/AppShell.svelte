<script lang="ts">
import TopBar from "./TopBar.svelte";
import LeftRail from "./LeftRail.svelte";
import MainView from "./MainView.svelte";
import RightPanel from "./RightPanel.svelte";

// TODO: default to false in prod
let showRightPanel = $state(true);
</script>

<div class="flex h-screen flex-col overflow-hidden">
    <TopBar bind:showRightPanel />
    <div class="flex flex-1 overflow-hidden">
        <LeftRail />
        <MainView />
        {#if showRightPanel}
            <RightPanel />
        {/if}
    </div>
</div>
