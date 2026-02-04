import { derived, get, writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import type { TaskMetadata } from "$lib/types/task";

const tasks = writable<TaskMetadata[]>([]);
const activeTaskId = writable<string | null>(null);
const activeTask = derived([tasks, activeTaskId], ([list, id]) => list.find((task) => task.id === id) ?? null);

async function loadTasks() {
    const list = await invoke<TaskMetadata[]>("task_store_list");
    tasks.set(list);
    ensureActiveTask(list);
}

async function upsertTask(task: TaskMetadata) {
    await invoke("task_store_upsert", { task });
    let next: TaskMetadata[] = [];
    tasks.update((current) => {
        next = current.filter((item) => item.id !== task.id);
        next.unshift(task);
        return next;
    });
    ensureActiveTask(next);
}

async function deleteTask(id: string) {
    await invoke("task_store_delete", { task_id: id });
    let next: TaskMetadata[] = [];
    tasks.update((current) => {
        next = current.filter((item) => item.id !== id);
        return next;
    });
    ensureActiveTask(next);
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

function isSelectable(task: TaskMetadata) {
    return task.status !== "archived";
}

function ensureActiveTask(list: TaskMetadata[]) {
    const currentId = get(activeTaskId);
    if (!currentId) {
        return;
    }

    const currentTask = list.find((task) => task.id === currentId);
    if (currentTask && isSelectable(currentTask)) {
        return;
    }

    activeTaskId.set(null);
}

function setActiveTask(id: string | null) {
    if (!id) {
        activeTaskId.set(null);
        return;
    }

    const list = get(tasks);
    const task = list.find((item) => item.id === id);

    if (!task || !isSelectable(task)) {
        return;
    }

    activeTaskId.set(id);
}

export const taskStore = {
    subscribe: tasks.subscribe,
    activeTaskId: { subscribe: activeTaskId.subscribe },
    activeTask: { subscribe: activeTask.subscribe },
    load: loadTasks,
    upsert: upsertTask,
    delete: deleteTask,
    create: createTask,
    setActive: setActiveTask,
};
