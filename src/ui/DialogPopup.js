/**
 * 游戏内弹窗系统
 * 用于替换window.prompt和window.alert
 */
export class DialogPopup {
    constructor() {
        this.mask = null;
        const el = document.getElementById("event");
        if (!el) {
            throw new Error("Missing event container.");
        }
        this.container = el;
    }
    /**
     * 显示输入弹窗
     */
    showInput(title, placeholder, defaultValue, onConfirm, onCancel) {
        this.clear();
        this.mask = document.createElement("div");
        this.mask.className = "special-mask";
        const card = document.createElement("div");
        card.className = "special-card";
        const titleEl = document.createElement("h2");
        titleEl.textContent = title;
        const inputWrap = document.createElement("div");
        inputWrap.style.padding = "20px 0";
        const input = document.createElement("textarea");
        input.className = "intro-name";
        input.placeholder = placeholder;
        input.value = defaultValue;
        input.style.width = "100%";
        input.style.minHeight = "80px";
        input.style.padding = "10px";
        input.style.fontSize = "16px";
        input.style.border = "1px solid #8b7355";
        input.style.borderRadius = "4px";
        input.style.backgroundColor = "#f5f0e8";
        input.style.color = "#3e2723";
        input.style.resize = "vertical";
        inputWrap.appendChild(input);
        const buttons = document.createElement("div");
        buttons.className = "options";
        buttons.style.display = "flex";
        buttons.style.gap = "10px";
        buttons.style.justifyContent = "center";
        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = "确定";
        confirmBtn.addEventListener("click", () => {
            const value = input.value.trim();
            if (value) {
                this.clear();
                onConfirm(value);
            }
        });
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "取消";
        cancelBtn.addEventListener("click", () => {
            this.clear();
            if (onCancel) {
                onCancel();
            }
        });
        buttons.appendChild(confirmBtn);
        buttons.appendChild(cancelBtn);
        card.appendChild(titleEl);
        card.appendChild(inputWrap);
        card.appendChild(buttons);
        this.mask.appendChild(card);
        this.container.appendChild(this.mask);
        // 聚焦输入框
        setTimeout(() => input.focus(), 100);
    }
    /**
     * 显示确认弹窗
     */
    showConfirm(title, message, onConfirm, onCancel, confirmText = "确定", cancelText = "取消") {
        this.clear();
        this.mask = document.createElement("div");
        this.mask.className = "special-mask";
        const card = document.createElement("div");
        card.className = "special-card";
        const titleEl = document.createElement("h2");
        titleEl.textContent = title;
        const messageEl = document.createElement("p");
        messageEl.textContent = message;
        messageEl.style.padding = "20px 0";
        messageEl.style.lineHeight = "1.8";
        const buttons = document.createElement("div");
        buttons.className = "options";
        buttons.style.display = "flex";
        buttons.style.gap = "10px";
        buttons.style.justifyContent = "center";
        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = confirmText;
        confirmBtn.addEventListener("click", () => {
            this.clear();
            onConfirm();
        });
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = cancelText;
        cancelBtn.addEventListener("click", () => {
            this.clear();
            if (onCancel) {
                onCancel();
            }
        });
        buttons.appendChild(confirmBtn);
        buttons.appendChild(cancelBtn);
        card.appendChild(titleEl);
        card.appendChild(messageEl);
        card.appendChild(buttons);
        this.mask.appendChild(card);
        this.container.appendChild(this.mask);
    }
    /**
     * 显示警告弹窗（只有确定按钮）
     */
    showAlert(title, message, onConfirm, confirmText = "确定") {
        this.clear();
        this.mask = document.createElement("div");
        this.mask.className = "special-mask";
        const card = document.createElement("div");
        card.className = "special-card";
        const titleEl = document.createElement("h2");
        titleEl.textContent = title;
        const messageEl = document.createElement("p");
        messageEl.textContent = message;
        messageEl.style.padding = "20px 0";
        messageEl.style.lineHeight = "1.8";
        const buttons = document.createElement("div");
        buttons.className = "options";
        buttons.style.display = "flex";
        buttons.style.justifyContent = "center";
        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = confirmText;
        confirmBtn.addEventListener("click", () => {
            this.clear();
            onConfirm();
        });
        buttons.appendChild(confirmBtn);
        card.appendChild(titleEl);
        card.appendChild(messageEl);
        card.appendChild(buttons);
        this.mask.appendChild(card);
        this.container.appendChild(this.mask);
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
