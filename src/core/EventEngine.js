import { Formula } from "../utils/Formula.js";
export class EventEngine {
    constructor() {
        this.events = [];
        this.statKeySet = {
            appearance: true,
            scheming: true,
            status: true,
            network: true,
            favor: true,
            health: true,
            cash: true,
        };
    }
    async loadAll() {
        const response = await fetch("./data/events.json");
        this.events = (await response.json());
    }
    pickEvent(player, world, predicate) {
        const candidates = [];
        for (const event of this.events) {
            if (predicate && !predicate(event)) {
                continue;
            }
            if (!this.checkConditions(event, player, world)) {
                continue;
            }
            if (event.once && player.history.has(event.id)) {
                continue;
            }
            const rawWeight = event.weight;
            const weight = typeof rawWeight === "number" ? rawWeight : 1;
            if (weight <= 0) {
                continue;
            }
            candidates.push({ event, weight });
        }
        if (!candidates.length) {
            return null;
        }
        const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = Math.random() * total;
        for (const entry of candidates) {
            roll -= entry.weight;
            if (roll <= 0) {
                return entry.event;
            }
        }
        return candidates[candidates.length - 1].event;
    }
    findEventById(id) {
        return this.events.find((event) => event.id === id) ?? null;
    }
    applyOption(event, optionId, player, world, context) {
        const option = event.options.find((opt) => opt.id === optionId);
        if (!option) {
            return { text: "选项无效。" };
        }
        if (option.require && !this.checkConditionGroup(option.require, player, world)) {
            return { text: option.failText ?? "条件不足。" };
        }
        const consumeAp = context?.consumeAp !== false;
        const apCost = option.apCost ?? 1;
        if (consumeAp && apCost > world.ap) {
            return { text: "行动力不足，今日不宜强行。" };
        }
        let cost = option.cost;
        let reward = option.reward;
        let resultText = option.resultText ?? "";
        let endState = option.end;
        let chance = option.chance;
        if (option.chanceStat && this.isStatKey(option.chanceStat)) {
            const statKey = option.chanceStat;
            const statValue = player.stats[statKey] ?? 0;
            const derived = Math.max(0.05, Math.min(0.95, statValue / 100));
            chance = typeof chance === "number" ? chance * derived : derived;
        }
        if (typeof chance === "number") {
            const roll = Math.random();
            if (roll > chance) {
                cost = option.failCost;
                reward = option.failReward;
                resultText = option.failResultText ?? option.failText ?? resultText;
            }
        }
        const applied = {};
        const mergeDelta = (delta) => {
            for (const [key, value] of Object.entries(delta)) {
                applied[key] = (applied[key] ?? 0) + value;
            }
        };
        if (cost) {
            player.applyDelta(cost);
            mergeDelta(cost);
        }
        if (reward) {
            player.applyDelta(reward);
            mergeDelta(reward);
        }
        if (!endState && player.stats.health <= 0) {
            endState = {
                type: "death",
                text: "你病势已重，撑不过这一夜。",
            };
        }
        if (event.once) {
            player.history.add(event.id);
        }
        if (consumeAp) {
            const advanced = world.spendAp(apCost);
            const favorGain = (reward?.favor ?? 0) > 0;
            if (favorGain) {
                world.monthsWithoutFavor = 0;
            }
            else if (advanced) {
                world.monthsWithoutFavor += 1;
                if (world.monthsWithoutFavor >= 3) {
                    player.stats.favor -= 5;
                }
                player.stats.appearance -= 0.5;
            }
        }
        return { text: resultText, end: endState, delta: Object.keys(applied).length ? applied : undefined };
    }
    checkConditions(event, player, world) {
        if (!event.trigger) {
            return true;
        }
        return this.checkConditionGroup(event.trigger, player, world);
    }
    checkConditionGroup(group, player, world) {
        const rawChance = group["chance"];
        if (typeof rawChance === "number") {
            let chance = rawChance;
            const statKey = group["chanceStat"];
            if (typeof statKey === "string" && this.isStatKey(statKey)) {
                const statValue = player.stats[statKey] ?? 0;
                const derived = Math.max(0.05, Math.min(0.95, statValue / 100));
                chance = chance * derived;
            }
            if (Math.random() > chance) {
                return false;
            }
        }
        for (const [key, value] of Object.entries(group)) {
            if (key === "chance" || key === "chanceStat") {
                continue;
            }
            if (!this.checkCondition(key, value, player, world)) {
                return false;
            }
        }
        return true;
    }
    checkCondition(key, value, player, world) {
        if (key === "month_range" && Array.isArray(value)) {
            const [start, end] = value;
            return world.month >= start && world.month <= end;
        }
        if (key.startsWith("stat_")) {
            const statKey = key.replace("stat_", "");
            if (!this.isStatKey(statKey)) {
                return false;
            }
            return Formula.compare(player.stats[statKey] ?? 0, value);
        }
        if (key.startsWith("npc_")) {
            const npcKey = key.replace("npc_", "");
            return Formula.compare(player.npcRelations[npcKey] ?? 0, value);
        }
        if (key.startsWith("item_")) {
            const itemKey = key.replace("item_", "");
            return Formula.compare(player.inventory[itemKey] ?? 0, value);
        }
        if (key === "turn_range" && Array.isArray(value)) {
            const [start, end] = value;
            return world.turn >= start && world.turn <= end;
        }
        return true;
    }
    isStatKey(key) {
        return key in this.statKeySet;
    }
}
