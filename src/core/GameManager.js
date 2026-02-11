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
        this.isNewGame = false;
        this.logs = [];
        this.logSeq = 0;
        this.logLimit = 200;
        this.lastQuarterStats = null;
    }
    // 数字转中文
    numberToChinese(num) {
        const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        const units = ['', '十', '百', '千'];
        if (num === 0)
            return '零';
        if (num < 10)
            return digits[num];
        if (num < 20)
            return num === 10 ? '十' : '十' + digits[num % 10];
        if (num < 100) {
            const tens = Math.floor(num / 10);
            const ones = num % 10;
            return digits[tens] + '十' + (ones === 0 ? '' : digits[ones]);
        }
        let result = '';
        let unitIndex = 0;
        let needZero = false;
        while (num > 0) {
            const digit = num % 10;
            if (digit === 0) {
                if (needZero && result && result[0] !== '零') {
                    result = '零' + result;
                }
                needZero = true;
            }
            else {
                result = digits[digit] + units[unitIndex] + result;
                needZero = false;
            }
            num = Math.floor(num / 10);
            unitIndex++;
        }
        return result;
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
                void this.onCharacterCreated(payload);
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
        this.lastQuarterStats = null;
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
        this.refreshSaves();
        this.scene?.showIntro((payload) => {
            void this.onCharacterCreated(payload);
        });
    }
    tick() {
        if (this.checkStageEnding()) {
            this.persistAutoSave();
            return;
        }
        // 检查是否需要显示季度总结
        if (this.shouldShowQuarterSummary()) {
            this.showQuarterSummary();
            return;
        }
        const stagePrefix = this.world.stage <= 1 ? "s1_" : "s2_";
        const monthlyEventId = this.getMonthlyEventId();
        const specialEvent = this.eventEngine.pickEvent(this.player, this.world, (event) => event.id.startsWith(stagePrefix) &&
            event.id !== monthlyEventId &&
            !this.player.history.has(event.id));
        if (specialEvent) {
            // 特殊处理：第一夜事件，如果AI启用，先生成少爷对姓名的评价
            if (specialEvent.id === "s1_0001" && this.isCustomAllowedBySettings()) {
                void this.showFirstNightWithNameComment(specialEvent);
                return;
            }
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
        const monthlyEventId = this.getMonthlyEventId();
        const event = this.eventEngine.findEventById(monthlyEventId);
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
    /**
     * 角色创建完成后的处理
     */
    async onCharacterCreated(payload) {
        // 设置玩家身份和属性
        this.player.setIdentity(payload.name, payload.backgroundId, payload.backgroundName);
        this.player.setStats(payload.stats);
        this.player.applyDelta(payload.backgroundBonus);
        // 保存初始快照用于第一次季度总结
        this.lastQuarterStats = {
            turn: 1,
            stats: { ...this.player.stats },
            npcRelations: { ...this.player.npcRelations },
        };
        // 如果AI启用，生成并显示角色背景故事
        if (this.isCustomAllowedBySettings()) {
            this.scene?.showLoading("生成角色背景故事...");
            try {
                const backgroundStory = await this.generateBackgroundStory(payload);
                this.scene?.showResult(backgroundStory, () => {
                    this.persistAutoSave();
                    this.tick();
                });
            }
            catch (error) {
                // AI失败，直接开始游戏
                this.persistAutoSave();
                this.tick();
            }
        }
        else {
            // AI未启用，直接开始游戏
            this.persistAutoSave();
            this.tick();
        }
    }
    /**
     * 调用AI生成角色背景故事
     */
    async generateBackgroundStory(payload) {
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            throw new Error("AI not enabled");
        }
        // 计算最终属性（基础+加成）
        const finalStats = { ...payload.stats };
        for (const [key, value] of Object.entries(payload.backgroundBonus)) {
            if (key in finalStats) {
                finalStats[key] = (finalStats[key] ?? 0) + value;
            }
        }
        // 找到最高和最低的属性
        const statEntries = Object.entries(finalStats).map(([key, value]) => ({
            key: key,
            label: this.getStatLabel(key),
            value,
        }));
        statEntries.sort((a, b) => b.value - a.value);
        const topStats = statEntries.slice(0, 2);
        const bottomStats = statEntries.slice(-2);
        const prompt = `# Role
你是一个高难度古风生存游戏《通房丫头模拟器》的角色背景故事生成系统。

# Context
游戏背景：大雍景和十二年三月初一，侯府。女主角被指给侯府独子谢云峥（十八岁）做通房丫头。

# Character Info
- 姓名：${payload.name}
- 出身：${payload.backgroundName}
- 属性特点：
  最强属性：${topStats[0].label}(${topStats[0].value})、${topStats[1].label}(${topStats[1].value})
  最弱属性：${bottomStats[0].label}(${bottomStats[0].value})、${bottomStats[1].label}(${bottomStats[1].value})

# Task
生成一段角色背景故事，要求：
一、一百五十至两百字，古风白话文
二、必须清楚描述三个阶段：
   - 出身背景和原本生活
   - 如何/为何进入侯府成为丫鬟（卖身、抵债、家族安排等）
   - 如何/为何被选中成为少爷的通房丫头（容貌、才艺、机缘、或被迫等）
三、结合姓名、出身和属性特点编织合理的身世
四、解释属性分布的原因（如：书香门第所以心机高，家道中落所以银钱少）
五、以第二人称"你"叙述，语气压抑写实
六、突出"身不由己"的命运感和"高难度生存"的基调

# Output
只输出故事文本，不要任何额外内容。

示例一：
你名唤清月，原是城南书香门第的遗孤。父亲是个落魄秀才，教你识字读书，你也因此多了几分心机。可惜天不遂人愿，父亲骤然病逝，家中欠下巨债。你母亲无奈之下将你卖入侯府为婢，好歹还了债，自己也有口饭吃。你进府时不过十三岁，因懂些规矩被分到二等丫鬟。你容貌平平，身子也弱，但胜在机灵，这些年小心伺候，总算在院里站稳了脚。前些日子赵嬷嬷相中你本分听话，又识字会算账，便把你指给了少爷做通房。你知道这是天大的造化，可稍有差池便是万劫不复。

示例二：
你本是府中管事的女儿，自幼在府里长大，容貌出挑，举止得体。你爹原本想给你寻个好亲事，不料你十五岁那年他卷入了库房失窃案，全家都受了牵连。你爹被革职发卖，你和母亲则被贬为奴籍，充作府中粗使丫鬟。这一变故让你学会了察言观色、处处留心，却也落下了病根，身子一日不如一日。你美貌未褪，有心人便动了心思，托赵嬷嬷做主，将你抬举成了少爷的通房。你表面感恩戴德，心里却清楚，这既是脱离苦海的机会，更是另一个深渊的开始。`;
        try {
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
                        { role: "user", content: "请生成角色背景故事。" },
                    ],
                    temperature: 0.8,
                }),
            });
            if (!response.ok) {
                throw new Error(`Bad response: ${response.status}`);
            }
            const raw = (await response.json());
            const content = raw.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error("Empty model response");
            }
            return `═══\n身世\n═══\n\n${content.trim()}`;
        }
        catch (error) {
            console.error("Failed to generate background story:", error);
            throw error;
        }
    }
    getStatLabel(key) {
        const labels = {
            appearance: "容貌",
            scheming: "心机",
            status: "名声",
            network: "人脉",
            favor: "宠爱",
            health: "健康",
            cash: "银钱",
        };
        return labels[key];
    }
    /**
     * 显示第一夜事件，并加入AI生成的少爷对姓名的评价
     */
    async showFirstNightWithNameComment(event) {
        this.scene?.showLoading("命运推演中...");
        try {
            const nameComment = await this.generateNameComment(this.player.name);
            // 将评价插入到事件文本中
            // 在"第一次抬眼见他"之后插入少爷的评价
            const originalText = event.text;
            const insertPoint = originalText.indexOf("晚膳时少爷只淡淡看了你一眼");
            let enhancedText;
            if (insertPoint > 0) {
                // 在"晚膳时"之前插入评价
                enhancedText =
                    originalText.substring(0, insertPoint) +
                        nameComment +
                        originalText.substring(insertPoint);
            }
            else {
                // 如果找不到插入点，就追加在最后
                enhancedText = originalText + nameComment;
            }
            // 创建增强版事件对象
            const enhancedEvent = {
                ...event,
                text: enhancedText,
            };
            const customEnabled = this.isCustomAllowed(enhancedEvent, true);
            const customHandler = customEnabled
                ? (input) => void this.applyCustomAction(enhancedEvent, input, {
                    consumeAp: false,
                    onComplete: () => this.showMonthlyPlan(),
                    forceOnce: true,
                })
                : undefined;
            this.scene?.showSpecialEvent(enhancedEvent, (opt) => this.applySpecialOption(event, opt), customHandler);
        }
        catch (error) {
            // AI调用失败，显示原始事件
            const customEnabled = this.isCustomAllowed(event, true);
            const customHandler = customEnabled
                ? (input) => void this.applyCustomAction(event, input, {
                    consumeAp: false,
                    onComplete: () => this.showMonthlyPlan(),
                    forceOnce: true,
                })
                : undefined;
            this.scene?.showSpecialEvent(event, (opt) => this.applySpecialOption(event, opt), customHandler);
        }
    }
    /**
     * 调用AI生成少爷对玩家姓名的评价
     */
    async generateNameComment(playerName) {
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            return "";
        }
        const prompt = `# Role
你是一个高难度古风生存游戏《通房丫头模拟器》的剧情生成系统。

# Context
场景：大雍景和十二年三月初一，侯府。
人物：谢云峥，侯府独子，十八岁，世家公子，眉目清朗，温文尔雅但带着距离感。
情境：赵嬷嬷刚刚将府中一个丫鬟指给他做通房，这个丫鬟名叫"${playerName}"。这是他第一次听说这个名字，对这个人还一无所知。

# Task
请生成谢云峥第一次听到这个名字时的简短评价或反应。要求：
一、符合古风世家公子的身份和气质
二、语气克制、有教养，但带着与生俱来的距离感和淡漠
三、可以从名字的字面意思、音韵、寓意等角度进行评价
四、十五至三十字，简短精炼
五、以第三人称叙述，描述他说了什么或做了什么反应
六、体现他对此事的态度（淡然接受/漫不经心/略有兴趣等）

# Output
只输出一句话，不要任何其他内容。格式如下：
他听到这个名字，[评价/反应]。

例如：
- 他听到这个名字，淡淡道："倒是雅致。"
- 他听到这个名字，微微颔首，并未多言。
- 他听到这个名字，目光停顿片刻："这名字，有些意思。"
- 他听到这个名字，眉梢微挑，随即恢复如常："嬷嬷安排便是。"`;
        try {
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
                        { role: "user", content: "请生成评价。" },
                    ],
                    temperature: 0.7,
                }),
            });
            if (!response.ok) {
                throw new Error(`Bad response: ${response.status}`);
            }
            const raw = (await response.json());
            const content = raw.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error("Empty model response");
            }
            return content.trim();
        }
        catch (error) {
            console.error("Failed to generate name comment:", error);
            return "";
        }
    }
    checkStageEnding() {
        if (this.world.turn <= this.world.maxTurn) {
            return false;
        }
        if (this.world.stage <= 1) {
            const favorPass = this.player.stats.favor > 50;
            const matronPass = (this.player.npcRelations.matron ?? 0) > 60;
            if (favorPass || matronPass) {
                this.world.stage = 2;
                this.world.maxTurn = 120;
                // 过渡事件s1_final已在turn 22触发，此处直接进入第二阶段
                this.tick();
                return true;
            }
            this.scene?.showEnding("结算", "你未能稳住眷顾与印象。数日后被发卖出府，故事止于此。");
            return true;
        }
        this.scene?.showEnding("结算", "本阶段已至尽头，你的故事暂告一段落。");
        return true;
    }
    getMonthlyEventId() {
        return this.world.stage <= 1 ? "s1_1000" : "s2_1000";
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
        this.plan = { event, startTurn: this.world.turn, queue: [...optionIds] };
        this.applyPlannedNext();
    }
    applyPlannedNext() {
        if (!this.plan) {
            this.tick();
            return;
        }
        // 允许计划在开始的turn及下一个turn内执行
        // 这样即使AP耗尽进入下一回合，计划仍能继续
        const turnDiff = this.world.turn - this.plan.startTurn;
        if (turnDiff > 1) {
            // 如果跨越超过1个turn，清空计划
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
        this.saveSystem.saveAuto(this.player, this.world, this.logs, { lastQuarterStats: this.lastQuarterStats });
        this.refreshSaves();
    }
    refreshSaves() {
        this.scene?.renderSaves(this.saveSystem.getSlots(), (slotId) => this.saveManual(slotId), (slotId) => this.loadManual(slotId));
    }
    saveManual(slotId) {
        this.saveSystem.saveSlot(slotId, this.player, this.world, this.logs, { lastQuarterStats: this.lastQuarterStats });
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
        // 加载季度快照数据
        const savedWithExtra = saved;
        this.lastQuarterStats = savedWithExtra.lastQuarterStats ?? null;
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
    }
    shouldShowQuarterSummary() {
        // 每3个turn显示一次季度总结（跳过turn 1）
        return this.world.turn > 1 && this.world.turn % 3 === 1;
    }
    showQuarterSummary() {
        const summaryText = this.generateQuarterSummary();
        this.scene?.showResult(summaryText, () => {
            // 更新季度快照
            this.lastQuarterStats = {
                turn: this.world.turn,
                stats: { ...this.player.stats },
                npcRelations: { ...this.player.npcRelations },
            };
            this.persistAutoSave();
            // 直接显示月度事件，跳过tick()中的重复检查
            this.showMonthlyPlan();
        });
    }
    generateQuarterSummary() {
        const season = this.getSeasonName();
        // 计算年份：从景和十二年三月（turn 1）开始
        const monthsPassed = (this.world.turn - 1) + 2; // turn 1是三月，所以+2
        const yearNum = 12 + Math.floor(monthsPassed / 12);
        const year = this.numberToChinese(yearNum);
        const title = `═══\n景和${year}年${season}\n府中杂记\n═══\n\n`;
        let content = "";
        // 府内动态
        content += this.generateMansionNews();
        content += "\n\n";
        // 个人变化（如果有上一季度的数据）
        if (this.lastQuarterStats) {
            content += this.generatePersonalChanges();
        }
        else {
            content += "你初入侯府，一切还在摸索之中。";
        }
        return title + content;
    }
    getSeasonName() {
        const month = this.world.month;
        if (month >= 3 && month <= 5)
            return "春";
        if (month >= 6 && month <= 8)
            return "夏";
        if (month >= 9 && month <= 11)
            return "秋";
        return "冬";
    }
    generateMansionNews() {
        const stage = this.world.stage;
        const turn = this.world.turn;
        const favor = this.player.stats.favor;
        const matronRelation = this.player.npcRelations.matron ?? 0;
        let news = "府中近况：\n\n";
        if (stage === 1) {
            // 第一阶段：赵嬷嬷掌权
            if (turn <= 6) {
                news += "赵嬷嬷依旧掌管院中大小事务，上至主子的衣食起居，下至丫鬟婆子的排班当差，事无巨细都要经她点头。她虽年纪大了，但眼神极利，哪怕是芝麻点大的事都逃不过她的眼睛。";
            }
            else if (turn <= 12) {
                news += "院中渐渐传出风声，说侯爷升迁在即，府里怕是要有变动。丫鬟们私下里猜测，侯府地位若再提升，少爷就得娶正妻了。一时间人人心思浮动，都在盘算着自己的前程。";
            }
            else if (turn <= 18) {
                news += "外头消息越传越盛，都说少爷要娶亲了，主母人选已在商议。听说是世家千金，知书达理，持家有方。府里上下都在暗暗准备，赵嬷嬷更是忙得脚不沾地，要把院子里里外外都收拾得妥妥当当。";
            }
            else {
                news += "府里上下都在为迎接新主母做准备。正院重新装修，添置了不少新物件。各房丫鬟都开始暗暗较劲，都想在新主母面前露个脸、得个好印象。院里的气氛紧张又期待，人人都知道，新的格局就要开始了。";
            }
        }
        else {
            // 第二阶段：主母入府后
            if (turn <= 30) {
                news += "主母进门后雷厉风行地重立规矩，院中气氛比从前严肃许多。她定下了新的当差规矩、赏罚章程，还专门查了一遍账目。有几个手脚不干净的婆子被当场辞退，一时间人人自危，做事都格外小心。";
            }
            else if (turn <= 50) {
                news += "主母逐渐接手家务，赵嬷嬷虽仍管事，却处处要看主母脸色。府里的权力悄悄转移，聪明人都已经开始向主母靠拢。原本依仗着赵嬷嬷威风的几个管事，如今也都低调了许多。";
            }
            else {
                news += "府中格局已定，主母持家有方，赏罚分明。她不仅把内宅管得井井有条，还时常协助侯爷处理外务。如今府里上下，无不服她。就连赵嬷嬷提起主母，都是满口赞誉。";
            }
        }
        // 根据玩家地位添加相关消息
        if (favor >= 80) {
            news += "院里人都看得出，少爷对你宠爱有加。你走到哪儿，哪儿就有人用艳羡的眼神看着你。有些丫鬟甚至开始巴结你，想借你的门路在少爷面前说上话。";
        }
        else if (favor >= 70) {
            news += "院里人都清楚，少爷对你颇为看重。你在府中的地位水涨船高，说话也比从前有分量了。";
        }
        else if (favor >= 50) {
            news += "你在少爷身边也算站稳了脚跟，虽说还谈不上多受宠，但至少有了一席之地。";
        }
        else if (favor <= 20) {
            news += "你在院中存在感寥寥，像个可有可无的影子。有时走在路上，旁人都不会注意到你。";
        }
        else if (favor <= 35) {
            news += "你在少爷跟前并不怎么得脸，日子过得平淡如水。";
        }
        // 根据主母/赵嬷嬷关系添加消息
        if (stage === 1 && matronRelation >= 70) {
            news += "赵嬷嬷待你极好，府里人都知道你是她的心头肉，连少爷都要给你几分面子。";
        }
        else if (stage === 2 && matronRelation >= 70) {
            news += "主母待你格外信任，许多要紧的事都交给你办。府里人私下都说，你是主母的心腹。";
        }
        return news;
    }
    generatePersonalChanges() {
        if (!this.lastQuarterStats)
            return "";
        const changes = [];
        changes.push("你的变化：\n\n");
        // 容貌变化（通过他人描述）
        const appearanceDiff = this.player.stats.appearance - this.lastQuarterStats.stats.appearance;
        const currentAppearance = this.player.stats.appearance;
        if (Math.abs(appearanceDiff) >= 2) {
            if (appearanceDiff > 0) {
                // 容貌提升
                const descriptions = [];
                if (appearanceDiff >= 12) {
                    descriptions.push("近来府里悄悄传着闲话，说你'脱胎换骨'一般。小厨房的婆子见你来取东西，惊得手里的勺子都险些掉了：'姑娘，您这是……这些日子可是遇着什么喜事了？瞧这水色儿，都快赛过画里的人了。这腰肢也盈盈一握，走起路来飘飘然的，真真是个美人胚子。'连一向眼高的管事妈妈路过时，都忍不住多看了你两眼，还暗暗点头。");
                }
                else if (appearanceDiff >= 8) {
                    descriptions.push("这些日子你往院里一站，总能感觉到旁人的目光。洗衣房的丫头们聚在一处嘀咕，看见你来便住了嘴，脸上带着几分艳羡。赵嬷嬷上下打量你好一会儿，才啧啧称奇：'姑娘这气色，倒真是养出来了。眉眼间都透着股子精神气儿，身段也匀称了，瞧着顺眼得很。'");
                }
                else if (appearanceDiff >= 5) {
                    descriptions.push("路过花园时，听见两个小丫鬟私语，一个说：'你瞧她最近是不是俊俏了些？'另一个点头道：'可不是，脸色红润了，气色也好了，身子也不似从前那般单薄，连走路的姿态都挺拔了几分，颇有些风姿。'你装作没听见，心里却暗暗有些欣慰。");
                }
                else if (appearanceDiff >= 3) {
                    descriptions.push("对镜梳妆时，你发现自己确实不同了。肤色比从前白净了些，眼角的倦色也褪了不少，整个人看起来精神了许多。就连少爷的书童见了你，都愣了一瞬，才笑着让了路。");
                }
                else {
                    descriptions.push("照镜子时发现自己脸色红润了些，不似先前那般憔悴。虽说变化不大，但到底是往好处去了。");
                }
                // 根据当前容貌绝对值添加额外描述
                if (currentAppearance >= 85) {
                    descriptions.push("如今的你，已是府中数一数二的人物。肤如凝脂，眉目如画，身段窈窕有致，举手投足间都带着说不出的韵味。院里但凡有外客来访，都会不经意地多看你几眼。你走到哪里，哪里的气氛就会微妙地静一静，继而响起窃窃私语。");
                }
                else if (currentAppearance >= 70) {
                    descriptions.push("你的容貌已经颇为出挑，在府中称得上上等姿色。五官精致、体态轻盈，往人堆里一站便能让人眼前一亮。偶尔出门办事，迎面而来的人都会侧目多看几眼。");
                }
                else if (currentAppearance >= 55) {
                    descriptions.push("你如今也算得上清秀可人，在众丫鬟里不算拔尖，但也绝不会被忽视。");
                }
                changes.push(descriptions.join(""));
            }
            else {
                // 容貌下降
                const descriptions = [];
                if (appearanceDiff <= -12) {
                    descriptions.push("府里人见了你，眼神都带着三分惊讶七分关切。赵嬷嬷把你叫到跟前，上下仔细打量，眉头皱得紧紧的：'你这是怎么了？人都瘦脱了相，脸色蜡黄得吓人，眼窝子都陷下去了。这身子骨都快撑不起衣裳了，风一吹怕是要倒。这样下去可使不得，赶紧找大夫瞧瞧。'连平日里不怎么理你的丫鬟们，都忍不住在背后议论你的憔悴模样。");
                }
                else if (appearanceDiff <= -8) {
                    descriptions.push("铜镜里的自己让你自己都吃了一惊。脸颊瘦削了一圈，眼下浮着青影，嘴唇也失了血色，整个人瘦得只剩一把骨头，肩膀也塌了下去。翠儿看见你的模样，心疼地拉着你的手：'姑娘，您这是日夜操劳坏了身子啊。您瞧这脸色，连胭脂都遮不住那份憔悴，人也瘦得不成样子了。'");
                }
                else if (appearanceDiff <= -5) {
                    descriptions.push("对镜时发现自己确实憔悴了不少。气色不比从前，眉宇间也多了几分疲态，整个人都显得萎靡不振，身形也消瘦了些。洗衣房的婆子见了你，还关切地问了句：'姑娘近来可是不太舒坦？瞧着有些病容，人也瘦了一圈。'");
                }
                else if (appearanceDiff <= -3) {
                    descriptions.push("铜镜里的自己似乎憔悴了几分，脸色也不如从前那般有光彩。虽说旁人不一定看得出来，但自己心里清楚，这段时日过得太辛苦了些。");
                }
                else {
                    descriptions.push("气色不如从前了，照镜子时能看出几分倦色。");
                }
                // 根据当前容貌绝对值添加额外描述
                if (currentAppearance <= 30) {
                    descriptions.push("如今的你面容憔悴、身形单薄，在人群里毫不起眼。有时路过，别人甚至不会多看一眼，仿佛你只是个影子。走路都有些佝偻，完全没了年轻姑娘该有的朝气。");
                }
                else if (currentAppearance <= 45) {
                    descriptions.push("你的容貌在府中只能算平平，不上不下，既无人夸赞，也无人嫌弃。");
                }
                else if (currentAppearance <= 60) {
                    descriptions.push("虽说不复从前的精神，但你的底子还在，稍加调养便能恢复。");
                }
                changes.push(descriptions.join(""));
            }
        }
        else if (currentAppearance >= 80) {
            // 即使变化不大，如果当前容貌很高，也要提及
            changes.push("你依然是府中的佳人，肤白貌美、身材窈窕，走到哪儿都是目光的焦点。那份姿色和风姿，是旁人羡慕不来的。");
        }
        else if (currentAppearance <= 35) {
            // 即使变化不大，如果当前容貌很低，也要提及
            changes.push("你的容貌依旧平平，在府中并不起眼。或许该想些法子好好打理打理自己了。");
        }
        // 心机变化（通过内心感受）
        const schemingDiff = this.player.stats.scheming - this.lastQuarterStats.stats.scheming;
        if (Math.abs(schemingDiff) >= 3) {
            if (schemingDiff > 0) {
                if (schemingDiff >= 10) {
                    changes.push("这些时日的磨砺让你脱胎换骨。你发现自己看人看事越发透彻，府里那些明争暗斗的把戏，如今一眼便能瞧破七八分。每次听人说话，你都能从字里行间、眉眼神色中品出些别的意思来。甚至有时候，你都能提前料到某些事的走向。这份心机，是用多少辛酸换来的。");
                }
                else if (schemingDiff >= 7) {
                    changes.push("你明显感觉到自己变得机敏了。遇事不再慌乱，而是能沉着应对。说话做事都多了几分盘算，知道什么该说、什么该藏、什么该做、什么该避。府里那些个明里暗里的规矩，你也渐渐摸得门儿清了。");
                }
                else if (schemingDiff >= 5) {
                    changes.push("这些时日经历的事让你开了窍，不再像从前那样懵懂。你学会了察言观色，学会了见人说人话、见鬼说鬼话，也学会了在必要时隐藏自己的真实想法。");
                }
                else {
                    changes.push("你心里比从前多了些计较。遇事不再只凭本心，而是会先掂量掂量利弊，想清楚了再动。虽说这样活得累些，但在这深宅大院里，却是必须的本事。");
                }
            }
            else {
                changes.push("或许是日子过得太安稳，那股子机灵劲儿似乎钝了些。遇事也不似从前那般警醒，倒多了几分松懈。");
            }
        }
        // 名声变化（通过府中态度）
        const statusDiff = this.player.stats.status - this.lastQuarterStats.stats.status;
        if (Math.abs(statusDiff) >= 3) {
            if (statusDiff > 0) {
                if (statusDiff >= 10) {
                    changes.push("府里上下对你的态度发生了是觉的转变。走到哪儿都有人恒敬地闪开路，连老嬷嬷们见了你都要和颜悦色地寄上几句。二门上的婆子说，外面都传开了，说你是侯府的体面人。");
                }
                else if (statusDiff >= 7) {
                    changes.push("你在府中的地位明显提升。下人们对你恭敬了许多，说话办事都带着几分小心。甚至有人开始主动向你示好，想要结个善缘。");
                }
                else if (statusDiff >= 5) {
                    changes.push("你在府里总算有了些体面。以前那些看不起你的人，如今也不敢随意轻慢了。");
                }
                else {
                    changes.push("你在院里的地位稳了些，不再是那个人人可以轻慢的新人。走路时也能挺直了腰板。");
                }
            }
            else {
                if (statusDiff <= -8) {
                    changes.push("你的名声受损严重。背后不知传了些什么难听的话，走在路上总能听到窃窃私语。以前对你客气的人，如今连正眼都不给了。");
                }
                else if (statusDiff <= -5) {
                    changes.push("最近总觉得府里人看你的眼神不太对，有人在背后指指点点。你心里清楚，这不是好兆头。");
                }
                else {
                    changes.push("你在府里的声名似乎受了些影响，下人们对你也没从前那般恕意了。");
                }
            }
        }
        // 人脉变化（通过关系网）
        const networkDiff = this.player.stats.network - this.lastQuarterStats.stats.network;
        if (Math.abs(networkDiff) >= 3) {
            if (networkDiff > 0) {
                if (networkDiff >= 10) {
                    changes.push("你在府里的人脉广了。内外各处都有你熟识的人，不论是内宅的老嬷嬷、二门上的管事，还是外面跟车的家人，都能同你说上几句知心话。有了这张关系网，办事顺当了许多。");
                }
                else if (networkDiff >= 7) {
                    changes.push("你用心经营人脉，收获颇丰。府里各处都有了熟人，需要打听个消息、办个小事，都有人愿意帮衬。");
                }
                else if (networkDiff >= 5) {
                    changes.push("这段时间你有意结交，府里总算有了几个能说得上话、帮得上忙的人。");
                }
                else {
                    changes.push("你渐渐在府里建立起自己的人脉，虽然还不成气候，但总算是个开始。");
                }
            }
            else {
                if (networkDiff <= -5) {
                    changes.push("许久未曾走动，从前的人情关系大多淡了。有些以前帮过你的人，如今见了面也只是淡淡点头，不再像从前那般热络。");
                }
                else {
                    changes.push("许久未曾走动，从前的一些人情似乎淡了。人脉这种东西，不经营就会淡。");
                }
            }
        }
        // 宠爱变化（通过少爷态度）
        const favorDiff = this.player.stats.favor - this.lastQuarterStats.stats.favor;
        if (Math.abs(favorDiff) >= 5) {
            if (favorDiff > 0) {
                if (favorDiff >= 18) {
                    changes.push("少爷对你的态度发生了明显的转变。他不仅会主动同你说话，还会在晚间留你陪着用茶、读书。有时他看你的眼神，带着几分依赖和柔情。这份眷顾，让院里人都侧目，也让你心中有了几分底气。");
                }
                else if (favorDiff >= 12) {
                    changes.push("少爷对你越发亲近。他会主动同你说些体己话，偶尔还会关心你的起居饮食。有一回你病了，他竟亲自差人去请大夫，这份心意让你感激不尽。");
                }
                else if (favorDiff >= 8) {
                    changes.push("少爷待你温和了许多，常常会问你几句寒暖，偶尔还会赏你些小玩意。这份关照虽轻，却让你心中有底。");
                }
                else {
                    changes.push("少爷对你的态度比从前缓和了些。虽然还谈不上亲近，但至少不再是那般疯生了。");
                }
            }
            else {
                if (favorDiff <= -15) {
                    changes.push("少爷这些日子对你冷淡得可怕。不仅很少叫你，即使叫了也是一副不耐烦的模样。有一回你不小心打翻了茶杯，他竟当场翻脸把你驱出了房间。你心里清楚，这么下去怕是不妙。");
                }
                else if (favorDiff <= -10) {
                    changes.push("少爷这些日子对你冷淡了许多，很少主动叫你，即使你在屋里伺候也很少正眼看你。你心里清楚，这不是好兆头。");
                }
                else {
                    changes.push("少爷似乎没从前那般在意你了。他叫你的次数少了，语气也淡了几分。");
                }
            }
        }
        // 健康变化（通过身体感受）
        const healthDiff = this.player.stats.health - this.lastQuarterStats.stats.health;
        if (Math.abs(healthDiff) >= 5) {
            if (healthDiff > 0) {
                if (healthDiff >= 15) {
                    changes.push("身子骨比从前健康多了。以前总是觉得累，现在干起活来都有使不完的力气。睡眠也好了，胃口也开了，整个人精神头儿足，连走路都带风。");
                }
                else if (healthDiff >= 10) {
                    changes.push("身体硬朗了许多。以前动不动就病歇，现在却很少不舒服。精神好了，做事也利落多了。");
                }
                else {
                    changes.push("调养得当，身体好了不少。以前那些小病痛都少了，人也有精神了。");
                }
            }
            else {
                if (healthDiff <= -20) {
                    changes.push("你的身体差到了极点。几乎每天都觉得头晕目眩，半夜咐嗽不止。有时连站着都觉得费力，必须扶着墙才能走路。赵嬷嬷看了都发急，说再不治怕是要出人命。");
                }
                else if (healthDiff <= -15) {
                    changes.push("你时常觉得乏累，半夜还会咐嗽。身子一日不如一日，有时干活干到一半就得停下来喘气。再这样下去怕是要病倒。");
                }
                else if (healthDiff <= -10) {
                    changes.push("近来总觉得疲倦，身子不太利落。干点活就觉得累，晚上也睡不实际。得想法子好好调养调养。");
                }
                else {
                    changes.push("身体似乎不如从前了，总是觉得没什么精神。");
                }
            }
        }
        // 主母关系变化
        const matronDiff = (this.player.npcRelations.matron ?? 0) - (this.lastQuarterStats.npcRelations.matron ?? 0);
        if (Math.abs(matronDiff) >= 5) {
            if (matronDiff > 0) {
                if (this.world.stage === 1) {
                    if (matronDiff >= 20) {
                        changes.push("赵嬷嬷对你简直视如己出。她不仅时常指点你府里的规矩门道，还主动在大夫人面前为你美言。有一回你犯了小错，她竟护着你，把责任揽到了自己身上。这份恩情，你记在心里。");
                    }
                    else if (matronDiff >= 15) {
                        changes.push("赵嬷嬷对你明显上了心。她会特意叫你去她房里，教你些处世的道理，还时不时塞给你些吃食。府里人都看出来了，你是赵嬷嬷跟前的红人。");
                    }
                    else if (matronDiff >= 10) {
                        changes.push("赵嬷嬷对你和颜悦色了不少。她见你做事妥帖，偶尔还会夸你几句。看来你这些日子的表现让她满意。");
                    }
                    else {
                        changes.push("你和赵嬷嬷的关系近了些。她看你的眼神不再那么挑剔，说话时也多了几分柔和。");
                    }
                }
                else {
                    if (matronDiff >= 20) {
                        changes.push("主母对你格外看重，几乎把你当作心腹。她不仅常常单独叫你去说话，还会让你帮忙处理些重要的事。府里都传言，你是主母的左膀右臂。这份信任，是多少人求都求不来的。");
                    }
                    else if (matronDiff >= 15) {
                        changes.push("主母对你颇为看重。她时常会单独叫你去说话，询问你对院中事务的看法，有时还会听取你的建议。这份青眼，让其他人都艳羡不已。");
                    }
                    else if (matronDiff >= 10) {
                        changes.push("主母对你的态度缓和了许多，偶尔还会赏你些东西。她看你的眼神里多了几分认可，说话时也没从前那般严厉。");
                    }
                    else {
                        changes.push("你在主母心中的分量重了些。虽然她依然严肃，但至少不再像从前那样冷淡了。");
                    }
                }
            }
            else {
                if (this.world.stage === 1) {
                    if (matronDiff <= -15) {
                        changes.push("赵嬷嬷对你的态度冷到了冰点。她见了你连正眼都不给，有时甚至会当着众人的面训斥你。你知道自己定是哪里得罪了她，心里惶惶不安。");
                    }
                    else if (matronDiff <= -10) {
                        changes.push("赵嬷嬷对你的态度冷了许多。她很少再主动同你说话，就算说话也是公事公办的口气。你心里清楚，大约是哪里做得不合她的心思了。");
                    }
                    else {
                        changes.push("赵嬷嬷对你的态度不如从前热络了，说话时也少了些温度。");
                    }
                }
                else {
                    if (matronDiff <= -15) {
                        changes.push("主母对你的态度急转直下。她见了你就沉下脸来，有一回甚至当众责罚了你。府里人都在议论，说你怕是要失宠了。你得赶紧想办法补救才行。");
                    }
                    else if (matronDiff <= -10) {
                        changes.push("主母近来对你脸色很不好。她很少再叫你，偶尔见了面也是冷冰冰的。你得小心行事，可别再惹她不快。");
                    }
                    else {
                        changes.push("主母对你的态度冷淡了些，不知是哪里做得不合她的意。");
                    }
                }
            }
        }
        if (changes.length === 1) {
            return "你的变化：\n\n这一季平淡度过，没什么大的改变。";
        }
        return changes.join("\n\n");
    }
}
