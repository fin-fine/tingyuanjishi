export class LogPanel {
    constructor() {
        const el = document.getElementById("log");
        if (!el) {
            throw new Error("Missing log container.");
        }
        this.container = el;
    }
    render(entries) {
        this.container.innerHTML = "";
        const title = document.createElement("h3");
        title.className = "panel-title";
        title.textContent = "日志";
        this.container.appendChild(title);
        if (!entries.length) {
            const empty = document.createElement("div");
            empty.className = "muted";
            empty.textContent = "暂无记录。";
            this.container.appendChild(empty);
            return;
        }
        const list = document.createElement("div");
        list.className = "log-list";
        const ordered = [...entries].reverse();
        for (const entry of ordered) {
            const row = document.createElement("div");
            row.className = "log-row";
            const header = document.createElement("div");
            header.className = "log-header";
            const timeText = this.formatGameDate(entry.turn);
            header.textContent = `${timeText} · 回合${entry.turn} · ${entry.eventTitle}`;
            row.appendChild(header);
            if (entry.optionText) {
                const choice = document.createElement("div");
                choice.className = "log-choice";
                choice.textContent = `选择：${entry.optionText}`;
                row.appendChild(choice);
            }
            if (entry.resultText) {
                const result = document.createElement("div");
                result.className = "log-result";
                result.textContent = entry.resultText;
                row.appendChild(result);
            }
            const deltaText = this.formatDelta(entry);
            if (deltaText) {
                const delta = document.createElement("div");
                delta.className = "log-delta";
                delta.textContent = deltaText;
                row.appendChild(delta);
            }
            list.appendChild(row);
        }
        this.container.appendChild(list);
    }
    formatDelta(entry) {
        const parts = [];
        if (entry.delta) {
            parts.push(...this.formatPlayerDelta(entry.delta));
        }
        if (entry.worldDelta) {
            parts.push(...this.formatWorldDelta(entry.worldDelta));
        }
        return parts.length ? `变化：${parts.join("，")}` : "";
    }
    formatPlayerDelta(delta) {
        const labels = {
            appearance: "容貌",
            scheming: "心机",
            status: "名声",
            network: "人脉",
            favor: "宠爱",
            health: "健康",
            cash: "银钱",
            business: "生意",
        };
        const parts = [];
        for (const [key, value] of Object.entries(delta)) {
            if (!value) {
                continue;
            }
            const label = labels[key] ?? this.labelForKey(key);
            parts.push(`${label}${this.formatSigned(value)}`);
        }
        return parts;
    }
    formatWorldDelta(delta) {
        const labels = {
            turn: "回合",
            month: "月份",
            ap: "行动力",
        };
        const parts = [];
        for (const [key, value] of Object.entries(delta)) {
            if (!value) {
                continue;
            }
            const label = labels[key] ?? key;
            parts.push(`${label}${this.formatSigned(value)}`);
        }
        return parts;
    }
    labelForKey(key) {
        if (key.startsWith("npc_")) {
            const npcName = key.replace("npc_", "");
            const npcLabels = {
                matron: "主母",
                master: "少爷",
                overseer: "管事",
                steward: "家仆",
            };
            return `${npcLabels[npcName] || npcName}印象`;
        }
        if (key.startsWith("item_")) {
            const itemKey = key.replace("item_", "");
            const itemLabels = {
                after_sleep: "安寝",
                after_murmur: "闲言",
                pregnancy_risk: "怀孕风险",
                in_study: "书房纸",
                gift: "礼物",
                white_moon: "白月",
                gossip: "风声",
                tonic: "补汤",
                preg_seed: "孕种",
                preg_confirm: "喜信",
                preg_stage: "孕期",
                rumor_active: "流言",
                child: "子嗣",
                child_care: "照看",
                matron_escape_help: "主母出走·助",
                matron_escape_refuse: "主母出走·拒",
                matron_escape_ignore: "主母出走·弃",
                matron_escaped: "主母出走·成",
                matron_confined: "主母出走·囚",
            };
            const label = itemLabels[itemKey];
            return label ? `物品(${label})` : "物品";
        }
        return key;
    }
    formatSigned(value) {
        const display = Number.isInteger(value) ? value.toString() : value.toFixed(1);
        return value > 0 ? `+${display}` : display;
    }
    formatGameDate(turn) {
        const startMonth = 3;
        const startYear = 12;
        const monthIndex = startMonth - 1 + Math.max(0, turn - 1);
        const year = startYear + Math.floor(monthIndex / 12);
        const month = (monthIndex % 12) + 1;
        return `大雍景和${year}年${this.formatMonth(month)}`;
    }
    formatMonth(month) {
        const names = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
        const safe = Math.max(1, Math.min(12, Math.round(month)));
        return `${names[safe - 1]}月`;
    }
}
