"use strict";

/* =========================================================
   The city that comes into focus
   Map of Istanbul weekday-evening speeds, revealed one evening
   at a time, with each area's stability encoded visually.
   ========================================================= */

// ---------- Encoding ----------
const BINS = [25, 40, 55, 70, 85];
const COLORS = ["#d73027", "#fc8d59", "#fee090", "#e0f3f8", "#91bfdb", "#4575b4"];
const LOST = "#c2185b";
const SELECT = "#1d2733";
const NO_DATA = "#c4ccd4";

// Rule thresholds: must match Notebook 02
const C_IN = 1.0, W_IN = 2.0, C_OUT = 1.5, W_OUT = 2.5;

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PLAY_MS = 620;

// ---------- App state ----------
const ui = { t: 1, mode: "focus", peeking: false, selectedId: null, timer: null };
let DAYS = [];
let FEATURES = [];
let LAYERS = {};
let cellsLayer = null;
let GROUP_AVG = {};
let GROUP_N = {};
let DAY_STATS = [];

const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------
function binIndex(v) {
  let i = 0;
  while (i < BINS.length && v >= BINS[i]) i++;
  return i;
}

function speedColor(v) {
  if (v === null || v === undefined) return NO_DATA;
  return COLORS[binIndex(v)];
}

function fmt(v, digits = 1) {
  return v === null || v === undefined ? "–" : v.toFixed(digits);
}

function dateParts(iso) {
  const d = new Date(iso + "T00:00:00");
  return {
    day: d.getDate(),
    month: d.toLocaleDateString("en-GB", { month: "short" }),
    weekday: d.toLocaleDateString("en-GB", { weekday: "long" }),
    short: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
  };
}

function lostRecently(p, i) {
  const s = p.state[i];
  if (s === 0 || s === 3) return false;
  return (i >= 1 && p.state[i - 1] === 3) ||
         (i >= 2 && p.state[i - 2] === 3 && p.state[i - 1] !== 3);
}

function recentChange(p, i) {
  const m = p.mean[i];
  if (i < 3 || m === null || p.mean[i - 3] === null) return null;
  return Math.abs(m - p.mean[i - 3]);
}

// ---------- Precomputed statistics ----------
function computeDayStats() {
  DAY_STATS = DAYS.map((_, i) => {
    const c = { 1: 0, 2: 0, 3: 0 };
    let total = 0, lost = 0, wrong = 0;
    for (const f of FEATURES) {
      const p = f.properties;
      const s = p.state[i];
      if (s === 0) continue;
      c[s]++;
      total++;
      if (i > 0 && p.state[i - 1] === 3 && s !== 3) lost++;
      if (s === 3 && p.final !== null && binIndex(p.mean[i]) !== binIndex(p.final)) wrong++;
    }
    return {
      settled: c[3] / total,
      settling: c[2] / total,
      forming: c[1] / total,
      lost,
      wrong,
    };
  });
}

function computeGroupAverages(i) {
  const sums = {}, counts = {};
  for (const f of FEATURES) {
    const p = f.properties;
    const s = p.state[i];
    if ((s === 1 || s === 2) && p.mean[i] !== null) {
      const g = p.id.slice(0, 5);
      sums[g] = (sums[g] || 0) + p.mean[i];
      counts[g] = (counts[g] || 0) + 1;
    }
  }
  GROUP_AVG = {};
  GROUP_N = {};
  for (const g in sums) {
    GROUP_AVG[g] = sums[g] / counts[g];
    GROUP_N[g] = counts[g];
  }
}

// ---------- Cell styling ----------
const BASE = { stroke: true, color: "#ffffff", weight: 0.4, opacity: 0.9, dashArray: null };

function styleCore(p, i) {
  const s = p.state[i];

  if (s === 0) return { ...BASE, fillColor: NO_DATA, fillOpacity: 0.35 };

  if (ui.peeking) {
    const wrong = s === 3 && binIndex(p.mean[i]) !== binIndex(p.final);
    return {
      ...BASE,
      fillColor: speedColor(p.final), fillOpacity: 0.9,
      color: wrong ? SELECT : "#ffffff", weight: wrong ? 2 : 0.4, opacity: 1,
    };
  }

  if (ui.mode === "baseline") return { ...BASE, fillColor: speedColor(p.mean[i]), fillOpacity: 0.88 };

  if (s === 3) return { ...BASE, fillColor: speedColor(p.mean[i]), fillOpacity: 0.92 };

  if (ui.mode === "fade") {
    return { ...BASE, fillColor: speedColor(p.mean[i]), fillOpacity: s === 1 ? 0.12 : 0.35 };
  }

  // Focus mode, cell not settled
  if (lostRecently(p, i)) {
    return {
      ...BASE,
      fillColor: speedColor(p.mean[i]), fillOpacity: 0.72,
      color: LOST, weight: 2, opacity: 1, dashArray: "4 3",
    };
  }
  return {
    ...BASE,
    stroke: false,
    fillColor: speedColor(GROUP_AVG[p.id.slice(0, 5)]),
    fillOpacity: s === 1 ? 0.42 : 0.6,
  };
}

