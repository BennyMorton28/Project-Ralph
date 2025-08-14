// mcp_dom_actions.mjs
// Tiny-return Playwright MCP helpers that avoid the 25k token cap.
// All browser_evaluate calls return *only* short strings/arrays.

const OK = (msg) => JSON.stringify({ ok: true, msg });
const ERR = (e) => JSON.stringify({ ok: false, msg: String(e) });

function small(s) {
  if (!s) return "";
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

export async function silentNavigate(mcpClient, url) {
  const code = `
    (() => {
      try {
        if (location.href !== ${JSON.stringify(url)}) location.href = ${JSON.stringify(url)};
        return ${OK("nav-issued")};
      } catch (e) { return ${ERR("nav-failed: ")} + String(e); }
    })()
  `;
  const resp = await mcpClient.tools.call("browser_evaluate", { url, code });
  return typeof resp === "string" ? resp : (resp?.content ?? resp?.text ?? resp?.result ?? "");
}

export async function waitForSelector(mcpClient, { url, selector, timeoutMs = 15000, pollMs = 350 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const code = `
      (() => {
        try {
          const el = document.querySelector(${JSON.stringify(selector)});
          return ${OK("present: ")} + String(!!el);
        } catch (e) { return ${ERR("bad-selector")}; }
      })()
    `;
    const r = await mcpClient.tools.call("browser_evaluate", { url, code });
    const raw = typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
    if (String(raw).includes("present: true")) return raw;
    await new Promise((res) => setTimeout(res, pollMs));
  }
  return JSON.stringify({ ok: false, msg: "timeout waiting for " + selector });
}

export async function clickByText(mcpClient, { url, pattern, nth = 0, scopeSelector = "body" }) {
  const code = `
    (() => {
      try {
        const root = document.querySelector(${JSON.stringify(scopeSelector)}) || document.body;
        const rx = new RegExp(${JSON.stringify(pattern)}, "i");
        const els = Array.from(root.querySelectorAll("a, button, [role='button'], [onclick]"));
        const matches = els
          .map(el => ({ el, t: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim() }))
          .filter(x => rx.test(x.t));
        if (!matches.length) return ${OK("no-match")};
        const pick = matches[${nth}]?.el || matches[0].el;
        pick.scrollIntoView({ block: "center", inline: "center" });
        pick.click();
        const label = matches[${nth}]?.t || matches[0].t;
        return ${OK("clicked: ")} + ${JSON.stringify(pattern)} + " | " + label.slice(0,120);
      } catch (e) { return ${ERR("click-failed: ")} + String(e); }
    })()
  `;
  const r = await mcpClient.tools.call("browser_evaluate", { url, code });
  return typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
}

export async function getVDPLinks(mcpClient, { url, limit = 5 }) {
  const code = `
    (() => {
      try {
        const as = Array.from(document.querySelectorAll("a[href]"));
        const wanted = as
          .map(a => a.href)
          .filter(h => /\\/(vehicle|used|pre[- ]?owned|inventory)/i.test(h))
          .filter((h, i, arr) => arr.indexOf(h) === i)
          .slice(0, ${limit});
        return JSON.stringify({ ok: true, links: wanted });
      } catch (e) { return JSON.stringify({ ok: false, links: [], msg: String(e) }); }
    })()
  `;
  const r = await mcpClient.tools.call("browser_evaluate", { url, code });
  return typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
}

export async function findFeeSnippets(mcpClient, { url, maxChars = 1800 }) {
  const code = `
    (() => {
      try {
        const text = (document.body?.innerText || "").split(/\\n+/);
        const rx = /(dealer|doc|documentation|processing|prep|pre[- ]delivery|admin|electronic filing|e[- ]file|tag|agency)\\s+fee/i;
        const hits = [];
        for (const line of text) {
          if (rx.test(line)) hits.push(line.replace(/\\s+/g," ").trim());
          if (hits.length >= 20) break;
        }
        const out = hits.join("\\n");
        return JSON.stringify({ ok: true, preview: out.slice(0, ${maxChars}) });
      } catch (e) { return JSON.stringify({ ok: false, preview: "", msg: String(e) }); }
    })()
  `;
  const r = await mcpClient.tools.call("browser_evaluate", { url, code });
  return typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
}