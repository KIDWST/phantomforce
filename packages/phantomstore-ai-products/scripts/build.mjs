import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCTS, publicProduct } from "../src/catalog.mjs";

const root = resolve(import.meta.dirname, ".."); const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
const files = ["index.html", "styles.css", "app.js", "manifest.webmanifest"];
for (const name of files) await copyFile(resolve(root, "public", name), resolve(dist, name));
await writeFile(resolve(dist, "catalog.json"), `${JSON.stringify({ version: 1, products: PRODUCTS.map(publicProduct) }, null, 2)}\n`);
const sizes = Object.fromEntries(await Promise.all(files.map(async (name) => [name, (await stat(resolve(dist, name))).size])));
const totalStaticBytes = Object.values(sizes).reduce((sum, size) => sum + size, 0);
const report = { ok: true, productCount: PRODUCTS.length, externalModelsActive: false, providerSpendUsd: 0, deployment: "local_preview", sizes, totalStaticBytes, budgetBytes: 180000, withinBudget: totalStaticBytes <= 180000 };
if (!report.withinBudget) throw new Error(`Static bundle ${totalStaticBytes} exceeds 180,000-byte budget.`);
await writeFile(resolve(dist, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, productCount: PRODUCTS.length, totalStaticBytes, dist }));
