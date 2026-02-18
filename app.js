/* =============================================================================
  app.js — Talleres Esporádicos · Musicala (LIGHT) — Shared (Sheets)
  Features:
  - Kanban pipeline + drag&drop
  - Filtros + búsqueda
  - Timeline anual
  - Calendario mensual (lista por días)
  - Lista completa del año (agrupada por mes, opcional)
  - Estadísticas (estado/arte/mes) + conversión + cadencia
  - CRUD con modal
  - Import/Export JSON
  - Persistencia: localStorage (CACHE)
  - Fuente compartida: Google Sheets (TSV público) + Apps Script (write)
============================================================================= */

const BUILD = "2026-02-18.1";
document.getElementById("build").textContent = BUILD;

// ---- Config ----
const STORAGE_KEY = "musicala.workshops.v1";

/** LECTURA (pública) — TSV publicado */
const REMOTE_TSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQBXR2pzwZL6B4IsFyXaubkHkUUx3bqNhweGIasPvohwyoTxvmckr_XXw1MHrKOuXXmEAjqIVnvyRrj/pub?gid=212553349&single=true&output=tsv";

/** ESCRITURA — Apps Script Web App (tú URL) */
const REMOTE_WRITE_URL =
  "https://script.google.com/macros/s/AKfycbyawq-wiYgLEOOO_LqNvOwG1Vka6gwXepXcpxTwTFCcVdqQ36scxdAq3XAOa4HTAmZ2/exec";

/** Sync behaviour */
const REMOTE_SYNC = {
  enabled: true,
  afterWriteReload: true,   // recargar TSV después de escribir
  reloadDelayMs: 350,       // mini delay para que Sheets “alcance” a reflejar
};

const ART_TYPES = [
  { id:"music",  name:"Música" },
  { id:"dance",  name:"Danza" },
  { id:"visual", name:"Artes Plásticas" },
  { id:"theatre",name:"Teatro" },
];

const STATUSES = [
  { id:"idea",       name:"Ideas futuras" },
  { id:"eval",       name:"En evaluación" },
  { id:"plan",       name:"Planeación mensual" },
  { id:"confirmed",  name:"Confirmado" },
  { id:"done",       name:"Realizado" },
];

const PRIORITY_LABEL = { high:"Alta", mid:"Media", low:"Baja" };
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ---- State ----
const state = {
  items: [],
  filters: {
    q: "",
    month: "all",     // YYYY-MM o all
    art: "all",
    status: "all",
    priority: "all",
    onlyConfirmed: false,
  },
  viewMonth: monthKey(new Date()), // navegación en calendario mensual

  // remote sync state
  remote: {
    lastLoadedAt: null,
    inflight: 0,
    lastError: null,
  }
};

// ---- DOM ----
const el = {
  q: $("#q"),
  fMonth: $("#fMonth"),
  fArt: $("#fArt"),
  fStatus: $("#fStatus"),
  fPriority: $("#fPriority"),
  onlyConfirmed: $("#onlyConfirmed"),
  compactMode: $("#compactMode"),
  btnReset: $("#btnReset"),
  btnNew: $("#btnNew"),
  btnExport: $("#btnExport"),
  fileImport: $("#fileImport"),
  btnDemo: $("#btnDemo"),

  kanban: $("#kanban"),
  timeline: $("#timeline"),
  monthList: $("#monthList"),
  monthTitle: $("#monthTitle"),
  prevMonth: $("#prevMonth"),
  nextMonth: $("#nextMonth"),

  countPill: $("#countPill"),
  cadence: $("#cadence"),
  conversion: $("#conversion"),
  gaps: $("#gaps"),
  chartStatus: $("#chartStatus"),
  chartArt: $("#chartArt"),
  chartMonth: $("#chartMonth"),

  // Year list (NEW)
  yearList: $("#yearList"),
  yearOnlyDated: $("#yearOnlyDated"),
  yearGroupByMonth: $("#yearGroupByMonth"),

  dlg: $("#dlg"),
  form: $("#form"),
  dlgTitle: $("#dlgTitle"),
  btnClose: $("#btnClose"),
  btnCancel: $("#btnCancel"),
  btnSave: $("#btnSave"),
  btnDelete: $("#btnDelete"),

  id: $("#id"),
  title: $("#title"),
  art: $("#art"),
  status: $("#status"),
  priority: $("#priority"),
  suggestedMonth: $("#suggestedMonth"),
  date: $("#date"),
  time: $("#time"),
  duration: $("#duration"),
  responsible: $("#responsible"),
  capacity: $("#capacity"),
  price: $("#price"),
  place: $("#place"),
  tags: $("#tags"),
  summary: $("#summary"),
};

