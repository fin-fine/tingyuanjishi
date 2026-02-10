export class SavePanel {
    constructor() {
        const el = document.getElementById("save");
        if (!el) {
            throw new Error("Missing save container.");
        }
        this.container = el;
    }
    render(slots, onSave, onLoad) {
        const list = slots
            .map((slot) => {
            const meta = slot.meta ? this.formatMeta(slot.meta) : "空档";
            const saveDisabled = slot.isAuto;
            const loadDisabled = !slot.meta;
            return `
          <div class="save-row" data-slot="${slot.id}">
            <div class="save-title">${slot.label}</div>
            <div class="save-meta">${meta}</div>
            <div class="save-actions">
              <button class="shop-buy" data-action="save" ${saveDisabled ? "disabled" : ""}>写入</button>
              <button class="shop-buy" data-action="load" ${loadDisabled ? "disabled" : ""}>读取</button>
            </div>
          </div>
        `;
        })
            .join("");
        this.container.innerHTML = `
      <h3 class="panel-title">存档</h3>
      <div class="save-list">${list}</div>
      <div class="muted">自动存档会在关键节点自动覆盖。</div>
    `;
        const buttons = this.container.querySelectorAll(".save-actions .shop-buy");
        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                const row = button.closest(".save-row");
                const slotId = row?.dataset.slot;
                const action = button.dataset.action;
                if (!slotId || !action) {
                    return;
                }
                if (action === "save") {
                    onSave(slotId);
                }
                else if (action === "load") {
                    onLoad(slotId);
                }
            });
        });
    }
    formatMeta(meta) {
        if (!meta) {
            return "空档";
        }
        const time = new Date(meta.savedAt);
        const timeText = time.toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
        return `${timeText} · ${meta.month}月 · 回合${meta.turn} · 行动力${meta.ap}`;
    }
}
