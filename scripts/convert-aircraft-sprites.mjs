import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const pairs = [
  ["resources/sprites/svg/interceptor.svg", "resources/sprites/interceptor.png"],
  ["resources/sprites/svg/multifighter.svg", "resources/sprites/multifighter.png"],
  ["resources/sprites/svg/bomber.svg", "resources/sprites/bomber.png"],
  ["resources/sprites/svg/cargoplane.svg", "resources/sprites/cargoplane.png"],
];

for (const [svgPath, pngPath] of pairs) {
  const svg = fs.readFileSync(svgPath);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    background: "rgba(0,0,0,0)",
  });
  fs.writeFileSync(pngPath, resvg.render().asPng());
  console.log(`Generated ${pngPath}`);
}
