const db = window.QI_OBSIDIAN_DB || { meta: {}, docs: [], signals: [] };
const hotDb = window.QI_AIHOT_DB || { meta: {}, selected: [], items: [], latestDaily: {}, dailies: [] };

const labels = {
  daily: "日报",
  daily_report: "日报解读",
  weekly: "周报",
  weekly_report: "周报解读",
  monthly: "月报",
  monthly_report: "月报解读",
  topic_file: "主题文件",
  topic_report: "主题报告",
  group: "信号组",
  other: "其他",
};

const categoryLabels = {
  "ai-models": "公司与模型",
  "ai-products": "产品发布/更新",
  industry: "行业动态",
  paper: "论文研究",
  tip: "技巧与观点",
};

let state = {
  mode: "theme",
  content: "docs",
  query: "",
  quick: "all",
  themeMajor: "all",
  themeMinor: "all",
  timeBucket: "daily",
  timePeriod: "all",
  hotCategory: "all",
  current: null,
  page: 1,
  pageSize: 36,
  lastEntries: [],
};

let favorites = JSON.parse(localStorage.getItem("qiSignalwiseFavoritesV2") || "[]");
let topicByLinkCache = null;

const $ = (id) => document.getElementById(id);
const n = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);
const low = (value) => String(value || "").toLowerCase();
const dateOnly = (value) => String(value || "").slice(0, 10);
const isDailyPeriod = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const sourceName = (value) => String(value || "").replace(/（RSS）|：AI 热帖| 热门（buzzing.cc 中文翻译）/g, "");

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return esc(value);
}

