import { writable } from "svelte/store";

export interface ArtifactRefreshEvent {
    taskId: string | null;
    reason: string;
    token: number;
}

const state = writable<ArtifactRefreshEvent>({
    taskId: null,
    reason: "init",
    token: 0,
});

function request(taskId: string | null, reason: string) {
    state.update((current) => ({
        taskId,
        reason,
        token: current.token + 1,
    }));
}

export const artifactRefreshStore = {
    subscribe: state.subscribe,
    request,
};
