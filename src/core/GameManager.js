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
        this.isNewGame = false;
        this.logs = [];
        this.logSeq = 0;
        this.logLimit = 200;
    }
    async init() {
        await this.eventEngine.loadAll();
        this.shopItems = await this.loadShopItems();
        this.restoreOrInit();
        this.scene = new MainScene(this.player, this.world, this.shopItems, () => this.resetGame());
        this.refreshSaves();
        this.scene.renderLog(this.logs);
        this.scene.renderTime();
        if (this.isNewGame) {
            this.scene.showIntro((payload) => {
                this.player.setIdentity(payload.name, payload.backgroundId, payload.backgroundName);
                this.player.setStats(payload.stats);
                this.player.applyDelta(payload.backgroundBonus);
                this.persistAutoSave();
                this.tick();
            });
            return;
        }
        this.tick();
    }
    restoreOrInit() {
        const saved = this.saveSystem.loadSlot("auto");
        if (saved) {
            this.applyLoaded(saved);
            this.isNewGame = false;
            return;
        }
        this.isNewGame = true;
    }
    resetGame() {
        this.saveSystem.clearAll();
        this.player.reset();
        this.world.reset();
        this.plan = null;
        this.isNewGame = true;
        this.logs = [];
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
        this.refreshSaves();
        this.scene?.showIntro((payload) => {
            this.player.setIdentity(payload.name, payload.backgroundId, payload.backgroundName);
            this.player.setStats(payload.stats);
            this.player.applyDelta(payload.backgroundBonus);
            this.persistAutoSave();
            this.tick();
        });
    }
    tick() {
        if (this.checkStageEnding()) {
            this.persistAutoSave();
            return;
        }
        const specialEvent = this.eventEngine.pickEvent(this.player, this.world, (event) => event.id !== this.monthlyEventId && !this.player.history.has(event.id));
        if (specialEvent) {
            const customEnabled = this.isCustomAllowed(specialEvent, true);
            const customHandler = customEnabled
                ? (input) => void this.applyCustomAction(specialEvent, input, {
                    consumeAp: false,
                    onComplete: () => this.showMonthlyPlan(),
                    forceOnce: true,
                })
                : undefined;
            this.scene?.showSpecialEvent(specialEvent, (opt) => this.applySpecialOption(specialEvent, opt), customHandler);
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
        const snapshot = this.snapshotState();
        const result = this.eventEngine.applyOption(event, optionId, this.player, this.world);
        this.recordLog(this.buildLogEntry(event, optionId, result.text, snapshot));
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
        const snapshot = this.snapshotState();
        const result = this.eventEngine.applyOption(event, optionId, this.player, this.world, {
            consumeAp: false,
        });
        this.player.history.add(event.id);
        this.recordLog(this.buildLogEntry(event, optionId, result.text, snapshot));
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
    isCustomAllowed(event, ignoreEventFlag = false) {
        if (!ignoreEventFlag && !event.allowCustom) {
            return false;
        }
        return this.isCustomAllowedBySettings();
    }
    isCustomAllowedBySettings() {
        const settings = loadAiSettings();
        return settings.enabled && settings.apiUrl.length > 0;
    }
    async applyCustomAction(event, input, options) {
        const trimmed = input.trim();
        if (!trimmed) {
            this.scene?.showResult("你一时语塞，不知如何是好。", () => this.tick());
            return;
        }
        const snapshot = this.snapshotState();
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            this.scene?.showResult("自定义判定尚未开启，无法继续。", () => this.tick());
            return;
        }
        const consumeAp = options?.consumeAp !== false;
        if (consumeAp && this.world.ap <= 0) {
            this.scene?.showResult("行动力不足，今日不宜强行。", () => this.tick());
            return;
        }
        this.scene?.showLoading("命运推演中...");
        try {
            const prompt = this.buildAdjudicatePrompt(event, trimmed);
            const headers = {
                "Content-Type": "application/json",
            };
            if (settings.apiKey) {
                headers.Authorization = `Bearer ${settings.apiKey}`;
            }
            const response = await fetch(settings.apiUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: prompt },
                        { role: "user", content: "请进行判定并输出严格 JSON。" },
                    ],
                    temperature: 0.4,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Bad response: ${response.status} ${errorText}`);
            }
            const raw = (await response.json());
            const content = raw.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error("Empty model response");
            }
            const data = this.parseAdjudicateResponse(content);
            if (data.stat_changes && typeof data.stat_changes === "object") {
                this.player.applyDelta(data.stat_changes);
            }
            if (event.once || options?.forceOnce) {
                this.player.history.add(event.id);
            }
            const endState = this.resolveCustomEnding(data.result_text, data.trigger_ending);
            if (endState) {
                this.recordLog(this.buildCustomLogEntry(event, trimmed, data.result_text, snapshot));
                this.scene?.showEnding(endState.type === "death" ? "身故" : "结算", endState.text);
                this.persistAutoSave();
                return;
            }
            this.applyCustomTurnEffects(data.stat_changes, consumeAp);
            this.recordLog(this.buildCustomLogEntry(event, trimmed, data.result_text, snapshot));
            const deltaText = this.formatStatDelta(data.stat_changes ?? undefined);
            const combined = deltaText ? `${data.result_text}\n${deltaText}` : data.result_text;
            const next = options?.onComplete ?? (() => this.tick());
            this.scene?.showResult(combined, next);
            this.persistAutoSave();
        }
        catch (error) {
            const next = options?.onComplete ?? (() => this.tick());
            this.scene?.showResult("一时语塞，你竟不知如何是好... (网络连接失败)", next);
        }
    }
    buildAdjudicatePrompt(event, input) {
        const options = event.options.map((opt) => `- ${opt.id}: ${opt.text}`).join("\n");
        return `# Role\n你是一个高难度古风生存游戏《通房丫头模拟器》的后台判定系统（GM）。\n风格：写实、压抑、等级森严、逻辑严密，拒绝爽文。\n\n# Context\n当前事件：${event.title}\n事件内容：${event.text}\n可选项：\n${options || "(无)"}\n玩家属性：${JSON.stringify(this.player.stats)}\nNPC关系：${JSON.stringify(this.player.npcRelations)}\n背包：${JSON.stringify(this.player.inventory)}\n回合信息：${JSON.stringify({ turn: this.world.turn, month: this.world.month, ap: this.world.ap })}\n\n# User Input\n${input}\n\n# Rules\n1) 不可无中生有，不可机械降神。\n2) 反抗/欺骗/暴力要结合心机与地位判定。\n3) 行为越出格，惩罚越重；合理且巧妙可小幅奖励。\n4) 用第二人称叙事，30-50字，古风白话。\n\n# Output (Strict JSON)\n只输出 JSON：\n{\n  \"result_text\": \"...\",\n  \"stat_changes\": { \"health\": -10, \"scheming\": 1 },\n  \"trigger_ending\": null | \"be_dead_poison\" | \"be_sold\"\n}`;
    }
    parseAdjudicateResponse(content) {
        const trimmed = content.trim();
        const jsonText = trimmed.startsWith("{") && trimmed.endsWith("}")
            ? trimmed
            : trimmed.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonText) {
            throw new Error("No JSON found in model output");
        }
        const parsed = JSON.parse(jsonText);
        if (!parsed.result_text) {
            throw new Error("Missing result_text");
        }
        return {
            result_text: parsed.result_text,
            stat_changes: parsed.stat_changes,
            trigger_ending: parsed.trigger_ending,
        };
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
    applyCustomTurnEffects(statChanges, consumeAp = true) {
        if (!consumeAp) {
            return;
        }
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
    snapshotState() {
        return {
            stats: { ...this.player.stats },
            npcRelations: { ...this.player.npcRelations },
            inventory: { ...this.player.inventory },
            world: {
                turn: this.world.turn,
                month: this.world.month,
                ap: this.world.ap,
                maxAp: this.world.maxAp,
                monthsWithoutFavor: this.world.monthsWithoutFavor,
            },
        };
    }
    buildLogEntry(event, optionId, resultText, snapshot) {
        const optionText = event.options.find((opt) => opt.id === optionId)?.text ?? "";
        return this.composeLogEntry(event.title, optionText, resultText, snapshot);
    }
    buildCustomLogEntry(event, input, resultText, snapshot) {
        return this.composeLogEntry(event.title, `自定应对：${input}`, resultText, snapshot);
    }
    composeLogEntry(eventTitle, optionText, resultText, snapshot) {
        const deltas = this.buildDeltas(snapshot);
        return {
            id: `${Date.now()}_${(this.logSeq += 1)}`,
            month: this.world.month,
            turn: this.world.turn,
            timestamp: this.world.getCurrentTimestamp(),
            eventTitle,
            optionText,
            resultText,
            delta: deltas.delta,
            worldDelta: deltas.worldDelta,
        };
    }
    buildDeltas(snapshot) {
        const delta = {};
        const statKeys = [
            "appearance",
            "scheming",
            "status",
            "network",
            "favor",
            "health",
            "cash",
        ];
        for (const key of statKeys) {
            const diff = (this.player.stats[key] ?? 0) - (snapshot.stats[key] ?? 0);
            if (Math.abs(diff) > 0.0001) {
                delta[key] = diff;
            }
        }
        const npcKeys = new Set([
            ...Object.keys(snapshot.npcRelations),
            ...Object.keys(this.player.npcRelations),
        ]);
        for (const key of npcKeys) {
            const diff = (this.player.npcRelations[key] ?? 0) - (snapshot.npcRelations[key] ?? 0);
            if (Math.abs(diff) > 0.0001) {
                delta[`npc_${key}`] = diff;
            }
        }
        const itemKeys = new Set([
            ...Object.keys(snapshot.inventory),
            ...Object.keys(this.player.inventory),
        ]);
        for (const key of itemKeys) {
            const diff = (this.player.inventory[key] ?? 0) - (snapshot.inventory[key] ?? 0);
            if (Math.abs(diff) > 0.0001) {
                delta[`item_${key}`] = diff;
            }
        }
        const worldDelta = {};
        const worldFields = ["turn", "month", "ap"];
        for (const key of worldFields) {
            const diff = (this.world[key] ?? 0) - (snapshot.world[key] ?? 0);
            if (Math.abs(diff) > 0.0001) {
                worldDelta[key] = diff;
            }
        }
        return {
            delta: Object.keys(delta).length ? delta : undefined,
            worldDelta: Object.keys(worldDelta).length ? worldDelta : undefined,
        };
    }
    recordLog(entry) {
        this.logs.push(entry);
        if (this.logs.length > this.logLimit) {
            this.logs.splice(0, this.logs.length - this.logLimit);
        }
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
    }
    async loadShopItems() {
        const response = await fetch("./data/shop.json");
        return (await response.json());
    }
    persistAutoSave() {
        this.saveSystem.saveAuto(this.player, this.world, this.logs);
        this.refreshSaves();
    }
    refreshSaves() {
        this.scene?.renderSaves(this.saveSystem.getSlots(), (slotId) => this.saveManual(slotId), (slotId) => this.loadManual(slotId));
    }
    saveManual(slotId) {
        this.saveSystem.saveSlot(slotId, this.player, this.world, this.logs);
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
        this.logs = (saved.logs ?? []).map((entry) => ({
            ...entry,
            timestamp: entry.timestamp ?? this.world.getCurrentTimestamp(),
        }));
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
    }
}
