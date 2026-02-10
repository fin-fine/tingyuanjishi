export class TimePanel {
    constructor(world) {
        this.world = world;
        const el = document.getElementById("time");
        if (!el) {
            throw new Error("Missing time container.");
        }
        this.container = el;
    }
    render() {
        const start = this.formatGameDate(1);
        const current = this.formatGameDate(this.world.turn);
        this.container.innerHTML = `
      <div class="time-label">开局：${start}</div>
      <div class="time-label">当前：${current}</div>
    `;
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
