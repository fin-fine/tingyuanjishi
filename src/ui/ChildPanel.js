import { CHILD_SEX_LABELS, CHILD_TRAINING_OPTIONS, getPersonalityLabel } from "../model/Child.js";
export class ChildPanel {
    constructor(player, world) {
        this.player = player;
        this.world = world;
        const el = document.getElementById("child");
        if (!el) {
            throw new Error("Missing child container.");
        }
        this.container = el;
    }
    render() {
        const children = this.player.children.filter(child => !child.takenByMatron);
        if (!children.length) {
            const takenCount = this.player.children.filter(c => c.takenByMatron).length;
            const takenText = takenCount > 0
                ? `<div class="muted">你有${takenCount}个子嗣被主母抱去抚养。</div>`
                : '';
            this.container.innerHTML = `
        <h3 class="panel-title">子嗣</h3>
        <div class="muted">暂无在身边抚养的子嗣。</div>
        ${takenText}
      `;
            return;
        }
        const cards = children
            .map((child, index) => {
            const sexLabel = CHILD_SEX_LABELS[child.sex];
            const ageText = this.formatAge(child.birthTurn);
            const trainingLabel = CHILD_TRAINING_OPTIONS.find((opt) => opt.id === child.training)?.label ?? "均衡";
            const personalityLabel = getPersonalityLabel(child.personality);
            const businessDisplay = child.stats.business
                ? `<div class="child-stat">商业 ${child.stats.business.toFixed(1)}</div>`
                : '';
            // 显示名字或默认标题
            const childTitle = child.name
                ? `${child.name} · ${sexLabel}`
                : `子嗣${index + 1} · ${sexLabel}`;
            return `
          <div class="child-card" data-id="${child.id}">
            <div class="child-header">
              <div class="child-name">${childTitle}</div>
              <div class="child-meta">${ageText}</div>
            </div>
            <div class="child-meta">资质：${child.aptitude} · 性格：${personalityLabel}（${child.personality.toFixed(0)}）</div>
            <div class="child-stats">
              <div class="child-stat">文采 ${child.stats.literary.toFixed(1)}</div>
              <div class="child-stat">武艺 ${child.stats.martial.toFixed(1)}</div>
              <div class="child-stat">礼仪 ${child.stats.etiquette.toFixed(1)}</div>
              ${businessDisplay}
            </div>
            <label class="child-training">
              <span>培养方向</span>
              <select data-id="${child.id}">
                ${CHILD_TRAINING_OPTIONS.map((opt) => `<option value="${opt.id}" ${opt.id === child.training ? "selected" : ""}>
                      ${opt.label} · ${opt.hint}
                    </option>`).join("")}
              </select>
              <span class="child-training-note">当前：${trainingLabel}</span>
            </label>
          </div>
        `;
        })
            .join("");
        this.container.innerHTML = `
      <h3 class="panel-title">子嗣</h3>
      <div class="child-list">${cards}</div>
    `;
        const selects = this.container.querySelectorAll(".child-training select");
        selects.forEach((select) => {
            select.addEventListener("change", () => {
                const id = select.dataset.id;
                if (!id) {
                    return;
                }
                this.updateTraining(id, select.value);
            });
        });
    }
    updateTraining(childId, training) {
        const target = this.player.children.find((child) => child.id === childId);
        if (!target) {
            return;
        }
        target.training = training;
        this.render();
    }
    formatAge(birthTurn) {
        const months = Math.max(0, this.world.turn - birthTurn);
        if (months <= 0) {
            return "新生";
        }
        const years = Math.floor(months / 12);
        const rem = months % 12;
        if (years <= 0) {
            return `${rem}月`;
        }
        return rem > 0 ? `${years}岁${rem}月` : `${years}岁`;
    }
}
