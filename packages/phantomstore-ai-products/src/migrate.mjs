import { resolve } from "node:path";
import { JsonFileAdapter, AiProductsPlatform } from "./platform.mjs";

const dataPath = resolve(process.env.PHANTOMSTORE_AI_PRODUCTS_DATA || new URL("../.local/phantomstore-ai-products.json", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const platform = await new AiProductsPlatform({ adapter: new JsonFileAdapter(dataPath) }).init();
console.log(JSON.stringify({ ok: true, dataPath, schemaVersion: platform.document.schemaVersion, productCount: platform.catalog().length, deployment: "local_preview" }));
