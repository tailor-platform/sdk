const TABLE_WIDTH = 260;
const TABLE_HEIGHT = 62;
const X_GAP = 160;
const Y_GAP = 56;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.2;

const elements = {
  namespace: document.getElementById("namespace"),
  revision: document.getElementById("revision"),
  search: document.getElementById("search"),
  tableSummary: document.getElementById("table-count-summary"),
  tableList: document.getElementById("table-list"),
  canvas: document.getElementById("canvas"),
  world: document.getElementById("world"),
  edges: document.getElementById("edges"),
  nodes: document.getElementById("nodes"),
  details: document.getElementById("details"),
  emptyState: document.getElementById("empty-state"),
  status: document.getElementById("status"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomLabel: document.getElementById("zoom-label"),
  fitView: document.getElementById("fit-view"),
  copyLink: document.getElementById("copy-link"),
};

let schema;
let layout;
let selectedTable;
let searchText = "";
let viewport = { x: 32, y: 32, z: 1 };
let hasViewportFromHash = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function tableByName(name) {
  return schema?.tables.find((table) => table.name === name);
}

function readHashState() {
  const params = new URLSearchParams(location.hash.slice(1));
  selectedTable = params.get("table") || undefined;
  const x = Number(params.get("x"));
  const y = Number(params.get("y"));
  const z = Number(params.get("z"));
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    viewport = { x, y, z: clamp(z, MIN_ZOOM, MAX_ZOOM) };
    hasViewportFromHash = true;
  }
}

function writeHashState() {
  const params = new URLSearchParams();
  if (selectedTable) params.set("table", selectedTable);
  params.set("x", String(Math.round(viewport.x)));
  params.set("y", String(Math.round(viewport.y)));
  params.set("z", viewport.z.toFixed(3));
  history.replaceState(null, "", `#${params.toString()}`);
}

async function fetchSchema() {
  const response = await fetch(`./schema.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load schema.json (${response.status})`);
  }
  return response.json();
}

function cardHeight() {
  return TABLE_HEIGHT;
}

function computeRanks(tables, relations) {
  const ranks = new Map(tables.map((table) => [table.name, 0]));
  for (let i = 0; i < tables.length; i += 1) {
    let changed = false;
    for (const relation of relations) {
      const targetRank = ranks.get(relation.targetTable) ?? 0;
      const sourceRank = ranks.get(relation.sourceTable) ?? 0;
      if (sourceRank <= targetRank && relation.sourceTable !== relation.targetTable) {
        ranks.set(relation.sourceTable, targetRank + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return ranks;
}

function computeLayout(nextSchema) {
  const tables = [...nextSchema.tables].sort((a, b) => a.name.localeCompare(b.name));
  const ranks = computeRanks(tables, nextSchema.relations);
  const layers = new Map();
  for (const table of tables) {
    const rank = ranks.get(table.name) ?? 0;
    if (!layers.has(rank)) layers.set(rank, []);
    layers.get(rank).push(table);
  }

  const nodes = new Map();
  let maxX = TABLE_WIDTH;
  let maxY = 0;
  for (const rank of [...layers.keys()].sort((a, b) => a - b)) {
    const layerTables = layers.get(rank).sort((a, b) => a.name.localeCompare(b.name));
    let y = 0;
    for (const table of layerTables) {
      const height = cardHeight(table);
      const x = rank * (TABLE_WIDTH + X_GAP);
      nodes.set(table.name, { x, y, width: TABLE_WIDTH, height });
      maxX = Math.max(maxX, x + TABLE_WIDTH);
      maxY = Math.max(maxY, y + height);
      y += height + Y_GAP;
    }
  }

  return {
    nodes,
    width: maxX,
    height: maxY,
  };
}

function isTableRelatedToSelection(tableName) {
  if (!selectedTable) return true;
  if (tableName === selectedTable) return true;
  return schema.relations.some(
    (relation) =>
      (relation.sourceTable === selectedTable && relation.targetTable === tableName) ||
      (relation.targetTable === selectedTable && relation.sourceTable === tableName),
  );
}

function matchesSearch(table) {
  if (!searchText) return true;
  const needle = searchText.toLowerCase();
  return (
    table.name.toLowerCase().includes(needle) ||
    table.columns.some((column) => column.name.toLowerCase().includes(needle))
  );
}

function renderHeader() {
  elements.namespace.textContent = schema.namespace;
  elements.revision.textContent = `${schema.tables.length} tables / ${schema.relations.length} relations / ${schema.revision}`;
  elements.tableSummary.textContent = String(schema.tables.length);
}

function renderTableList() {
  const tables = schema.tables.filter(matchesSearch);
  elements.tableList.innerHTML = tables
    .map(
      (table) => `
        <button type="button" data-table="${escapeHtml(table.name)}" aria-current="${table.name === selectedTable}">
          <span class="table-list-icon" aria-hidden="true"></span>
          <span>${escapeHtml(table.name)}</span>
          <span class="table-count">${table.columns.length}</span>
        </button>
      `,
    )
    .join("");

  elements.tableList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      selectTable(button.dataset.table);
    });
  });
}

