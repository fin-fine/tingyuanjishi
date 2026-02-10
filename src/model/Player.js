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
        };
        this.name = "";
        this.backgroundId = "";
        this.backgroundName = "";
        this.stats = { ...this.defaultStats };
        this.npcRelations = {
            jinshu: 0,
            matron: 0,
        };
        this.inventory = {};
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
        this.stats = { ...this.defaultStats };
        this.npcRelations = {
            jinshu: 0,
            matron: 0,
        };
        this.inventory = {};
        this.history = new Set();
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
            stats: this.stats,
            npcRelations: this.npcRelations,
            history: Array.from(this.history),
            inventory: this.inventory,
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
        if (parsed.stats) {
            this.stats = { ...this.stats, ...parsed.stats };
        }
        if (parsed.npcRelations) {
            this.npcRelations = { ...this.npcRelations, ...parsed.npcRelations };
        }
        if (parsed.history) {
            this.history = new Set(parsed.history);
        }
        if (parsed.inventory) {
            this.inventory = { ...this.inventory, ...parsed.inventory };
        }
    }
}