// ---- Init ----
boot();

function boot(){
  // 1) Carga cache local para pintar rápido (si existe)
  hydrate();
  initSelects();
  bindUI();
  renderAll();

  // 2) Luego carga remoto (la verdad compartida)
  if(REMOTE_SYNC.enabled){
    loadRemote({ silent:true });
  }
}

function bindUI(){
  el.q?.addEventListener("input", () => { state.filters.q = el.q.value.trim(); renderAll(); });
  el.fMonth?.addEventListener("change", () => { state.filters.month = el.fMonth.value; renderAll(); });
  el.fArt?.addEventListener("change", () => { state.filters.art = el.fArt.value; renderAll(); });
  el.fStatus?.addEventListener("change", () => { state.filters.status = el.fStatus.value; renderAll(); });
  el.fPriority?.addEventListener("change", () => { state.filters.priority = el.fPriority.value; renderAll(); });

  el.onlyConfirmed?.addEventListener("change", () => {
    state.filters.onlyConfirmed = el.onlyConfirmed.checked;
    renderAll();
  });

  el.compactMode?.addEventListener("change", () => {
    document.body.classList.toggle("compact", el.compactMode.checked);
  });

  el.btnReset?.addEventListener("click", () => {
    state.filters = { q:"", month:"all", art:"all", status:"all", priority:"all", onlyConfirmed:false };
    if(el.q) el.q.value = "";
    if(el.fMonth) el.fMonth.value = "all";
    if(el.fArt) el.fArt.value = "all";
    if(el.fStatus) el.fStatus.value = "all";
    if(el.fPriority) el.fPriority.value = "all";
    if(el.onlyConfirmed) el.onlyConfirmed.checked = false;
    renderAll();
  });

  el.btnNew?.addEventListener("click", () => openModal());
  el.btnClose?.addEventListener("click", () => closeModal());
  el.btnCancel?.addEventListener("click", () => closeModal());

  el.form?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveFromModal();
  });

  el.btnDelete?.addEventListener("click", async () => {
    const id = el.id.value;
    if(!id) return;
    if(!confirm("¿Eliminar este taller?")) return;

    // update local immediately
    state.items = state.items.filter(x => x.id !== id);
    persist();
    closeModal();
    renderAll();

    // write remote
    if(REMOTE_SYNC.enabled){
      await remoteDelete(id);
    }
  });

  el.btnExport?.addEventListener("click", exportJSON);
  el.fileImport?.addEventListener("change", importJSON);

  el.btnDemo?.addEventListener("click", () => {
    if(state.items.length && !confirm("¿Reemplazar tus datos con una demo?")) return;
    state.items = demoData();
    persist();
    renderAll();
  });

  el.prevMonth?.addEventListener("click", () => {
    state.viewMonth = addMonths(state.viewMonth, -1);
    renderMonthView();
    syncMonthTitle();
    persist();
  });
  el.nextMonth?.addEventListener("click", () => {
    state.viewMonth = addMonths(state.viewMonth, 1);
    renderMonthView();
    syncMonthTitle();
    persist();
  });

  // Year list toggles
  el.yearOnlyDated?.addEventListener("change", renderYearList);
  el.yearGroupByMonth?.addEventListener("change", renderYearList);

  // Dialog: ESC/click-outside is native; extra safety for non-native fallback
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape" && isDialogOpen()){
      closeModal();
    }
  });
}

// ---- Selects ----
function initSelects(){
  // Modal selects
  fillSelect(el.art, ART_TYPES.map(a => ({ value:a.id, label:a.name })));
  fillSelect(el.status, STATUSES.map(s => ({ value:s.id, label:s.name })));

  // Filter selects: año actual (pueden extender después a 24 meses)
  const year = new Date().getFullYear();
  const months = buildMonthsOptions(year, 12);
  fillSelect(el.fMonth, [{value:"all",label:"Todos"}].concat(months));

  fillSelect(el.fArt, [{value:"all",label:"Todos"}].concat(ART_TYPES.map(a => ({value:a.id,label:a.name}))));
  fillSelect(el.fStatus, [{value:"all",label:"Todos"}].concat(STATUSES.map(s => ({value:s.id,label:s.name}))));

  // Defaults
  if(el.fMonth) el.fMonth.value = state.filters.month || "all";
  if(el.fArt) el.fArt.value = state.filters.art || "all";
  if(el.fStatus) el.fStatus.value = state.filters.status || "all";
}

