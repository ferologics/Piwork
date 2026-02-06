import { writable } from "svelte/store";

export type PreviewSource = "preview" | "artifact";
export type ArtifactSource = "outputs" | "uploads";

export interface PreviewSelection {
    isOpen: boolean;
    taskId: string | null;
    relativePath: string | null;
    requestId: number;
    source: PreviewSource;
    artifactSource: ArtifactSource | null;
}

interface OpenPreviewOptions {
    source?: PreviewSource;
    artifactSource?: ArtifactSource | null;
}

const state = writable<PreviewSelection>({
    isOpen: false,
    taskId: null,
    relativePath: null,
    requestId: 0,
    source: "preview",
    artifactSource: null,
});

let requestCounter = 0;

function open(taskId: string, relativePath: string, options: OpenPreviewOptions = {}) {
    requestCounter += 1;

    const source = options.source ?? "preview";
    const artifactSource = source === "artifact" ? (options.artifactSource ?? "outputs") : null;

    state.set({
        isOpen: true,
        taskId,
        relativePath,
        requestId: requestCounter,
        source,
        artifactSource,
    });
}

function close() {
    requestCounter += 1;
    state.set({
        isOpen: false,
        taskId: null,
        relativePath: null,
        requestId: requestCounter,
        source: "preview",
        artifactSource: null,
    });
}

export const previewStore = {
    subscribe: state.subscribe,
    open,
    close,
};