function renderNodes() {
  elements.nodes.innerHTML = schema.tables
    .map((table) => {
      const node = layout.nodes.get(table.name);
      const related = isTableRelatedToSelection(table.name);
      const muted = !matchesSearch(table) || !related;
      return `
        <button
          type="button"
          class="table-card ${table.name === selectedTable ? "is-selected" : ""} ${related ? "is-related" : ""} ${muted ? "is-muted" : ""}"
          data-table="${escapeHtml(table.name)}"
          aria-label="Focus table ${escapeHtml(table.name)}"
          aria-pressed="${table.name === selectedTable}"
          style="left: ${node.x}px; top: ${node.y}px"
        >
          <div class="table-head">
            <span class="table-icon" aria-hidden="true"></span>
            <div class="table-name">${escapeHtml(table.name)}</div>
          </div>
        </button>
      `;
    })
    .join("");

  elements.nodes.querySelectorAll(".table-card").forEach((card) => {
    card.addEventListener("click", () => selectTable(card.dataset.table));
  });
}

function edgeGeometry(source, target) {
  const sourceRight = source.x < target.x;
  const sx = sourceRight ? source.x + source.width : source.x;
  const tx = sourceRight ? target.x : target.x + target.width;
  const sy = source.y + source.height / 2;
  const ty = target.y + target.height / 2;
  const bend = Math.max(80, Math.abs(tx - sx) * 0.45);
  const c1x = sx + (sourceRight ? bend : -bend);
  const c2x = tx + (sourceRight ? -bend : bend);
  return {
    d: `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`,
    sourcePoint: { x: sx, y: sy },
    targetPoint: { x: tx, y: ty },
    sourceRight,
  };
}

function sourceColumnForRelation(relation) {
  const table = tableByName(relation.sourceTable);
  const sourceColumn = relation.sourceColumns[0];
  return table?.columns.find((column) => column.name === sourceColumn);
}

function normalizedRelationType(relation) {
  if (["1-1", "oneToOne"].includes(relation.relationType)) return "1-1";
  if (["n-1", "N-1", "manyToOne"].includes(relation.relationType)) return "n-1";
  return relation.relationType || "foreignKey";
}

function relationCardinality(relation) {
  const sourceColumn = sourceColumnForRelation(relation);
  const relationType = normalizedRelationType(relation);
  const sourceMultiple = relationType === "n-1" || relationType === "keyOnly";
  const targetMultiple = relationType === "keyOnly" && sourceColumn?.array === true;

  return {
    source: sourceMultiple ? "0..n" : "0..1",
    target: targetMultiple ? "0..n" : relation.required ? "1" : "0..1",
  };
}

function cardinalityLabel(label, x, y, selected) {
  const width = label.length > 1 ? 36 : 22;
  return `
    <g class="edge-label ${selected ? "is-selected" : ""}" transform="translate(${x} ${y})">
      <rect x="${-width / 2}" y="-10" width="${width}" height="20" rx="5"></rect>
      <text text-anchor="middle" dominant-baseline="central">${escapeHtml(label)}</text>
    </g>
  `;
}

function renderEdges() {
  elements.edges.setAttribute("width", String(layout.width + 400));
  elements.edges.setAttribute("height", String(layout.height + 400));
  elements.edges.innerHTML = `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
        <path d="M 0 0 L 10 4 L 0 8 z" fill="#555d5b"></path>
      </marker>
      <marker id="arrow-selected" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
        <path d="M 0 0 L 10 4 L 0 8 z" fill="#21e68b"></path>
      </marker>
    </defs>
    ${schema.relations
      .map((relation) => {
        const source = layout.nodes.get(relation.sourceTable);
        const target = layout.nodes.get(relation.targetTable);
        if (!source || !target) return "";
        const selected =
          relation.sourceTable === selectedTable || relation.targetTable === selectedTable;
        const geometry = edgeGeometry(source, target);
        const cardinality = relationCardinality(relation);
        const sourceLabelX = geometry.sourcePoint.x + (geometry.sourceRight ? 26 : -26);
        const targetLabelX = geometry.targetPoint.x + (geometry.sourceRight ? -26 : 26);
        return `
          <path class="edge ${selected ? "is-selected" : ""}" d="${geometry.d}" marker-end="url(#${selected ? "arrow-selected" : "arrow"})"></path>
          ${cardinalityLabel(cardinality.source, sourceLabelX, geometry.sourcePoint.y, selected)}
          ${cardinalityLabel(cardinality.target, targetLabelX, geometry.targetPoint.y, selected)}
        `;
      })
      .join("")}
  `;
}

