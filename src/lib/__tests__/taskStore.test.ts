import { get } from "svelte/store";
import { taskStore } from "$lib/stores/taskStore";
import type { TaskMetadata } from "$lib/types/task";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

function sampleTask(): TaskMetadata {
    return {
        id: "task-1",
        title: "Test task",
        status: "idle",
        createdAt: "2026-02-04T00:00:00.000Z",
        updatedAt: "2026-02-04T00:00:00.000Z",
        sessionFile: null,
        mounts: [],
        model: null,
        thinkingLevel: null,
        connectorsEnabled: [],
    };
}

describe("taskStore", () => {
    beforeEach(() => {
        invokeMock.mockReset();
    });

    it("loads tasks from the backend", async () => {
        const task = sampleTask();
        invokeMock.mockResolvedValue([task]);

        await taskStore.load();

        expect(invokeMock).toHaveBeenCalledWith("task_store_list");
        expect(get(taskStore)).toEqual([task]);
    });

    it("upserts tasks and moves them to the top", async () => {
        const task = sampleTask();
        const updated: TaskMetadata = { ...task, status: "running" };

        invokeMock.mockResolvedValue([task]);
        await taskStore.load();

        invokeMock.mockResolvedValue(undefined);
        await taskStore.upsert(updated);

        expect(invokeMock).toHaveBeenCalledWith("task_store_upsert", { task: updated });
        expect(get(taskStore)[0]).toEqual(updated);
    });

    it("deletes tasks", async () => {
        const task = sampleTask();
        invokeMock.mockResolvedValue([task]);
        await taskStore.load();

        invokeMock.mockResolvedValue(undefined);
        await taskStore.delete(task.id);

        expect(invokeMock).toHaveBeenCalledWith("task_store_delete", { task_id: task.id });
        expect(get(taskStore)).toEqual([]);
    });

    it("creates new task metadata", () => {
        const task = taskStore.create("New task");

        expect(task.title).toBe("New task");
        expect(task.status).toBe("idle");
        expect(task.id).toBeTruthy();
        expect(task.createdAt).toBeTruthy();
        expect(task.updatedAt).toBeTruthy();
    });
});
