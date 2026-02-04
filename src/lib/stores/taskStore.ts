import { derived, get, writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import type { TaskMetadata } from "$lib/types/task";

const tasks = writable<TaskMetadata[]>([]);
const activeTaskId = writable<string | null>(null);
const activeTask = derived([tasks, activeTaskId], ([list, id]) => list.find((task) => task.id === id) ?? null);

// Recent folders (persisted to localStorage)
const RECENT_FOLDERS_KEY = "piwork_recent_folders";
const MAX_RECENT_FOLDERS = 10;
const recentFolders = writable<string[]>(loadRecentFolders());

function loadRecentFolders(): string[] {
    try {
        const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveRecentFolders(folders: string[]) {
    try {
        localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(folders));
    } catch {
        // Ignore storage errors
    }
}

function addRecentFolder(folder: string) {
    recentFolders.update((current) => {
        const filtered = current.filter((f) => f !== folder);
        const updated = [folder, ...filtered].slice(0, MAX_RECENT_FOLDERS);
        saveRecentFolders(updated);
        return updated;
    });
}

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

function createTask(title: string, workingFolder: string | null = null) {
    const now = new Date().toISOString();
    const task: TaskMetadata = {
        id: crypto.randomUUID(),
        title,
        status: "idle",
        createdAt: now,
        updatedAt: now,
        sessionFile: null,
        workingFolder,
        mounts: [],
        model: null,
        thinkingLevel: null,
        connectorsEnabled: [],
    };

    // Track folder in recent list
    if (workingFolder) {
        addRecentFolder(workingFolder);
    }

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

async function saveConversation(taskId: string, conversationJson: string): Promise<void> {
    await invoke("task_store_save_conversation", { taskId, conversationJson });
}

async function loadConversation(taskId: string): Promise<string | null> {
    return await invoke<string | null>("task_store_load_conversation", { taskId });
}

export const taskStore = {
    subscribe: tasks.subscribe,
    activeTaskId: { subscribe: activeTaskId.subscribe },
    activeTask: { subscribe: activeTask.subscribe },
    recentFolders: { subscribe: recentFolders.subscribe },
    load: loadTasks,
    upsert: upsertTask,
    delete: deleteTask,
    create: createTask,
    setActive: setActiveTask,
    saveConversation,
    loadConversation,
    addRecentFolder,
};
