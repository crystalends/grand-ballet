import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const htmlFiles = (await readdir(".")).filter((file) => file.endsWith(".html"));
const htmlByFile = new Map(await Promise.all(htmlFiles.map(async (file) => [file, await readFile(file, "utf8")])));
const idsByFile = new Map([...htmlByFile].map(([file, html]) => [
  file,
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])),
]));
const errors = [];

for (const [file, html] of htmlByFile) {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:data:|https?:|tel:|mailto:)/.test(href)) continue;
    if (href === "#") {
      errors.push(`${file}: пустая ссылка ${href}`);
      continue;
    }

    const [target = "", fragment] = href.split("#");
    const targetFile = target || file;

    if (!targetFile || (!htmlByFile.has(targetFile) && !path.extname(targetFile))) {
      errors.push(`${file}: отсутствует файл ${href}`);
      continue;
    }

    if (target && !htmlByFile.has(targetFile)) {
      try {
        await readFile(targetFile);
      } catch {
        errors.push(`${file}: отсутствует файл ${href}`);
      }
    }

    if (fragment && targetFile.endsWith(".html") && !idsByFile.get(targetFile)?.has(fragment)) {
      errors.push(`${file}: отсутствует якорь ${href}`);
    }
  }
}

if (errors.length) throw new Error(`Найдены неработающие ссылки:\n${errors.join("\n")}`);

console.log(`Проверено ${htmlFiles.length} HTML-страниц: все локальные ссылки работают.`);
