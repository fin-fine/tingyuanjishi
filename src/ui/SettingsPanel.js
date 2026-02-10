import { DEFAULT_AI_URL, loadAiSettings, saveAiSettings } from "../core/AiConfig.js";
export class SettingsPanel {
    constructor(onReset) {
        this.onReset = onReset;
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
        <input type="text" id="ai-url" placeholder="${DEFAULT_AI_URL}" />
      </label>
      <div class="setting-row">
        <span>测试链接</span>
        <button type="button" class="shop-buy" id="ai-test">测试链接</button>
      </div>
      <div class="muted" id="ai-test-status"></div>
      <label class="setting-field">
        <span>接口密钥（必填）</span>
        <input type="password" id="ai-key" placeholder="请输入接口密钥" />
      </label>
      <div class="muted" id="ai-warning"></div>
      <div class="muted">启用后，事件允许时会出现“自定义应对”。</div>
      <h3 class="panel-title">开局</h3>
      <div class="setting-row">
        <span>重新开局会清空存档</span>
        <button type="button" class="shop-buy" id="reset-game">重新开局</button>
      </div>
    `;
        const settings = loadAiSettings();
        const enabledInput = this.container.querySelector("#ai-enabled");
        const urlInput = this.container.querySelector("#ai-url");
        const keyInput = this.container.querySelector("#ai-key");
        const testButton = this.container.querySelector("#ai-test");
        const testStatus = this.container.querySelector("#ai-test-status");
        const warning = this.container.querySelector("#ai-warning");
        const resetButton = this.container.querySelector("#reset-game");
        if (!enabledInput || !urlInput || !keyInput) {
            return;
        }
        enabledInput.checked = settings.enabled;
        urlInput.value = settings.apiUrl || DEFAULT_AI_URL;
        keyInput.value = settings.apiKey;
        const validate = () => {
            const url = urlInput.value.trim();
            const key = keyInput.value.trim();
            if (enabledInput.checked && (!url || !key)) {
                if (warning) {
                    warning.textContent = "启用前需填写接口地址与密钥。";
                }
                enabledInput.checked = false;
                return false;
            }
            if (warning) {
                warning.textContent = "";
            }
            return true;
        };
        const save = () => {
            if (!validate()) {
                return;
            }
            saveAiSettings({
                enabled: enabledInput.checked,
                apiUrl: urlInput.value.trim() || DEFAULT_AI_URL,
                apiKey: keyInput.value.trim(),
            });
        };
        enabledInput.addEventListener("change", save);
        urlInput.addEventListener("change", save);
        keyInput.addEventListener("change", save);
        testButton?.addEventListener("click", async () => {
            const url = urlInput.value.trim() || DEFAULT_AI_URL;
            const key = keyInput?.value.trim();
            if (!testStatus) {
                return;
            }
            if (!url) {
                testStatus.textContent = "请先填写接口地址。";
                return;
            }
            if (!key) {
                testStatus.textContent = "请先填写接口密钥。";
                return;
            }
            testStatus.textContent = "测试中...";
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 6000);
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${key}`,
                    },
                    body: JSON.stringify({
                        model: "deepseek-chat",
                        messages: [{ role: "user", content: "测试" }],
                        stream: false,
                    }),
                    signal: controller.signal,
                });
                testStatus.textContent = response.ok
                    ? `连接成功（${response.status}）`
                    : `连接失败（${response.status}）`;
            }
            catch (error) {
                testStatus.textContent = "连接失败（网络或跨域限制）。";
            }
            finally {
                window.clearTimeout(timer);
            }
        });
        resetButton?.addEventListener("click", () => {
            const ok = window.confirm("确定要重新开局并清空存档吗？");
            if (ok) {
                this.onReset();
            }
        });
    }
}
