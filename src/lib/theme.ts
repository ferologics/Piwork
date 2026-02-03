/**
 * System appearance detection and theme application.
 * Adds/removes `.dark` class on <html> based on system preference.
 */

export function initTheme() {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function apply(dark: boolean) {
        document.documentElement.classList.toggle("dark", dark);
    }

    // Apply on init
    apply(mediaQuery.matches);

    // Listen for changes
    mediaQuery.addEventListener("change", (e) => apply(e.matches));
}
