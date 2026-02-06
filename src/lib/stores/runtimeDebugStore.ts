import { writable } from "svelte/store";

export interface RuntimeDebugState {
    activeTaskId: string | null;
    sessionId: string | null;
    sessionName: string | null;
    currentCwd: string | null;
    workingFolderRelative: string | null;
    updatedAt: number;
}

const initialState: RuntimeDebugState = {
    activeTaskId: null,
    sessionId: null,
    sessionName: null,
    currentCwd: null,
    workingFolderRelative: null,
    updatedAt: 0,
};

const state = writable<RuntimeDebugState>(initialState);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function updateFromRuntimeState(data: unknown) {
    if (!isRecord(data)) {
        state.set({ ...initialState, updatedAt: Date.now() });
        return;
    }

    const activeTaskId = parseString(data.activeTaskId);

    const tasks: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
    const activeTask =
        tasks.find((entry: unknown) => {
            if (!isRecord(entry)) {
                return false;
            }

            return parseString(entry.taskId) === activeTaskId;
        }) ?? tasks.find((entry: unknown) => isRecord(entry) && parseString(entry.state) === "active");

    const currentCwd = isRecord(activeTask) ? parseString(activeTask.currentCwd) : null;
    const workingFolderRelative = isRecord(activeTask) ? parseString(activeTask.workingFolderRelative) : null;

    state.set({
        activeTaskId,
        sessionId: activeTaskId,
        sessionName: activeTaskId,
        currentCwd,
        workingFolderRelative,
        updatedAt: Date.now(),
    });
}

function updateFromGetState(data: unknown) {
    updateFromRuntimeState(data);
}

function clear() {
    state.set({ ...initialState, updatedAt: Date.now() });
}

export const runtimeDebugStore = {
    subscribe: state.subscribe,
    updateFromRuntimeState,
    updateFromGetState,
    clear,
};
