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
    mounts?: TaskMount[];
    model?: string | null;
    thinkingLevel?: string | null;
    connectorsEnabled?: string[];
}
