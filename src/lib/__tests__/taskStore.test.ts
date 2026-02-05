import { get } from "svelte/store";
import { taskStore } from "$lib/stores/taskStore";
import type { TaskMetadata } from "$lib/types/task";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

const SESSION_FILE = "/mnt/taskstate/session.json";

function expectedSessionFile(_id: string) {
    return SESSION_FILE;
}

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
        taskStore.setActive(null);
    });

    it("loads tasks from the backend", async () => {
        const task = sampleTask();
        invokeMock.mockResolvedValue([task]);

        await taskStore.load();

        expect(invokeMock).toHaveBeenCalledWith("task_store_list");
        expect(get(taskStore)[0].sessionFile).toBe(expectedSessionFile(task.id));
    });

    it("upserts tasks and moves them to the top", async () => {
        const task = sampleTask();
        const updated: TaskMetadata = { ...task, status: "running" };

        invokeMock.mockResolvedValue([task]);
        await taskStore.load();

        invokeMock.mockResolvedValue(undefined);
        await taskStore.upsert(updated);

        const normalized = { ...updated, sessionFile: expectedSessionFile(updated.id) };
        expect(invokeMock).toHaveBeenCalledWith("task_store_upsert", { task: normalized });
        expect(get(taskStore)[0]).toEqual(normalized);
    });

    it("deletes tasks", async () => {
        const task = sampleTask();
        invokeMock.mockResolvedValue([task]);
        await taskStore.load();

        invokeMock.mockResolvedValue(undefined);
        await taskStore.delete(task.id);

        expect(invokeMock).toHaveBeenCalledWith("task_store_delete", { taskId: task.id });
        expect(get(taskStore)).toEqual([]);
    });

    it("deletes all tasks", async () => {
        const task = sampleTask();
        invokeMock.mockResolvedValue([task]);
        await taskStore.load();
        taskStore.setActive(task.id);

        invokeMock.mockResolvedValue(undefined);
        await taskStore.deleteAll();

        expect(invokeMock).toHaveBeenCalledWith("task_store_delete_all");
        expect(get(taskStore)).toEqual([]);
        expect(get(taskStore.activeTaskId)).toBe(null);
    });

    it("saves conversations with snake_case payload", async () => {
        invokeMock.mockResolvedValue(undefined);

        await taskStore.saveConversation("task-1", '{"messages":[]}');

        expect(invokeMock).toHaveBeenCalledWith("task_store_save_conversation", {
            taskId: "task-1",
            conversationJson: '{"messages":[]}',
        });
    });

    it("loads conversations with camelCase payload", async () => {
        invokeMock.mockResolvedValue('{"messages":[]}');

        const result = await taskStore.loadConversation("task-1");

        expect(invokeMock).toHaveBeenCalledWith("task_store_load_conversation", {
            taskId: "task-1",
        });
        expect(result).toBe('{"messages":[]}');
    });

    it("creates new task metadata", () => {
        const task = taskStore.create("New task");

        expect(task.title).toBe("New task");
        expect(task.status).toBe("idle");
        expect(task.id).toBeTruthy();
        expect(task.sessionFile).toBe(expectedSessionFile(task.id));
        expect(task.createdAt).toBeTruthy();
        expect(task.updatedAt).toBeTruthy();
    });

    it("does not auto-select tasks on load", async () => {
        const task = sampleTask();
        invokeMock.mockResolvedValue([task]);

        await taskStore.load();

        expect(get(taskStore.activeTaskId)).toBe(null);
    });

    it("updates active task when archived", async () => {
        const task = sampleTask();
        const archived = { ...task, status: "archived" };

        invokeMock.mockResolvedValue([task]);
        await taskStore.load();

        taskStore.setActive(task.id);

        invokeMock.mockResolvedValue(undefined);
        await taskStore.upsert(archived);

        expect(get(taskStore.activeTaskId)).toBe(null);
    });
});
