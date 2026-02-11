export class WorldState {
    constructor() {
        this.turn = 1;
        this.month = 3;
        this.ap = 3;
        this.maxAp = 3;
        this.maxTurn = 22;
        this.stage = 1;
        this.monthsWithoutFavor = 0;
        this.startTimestamp = Date.now();
        this.actionCount = 0;
        this.minutesPerAction = 240;
    }
    reset() {
        this.turn = 1;
        this.month = 3;
        this.ap = 3;
        this.maxAp = 3;
        this.maxTurn = 22;
        this.stage = 1;
        this.monthsWithoutFavor = 0;
        this.startTimestamp = Date.now();
        this.actionCount = 0;
        this.minutesPerAction = 240;
    }
    advanceTurn() {
        this.turn += 1;
        this.month = (this.month % 12) + 1;
        this.ap = this.maxAp;
    }
    spendAp(cost) {
        const safeCost = Math.max(0, Math.floor(cost));
        this.ap = Math.max(0, this.ap - safeCost);
        this.actionCount += safeCost;
        if (this.ap <= 0) {
            this.advanceTurn();
            return true;
        }
        return false;
    }
    getStartTimestamp() {
        return this.startTimestamp;
    }
    getCurrentTimestamp() {
        const minutes = this.actionCount * this.minutesPerAction;
        return this.startTimestamp + minutes * 60 * 1000;
    }
    serialize() {
        return {
            turn: this.turn,
            month: this.month,
            ap: this.ap,
            maxAp: this.maxAp,
            maxTurn: this.maxTurn,
            stage: this.stage,
            monthsWithoutFavor: this.monthsWithoutFavor,
            startTimestamp: this.startTimestamp,
            actionCount: this.actionCount,
            minutesPerAction: this.minutesPerAction,
        };
    }
    load(data) {
        if (!data || typeof data !== "object") {
            return;
        }
        const parsed = data;
        if (typeof parsed.turn === "number") {
            this.turn = parsed.turn;
        }
        if (typeof parsed.month === "number") {
            this.month = parsed.month;
        }
        if (typeof parsed.ap === "number") {
            this.ap = parsed.ap;
        }
        if (typeof parsed.maxAp === "number") {
            this.maxAp = parsed.maxAp;
        }
        if (typeof parsed.maxTurn === "number") {
            this.maxTurn = parsed.maxTurn;
        }
        if (typeof parsed.stage === "number") {
            this.stage = parsed.stage;
        }
        else if (typeof parsed.turn === "number" && parsed.turn > 22) {
            this.stage = 2;
        }
        else {
            this.stage = 1;
        }
        if (this.stage >= 2 && this.maxTurn < 23) {
            this.maxTurn = 120;
        }
        if (typeof parsed.monthsWithoutFavor === "number") {
            this.monthsWithoutFavor = parsed.monthsWithoutFavor;
        }
        if (typeof parsed.startTimestamp === "number") {
            this.startTimestamp = parsed.startTimestamp;
        }
        else {
            this.startTimestamp = Date.now();
        }
        if (typeof parsed.actionCount === "number") {
            this.actionCount = parsed.actionCount;
        }
        if (typeof parsed.minutesPerAction === "number") {
            this.minutesPerAction = parsed.minutesPerAction;
        }
    }
}
