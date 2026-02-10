export class StatsPanel {
    constructor(player, world) {
        this.player = player;
        this.world = world;
        const el = document.getElementById("stats");
        if (!el) {
            throw new Error("Missing stats container.");
        }
        this.container = el;
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
        };
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
        const nameLabel = this.player.name ? ` · ${this.player.name}` : "";
        this.container.innerHTML = `
      <h3 class="panel-title">笼中雀${nameLabel}</h3>
      <div class="stat-item">回合 <span>${this.world.turn}/${this.world.maxTurn}</span></div>
      <div class="stat-item">行动力 <span>${this.world.ap}/${this.world.maxAp}</span></div>
      <div class="stat-item">容貌 <span>${withRating("appearance", stats.appearance)}</span></div>
      <div class="stat-item">心机 <span>${withRating("scheming", stats.scheming)}</span></div>
      <div class="stat-item">名声 <span>${withRating("status", stats.status)}</span></div>
      <div class="stat-item">人脉 <span>${withRating("network", stats.network)}</span></div>
      <div class="stat-item">宠爱 <span>${withRating("favor", stats.favor)}</span></div>
      <div class="stat-item">健康 <span>${withRating("health", stats.health)}</span></div>
      <div class="stat-item">银钱 <span>${withRating("cash", stats.cash)}</span></div>
    `;
    }
}