function short(value, length = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1).trim()}...` : text;
}

function urlHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceLink(item) {
  return item?.link || item?.sourceUrl || "";
}

function sourceLinkLabel(link) {
  const host = urlHost(link);
  if (!host) return "原始来源";
  if (host === "x.com" || host === "twitter.com") return "原推特";
  if (host === "mp.weixin.qq.com") return "公众号";
  if (host === "github.com") return "GitHub";
  return host;
}

function timeOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function hotSourceTag(item) {
  return item.selected ? "精选" : "全部 AI 动态";
}

function itemKey(type, id) {
  return `${type}:${id}`;
}

function resetPage() {
  state.page = 1;
}

function saveFavorites() {
  localStorage.setItem("qiSignalwiseFavoritesV2", JSON.stringify(favorites));
  renderStats();
  renderFavorites();
}

function isFavorite(type, id) {
  return favorites.includes(itemKey(type, id));
}

function toggleFavorite(type, id) {
  const key = itemKey(type, id);
  favorites = favorites.includes(key) ? favorites.filter((item) => item !== key) : [key, ...favorites].slice(0, 500);
  saveFavorites();
  updateFavoriteButton();
  renderRecommendations();
}

function validTopic(major, minor) {
  return Boolean(major) && major !== ".qi_signal_work" && major !== "未映射" && minor !== "待验证";
}

function topicByLink() {
  if (topicByLinkCache) return topicByLinkCache;
  topicByLinkCache = new Map();
  db.signals.forEach((sig) => {
    if (!sig.link || !validTopic(sig.themeMajor, sig.themeMinor)) return;
    const current = topicByLinkCache.get(sig.link);
    const score = (sig.themeMinor ? 2 : 0) + (/^\d/.test(sig.themeMajor || "") ? 1 : 0);
    if (!current || score > current.score) topicByLinkCache.set(sig.link, { major: sig.themeMajor, minor: sig.themeMinor, score });
  });
  return topicByLinkCache;
}

function signalTopic(sig) {
  if (validTopic(sig.themeMajor, sig.themeMinor)) return { major: sig.themeMajor, minor: sig.themeMinor };
  return topicByLink().get(sig.link) || { major: sig.themeMajor || "", minor: sig.themeMinor || "" };
}

function signalExcerpt(sig, length = 170) {
  const title = String(sig.title || "").trim();
  let text = String(sig.excerpt || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/链接[:：]/g, "")
    .replace(/推特作者[:：][^。；;\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title) text = text.replace(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "").trim();
  return short(text || sig.excerpt, length);
}

function normalizeHotItem(item) {
  const category = item.category || "industry";
  return {
    id: `hot-${item.id || item.permalink || item.url}`,
    rawId: item.id || item.permalink || item.url,
    title: item.title || item.title_en || "未命名资讯",
    excerpt: item.summary || item.title_en || "",
    summary: item.summary || "",
    link: item.url || item.sourceUrl || "",
    permalink: item.permalink || item.url || "",
    source: item.source || "",
    period: dateOnly(item.publishedAt),
    publishedAt: item.publishedAt || "",
    category,
    score: item.score || 0,
    selected: Boolean(item.selected),
    tags: [categoryLabels[category] || category, item.selected ? "精选" : "全部 AI 动态"].filter(Boolean),
    sourceType: "aihot",
  };
}

const hotItems = (hotDb.items || []).map(normalizeHotItem);
const selectedHotItems = (hotDb.selected || []).map(normalizeHotItem);

function entry(type, item) {
  return { type, item };
}

function currentEntry() {
  if (!state.current) return null;
  return findEntry(state.current.type, state.current.id);
}

function findEntry(type, id) {
  if (type === "doc") return entry(type, db.docs.find((doc) => doc.id === id));
  if (type === "signal") return entry(type, db.signals.find((sig) => sig.id === id));
  if (type === "hot") return entry(type, hotItems.find((item) => item.id === id) || selectedHotItems.find((item) => item.id === id));
  return null;
}

function textForDoc(doc) {
  return low(`${doc.title} ${doc.rel} ${doc.kind} ${doc.period} ${doc.themeMajor} ${doc.themeMinor} ${doc.excerpt} ${doc.content}`);
}

function textForSignal(sig) {
  const topic = signalTopic(sig);
  return low(`${sig.title} ${sig.author} ${sig.link} ${sig.period} ${topic.major} ${topic.minor} ${sig.tags?.join(" ")} ${sig.excerpt}`);
}

function textForHot(item) {
  return low(`${item.title} ${item.source} ${item.period} ${item.category} ${item.tags?.join(" ")} ${item.excerpt} ${item.link}`);
}

function searchMatch(type, item) {
  const q = low(state.query).trim();
  if (!q) return true;
  const text = type === "doc" ? textForDoc(item) : type === "signal" ? textForSignal(item) : textForHot(item);
  return q.split(/\s+/).filter(Boolean).every((term) => text.includes(term));
}

function quickMatch(type, item) {
  if (state.quick === "all") return true;
  const text = type === "doc" ? textForDoc(item) : type === "signal" ? textForSignal(item) : textForHot(item);
  return text.includes(low(state.quick));
}

function inCurrentModeDoc(doc) {
  if (state.mode === "aihot") return false;
  if (state.mode === "theme") {
    if (!doc.themeMajor || doc.themeMajor.startsWith(".")) return false;
    if (state.themeMajor !== "all" && doc.themeMajor !== state.themeMajor) return false;
    if (state.themeMinor !== "all" && doc.themeMinor !== state.themeMinor) return false;
    return true;
  }
  if (doc.timeBucket !== state.timeBucket) return false;
  if (state.timePeriod !== "all" && doc.period !== state.timePeriod) return false;
  return true;
}

function inCurrentModeSignal(sig) {
  if (state.mode === "aihot") return false;
  if (state.mode === "theme") {
    const topic = signalTopic(sig);
    if (!topic.major || topic.major.startsWith(".")) return false;
    if (state.themeMajor !== "all" && topic.major !== state.themeMajor) return false;
    if (state.themeMinor !== "all" && topic.minor !== state.themeMinor) return false;
    return true;
  }
  if (sig.timeBucket !== state.timeBucket) return false;
  if (state.timePeriod !== "all" && sig.period !== state.timePeriod) return false;
  return true;
}

function inCurrentModeHot(item) {
  if (state.hotCategory === "selected") return item.selected;
  return state.hotCategory === "all" || item.category === state.hotCategory;
}

function activeDocs() {
  let docs = db.docs.filter(inCurrentModeDoc);
  if (state.content === "reports") docs = docs.filter((doc) => doc.kind.includes("report"));
  docs = docs.filter((doc) => searchMatch("doc", doc) && quickMatch("doc", doc));
  return docs.sort((a, b) => low(b.period).localeCompare(low(a.period)) || b.updatedAt.localeCompare(a.updatedAt));
}

function activeSignals() {
  let signals = db.signals.filter(inCurrentModeSignal);
  signals = signals.filter((sig) => searchMatch("signal", sig) && quickMatch("signal", sig));
  return signals.sort((a, b) => low(b.period).localeCompare(low(a.period)));
}

function activeHot() {
  return hotItems
    .filter(inCurrentModeHot)
    .filter((item) => searchMatch("hot", item) && quickMatch("hot", item))
    .sort((a, b) => low(b.publishedAt).localeCompare(low(a.publishedAt)) || b.score - a.score);
}

function favoriteItems() {
  return favorites.map((key) => {
    const splitAt = key.indexOf(":");
    const type = key.slice(0, splitAt);
    const id = key.slice(splitAt + 1);
    return findEntry(type, id);
  }).filter((hit) => hit?.item);
}

function renderStats() {
  $("docCount").textContent = n(db.meta.docCount);
  $("signalCount").textContent = n(db.meta.signalCount);
  $("aiHotCount").textContent = n(hotDb.meta?.mergedCount || hotItems.length);
  $("favoriteCount").textContent = n(favorites.length);
  $("dbSourceName").textContent = state.mode === "aihot" ? "综合 + Obsidian" : "Obsidian Vault";
  $("dbSourcePath").textContent = state.mode === "aihot"
    ? `公开 AI 动态 · ${hotDb.meta?.dailyDate || ""}`
    : db.meta.source || "";
}

function themeTree() {
  const map = new Map();
  db.docs.filter((doc) => doc.themeMajor && !doc.themeMajor.startsWith(".")).forEach((doc) => {
    if (!map.has(doc.themeMajor)) map.set(doc.themeMajor, new Map());
    const minors = map.get(doc.themeMajor);
    const key = doc.themeMinor || "未分小类";
    minors.set(key, (minors.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
}

function timeTree() {
  return [
    ["daily", "日报"],
    ["weekly", "周报"],
    ["monthly", "月报"],
  ].map(([key, label]) => {
    const docs = db.docs.filter((doc) => doc.timeBucket === key);
    const periods = new Map();
    docs.forEach((doc) => {
      if (doc.period) periods.set(doc.period, (periods.get(doc.period) || 0) + 1);
    });
    return [key, label, docs.length, [...periods.entries()].sort((a, b) => low(b[0]).localeCompare(low(a[0])))];
  });
}

function hotTree() {
  const counts = new Map();
  hotItems.forEach((item) => counts.set(item.category, (counts.get(item.category) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderQuickFilters() {
  const filters = [
    ["all", "全部"],
    ["agent", "Agent"],
    ["模型", "模型"],
    ["产品", "产品"],
    ["开源", "开源"],
    ["安全", "安全"],
    ["评测", "评测"],
  ];
  $("quickFilters").innerHTML = filters.map(([key, label]) => `
    <button type="button" class="${state.quick === key ? "active" : ""}" data-quick="${escapeAttr(key)}">${esc(label)}</button>
  `).join("");
}

function renderTree() {
  const list = $("treeList");
  const isHot = state.mode === "aihot";
  $("pageTitle").textContent = state.mode === "theme" ? "按主题浏览 Qi 信号" : state.mode === "time" ? "按时间浏览 Qi 信号" : "综合 AI 动态";
  $("treeEyebrow").textContent = state.mode === "theme" ? "Theme tree" : state.mode === "time" ? "Time tree" : "Combined feed";
  $("treeTitle").textContent = state.mode === "theme" ? "主题大类 / 小类" : state.mode === "time" ? "日报 / 周报 / 月报" : "综合栏目";

  if (isHot) {
    list.innerHTML = `
      <button class="tree-major ${state.hotCategory === "selected" ? "active" : ""}" type="button" data-category="selected">
        <span>精选</span><strong>${n(hotItems.filter((item) => item.selected).length)}</strong>
      </button>
      <button class="tree-major ${state.hotCategory === "all" ? "active" : ""}" type="button" data-category="all">
        <span>全部 AI 动态</span><strong>${n(hotItems.length)}</strong>
      </button>
      ${hotTree().map(([category, count]) => `
        <button class="tree-major ${state.hotCategory === category ? "active" : ""}" type="button" data-category="${escapeAttr(category)}">
          <span>${esc(categoryLabels[category] || category)}</span><strong>${n(count)}</strong>
        </button>
      `).join("")}
    `;
    return;
  }

  if (state.mode === "time") {
    list.innerHTML = timeTree().map(([key, label, count, periods]) => `
      <div class="tree-group">
        <button class="tree-major ${state.timeBucket === key && state.timePeriod === "all" ? "active" : ""}" type="button" data-time="${key}" data-period="all">
          <span>${label}</span><strong>${n(count)}</strong>
        </button>
        <div class="tree-minors">
          ${periods.slice(0, 90).map(([period, periodCount]) => `
            <button class="tree-minor ${state.timeBucket === key && state.timePeriod === period ? "active" : ""}" type="button" data-time="${key}" data-period="${escapeAttr(period)}">
              <span>${esc(period)}</span><strong>${n(periodCount)}</strong>
            </button>
          `).join("")}
        </div>
      </div>
    `).join("");
    return;
  }

  list.innerHTML = `
    <button class="tree-major ${state.themeMajor === "all" ? "active" : ""}" type="button" data-major="all"><span>全部主题</span><strong>${n(db.docs.filter((d) => d.themeMajor && !d.themeMajor.startsWith(".")).length)}</strong></button>
    ${themeTree().map(([major, minors]) => `
      <div class="tree-group">
        <button class="tree-major ${state.themeMajor === major && state.themeMinor === "all" ? "active" : ""}" type="button" data-major="${escapeAttr(major)}">
          <span>${esc(major)}</span><strong>${n([...minors.values()].reduce((a, b) => a + b, 0))}</strong>
        </button>
        <div class="tree-minors">
          ${[...minors.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN")).map(([minor, count]) => `
            <button class="tree-minor ${state.themeMajor === major && state.themeMinor === minor ? "active" : ""}" type="button" data-major="${escapeAttr(major)}" data-minor="${escapeAttr(minor)}">
              <span>${esc(minor)}</span><strong>${n(count)}</strong>
            </button>
          `).join("")}
        </div>
      </div>
    `).join("")}
  `;
}

function renderResults() {
  let entries = [];
  let title = "文档列表";

  if (state.content === "signals") {
    entries = activeSignals().map((item) => entry("signal", item));
    title = "信号列表";
  } else if (state.content === "aihot" || state.mode === "aihot") {
    entries = activeHot().map((item) => entry("hot", item));
    title = state.hotCategory === "selected" ? "精选" : state.hotCategory === "all" ? "全部 AI 动态" : (categoryLabels[state.hotCategory] || "综合动态");
    state.content = "aihot";
    syncContentTabs();
  } else if (state.content === "favorites") {
    entries = favoriteItems();
    title = "收藏内容";
  } else {
    entries = activeDocs().map((item) => entry("doc", item));
    title = state.content === "reports" ? "报告列表" : "文档列表";
  }

  state.lastEntries = entries;
  $("resultTitle").textContent = title;
  $("resultEyebrow").textContent = state.mode === "theme" ? "Theme database" : state.mode === "time" ? "Time database" : "Public feed";
  $("resultCount").textContent = `${n(entries.length)} 条`;

  const totalPages = Math.max(1, Math.ceil(entries.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.pageSize;
  const pageEntries = entries.slice(start, start + state.pageSize);
  $("resultsList").innerHTML = pageEntries.map(renderEntryCard).join("") || `<div class="empty-state">没有匹配内容</div>`;
  renderPager(entries.length, start + 1, Math.min(start + pageEntries.length, entries.length), totalPages);
  updateReaderNav();
  if (window.lucide) window.lucide.createIcons();
}

function renderEntryCard(hit) {
  if (hit.type === "signal") return renderSignal(hit.item);
  if (hit.type === "hot") return renderHot(hit.item);
  return renderDoc(hit.item);
}

function renderDoc(doc) {
  const splitCount = signalsForDoc(doc).length;
  return `<article class="result-card">
    <button class="result-main" type="button" data-doc-id="${doc.id}">
      <span class="type-pill">${esc(labels[doc.kind] || doc.kind)}</span>
      <strong>${esc(doc.title)}</strong>
      <p>${esc(short(doc.excerpt || doc.rel, 190))}</p>
      <small>${esc(doc.period || "无时间")} · ${esc(doc.themeMinor || doc.themeMajor || doc.timeBucket || "未归类")} · ${splitCount ? `${n(splitCount)} 条拆分信号` : doc.count ? `${n(doc.count)} 条` : "Markdown"}</small>
    </button>
    <div class="result-actions">
      <button type="button" data-doc-id="${doc.id}"><i data-lucide="book-open"></i><span>阅读</span></button>
      <span>${esc(doc.rel)}</span>
    </div>
  </article>`;
}

function signalsForDoc(doc) {
  if (!doc?.id) return [];
  return db.signals.filter((sig) => sig.docId === doc.id);
}

function renderSignal(sig) {
  const topic = signalTopic(sig);
  const host = urlHost(sig.link) || "原文";
  return `<article class="result-card">
    <button class="result-main" type="button" data-signal-id="${sig.id}">
      <span class="type-pill">${esc(sig.period || "信号")}</span>
      <strong>${esc(sig.title)}</strong>
      <p>${esc(signalExcerpt(sig, 190))}</p>
      <small>${esc(sig.author || "未知作者")} · ${esc(topic.major || "未归类")} / ${esc(topic.minor || "精选")}</small>
    </button>
    <div class="result-actions">
      <button type="button" data-signal-id="${sig.id}"><i data-lucide="panel-right-open"></i><span>解读</span></button>
      ${sig.link ? `<a href="${esc(sig.link)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>${esc(host)}</span></a>` : ""}
    </div>
  </article>`;
}

function renderHot(item) {
  const link = sourceLink(item);
  const tags = (item.tags || []).slice(0, 4);
  return `<article class="result-card result-card-hot">
    <div class="timeline-time">${esc(timeOnly(item.publishedAt) || item.period || "最新")}</div>
    <div class="timeline-rail" aria-hidden="true"><span class="timeline-dot"></span></div>
    <button class="result-main" type="button" data-hot-id="${item.id}">
      <span class="result-card-head">
        <span class="timeline-source">${esc(sourceName(item.source || "公开来源"))}</span>
        <span class="timeline-head-right">
          ${item.selected ? `<span class="timeline-selected-badge">精选</span>` : ""}
          <span class="timeline-score">${esc(item.score || "AI")}</span>
        </span>
      </span>
      <strong>${esc(item.title)}</strong>
      <p>${esc(short(item.excerpt, 210))}</p>
      <span class="timeline-tags">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</span>
      <small><span class="timeline-reason-label">栏目：</span>${esc(categoryLabels[item.category] || item.category)} · ${esc(hotSourceTag(item))}</small>
    </button>
    <div class="result-actions">
      <button type="button" data-hot-id="${item.id}"><i data-lucide="sparkles"></i><span>分析</span></button>
      ${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>${esc(sourceLinkLabel(link))}</span></a>` : ""}
    </div>
  </article>`;
}