function relationRows(table, direction) {
  const relations = schema.relations.filter((relation) =>
    direction === "out" ? relation.sourceTable === table.name : relation.targetTable === table.name,
  );
  if (relations.length === 0) return `<p>None</p>`;
  return `
    <div class="detail-list">
      ${relations
        .map((relation) => {
          const label =
            direction === "out"
              ? `${relation.sourceColumns.join(", ")} -> ${relation.targetTable}.${relation.targetColumns.join(", ")}`
              : `${relation.sourceTable}.${relation.sourceColumns.join(", ")} -> ${relation.targetColumns.join(", ")}`;
          return `<div class="detail-row"><strong>${escapeHtml(label)}</strong><code>${escapeHtml(relation.kind)}</code></div>`;
        })
        .join("")}
    </div>
  `;
}

function columnPills(column) {
  const pills = [];
  if (column.primaryKey) pills.push("primary");
  if (column.required) pills.push("required");
  if (column.array) pills.push("array");
  if (column.unique) pills.push("unique");
  if (column.index) pills.push("index");
  if (column.relation) pills.push(`${column.relation.targetTable}.${column.relation.targetColumn}`);
  if (column.enumValues?.length) pills.push(...column.enumValues);
  if (column.validations) pills.push(`${column.validations} validations`);
  if (column.hooks?.create) pills.push("create hook");
  if (column.hooks?.update) pills.push("update hook");
  return pills.length
    ? `<div class="pill-wrap">${pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join("")}</div>`
    : "";
}