// ---- Render orchestration ----
function renderAll(){
  const filtered = getFilteredItems();

  if(el.countPill) el.countPill.textContent = String(filtered.length);

  renderTimeline();                 // Timeline siempre se basa en TODO (no filtrado por mes)
  renderStats();                    // Stats global del año (más útil)
  renderKanban(filtered);           // Kanban SÍ usa filtros
  renderMonthView();                // Month view usa viewMonth y filtros base
  renderYearList();                 // Year list usa filtros base (con año actual)

  syncMonthTitle();
}

function syncMonthTitle(){
  if(!el.monthTitle) return;
  const { y, m } = parseMonthKey(state.viewMonth);
  el.monthTitle.textContent = `${MONTHS_ES[m-1]} ${y}`;
}

// ---- Timeline ----
function renderTimeline(){
  if(!el.timeline) return;

  const totals = countByMonth(state.items);
  const year = new Date().getFullYear();
  const chips = [];

  for(let i=1;i<=12;i++){
    const key = `${year}-${String(i).padStart(2,"0")}`;
    const c = totals[key] || 0;
    const label = MONTHS_ES[i-1].slice(0,3);
    chips.push(`
      <button class="monthChip" data-month="${key}" type="button" title="Filtrar mes ${MONTHS_ES[i-1]}">
        <div class="m">${escapeHtml(label.toUpperCase())}</div>
        <div class="c">${c}</div>
        <div class="s">${c === 1 ? "taller" : "talleres"}</div>
      </button>
    `);
  }

  el.timeline.innerHTML = chips.join("");

  el.timeline.querySelectorAll(".monthChip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.filters.month = btn.dataset.month;
      if(el.fMonth) el.fMonth.value = state.filters.month;
      renderAll();
    });
  });
}

// ---- Stats ----
function renderStats(){
  const items = getFilteredItems({ ignoreMonthFilter: true }); // stats del año completos (no “solo el mes filtrado”)
  const byStatus = countBy(items, x => x.status, STATUSES.map(s=>s.id));
  const byArt = countBy(items, x => x.art, ART_TYPES.map(a=>a.id));
  const byMonth = countByMonth(items);

  // Cadencia / gaps
  const year = new Date().getFullYear();
  let activeMonths = 0;
  let gaps = 0;
  for(let i=1;i<=12;i++){
    const key = `${year}-${String(i).padStart(2,"0")}`;
    const c = byMonth[key] || 0;
    if(c>0) activeMonths++;
    else gaps++;
  }
  if(el.cadence) el.cadence.textContent = `${activeMonths}/12`;
  if(el.gaps) el.gaps.textContent = String(gaps);

  // Conversión: confirmado -> realizado
  const confirmed = items.filter(x => x.status === "confirmed").length;
  const done = items.filter(x => x.status === "done").length;
  const conv = confirmed ? Math.round((done/confirmed)*100) : 0;
  if(el.conversion) el.conversion.textContent = confirmed ? `${conv}%` : "—";

  // Mini charts
  renderBars(el.chartStatus, STATUSES.map(s => ({ label:s.name, value: byStatus[s.id] || 0 })));
  renderBars(el.chartArt, ART_TYPES.map(a => ({ label:a.name, value: byArt[a.id] || 0 })));

  const yearMonths = [];
  for(let i=1;i<=12;i++){
    const key = `${year}-${String(i).padStart(2,"0")}`;
    yearMonths.push({ label: MONTHS_ES[i-1].slice(0,3), value: byMonth[key] || 0 });
  }
  renderBars(el.chartMonth, yearMonths);
}

function renderBars(container, rows){
  if(!container) return;
  const max = Math.max(1, ...rows.map(r=>r.value));
  container.innerHTML = rows.map(r => {
    const pct = Math.round((r.value/max)*100);
    return `
      <div class="barRow">
        <div class="barLbl" title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="barVal">${r.value}</div>
      </div>
    `;
  }).join("");
}

// ---- Kanban ----
function renderKanban(filtered){
  if(!el.kanban) return;

  const cols = STATUSES.map(s => {
    const items = filtered.filter(x => x.status === s.id);
    return `
      <section class="col" data-status="${s.id}">
        <header class="colHead">
          <div class="colTitle">${escapeHtml(s.name)}</div>
          <div class="colCount">${items.length}</div>
        </header>
        <div class="drop" data-drop="${s.id}" aria-label="Columna ${escapeAttr(s.name)}"></div>
      </section>
    `;
  }).join("");

  el.kanban.innerHTML = cols;

  for(const s of STATUSES){
    const drop = el.kanban.querySelector(`[data-drop="${s.id}"]`);
    const items = filtered
      .filter(x => x.status === s.id)
      .sort(sortSmart);

    drop.innerHTML = items.map(renderCard).join("");
  }

  // Click + Drag
  el.kanban.querySelectorAll(".cardItem").forEach(node => {
    node.addEventListener("click", () => {
      if(node.dataset.dragging === "1") return;
      openModal(node.dataset.id);
    });

    node.addEventListener("dragstart", (e) => {
      node.dataset.dragging = "1";
      e.dataTransfer.setData("text/plain", node.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      // evitar click fantasma post-drag
      setTimeout(()=> node.dataset.dragging = "0", 220);
    });
  });

  el.kanban.querySelectorAll(".drop").forEach(zone => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      const newStatus = zone.dataset.drop;
      moveItemStatus(id, newStatus);
    });
  });
}

