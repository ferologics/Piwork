const AUTH_PROFILE_PATTERN = /^[A-Za-z0-9._-]+$/;

export function normalizeAuthProfile(value: string | null | undefined): string {
    const trimmed = value?.trim() ?? "";

    if (!trimmed) {
        return "default";
    }

    if (!AUTH_PROFILE_PATTERN.test(trimmed)) {
        return "default";
    }

    if (trimmed.includes("..")) {
        return "default";
    }

    return trimmed;
}
