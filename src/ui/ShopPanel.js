export class ShopPanel {
    constructor(player, items) {
        this.player = player;
        this.items = items;
        this.message = "";
        const el = document.getElementById("shop");
        if (!el) {
            throw new Error("Missing shop container.");
        }
        this.container = el;
    }
    render(onPurchase) {
        const list = this.items
            .map((item) => {
            const owned = this.player.inventory[item.id] ?? 0;
            const price = item.price.toFixed(1);
            return `
          <div class="shop-item">
            <div>
              <div class="shop-name">${item.name} <span class="shop-count">x${owned}</span></div>
              <div class="shop-desc">${item.desc}</div>
            </div>
            <button data-id="${item.id}" class="shop-buy">购入 ${price}两</button>
          </div>
        `;
        })
            .join("");
        this.container.innerHTML = `
      <h3 class="panel-title">小铺</h3>
      <div class="shop-list">${list}</div>
      <div class="shop-message">${this.message}</div>
    `;
        const buttons = this.container.querySelectorAll(".shop-buy");
        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                const id = button.dataset.id;
                if (!id) {
                    return;
                }
                this.handlePurchase(id, onPurchase);
            });
        });
    }
    handlePurchase(id, onPurchase) {
        const item = this.items.find((entry) => entry.id === id);
        if (!item) {
            return;
        }
        if (this.player.stats.cash < item.price) {
            this.message = "银钱不够，还是缓一缓。";
            this.render(onPurchase);
            return;
        }
        this.player.stats.cash -= item.price;
        this.player.applyDelta({ [`item_${item.id}`]: 1 });
        this.message = `购入${item.name}一份。`;
        onPurchase();
        this.render(onPurchase);
    }
}
