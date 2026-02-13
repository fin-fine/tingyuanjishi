export class Player {
    constructor() {
        this.defaultStats = {
            appearance: 60,
            scheming: 35,
            status: 10,
            network: 5,
            favor: 15,
            health: 70,
            cash: 0,
            business: 0,
        };
        this.name = "";
        this.backgroundId = "";
        this.backgroundName = "";
        this.position = "通房"; // 职位：通房 -> 姨娘 -> ...
        this.stats = { ...this.defaultStats };
        this.npcRelations = {
            jinshu: 0,
            matron: 0,
        };
        this.npcImpressions = {};
        this.npcImpressionsTurn = 0;
        this.inventory = {};
        this.children = [];
        this.pregnancyStartTurn = null;
        this.history = new Set();
    }
    setStats(stats) {
        this.stats = { ...this.stats, ...stats };
    }
    setIdentity(name, backgroundId, backgroundName) {
        this.name = name;
        this.backgroundId = backgroundId;
        this.backgroundName = backgroundName;
    }
    reset() {
        this.name = "";
        this.backgroundId = "";
        this.backgroundName = "";
        this.position = "通房";
        this.stats = { ...this.defaultStats };
        this.npcRelations = {
            jinshu: 0,
            matron: 0,
        };
        this.npcImpressions = {};
        this.npcImpressionsTurn = 0;
        this.inventory = {};
        this.history = new Set();
        this.children = [];
        this.pregnancyStartTurn = null;
    }
    applyDelta(delta) {
        for (const [key, value] of Object.entries(delta)) {
            if (key in this.stats) {
                const statKey = key;
                this.stats[statKey] += value;
                continue;
            }
            if (key.startsWith("npc_")) {
                const npcKey = key.replace("npc_", "");
                this.npcRelations[npcKey] = (this.npcRelations[npcKey] ?? 0) + value;
                continue;
            }
            if (key.startsWith("item_")) {
                const itemKey = key.replace("item_", "");
                const nextValue = (this.inventory[itemKey] ?? 0) + value;
                this.inventory[itemKey] = Math.max(0, nextValue);
            }
        }
    }
    serialize() {
        return {
            name: this.name,
            backgroundId: this.backgroundId,
            backgroundName: this.backgroundName,
            position: this.position,
            stats: this.stats,
            npcRelations: this.npcRelations,
            npcImpressions: this.npcImpressions,
            npcImpressionsTurn: this.npcImpressionsTurn,
            history: Array.from(this.history),
            inventory: this.inventory,
            children: this.children,
            pregnancyStartTurn: this.pregnancyStartTurn,
        };
    }
    load(data) {
        if (!data || typeof data !== "object") {
            return;
        }
        const parsed = data;
        if (typeof parsed.name === "string") {
            this.name = parsed.name;
        }
        if (typeof parsed.backgroundId === "string") {
            this.backgroundId = parsed.backgroundId;
        }
        if (typeof parsed.backgroundName === "string") {
            this.backgroundName = parsed.backgroundName;
        }
        if (typeof parsed.position === "string") {
            this.position = parsed.position;
        }
        if (parsed.stats) {
            this.stats = { ...this.stats, ...parsed.stats };
        }
        if (parsed.npcRelations) {
            this.npcRelations = { ...this.npcRelations, ...parsed.npcRelations };
        }
        if (parsed.npcImpressions) {
            this.npcImpressions = { ...this.npcImpressions, ...parsed.npcImpressions };
        }
        if (typeof parsed.npcImpressionsTurn === "number") {
            this.npcImpressionsTurn = parsed.npcImpressionsTurn;
        }
        if (parsed.history) {
            this.history = new Set(parsed.history);
        }
        if (parsed.inventory) {
            this.inventory = { ...this.inventory, ...parsed.inventory };
        }
        if (Array.isArray(parsed.children)) {
            this.children = parsed.children;
        }
        if (typeof parsed.pregnancyStartTurn === "number") {
            this.pregnancyStartTurn = parsed.pregnancyStartTurn;
        }
        else if (parsed.pregnancyStartTurn === null) {
            this.pregnancyStartTurn = null;
        }
    }
    /**
     * 获取当前职位等级
     */
    getPositionLevel() {
        const levels = {
            "通房": 1,
            "姨娘": 2,
            "侧室": 3,
        };
        return levels[this.position] ?? 1;
    }
    /**
     * 检查是否满足特定升职条件
     */
    checkPromotionRequirement(requirement) {
        const missing = [];
        // 检查是否有子嗣
        if (requirement.hasChild !== undefined) {
            const hasChild = this.children.length > 0;
            if (requirement.hasChild && !hasChild) {
                missing.push("需要诞下子嗣");
            }
            else if (!requirement.hasChild && hasChild) {
                missing.push("不能有子嗣");
            }
        }
        // 检查是否有儿子
        if (requirement.hasSon !== undefined && requirement.hasSon) {
            const hasSon = this.children.some(child => child.sex === "boy");
            if (!hasSon) {
                missing.push("需要诞下儿子");
            }
        }
        // 检查子嗣才华
        if (requirement.childTalent !== undefined) {
            const maxChildTalent = Math.max(0, ...this.children.map(child => {
                const talents = [
                    child.stats.literary,
                    child.stats.martial,
                    child.stats.etiquette,
                    child.stats.business ?? 0,
                ];
                return Math.max(...talents);
            }));
            if (maxChildTalent < requirement.childTalent) {
                missing.push(`需要子嗣才华达到${requirement.childTalent}（当前最高${maxChildTalent}）`);
            }
        }
        // 检查皇室功勋
        if (requirement.hasImperialMerit !== undefined && requirement.hasImperialMerit) {
            const hasImperialMerit = (this.inventory.imperial_merit ?? 0) > 0;
            if (!hasImperialMerit) {
                missing.push("需要获得皇室功勋");
            }
        }
        // 检查属性要求
        for (const [key, value] of Object.entries(requirement)) {
            if (typeof value !== "number")
                continue;
            if (key in this.stats) {
                const statKey = key;
                if (this.stats[statKey] < value) {
                    missing.push(`${this.getStatDisplayName(statKey)}需要${value}（当前${this.stats[statKey]}）`);
                }
            }
            else if (key.startsWith("npc_")) {
                const npcKey = key.replace("npc_", "");
                const npcValue = this.npcRelations[npcKey] ?? 0;
                if (npcValue < value) {
                    missing.push(`${this.getNpcDisplayName(npcKey)}好感需要${value}（当前${npcValue}）`);
                }
            }
        }
        return {
            met: missing.length === 0,
            missing,
        };
    }
    /**
     * 尝试升职
     */
    tryPromotion(conditions) {
        // 按优先级排序
        const sortedConditions = [...conditions].sort((a, b) => a.priority - b.priority);
        for (const condition of sortedConditions) {
            const check = this.checkPromotionRequirement(condition.requirements);
            if (check.met) {
                return {
                    success: true,
                    conditionId: condition.id,
                    missingRequirements: [],
                };
            }
        }
        // 没有满足任何条件，返回第一个条件的缺失要求
        const firstCheck = this.checkPromotionRequirement(sortedConditions[0].requirements);
        return {
            success: false,
            missingRequirements: firstCheck.missing,
        };
    }
    /**
     * 执行升职
     */
    promote(newPosition) {
        this.position = newPosition;
    }
    /**
     * 获取属性显示名称
     */
    getStatDisplayName(stat) {
        const names = {
            appearance: "容貌",
            scheming: "心机",
            status: "名声",
            network: "人脉",
            favor: "宠爱",
            health: "健康",
            cash: "现银",
            business: "商业",
        };
        return names[stat] ?? stat;
    }
    /**
     * 获取NPC显示名称
     */
    getNpcDisplayName(npcKey) {
        const names = {
            matron: "主母",
            jinshu: "少爷",
        };
        return names[npcKey] ?? npcKey;
    }
}