function renderPager(total, from, to, totalPages) {
  const pager = $("resultsPager");
  if (!total) {
    pager.innerHTML = "";
    return;
  }
  const pages = [];
  for (let page = Math.max(1, state.page - 2); page <= Math.min(totalPages, state.page + 2); page += 1) pages.push(page);
  pager.innerHTML = `
    <button type="button" data-page-action="prev" ${state.page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i><span>上一页</span></button>
    <span class="pager-status">${n(from)}-${n(to)} / ${n(total)} · 第 ${n(state.page)} / ${n(totalPages)} 页</span>
    <div class="pager-pages">${pages.map((page) => `<button type="button" class="${page === state.page ? "active" : ""}" data-page="${page}">${page}</button>`).join("")}</div>
    <button type="button" data-page-action="next" ${state.page >= totalPages ? "disabled" : ""}><span>下一页</span><i data-lucide="chevron-right"></i></button>
  `;
}

function inline(text) {
  return String(text || "")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(https?:\/\/[^\s)）]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

function md(markdown) {
  const safe = String(markdown || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return safe.split("\n").map((line) => {
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) return `<h${Math.min(h[1].length + 1, 6)}>${inline(h[2])}</h${Math.min(h[1].length + 1, 6)}>`;
    if (!line.trim()) return "";
    if (/^[-*]\s+/.test(line)) return `<p>• ${inline(line.replace(/^[-*]\s+/, ""))}</p>`;
    return `<p>${inline(line)}</p>`;
  }).join("");
}

function openDoc(doc) {
  const splitSignals = signalsForDoc(doc);
  state.current = { type: "doc", id: doc.id };
  $("readerTitle").textContent = doc.title;
  $("readerMeta").innerHTML = `<span>${esc(labels[doc.kind] || doc.kind)}</span><span>${esc(doc.period || "无时间")}</span><span>${esc(doc.themeMajor || doc.timeBucket || "")}</span><span>${esc(doc.themeMinor || "")}</span>`;
  $("readerContent").classList.remove("empty-reader");
  $("readerContent").innerHTML = `
    ${splitSignals.length ? `
      <section class="split-signal-panel">
        <div class="split-signal-head">
          <strong>已拆分为 ${n(splitSignals.length)} 条独立信号</strong>
          <span>点开任意一条，右侧会生成它自己的关联网络。</span>
        </div>
        <div class="split-signal-list">
          ${splitSignals.map((sig) => `
            <button type="button" data-signal-id="${sig.id}">
              <b>${esc(sig.title)}</b>
              <small>${esc(sig.author || signalTopic(sig).minor || "信号")} ${sig.link ? `· ${esc(sourceLinkLabel(sig.link))}` : ""}</small>
            </button>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${md(doc.content)}
  `;
  afterOpen();
}

function openSignal(sig) {
  const topic = signalTopic(sig);
  const tags = (sig.tags || []).slice(0, 18);
  state.current = { type: "signal", id: sig.id };
  $("readerTitle").textContent = sig.title;
  $("readerMeta").innerHTML = `<span>${esc(sig.period || "无时间")}</span><span>${esc(topic.major || "未归类")}</span><span>${esc(topic.minor || "")}</span><span>${esc(sig.author || "未知作者")}</span>${sig.link ? `<a href="${esc(sig.link)}" target="_blank" rel="noreferrer">原文</a>` : ""}`;
  $("readerContent").classList.remove("empty-reader");
  $("readerContent").innerHTML = `
    <div class="signal-reader-head">
      <h2>${esc(sig.title)}</h2>
      ${sig.link ? `<a class="primary-link" href="${esc(sig.link)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>打开原推特</span></a>` : ""}
    </div>
    <p>${esc(sig.excerpt)}</p>
    <h3>主题路径</h3>
    <p>${esc([topic.major, topic.minor].filter(Boolean).join(" / ") || "未归类")}</p>
    <h3>标签</h3>
    <div class="tag-row">${tags.length ? tags.map((tag) => `<span>${esc(tag)}</span>`).join("") : `<span>未标注</span>`}</div>
  `;
  afterOpen();
}

function openHot(item) {
  const link = sourceLink(item);
  state.current = { type: "hot", id: item.id };
  $("readerTitle").textContent = item.title;
  $("readerMeta").innerHTML = `<span>综合</span><span>${esc(categoryLabels[item.category] || item.category)}</span><span>${esc(item.period || "最新")}</span><span>推荐分 ${esc(item.score || "-")}</span><span>${esc(hotSourceTag(item))}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer">${esc(sourceLinkLabel(link))}</a>` : ""}`;
  $("readerContent").classList.remove("empty-reader");
  $("readerContent").innerHTML = `
    <div class="signal-reader-head">
      <h2>${esc(item.title)}</h2>
      ${link ? `<a class="primary-link" href="${esc(link)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>打开${esc(sourceLinkLabel(link))}</span></a>` : ""}
    </div>
    <p>${esc(item.summary || item.excerpt)}</p>
    <h3>来源</h3>
    <p>${esc(item.source || "公开来源")} ${link ? `· <a href="${esc(link)}" target="_blank" rel="noreferrer">${esc(urlHost(link) || link)}</a>` : ""}</p>
    <h3>和 Qi 信号的可能关联</h3>
    <div class="answer-evidence">${relatedEntries(entry("hot", item), 4).map((hit, index) => renderEvidence(hit, index)).join("") || "<p>暂无明显关联。</p>"}</div>
  `;
  afterOpen();
}

function afterOpen() {
  updateFavoriteButton();
  updateReaderNav();
  renderRelations();
  renderRecommendations();
  renderQuestionChips();
  if (window.lucide) window.lucide.createIcons();
}

function updateFavoriteButton() {
  const btn = $("favoriteButton");
  if (!btn || !state.current) return;
  const active = isFavorite(state.current.type, state.current.id);
  btn.classList.toggle("active", active);
  btn.querySelector("span").textContent = active ? "已收藏" : "收藏";
}

function currentListEntries() {
  return state.content === "favorites" ? favoriteItems() : state.lastEntries;
}

function currentIndex() {
  if (!state.current) return -1;
  return currentListEntries().findIndex((hit) => hit.type === state.current.type && hit.item.id === state.current.id);
}

function openEntry(hit) {
  if (!hit?.item) return;
  if (hit.type === "signal") openSignal(hit.item);
  else if (hit.type === "hot") openHot(hit.item);
  else openDoc(hit.item);
}

function openRelativeItem(direction) {
  const entries = currentListEntries();
  const index = currentIndex();
  const next = index + direction;
  if (next < 0 || next >= entries.length) return;
  openEntry(entries[next]);
  const page = Math.floor(next / state.pageSize) + 1;
  if (page !== state.page) {
    state.page = page;
    renderResults();
  }
}

function updateReaderNav() {
  const index = currentIndex();
  const total = currentListEntries().length;
  $("prevItemButton").disabled = index <= 0;
  $("nextItemButton").disabled = index < 0 || index >= total - 1;
}

function mixedHotItems() {
  const local = db.signals
    .filter((sig) => isDailyPeriod(sig.period) && sig.title && validTopic(signalTopic(sig).major, signalTopic(sig).minor))
    .sort((a, b) => low(b.period).localeCompare(low(a.period)))
    .slice(0, 60)
    .map((sig) => {
      const tagScore = Math.min((sig.tags || []).length, 8);
      const depthScore = Math.min(Math.floor(String(sig.excerpt || "").length / 120), 6);
      return { type: "signal", item: sig, score: tagScore + depthScore + 5 };
    });
  const external = selectedHotItems.slice(0, 40).map((item) => ({ type: "hot", item, score: (item.score || 0) / 10 + 8 }));
  return [...external, ...local].sort((a, b) => b.score - a.score).slice(0, 8);
}

function renderHotList() {
  const items = mixedHotItems();
  $("hotDate").textContent = selectedHotItems[0]?.period || items[0]?.item.period || "Latest";
  $("hotList").innerHTML = items.map((hit, index) => {
    const item = hit.item;
    const type = hit.type;
    const title = item.title;
    const text = type === "hot" ? short(item.excerpt, 96) : signalExcerpt(item, 96);
    const topic = type === "hot" ? `综合 / ${categoryLabels[item.category] || item.category}` : `${signalTopic(item).major} / ${signalTopic(item).minor || "精选"}`;
    const link = type === "hot" ? sourceLink(item) : item.link;
    return `<article class="hot-item">
      <button class="hot-open" type="button" data-${type}-id="${item.id}">
        <span class="hot-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="hot-body">
          <span class="hot-meta">${esc(topic)}</span>
          <strong>${esc(title)}</strong>
          <small>${esc(text)}</small>
        </span>
      </button>
      <span class="hot-links">
        <span class="hot-meta">${esc(topic)}</span>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i>${esc(type === "hot" ? sourceLinkLabel(link) : urlHost(link) || "原文")}</a>` : ""}
      </span>
    </article>`;
  }).join("") || `<div class="empty-state">暂无可展示热点</div>`;
}

function renderDailyDigest() {
  const daily = hotDb.latestDaily || {};
  const sections = daily.sections || [];
  const total = sections.reduce((sum, section) => sum + (section.items || []).length, 0);
  const lead = daily.lead?.leadParagraph || daily.lead?.title || `${daily.date || "今日"} · ${n(total)} 条公开 AI 动态`;
  $("dailyDigest").innerHTML = `
    <div class="daily-lead">
      <span>AI 日报</span>
      <strong>${esc(daily.date || "最新日报")}</strong>
      <p>${esc(short(lead, 180))}</p>
      <button type="button" data-daily-section="">查看全部日报</button>
    </div>
    <div class="daily-sections">
      ${sections.slice(0, 5).map((section) => `
        <button type="button" data-daily-section="${escapeAttr(section.label)}">
          <span>${esc(section.label)}</span><strong>${n((section.items || []).length)}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function openDaily(sectionLabel = "") {
  const daily = hotDb.latestDaily || {};
  const sections = daily.sections || [];
  const filtered = sectionLabel ? sections.filter((section) => section.label === sectionLabel) : sections;
  state.current = { type: "hot", id: "__daily__" };
  $("readerTitle").textContent = `AI 日报 ${daily.date || ""}`;
  $("readerMeta").innerHTML = `<span>综合日报</span><span>${esc(daily.date || "")}</span><span>${sectionLabel ? esc(sectionLabel) : "全部栏目"}</span>`;
  $("readerContent").classList.remove("empty-reader");
  $("readerContent").innerHTML = filtered.map((section) => `
    <h2>${esc(section.label)}</h2>
    ${(section.items || []).map((item) => `
      <article class="daily-reader-item">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.summary)}</p>
        <p><a href="${esc(item.sourceUrl || "")}" target="_blank" rel="noreferrer">${esc(item.sourceName || sourceLinkLabel(item.sourceUrl || ""))}</a></p>
      </article>
    `).join("")}
  `).join("") || "<p>暂无日报内容。</p>";
  afterOpen();
}

