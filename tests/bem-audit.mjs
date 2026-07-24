import { readFile, readdir } from "node:fs/promises";

const BEM_CLASS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const htmlFiles = (await readdir(".")).filter((file) => file.endsWith(".html")).sort();
const cssFiles = ["styles.css"];
const errors = [];
const htmlClasses = new Set();
const cssClasses = new Set();

const getLine = (source, offset) => source.slice(0, offset).split("\n").length;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");

  for (const match of html.matchAll(/class\s*=\s*"([^"]+)"/g)) {
    const classList = match[1].trim().split(/\s+/).filter(Boolean);
    const line = getLine(html, match.index);

    for (const className of classList) {
      htmlClasses.add(className);

      if (!BEM_CLASS_PATTERN.test(className)) {
        errors.push(`${file}:${line}: класс "${className}" не соответствует принятому BEM-формату.`);
      }

      if ((className.match(/__/g) || []).length > 1) {
        errors.push(`${file}:${line}: класс "${className}" кодирует DOM-дерево через несколько элементов.`);
      }

      const modifierIndex = className.indexOf("--");
      if (modifierIndex > 0) {
        const baseClass = className.slice(0, modifierIndex);
        if (!classList.includes(baseClass)) {
          errors.push(`${file}:${line}: модификатор "${className}" используется без базового класса "${baseClass}".`);
        }
      }
    }
  }

  for (const match of html.matchAll(/<[^>]+\bclass="[^"]*\bbutton--header\b[^"]*"[^>]*>/g)) {
    if (!/\bdata-application-modal="(?:trial|applicant)"/.test(match[0])) {
      errors.push(`${file}:${getLine(html, match.index)}: header CTA должен иметь явный data-application-modal.`);
    }
  }

  for (const match of html.matchAll(/<header\b[^>]*class="[^"]*\bcollege-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/g)) {
    for (const key of ["applicants", "official"]) {
      const hookCount = (match[0].match(new RegExp(`data-header-dropdown="${key}"`, "g")) || []).length;
      if (hookCount !== 1) {
        errors.push(`${file}:${getLine(html, match.index)}: college-header должен содержать один data-header-dropdown="${key}".`);
      }
    }
  }
}

for (const file of cssFiles) {
  const css = await readFile(file, "utf8");
  const selectorsOnly = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\([^)]*\)/g, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");

  for (const match of selectorsOnly.matchAll(/\.([_a-zA-Z][-_a-zA-Z0-9]*)/g)) {
    const className = match[1];
    cssClasses.add(className);

    if (!BEM_CLASS_PATTERN.test(className)) {
      errors.push(`${file}:${getLine(selectorsOnly, match.index)}: селектор ".${className}" не соответствует принятому BEM-формату.`);
    }

    if ((className.match(/__/g) || []).length > 1) {
      errors.push(`${file}:${getLine(selectorsOnly, match.index)}: селектор ".${className}" кодирует DOM-дерево.`);
    }
  }

  if (css.includes("!important")) {
    errors.push(`${file}: использование !important запрещено правилами проекта.`);
  }
}

if (errors.length) {
  throw new Error(`BEM-аудит завершился с ошибками:\n${errors.join("\n")}`);
}

console.log(`BEM audit: ${htmlFiles.length} HTML-файлов, ${htmlClasses.size} HTML-классов и ${cssClasses.size} CSS-классов — OK`);
