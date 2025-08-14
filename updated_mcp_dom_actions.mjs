// updated_mcp_dom_actions.mjs  
// Updated DOM helpers for lightweight MCP server

const OK = (msg) => JSON.stringify({ ok: true, msg });
const ERR = (e) => JSON.stringify({ ok: false, msg: String(e) });

function small(s) {
  if (!s) return "";
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

export async function silentNavigate(mcpClient, url) {
  try {
    const resp = await mcpClient.tools.call("browser_navigate", { url });
    const raw = typeof resp === "string" ? resp : (resp?.content?.[0]?.text ?? JSON.stringify(resp));
    const parsed = JSON.parse(raw);
    return parsed.ok ? OK("nav-success") : ERR("nav-failed");
  } catch (e) {
    return ERR("nav-error: " + e.message);
  }
}

export async function waitForSelector(mcpClient, { url, selector, timeoutMs = 15000 }) {
  try {
    const resp = await mcpClient.tools.call("browser_wait", { 
      selector, 
      timeout: timeoutMs 
    });
    const raw = typeof resp === "string" ? resp : (resp?.content?.[0]?.text ?? JSON.stringify(resp));
    const parsed = JSON.parse(raw);
    return parsed.ok ? OK("element-found") : ERR("element-not-found");
  } catch (e) {
    return ERR("wait-error: " + e.message);
  }
}

export async function clickByText(mcpClient, { url, pattern, nth = 0, scopeSelector = "body" }) {
  const jsCode = `
    (() => {
      try {
        const root = document.querySelector('${scopeSelector}') || document.body;
        const rx = new RegExp('${pattern}', "i");
        const els = Array.from(root.querySelectorAll("a, button, [role='button'], [onclick]"));
        const matches = els
          .map(el => ({ el, t: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim() }))
          .filter(x => rx.test(x.t));
        if (!matches.length) return ${OK("no-match")};
        const pick = matches[${nth}]?.el || matches[0].el;
        pick.scrollIntoView({ block: "center", inline: "center" });
        pick.click();
        const label = matches[${nth}]?.t || matches[0].t;
        return ${OK("clicked: ")} + '${pattern}' + " | " + label.slice(0,120);
      } catch (e) { return ${ERR("click-failed: ")} + String(e); }
    })()
  `;
  
  try {
    const resp = await mcpClient.tools.call("browser_evaluate", { function: jsCode });
    return typeof resp === "string" ? resp : (resp?.content?.[0]?.text ?? JSON.stringify(resp));
  } catch (e) {
    return ERR("click-error: " + e.message);
  }
}

export async function getVDPLinks(mcpClient, { url, limit = 5 }) {
  const jsCode = `
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
  
  try {
    const resp = await mcpClient.tools.call("browser_evaluate", { function: jsCode });
    return typeof resp === "string" ? resp : (resp?.content?.[0]?.text ?? JSON.stringify(resp));
  } catch (e) {
    return JSON.stringify({ ok: false, links: [], msg: e.message });
  }
}

export async function findFeeSnippets(mcpClient, { url, maxChars = 1800 }) {
  const jsCode = `
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
  
  try {
    const resp = await mcpClient.tools.call("browser_evaluate", { function: jsCode });
    return typeof resp === "string" ? resp : (resp?.content?.[0]?.text ?? JSON.stringify(resp));
  } catch (e) {
    return JSON.stringify({ ok: false, preview: "", msg: e.message });
  }
}