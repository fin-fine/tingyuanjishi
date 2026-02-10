export class Player {
    constructor() {
        this.stats = {
            appearance: 65,
            scheming: 40,
            status: 15,
            network: 10,
            favor: 20,
            health: 75,
            cash: 5,
        };
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