function tokensFor(hit) {
  if (!hit?.item) return [];
  const item = hit.item;
  let text = "";
  if (hit.type === "doc") text = `${item.title} ${item.themeMajor} ${item.themeMinor} ${item.excerpt}`;
  if (hit.type === "signal") {
    const topic = signalTopic(item);
    text = `${item.title} ${topic.major} ${topic.minor} ${(item.tags || []).join(" ")} ${item.excerpt}`;
  }
  if (hit.type === "hot") text = `${item.title} ${item.category} ${(item.tags || []).join(" ")} ${item.excerpt}`;
  const cn = [...text.matchAll(/[\u4e00-\u9fff]{2,}/g)].flatMap((match) => {
    const value = match[0].slice(0, 24);
    const grams = [];
    for (let i = 0; i < value.length - 1; i += 1) grams.push(value.slice(i, i + 2));
    return grams;
  });
  const latin = low(text).split(/[^a-z0-9+#.]+/).filter((x) => x.length >= 3);
  return [...new Set([...cn, ...latin])].slice(0, 80);
}

function scoreAgainst(tokens, text) {
  const hay = low(text);
  return tokens.reduce((sum, token) => sum + Math.min((hay.split(low(token)).length - 1) * 2, 8), 0);
}

function relationIdentity(hit) {
  if (!hit?.item) return "";
  if (hit.type === "signal") return `signal:${hit.item.link || hit.item.title}`;
  if (hit.type === "hot") return `hot:${sourceLink(hit.item) || hit.item.title}`;
  return `${hit.type}:${hit.item.id || hit.item.title}`;
}

function relationLabel(hit) {
  if (hit.type === "hot") return "外部信号";
  return "信号";
}

function relatedEntries(baseHit, limit = 8) {
  const tokens = tokensFor(baseHit);
  if (!tokens.length) return [];
  const baseIdentity = relationIdentity(baseHit);
  const pool = [
    ...db.signals.map((item) => entry("signal", item)),
    ...hotItems.map((item) => entry("hot", item)),
  ];
  const scored = pool
    .filter((hit) => relationIdentity(hit) !== baseIdentity)
    .map((hit) => {
      const text = hit.type === "signal" ? textForSignal(hit.item) : textForHot(hit.item);
      const recency = isDailyPeriod(hit.item.period) ? Number(hit.item.period.replaceAll("-", "")) / 100000000 : 0;
      return { ...hit, score: scoreAgainst(tokens, text) + recency };
    })
    .filter((hit) => hit.score > 2)
    .sort((a, b) => b.score - a.score);
  const seen = new Set();
  const unique = [];
  scored.forEach((hit) => {
    const key = relationIdentity(hit);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(hit);
  });
  return unique.slice(0, limit);
}

function renderRelations() {
  const base = currentEntry();
  const graph = $("relationGraph");
  if (!base?.item) {
    graph.innerHTML = `<p class="muted">选择一条内容后显示关联。</p>`;
    $("relationCount").textContent = "0";
    return;
  }
  const hits = relatedEntries(base, 7);
  $("relationCount").textContent = n(hits.length);
  graph.innerHTML = `
    <div class="graph-center">${esc(short(base.item.title, 52))}</div>
    <div class="graph-links">
      ${hits.map((hit, index) => `
        <button type="button" class="graph-node graph-node-${index + 1}" data-${hit.type}-id="${hit.item.id}">
          <span>${esc(relationLabel(hit))}</span>
          <strong>${esc(short(hit.item.title, 44))}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function recommendationSeeds() {
  const favs = favoriteItems().slice(0, 12);
  const current = currentEntry();
  return [...(current?.item ? [current] : []), ...favs];
}

function renderRecommendations() {
  const seeds = recommendationSeeds();
  const list = $("recommendList");
  let recs = [];
  if (seeds.length) {
    const tokenSet = [...new Set(seeds.flatMap(tokensFor))].slice(0, 120);
    recs = [
      ...db.signals.map((item) => entry("signal", item)),
      ...hotItems.map((item) => entry("hot", item)),
    ].filter((hit) => !isFavorite(hit.type, hit.item.id))
      .map((hit) => {
        const text = hit.type === "signal" ? textForSignal(hit.item) : textForHot(hit.item);
        return { ...hit, score: scoreAgainst(tokenSet, text) + (hit.type === "hot" ? (hit.item.score || 0) / 20 : 0) };
      })
      .filter((hit) => hit.score > 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);
  } else {
    recs = mixedHotItems().slice(0, 6);
  }
  list.innerHTML = recs.map((hit) => `
    <button type="button" class="recommend-item" data-${hit.type}-id="${hit.item.id}">
      <span>${esc(hit.type === "hot" ? "综合" : "Qi 信号")}</span>
      <strong>${esc(hit.item.title)}</strong>
      <small>${esc(hit.type === "hot" ? short(hit.item.excerpt, 100) : signalExcerpt(hit.item, 100))}</small>
    </button>
  `).join("") || `<p class="muted">选择内容后生成推荐。</p>`;
}

function renderFavorites() {
  const favs = favoriteItems().slice(0, 8);
  $("favoritesList").innerHTML = favs.map((hit) => `<button class="mini-item" type="button" data-${hit.type}-id="${hit.item.id}">${esc(hit.item.title)}</button>`).join("") || `<p class="muted">暂无收藏</p>`;
}

function renderQuestionChips() {
  const base = currentEntry();
  const topic = base?.type === "signal" ? signalTopic(base.item).minor || signalTopic(base.item).major : base?.type === "hot" ? categoryLabels[base.item.category] : base?.item?.themeMinor;
  const chips = [
    topic ? `${topic} 最近有什么连续信号？` : "今天最值得追踪的变化是什么？",
    "哪些信号可能互相印证？",
    "这个主题接下来该问哪三个深度问题？",
  ];
  $("questionChips").innerHTML = chips.map((chip) => `<button type="button" data-question="${escapeAttr(chip)}">${esc(chip)}</button>`).join("");
}

function askDatabase(question) {
  const normalized = low(question);
  const words = normalized.split(/[\s,，。；;：:？?！!、]+/).filter((term) => term.length >= 2);
  const chinese = [...normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)].flatMap((match) => {
    const text = match[0];
    const grams = [];
    for (let i = 0; i < text.length - 1; i += 1) grams.push(text.slice(i, i + 2));
    return grams;
  });
  const terms = [...new Set([...words, ...chinese])].slice(0, 32);
  const current = currentEntry();
  const seedTerms = current ? tokensFor(current).slice(0, 24) : [];
  const allTerms = [...new Set([...terms, ...seedTerms])];
  const docs = db.docs.map((item) => ({ type: "doc", item, score: scoreAgainst(allTerms, textForDoc(item)) + (item.kind.includes("report") ? 4 : 0) })).filter((x) => x.score > 0);
  const sigs = db.signals.map((item) => ({ type: "signal", item, score: scoreAgainst(allTerms, textForSignal(item)) + (validTopic(signalTopic(item).major, signalTopic(item).minor) ? 2 : 0) })).filter((x) => x.score > 0);
  const hots = hotItems.map((item) => ({ type: "hot", item, score: scoreAgainst(allTerms, textForHot(item)) + (item.score || 0) / 20 })).filter((x) => x.score > 0);
  return [...docs, ...sigs, ...hots].sort((a, b) => b.score - a.score).slice(0, 16);
}

function renderAnswer() {
  const q = $("questionInput").value.trim();
  if (!q) return;
  const hits = askDatabase(q);
  if (!hits.length) {
    $("answerBox").innerHTML = "没有找到足够相关的内容。";
    return;
  }
  $("answerBox").innerHTML = buildAnswer(q, hits);
  if (window.lucide) window.lucide.createIcons();
}

function buildAnswer(question, hits) {
  const groups = new Map();
  hits.forEach((hit) => {
    const key = hit.type === "hot"
      ? `综合 / ${categoryLabels[hit.item.category] || hit.item.category}`
      : hit.type === "signal"
        ? [signalTopic(hit.item).major || "未归类", signalTopic(hit.item).minor || ""].filter(Boolean).join(" / ")
        : [hit.item.themeMajor || hit.item.timeBucket || "文档", hit.item.themeMinor || labels[hit.item.kind] || ""].filter(Boolean).join(" / ");
    if (!groups.has(key)) groups.set(key, { key, count: 0 });
    groups.get(key).count += 1;
  });
  const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  const evidence = hits.slice(0, 6);
  const periods = [...new Set(hits.map((hit) => hit.item.period).filter(Boolean))].sort((a, b) => low(b).localeCompare(low(a))).slice(0, 5);
  return `
    <div class="answer-summary">
      <strong>深度回答</strong>
      <p>${esc(`围绕“${question}”，资料主要落在 ${top.map((x) => x.key).join("、") || "若干分散主题"}。我建议把它看成跨来源信号：本地 Obsidian 提供连续跟踪，综合动态补充当天外部资讯。`)}</p>
      <h3>核心判断</h3>
      <p>${esc(`当前最有价值的不是单条新闻，而是“是否形成重复出现的主题”。${periods.length ? `时间上集中在 ${periods.join("、")}。` : ""} 若某主题同时出现在本地信号、综合精选和解读报告里，就值得提升为重点观察对象。`)}</p>
      <h3>证据链</h3>
      <div class="answer-evidence">${evidence.map((hit, index) => renderEvidence(hit, index)).join("")}</div>
      <h3>建议追问</h3>
      <p>${esc(`1. 这个变化是否有产品化落点？ 2. 哪些公司/论文/开源项目在同时推进？ 3. 下周是否出现二次确认信号？`)}</p>
    </div>
  `;
}

function renderEvidence(hit, index) {
  const item = hit.item;
  const text = hit.type === "signal" ? signalExcerpt(item, 118) : hit.type === "hot" ? short(item.excerpt, 118) : short(item.excerpt, 118);
  const link = hit.type === "signal" && item.link ? item.link : hit.type === "hot" ? sourceLink(item) : "";
  return `<div class="evidence-card">
    <span>${index + 1}</span>
    <button type="button" data-${hit.type}-id="${item.id}"><b>${esc(item.title)}</b><small>${esc(text)}</small></button>
    ${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i>来源</a>` : ""}
  </div>`;
}

function syncContentTabs() {
  document.querySelectorAll(".content-tab").forEach((x) => x.classList.toggle("active", x.dataset.content === state.content));
}

function bind() {
  $("modeTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    state.content = state.mode === "aihot" ? "aihot" : "docs";
    state.timePeriod = "all";
    resetPage();
    document.querySelectorAll(".mode-tab").forEach((x) => x.classList.toggle("active", x === btn));
    syncContentTabs();
    renderAll();
  });
  $("quickFilters").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-quick]");
    if (!btn) return;
    state.quick = btn.dataset.quick;
    resetPage();
    renderQuickFilters();
    renderResults();
  });
  $("contentTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-content]");
    if (!btn) return;
    state.content = btn.dataset.content;
    if (state.content === "aihot") state.mode = "aihot";
    resetPage();
    document.querySelectorAll(".mode-tab").forEach((x) => x.classList.toggle("active", x.dataset.mode === state.mode));
    syncContentTabs();
    renderAll();
  });
  $("treeList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.time) {
      state.timeBucket = btn.dataset.time;
      state.timePeriod = btn.dataset.period || "all";
    }
    if (btn.dataset.major) {
      state.themeMajor = btn.dataset.major;
      state.themeMinor = btn.dataset.minor || "all";
      if (btn.dataset.minor) state.content = "signals";
      if (btn.dataset.major === "all") state.content = "docs";
      syncContentTabs();
    }
    if (btn.dataset.category) state.hotCategory = btn.dataset.category;
    resetPage();
    renderTree();
    renderResults();
  });
  $("searchInput").addEventListener("input", (e) => {
    state.query = e.target.value;
    resetPage();
    renderResults();
  });
  $("hotList").addEventListener("click", clickOpen);
  $("resultsList").addEventListener("click", clickOpen);
  $("readerContent").addEventListener("click", clickOpen);
  $("relationGraph").addEventListener("click", clickOpen);
  $("recommendList").addEventListener("click", clickOpen);
  $("favoritesList").addEventListener("click", clickOpen);
  $("answerBox").addEventListener("click", clickOpen);
  $("dailyDigest").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-daily-section]");
    if (btn) openDaily(btn.dataset.dailySection);
  });
  $("dailyFocusButton").addEventListener("click", () => openDaily());
  $("resultsPager").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.dataset.page) state.page = Number(btn.dataset.page);
    if (btn.dataset.pageAction === "prev") state.page = Math.max(1, state.page - 1);
    if (btn.dataset.pageAction === "next") state.page += 1;
    renderResults();
    $("resultsList").scrollTop = 0;
  });
  $("favoriteButton").addEventListener("click", () => {
    if (state.current && state.current.id !== "__daily__") toggleFavorite(state.current.type, state.current.id);
  });
  $("prevItemButton").addEventListener("click", () => openRelativeItem(-1));
  $("nextItemButton").addEventListener("click", () => openRelativeItem(1));
  $("askButton").addEventListener("click", renderAnswer);
  $("questionInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) renderAnswer();
  });
  $("questionChips").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-question]");
    if (!btn) return;
    $("questionInput").value = btn.dataset.question;
    renderAnswer();
  });
}

function clickOpen(e) {
  if (e.target.closest("a")) return;
  const docBtn = e.target.closest("[data-doc-id]");
  const sigBtn = e.target.closest("[data-signal-id]");
  const hotBtn = e.target.closest("[data-hot-id]");
  if (docBtn) {
    const doc = db.docs.find((x) => x.id === docBtn.dataset.docId);
    if (doc) openDoc(doc);
  }
  if (sigBtn) {
    const sig = db.signals.find((x) => x.id === sigBtn.dataset.signalId);
    if (sig) openSignal(sig);
  }
  if (hotBtn) {
    const hot = hotItems.find((x) => x.id === hotBtn.dataset.hotId) || selectedHotItems.find((x) => x.id === hotBtn.dataset.hotId);
    if (hot) openHot(hot);
  }
}

function renderAll() {
  renderStats();
  renderQuickFilters();
  renderTree();
  renderResults();
  renderHotList();
  renderDailyDigest();
  renderFavorites();
  renderRecommendations();
  renderQuestionChips();
  if (window.lucide) window.lucide.createIcons();
}

window.addEventListener("DOMContentLoaded", () => {
  bind();
  renderAll();
  const first = selectedHotItems[0] || activeDocs()[0] || db.docs[0];
  if (first?.sourceType === "aihot") openHot(first);
  else if (first) openDoc(first);
});