function renderDetails() {
  const table = selectedTable ? tableByName(selectedTable) : undefined;
  if (!table) {
    elements.details.innerHTML = `
      <div class="details-inner">
        <section>
          <h2><span class="table-icon" aria-hidden="true"></span>${escapeHtml(schema.namespace)}</h2>
          <p>${schema.tables.length} tables, ${schema.relations.length} relations</p>
        </section>
      </div>
    `;
    return;
  }

  elements.details.innerHTML = `
    <div class="details-inner">
      <section>
        <h2><span class="table-icon" aria-hidden="true"></span>${escapeHtml(table.name)}</h2>
        <p>${escapeHtml(table.description || table.pluralForm)}</p>
      </section>
      <section class="details-section">
        <h3>Outgoing Relations</h3>
        ${relationRows(table, "out")}
      </section>
      <section class="details-section">
        <h3>Incoming Relations</h3>
        ${relationRows(table, "in")}
      </section>
      <section class="details-section">
        <h3>Columns</h3>
        <div class="detail-list">
          ${table.columns
            .map(
              (column) => `
                <div class="detail-row">
                  <div>
                    <strong>${escapeHtml(column.name)}</strong>
                    ${column.description ? `<p>${escapeHtml(column.description)}</p>` : ""}
                    ${columnPills(column)}
                  </div>
                  <code>${escapeHtml(column.type)}${column.array ? "[]" : ""}</code>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
      ${
        table.indexes.length
          ? `<section class="details-section">
              <h3>Indexes</h3>
              <div class="detail-list">
                ${table.indexes
                  .map(
                    (index) => `
                      <div class="detail-row">
                        <strong>${escapeHtml(index.name)}</strong>
                        <code>${escapeHtml(index.fields.join(", "))}${index.unique ? " unique" : ""}</code>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </section>`
          : ""
      }
      ${
        table.source?.kind === "plugin"
          ? `<section class="details-section">
              <h3>Source</h3>
              <div class="detail-row">
                <strong>${escapeHtml(table.source.pluginId)}</strong>
                <code>${escapeHtml(table.source.generatedTypeKind || "plugin")}</code>
              </div>
            </section>`
          : ""
      }
    </div>
  `;
}

function applyTransform() {
  elements.world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.z})`;
  elements.canvas.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
  elements.canvas.style.backgroundSize = `${Math.max(4, 22 * viewport.z)}px ${Math.max(4, 22 * viewport.z)}px`;
  elements.zoomLabel.textContent = `${Math.round(viewport.z * 100)}%`;
  writeHashState();
}

function centerTable(tableName) {
  const node = layout?.nodes.get(tableName);
  if (!node) return;

  const rect = elements.canvas.getBoundingClientRect();
  viewport = {
    ...viewport,
    x: Math.round(rect.width / 2 - (node.x + node.width / 2) * viewport.z),
    y: Math.round(rect.height / 2 - (node.y + node.height / 2) * viewport.z),
  };
}

function fitView() {
  if (!layout || schema.tables.length === 0) return;
  const rect = elements.canvas.getBoundingClientRect();
  const scale = clamp(
    Math.min(
      (rect.width - 80) / Math.max(layout.width, 1),
      (rect.height - 80) / Math.max(layout.height, 1),
    ),
    MIN_ZOOM,
    1.2,
  );
  viewport = {
    z: scale,
    x: Math.round((rect.width - layout.width * scale) / 2),
    y: Math.round((rect.height - layout.height * scale) / 2),
  };
  applyTransform();
}

function renderAll(options = {}) {
  layout = computeLayout(schema);
  elements.emptyState.hidden = schema.tables.length > 0;
  renderHeader();
  renderTableList();
  renderEdges();
  renderNodes();
  renderDetails();
  if (options.fit) {
    fitView();
    return;
  }
  if (options.center && selectedTable) {
    centerTable(selectedTable);
  }
  applyTransform();
}

function selectTable(tableName, options = {}) {
  if (!tableName) return;
  selectedTable = tableName;
  renderAll({ center: options.center !== false });
}

function zoomAt(nextZoom, clientX, clientY) {
  const rect = elements.canvas.getBoundingClientRect();
  const worldX = (clientX - rect.left - viewport.x) / viewport.z;
  const worldY = (clientY - rect.top - viewport.y) / viewport.z;
  const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  viewport = {
    z,
    x: clientX - rect.left - worldX * z,
    y: clientY - rect.top - worldY * z,
  };
  applyTransform();
}

function panBy(deltaX, deltaY) {
  viewport = {
    ...viewport,
    x: viewport.x - deltaX,
    y: viewport.y - deltaY,
  };
  applyTransform();
}

function wireInteractions() {
  elements.search.addEventListener("input", () => {
    searchText = elements.search.value.trim();
    renderAll();
  });

  elements.zoomIn.addEventListener("click", () => {
    const rect = elements.canvas.getBoundingClientRect();
    zoomAt(viewport.z * 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  elements.zoomOut.addEventListener("click", () => {
    const rect = elements.canvas.getBoundingClientRect();
    zoomAt(viewport.z / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  elements.fitView.addEventListener("click", fitView);
  elements.copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showStatus("Link copied");
    } catch {
      showStatus("Copy failed", true);
    }
  });

  elements.canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(viewport.z * Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
        return;
      }

      if (event.shiftKey) {
        const deltaX = event.deltaX || event.deltaY;
        panBy(deltaX, 0);
        return;
      }

      panBy(0, event.deltaY);
    },
    { passive: false },
  );

  window.addEventListener("resize", () => {
    if (!hasViewportFromHash) fitView();
  });
}

function showStatus(message, danger = false) {
  elements.status.hidden = false;
  elements.status.textContent = message;
  elements.status.style.color = danger ? "var(--danger)" : "var(--accent)";
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    elements.status.hidden = true;
  }, 3000);
}

function startPolling() {
  const params = new URLSearchParams(location.search);
  if (params.get("watch") !== "1") return;

  setInterval(async () => {
    try {
      const nextSchema = await fetchSchema();
      if (nextSchema.revision !== schema.revision) {
        schema = nextSchema;
        if (selectedTable && !tableByName(selectedTable)) {
          selectedTable = schema.tables[0]?.name;
        }
        renderAll();
        showStatus("Schema updated");
      }
    } catch (error) {
      showStatus(String(error), true);
    }
  }, 1500);
}

async function main() {
  readHashState();
  wireInteractions();
  try {
    schema = await fetchSchema();
    if (!selectedTable || !tableByName(selectedTable)) {
      selectedTable = schema.tables[0]?.name;
    }
    renderAll({ fit: !hasViewportFromHash });
    startPolling();
  } catch (error) {
    elements.namespace.textContent = "TailorDB ERD";
    elements.revision.textContent = "Schema load failed";
    showStatus(String(error), true);
  }
}

main();
