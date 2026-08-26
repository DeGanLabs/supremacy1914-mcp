const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "assets");
function walk(d, p = "") {
  let o = [];
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    const r = p ? p + "/" + n : n;
    if (fs.statSync(f).isDirectory()) o = o.concat(walk(f, r));
    else o.push(r.replace(/\\/g, "/"));
  }
  return o;
}
const man = {};
let imgs = 0;
let bytes = 0;
for (const c of fs.readdirSync(root)) {
  const p = path.join(root, c);
  if (!fs.statSync(p).isDirectory()) continue;
  man[c] = walk(p);
  for (const f of man[c]) {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
    imgs++;
    bytes += fs.statSync(path.join(p, ...f.split("/"))).size;
  }
}
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(man, null, 2));
console.log({ categories: Object.keys(man).length, images: imgs, MB: +(bytes / 1e6).toFixed(2) });