function styleFor(p, i) {
  const st = styleCore(p, i);
  if (p.id === ui.selectedId) return { ...st, stroke: true, color: SELECT, weight: 3, opacity: 1 };
  return st;
}

// ---------- Rendering ----------
function setDay(t) {
  ui.t = Math.max(1, Math.min(DAYS.length, t));
  render();
}

function render() {
  const i = ui.t - 1;
  computeGroupAverages(i);
  cellsLayer.setStyle((f) => styleFor(f.properties, i));
  if (ui.selectedId && LAYERS[ui.selectedId]) LAYERS[ui.selectedId].bringToFront();
  renderWhen(i);
  renderStrip(i);
  renderReadout(i);
  renderDetail(i);
}

function renderWhen(i) {
  const d = dateParts(DAYS[i]);
  $("whenDate").textContent = `${d.day} ${d.month}`;
  $("whenWeekday").textContent = d.weekday;
  $("whenOf").textContent = `Evening ${i + 1} of ${DAYS.length}`;
}

function renderReadout(i) {
  const st = DAY_STATS[i];
  const pct = (x) => Math.round(x * 100);
  let html;

  if (ui.peeking) {
    html = st.wrong
      ? `Showing the full month. <b>${st.wrong} ${st.wrong === 1 ? "area" : "areas"}</b> that look settled tonight end up in a different colour.`
      : "Showing the full month. Every settled area tonight already has its final colour.";
  } else if (ui.mode === "baseline") {
    html = "Raw view: every area is drawn as if its value were final. Switch to Focus to see which areas you can trust.";
  } else if (st.settled === 0) {
    html = `Only ${i + 1} evening${i ? "s" : ""} seen. Nothing is settled yet, so the city stays blurred.`;
  } else {
    html = `<b>${pct(st.settled)}% of the city is settled</b>, ${pct(st.settling + st.forming)}% is still uncertain`;
    html += st.lost
      ? `, and <b>${st.lost} ${st.lost === 1 ? "area" : "areas"}</b> lost focus since the previous evening.`
      : ".";
  }
  $("readout").innerHTML = html;
}

// ---------- Focus strip ----------
function buildStrip() {
  const strip = $("strip");
  strip.style.setProperty("--days", DAYS.length);
  strip.setAttribute("aria-valuemax", DAYS.length);

  strip.innerHTML = DAYS.map((iso, i) => {
    const st = DAY_STATS[i];
    const d = dateParts(iso);
    const tick = st.lost ? `<span class="tick" style="opacity:${(0.3 + 0.7 * Math.min(1, st.lost / 40)).toFixed(2)}"></span>` : "";
    return `
      <span class="col" aria-hidden="true">
        <span class="bar">
          <span class="seg-s" style="height:${(st.settled * 100).toFixed(1)}%"></span>
          <span class="seg-g" style="height:${(st.settling * 100).toFixed(1)}%"></span>
          ${tick}
        </span>
        <span class="lab">${d.day}</span>
      </span>`;
  }).join("");

  let scrubbing = false;
  const scrubTo = (e) => {
    const r = strip.getBoundingClientRect();
    const t = Math.floor(((e.clientX - r.left) / r.width) * DAYS.length) + 1;
    if (t !== ui.t) setDay(t);
  };
  strip.addEventListener("pointerdown", (e) => {
    stop();
    scrubbing = true;
    strip.setPointerCapture(e.pointerId);
    scrubTo(e);
  });
  strip.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e); });
  strip.addEventListener("pointerup", () => { scrubbing = false; });
  strip.addEventListener("pointercancel", () => { scrubbing = false; });

  strip.addEventListener("keydown", (e) => {
    const moves = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in moves) { e.preventDefault(); stop(); setDay(ui.t + moves[e.key]); }
    if (e.key === "Home") { e.preventDefault(); stop(); setDay(1); }
    if (e.key === "End") { e.preventDefault(); stop(); setDay(DAYS.length); }
  });
}

function renderStrip(i) {
  const cols = $("strip").children;
  for (let k = 0; k < cols.length; k++) {
    cols[k].classList.toggle("now", k === i);
    cols[k].classList.toggle("future", k > i);
  }
  const strip = $("strip");
  strip.setAttribute("aria-valuenow", i + 1);
  strip.setAttribute("aria-valuetext", `${dateParts(DAYS[i]).short}, evening ${i + 1} of ${DAYS.length}`);
}

