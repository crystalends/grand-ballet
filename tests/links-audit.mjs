import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const htmlFiles = (await readdir(".")).filter((file) => file.endsWith(".html"));
const htmlByFile = new Map(await Promise.all(htmlFiles.map(async (file) => [file, await readFile(file, "utf8")])));
const errors = [];

for (const [file, html] of htmlByFile) {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:data:|https?:|tel:|mailto:)/.test(href)) continue;
    if (href === "#") {
      errors.push(`${file}: пустая ссылка ${href}`);
      continue;
    }
    if (href.includes("#")) {
      errors.push(`${file}: локальная ссылка должна вести на страницу без якоря: ${href}`);
      continue;
    }

    const targetFile = href;

    if (!targetFile || (!htmlByFile.has(targetFile) && !path.extname(targetFile))) {
      errors.push(`${file}: отсутствует файл ${href}`);
      continue;
    }

    if (!htmlByFile.has(targetFile)) {
      try {
        await readFile(targetFile);
      } catch {
        errors.push(`${file}: отсутствует файл ${href}`);
      }
    }
  }

  const navigationSections = [...html.matchAll(/<(?:header|footer)\b[^>]*class="[^"]*(?:site|college)-(?:header|footer)[^"]*"[^>]*>[\s\S]*?<\/(?:header|footer)>/g)]
    .map((match) => match[0]);

  for (const navigationMarkup of navigationSections) {
    for (const match of navigationMarkup.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^(?:data:|https?:|tel:|mailto:)/.test(href)) continue;
      if (!/^[^#]+\.html$/.test(href)) {
        errors.push(`${file}: ссылка в header/footer должна вести на страницу без якоря: ${href}`);
      }
    }

    if (navigationMarkup.includes("Франшиза")
      && !/<a\b[^>]*href="franchise\.html"[^>]*>Франшиза<\/a>/.test(navigationMarkup)) {
      errors.push(`${file}: пункт «Франшиза» в header/footer должен быть ссылкой на franchise.html`);
    }

    if (navigationMarkup.includes("Контакты")
      && !/<a\b[^>]*href="contacts\.html"[^>]*>Контакты<\/a>/.test(navigationMarkup)) {
      errors.push(`${file}: пункт «Контакты» в header/footer должен быть ссылкой на contacts.html`);
    }
  }
}

if (errors.length) throw new Error(`Найдены неработающие ссылки:\n${errors.join("\n")}`);

console.log(`Проверено ${htmlFiles.length} HTML-страниц: все локальные ссылки работают.`);
