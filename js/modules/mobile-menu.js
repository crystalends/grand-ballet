const MOBILE_BREAKPOINT = "(max-width: 900px)";

const createMenuToggle = (blockName, nav) => {
  const toggle = document.createElement("button");
  toggle.className = `${blockName}__menu-toggle`;
  toggle.type = "button";
  toggle.setAttribute("aria-controls", nav.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Открыть меню");
  toggle.innerHTML = `<span class="${blockName}__menu-icon" aria-hidden="true">☰</span>`;
  return toggle;
};

const setMenuState = ({ blockName, nav, toggle }, isOpen) => {
  nav.classList.toggle(`${blockName}__nav--open`, isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
  toggle.querySelector(`.${blockName}__menu-icon`).textContent = isOpen ? "×" : "☰";
};

const initMenu = (header, index) => {
  const blockName = header.classList.contains("college-header") ? "college-header" : "site-header";
  const navRow = header.querySelector(`.${blockName}__nav-row`);
  const nav = header.querySelector(`.${blockName}__nav`);
  if (!navRow || !nav) return null;

  nav.id ||= `${blockName}-navigation-${index + 1}`;
  const toggle = createMenuToggle(blockName, nav);
  const menu = { blockName, nav, toggle };
  navRow.append(toggle);

  toggle.addEventListener("click", () => {
    setMenuState(menu, toggle.getAttribute("aria-expanded") !== "true");
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuState(menu, false);
  });

  header.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
    setMenuState(menu, false);
    toggle.focus();
  });

  const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
  mediaQuery.addEventListener("change", () => setMenuState(menu, false));
  return menu;
};

export const initMobileMenus = (headers) => Array.from(headers || [], initMenu).filter(Boolean);
