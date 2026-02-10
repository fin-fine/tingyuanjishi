import { GameManager } from "./src/core/GameManager.js";
const TAB_KEY = "story_sim_tab";
const setupTabs = () => {
    const pages = document.querySelectorAll(".page[data-page]");
    const tabs = document.querySelectorAll("#tabbar [data-tab]");
    if (!pages.length || !tabs.length) {
        return;
    }
    const activate = (id) => {
        pages.forEach((page) => {
            page.classList.toggle("is-active", page.dataset.page === id);
        });
        tabs.forEach((tab) => {
            tab.classList.toggle("is-active", tab.dataset.tab === id);
        });
        localStorage.setItem(TAB_KEY, id);
    };
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const id = tab.dataset.tab;
            if (id) {
                activate(id);
            }
        });
    });
    const saved = localStorage.getItem(TAB_KEY);
    const defaultId = saved && Array.from(tabs).some((tab) => tab.dataset.tab === saved) ? saved : "action";
    activate(defaultId);
};
setupTabs();
const game = new GameManager();
void game.init();
