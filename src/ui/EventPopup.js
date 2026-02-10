export class EventPopup {
    constructor() {
        const el = document.getElementById("event");
        if (!el) {
            throw new Error("Missing event container.");
        }
        this.container = el;
    }
    render(event, onSelect, onCustom, onPlan) {
        this.container.innerHTML = "";
        const plan = document.createElement("div");
        plan.className = "plan";
        const planTitle = document.createElement("h3");
        planTitle.className = "plan-title";
        planTitle.textContent = "本月行动安排";
        const planTable = document.createElement("table");
        planTable.className = "plan-table";
        const planActions = document.createElement("div");
        planActions.className = "plan-actions";
        const executeButton = document.createElement("button");
        executeButton.textContent = "按序执行";
        executeButton.disabled = true;
        const clearButton = document.createElement("button");
        clearButton.textContent = "清空安排";
        planActions.appendChild(executeButton);
        planActions.appendChild(clearButton);
        plan.appendChild(planTitle);
        plan.appendChild(planTable);
        plan.appendChild(planActions);
        const title = document.createElement("h2");
        title.textContent = event.title;
        const text = document.createElement("p");
        text.textContent = event.text;
        const options = document.createElement("div");
        options.className = "options";
        const selection = [];
        const optionTextById = new Map();
        for (const opt of event.options) {
            optionTextById.set(opt.id, opt.text);
        }
        const renderPlan = () => {
            planTable.innerHTML = "";
            const header = document.createElement("tr");
            header.innerHTML = "<th>顺序</th><th>行动</th>";
            planTable.appendChild(header);
            for (let i = 0; i < 3; i += 1) {
                const row = document.createElement("tr");
                const label = document.createElement("th");
                label.textContent = `第${i + 1}项`;
                const cell = document.createElement("td");
                const optionId = selection[i];
                cell.textContent = optionId ? optionTextById.get(optionId) ?? "" : "未定";
                if (optionId) {
                    const remove = document.createElement("button");
                    remove.textContent = "撤销";
                    remove.className = "shop-buy";
                    remove.addEventListener("click", () => {
                        selection.splice(i, 1);
                        renderPlan();
                    });
                    cell.appendChild(document.createElement("br"));
                    cell.appendChild(remove);
                }
                row.appendChild(label);
                row.appendChild(cell);
                planTable.appendChild(row);
            }
            executeButton.disabled = selection.length < 3 || !onPlan;
        };
        const addToPlan = (optionId) => {
            if (selection.length >= 3) {
                return;
            }
            selection.push(optionId);
            renderPlan();
        };
        executeButton.addEventListener("click", () => {
            if (!onPlan || selection.length < 3) {
                return;
            }
            onPlan([...selection]);
        });
        clearButton.addEventListener("click", () => {
            selection.length = 0;
            renderPlan();
        });
        renderPlan();
        const groups = this.buildGroups(event.options);
        for (const group of groups) {
            const groupWrap = document.createElement("div");
            groupWrap.className = "option-group";
            const groupTitle = document.createElement("div");
            groupTitle.className = "group-title";
            groupTitle.textContent = group.name;
            groupWrap.appendChild(groupTitle);
            for (const opt of group.options) {
                const button = document.createElement("button");
                button.textContent = opt.text;
                button.addEventListener("click", () => addToPlan(opt.id));
                groupWrap.appendChild(button);
            }
            options.appendChild(groupWrap);
        }
        if (onCustom) {
            const customButton = document.createElement("button");
            customButton.textContent = "自定应对";
            customButton.addEventListener("click", () => {
                const input = window.prompt("请描述你的应对方式：", "");
                if (!input || !input.trim()) {
                    return;
                }
                onCustom(input.trim());
            });
            options.appendChild(customButton);
        }
        this.container.appendChild(plan);
        this.container.appendChild(title);
        this.container.appendChild(text);
        this.container.appendChild(options);
    }
    renderSpecial(event, onSelect) {
        this.container.innerHTML = "";
        const mask = document.createElement("div");
        mask.className = "special-mask";
        const card = document.createElement("div");
        card.className = "special-card";
        const title = document.createElement("h2");
        title.textContent = event.title;
        const text = document.createElement("p");
        text.textContent = event.text;
        const options = document.createElement("div");
        options.className = "options";
        for (const opt of event.options) {
            const button = document.createElement("button");
            button.textContent = opt.text;
            button.addEventListener("click", () => onSelect(opt.id));
            options.appendChild(button);
        }
        card.appendChild(title);
        card.appendChild(text);
        card.appendChild(options);
        mask.appendChild(card);
        this.container.appendChild(mask);
    }
    buildGroups(options) {
        const groups = {
            "养成类": [],
            "家务类": [],
            "情报类": [],
        };
        const add = (name, option) => {
            groups[name].push(option);
        };
        for (const option of options) {
            const text = option.text;
            if (text.includes("静养") ||
                text.includes("温补") ||
                text.includes("伺候") ||
                text.includes("安寝") ||
                text.includes("庭前")) {
                add("养成类", option);
                continue;
            }
            if (text.includes("女红") || text.includes("针线") || text.includes("厨房") || text.includes("正院")) {
                add("家务类", option);
                continue;
            }
            if (text.includes("墙角") ||
                text.includes("耳目") ||
                text.includes("打听") ||
                text.includes("送礼") ||
                text.includes("打点")) {
                add("情报类", option);
                continue;
            }
            add("家务类", option);
        }
        return Object.entries(groups)
            .filter(([, list]) => list.length > 0)
            .map(([name, list]) => ({ name, options: list }));
    }
    renderEmpty(text) {
        this.container.innerHTML = `
      <h2>暂无事件</h2>
      <p class="muted">${text}</p>
    `;
    }
    renderResult(text, onContinue) {
        this.container.innerHTML = "";
        const title = document.createElement("h2");
        title.textContent = "结果";
        const body = document.createElement("p");
        body.textContent = text;
        const button = document.createElement("button");
        button.textContent = "继续";
        button.addEventListener("click", onContinue);
        this.container.appendChild(title);
        this.container.appendChild(body);
        this.container.appendChild(button);
    }
    renderLoading(text) {
        this.container.innerHTML = "";
        const title = document.createElement("h2");
        title.textContent = "命运推演";
        const body = document.createElement("p");
        body.textContent = text;
        this.container.appendChild(title);
        this.container.appendChild(body);
    }
    renderEnding(titleText, text) {
        this.container.innerHTML = "";
        const title = document.createElement("h2");
        title.textContent = titleText;
        const body = document.createElement("p");
        body.textContent = text;
        this.container.appendChild(title);
        this.container.appendChild(body);
    }
}
