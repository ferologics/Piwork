// Dev mode store - only enabled in dev builds
const IS_DEV = import.meta.env.DEV;

// Reactive state using runes (works in .svelte.ts files)
let showPanel = $state(false);
let log = $state<string[]>([]);

export const devMode = {
    get isAvailable() {
        return IS_DEV;
    },
    get showPanel() {
        return showPanel;
    },
    set showPanel(value: boolean) {
        showPanel = value;
    },
    toggle() {
        showPanel = !showPanel;
    },
    get log() {
        return log;
    },
    pushLog(entry: string) {
        if (!IS_DEV) return;
        log = [...log.slice(-199), entry];
    },
    clearLog() {
        log = [];
    },
};
