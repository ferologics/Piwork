import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import type { TaskMetadata } from "$lib/types/task";

const tasks = writable<TaskMetadata[]>([]);

async function loadTasks() {
    const list = await invoke<TaskMetadata[]>("task_store_list");
    tasks.set(list);
}

async function upsertTask(task: TaskMetadata) {
    await invoke("task_store_upsert", { task });
    tasks.update((current) => {
        const next = current.filter((item) => item.id !== task.id);
        next.unshift(task);
        return next;
    });
}

async function deleteTask(id: string) {
    await invoke("task_store_delete", { task_id: id });
    tasks.update((current) => current.filter((item) => item.id !== id));
}

function createTask(title: string) {
    const now = new Date().toISOString();
    const task: TaskMetadata = {
        id: crypto.randomUUID(),
        title,
        status: "idle",
        createdAt: now,
        updatedAt: now,
        sessionFile: null,
        mounts: [],
        model: null,
        thinkingLevel: null,
        connectorsEnabled: [],
    };

    return task;
}

export const taskStore = {
    subscribe: tasks.subscribe,
    load: loadTasks,
    upsert: upsertTask,
    delete: deleteTask,
    create: createTask,
};
