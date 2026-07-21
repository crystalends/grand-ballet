const activateTab = (tabs, activeTab) => {
  tabs.forEach((tab) => {
    const isActive = tab === activeTab;
    tab.classList.toggle("direction-picker__tab--active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });
};

export const initDirectionTabs = (tablist) => {
  if (!tablist) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) activateTab(tabs, tab);
  });

  tablist.addEventListener("keydown", (event) => {
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0 || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;

    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = tabs[(currentIndex + offset + tabs.length) % tabs.length];
    activateTab(tabs, nextTab);
    nextTab.focus();
  });
};
