export interface TaskMount {
    path: string;
    mode: "read" | "write";
}

export interface TaskMetadata {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    sessionFile?: string | null;
    workingFolder?: string | null;
    mounts?: TaskMount[]; // deprecated, use workingFolder
    provider?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    connectorsEnabled?: string[];
}
