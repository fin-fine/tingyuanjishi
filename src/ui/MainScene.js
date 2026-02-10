import { EventPopup } from "./EventPopup.js";
import { StatsPanel } from "./StatsPanel.js";
import { ShopPanel } from "./ShopPanel.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { SavePanel } from "./SavePanel.js";
export class MainScene {
    constructor(player, world, items) {
        this.eventPopup = new EventPopup();
        this.statsPanel = new StatsPanel(player, world);
        this.shopPanel = new ShopPanel(player, items);
        this.settingsPanel = new SettingsPanel();
        this.settingsPanel.render();
        this.savePanel = new SavePanel();
    }
    showEvent(event, onSelect, onCustom, onPlan) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.eventPopup.render(event, onSelect, onCustom, onPlan);
    }
    showSpecialEvent(event, onSelect) {
        this.eventPopup.renderSpecial(event, onSelect);
    }
    showEmpty(text) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.eventPopup.renderEmpty(text);
    }
    showResult(text, onContinue) {
        this.eventPopup.renderResult(text, onContinue);
    }
    showLoading(text) {
        this.eventPopup.renderLoading(text);
    }
    showEnding(titleText, text) {
        this.statsPanel.render();
        this.shopPanel.render(() => this.statsPanel.render());
        this.eventPopup.renderEnding(titleText, text);
    }
    renderSaves(slots, onSave, onLoad) {
        this.savePanel.render(slots, onSave, onLoad);
    }
}
