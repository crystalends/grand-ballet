import { readFile, readdir } from "node:fs/promises";

const htmlFiles = (await readdir(".")).filter((file) => file.endsWith(".html")).sort();
const rootCssFiles = (await readdir(".")).filter((file) => file.endsWith(".css")).sort();
const errors = [];
let rasterImages = 0;

const getJpegDimensions = (buffer) => {
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (frameMarkers.has(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (!segmentLength) break;
    offset += segmentLength + 2;
  }

  return null;
};

const getRasterDimensions = (buffer) => {
  if (buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return getJpegDimensions(buffer);
  return null;
};

if (rootCssFiles.length !== 1 || rootCssFiles[0] !== "styles.css") {
  errors.push(`В корне должен оставаться только styles.css, найдено: ${rootCssFiles.join(", ") || "0 файлов"}.`);
}
const styles = await readFile("styles.css", "utf8");
if (/@import\s+(?:url\()?["'][^"']+\.css/.test(styles)) {
  errors.push("styles.css не должен подключать другие CSS-файлы через @import.");
}

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map((match) => match[1]);
  if (stylesheets.length !== 1 || stylesheets[0] !== "styles.css") {
    errors.push(`${file}: должен подключать только styles.css.`);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    const source = tag.match(/\bsrc="([^"]+)"/)?.[1];
    if (!source || /^(?:data:|https?:)/.test(source)) continue;

    let buffer;
    try {
      buffer = await readFile(source);
    } catch {
      errors.push(`${file}: отсутствует изображение ${source}.`);
      continue;
    }

    const dimensions = getRasterDimensions(buffer);
    if (!dimensions) continue;
    rasterImages += 1;

    const width = Number(tag.match(/\bwidth="(\d+)"/)?.[1]);
    const height = Number(tag.match(/\bheight="(\d+)"/)?.[1]);
    if (width !== dimensions.width || height !== dimensions.height) {
      errors.push(
        `${file}: ${source} должен иметь width="${dimensions.width}" height="${dimensions.height}".`,
      );
    }
  }
}

if (errors.length) throw new Error(`Asset-аудит завершился с ошибками:\n${errors.join("\n")}`);

console.log(
  `Assets audit: ${htmlFiles.length} HTML-страниц, один styles.css и ${rasterImages} raster-изображений — OK.`,
);
