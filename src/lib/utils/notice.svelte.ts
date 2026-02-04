/**
 * Creates a notice state manager with auto-clear timer.
 * Use in Svelte 5 components.
 */
export function createNotice(duration = 3000) {
    let value = $state<string | null>(null);
    let timer: ReturnType<typeof setTimeout> | null = null;

    function set(message: string) {
        value = message;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            value = null;
        }, duration);
    }

    function clear() {
        value = null;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function cleanup() {
        if (timer) clearTimeout(timer);
    }

    return {
        get value() {
            return value;
        },
        set,
        clear,
        cleanup,
    };
}
