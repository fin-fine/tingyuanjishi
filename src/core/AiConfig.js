const STORAGE_KEY = "story_sim_ai_config";
const defaultSettings = {
    enabled: false,
    apiUrl: "",
    apiKey: "",
};
export function loadAiSettings() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return { ...defaultSettings };
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            enabled: Boolean(parsed.enabled),
            apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : "",
            apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        };
    }
    catch {
        return { ...defaultSettings };
    }
}
export function saveAiSettings(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
