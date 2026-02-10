import { loadAiSettings, saveAiSettings } from "../core/AiConfig.js";
export class SettingsPanel {
    constructor() {
        const el = document.getElementById("settings");
        if (!el) {
            throw new Error("Missing settings container.");
        }
        this.container = el;
    }
    render() {
        this.container.innerHTML = `
      <h3 class="panel-title">判定官</h3>
      <label class="setting-row">
        <span>启用自定义应对</span>
        <input type="checkbox" id="ai-enabled" />
      </label>
      <label class="setting-field">
        <span>裁断接口地址</span>
        <input type="text" id="ai-url" placeholder="请填写裁断接口地址" />
      </label>
      <label class="setting-field">
        <span>接口密钥（可空）</span>
        <input type="password" id="ai-key" placeholder="若有密钥请填写" />
      </label>
      <div class="muted">启用后，事件允许时会出现“自定义应对”。</div>
    `;
        const settings = loadAiSettings();
        const enabledInput = this.container.querySelector("#ai-enabled");
        const urlInput = this.container.querySelector("#ai-url");
        const keyInput = this.container.querySelector("#ai-key");
        if (!enabledInput || !urlInput || !keyInput) {
            return;
        }
        enabledInput.checked = settings.enabled;
        urlInput.value = settings.apiUrl;
        keyInput.value = settings.apiKey;
        const save = () => {
            saveAiSettings({
                enabled: enabledInput.checked,
                apiUrl: urlInput.value.trim(),
                apiKey: keyInput.value.trim(),
            });
        };
        enabledInput.addEventListener("change", save);
        urlInput.addEventListener("change", save);
        keyInput.addEventListener("change", save);
    }
}
