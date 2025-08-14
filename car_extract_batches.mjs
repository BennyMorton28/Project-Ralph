// car_extract_batches.mjs
// Batch-mode extractor that keeps every browser_evaluate response tiny.
import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Minimal Anthropic call (optional) ----
async function anthropicFix(items) {
  if (!process.env.ANTHROPIC_API_KEY) return items;
  const system = `You normalize car listing items. Return ONLY JSON array. Fields: price(int), year(int), make, model, trim?, mileage(int)?, vin?, link?, location?, title?`;
  const user = JSON.stringify(items).slice(0, 15000);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-7-sonnet-2025-05-01",
      max_tokens: 600,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!resp.ok) return items;
  const json = await resp.json();
  try { return JSON.parse(json?.content?.[0]?.text ?? "[]"); } catch { return items; }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.vin && `VIN:${it.vin}`) ||
      `K:${it.year||""}-${(it.make||"").toLowerCase()}-${(it.model||"").toLowerCase()}-${it.price||""}-${it.mileage||""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function parseMaybeJSON(s){ try { return JSON.parse(s); } catch { return null; } }

// ---- ONE small browser_evaluate call per batch ----
async function fetchBatch(mcpClient, { url, offset, limit }) {
  const code = `
    (() => {
      function num(x){ if(!x) return undefined; const n = String(x).replace(/[^0-9]/g,""); return n? Number(n) : undefined; }
      function textOf(el){ return (el?.textContent || "").replace(/\\s+/g," ").trim(); }
      function pickLink(el){ const a = el?.querySelector('a[href*="inventory"], a[href*="/used"], a[href^="http"], a[href^="/"]'); return a? a.href : undefined; }
      function parseTitle(t){
        const m = (t||"").match(/\\b(19|20)\\d{2}\\b/);
        let year = m ? Number(m[0]) : undefined;
        let after = m ? t.slice(t.indexOf(m[0]) + m[0].length).trim() : t;
        // crude token split for make/model/trim
        const tokens = after.split(/\\s+/).filter(Boolean);
        const make = tokens[0] || undefined;
        const model = tokens[1] || undefined;
        const trim  = tokens.slice(2,6).join(" ") || undefined;
        return { year, make, model, trim };
      }
      function fromJSONLD(){
        const out = [];
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts){
          let j; try { j = JSON.parse(s.textContent); } catch { continue; }
          const arr = Array.isArray(j) ? j : [j];
          for (const node of arr){
            if(!node || typeof node !== 'object') continue;
            // OfferCatalog / Vehicle / Product styles
            if (node["@type"] === "OfferCatalog" && Array.isArray(node.itemListElement)){
              for (const it of node.itemListElement){
                const offer = it?.item || it;
                const brand = offer?.brand?.name || offer?.manufacturer?.name || offer?.brand;
                const model = offer?.model || offer?.name;
                const year  = num(offer?.modelDate) || num(offer?.productionDate);
                const price = num(offer?.offers?.price) || num(offer?.price);
                const link  = offer?.url || offer?.offers?.url;
                out.push({ price, year, make: brand, model, trim: undefined, mileage: undefined, vin: undefined, link, title: offer?.name, location: undefined, source:"jsonld" });
              }
            }
            if ((node["@type"] === "Vehicle" || node["@type"] === "Car") || node.vehicle){
              const v = node.vehicle || node;
              const brand = v?.brand?.name || v?.brand;
              const model = v?.model || v?.name;
              const year  = num(v?.modelDate);
              const price = num(v?.offers?.price);
              const link  = v?.url || v?.offers?.url;
              out.push({ price, year, make: brand, model, trim: v?.trim || undefined, mileage: num(v?.mileageFromOdometer?.value), vin: v?.vehicleIdentificationNumber, link, title: v?.name, location: undefined, source:"jsonld" });
            }
          }
        }
        return out;
      }
      function fromNextData(){
        const el = document.getElementById("__NEXT_DATA__");
        if(!el) return [];
        let j; try { j = JSON.parse(el.textContent); } catch { return []; }
        const out = [];
        function walk(o){
          if(!o || typeof o!=="object") return;
          if (o.price || o.mileage || o.vin){
            const price = num(o.price);
            const year  = num(o.year);
            const make  = o.make?.name || o.make;
            const model = o.model?.name || o.model;
            const trim  = o.trim?.name || o.trim;
            const vin   = o.vin;
            const link  = o.url || o.href;
            out.push({ price, year, make, model, trim, mileage: num(o.mileage), vin, link, title: o.title, location: o.location, source:"next" });
          }
          for (const k in o) walk(o[k]);
        }
        walk(j);
        return out;
      }
      function fromCards(){
        const cards = Array.from(document.querySelectorAll('[data-test*="card"], [data-testid*="card"], article, li, .card, .result, .listing, .vehicle'));
        const items = [];
        for (const c of cards){
          const title = textOf(c.querySelector('h1, h2, h3, .title, [class*="title"]')) || textOf(c);
          const priceTxt = textOf(c).match(/\\$\\s?\\d{1,3}(?:[\\,\\d]{3})+/)?.[0];
          const mileageTxt = textOf(c).match(/\\b\\d{1,3}(?:[\\,\\d]{3})\\s*(?:mi|miles)\\b/i)?.[0];
          const vinTxt = textOf(c).match(/\\b[A-HJ-NPR-Z0-9]{17}\\b/)?.[0];
          const link = pickLink(c);
          const { year, make, model, trim } = parseTitle(title);
          items.push({
            price: num(priceTxt),
            year, make, model, trim,
            mileage: num(mileageTxt),
            vin: vinTxt, link, title, location: undefined, source:"dom"
          });
        }
        return items;
      }
      const all = [...fromJSONLD(), ...fromNextData(), ...fromCards()];
      // lightweight filter of obviously empty rows
      const clean = all.filter(x => x && (x.price || x.year || x.make || x.model));
      const total = clean.length;
      const batch = clean.slice(${offset}, ${offset}+${limit});
      return JSON.stringify({ ok:true, total, count: batch.length, items: batch });
    })()
  `;

  const resp = await mcpClient.tools.call("browser_evaluate", { url, code });
  const raw = typeof resp === "string" ? resp : (resp?.content ?? resp?.text ?? resp?.result ?? "");
  const parsed = parseMaybeJSON(raw) || { ok:false, total:0, count:0, items:[] };
  if (!parsed.ok) throw new Error("browser_evaluate returned error");
  return parsed;
}

async function main() {
  const url = process.argv[2];
  const noLLM = process.argv.includes("--no-llm");
  if (!url) {
    console.error("Usage: node car_extract_batches.mjs \"https://site/cars\" [--no-llm]");
    process.exit(1);
  }
  const mcpClient = globalThis.mcpClient || globalThis.mcp;
  if (!mcpClient?.tools?.call) throw new Error("mcpClient not found on globalThis");

  const ndjsonPath = path.join(__dirname, "cars_batched.ndjson");
  const jsonPath = path.join(__dirname, "cars_batched.json");
  if (fs.existsSync(ndjsonPath)) fs.unlinkSync(ndjsonPath);

  const limit = 15;         // keep every response tiny
  let offset = 0;
  let grand = [];
  let total = null;

  while (true) {
    const { total: t, count, items } = await fetchBatch(mcpClient, { url, offset, limit });
    if (total === null) total = t;
    if (!count) break;

    // optional LLM normalization
    const normalized = noLLM ? items : await anthropicFix(items);

    // write as we go
    for (const it of normalized) {
      fs.appendFileSync(ndjsonPath, JSON.stringify({ ...it, _offset: offset, _url: url }) + "\n");
      grand.push(it);
    }

    offset += limit;
    if (offset >= total) break;
    // hard guard against infinite loops
    if (offset > 5000) break;
  }

  // final dedupe + write
  grand = dedupe(grand);
  fs.writeFileSync(jsonPath, JSON.stringify(grand, null, 2));

  process.stdout.write(JSON.stringify({
    url, totalSeen: total ?? grand.length, written: grand.length,
    files: { ndjson: ndjsonPath, json: jsonPath }
  }) + "\n");
}

main().catch(e => { console.error(e); process.exit(1); });