// CV-maker capture — content script.
//
// Runs on supported job sites (and can be injected into any tab from the
// popup). It reads ONLY the page you're already viewing in your own logged-in
// session — schema.org JobPosting JSON-LD first (reliable across sites), then
// light per-site / heuristic fallbacks — and hands postings to the background
// worker, which forwards them to the local CV-maker app.
//
// Nothing is scraped from a bot session: this is your browser, your session,
// the page on your screen.

(() => {
  function sourceForHost(host) {
    if (/(^|\.)linkedin\.com$/i.test(host)) return "linkedin";
    if (/(^|\.)jobs\.bg$/i.test(host)) return "jobsbg";
    if (/(^|\.)indeed\.com$/i.test(host)) return "indeed";
    if (/(^|\.)glassdoor\.com$/i.test(host)) return "glassdoor";
    return "capture";
  }

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function absUrl(href) {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return href || location.href;
    }
  }

  // schema.org MonetaryAmount → a readable salary string.
  function salaryFromLd(ms) {
    if (!ms || typeof ms !== "object") return undefined;
    const cur = ms.currency || ms.salaryCurrency || "";
    const v = ms.value && typeof ms.value === "object" ? ms.value : ms;
    const unit = v.unitText ? ` / ${String(v.unitText).toLowerCase()}` : "";
    let amount;
    if (v.minValue != null && v.maxValue != null) amount = `${v.minValue}–${v.maxValue}`;
    else if (v.value != null) amount = `${v.value}`;
    else if (v.minValue != null) amount = `${v.minValue}+`;
    if (!amount) return undefined;
    return clean(`${cur} ${amount}${unit}`);
  }

  // 1) schema.org JobPosting JSON-LD (the reliable path — LinkedIn job detail
  //    pages and many career sites embed it).
  function fromJsonLd() {
    const out = [];
    const nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (const el of nodes) {
      let parsed;
      try {
        parsed = JSON.parse(el.textContent || "");
      } catch {
        continue;
      }
      const flat = [];
      const visit = (v) => {
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") {
          flat.push(v);
          if (Array.isArray(v["@graph"])) visit(v["@graph"]);
        }
      };
      visit(parsed);
      for (const n of flat) {
        const t = n["@type"];
        const isJob = t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
        if (!isJob) continue;
        const title = clean(n.title || n.name);
        if (!title) continue;
        const org = n.hiringOrganization;
        const company = clean(typeof org === "string" ? org : org && org.name) || location.hostname;
        let loc;
        const jl = Array.isArray(n.jobLocation) ? n.jobLocation[0] : n.jobLocation;
        if (jl && jl.address) {
          const a = jl.address;
          loc = clean([a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", "));
        }
        out.push({
          url: absUrl(typeof n.url === "string" ? n.url : location.href),
          title,
          company,
          location: loc || undefined,
          salary: salaryFromLd(n.baseSalary || n.estimatedSalary),
          description: clean(typeof n.description === "string" ? n.description.replace(/<[^>]+>/g, " ") : "").slice(0, 4000) || undefined,
        });
      }
    }
    return out;
  }

  // 2) Heuristic single-posting fallback for a job DETAIL page with no JSON-LD:
  //    the most prominent <h1> as the title, plus a best-effort company guess.
  function fromHeuristic() {
    const h1 = document.querySelector("h1");
    const title = clean(h1 && h1.textContent);
    if (!title || title.length < 3 || title.length > 160) return [];
    // Company: a few common patterns, else page title tail.
    const compEl = document.querySelector(
      '[class*="company"] a, [class*="company-name"], [data-company-name], a[href*="/company/"]',
    );
    const company =
      clean(compEl && compEl.textContent) ||
      clean((document.title.split(/[|\-–—]/)[1] || "")) ||
      location.hostname;
    return [{ url: location.href, title, company, location: undefined, description: undefined }];
  }

  // jobs.bg detail pages: no JSON-LD, Angular/MDC SPA. The role is in
  // `.job-view-title`; company + city live in og:title
  // ("IT JOBS - <role>, <city>, обява за работа от <company>" / "...job ad
  // from <company>"). List/search pages render rows without anchors, so we
  // only capture an open job-detail page (browsing into jobs captures each).
  function fromJobsBg() {
    const titleEl = document.querySelector(".job-view-title");
    const title = clean(titleEl && titleEl.textContent);
    if (!title) return []; // list/search page → nothing reliable to grab
    const og =
      (document.querySelector('meta[property="og:title"]') || {}).content ||
      document.title ||
      "";
    let company = "";
    const fromBg = og.match(/обява за работа от\s+(.+)$/i);
    const fromEn = og.match(/job ad from\s+(.+)$/i);
    if (fromBg) company = clean(fromBg[1]);
    else if (fromEn) company = clean(fromEn[1]);
    if (!company) {
      const link = document.querySelector('a[href*="/company/"]');
      const m = link && (link.getAttribute("href") || "").match(/\/company\/([^/?]+)/);
      if (m) company = m[1];
    }
    // No \b — JS word boundaries don't bind around Cyrillic letters.
    const cityM = og.match(
      /(София|Sofia|Пловдив|Plovdiv|Варна|Varna|Бургас|Burgas|Русе|Ruse|дистанционно|remote|хибрид|hybrid)/i,
    );
    const canonical =
      (document.querySelector('link[rel="canonical"]') || {}).href ||
      (document.querySelector('meta[property="og:url"]') || {}).content ||
      location.href;
    // The full description lives in the same-origin #customJobIframe — the top
    // frame can read its contentDocument. Salary, when shown, is in there too.
    let description;
    let salary;
    try {
      const iframe = document.querySelector("#customJobIframe");
      const idoc = iframe && iframe.contentDocument;
      const body = idoc && idoc.body ? clean(idoc.body.innerText) : "";
      if (body) {
        description = body.slice(0, 4000);
        const sm = body.match(/(\d[\d\s.,]{2,})\s*(лв|lv|bgn|eur|€|usd|\$)\b/i);
        if (sm) salary = clean(sm[0]);
      }
    } catch {
      // iframe not yet loaded / not accessible — title + company still captured
    }
    return [
      {
        url: absUrl(canonical),
        title,
        company: company || "jobs.bg",
        location: cityM ? cityM[1] : undefined,
        salary,
        description,
      },
    ];
  }

  function extract() {
    let postings;
    if (/(^|\.)jobs\.bg$/i.test(location.hostname)) {
      postings = fromJobsBg();
    } else {
      postings = fromJsonLd();
      if (postings.length === 0) postings = fromHeuristic();
    }
    // Dedupe by url+title within this extraction.
    const seen = new Set();
    return postings.filter((p) => {
      const k = p.url + "|" + p.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function capture(reason) {
    const postings = extract();
    if (postings.length === 0) return 0;
    const source = sourceForHost(location.hostname);
    chrome.runtime.sendMessage({
      type: "cvm-capture",
      source,
      site: location.hostname,
      postings,
      reason: reason || "auto",
    });
    return postings.length;
  }

  // React to SPA navigations (LinkedIn etc. don't full-reload).
  let lastHref = location.href;
  const onMaybeNav = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(() => maybeAutoCapture(), 1200);
    }
  };

  function maybeAutoCapture() {
    chrome.storage.local.get({ autoCapture: true }, (cfg) => {
      if (cfg.autoCapture) capture("auto");
    });
  }

  // Popup → "capture this page now".
  if (!window.__cvmBound) {
    window.__cvmBound = true;
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg && msg.type === "cvm-capture-now") {
        const n = capture("manual");
        reply({ captured: n });
      }
      return true;
    });
    setInterval(onMaybeNav, 1500);
  }

  // Initial pass shortly after load (let JSON-LD / cards render).
  setTimeout(() => maybeAutoCapture(), 1500);
})();
