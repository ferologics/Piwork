import { writable } from "svelte/store";

export interface PreviewSelection {
    isOpen: boolean;
    taskId: string | null;
    relativePath: string | null;
    requestId: number;
}

const state = writable<PreviewSelection>({
    isOpen: false,
    taskId: null,
    relativePath: null,
    requestId: 0,
});

let requestCounter = 0;

function open(taskId: string, relativePath: string) {
    requestCounter += 1;
    state.set({
        isOpen: true,
        taskId,
        relativePath,
        requestId: requestCounter,
    });
}

function close() {
    requestCounter += 1;
    state.set({
        isOpen: false,
        taskId: null,
        relativePath: null,
        requestId: requestCounter,
    });
}

export const previewStore = {
    subscribe: state.subscribe,
    open,
    close,
};
