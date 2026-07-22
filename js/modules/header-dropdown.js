const dropdowns = [
  {
    key: "applicants",
    triggerLabel: "Абитуриентам",
    items: [
      ["Поступление", "admissions.html#admission"],
      ["Специальности", "admissions.html#admissions-programs-title"],
      ["Вступительные испытания", "admissions.html#admissions-assessment-title"],
      ["Документы для поступления", "admissions.html#admissions-documents-title"],
    ],
  },
  {
    key: "official",
    triggerLabel: "Сведения об образовательной организации",
    items: [
      ["Сведения об образовательной организации", "license.html"],
      ["Образование", "license.html#system-title"],
      ["Документы", "license.html#documents-title"],
      ["Руководство и педагогический состав", "teachers.html"],
      ["Материально-техническое обеспечение", "halls.html"],
      ["Платные образовательные услуги", "index.html#directions"],
      ["Вакантные места", "admissions.html#admission"],
      ["Доступная среда", "license.html#importance-title"],
    ],
  },
];

const createMenu = ({ items, key }, id) => {
  const menu = document.createElement("div");
  menu.className = `college-header__dropdown-menu college-header__dropdown-menu--${key}`;
  menu.id = id;
  menu.hidden = true;

  const list = document.createElement("ul");
  list.className = "college-header__dropdown-list";

  items.forEach(([label, href]) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "college-header__dropdown-link";
    link.href = href;
    link.textContent = label;
    item.append(link);
    list.append(item);
  });

  menu.append(list);
  return menu;
};

const findTrigger = (header, label) => {
  const nav = header.querySelector(".college-header__nav");
  return nav && [...nav.children].find((element) => element.matches("a") && element.textContent.trim() === label);
};

const setDropdownState = ({ wrapper, trigger, menu }, isOpen, focusFirst = false) => {
  wrapper.classList.toggle("college-header__dropdown--open", isOpen);
  trigger.setAttribute("aria-expanded", String(isOpen));
  menu.hidden = !isOpen;
  if (focusFirst) menu.querySelector("a")?.focus();
};

const initHeaderDropdown = (header, config, headerIndex) => {
  const trigger = findTrigger(header, config.triggerLabel);
  if (!trigger) return null;

  const wrapper = document.createElement("div");
  const menuId = `college-header-dropdown-${config.key}-${headerIndex + 1}`;
  const menu = createMenu(config, menuId);
  wrapper.className = "college-header__dropdown";
  trigger.classList.add("college-header__dropdown-trigger");
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-haspopup", "true");
  trigger.before(wrapper);
  wrapper.append(trigger, menu);

  const dropdown = { wrapper, trigger, menu };
  const isOpen = () => trigger.getAttribute("aria-expanded") === "true";
  const close = () => setDropdownState(dropdown, false);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    setDropdownState(dropdown, precisePointer.matches ? true : !isOpen());
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    setDropdownState(dropdown, true, true);
  });

  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    close();
    trigger.focus();
  });

  wrapper.addEventListener("focusout", (event) => {
    if (!wrapper.contains(event.relatedTarget)) close();
  });

  const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  wrapper.addEventListener("pointerenter", () => {
    if (precisePointer.matches) setDropdownState(dropdown, true);
  });
  wrapper.addEventListener("pointerleave", () => {
    if (precisePointer.matches) close();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!wrapper.contains(event.target)) close();
  });

  menu.addEventListener("click", close);
  return dropdown;
};

export const initHeaderDropdowns = (headers) => Array.from(headers || []).flatMap((header, headerIndex) => (
  dropdowns.map((config) => initHeaderDropdown(header, config, headerIndex)).filter(Boolean)
));
