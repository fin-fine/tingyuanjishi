import { EventEngine } from "./EventEngine.js";
import { SaveSystem } from "./SaveSystem.js";
import { Player } from "../model/Player.js";
import { WorldState } from "../model/WorldState.js";
import { MainScene } from "../ui/MainScene.js";
import { loadAiSettings } from "./AiConfig.js";
import { createRandomChild, getHighestStat, getPersonalityType, PERSONALITY_LABELS, STAT_LABELS } from "../model/Child.js";
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
        this.interludes = [];
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
        await this.loadInterludes();
        this.restoreOrInit();
        this.ensureNpcImpressions();
        this.scene = new MainScene(this.player, this.world, this.shopItems, () => this.resetGame());
        this.refreshSaves();
        this.scene.renderLog(this.logs);
        this.scene.renderTime();
        if (this.isNewGame) {
            const legacy = this.saveSystem.loadLegacy();
            this.scene.showIntro((payload) => {
                void this.onCharacterCreated(payload);
            }, legacy);
            return;
        }
        void this.tick();
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
        // 不清除遗产，让玩家可以重新开始时继承
        this.player.reset();
        this.world.reset();
        this.plan = null;
        this.isNewGame = true;
        this.logs = [];
        this.lastQuarterStats = null;
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
        this.refreshSaves();
        const legacy = this.saveSystem.loadLegacy();
        this.scene?.showIntro((payload) => {
            void this.onCharacterCreated(payload);
        }, legacy);
    }
    restartWithLegacy() {
        // 保存当前周目数据作为遗产
        this.saveSystem.saveLegacy(this.player, this.world);
        // 清除存档
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
        // 读取刚保存的遗产
        const legacy = this.saveSystem.loadLegacy();
        this.scene?.showIntro((payload) => {
            void this.onCharacterCreated(payload);
        }, legacy);
    }
    async tick() {
        if (await this.checkStageEnding()) {
            this.persistAutoSave();
            return;
        }
        // 检查是否需要显示季度总结
        if (this.shouldShowQuarterSummary()) {
            this.showQuarterSummary();
            return;
        }
        const stagePrefix = this.world.stage <= 1 ? "s1_" : (this.world.stage === 2 ? "s2_" : "s3_");
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
        // 应用周目遗产
        if (payload.legacyStat) {
            const legacyBonus = {};
            legacyBonus[payload.legacyStat] = 10;
            this.player.applyDelta(legacyBonus);
        }
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
                    void this.tick();
                });
            }
            catch (error) {
                // AI失败，直接开始游戏
                this.persistAutoSave();
                void this.tick();
            }
        }
        else {
            // AI未启用，直接开始游戏
            this.persistAutoSave();
            void this.tick();
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
            business: "商业",
        };
        return labels[key];
    }
    /**
     * 显示第一夜事件，并加入AI生成的少爷对姓名的评价
     */
    async showFirstNightWithNameComment(event) {
        this.scene?.showLoading("命运推演中...");
        try {
            const nameComment = this.normalizeInlineText(await this.generateNameComment(this.player.name));
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
            return this.normalizeInlineText(content);
        }
        catch (error) {
            console.error("Failed to generate name comment:", error);
            return "";
        }
    }
    normalizeInlineText(text) {
        return text.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
    }
    ensureNpcImpressions() {
        if (!Object.keys(this.player.npcImpressions ?? {}).length) {
            this.player.npcImpressions = this.buildDefaultNpcImpressions();
            this.player.npcImpressionsTurn = this.world.turn;
        }
    }
    getNpcImpressionEntries() {
        const matronLabel = this.world.stage <= 1 ? "赵嬷嬷" : "大夫人/少夫人";
        const rivalValue = this.player.npcRelations.rival ?? 0;
        const showRival = this.world.stage >= 2 || Math.abs(rivalValue) > 0.001;
        const servantsValue = (this.player.stats.status + this.player.stats.network) / 2;
        return [
            {
                key: "young_master",
                label: "少爷",
                value: this.player.stats.favor,
                visible: true,
            },
            {
                key: "matron",
                label: matronLabel,
                value: this.player.npcRelations.matron ?? 0,
                visible: true,
            },
            {
                key: "rival",
                label: "姨娘们",
                value: rivalValue,
                visible: showRival,
            },
            {
                key: "children",
                label: "子嗣",
                value: this.computeChildrenImpressionScore(),
                visible: true,
            },
            {
                key: "servants",
                label: "府中下人",
                value: servantsValue,
                visible: true,
            },
        ];
    }
    buildDefaultNpcImpressions() {
        const impressions = {};
        const entries = this.getNpcImpressionEntries();
        for (const entry of entries) {
            if (!entry.visible) {
                continue;
            }
            if (entry.key === "children") {
                impressions[entry.key] = this.buildChildrenImpression();
                continue;
            }
            impressions[entry.key] = this.buildGenericImpression(entry.label, entry.value);
        }
        return impressions;
    }
    buildGenericImpression(label, value) {
        const score = Math.max(0, Math.min(100, value));
        if (score >= 80) {
            return `${label}对你颇为倚重，言行间处处偏护。`;
        }
        if (score >= 60) {
            return `${label}对你信任有加，交代之事也多了。`;
        }
        if (score >= 40) {
            return `${label}对你态度尚可，往来中规中矩。`;
        }
        if (score >= 20) {
            return `${label}对你略显冷淡，少有亲近。`;
        }
        return `${label}对你疏离防备，几乎不愿多言。`;
    }
    computeChildrenImpressionScore() {
        const count = this.player.children.length;
        if (!count) {
            return 0;
        }
        const totalAptitude = this.player.children.reduce((sum, child) => sum + child.aptitude, 0);
        const avgAptitude = totalAptitude / count;
        return Math.min(100, 40 + count * 12 + avgAptitude * 0.4);
    }
    buildChildrenImpression() {
        const count = this.player.children.length;
        if (!count) {
            return "膝下尚空，暂无子嗣。";
        }
        const totalAptitude = this.player.children.reduce((sum, child) => sum + child.aptitude, 0);
        const avgAptitude = totalAptitude / count;
        const countText = count >= 2 ? "子嗣渐多" : "子嗣已有";
        if (avgAptitude >= 80) {
            return `${countText}，资质出挑，你心中多了几分安稳。`;
        }
        if (avgAptitude >= 60) {
            return `${countText}，尚算顺遂，你心里稍觉宽慰。`;
        }
        return `${countText}，底子偏弱，你仍需多费心照拂。`;
    }
    async refreshNpcImpressions(reason) {
        const defaults = this.buildDefaultNpcImpressions();
        this.player.npcImpressions = { ...this.player.npcImpressions, ...defaults };
        if (!this.isCustomAllowedBySettings()) {
            this.player.npcImpressionsTurn = this.world.turn;
            return;
        }
        if (this.player.npcImpressionsTurn === this.world.turn && reason !== "quarter") {
            return;
        }
        try {
            const aiImpressions = await this.generateNpcImpressionsByAI(defaults);
            if (aiImpressions) {
                this.player.npcImpressions = { ...this.player.npcImpressions, ...aiImpressions };
            }
        }
        catch (error) {
            console.error("Failed to refresh NPC impressions:", error);
        }
        finally {
            this.player.npcImpressionsTurn = this.world.turn;
        }
    }
    async generateNpcImpressionsByAI(defaults) {
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            return null;
        }
        const entries = this.getNpcImpressionEntries().filter((entry) => entry.visible);
        const childCount = this.player.children.length;
        const avgAptitude = childCount
            ? this.player.children.reduce((sum, child) => sum + child.aptitude, 0) / childCount
            : 0;
        const npcList = entries
            .map((entry) => `- ${entry.key}(${entry.label}): ${Math.round(entry.value)}`)
            .join("\n");
        const prompt = `# Role
你是一个古风宅斗养成游戏《通房丫头模拟器》的NPC印象生成系统。\n\n# Context\n玩家身份：${this.player.position}\n回合：${this.world.turn}\n月份：${this.world.month}\n属性：${JSON.stringify(this.player.stats)}\nNPC关系：${JSON.stringify(this.player.npcRelations)}\n子嗣数量：${childCount}\n子嗣平均资质：${avgAptitude.toFixed(1)}\n\n# Task\n根据以下NPC数值，为每个NPC生成一句话印象，古风白话，15-30字，语气克制写实。\n数值越高，态度越亲近；数值越低，越冷淡或疏离。\n\nNPC列表:\n${npcList}\n\n# Output\n只输出JSON对象，key必须使用列表中的key，value为一句话文本。不要额外解释。`;
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
                messages: [{ role: "user", content: prompt }],
                temperature: 0.5,
            }),
        });
        if (!response.ok) {
            throw new Error(`Bad response: ${response.status}`);
        }
        const raw = (await response.json());
        const content = raw.choices?.[0]?.message?.content;
        if (!content) {
            return null;
        }
        const trimmed = content.trim();
        const jsonText = trimmed.startsWith("{") && trimmed.endsWith("}")
            ? trimmed
            : trimmed.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonText) {
            return null;
        }
        const parsed = JSON.parse(jsonText);
        const cleaned = {};
        for (const entry of this.getNpcImpressionEntries()) {
            if (!entry.visible) {
                continue;
            }
            const value = parsed[entry.key];
            if (typeof value === "string" && value.trim()) {
                cleaned[entry.key] = this.normalizeInlineText(value);
            }
            else if (defaults[entry.key]) {
                cleaned[entry.key] = defaults[entry.key];
            }
        }
        return Object.keys(cleaned).length ? cleaned : null;
    }
    /**
     * 评估子嗣结局
     * 返回结局信息，如果没有匹配的结局则返回null
     */
    async evaluateChildEnding(child) {
        const highest = getHighestStat(child);
        const personality = getPersonalityType(child.personality);
        const sex = child.sex;
        // 女性子嗣结局
        if (sex === "girl") {
            // 女官结局（文学+礼仪高，顺从）
            if (child.stats.literary >= 80 && child.stats.etiquette >= 85 && personality === "obedient") {
                return {
                    title: "女官之母",
                    text: `你的女儿才华横溢，琴棋书画样样精通，更懂得宫中规矩礼仪。她性格温顺恭谨，深得长辈喜爱。在你的精心培养下，她被选入宫中，成为了一名女官，为皇后娘娘所器重。\n\n虽然你依然是姨娘，但女儿的荣耀也照亮了你的人生。\n\n【女官之母结局】`,
                };
            }
            // 才女结局（文学极高）
            if (child.stats.literary >= 85) {
                if (personality === "rebellious") {
                    return {
                        title: "才女之母",
                        text: `你的女儿才华出众，精通诗词歌赋，但性格叛逆不羁，不愿受规矩束缚。她拒绝入宫为官，反而在文坛上闯出了名堂，成为京城有名的才女。\n\n虽然有人批评她行事乖张，但她的才华却无人能及。你看着女儿活得如此肆意，心中五味杂陈。\n\n【才女之母结局】`,
                    };
                }
                else {
                    return {
                        title: "闺秀之母",
                        text: `你的女儿文采斐然，举止优雅，成为京城有名的大家闺秀。许多世家豪门都来提亲，最终她嫁入了一户显赫之家，成为了正室夫人。\n\n虽然出身庶出，但她凭借自己的才华和教养，赢得了体面的人生。\n\n【闺秀之母结局】`,
                    };
                }
            }
            // 武艺高强（叛逆+武艺）
            if (child.stats.martial >= 75 && personality === "rebellious") {
                return {
                    title: "女侠之母",
                    text: `你的女儿自幼习武，身手矫健，性格更是刚烈不羁。她不愿受府中规矩束缚，有一天竟然离家出走，行走江湖。\n\n数年后传来消息，她已成为江湖上有名的女侠，行侠仗义，快意恩仇。你既担心又欣慰，只盼她平安。\n\n【女侠之母结局】`,
                };
            }
            // 商业才女
            if (child.stats.business && child.stats.business >= 70) {
                return {
                    title: "商贾之母",
                    text: `你的女儿继承了你的商业天赋，在铺面中跟你学习多年。她精明能干，善于经营，将家业打理得井井有条。\n\n虽是女儿身，但她的商业头脑不输男子。在这个时代，她用自己的方式活出了精彩。\n\n【商贾之母结局】`,
                };
            }
        }
        // 男性子嗣结局
        if (sex === "boy") {
            // 状元结局（文学极高，顺从）
            if (child.stats.literary >= 80 && personality === "obedient") {
                return {
                    title: "状元之母",
                    text: `你的儿子天资聪颖，勤勉好学，在你的悉心栽培下，学识日渐精进。他参加科举，一路过关斩将，最终在殿试中脱颖而出，高中状元！\n\n虽是庶子，但他凭借才华赢得了皇上的赏识。你作为状元之母，地位水涨船高。\n\n【状元之母结局】`,
                };
            }
            // 探花/榜眼
            if (child.stats.literary >= 75 && child.stats.literary < 80) {
                return {
                    title: "进士之母",
                    text: `你的儿子学识渊博，科举考试中表现出色，高中进士。虽未能夺得状元，但这份荣耀已经足够让你在府中扬眉吐气。\n\n庶子也能金榜题名，你为他骄傲。\n\n【进士之母结局】`,
                };
            }
            // 武将结局（武艺高，叛逆）
            if (child.stats.martial >= 80 && personality === "rebellious") {
                return {
                    title: "将军之母",
                    text: `你的儿子自幼习武，身手不凡，性格刚烈果敢。他不愿读书科举，反而投身军营，征战沙场。\n\n凭借赫赫战功，他从一介小卒升到了将军之位。虽然这条路走得艰险，但他用自己的方式证明了价值。\n\n【将军之母结局】`,
                };
            }
            // 武艺高但顺从
            if (child.stats.martial >= 75 && personality === "obedient") {
                return {
                    title: "护卫之母",
                    text: `你的儿子武艺高强，性格忠诚可靠。虽是庶子，但凭借出色的武艺成为了王府的护卫统领，深得主家信任。\n\n这份稳定虽不算显赫，但也是一份体面的差事。\n\n【护卫之母结局】`,
                };
            }
            // 商业奇才
            if (child.stats.business && child.stats.business >= 75) {
                return {
                    title: "巨贾之母",
                    text: `你的儿子继承了你的商业天赋，年纪轻轻就在商场上展现出惊人的才能。他将家族产业发扬光大，成为京城有名的大商贾。\n\n虽然士农工商，商为末流，但他积累的财富却让许多世家都艳羡不已。\n\n【巨贾之母结局】`,
                };
            }
            // 叛逆+文学高但不够
            if (child.stats.literary >= 60 && child.stats.literary < 75 && personality === "rebellious") {
                return {
                    title: "浪子之母",
                    text: `你的儿子颇有才华，却不愿用功读书。他性格叛逆，整日与文人墨客饮酒作诗，过着放荡不羁的生活。\n\n你多次规劝无果，只能眼睁睁看着他挥霍光阴。或许，这就是他想要的人生吧。\n\n【浪子之母结局】`,
                };
            }
        }
        // 如果以上都不匹配，尝试AI生成结局
        if (this.isCustomAllowedBySettings()) {
            return await this.generateChildEndingByAI(child);
        }
        return null;
    }
    /**
     * 使用AI生成子嗣结局
     */
    async generateChildEndingByAI(child) {
        try {
            const aiSettings = loadAiSettings();
            if (!aiSettings.enabled || !aiSettings.apiUrl) {
                return null;
            }
            const highest = getHighestStat(child);
            const personality = getPersonalityType(child.personality);
            const sexLabel = child.sex === "boy" ? "男" : "女";
            const prompt = `请为一个古代宅斗养成游戏生成子嗣结局。

【子嗣信息】
性别: ${sexLabel}
资质: ${child.aptitude}
性格: ${personality === "rebellious" ? "叛逆" : personality === "obedient" ? "顺从" : "温和"} (性格值: ${child.personality}/100)
文学: ${child.stats.literary.toFixed(1)}
武艺: ${child.stats.martial.toFixed(1)}
礼仪: ${child.stats.etiquette.toFixed(1)}
商业: ${child.stats.business?.toFixed(1) || 0}
最高属性: ${STAT_LABELS[highest.stat]} (${highest.value.toFixed(1)})
培养方向: ${child.training}

【要求】
1. 根据子嗣的属性、性格、性别生成一个合理的结局
2. 结局要符合古代社会背景，但可以有一些突破性的元素
3. 结局描述要细腻动人，体现母亲的心境
4. 字数控制在150-250字之间
5. 返回格式：
   结局标题: xxx之母
   结局内容: （具体描述）

请直接返回结局，不要额外解释。`;
            const headers = {
                "Content-Type": "application/json",
            };
            if (aiSettings.apiKey) {
                headers.Authorization = `Bearer ${aiSettings.apiKey}`;
            }
            const response = await fetch(aiSettings.apiUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.8,
                    max_tokens: 500,
                }),
            });
            if (!response.ok) {
                throw new Error(`AI API error: ${response.statusText}`);
            }
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content?.trim() || "";
            if (!content) {
                return null;
            }
            // 解析AI返回的内容
            const titleMatch = content.match(/结局标题[:：]\s*(.+)/);
            const textMatch = content.match(/结局内容[:：]\s*([\s\S]+)/);
            if (titleMatch && textMatch) {
                return {
                    title: titleMatch[1].trim(),
                    text: textMatch[1].trim() + "\n\n【AI生成结局】",
                };
            }
            // 如果无法解析，返回全部内容
            return {
                title: "独特命运",
                text: content + "\n\n【AI生成结局】",
            };
        }
        catch (error) {
            console.error("Failed to generate AI ending:", error);
            return null;
        }
    }
    async checkStageEnding() {
        if (this.world.turn <= this.world.maxTurn) {
            return false;
        }
        // ========== 第一阶段结束 ==========
        if (this.world.stage <= 1) {
            // 第一阶段通过条件：同时需要宠爱55+且主母印象60+
            const favorPass = this.player.stats.favor > 55;
            const matronPass = (this.player.npcRelations.matron ?? 0) > 60;
            if (favorPass && matronPass) {
                // 显示幕间剧情
                const interlude = this.findInterlude(1);
                if (interlude) {
                    const interludeText = this.generateInterludeText(interlude);
                    this.scene?.showResult(interludeText, () => {
                        // 幕间剧情结束后进入第二阶段
                        this.world.advanceStage();
                        this.persistAutoSave();
                        void this.tick();
                    });
                    return true;
                }
                // 如果没有幕间剧情，直接进入第二阶段
                this.world.advanceStage();
                void this.tick();
                return true;
            }
            // 命运更严酷：属性过低时可能直接死亡
            const favorVeryLow = this.player.stats.favor < 20;
            const matronVeryLow = (this.player.npcRelations.matron ?? 0) < 30;
            const healthCritical = this.player.stats.health <= 15;
            if ((favorVeryLow && matronVeryLow) || healthCritical) {
                void this.triggerEnding("身故", `你已经撑到了极限。日复一日的煎熬消磨了你的身体，也磨灭了你最后的希望。\n\n那个深秋的黄昏，落叶铺满了庭院。你倒在了回廊的转角处，手里还攐着今早没来得及交差的针线。你的目光最后落在了天边那一抹残红，像极了你入府那天黄昏的颜色。\n\n赵孆孆闻讯赶来时，你已经没了气息。她叹了口气，吽咄人将你抬到后院，草草收殓。\n\n没有人为你掉一滴眼泪。在这座侯府里，一个通房丫头的生死，不过是茶余饭后的一句叹息。第二日，便有新的丫鬟补上了你的位置。\n\n仿佛你从未来过。`, "身故");
                return true;
            }
            void this.triggerEnding("发卖出府", `你终究没能留下。在一个寻常的早晨，赵孆孆将你叫到面前，面无表情地递来一纸文书。\n\n“收拾东西吧。”她只说了这三个字。\n\n你跪在地上磕了个头，一声“孆孆”还未说出口，泪水已经流了满面。可赵孆孆已经转过了身去——府里还有一堆事等着她料理。\n\n午后，牙行的人领你出了侯府后门。你回头望了最后一眼那高墙深院——少爷书房里的灯影、院中那棵老槐树、还有每日清晨打水的井台——从此都与你再无干系。\n\n这半年的经历，不知是梦是真。你被推摁着上了马车，往不知名的方向驶去。命运的笔，又翻开了新的一页。`, "发卖出府");
            return true;
        }
        // ========== 第二阶段结束 ==========
        if (this.world.stage === 2) {
            const hasChild = this.player.children.length > 0;
            const favor = this.player.stats.favor;
            const status = this.player.stats.status;
            const matronTrust = this.player.npcRelations.matron ?? 0;
            // 生子成功，直接升职为姨娘进入第三阶段
            if (hasChild && matronTrust >= 70) {
                this.player.position = "姨娘";
                this.world.advanceStage(); // 进入第三阶段
                this.scene?.showResult(`恭喜！你为谢家诞下子嗣，主母对你颇为信任。少爷向主母提请，将你抬为姨娘。\n\n你的身份从通房升为姨娘，有了自己的小院落，也有了更多的自主权。`, () => void this.tick());
                return true;
            }
            // 未生子但三项属性都高，也可升职为姨娘
            if (!hasChild && favor >= 80 && status >= 70 && matronTrust >= 75) {
                this.player.position = "姨娘";
                this.world.advanceStage(); // 进入第三阶段
                this.scene?.showResult(`虽无子嗣，但你凭借高超的手腕赢得了少爷的宠爱、院中的名声和主母的信任。少爷向主母提请，将你抬为姨娘。\n\n你的身份从通房升为姨娘，有了自己的小院落，也有了更多的自主权。`, () => void this.tick());
                return true;
            }
            // 未达标，出现结局事件
            if (hasChild) {
                // 有子但主母信任不够
                this.scene?.showEnding("勉强维持", `你虽然为谢家生下了子嗣，但主母对你的信任不足（主母信任: ${matronTrust}）。你依然只是通房的身份，日子过得战战兢兢，不知何时会失宠。\n\n你的故事，就此止步。`, () => this.restartWithLegacy());
                return true;
            }
            else {
                // 无子需要三项都高
                const missing = [];
                if (favor < 80)
                    missing.push(`宠爱${favor}/80`);
                if (status < 70)
                    missing.push(`名声${status}/70`);
                if (matronTrust < 75)
                    missing.push(`主母信任${matronTrust}/75`);
                this.scene?.showEnding("香消玉殒", `你未能生子，也未能同时获得足够的宠爱、名声与主母信任。\n缺少：${missing.join("、")}\n\n数月后，你被主母寻了个由头，发卖出府。你的故事，就此结束。`, () => this.restartWithLegacy());
                return true;
            }
        }
        // ========== 第三阶段结局 ==========
        if (this.world.stage >= 3) {
            const business = this.player.stats.business;
            const cash = this.player.stats.cash;
            const children = this.player.children;
            // 商业独立结局（商业能力高，现银充足）
            if (business >= 80 && cash >= 50) {
                void this.triggerEnding("商海女杰", `你凭借过人的商业才能，将主母委托经营的几处铺面打理得风生水起。从绸缎庄到药铺，从茶馆到当铺，你的商号遍布京城内外。\n\n旁人只道你是侯府的一个姨娘，殊不知京城商界暗中流传的"谢姨娘"之名，比许多世家老爷都要响亮。你手中握有的银两，已经超过了整座侯府一年的进项。\n\n主母看你的眼神从轻蔑变成了忌惮，最后化作了一种复杂的尊重。少爷更是对你刮目相看——他从未想过，一个通房丫头竟能做出这般事业。\n\n你再也不必依附于任何人。姨娘的身份于你而言，不过是一件随时可以脱下的外衣。你用商业的力量，为自己挣来了真正的自由。\n\n在这个男尊女卑的时代，你走出了一条前所未有的路。后人提起你时，无不感慨一声——\n\n"那位谢家姨娘，当真了得。"`, "商海女杰");
                return true;
            }
            // 子嗣结局
            if (children.length > 0) {
                // 遍历所有子嗣，寻找最佳结局
                for (const child of children) {
                    const ending = await this.evaluateChildEnding(child);
                    if (ending) {
                        void this.triggerEnding(ending.title, ending.text, ending.title);
                        return true;
                    }
                }
                // 如果所有子嗣都没有特殊结局，使用默认结局
                const child = children[0];
                const highest = getHighestStat(child);
                const personality = getPersonalityType(child.personality);
                const sexLabel = child.sex === "boy" ? "儿子" : "女儿";
                const pronoun = child.sex === "boy" ? "他" : "她";
                const personalityLabel = personality === "rebellious" ? "叛逆" : personality === "obedient" ? "顺从" : "温和";
                void this.triggerEnding("平淡一生", `你的${sexLabel}健康地长大了。虽未取得显赫功名，但也平安顺遂，没有辜负你的一番栽培。\n\n${pronoun}性格${personalityLabel}，最擅长${STAT_LABELS[highest.stat]}。作为姨娘，你的日子说不上好，也说不上坏。少爷偶尔会来你院中坐坐，主母待你也算客气。你在这座府邸里找到了自己的位置——不高不低，不远不近。\n\n你看着${pronoun}一天天长大，从蒙学到开蒙，从跌跌撞撞到稳步行走。或许${pronoun}不会成为什么了不起的人物，但${pronoun}是你在这世间最大的牵挂与慰藉。\n\n岁月在你脸上留下了痕迹，但你的眼神依旧清明。你学会了知足，学会了在平淡中寻找安宁。\n\n也许，这样的一生，便已足够。`, "平淡一生");
                return true;
            }
            // 无子且商业能力不足
            if (business < 80) {
                void this.triggerEnding("孤独终老", `岁月如流，光阴荏苒。\n\n你没有子嗣，商业上也未有建树。虽然挂着姨娘的名号，但在府中的地位日渐边缘化。少爷有了新的宠妾，主母也渐渐不再记得你。\n\n你守着自己的小院，种了几盆花草，养了一只猫。日出日落，四季轮转。窗外的喧嚣与你再无关系，你已经习惯了一个人的清静。\n\n有时候，你会在黄昏时分坐在廊下，看天边的晚霞一点点暗下去。回想这一生，从入府到如今，像是做了一场漫长的梦。\n\n梦里有过挣扎，有过期盼，有过短暂的温暖。但终究，都归于平淡。\n\n你在这座院落里，慢慢地、安静地老去。`, "孤独终老");
                return true;
            }
            // 默认结局
            void this.triggerEnding("结算", "本阶段已至尽头，你的故事暂告一段落。往后的日子，便如流水般平淡地过下去了。", "结算");
            return true;
        }
        void this.triggerEnding("结算", "本阶段已至尽头，你的故事暂告一段落。", "结算");
        return true;
    }
    /**
     * 触发结局：显示结局叙事、终局档案，并（如果AI启用）生成一生评传
     */
    async triggerEnding(title, narrative, endingTag) {
        const statsHtml = this.buildEndingStatsHtml();
        this.scene?.showEnding(title, narrative, () => this.restartWithLegacy(), statsHtml);
        if (this.isCustomAllowedBySettings()) {
            this.scene?.showEndingReviewLoading();
            try {
                const review = await this.generateLifetimeReview(title, endingTag, narrative);
                this.scene?.appendEndingSection(review);
            }
            catch (error) {
                console.error("Failed to generate lifetime review:", error);
                this.scene?.removeEndingReviewLoading();
            }
        }
    }
    /**
     * 构建终局档案HTML
     */
    buildEndingStatsHtml() {
        const statEntries = [
            { label: "容貌", value: this.player.stats.appearance },
            { label: "心机", value: this.player.stats.scheming },
            { label: "名声", value: this.player.stats.status },
            { label: "人脉", value: this.player.stats.network },
            { label: "宠爱", value: this.player.stats.favor },
            { label: "健康", value: this.player.stats.health },
            { label: "银钱", value: this.player.stats.cash },
            { label: "商业", value: this.player.stats.business },
        ];
        const renderBar = (value) => {
            const clamped = Math.max(0, Math.min(100, value));
            const filled = Math.round(clamped / 10);
            return "█".repeat(filled) + "░".repeat(10 - filled);
        };
        const childrenHtml = this.player.children.length > 0
            ? this.player.children.map((child) => {
                const sexLabel = child.sex === "boy" ? "子" : "女";
                const personality = getPersonalityType(child.personality);
                const highest = getHighestStat(child);
                return `<div style="margin-left:12px;color:#c0a882;">${sexLabel} · 资质${child.aptitude} · ${PERSONALITY_LABELS[personality]} · 擅${STAT_LABELS[highest.stat]}(${highest.value.toFixed(0)})</div>`;
            }).join("")
            : "";
        const statRows = statEntries.map(s => {
            const bar = renderBar(s.value);
            const val = Math.round(s.value);
            return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0;font-family:monospace;font-size:13px;"><span style="width:36px;text-align:right;color:#c0a882;">${s.label}</span><span style="color:#8b7355;letter-spacing:1px;">${bar}</span><span style="width:30px;text-align:right;color:#d4a574;">${val}</span></div>`;
        }).join("");
        const monthsPassed = this.world.turn;
        const years = Math.floor(monthsPassed / 12);
        const months = monthsPassed % 12;
        const durationText = years > 0 ? `${years}年${months > 0 ? months + "个月" : ""}` : `${months}个月`;
        return `<div style="margin:20px 0;padding:16px;border:1px solid #554433;background:rgba(30,25,18,0.7);border-radius:4px;">
      <div style="text-align:center;color:#d4a574;letter-spacing:4px;margin-bottom:12px;">═══ 终局档案 ═══</div>
      <div style="margin-bottom:10px;color:#c0a882;">
        <div>姓名：${this.player.name}　　出身：${this.player.backgroundName}</div>
        <div>身份：${this.player.position}　　历经：${durationText}</div>
      </div>
      <div style="margin-bottom:10px;">${statRows}</div>
      ${this.player.children.length > 0 ? `<div style="color:#c0a882;"><div style="margin-bottom:4px;">子嗣：${this.player.children.length}人</div>${childrenHtml}</div>` : '<div style="color:#888;">子嗣：无</div>'}
    </div>`;
    }
    /**
     * 调用AI生成一生评传
     */
    async generateLifetimeReview(endingTitle, endingTag, endingNarrative) {
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            throw new Error("AI not enabled");
        }
        const childrenInfo = this.player.children.map(child => {
            const personality = getPersonalityType(child.personality);
            const highest = getHighestStat(child);
            return `${child.sex === "boy" ? "子" : "女"}, 资质${child.aptitude}, 性格${PERSONALITY_LABELS[personality]}, 最强${STAT_LABELS[highest.stat]}(${highest.value.toFixed(0)})`;
        }).join("; ") || "无子嗣";
        const keyEvents = this.logs
            .filter(log => log.resultText && log.resultText.length > 10)
            .slice(-15)
            .map(log => `第${log.turn}回合: ${log.eventTitle}${log.optionText ? " - " + log.optionText : ""}`)
            .join("\n");
        const prompt = `# Role
你是古风生存游戏《通房丫头模拟器》的一生评传撰写系统。你以史官的笔法，为一位女子的一生撰写最终评价。

# Context
游戏背景：大雍景和十二年，侯府。女主角从通房丫头开始，在深宅大院中挣扎求存。

# Character
- 姓名：${this.player.name}
- 出身：${this.player.backgroundName}
- 最终身份：${this.player.position}
- 结局：${endingTag}

# Final Stats
容貌${Math.round(this.player.stats.appearance)} 心机${Math.round(this.player.stats.scheming)} 名声${Math.round(this.player.stats.status)} 人脉${Math.round(this.player.stats.network)} 宠爱${Math.round(this.player.stats.favor)} 健康${Math.round(this.player.stats.health)} 银钱${Math.round(this.player.stats.cash)} 商业${Math.round(this.player.stats.business)}

# Relationships
少爷宠爱：${Math.round(this.player.stats.favor)}　主母信任：${Math.round(this.player.npcRelations.matron ?? 0)}

# Children
${childrenInfo}

# Key Events
${keyEvents}

# Ending
${endingNarrative}

# Task
请为这位女子撰写一生评传，要求：
一、三百至五百字，古风白话文，语调沉稳克制，似史官执笔
二、以旁观者视角回顾她从入府到结局的一生
三、评价她的生存策略与处世智慧
四、根据属性分布分析她的性格特点
五、若有子嗣，评价她作为母亲的得失
六、指出一生中的关键抉择与转折
七、末尾以一首七言绝句（四句二十八字）总结一生
八、最后一行给出评级，格式为"【评级：X等】"：
   传奇 / 上等 / 中上 / 中等 / 中下 / 下等 / 悲剧

# Output
只输出评传正文，不要标题，不要额外说明。`;
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
                    { role: "user", content: "请撰写一生评传。" },
                ],
                temperature: 0.75,
                max_tokens: 1000,
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
    getMonthlyEventId() {
        if (this.world.stage <= 1) {
            return "s1_1000";
        }
        else if (this.world.stage === 2) {
            return "s2_1000";
        }
        else {
            return "s3_1000"; // 第三阶段的月度事件
        }
    }
    applyOption(event, optionId, onContinue) {
        const snapshot = this.snapshotState();
        const result = this.eventEngine.applyOption(event, optionId, this.player, this.world);
        const turnAdvanced = this.world.turn > snapshot.world.turn;
        const extraText = result.end ? "" : this.applyAfterActionEffects(snapshot, optionId);
        const combinedText = extraText ? `${result.text}\n${extraText}` : result.text;
        const sanitizedText = this.sanitizeResultText(combinedText);
        this.recordLog(this.buildLogEntry(event, optionId, sanitizedText, snapshot));
        if (result.end) {
            this.plan = null;
            const titleText = result.end.type === "death" ? "身故" : "结算";
            void this.triggerEnding(titleText, result.end.text, titleText);
            this.persistAutoSave();
            return;
        }
        const deltaText = this.formatStatDelta(result.delta);
        const combined = deltaText ? `${sanitizedText}\n${deltaText}` : sanitizedText;
        const next = onContinue ?? (() => void this.tick());
        this.scene?.showResult(combined, next);
        if (turnAdvanced) {
            void this.refreshNpcImpressions("turn");
        }
        this.persistAutoSave();
    }
    applySpecialOption(event, optionId) {
        const snapshot = this.snapshotState();
        const result = this.eventEngine.applyOption(event, optionId, this.player, this.world, {
            consumeAp: false,
        });
        const turnAdvanced = this.world.turn > snapshot.world.turn;
        this.player.history.add(event.id);
        // 处理特殊事件
        const option = event.options.find((opt) => opt.id === optionId);
        if (option?.special) {
            this.handleSpecialEvent(option.special);
        }
        const extraText = result.end ? "" : this.applyAfterActionEffects(snapshot, optionId);
        const combinedText = extraText ? `${result.text}\n${extraText}` : result.text;
        const sanitizedText = this.sanitizeResultText(combinedText);
        this.recordLog(this.buildLogEntry(event, optionId, sanitizedText, snapshot));
        if (result.end) {
            this.plan = null;
            const titleText = result.end.type === "death" ? "身故" : "结算";
            void this.triggerEnding(titleText, result.end.text, titleText);
            this.persistAutoSave();
            return;
        }
        const deltaText = this.formatStatDelta(result.delta);
        const combined = deltaText ? `${sanitizedText}\n${deltaText}` : sanitizedText;
        this.scene?.showResult(combined, () => this.showMonthlyPlan());
        if (turnAdvanced) {
            void this.refreshNpcImpressions("turn");
        }
        this.persistAutoSave();
    }
    handleSpecialEvent(special) {
        switch (special) {
            case "pregnancy_start":
                this.player.pregnancyStartTurn = this.world.turn;
                break;
            case "pregnancy_delay":
                // 延迟怀孕通知，稍后再设置
                setTimeout(() => {
                    this.player.pregnancyStartTurn = this.world.turn;
                    this.persistAutoSave();
                }, 0);
                break;
            case "give_birth":
                if (this.player.pregnancyStartTurn !== null) {
                    const child = createRandomChild(this.world.turn);
                    this.applyChildPersonalityInfluence(child, 0.7);
                    this.player.children.push(child);
                    this.player.pregnancyStartTurn = null;
                    this.scene?.renderChildren();
                }
                break;
            case "child_education_scholar":
                // 文学教育：提升文学能力
                if (this.player.children.length > 0) {
                    const child = this.player.children[this.player.children.length - 1];
                    child.stats.literary += 10 + Math.random() * 10;
                    child.training = "literary";
                    this.scene?.renderChildren();
                }
                break;
            case "child_education_martial":
                // 武艺教育：提升武艺能力
                if (this.player.children.length > 0) {
                    const child = this.player.children[this.player.children.length - 1];
                    child.stats.martial += 10 + Math.random() * 10;
                    child.training = "martial";
                    this.scene?.renderChildren();
                }
                break;
            case "child_education_business":
                // 商业教育：提升商业能力
                if (this.player.children.length > 0) {
                    const child = this.player.children[this.player.children.length - 1];
                    if (child.stats.business === undefined) {
                        child.stats.business = 0;
                    }
                    child.stats.business += 10 + Math.random() * 10;
                    child.training = "business";
                    this.scene?.renderChildren();
                }
                break;
            case "child_personality_strict":
                // 严格管教：增加顺从度
                if (this.player.children.length > 0) {
                    const child = this.player.children[this.player.children.length - 1];
                    child.personality = Math.min(100, child.personality + 10 + Math.random() * 10);
                    this.scene?.renderChildren();
                }
                break;
            case "child_personality_free":
                // 自由成长：增加叛逆度
                if (this.player.children.length > 0) {
                    const child = this.player.children[this.player.children.length - 1];
                    child.personality = Math.max(0, child.personality - 10 - Math.random() * 10);
                    this.scene?.renderChildren();
                }
                break;
            case "child_personality_encourage":
                // 鼓励独立：略微增加叛逆
                if (this.player.children.length > 0) {
                    const child = this.player.children[this.player.children.length - 1];
                    child.personality = Math.max(0, child.personality - 5 - Math.random() * 5);
                    this.scene?.renderChildren();
                }
                break;
            case "matron_escape_help":
                this.setInventoryCount("matron_escape_help", 1);
                break;
            case "matron_escape_refuse":
                this.setInventoryCount("matron_escape_refuse", 1);
                break;
            case "matron_escape_ignore":
                this.setInventoryCount("matron_escape_ignore", 1);
                break;
            case "matron_escape_success":
                this.setInventoryCount("matron_escaped", 1);
                break;
            case "matron_escape_failed":
                this.setInventoryCount("matron_confined", 1);
                break;
        }
    }
    applyPlan(event, optionIds) {
        this.plan = { event, startTurn: this.world.turn, queue: [...optionIds] };
        this.applyPlannedNext();
    }
    applyPlannedNext() {
        if (!this.plan) {
            void this.tick();
            return;
        }
        // 允许计划在开始的turn及下一个turn内执行
        // 这样即使AP耗尽进入下一回合，计划仍能继续
        const turnDiff = this.world.turn - this.plan.startTurn;
        if (turnDiff > 1) {
            // 如果跨越超过1个turn，清空计划
            this.plan = null;
            void this.tick();
            return;
        }
        const nextId = this.plan.queue.shift();
        if (!nextId) {
            this.plan = null;
            void this.tick();
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
            this.scene?.showResult("你一时语塞，不知如何是好。", () => void this.tick());
            return;
        }
        const snapshot = this.snapshotState();
        const settings = loadAiSettings();
        if (!settings.enabled || !settings.apiUrl) {
            this.scene?.showResult("自定义判定尚未开启，无法继续。", () => void this.tick());
            return;
        }
        const consumeAp = options?.consumeAp !== false;
        if (consumeAp && this.world.ap <= 0) {
            this.scene?.showResult("行动力不足，今日不宜强行。", () => void this.tick());
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
                const endTitle = endState.type === "death" ? "身故" : "结算";
                void this.triggerEnding(endTitle, endState.text, endTitle);
                this.persistAutoSave();
                return;
            }
            this.applyCustomTurnEffects(data.stat_changes, consumeAp);
            const extraText = this.applyAfterActionEffects(snapshot);
            const baseText = extraText ? `${data.result_text}\n${extraText}` : data.result_text;
            const sanitizedText = this.sanitizeResultText(baseText);
            this.recordLog(this.buildCustomLogEntry(event, trimmed, sanitizedText, snapshot));
            const deltaText = this.formatStatDelta(data.stat_changes ?? undefined);
            const combined = deltaText ? `${sanitizedText}\n${deltaText}` : sanitizedText;
            if (this.world.turn > snapshot.world.turn) {
                void this.refreshNpcImpressions("turn");
            }
            const next = options?.onComplete ?? (() => void this.tick());
            this.scene?.showResult(combined, next);
            this.persistAutoSave();
        }
        catch (error) {
            const next = options?.onComplete ?? (() => void this.tick());
            this.scene?.showResult("一时语塞，你竟不知如何是好... (网络连接失败)", next);
        }
    }
    buildAdjudicatePrompt(event, input) {
        const options = event.options.map((opt) => `- ${opt.id}: ${opt.text}`).join("\n");
        return `# Role\n你是一个高难度古风生存游戏《通房丫头模拟器》的后台判定系统（GM）。\n风格：写实、压抑、等级森严、逻辑严密，拒绝爽文。\n\n# Context\n当前事件：${event.title}\n事件内容：${event.text}\n可选项：\n${options || "(无)"}\n玩家属性：${JSON.stringify(this.player.stats)}\nNPC关系：${JSON.stringify(this.player.npcRelations)}\n背包：${JSON.stringify(this.player.inventory)}\n回合信息：${JSON.stringify({ turn: this.world.turn, month: this.world.month, ap: this.world.ap })}\n\n# User Input\n${input}\n\n# Rules\n1) 不可无中生有，不可机械降神。\n2) 反抗/欺骗/暴力要结合心机与地位判定。\n3) 行为越出格，惩罚越重；合理且巧妙可给予更显著的属性提升（可酌情+2到+5）。\n4) 用第二人称叙事，30-50字，古风白话。\n\n# Output (Strict JSON)\n只输出 JSON：\n{\n  \"result_text\": \"...\",\n  \"stat_changes\": { \"health\": -10, \"scheming\": 1 },\n  \"trigger_ending\": null | \"be_dead_poison\" | \"be_sold\"\n}`;
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
    applyAfterActionEffects(snapshot, optionId) {
        const extra = [];
        this.syncPregnancyTracking(snapshot);
        if (optionId === "opt_child_care") {
            const careCount = this.player.inventory["child_care"] ?? 0;
            this.setInventoryCount("child_care", careCount + 1);
            this.applyChildCarePersonality();
            const trainingText = this.applyChildTraining();
            if (trainingText) {
                extra.push(trainingText);
            }
        }
        const advanceText = this.applyTurnAdvanceEffects(snapshot);
        if (advanceText) {
            extra.push(advanceText);
        }
        return extra.join("\n");
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
            business: "商业",
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
    sanitizeResultText(text) {
        return text.replace(/（[^）]*[+-]\d+(?:\.\d+)?[^）]*）/g, "").trim();
    }
    syncPregnancyTracking(snapshot) {
        const prevConfirm = snapshot.inventory["preg_confirm"] ?? 0;
        const nextConfirm = this.player.inventory["preg_confirm"] ?? 0;
        if (prevConfirm <= 0 && nextConfirm > 0 && this.player.pregnancyStartTurn === null) {
            this.player.pregnancyStartTurn = this.world.turn;
        }
        if (nextConfirm <= 0 && this.player.pregnancyStartTurn !== null) {
            this.player.pregnancyStartTurn = null;
        }
        this.syncPregnancyStage();
    }
    syncPregnancyStage() {
        const confirm = this.player.inventory["preg_confirm"] ?? 0;
        if (confirm > 0 && this.player.pregnancyStartTurn !== null) {
            const months = Math.max(0, this.world.turn - this.player.pregnancyStartTurn);
            const stage = months >= 6 ? 3 : months >= 3 ? 2 : 1;
            this.setInventoryCount("preg_stage", stage);
            return;
        }
        if ((this.player.inventory["preg_stage"] ?? 0) > 0) {
            this.setInventoryCount("preg_stage", 0);
        }
    }
    applyTurnAdvanceEffects(snapshot) {
        const turnDiff = this.world.turn - snapshot.world.turn;
        if (turnDiff <= 0) {
            this.syncPregnancyStage();
            return "";
        }
        const messages = [];
        // 发放月例银子
        const monthlySalary = this.world.getMonthlySalary();
        if (monthlySalary > 0) {
            this.player.applyDelta({ cash: monthlySalary });
            messages.push(`月例银子${monthlySalary}两已发放。`);
        }
        for (let step = 1; step <= turnDiff; step += 1) {
            const currentTurn = snapshot.world.turn + step;
            this.applyChildNaturalGrowth(currentTurn);
        }
        const birthText = this.checkChildBirth();
        this.syncPregnancyStage();
        if (birthText) {
            messages.push(birthText);
        }
        return messages.join("\n");
    }
    applyChildNaturalGrowth(currentTurn) {
        if (!this.player.children.length) {
            return;
        }
        for (const child of this.player.children) {
            const ageMonths = Math.max(0, currentTurn - child.birthTurn);
            const ageYears = Math.floor(ageMonths / 12);
            const growth = 0.2 + child.aptitude / 250 + Math.min(0.6, ageYears * 0.05);
            this.applyChildStat(child, "literary", growth);
            this.applyChildStat(child, "martial", growth);
            this.applyChildStat(child, "etiquette", growth);
        }
    }
    applyChildTraining() {
        if (!this.player.children.length) {
            return null;
        }
        for (const child of this.player.children) {
            switch (child.training) {
                case "literary":
                    this.applyChildStat(child, "literary", 1.2);
                    this.applyChildStat(child, "etiquette", 0.4);
                    this.applyChildStat(child, "martial", 0.2);
                    break;
                case "martial":
                    this.applyChildStat(child, "martial", 1.2);
                    this.applyChildStat(child, "etiquette", 0.4);
                    this.applyChildStat(child, "literary", 0.2);
                    break;
                case "etiquette":
                    this.applyChildStat(child, "etiquette", 1.2);
                    this.applyChildStat(child, "literary", 0.4);
                    this.applyChildStat(child, "martial", 0.2);
                    break;
                case "balanced":
                default:
                    this.applyChildStat(child, "literary", 0.7);
                    this.applyChildStat(child, "martial", 0.7);
                    this.applyChildStat(child, "etiquette", 0.7);
                    break;
            }
        }
        return "你按既定方向教养子嗣，孩子各有长进。";
    }
    applyChildCarePersonality() {
        if (!this.player.children.length) {
            return;
        }
        const child = this.player.children[this.player.children.length - 1];
        this.applyChildPersonalityInfluence(child, 0.25);
        this.scene?.renderChildren();
    }
    applyChildPersonalityInfluence(child, intensity = 1) {
        const shift = this.computeChildPersonalityShift() * intensity;
        child.personality = this.clampPersonality(child.personality + shift);
    }
    computeChildPersonalityShift() {
        const favor = this.player.stats.favor ?? 0;
        const matronTrust = this.player.npcRelations.matron ?? 0;
        const status = this.player.stats.status ?? 0;
        const business = this.player.stats.business ?? 0;
        const careCount = this.player.inventory["child_care"] ?? 0;
        const parentBond = (favor - 50) * 0.25;
        const nurture = Math.min(12, careCount * 1.5);
        const independence = Math.min(14, business * 0.25);
        const equalityBase = Math.min(matronTrust, status);
        const equality = (equalityBase - 40) * 0.2;
        return parentBond + nurture + equality - independence;
    }
    clampPersonality(value) {
        return Math.max(0, Math.min(100, value));
    }
    applyChildStat(child, key, delta) {
        const current = child.stats[key] ?? 0;
        const next = Math.max(0, Math.min(100, current + delta));
        child.stats[key] = next;
    }
    checkChildBirth() {
        if (this.player.pregnancyStartTurn === null) {
            return null;
        }
        const confirm = this.player.inventory["preg_confirm"] ?? 0;
        if (confirm <= 0) {
            return null;
        }
        if (this.world.turn - this.player.pregnancyStartTurn < 9) {
            return null;
        }
        const child = createRandomChild(this.world.turn);
        this.applyChildPersonalityInfluence(child, 0.7);
        this.player.children.push(child);
        const currentCount = this.player.inventory["child"] ?? 0;
        this.setInventoryCount("child", currentCount + 1);
        this.player.pregnancyStartTurn = null;
        this.setInventoryCount("preg_confirm", 0);
        this.setInventoryCount("preg_stage", 0);
        const sexText = child.sex === "boy" ? "子" : "女";
        return `九月已满，你产下一${sexText}。`;
    }
    setInventoryCount(key, value) {
        this.player.inventory[key] = Math.max(0, value);
    }
    reconcileChildrenAfterLoad() {
        const recorded = this.player.inventory["child"] ?? 0;
        const existing = this.player.children.length;
        if (existing < recorded) {
            const missing = recorded - existing;
            for (let i = 0; i < missing; i += 1) {
                const child = createRandomChild(this.world.turn);
                this.applyChildPersonalityInfluence(child, 0.4);
                this.player.children.push(child);
            }
        }
        if (existing > recorded) {
            this.setInventoryCount("child", existing);
        }
        const confirm = this.player.inventory["preg_confirm"] ?? 0;
        if (confirm <= 0) {
            this.player.pregnancyStartTurn = null;
        }
        this.syncPregnancyStage();
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
    async loadInterludes() {
        const response = await fetch("./data/interludes.json");
        this.interludes = (await response.json());
    }
    findInterlude(stage) {
        return this.interludes.find((interlude) => interlude.stage === stage) ?? null;
    }
    generateInterludeText(interlude) {
        let fullText = `═══\n${interlude.title}\n═══\n\n`;
        for (const section of interlude.sections) {
            fullText += `【${section.title}】\n\n`;
            let sectionText = section.text;
            // 处理第一阶段总结
            if (section.summaryTemplates && section.dynamicValues) {
                const summaryParts = [];
                // 宠爱值评价
                const favor = this.player.stats.favor;
                let favorKey;
                if (favor >= 70) {
                    favorKey = "favor_high";
                }
                else if (favor >= 50) {
                    favorKey = "favor_mid";
                }
                else {
                    favorKey = "favor_low";
                }
                const favorData = section.dynamicValues[favorKey];
                if (favorData && section.summaryTemplates.favor_favor) {
                    summaryParts.push(section.summaryTemplates.favor_favor
                        .replace("{favor_level}", favorData.level)
                        .replace("{favor_desc}", favorData.desc));
                }
                // 主母印象评价
                const matron = this.player.npcRelations.matron ?? 0;
                let matronKey;
                if (matron >= 70) {
                    matronKey = "matron_high";
                }
                else if (matron >= 50) {
                    matronKey = "matron_mid";
                }
                else {
                    matronKey = "matron_low";
                }
                const matronData = section.dynamicValues[matronKey];
                if (matronData && section.summaryTemplates.matron_trust) {
                    summaryParts.push(section.summaryTemplates.matron_trust
                        .replace("{matron_level}", matronData.level)
                        .replace("{matron_desc}", matronData.desc));
                }
                // 技能评价（取最高的一项）
                const scheming = this.player.stats.scheming;
                const status = this.player.stats.status;
                const network = this.player.stats.network;
                let skillKey;
                if (scheming >= status && scheming >= network) {
                    skillKey = "skill_scheming";
                }
                else if (status >= network) {
                    skillKey = "skill_status";
                }
                else {
                    skillKey = "skill_network";
                }
                const skillData = section.dynamicValues[skillKey];
                if (skillData && section.summaryTemplates.skills) {
                    summaryParts.push(section.summaryTemplates.skills
                        .replace("{skill_area}", skillData.area)
                        .replace("{skill_desc}", skillData.desc));
                }
                // 健康状态
                const health = this.player.stats.health;
                let healthDesc;
                if (health >= 70) {
                    healthDesc = section.dynamicValues.health_good;
                }
                else if (health >= 40) {
                    healthDesc = section.dynamicValues.health_mid;
                }
                else {
                    healthDesc = section.dynamicValues.health_poor;
                }
                if (healthDesc && section.summaryTemplates.health) {
                    summaryParts.push(section.summaryTemplates.health.replace("{health_desc}", healthDesc));
                }
                // 银钱状况
                const cash = this.player.stats.cash;
                let silverDesc;
                let silverStatus;
                if (cash >= 50) {
                    silverDesc = section.dynamicValues.silver_rich;
                    silverStatus = section.dynamicValues.silver_status_good;
                }
                else if (cash >= 20) {
                    silverDesc = section.dynamicValues.silver_mid;
                    silverStatus = section.dynamicValues.silver_status_mid;
                }
                else {
                    silverDesc = section.dynamicValues.silver_poor;
                    silverStatus = section.dynamicValues.silver_status_poor;
                }
                if (silverDesc && silverStatus && section.summaryTemplates.silver) {
                    summaryParts.push(section.summaryTemplates.silver
                        .replace("{silver_desc}", silverDesc)
                        .replace("{silver_status}", silverStatus));
                }
                sectionText = sectionText.replace("{stage1_summary}", summaryParts.join(""));
            }
            // 处理提示模板
            if (interlude.hintTemplates) {
                const favor = this.player.stats.favor;
                const matron = this.player.npcRelations.matron ?? 0;
                const favorHint = favor >= 55 ? interlude.hintTemplates.favor_sufficient : interlude.hintTemplates.favor_insufficient;
                const matronHint = matron >= 60 ? interlude.hintTemplates.matron_good : interlude.hintTemplates.matron_poor;
                sectionText = sectionText.replace("{favor_hint}", favorHint || "");
                sectionText = sectionText.replace("{matron_hint}", matronHint || "");
            }
            fullText += sectionText + "\n\n";
        }
        return fullText.trim();
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
        this.scene?.showResult("已写入存档。", () => void this.tick());
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
        this.reconcileChildrenAfterLoad();
        this.plan = null;
        this.logs = (saved.logs ?? []).map((entry) => ({
            ...entry,
            timestamp: entry.timestamp ?? this.world.getCurrentTimestamp(),
        }));
        // 加载季度快照数据
        const savedWithExtra = saved;
        this.lastQuarterStats = savedWithExtra.lastQuarterStats ?? null;
        this.ensureNpcImpressions();
        this.scene?.renderLog(this.logs);
        this.scene?.renderTime();
        this.scene?.renderChildren();
    }
    shouldShowQuarterSummary() {
        // 每3个turn显示一次季度总结（跳过turn 1）
        return this.world.turn > 1 && this.world.turn % 3 === 1;
    }
    async showQuarterSummary() {
        // 显示加载提示
        this.scene?.showLoading("时间推演中……");
        // 等待AI生成NPC印象
        await this.refreshNpcImpressions("quarter");
        // 刷新属性面板以显示新的印象
        this.scene?.statsPanel.render();
        const summaryText = this.generateQuarterSummary();
        this.scene?.showResult(summaryText, () => {
            // 更新季度快照
            this.lastQuarterStats = {
                turn: this.world.turn,
                stats: { ...this.player.stats },
                npcRelations: { ...this.player.npcRelations },
            };
            this.persistAutoSave();
            // 直接显示月度事件,跳过tick()中的重复检查
            this.showMonthlyPlan();
        });
    }
    generateQuarterSummary() {
        const season = this.getSeasonName();
        // 计算年份：从景和十二年三月（turn 1）开始
        const monthsPassed = (this.world.turn - 1) + 2; // turn 1是三月，所以+2
        const yearNum = 12 + Math.floor(monthsPassed / 12);
        const year = this.numberToChinese(yearNum);
        const title = `═══\n景和${year}年${season}\n府中杂记\n═══\n`;
        let content = "";
        // 府内动态
        content += this.generateMansionNews();
        content += "\n";
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
        let news = "府中近况：\n";
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
        else if (stage === 2) {
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
        else {
            // 第三阶段：姨娘自立
            if (turn <= 70) {
                news += "你被抬为姨娘后，府里规矩仍旧森严，但你已不必事事听使。院中琐事有小丫鬟打点，你更多时候需要应对各房来往与人情周旋。府里人看你的眼神，比从前多了几分敬畏与算计。";
            }
            else if (turn <= 90) {
                news += "府中内宅趋于平稳，明面上的争斗少了，暗里的筹码却更讲究。姨娘之间时常走动探听，谁家孩子得宠、谁家铺面见利，消息传得飞快。你明白，这一阶段比的不是谁更狠，而是谁更稳。";
            }
            else {
                news += "岁月推移，府里人情世故愈发老成。主母把持大局不变，各房姬妾都在各自的小院里经营日子。若有子嗣便重在教养，若无子嗣便重在银钱与名声。你站在自己的位置上，已能左右一些风向。";
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
        changes.push("你的变化：\n");
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
                    changes.push("府里上下对你的态度发生了显著的转变。走到哪儿都有人恭敬地让路，连老嬷嬷们见了你都要和颜悦色地搭上几句。二门上的婆子说，外面都传开了，说你是侯府的体面人。");
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
                    changes.push("你在府里的声名似乎受了些影响，下人们对你也没从前那般随意了。");
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
                    changes.push("少爷对你的态度比从前缓和了些。虽然还谈不上亲近，但至少不再是那般陌生了。");
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
                    changes.push("你的身体差到了极点。几乎每天都觉得头晕目眩，半夜咳嗽不止。有时连站着都觉得费力，必须扶着墙才能走路。赵嬷嬷看了都发急，说再不治怕是要出人命。");
                }
                else if (healthDiff <= -15) {
                    changes.push("你时常觉得乏累，半夜还会咳嗽。身子一日不如一日，有时干活干到一半就得停下来喘气。再这样下去怕是要病倒。");
                }
                else if (healthDiff <= -10) {
                    changes.push("近来总觉得疲倦，身子不太利落。干点活就觉得累，晚上也睡不踏实。得想法子好好调养调养。");
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
