const STAT_LABELS = {
    appearance: "容貌",
    scheming: "心机",
    status: "名声",
    network: "人脉",
    favor: "宠爱",
    health: "健康",
    cash: "银钱",
};
export class IntroPanel {
    constructor(player) {
        this.player = player;
        this.currentBonus = {};
        this.remaining = 0;
        this.budget = 0;
        this.extraPoints = 10;
        this.minStat = 10;
        this.maxStat = 90;
        this.currentBackgroundId = "maid";
        // 所有身份的基础属性总和都是280点，但分配不同
        this.backgrounds = [
            {
                id: "maid",
                name: "府中旧仆",
                desc: "自幼在府中长大，熟悉规矩人情。",
                baseStats: {
                    appearance: 35,
                    scheming: 38,
                    status: 45,
                    network: 48,
                    favor: 40,
                    health: 40,
                    cash: 34,
                },
                bonus: { network: 6, status: 4, appearance: -2 },
            },
            {
                id: "scholar",
                name: "书香遗孤",
                desc: "诗书传家，因变故入府。识字懂礼。",
                baseStats: {
                    appearance: 40,
                    scheming: 48,
                    status: 44,
                    network: 36,
                    favor: 40,
                    health: 38,
                    cash: 34,
                },
                bonus: { scheming: 6, status: 3, cash: -2 },
            },
            {
                id: "merchant",
                name: "商贾之女",
                desc: "家道中落，仍有些积蓄和人脉。",
                baseStats: {
                    appearance: 38,
                    scheming: 40,
                    status: 35,
                    network: 46,
                    favor: 40,
                    health: 39,
                    cash: 42,
                },
                bonus: { cash: 8, network: 4, status: -3 },
            },
            {
                id: "peasant",
                name: "农家女子",
                desc: "淳朴勤劳，身体强健，但见识有限。",
                baseStats: {
                    appearance: 40,
                    scheming: 32,
                    status: 34,
                    network: 36,
                    favor: 40,
                    health: 50,
                    cash: 48,
                },
                bonus: { health: 8, appearance: 2, scheming: -5, status: -3 },
            },
            {
                id: "performer",
                name: "梨园伶人",
                desc: "曾入戏班学艺，容貌出众，善察言观色。",
                baseStats: {
                    appearance: 50,
                    scheming: 44,
                    status: 32,
                    network: 35,
                    favor: 40,
                    health: 42,
                    cash: 37,
                },
                bonus: { appearance: 8, scheming: 4, status: -4, network: -2 },
            },
            {
                id: "doctor",
                name: "医女之后",
                desc: "略通医理，知药性，但出身微末。",
                baseStats: {
                    appearance: 38,
                    scheming: 43,
                    status: 36,
                    network: 40,
                    favor: 40,
                    health: 48,
                    cash: 35,
                },
                bonus: { health: 6, scheming: 3, network: 2, cash: -3 },
            },
            {
                id: "fallen",
                name: "没落世家",
                desc: "祖上曾显赫一时，如今破落，徒有虚名。",
                baseStats: {
                    appearance: 42,
                    scheming: 46,
                    status: 48,
                    network: 38,
                    favor: 40,
                    health: 34,
                    cash: 32,
                },
                bonus: { status: 6, scheming: 5, cash: -4, health: -3 },
            },
            {
                id: "orphan",
                name: "无根浮萍",
                desc: "自小流离失所，全凭己力求生。",
                baseStats: {
                    appearance: 37,
                    scheming: 44,
                    status: 30,
                    network: 33,
                    favor: 40,
                    health: 45,
                    cash: 51,
                },
                bonus: { scheming: 4, health: 3, status: -6, network: -4 },
            },
        ];
        const el = document.getElementById("event");
        if (!el) {
            throw new Error("Missing event container.");
        }
        this.container = el;
        this.baseStats = { ...player.stats };
        this.currentStats = { ...player.stats };
    }
    render(onConfirm) {
        this.baseStats = { ...this.player.stats };
        this.applyBackground(this.currentBackgroundId);
        this.container.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "intro";
        const title = document.createElement("h2");
        title.textContent = "初入侯府";
        const story = document.createElement("div");
        story.className = "intro-story";
        story.innerHTML = `
      <p>大雍景和十二年三月初一，春寒料峭。侯府晨钟初响，你被唤至正院听命。</p>
      <p>你原是大夫人身边的二等丫鬟，素以本分懂事著称。今晨奉命，指给侯府独子谢云峥（十八）作通房丫头。</p>
      <p>主角姓名可自定，出身与资质未定，命数尚可改写。入院之前，需先定下底色，以应这深宅将来的风起云涌。</p>
    `;
        const backgroundWrap = document.createElement("div");
        backgroundWrap.className = "intro-section";
        backgroundWrap.innerHTML = "<h3 class=\"panel-title\">出身设定</h3>";
        const nameWrap = document.createElement("div");
        nameWrap.className = "intro-section";
        nameWrap.innerHTML = "<h3 class=\"panel-title\">姓名</h3>";
        const nameField = document.createElement("input");
        nameField.type = "text";
        nameField.className = "intro-name";
        nameField.placeholder = "请填写姓名";
        nameField.value = this.player.name;
        nameWrap.appendChild(nameField);
        const backgroundList = document.createElement("div");
        backgroundList.className = "intro-backgrounds";
        const backgroundInputs = new Map();
        this.backgrounds.forEach((preset) => {
            const label = document.createElement("label");
            label.className = "intro-background";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "intro-background";
            input.value = preset.id;
            input.checked = preset.id === this.currentBackgroundId;
            input.addEventListener("change", () => {
                this.currentBackgroundId = preset.id;
                this.applyBackground(preset.id);
                refreshStats();
            });
            const text = document.createElement("div");
            text.className = "intro-background-text";
            text.innerHTML = `
        <div class=\"intro-background-name\">${preset.name}</div>
        <div class=\"muted\">${preset.desc}</div>
      `;
            label.appendChild(input);
            label.appendChild(text);
            backgroundList.appendChild(label);
            backgroundInputs.set(preset.id, input);
        });
        const backgroundActions = document.createElement("div");
        backgroundActions.className = "intro-actions";
        const randomBackgroundButton = document.createElement("button");
        randomBackgroundButton.type = "button";
        randomBackgroundButton.textContent = "出身随机";
        randomBackgroundButton.addEventListener("click", () => {
            const picks = this.backgrounds.map((item) => item.id);
            const nextId = picks[Math.floor(Math.random() * picks.length)];
            this.currentBackgroundId = nextId;
            const input = backgroundInputs.get(nextId);
            if (input) {
                input.checked = true;
            }
            this.applyBackground(nextId);
            refreshStats();
        });
        backgroundActions.appendChild(randomBackgroundButton);
        backgroundWrap.appendChild(backgroundList);
        backgroundWrap.appendChild(backgroundActions);
        const statsWrap = document.createElement("div");
        statsWrap.className = "intro-section";
        statsWrap.innerHTML = "<h3 class=\"panel-title\">人物属性生成</h3>";
        const remainingEl = document.createElement("div");
        remainingEl.className = "intro-remaining";
        const statList = document.createElement("div");
        statList.className = "intro-stats";
        const rows = new Map();
        Object.keys(STAT_LABELS).forEach((key) => {
            const row = document.createElement("div");
            row.className = "intro-stat";
            const label = document.createElement("span");
            label.textContent = STAT_LABELS[key];
            const value = document.createElement("span");
            value.className = "intro-stat-value";
            const controls = document.createElement("div");
            controls.className = "intro-stat-controls";
            const minus = document.createElement("button");
            minus.type = "button";
            minus.textContent = "-";
            minus.addEventListener("click", () => {
                this.adjustStat(key, -1);
                refreshStats();
            });
            const plus = document.createElement("button");
            plus.type = "button";
            plus.textContent = "+";
            plus.addEventListener("click", () => {
                this.adjustStat(key, 1);
                refreshStats();
            });
            controls.appendChild(minus);
            controls.appendChild(plus);
            row.appendChild(label);
            row.appendChild(value);
            row.appendChild(controls);
            statList.appendChild(row);
            rows.set(key, { value, minus, plus });
        });
        const actions = document.createElement("div");
        actions.className = "intro-actions";
        const randomButton = document.createElement("button");
        randomButton.type = "button";
        randomButton.textContent = "属性随机";
        randomButton.addEventListener("click", () => {
            this.randomizeStats();
            refreshStats();
        });
        const resetButton = document.createElement("button");
        resetButton.type = "button";
        resetButton.textContent = "重置";
        resetButton.addEventListener("click", () => {
            this.applyBackground(this.currentBackgroundId);
            refreshStats();
        });
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "入府";
        confirmButton.addEventListener("click", () => {
            const name = nameField.value.trim() || "无名";
            const background = this.backgrounds.find((entry) => entry.id === this.currentBackgroundId) ?? this.backgrounds[0];
            onConfirm({
                name,
                backgroundId: background.id,
                backgroundName: background.name,
                stats: { ...this.currentStats },
                backgroundBonus: this.getBonusStats(),
            });
        });
        actions.appendChild(randomButton);
        actions.appendChild(resetButton);
        actions.appendChild(confirmButton);
        statsWrap.appendChild(remainingEl);
        statsWrap.appendChild(statList);
        statsWrap.appendChild(actions);
        wrap.appendChild(title);
        wrap.appendChild(story);
        wrap.appendChild(nameWrap);
        wrap.appendChild(backgroundWrap);
        wrap.appendChild(statsWrap);
        this.container.appendChild(wrap);
        const refreshStats = () => {
            remainingEl.textContent = `可分配点数：${this.remaining}`;
            rows.forEach((row, key) => {
                const bonus = this.getBonusValue(key);
                const effective = this.clampEffective(this.currentStats[key] + bonus);
                const { min, max } = this.getBaseBounds(key);
                row.value.textContent = effective.toFixed(1);
                row.minus.disabled = this.currentStats[key] <= min;
                row.plus.disabled = this.remaining <= 0 || this.currentStats[key] >= max;
            });
        };
        refreshStats();
    }
    applyBackground(backgroundId) {
        const preset = this.backgrounds.find((entry) => entry.id === backgroundId) ?? this.backgrounds[0];
        this.currentBonus = { ...preset.bonus };
        // 使用该身份的基础属性
        this.baseStats = { ...preset.baseStats };
        this.currentStats = { ...preset.baseStats };
        // 所有身份总属性点=280(基础)+10(自由分配)=290
        this.budget = this.sumStats(this.baseStats) + this.extraPoints;
        this.remaining = this.extraPoints;
    }
    adjustStat(key, delta) {
        if (delta > 0 && this.remaining <= 0) {
            return;
        }
        const next = this.clampBase(key, this.currentStats[key] + delta);
        const applied = next - this.currentStats[key];
        if (applied === 0) {
            return;
        }
        if (applied > 0 && this.remaining < applied) {
            return;
        }
        this.currentStats[key] = next;
        this.remaining -= applied;
    }
    randomizeStats() {
        const randomStats = { ...this.currentStats };
        Object.keys(STAT_LABELS).forEach((key) => {
            const jitter = Math.floor(Math.random() * 21) - 10;
            randomStats[key] = this.clampBase(key, this.currentStats[key] + jitter);
        });
        this.normalizeToBudget(randomStats, this.budget);
        this.currentStats = randomStats;
        this.remaining = Math.max(0, this.budget - this.sumStats(this.currentStats));
    }
    normalizeToBudget(stats, budget) {
        let total = this.sumStats(stats);
        const keys = Object.keys(STAT_LABELS);
        const pickKey = (direction) => {
            const filtered = keys.filter((key) => {
                const { min, max } = this.getBaseBounds(key);
                return direction === "up" ? stats[key] < max : stats[key] > min;
            });
            if (!filtered.length) {
                return null;
            }
            return filtered[Math.floor(Math.random() * filtered.length)];
        };
        while (total < budget) {
            const key = pickKey("up");
            if (!key) {
                break;
            }
            stats[key] = this.clampBase(key, stats[key] + 1);
            total += 1;
        }
        while (total > budget) {
            const key = pickKey("down");
            if (!key) {
                break;
            }
            stats[key] = this.clampBase(key, stats[key] - 1);
            total -= 1;
        }
    }
    sumStats(stats) {
        return Object.values(stats).reduce((sum, value) => sum + value, 0);
    }
    getBonusValue(key) {
        return this.currentBonus[key] ?? 0;
    }
    getBonusStats() {
        const stats = { ...this.currentStats };
        Object.keys(STAT_LABELS).forEach((key) => {
            stats[key] = this.getBonusValue(key);
        });
        return stats;
    }
    getBaseBounds(key) {
        const bonus = this.getBonusValue(key);
        // 最小值为该身份的基础属性值，不能低于此值
        const preset = this.backgrounds.find((entry) => entry.id === this.currentBackgroundId) ?? this.backgrounds[0];
        const baseValue = preset.baseStats[key];
        const min = baseValue;
        const max = this.maxStat - bonus;
        return { min, max };
    }
    clampBase(key, value) {
        const { min, max } = this.getBaseBounds(key);
        return Math.max(min, Math.min(max, value));
    }
    clampEffective(value) {
        return Math.max(this.minStat, Math.min(this.maxStat, value));
    }
}