function renderCard(x){
  const art = ART_TYPES.find(a => a.id === x.art)?.name || x.art;
  const dateStr = x.date ? prettyDate(x.date) : (x.suggestedMonth ? prettyMonth(x.suggestedMonth) : "");
  const timeStr = x.time ? x.time : "";
  const dateBadge = (dateStr || timeStr) ? `${dateStr}${timeStr ? " · "+timeStr : ""}` : "Sin fecha";
  const tags = (x.tags || []).slice(0,5);

  return `
    <article class="cardItem" draggable="true" data-id="${escapeAttr(x.id)}">
      <div class="t">${escapeHtml(x.title)}</div>
      <div class="meta">
        <span class="badge art">${escapeHtml(art)}</span>
        <span class="badge pri ${escapeAttr(x.priority)}">${escapeHtml(PRIORITY_LABEL[x.priority] || x.priority)}</span>
        <span class="badge date">${escapeHtml(dateBadge)}</span>
      </div>
      ${tags.length ? `<div class="tagLine">${tags.map(t=>`<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </article>
  `;
}

// ---- Month view ----
function renderMonthView(){
  if(!el.monthList) return;

  const key = state.viewMonth;
  const { y, m } = parseMonthKey(key);

  // Usar filtros pero obligar al mes actual de vista
  const base = getFilteredItems({ forceMonth:key });

  // Month view: solo items con FECHA real dentro del mes
  const items = base
    .filter(x => x.date && monthKey(new Date(x.date)) === key)
    .sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.time||"").localeCompare(b.time||""));

  // group by day
  const groups = new Map();
  for(const it of items){
    const d = it.date;
    if(!groups.has(d)) groups.set(d, []);
    groups.get(d).push(it);
  }

  // Empty state
  if(!items.length){
    el.monthList.innerHTML = `
      <div class="dayGroup">
        <div class="dayHead">
          <div class="d">${escapeHtml(MONTHS_ES[m-1])} ${y}</div>
          <div class="n">0</div>
        </div>
        <div class="dayItems">
          <div class="muted small">No hay talleres con fecha en este mes (según filtros).</div>
          <button class="btn" type="button" id="btnQuickAdd">+ Programar uno</button>
        </div>
      </div>
    `;
    $("#btnQuickAdd")?.addEventListener("click", () => openModal());
    return;
  }

  const blocks = [];
  for(const [date, arr] of groups.entries()){
    blocks.push(`
      <section class="dayGroup">
        <header class="dayHead">
          <div class="d">${escapeHtml(prettyDate(date))}</div>
          <div class="n">${arr.length}</div>
        </header>
        <div class="dayItems">
          ${arr.map(renderDayItem).join("")}
        </div>
      </section>
    `);
  }

  el.monthList.innerHTML = blocks.join("");
  el.monthList.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.edit));
  });
}

function renderDayItem(x){
  const art = ART_TYPES.find(a => a.id === x.art)?.name || x.art;
  const when = `${x.time ? x.time : "hora por definir"}${x.duration ? " · "+x.duration+" min" : ""}`;
  const where = x.place ? ` · ${x.place}` : "";
  const who = x.responsible ? ` · ${x.responsible}` : "";
  return `
    <div class="dayItem">
      <div class="left">
        <div class="name">${escapeHtml(x.title)}</div>
        <div class="sub">
          <span>${escapeHtml(art)}</span>
          <span>${escapeHtml(when)}${escapeHtml(where)}${escapeHtml(who)}</span>
        </div>
      </div>
      <div class="right">
        <button class="iconBtn" type="button" data-edit="${escapeAttr(x.id)}">Editar</button>
      </div>
    </div>
  `;
}