// ---------- Legend ----------
function buildRamp() {
  const ticks = ["< 25", "25–40", "40–55", "55–70", "70–85", "≥ 85"];
  $("ramp").innerHTML =
    `<span class="unit">km/h</span>` +
    COLORS.map((c) => `<span class="chip-c" style="background:${c}"></span>`).join("") +
    `<span></span>` +
    ticks.map((t) => `<span class="t">${t}</span>`).join("");
}

// ---------- Detail panel ----------
function statusOf(p, i) {
  const s = p.state[i];
  if (s === 0) return { cls: "", label: "No data" };
  if (s === 1) return { cls: "", label: "Forming" };
  if (s === 3) return { cls: "settled", label: "Settled" };
  if (lostRecently(p, i)) return { cls: "lost", label: "Just lost focus" };
  return { cls: "settling", label: "Settling" };
}

function explain(p, i) {
  const s = p.state[i];
  const h = p.half[i];
  const change = recentChange(p, i);

  if (s === 0) return "This area had enough traffic on fewer than 15 of the 21 evenings, so it is left out of the analysis.";
  if (s === 1) return "Fewer than five evenings seen so far. Too early to judge.";

  if (s === 3) {
    return `Its estimate is within ±${fmt(h)} km/h and moved ${fmt(change)} km/h over the last three evenings, so it is drawn at full detail.
      <span class="d-note">Once settled, an area stays settled while its interval is under ±${W_OUT} km/h and it moves less than ${C_OUT} km/h.</span>`;
  }

  const reasons = [];
  if (h === null || h >= W_IN) reasons.push(`its interval (±${fmt(h)} km/h) is wider than ±${W_IN}`);
  if (change === null || change >= C_IN) reasons.push(`it moved ${fmt(change)} km/h over the last three evenings`);
  const lead = lostRecently(p, i) ? "It was settled until recently. " : "";
  const why = reasons.length ? `Not settled yet because ${reasons.join(" and ")}.` : "It has not yet met the rule for settling.";
  return lead + why;
}

