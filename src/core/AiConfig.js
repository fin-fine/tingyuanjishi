const STORAGE_KEY = "story_sim_ai_config";
export const DEFAULT_AI_URL = "https://api.deepseek.com/v1/chat/completions";
const defaultSettings = {
    enabled: false,
    apiUrl: DEFAULT_AI_URL,
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
            apiUrl: typeof parsed.apiUrl === "string" && parsed.apiUrl ? parsed.apiUrl : DEFAULT_AI_URL,
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