// ---- Year list (NEW) ----
function renderYearList(){
  if(!el.yearList) return;

  const year = new Date().getFullYear();
  const onlyDated = !!el.yearOnlyDated?.checked;
  const groupByMonth = !!el.yearGroupByMonth?.checked;

  // Usa filtros actuales (pero no “amarrado” al filtro del mes)
  let items = getFilteredItems({ ignoreMonthFilter:true });

  // quedarnos con el año actual, según date o suggestedMonth
  items = items.filter(x => {
    const mk = itemMonthKey(x);
    if(mk === "none") return false;
    return mk.startsWith(String(year) + "-");
  });

  if(onlyDated){
    items = items.filter(x => !!x.date);
  }

  // ordenar: fecha real, luego mes sugerido, luego prioridad/título
  items.sort((a,b) => {
    const da = a.date || "";
    const db = b.date || "";
    if(da !== db) return da.localeCompare(db);
    const ma = itemMonthKey(a);
    const mb = itemMonthKey(b);
    if(ma !== mb) return ma.localeCompare(mb);
    return priRank(a.priority) - priRank(b.priority) || (a.title||"").localeCompare(b.title||"");
  });

  if(!items.length){
    el.yearList.innerHTML = `
      <div class="yearGroup">
        <div class="yearHead">
          <div class="d">${year}</div>
          <div class="n">0</div>
        </div>
        <div class="yearItems">
          <div class="muted small">No hay talleres para mostrar con los filtros actuales.</div>
        </div>
      </div>
    `;
    return;
  }

  if(!groupByMonth){
    el.yearList.innerHTML = `
      <div class="yearGroup">
        <div class="yearHead">
          <div class="d">Todos (${year})</div>
          <div class="n">${items.length}</div>
        </div>
        <div class="yearItems">
          ${items.map(renderYearItem).join("")}
        </div>
      </div>
    `;
    bindYearEdits();
    return;
  }

  const map = new Map();
  for(const it of items){
    const mk = itemMonthKey(it);
    if(!map.has(mk)) map.set(mk, []);
    map.get(mk).push(it);
  }

  const keys = [...map.keys()].sort();

  el.yearList.innerHTML = keys.map(k => {
    const arr = map.get(k) || [];
    return `
      <section class="yearGroup">
        <header class="yearHead">
          <div class="d">${escapeHtml(prettyMonth(k))}</div>
          <div class="n">${arr.length}</div>
        </header>
        <div class="yearItems">
          ${arr.map(renderYearItem).join("")}
        </div>
      </section>
    `;
  }).join("");

  bindYearEdits();
}

function renderYearItem(x){
  const art = ART_TYPES.find(a => a.id === x.art)?.name || x.art;
  const when = x.date ? `${prettyDate(x.date)}${x.time ? " · "+x.time : ""}` : (x.suggestedMonth ? `Sugerido: ${prettyMonth(x.suggestedMonth)}` : "Sin fecha/mes");
  const who = x.responsible ? ` · ${x.responsible}` : "";
  const where = x.place ? ` · ${x.place}` : "";

  return `
    <div class="yearItem">
      <div class="left">
        <div class="name">${escapeHtml(x.title)}</div>
        <div class="sub">
          <span>${escapeHtml(art)}</span>
          <span>${escapeHtml(when)}${escapeHtml(where)}${escapeHtml(who)}</span>
          <span class="badge pri ${escapeAttr(x.priority)}">${escapeHtml(PRIORITY_LABEL[x.priority] || x.priority)}</span>
          <span class="badge">${escapeHtml(STATUSES.find(s=>s.id===x.status)?.name || x.status)}</span>
        </div>
      </div>
      <div class="right">
        <button class="iconBtn" type="button" data-yearedit="${escapeAttr(x.id)}">Editar</button>
      </div>
    </div>
  `;
}

function bindYearEdits(){
  document.querySelectorAll("[data-yearedit]").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.yearedit));
  });
}

// ---- Filtering ----
function getFilteredItems(opts = {}){
  const { q, month, art, status, priority, onlyConfirmed } = state.filters;

  let list = [...state.items];

  // search
  if(q){
    const needle = q.toLowerCase();
    list = list.filter(x => {
      const blob = [
        x.title, x.summary, x.responsible, x.place,
        (x.tags||[]).join(" "),
      ].join(" ").toLowerCase();
      return blob.includes(needle);
    });
  }

  if(art !== "all") list = list.filter(x => x.art === art);
  if(status !== "all") list = list.filter(x => x.status === status);
  if(priority !== "all") list = list.filter(x => x.priority === priority);

  if(onlyConfirmed) list = list.filter(x => x.status === "confirmed" || x.status === "done");

  const effectiveMonth = opts.forceMonth || (opts.ignoreMonthFilter ? "all" : month);
  if(effectiveMonth !== "all"){
    list = list.filter(x => itemMonthKey(x) === effectiveMonth);
  }

  return list;
}

