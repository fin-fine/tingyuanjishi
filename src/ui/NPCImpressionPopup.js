/**
 * NPC印象详情弹窗
 * 用于显示NPC对主角的详细采访式印象
 */
export class NPCImpressionPopup {
    constructor() {
        this.mask = null;
        // 不绑定到特定容器，而是直接添加到 body
    }
    /**
     * 显示NPC印象详情
     * @param npcName NPC名称
     * @param impression 印象内容
     */
    show(npcName, impression) {
        this.clear();
        this.mask = document.createElement("div");
        this.mask.className = "special-mask";
        this.mask.style.position = "fixed";
        this.mask.style.inset = "0";
        this.mask.style.zIndex = "10000";
        // 点击遮罩关闭
        this.mask.addEventListener("click", (e) => {
            if (e.target === this.mask) {
                this.clear();
            }
        });
        const card = document.createElement("div");
        card.className = "special-card";
        card.style.maxWidth = "600px";
        card.style.maxHeight = "80vh";
        card.style.overflow = "auto";
        const titleEl = document.createElement("h2");
        titleEl.textContent = `${npcName}的看法`;
        titleEl.style.marginBottom = "20px";
        const contentEl = document.createElement("div");
        contentEl.className = "npc-impression-content";
        contentEl.style.padding = "20px 0";
        contentEl.style.lineHeight = "2";
        contentEl.style.fontSize = "16px";
        contentEl.style.color = "#3e2723";
        contentEl.style.whiteSpace = "pre-wrap";
        contentEl.style.wordBreak = "break-word";
        contentEl.textContent = impression;
        const buttons = document.createElement("div");
        buttons.className = "options";
        buttons.style.display = "flex";
        buttons.style.justifyContent = "center";
        buttons.style.marginTop = "20px";
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "知道了";
        closeBtn.addEventListener("click", () => {
            this.clear();
        });
        buttons.appendChild(closeBtn);
        card.appendChild(titleEl);
        card.appendChild(contentEl);
        card.appendChild(buttons);
        this.mask.appendChild(card);
        document.body.appendChild(this.mask);
    }
    /**
     * 清除弹窗
     */
    clear() {
        if (this.mask && this.mask.parentNode) {
            this.mask.parentNode.removeChild(this.mask);
            this.mask = null;
        }
    }
}
