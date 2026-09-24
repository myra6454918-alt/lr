// Сборка: HTML-шаблон + модули движка + описание оружия → один самодостаточный HTML на оружие.
// Запуск: node armory/build.mjs  (зависимостей нет; three.js подгружается страницей с unpkg)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const read = (p) => readFileSync(join(SRC, p), "utf8");

// Порядок важен: модули делят общую область видимости, как в бандле-шаблоне.
const ENGINE = [
  "engine/prelude.js",
  "engine/scene.js",
  "engine/materials.js",
  "engine/geo.js",
  "engine/lib/common.js",
  "engine/mounts.js",
  "engine/ctx.js",
  "engine/foley.js",
  "engine/audio.js",
  "engine/fx.js",
  "engine/reticle.js",
  "engine/ui.js",
  "engine/app.js",
  "engine/lib/optics.js",
  "engine/lib/dovetail.js",
  "engine/lib/muzzle.js",
  "engine/lib/tactical.js",
  "engine/lib/pistol.js",
  "engine/lib/grips.js",
  "engine/lib/index.js"
];

export const WEAPONS = [
  { id: "mp5a3", file: "weapons/mp5.js", def: "mp5a3_default", out: "mp5a3.html", title: "HK MP5A3 — оружейная" },
  { id: "m870", file: "weapons/m870.js", def: "m870_default", out: "remington870.html", title: "Remington 870 — оружейная" },
  { id: "svd", file: "weapons/svd.js", def: "svd_default", out: "svd.html", title: "СВД — оружейная" },
  { id: "glock18c", file: "weapons/glock18c.js", def: "glock18c_default", out: "glock18c.html", title: "Glock 18C — оружейная" }
];

const engine = ENGINE.map(read).join("\n");
const head = read("template.html");

for (const w of WEAPONS) {
  const entry = `\n// src/entries/${w.id}.js
boot(${w.def}, LIB).catch((e) => {
  console.error(e);
  const b = document.getElementById("boot-t");
  if (b) b.textContent = "Ошибка: " + e.message;
});
`;
  const html = head.replace("{{TITLE}}", w.title).replace("{{ID}}", w.id) + engine + "\n" + read("weapons/shared.js") + "\n" + read(w.file) + entry + "\n</script>\n</body>\n</html>\n";
  writeFileSync(join(ROOT, w.out), html);
  console.log(`${w.out}  ${(html.length / 1024).toFixed(0)} КБ`);
}