function itemMonthKey(x){
  if(x.date) return monthKey(new Date(x.date));
  if(x.suggestedMonth) return x.suggestedMonth;
  return "none";
}

// ---- CRUD ----
function openModal(id = null){
  const isEdit = !!id;
  el.dlgTitle.textContent = isEdit ? "Editar taller" : "Nuevo taller";
  el.btnDelete.style.display = isEdit ? "inline-flex" : "none";

  const item = isEdit ? state.items.find(x => x.id === id) : null;

  el.id.value = item?.id || "";
  el.title.value = item?.title || "";
  el.art.value = item?.art || ART_TYPES[0].id;
  el.status.value = item?.status || "idea";
  el.priority.value = item?.priority || "mid";
  el.suggestedMonth.value = item?.suggestedMonth || "";
  el.date.value = item?.date || "";
  el.time.value = item?.time || "";
  el.duration.value = item?.duration ?? "";
  el.responsible.value = item?.responsible || "";
  el.capacity.value = item?.capacity ?? "";
  el.price.value = item?.price ?? "";
  el.place.value = item?.place || "";
  el.tags.value = (item?.tags || []).join(", ");
  el.summary.value = item?.summary || "";

  if(typeof el.dlg.showModal === "function") el.dlg.showModal();
  else el.dlg.setAttribute("open","");

  // Focus al primer input para velocidad (no en mobile safari raro)
  setTimeout(() => el.title?.focus?.(), 40);
}

function closeModal(){
  if(typeof el.dlg.close === "function") el.dlg.close();
  else el.dlg.removeAttribute("open");
}

function isDialogOpen(){
  return el.dlg?.open || el.dlg?.hasAttribute?.("open");
}

async function saveFromModal(){
  const now = new Date().toISOString();
  const existing = el.id.value ? state.items.find(x => x.id === el.id.value) : null;

  const payload = normalizeItem({
    id: el.id.value || uid(),
    title: el.title.value.trim(),
    art: el.art.value,
    status: el.status.value,
    priority: el.priority.value,
    suggestedMonth: el.suggestedMonth.value || "",
    date: el.date.value || "",
    time: el.time.value || "",
    duration: toNumOrNull(el.duration.value),
    responsible: el.responsible.value.trim(),
    capacity: toNumOrNull(el.capacity.value),
    price: toNumOrNull(el.price.value),
    place: el.place.value.trim(),
    tags: el.tags.value,
    summary: el.summary.value.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  if(!payload.title){
    alert("Ponle un título al taller 🙂");
    return;
  }

  // Update local immediately
  const idx = state.items.findIndex(x => x.id === payload.id);
  if(idx >= 0) state.items[idx] = payload;
  else state.items.push(payload);

  persist();
  closeModal();
  renderAll();

  // Remote write
  if(REMOTE_SYNC.enabled){
    await remoteUpsert(payload);
  }
}

async function moveItemStatus(id, newStatus){
  const it = state.items.find(x => x.id === id);
  if(!it) return;
  it.status = newStatus;
  it.updatedAt = new Date().toISOString();

  // Update local immediately
  persist();
  renderAll();

  // Remote write
  if(REMOTE_SYNC.enabled){
    await remoteUpsert(it);
  }
}

// ---- Storage (CACHE) ----
function hydrate(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){ state.items = []; return; }
    const parsed = JSON.parse(raw);
    state.items = Array.isArray(parsed?.items) ? parsed.items.map(normalizeItem) : [];
    state.viewMonth = parsed?.viewMonth || state.viewMonth;
  }catch(e){
    console.warn("No se pudo leer storage:", e);
    state.items = [];
  }
}

