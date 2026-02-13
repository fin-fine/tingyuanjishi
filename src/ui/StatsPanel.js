import { NPCImpressionPopup } from "./NPCImpressionPopup.js";
export class StatsPanel {
    constructor(player, world) {
        this.player = player;
        this.world = world;
        const el = document.getElementById("stats");
        if (!el) {
            throw new Error("Missing stats container.");
        }
        this.container = el;
        this.impressionPopup = new NPCImpressionPopup();
    }
    render() {
        const stats = this.player.stats;
        const tiers = {
            appearance: ["素雅", "清秀", "妍丽", "倾城", "绝色"],
            scheming: ["稚拙", "机巧", "深算", "老成", "深谋"],
            status: ["微末", "小名", "有声", "显赫", "鼎盛"],
            network: ["孤立", "相识", "相交", "广结", "门庭"],
            favor: ["冷淡", "薄宠", "偏爱", "专宠", "独宠"],
            health: ["羸弱", "欠安", "稳健", "康健", "强盛"],
            cash: ["拮据", "薄资", "小富", "丰足", "富庶"],
            business: ["门外", "入门", "熟稔", "精通", "巨贾"],
        };
        const relationTiers = [
            "疏离",
            "淡漠",
            "尚可",
            "信任",
            "倚重",
        ];
        const ratingFor = (key, value) => {
            if (value < 30) {
                return tiers[key][0];
            }
            if (value < 50) {
                return tiers[key][1];
            }
            if (value < 70) {
                return tiers[key][2];
            }
            if (value < 90) {
                return tiers[key][3];
            }
            return tiers[key][4];
        };
        const withRating = (key, value) => `${value.toFixed(1)} · ${ratingFor(key, value)}`;
        const relationRating = (value) => {
            if (value < 20) {
                return relationTiers[0];
            }
            if (value < 40) {
                return relationTiers[1];
            }
            if (value < 60) {
                return relationTiers[2];
            }
            if (value < 80) {
                return relationTiers[3];
            }
            return relationTiers[4];
        };
        const ageMonthsTotal = Math.max(0, this.world.turn - 1);
        const ageYears = 15 + Math.floor(ageMonthsTotal / 12);
        const ageMonths = ageMonthsTotal % 12;
        const ageDisplay = ageMonths > 0 ? `${ageYears}岁${ageMonths}月` : `${ageYears}岁`;
        const matronLabel = this.world.stage <= 1 ? "赵嬷嬷" : "少夫人";
        const matronValue = this.player.npcRelations.matron ?? 0;
        const matronDisplay = `${matronValue.toFixed(1)} · ${relationRating(matronValue)}`;
        const servantsValue = (stats.status + stats.network) / 2;
        const npcImpressions = this.player.npcImpressions ?? {};
        const fallbackImpression = (label, value) => {
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
        };
        const childrenImpression = () => {
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
        };
        // 动态构建NPC条目，包括姨娘
        const npcEntries = [
            { key: "young_master", label: "少爷", value: stats.favor, show: true },
            { key: "matron", label: matronLabel, value: matronValue, show: true },
        ];
        // 林姨娘
        const hasLinConcubine = this.player.history.has("s2_lin_concubine_enter");
        if (hasLinConcubine) {
            npcEntries.push({
                key: "lin_concubine",
                label: "林姨娘",
                value: this.player.npcRelations.lin_concubine ?? 0,
                show: true,
            });
        }
        // 王姨娘（如果没被驱逐）
        const hasWangConcubine = this.player.history.has("s2_wang_concubine_enter");
        const wangExpelled = this.player.history.has("s2_wang_concubine_elope_exposed");
        if (hasWangConcubine && !wangExpelled) {
            npcEntries.push({
                key: "wang_concubine",
                label: "王姨娘",
                value: this.player.npcRelations.wang_concubine ?? 0,
                show: true,
            });
        }
        // 苏姨娘
        const hasSuConcubine = this.player.history.has("s2_su_concubine_enter");
        if (hasSuConcubine) {
            npcEntries.push({
                key: "su_concubine",
                label: "苏姨娘",
                value: this.player.npcRelations.su_concubine ?? 0,
                show: true,
            });
        }
        npcEntries.push({ key: "children", label: "子嗣", value: 0, show: true }, { key: "servants", label: "府中下人", value: servantsValue, show: true });
        const npcLines = npcEntries
            .filter((entry) => entry.show)
            .map((entry) => {
            let text = npcImpressions[entry.key];
            if (!text) {
                text = entry.key === "children"
                    ? childrenImpression()
                    : fallbackImpression(entry.label, entry.value);
            }
            return `<div class="stat-item stat-item--full stat-item--npc-name" data-npc-key="${entry.key}" data-npc-label="${entry.label}" data-npc-impression="${this.escapeHtml(text)}">${entry.label}</div>`;
        })
            .join("");
        const nameLabel = this.player.name ? ` · ${this.player.name}` : "";
        const businessDisplay = this.world.stage >= 3
            ? `<div class="stat-item">商业 <span>${withRating("business", stats.business)}</span></div>`
            : '';
        const matronImpressionLabel = this.world.stage <= 1 ? "嬷嬷印象" : "少夫人印象";
        const npcSection = `
      <div class="stat-item stat-item--full stat-item--header">NPC印象（点击查看详情）</div>
      ${npcLines}
    `;
        this.container.innerHTML = `
      <h3 class="panel-title">笼中雀${nameLabel}</h3>
      <div class="stat-item">身份 <span>${this.player.position}</span></div>
      <div class="stat-item">年纪 <span>${ageDisplay}</span></div>
      <div class="stat-item">回合 <span>${this.world.turn}/${this.world.maxTurn}</span></div>
      <div class="stat-item">行动力 <span>${this.world.ap}/${this.world.maxAp}</span></div>
      <div class="stat-item">${matronImpressionLabel} <span>${matronDisplay}</span></div>
      <div class="stat-item">容貌 <span>${withRating("appearance", stats.appearance)}</span></div>
      <div class="stat-item">心机 <span>${withRating("scheming", stats.scheming)}</span></div>
      <div class="stat-item">名声 <span>${withRating("status", stats.status)}</span></div>
      <div class="stat-item">人脉 <span>${withRating("network", stats.network)}</span></div>
      <div class="stat-item">宠爱 <span>${withRating("favor", stats.favor)}</span></div>
      <div class="stat-item">健康 <span>${withRating("health", stats.health)}</span></div>
      <div class="stat-item">银钱 <span>${withRating("cash", stats.cash)}</span></div>
      ${businessDisplay}
      ${npcSection}
    `;
        // 添加NPC印象点击事件
        this.container.querySelectorAll(".stat-item--npc-name").forEach((el) => {
            el.addEventListener("click", () => {
                const npcLabel = el.getAttribute("data-npc-label");
                const npcImpression = el.getAttribute("data-npc-impression");
                if (npcLabel && npcImpression) {
                    this.impressionPopup.show(npcLabel, this.unescapeHtml(npcImpression));
                }
            });
        });
    }
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
    unescapeHtml(text) {
        const div = document.createElement("div");
        div.innerHTML = text;
        return div.textContent || "";
    }
}