function sparkline(p, i) {
  const W = 290, H = 104, L = 30, R = 6, T = 8, B = 18;
  const m = p.mean, h = p.half, n = m.length;
  const vals = m.filter((v) => v !== null);
  if (p.final !== null) vals.push(p.final);
  if (!vals.length) return "";

  const lo = Math.floor(Math.min(...vals) - 6);
  const hi = Math.ceil(Math.max(...vals) + 6);
  const x = (k) => L + (k * (W - L - R)) / (n - 1);
  const y = (v) => {
    const c = Math.max(lo, Math.min(hi, v));
    return T + ((hi - c) * (H - T - B)) / (hi - lo);
  };
  const pt = (k, v) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`;

  const segment = (a, b) => {
    const line = [], up = [], dn = [];
    for (let k = a; k <= b; k++) {
      const v = m[k];
      if (v === null) continue;
      line.push(pt(k, v));
      if (h[k] !== null) { up.push(pt(k, v + h[k])); dn.unshift(pt(k, v - h[k])); }
    }
    return { line: line.join(" "), band: up.concat(dn).join(" ") };
  };
  const past = segment(0, i);
  const later = segment(i, n - 1);
  const first = dateParts(DAYS[0]), last = dateParts(DAYS[n - 1]);

  return `
    <svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" role="img"
         aria-label="Running estimate for this area across the month">
      <text x="${L - 6}" y="${(y(hi) + 4).toFixed(1)}" text-anchor="end">${hi}</text>
      <text x="${L - 6}" y="${y(lo).toFixed(1)}" text-anchor="end">${lo}</text>
      <polygon points="${later.band}" class="band-f"/>
      <polyline points="${later.line}" class="line-f"/>
      <polygon points="${past.band}" class="band"/>
      <polyline points="${past.line}" class="line"/>
      ${p.final !== null ? `<line x1="${L}" x2="${W - R}" y1="${y(p.final).toFixed(1)}" y2="${y(p.final).toFixed(1)}" class="final"/>` : ""}
      <line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${T}" y2="${H - B}" class="today"/>
      <text x="${L}" y="${H - 4}">${first.day} ${first.month}</text>
      <text x="${W - R}" y="${H - 4}" text-anchor="end">${last.day} ${last.month}</text>
    </svg>
    <div class="spark-key">
      <span><i></i>Estimate so far</span>
      <span><i class="k-later"></i>Later evenings</span>
      <span><i class="k-final"></i>End of month</span>
      <span><i class="k-today"></i>Tonight</span>
    </div>`;
}

function renderDetail(i) {
  const box = $("detail");
  const layer = ui.selectedId ? LAYERS[ui.selectedId] : null;
  if (!layer) { box.hidden = true; return; }

  const p = layer.feature.properties;
  const s = p.state[i];
  const g = p.id.slice(0, 5);
  const status = statusOf(p, i);
  const blended = ui.mode === "focus" && !ui.peeking && (s === 1 || s === 2) &&
                  !lostRecently(p, i) && GROUP_AVG[g] !== undefined;
  const area = blended
    ? `<p class="d-area">On the map this area is blended into its 5 km block and drawn at the block's average,
         ${fmt(GROUP_AVG[g])} km/h, from ${GROUP_N[g]} uncertain areas.</p>`
    : "";
  const d = dateParts(DAYS[i]);

  box.innerHTML = `
    <div class="d-head">
      <h2>Area ${p.id}</h2>
      <button class="close" id="closeDetail" type="button" aria-label="Close area details">×</button>
    </div>
    <p class="d-date">${d.short}, after ${i + 1} evening${i ? "s" : ""}</p>
    <p class="d-value">${fmt(p.mean[i])}<small>± ${fmt(p.half[i])} km/h</small></p>
    <span class="status ${status.cls}">${status.label}</span>
    <p class="d-why">${explain(p, i)}</p>
    ${area}
    ${sparkline(p, i)}`;
  box.hidden = false;
  $("closeDetail").addEventListener("click", () => select(null));
}

function select(id) {
  ui.selectedId = id;
  render();
}

// ---------- Playback ----------
function play() {
  if (ui.timer) { stop(); return; }
  if (ui.t >= DAYS.length) setDay(1);
  ui.timer = setInterval(() => {
    if (ui.t >= DAYS.length) { stop(); return; }
    setDay(ui.t + 1);
  }, PLAY_MS);
  updatePlayButton();
}

function stop() {
  clearInterval(ui.timer);
  ui.timer = null;
  updatePlayButton();
}

function updatePlayButton() {
  const b = $("play");
  b.classList.toggle("is-playing", !!ui.timer);
  b.setAttribute("aria-label", ui.timer ? "Pause" : "Play the month");
}

// ---------- Peek at the final month ----------
function setPeek(on) {
  if (ui.peeking === on) return;
  ui.peeking = on;
  $("peek").setAttribute("aria-pressed", String(on));
  render();
}

// ---------- Map ----------
const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, minZoom: 8, maxZoom: 17 });
L.control.zoom({ position: "topright" }).addTo(map);
map.setView([41.05, 28.95], 10);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

function fitCity() {
  const small = window.innerWidth <= 760;
  map.fitBounds(cellsLayer.getBounds(), small
    ? { paddingTopLeft: [10, 110], paddingBottomRight: [10, 250] }
    : { paddingTopLeft: [400, 30], paddingBottomRight: [30, 210] });
}

// ---------- Controls ----------
function wireControls() {
  $("play").addEventListener("click", play);

  document.querySelectorAll(".modes button").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.mode = btn.dataset.mode;
      document.querySelectorAll(".modes button").forEach((b) =>
        b.setAttribute("aria-checked", String(b === btn)));
      render();
    });
  });

  const peek = $("peek");
  peek.addEventListener("pointerdown", (e) => { peek.setPointerCapture(e.pointerId); setPeek(true); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) =>
    peek.addEventListener(ev, () => setPeek(false)));
  peek.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setPeek(true); } });
  peek.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") setPeek(false); });

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key.toLowerCase() === "f") setPeek(true);
    if (e.key === "Escape") select(null);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "f") setPeek(false);
  });

  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("search").value.trim().toLowerCase();
    const msg = $("searchMsg");
    if (!id) { msg.textContent = ""; return; }
    const layer = LAYERS[id];
    if (!layer) {
      msg.textContent = `No area called “${id}”. Area codes have six characters, like sxk691.`;
      return;
    }
    msg.textContent = "";
    stop();
    map.flyToBounds(layer.getBounds(), { maxZoom: 14, duration: REDUCED_MOTION ? 0 : 0.9 });
    select(id);
  });
}

// ---------- Load ----------
fetch("data/cells.geojson")
  .then((response) => {
    if (!response.ok) throw new Error(response.status);
    return response.json();
  })
  .then((data) => {
    DAYS = data.days;
    FEATURES = data.features;

    cellsLayer = L.geoJSON(data, {
      style: { ...BASE, fillColor: NO_DATA, fillOpacity: 0 },
      onEachFeature: (feature, layer) => {
        LAYERS[feature.properties.id] = layer;
        layer.on("click", () => { stop(); select(feature.properties.id); });
      },
    }).addTo(map);

    computeDayStats();
    buildStrip();
    buildRamp();
    wireControls();
    fitCity();
    setDay(1);

    if (!REDUCED_MOTION) setTimeout(play, 900);
  })
  .catch(() => {
    $("readout").textContent =
      "Could not load data/cells.geojson. Start the local server inside the web folder and reload the page.";
  });