function persist(){
  const blob = { items: state.items, viewMonth: state.viewMonth, build: BUILD };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

// ---- Remote (Sheets) ----
async function loadRemote({ silent=false } = {}){
  if(!REMOTE_TSV_URL) return;
  try{
    state.remote.inflight++;
    state.remote.lastError = null;

    const tsv = await fetch(REMOTE_TSV_URL, { cache:"no-store" }).then(r => r.text());
    const items = parseTSV(tsv).map(normalizeItem);

    // Reemplaza estado con lo remoto (fuente de verdad)
    state.items = items;

    // Mantener viewMonth local (UX)
    persist();
    renderAll();

    state.remote.lastLoadedAt = new Date().toISOString();
    if(!silent) console.log("[remote] loaded", items.length);
  }catch(e){
    state.remote.lastError = String(e?.message || e);
    if(!silent) console.warn("[remote] no pude cargar TSV, uso cache local:", e);
  }finally{
    state.remote.inflight = Math.max(0, state.remote.inflight - 1);
  }
}

function parseTSV(tsv){
  const txt = String(tsv || "").replace(/\r/g, "");
  const lines = txt.split("\n").filter(l => l.trim().length);
  if(lines.length < 2) return [];

  const header = lines[0].split("\t").map(h => h.trim());
  const idx = {};
  header.forEach((h,i)=> idx[h]=i);

  const get = (cols, k) => {
    const i = idx[k];
    if(i === undefined) return "";
    return (cols[i] ?? "").trim();
  };

  const out = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split("\t");

    const obj = {
      id: get(cols,"id"),
      title: get(cols,"title"),
      art: get(cols,"art"),
      status: get(cols,"status"),
      priority: get(cols,"priority"),
      suggestedMonth: get(cols,"suggestedMonth"),
      date: get(cols,"date"),
      time: get(cols,"time"),
      duration: get(cols,"duration"),
      responsible: get(cols,"responsible"),
      capacity: get(cols,"capacity"),
      price: get(cols,"price"),
      place: get(cols,"place"),
      tags: get(cols,"tags"),
      summary: get(cols,"summary"),
      createdAt: get(cols,"createdAt"),
      updatedAt: get(cols,"updatedAt"),
    };

    // filtra filas vacías
    if(obj.id || obj.title) out.push(obj);
  }
  return out;
}

async function remoteUpsert(item){
  if(!REMOTE_WRITE_URL) return;

  try{
    state.remote.inflight++;

    // no-cors para evitar drama en browser: enviamos y ya
    await fetch(REMOTE_WRITE_URL, {
      method:"POST",
      mode:"no-cors",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ action:"upsert", item }),
    });

    if(REMOTE_SYNC.afterWriteReload){
      await sleep(REMOTE_SYNC.reloadDelayMs);
      await loadRemote({ silent:true });
    }
  }catch(e){
    state.remote.lastError = String(e?.message || e);
    console.warn("[remote] upsert falló:", e);
  }finally{
    state.remote.inflight = Math.max(0, state.remote.inflight - 1);
  }
}

async function remoteDelete(id){
  if(!REMOTE_WRITE_URL) return;

  try{
    state.remote.inflight++;

    await fetch(REMOTE_WRITE_URL, {
      method:"POST",
      mode:"no-cors",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ action:"delete", id }),
    });

    if(REMOTE_SYNC.afterWriteReload){
      await sleep(REMOTE_SYNC.reloadDelayMs);
      await loadRemote({ silent:true });
    }
  }catch(e){
    state.remote.lastError = String(e?.message || e);
    console.warn("[remote] delete falló:", e);
  }finally{
    state.remote.inflight = Math.max(0, state.remote.inflight - 1);
  }
}

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

