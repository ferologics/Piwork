import { get } from "svelte/store";
import { runtimeDebugStore } from "$lib/stores/runtimeDebugStore";

describe("runtimeDebugStore", () => {
    beforeEach(() => {
        runtimeDebugStore.clear();
    });

    it("tracks cwd for the active task from runtime_get_state payload", () => {
        runtimeDebugStore.updateFromRuntimeState({
            activeTaskId: "task-2",
            tasks: [
                {
                    taskId: "task-1",
                    state: "idle",
                    currentCwd: "/mnt/taskstate/task-1/outputs",
                    workingFolderRelative: null,
                },
                {
                    taskId: "task-2",
                    state: "active",
                    currentCwd: "/mnt/workdir",
                    workingFolderRelative: "",
                },
            ],
        });

        const state = get(runtimeDebugStore);
        expect(state.activeTaskId).toBe("task-2");
        expect(state.currentCwd).toBe("/mnt/workdir");
        expect(state.workingFolderRelative).toBeNull();
        expect(state.updatedAt).toBeGreaterThan(0);
    });

    it("falls back to the task marked active when activeTaskId is missing", () => {
        runtimeDebugStore.updateFromRuntimeState({
            activeTaskId: null,
            tasks: [
                {
                    taskId: "task-9",
                    state: "active",
                    currentCwd: "/mnt/workdir/src",
                    workingFolderRelative: "src",
                },
            ],
        });

        const state = get(runtimeDebugStore);
        expect(state.activeTaskId).toBeNull();
        expect(state.currentCwd).toBe("/mnt/workdir/src");
        expect(state.workingFolderRelative).toBe("src");
    });

    it("clears state on invalid payload", () => {
        runtimeDebugStore.updateFromRuntimeState("not-an-object");

        const state = get(runtimeDebugStore);
        expect(state.activeTaskId).toBeNull();
        expect(state.currentCwd).toBeNull();
        expect(state.workingFolderRelative).toBeNull();
        expect(state.updatedAt).toBeGreaterThan(0);
    });
});
