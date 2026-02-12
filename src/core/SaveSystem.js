export class SaveSystem {
    constructor() {
        this.keyBase = "story_sim_save";
        this.legacyKey = "story_sim_legacy";
        this.slotOrder = ["auto", "slot1", "slot2", "slot3"];
        this.slotLabels = {
            auto: "自动存档",
            slot1: "一号存档",
            slot2: "二号存档",
            slot3: "三号存档",
        };
    }
    saveAuto(player, world, logs, extra) {
        this.writeSlot("auto", player, world, logs, extra);
    }
    saveSlot(slotId, player, world, logs, extra) {
        if (slotId === "auto") {
            return;
        }
        this.writeSlot(slotId, player, world, logs, extra);
    }
    loadSlot(slotId) {
        if (!this.isSlotId(slotId)) {
            return null;
        }
        return this.readSlot(slotId);
    }
    getSlots() {
        return this.slotOrder.map((id) => ({
            id,
            label: this.slotLabels[id] ?? id,
            meta: this.readMeta(id),
            isAuto: id === "auto",
        }));
    }
    clearAll() {
        this.slotOrder.forEach((slotId) => {
            localStorage.removeItem(this.keyFor(slotId));
        });
    }
    writeSlot(slotId, player, world, logs, extra) {
        if (!this.isSlotId(slotId)) {
            return;
        }
        const payload = {
            player: player.serialize(),
            world: world.serialize(),
            meta: this.buildMeta(player, world),
            logs,
            ...extra,
        };
        localStorage.setItem(this.keyFor(slotId), JSON.stringify(payload));
    }
    readSlot(slotId) {
        const raw = localStorage.getItem(this.keyFor(slotId));
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    readMeta(slotId) {
        const payload = this.readSlot(slotId);
        return payload?.meta ?? null;
    }
    keyFor(slotId) {
        return `${this.keyBase}_${slotId}`;
    }
    isSlotId(slotId) {
        return this.slotOrder.includes(slotId);
    }
    buildMeta(player, world) {
        return {
            savedAt: Date.now(),
            month: world.month,
            turn: world.turn,
            ap: world.ap,
            favor: player.stats.favor,
            health: player.stats.health,
            cash: player.stats.cash,
        };
    }
    saveLegacy(player, world) {
        const legacy = {
            stats: { ...player.stats },
            turn: world.turn,
            month: world.month,
            savedAt: Date.now(),
        };
        localStorage.setItem(this.legacyKey, JSON.stringify(legacy));
    }
    loadLegacy() {
        const raw = localStorage.getItem(this.legacyKey);
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    clearLegacy() {
        localStorage.removeItem(this.legacyKey);
    }
}
