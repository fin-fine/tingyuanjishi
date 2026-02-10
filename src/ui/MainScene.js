import { EventPopup } from "./EventPopup.js";
import { StatsPanel } from "./StatsPanel.js";
import { ShopPanel } from "./ShopPanel.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { SavePanel } from "./SavePanel.js";
import { IntroPanel } from "./IntroPanel.js";
import { LogPanel } from "./LogPanel.js";
import { TimePanel } from "./TimePanel.js";
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
    }
    showIntro(onConfirm) {
        this.introPanel.render(onConfirm);
    }
    showEvent(event, onSelect, onCustom, onPlan) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.timePanel.render();
        this.eventPopup.render(event, onSelect, onCustom, onPlan);
    }
    showSpecialEvent(event, onSelect, onCustom) {
        this.timePanel.render();
        this.eventPopup.renderSpecial(event, onSelect, onCustom);
    }
    showEmpty(text) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.timePanel.render();
        this.eventPopup.renderEmpty(text);
    }
    showResult(text, onContinue) {
        this.timePanel.render();
        this.eventPopup.renderResult(text, onContinue);
    }
    showLoading(text) {
        this.timePanel.render();
        this.eventPopup.renderLoading(text);
    }
    showEnding(titleText, text) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.timePanel.render();
        this.eventPopup.renderEnding(titleText, text);
    }
    renderLog(entries) {
        this.logPanel.render(entries);
    }
    renderTime() {
        this.timePanel.render();
    }
    renderSaves(slots, onSave, onLoad) {
        this.savePanel.render(slots, onSave, onLoad);
        this.timePanel.render();
    }
}
