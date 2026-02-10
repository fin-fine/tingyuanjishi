import { EventEngine } from "./EventEngine.js";
import { SaveSystem } from "./SaveSystem.js";
import { Player } from "../model/Player.js";
import { WorldState } from "../model/WorldState.js";
import { MainScene } from "../ui/MainScene.js";
import { loadAiSettings } from "./AiConfig.js";
export class GameManager {
    constructor() {
        this.eventEngine = new EventEngine();
        this.saveSystem = new SaveSystem();
        this.player = new Player();
        this.world = new WorldState();
        this.scene = null;
        this.shopItems = [];
        this.plan = null;
        this.monthlyEventId = "s1_1000";
    }
    async init() {
        await this.eventEngine.loadAll();
        this.shopItems = await this.loadShopItems();
        this.restoreOrInit();
        this.scene = new MainScene(this.player, this.world, this.shopItems);
        this.refreshSaves();
        this.tick();
    }
    restoreOrInit() {
        const saved = this.saveSystem.loadSlot("auto");
        if (saved) {
            this.applyLoaded(saved);
        }
    }
    tick() {
        if (this.checkStageEnding()) {
            this.persistAutoSave();
            return;
        }
        const specialEvent = this.eventEngine.pickEvent(this.player, this.world, (event) => event.id !== this.monthlyEventId && !this.player.history.has(event.id));
        if (specialEvent) {
            this.scene?.showSpecialEvent(specialEvent, (opt) => this.applySpecialOption(specialEvent, opt));
            return;
        }
        this.showMonthlyPlan();
    }
    showMonthlyPlan() {
        const event = this.eventEngine.findEventById(this.monthlyEventId);
        if (!event || !this.eventEngine.pickEvent(this.player, this.world, (entry) => entry.id === event.id)) {
            this.scene?.showEmpty("本回合暂无动静。");
            return;
        }
        const customEnabled = this.isCustomAllowed(event);
        const customHandler = customEnabled
            ? (input) => void this.applyCustomAction(event, input)
            : undefined;
        const planHandler = (optionIds) => this.applyPlan(event, optionIds);
        this.scene?.showEvent(event, (opt) => this.applyOption(event, opt), customHandler, planHandler);
    }
    checkStageEnding() {
        if (this.world.turn <= this.world.maxTurn) {
            return false;
        }
        const favorPass = this.player.stats.favor > 50;
        const matronPass = (this.player.npcRelations.matron ?? 0) > 60;
        if (favorPass || matronPass) {
            this.scene?.showEnding("结算", "你在侯府站稳脚跟，被准许继续留在少爷院中。下一阶段将由此展开。\n\n(当前版本到此为止)");
            return true;
        }
        this.scene?.showEnding("结算", "你未能稳住眷顾与印象。数日后被发卖出府，故事止于此。\n\n(当前版本到此为止)");
        return true;
    }
    applyOption(event, optionId, onContinue) {
        const result = this.eventEngine.applyOption(event, optionId, this.player, this.world);
        if (result.end) {
            this.plan = null;
            const titleText = result.end.type === "death" ? "身故" : "结算";
            this.scene?.showEnding(titleText, result.end.text);
            this.persistAutoSave();
            return;
        }
        const next = onContinue ?? (() => this.tick());
        this.scene?.showResult(result.text, next);
        this.persistAutoSave();
    }
    applySpecialOption(event, optionId) {
        const result = this.eventEngine.applyOption(event, optionId, this.player, this.world, {
            consumeAp: false,
        });
        this.player.history.add(event.id);
        if (result.end) {
            this.plan = null;
            const titleText = result.end.type === "death" ? "身故" : "结算";
            this.scene?.showEnding(titleText, result.end.text);
            this.persistAutoSave();
            return;
        }
        const deltaText = this.formatStatDelta(result.delta);
        const combined = deltaText ? `${result.text}\n${deltaText}` : result.text;
        this.scene?.showResult(combined, () => this.showMonthlyPlan());
        this.persistAutoSave();
    }
    formatStatDelta(delta) {
        if (!delta) {
            return "";
        }
        const labels = {
            appearance: "容貌",
            scheming: "心机",
            status: "名声",
            network: "人脉",
            favor: "宠爱",
            health: "健康",
            cash: "银钱",
        };
        const parts = [];
        for (const [key, label] of Object.entries(labels)) {
            const value = delta[key];
            if (!value) {
                continue;
            }
            const num = Number.isInteger(value) ? value.toString() : value.toFixed(1);
            const sign = value > 0 ? "+" : "";
            parts.push(`${label}${sign}${num}`);
        }
        return parts.length ? `（${parts.join("，")}）` : "";
    }
    applyPlan(event, optionIds) {
        this.plan = { event, month: this.world.month, queue: [...optionIds] };
        this.applyPlannedNext();
    }
    applyPlannedNext() {
        if (!this.plan) {
            this.tick();
            return;
        }
        if (this.world.month !== this.plan.month) {
            this.plan = null;
            this.tick();
            return;
        }
        const nextId = this.plan.queue.shift();
        if (!nextId) {
            this.plan = null;
            this.tick();
            return;
        }
        this.applyOption(this.plan.event, nextId, () => this.applyPlannedNext());
    }
    isCustomAllowed(event) {
        if (!event.allowCustom) {
            return false;
        }
        const settings = loadAiSettings();
        return settings.enabled && settings.apiUrl.length > 0;
    }
    async applyCustomAction(event, input) {
        const trimmed = input.trim();
        if (!trimmed) {
            this.scene?.showResult("你一时语塞，不知如何是好。", () => this.tick());
            return;
        }
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            this.scene?.showResult("自定义判定尚未开启，无法继续。", () => this.tick());
            return;
        }
        if (this.world.ap <= 0) {
            this.scene?.showResult("行动力不足，今日不宜强行。", () => this.tick());
            return;
        }
        this.scene?.showLoading("命运推演中...");
        try {
            const payload = {
                eventId: event.id,
                eventTitle: event.title,
                eventText: event.text,
                eventOptions: event.options.map((opt) => ({ id: opt.id, text: opt.text })),
                playerStats: this.player.stats,
                npcRelations: this.player.npcRelations,
                inventory: this.player.inventory,
                world: {
                    turn: this.world.turn,
                    month: this.world.month,
                    ap: this.world.ap,
                },
                input: trimmed,
            };
            const headers = {
                "Content-Type": "application/json",
            };
            if (settings.apiKey) {
                headers.Authorization = `Bearer ${settings.apiKey}`;
            }
            const response = await fetch(settings.apiUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                throw new Error(`Bad response: ${response.status}`);
            }
            const data = (await response.json());
            if (!data.result_text || typeof data.result_text !== "string") {
                throw new Error("Missing result_text");
            }
            if (data.stat_changes && typeof data.stat_changes === "object") {
                this.player.applyDelta(data.stat_changes);
            }
            if (event.once) {
                this.player.history.add(event.id);
            }
            const endState = this.resolveCustomEnding(data.result_text, data.trigger_ending);
            if (endState) {
                this.scene?.showEnding(endState.type === "death" ? "身故" : "结算", endState.text);
                this.persistAutoSave();
                return;
            }
            this.applyCustomTurnEffects(data.stat_changes);
            this.scene?.showResult(data.result_text, () => this.tick());
            this.persistAutoSave();
        }
        catch (error) {
            this.scene?.showResult("一时语塞，你竟不知如何是好... (网络连接失败)", () => this.tick());
        }
    }
    resolveCustomEnding(resultText, trigger) {
        if (trigger) {
            return { type: "death", text: resultText };
        }
        if (this.player.stats.health <= 0) {
            return { type: "death", text: "你病势已重，撑不过这一夜。" };
        }
        return null;
    }
    applyCustomTurnEffects(statChanges) {
        const advanced = this.world.spendAp(1);
        const favorGain = (statChanges?.favor ?? 0) > 0;
        if (favorGain) {
            this.world.monthsWithoutFavor = 0;
        }
        else if (advanced) {
            this.world.monthsWithoutFavor += 1;
            if (this.world.monthsWithoutFavor >= 3) {
                this.player.stats.favor -= 5;
            }
            this.player.stats.appearance -= 0.5;
        }
    }
    async loadShopItems() {
        const response = await fetch("./data/shop.json");
        return (await response.json());
    }
    persistAutoSave() {
        this.saveSystem.saveAuto(this.player, this.world);
        this.refreshSaves();
    }
    refreshSaves() {
        this.scene?.renderSaves(this.saveSystem.getSlots(), (slotId) => this.saveManual(slotId), (slotId) => this.loadManual(slotId));
    }
    saveManual(slotId) {
        this.saveSystem.saveSlot(slotId, this.player, this.world);
        this.refreshSaves();
        this.scene?.showResult("已写入存档。", () => this.tick());
    }
    loadManual(slotId) {
        const saved = this.saveSystem.loadSlot(slotId);
        if (!saved) {
            this.scene?.showResult("此档为空。", () => this.tick());
            return;
        }
        this.applyLoaded(saved);
        this.refreshSaves();
        this.scene?.showResult("已读取存档。", () => this.tick());
    }
    applyLoaded(saved) {
        this.player.load(saved.player);
        this.world.load(saved.world);
        this.plan = null;
    }
}