// ---- Import/Export ----
function exportJSON(){
  const blob = {
    exportedAt: new Date().toISOString(),
    build: BUILD,
    items: state.items,
  };
  const json = JSON.stringify(blob, null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type:"application/json" }));
  a.download = `talleres-musicala-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function importJSON(e){
  const file = e.target.files?.[0];
  if(!file) return;

  try{
    const txt = await file.text();
    const parsed = JSON.parse(txt);

    const incoming = Array.isArray(parsed?.items)
      ? parsed.items
      : (Array.isArray(parsed) ? parsed : []);

    if(!incoming.length) throw new Error("Archivo sin items");

    const map = new Map(state.items.map(x => [x.id, x]));
    for(const it of incoming){
      const norm = normalizeItem(it);
      map.set(norm.id, norm);
    }
    state.items = [...map.values()];

    persist();
    renderAll();
    alert("Importado ✅");

    // Nota: import NO se sube automático a remoto para no spamear la Sheet.
    // Si quieren “subir import”, se hace un botón de “Publicar cambios”.
  }catch(err){
    console.error(err);
    alert("No pude importar ese JSON 😅");
  }finally{
    if(el.fileImport) el.fileImport.value = "";
  }
}

function normalizeItem(x){
  const now = new Date().toISOString();

  const out = {
    id: String(x?.id || uid()),
    title: String(x?.title || "").trim(),
    art: x?.art || ART_TYPES[0].id,
    status: x?.status || "idea",
    priority: x?.priority || "mid",
    suggestedMonth: x?.suggestedMonth || "",
    date: x?.date || "",
    time: x?.time || "",
    duration: toNumOrNull(x?.duration),
    responsible: String(x?.responsible || "").trim(),
    capacity: toNumOrNull(x?.capacity),
    price: toNumOrNull(x?.price),
    place: String(x?.place || "").trim(),
    tags: Array.isArray(x?.tags) ? x.tags : parseTags(x?.tags || ""),
    summary: String(x?.summary || "").trim(),
    updatedAt: x?.updatedAt || now,
    createdAt: x?.createdAt || now,
  };

  // limpiar tags duplicadas
  out.tags = Array.from(new Set(out.tags.map(t => String(t).trim()).filter(Boolean))).slice(0, 12);

  // normalizar string "null"/"undefined" desde TSV
  if(out.duration === null && (x?.duration === "null" || x?.duration === "undefined")) out.duration = null;

  return out;
}

// ---- Helpers ----
function $(sel){ return document.querySelector(sel); }

function fillSelect(selectEl, options){
  if(!selectEl) return;
  selectEl.innerHTML = options.map(o => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join("");
}

function buildMonthsOptions(year, count=12){
  const out = [];
  for(let i=1;i<=count;i++){
    const key = `${year}-${String(i).padStart(2,"0")}`;
    out.push({ value:key, label:`${MONTHS_ES[i-1]} ${year}` });
  }
  return out;
}

function uid(){
  return "w_" + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(3);
}

function parseTags(str){
  if(!str) return [];
  return String(str)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^#/, ""))
    .slice(0, 12);
}

function toNumOrNull(v){
  if(v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function monthKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}

function parseMonthKey(key){
  const [y, m] = key.split("-").map(Number);
  return { y, m };
}

function addMonths(monthKeyStr, delta){
  const { y, m } = parseMonthKey(monthKeyStr);
  const d = new Date(y, m-1, 1);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
}

function prettyMonth(key){
  const { y, m } = parseMonthKey(key);
  return `${MONTHS_ES[m-1]} ${y}`;
}

function prettyDate(isoDate){
  const [y,m,d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  const day = dt.toLocaleDateString("es-CO", { weekday:"short" });
  return `${capitalize(day)} ${d} ${MONTHS_ES[m-1].slice(0,3)} ${y}`;
}

function capitalize(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function escapeAttr(str){ return escapeHtml(str).replaceAll('"',"&quot;"); }

function sortSmart(a,b){
  const da = a.date || "";
  const db = b.date || "";
  if(da !== db) return da.localeCompare(db);

  const pa = priRank(a.priority);
  const pb = priRank(b.priority);
  if(pa !== pb) return pa - pb;

  return (a.title||"").localeCompare(b.title||"");
}

function priRank(p){
  if(p === "high") return 0;
  if(p === "mid") return 1;
  return 2;
}

function countBy(items, keyFn, orderedKeys = null){
  const m = {};
  for(const it of items){
    const k = keyFn(it);
    m[k] = (m[k]||0) + 1;
  }
  if(orderedKeys){
    for(const k of orderedKeys){
      if(m[k] === undefined) m[k] = 0;
    }
  }
  return m;
}

function countByMonth(items){
  const m = {};
  for(const it of items){
    const k = itemMonthKey(it);
    if(k === "none") continue;
    m[k] = (m[k]||0) + 1;
  }
  return m;
}

// ---- Demo data ----
function demoData(){
  const y = new Date().getFullYear();
  return [
    mk("Taller de Improvisación (Música)", "music", "idea", "mid", `${y}-03`, "", "Alek", ["impro","jazz"], "Explorar recursos de improvisación guiada."),
    mk("Taller de Bachata Consciente", "dance", "eval", "high", `${y}-02`, "", "Cata", ["parejas","consciente"], "Definir música, cupo y logística."),
    mk("Acuarela + Café (Ferma x Musicala)", "visual", "plan", "high", `${y}-04`, "", "Cata", ["café","acuarela"], "Revisar alianza, materiales y costos."),
    mk("Teatro: Voz y Presencia Escénica", "theatre", "confirmed", "mid", `${y}-02`, `${y}-02-22`, "Profe X", ["voz","escena"], "Taller de 2 horas, enfoque práctico.", "16:00", 120, 18, 70000, "Sede"),
    mk("Percusión Corporal Familiar", "music", "confirmed", "low", `${y}-03`, `${y}-03-09`, "Alek", ["familias","ritmo"], "Actividad para familias, súper lúdica.", "11:00", 60, 20, 45000, "Sede"),
    mk("Pintura para Principiantes", "visual", "done", "mid", `${y}-01`, `${y}-01-18`, "Cata", ["principiantes"], "Ya se realizó, recopilar feedback.", "10:00", 90, 12, 60000, "Sede"),
  ];

  function mk(title, art, status, priority, suggestedMonth, date, responsible, tags, summary, time="", duration=null, capacity=null, price=null, place=""){
    return normalizeItem({
      id: uid(),
      title, art, status, priority, suggestedMonth, date, responsible, tags, summary, time, duration, capacity, price, place,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}
