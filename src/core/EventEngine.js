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
            business: true,
        };
    }
    async loadAll() {
        const sources = [
            "./data/events_stage1.json",
            "./data/events_stage2.json",
            "./data/events_stage3.json",
            "./data/events_business.json",
            "./data/events_children.json",
        ];
        const responses = await Promise.all(sources.map((path) => fetch(path)));
        const payloads = await Promise.all(responses.map((response) => response.json()));
        this.events = payloads.flat();
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
        const outcome = this.pickOutcome(option, player);
        if (outcome) {
            cost = outcome.cost ?? cost;
            reward = outcome.reward ?? reward;
            resultText = outcome.resultText ?? resultText;
            endState = outcome.end ?? endState;
        }
        if (!outcome) {
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
        if (key === "npc_matron_over_favor") {
            const matronTrust = player.npcRelations["matron"] ?? 0;
            const favor = player.stats.favor ?? 0;
            const result = matronTrust > favor;
            if (typeof value === "boolean") {
                return result === value;
            }
            return result;
        }
        if (key.startsWith("npc_")) {
            const npcKey = key.replace("npc_", "");
            return Formula.compare(player.npcRelations[npcKey] ?? 0, value);
        }
        if (key.startsWith("item_")) {
            const itemKey = key.replace("item_", "");
            return Formula.compare(player.inventory[itemKey] ?? 0, value);
        }
        if (key.startsWith("event_")) {
            const eventId = key.replace("event_", "");
            const hasTriggered = player.history.has(eventId);
            if (typeof value === "boolean") {
                return hasTriggered === value;
            }
            return hasTriggered;
        }
        if (key === "turn_range" && Array.isArray(value)) {
            const [start, end] = value;
            return world.turn >= start && world.turn <= end;
        }
        if (key === "has_children") {
            const hasChildren = player.children.length > 0;
            if (typeof value === "boolean") {
                return hasChildren === value;
            }
            return hasChildren;
        }
        return true;
    }
    isStatKey(key) {
        return key in this.statKeySet;
    }
    pickOutcome(option, player) {
        const statKey = option.outcomeStat;
        if (!statKey || !this.isStatKey(statKey) || !option.outcomes?.length) {
            return null;
        }
        const statValue = player.stats[statKey] ?? 0;
        const sorted = [...option.outcomes].sort((a, b) => (b.min ?? 0) - (a.min ?? 0));
        for (const tier of sorted) {
            const min = tier.min ?? 0;
            const max = tier.max;
            if (statValue >= min && (typeof max !== "number" || statValue <= max)) {
                return tier;
            }
        }
        return sorted[sorted.length - 1] ?? null;
    }
}
