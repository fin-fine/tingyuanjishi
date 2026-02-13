import { EventPopup } from "./EventPopup.js";
import { StatsPanel } from "./StatsPanel.js";
import { ShopPanel } from "./ShopPanel.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { SavePanel } from "./SavePanel.js";
import { IntroPanel } from "./IntroPanel.js";
import { LogPanel } from "./LogPanel.js";
import { TimePanel } from "./TimePanel.js";
import { ChildPanel } from "./ChildPanel.js";
export class MainScene {
    constructor(player, world, items, onReset) {
        this.eventPopup = new EventPopup();
        this.statsPanel = new StatsPanel(player, world);
        this.shopPanel = new ShopPanel(player, items);
        this.settingsPanel = new SettingsPanel(onReset);
        this.settingsPanel.render();
        this.savePanel = new SavePanel();
        this.introPanel = new IntroPanel(player);
        this.logPanel = new LogPanel();
        this.timePanel = new TimePanel(world);
        this.childPanel = new ChildPanel(player, world);
    }
    showIntro(onConfirm, legacy) {
        this.introPanel.render(onConfirm, legacy);
    }
    showEvent(event, onSelect, onCustom, onPlan) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.timePanel.render();
        this.childPanel.render();
        this.eventPopup.render(event, onSelect, onCustom, onPlan);
    }
    showSpecialEvent(event, onSelect, onCustom) {
        this.timePanel.render();
        this.childPanel.render();
        this.eventPopup.renderSpecial(event, onSelect, onCustom);
    }
    showEmpty(text) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.timePanel.render();
        this.childPanel.render();
        this.eventPopup.renderEmpty(text);
    }
    showResult(text, onContinue) {
        this.timePanel.render();
        this.childPanel.render();
        this.eventPopup.renderResult(text, onContinue);
    }
    showLoading(text) {
        this.timePanel.render();
        this.childPanel.render();
        this.eventPopup.renderLoading(text);
    }
    showEnding(titleText, text, onRestart, statsHtml) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.timePanel.render();
        this.childPanel.render();
        this.eventPopup.renderEnding(titleText, text, onRestart, statsHtml);
    }
    showEndingReviewLoading() {
        this.eventPopup.showEndingReviewLoading();
    }
    appendEndingSection(text) {
        this.eventPopup.appendEndingSection(text);
    }
    removeEndingReviewLoading() {
        this.eventPopup.removeEndingReviewLoading();
    }
    renderLog(entries) {
        this.logPanel.render(entries);
    }
    renderTime() {
        this.timePanel.render();
    }
    renderChildren() {
        this.childPanel.render();
    }
    showNameChildDialog(childId, sex, onConfirm) {
        const sexLabel = sex === "boy" ? "儿子" : "女儿";
        const defaultName = sex === "boy" ? "无名" : "无名";
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center;";
        const dialog = document.createElement("div");
        dialog.className = "name-dialog";
        dialog.style.cssText = "background: #2a2a2a; border: 2px solid #8b7355; padding: 2rem; border-radius: 8px; max-width: 400px; width: 90%;";
        dialog.innerHTML = `
      <h2 style="color: #d4af37; margin-bottom: 1rem; text-align: center;">为${sexLabel}取名</h2>
      <p style="color: #ccc; margin-bottom: 1.5rem; line-height: 1.6;">
        ${sex === "boy" ? "府中喜得麟儿，少爷命你为这孩儿取个名字。" : "你产下一女，虽非嫡子，也需有个名字。"}
        此名将伴随孩子一生，望你慎重。
      </p>
      <div style="margin-bottom: 1.5rem;">
        <input 
          type="text" 
          id="child-name-input" 
          placeholder="请输入名字（1-4个字）"
          maxlength="4"
          style="width: 100%; padding: 0.75rem; background: #1a1a1a; border: 1px solid #8b7355; color: #d4af37; border-radius: 4px; font-size: 1rem;"
        />
      </div>
      <div style="display: flex; gap: 1rem; justify-content: flex-end;">
        <button id="name-random-btn" style="padding: 0.5rem 1rem; background: #4a4a4a; color: #ccc; border: 1px solid #666; border-radius: 4px; cursor: pointer;">随机</button>
        <button id="name-confirm-btn" style="padding: 0.5rem 1.5rem; background: #8b7355; color: #fff; border: none; border-radius: 4px; cursor: pointer;">确定</button>
      </div>
    `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        const input = dialog.querySelector("#child-name-input");
        const confirmBtn = dialog.querySelector("#name-confirm-btn");
        const randomBtn = dialog.querySelector("#name-random-btn");
        // 随机名字库
        const boyNames = ["承志", "思远", "文渊", "明轩", "子衿", "景行", "君谦", "云帆", "博文", "泽润"];
        const girlNames = ["婉仪", "清音", "雅韵", "含芳", "若兰", "思琪", "静婉", "采薇", "锦瑟", "云裳"];
        input.focus();
        randomBtn.addEventListener("click", () => {
            const names = sex === "boy" ? boyNames : girlNames;
            const randomName = names[Math.floor(Math.random() * names.length)];
            input.value = randomName;
        });
        const handleConfirm = () => {
            const name = input.value.trim();
            if (!name) {
                alert("请输入名字");
                return;
            }
            if (name.length > 4) {
                alert("名字不能超过4个字");
                return;
            }
            document.body.removeChild(overlay);
            onConfirm(name);
        };
        confirmBtn.addEventListener("click", handleConfirm);
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                handleConfirm();
            }
        });
    }
    renderSaves(slots, onSave, onLoad) {
        this.savePanel.render(slots, onSave, onLoad);
        this.timePanel.render();
        this.childPanel.render();
    }
}
