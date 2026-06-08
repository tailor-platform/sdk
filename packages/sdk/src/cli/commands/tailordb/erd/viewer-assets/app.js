const TABLE_WIDTH = 260;
const TABLE_HEIGHT = 62;
const FIELD_ROW_HEIGHT = 28;
const FIELD_SECTION_BORDER_HEIGHT = 1;
const X_GAP = 240;
const Y_GAP = 56;
const CARDINALITY_MARKER_WIDTH = 50;
const CROW_FOOT_TIP_OFFSET = 0;
const CROW_FOOT_JOIN_OFFSET = 18;
const CARDINALITY_OUTER_OFFSET = 32;
const DRAG_THRESHOLD = 4;
const FIT_PADDING = 80;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.2;
const DEFAULT_SHOW_MODE = "TABLE_NAME";
const SHOW_MODE_OPTIONS = [
  { value: "ALL_FIELDS", label: "All Fields" },
  { value: "TABLE_NAME", label: "Table Name" },
  { value: "KEY_ONLY", label: "Key Only" },
];

const elements = {
  namespace: document.getElementById("namespace"),
  revision: document.getElementById("revision"),
  search: document.getElementById("search"),
  tableSummary: document.getElementById("table-count-summary"),
  showAllTables: document.getElementById("show-all-tables"),
  hideAllTables: document.getElementById("hide-all-tables"),
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
  showMode: document.getElementById("show-mode"),
  showModeMenu: document.getElementById("show-mode-menu"),
  copyLink: document.getElementById("copy-link"),
};

let schema;
let layout;
let selectedTable;
let searchText = "";
let viewport = { x: 32, y: 32, z: 1 };
let hasViewportFromHash = false;
let showMode = DEFAULT_SHOW_MODE;
let activeCardDrag;
let activeCanvasPan;
let activeViewportAnimation;
let suppressNextCanvasClick = false;
const manualNodePositions = new Map();
const hiddenTableNames = new Set();

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

function showModeOption(value) {
  return SHOW_MODE_OPTIONS.find((option) => option.value === value);
}

function isTableHidden(tableName) {
  return hiddenTableNames.has(tableName);
}

function visibleTables() {
  return schema.tables.filter((table) => !isTableHidden(table.name));
}

function visibleTableNames() {
  return visibleTables().map((table) => table.name);
}

function readHashState() {
  const params = new URLSearchParams(location.hash.slice(1));
  selectedTable = params.get("table") || undefined;
  const nextShowMode = params.get("show");
  if (showModeOption(nextShowMode)) {
    showMode = nextShowMode;
  }
  hiddenTableNames.clear();
  for (const tableName of (params.get("hidden") || "").split(",")) {
    if (tableName) hiddenTableNames.add(tableName);
  }
  const x = Number(params.get("x"));
  const y = Number(params.get("y"));
  const z = Number(params.get("z"));
  const hasViewportParams = params.has("x") && params.has("y") && params.has("z");
  if (hasViewportParams && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    viewport = { x, y, z: clamp(z, MIN_ZOOM, MAX_ZOOM) };
    hasViewportFromHash = true;
  }
}

function writeHashState() {
  const params = new URLSearchParams();
  if (selectedTable) params.set("table", selectedTable);
  if (showMode !== DEFAULT_SHOW_MODE) params.set("show", showMode);
  if (hiddenTableNames.size > 0) {
    params.set("hidden", [...hiddenTableNames].sort((a, b) => a.localeCompare(b)).join(","));
  }
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

function isKeyColumn(column) {
  return Boolean(column.primaryKey || column.unique || column.index || column.relation);
}

function columnsForShowMode(table) {
  if (showMode === "ALL_FIELDS") return table.columns;
  if (showMode === "KEY_ONLY") return table.columns.filter(isKeyColumn);
  return [];
}

function cardHeight(table) {
  const fieldCount = columnsForShowMode(table).length;
  return (
    TABLE_HEIGHT +
    (fieldCount > 0 ? FIELD_SECTION_BORDER_HEIGHT : 0) +
    fieldCount * FIELD_ROW_HEIGHT
  );
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
  for (const rank of [...layers.keys()].sort((a, b) => a - b)) {
    const layerTables = layers.get(rank).sort((a, b) => a.name.localeCompare(b.name));
    let y = 0;
    for (const table of layerTables) {
      const height = cardHeight(table);
      const x = rank * (TABLE_WIDTH + X_GAP);
      nodes.set(table.name, { x, y, width: TABLE_WIDTH, height });
      y += height + Y_GAP;
    }
  }

  return {
    nodes,
    ...layoutBounds(nodes),
  };
}

function layoutBounds(nodes, tableNames) {
  const includedNames = tableNames ? new Set(tableNames) : undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [tableName, node] of nodes) {
    if (includedNames && !includedNames.has(tableName)) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: TABLE_WIDTH, height: TABLE_HEIGHT };
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function visibleLayoutBounds() {
  return layoutBounds(layout.nodes, visibleTableNames());
}

function applyManualNodePositions() {
  for (const [tableName, position] of manualNodePositions) {
    const node = layout.nodes.get(tableName);
    if (node) {
      node.x = position.x;
      node.y = position.y;
    }
  }
  Object.assign(layout, layoutBounds(layout.nodes));
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

function eyeIcon(hidden) {
  if (hidden) {
    return `
      <svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3l18 18"></path>
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path>
        <path d="M8.4 5.6A9.3 9.3 0 0 1 12 5c5 0 8.4 4.1 9.5 6.2a2 2 0 0 1 0 1.6 14.3 14.3 0 0 1-2.7 3.5"></path>
        <path d="M6.1 6.9a14.7 14.7 0 0 0-3.6 4.3 2 2 0 0 0 0 1.6C3.6 14.9 7 19 12 19a9.8 9.8 0 0 0 4-.8"></path>
      </svg>
    `;
  }

  return `
    <svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 11.2C3.6 9.1 7 5 12 5s8.4 4.1 9.5 6.2a2 2 0 0 1 0 1.6C20.4 14.9 17 19 12 19s-8.4-4.1-9.5-6.2a2 2 0 0 1 0-1.6Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

function renderHeader() {
  elements.namespace.textContent = schema.namespace;
  elements.revision.textContent = `${schema.tables.length} tables / ${schema.relations.length} relations / ${schema.revision}`;
  const visibleCount = visibleTables().length;
  elements.tableSummary.textContent =
    visibleCount === schema.tables.length
      ? String(schema.tables.length)
      : `${visibleCount}/${schema.tables.length}`;
  elements.showAllTables.disabled =
    schema.tables.length === 0 || visibleCount === schema.tables.length;
  elements.hideAllTables.disabled = schema.tables.length === 0 || visibleCount === 0;
}

function renderTableList() {
  const tables = schema.tables.filter(matchesSearch);
  elements.tableList.innerHTML = tables
    .map((table) => {
      const hidden = isTableHidden(table.name);
      const visibilityLabel = hidden ? "Show" : "Hide";
      return `
          <div class="table-list-row ${hidden ? "is-hidden" : ""}">
            <button
              type="button"
              class="table-select"
              data-table="${escapeHtml(table.name)}"
              aria-current="${table.name === selectedTable}"
            >
              <span class="table-list-icon" aria-hidden="true"></span>
              <span>${escapeHtml(table.name)}</span>
            </button>
            <button
              type="button"
              class="table-visibility-toggle"
              data-table="${escapeHtml(table.name)}"
              aria-label="${visibilityLabel} table ${escapeHtml(table.name)}"
              title="${visibilityLabel}"
            >
              ${eyeIcon(hidden)}
            </button>
          </div>
      `;
    })
    .join("");

  elements.tableList.querySelectorAll(".table-select").forEach((button) => {
    button.addEventListener("click", () => {
      selectTable(button.dataset.table);
    });
  });
  elements.tableList.querySelectorAll(".table-visibility-toggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTableVisibility(button.dataset.table);
    });
  });
}

function tableFieldRows(table) {
  const columns = columnsForShowMode(table);
  if (columns.length === 0) return "";

  return `
    <div class="table-fields">
      ${columns
        .map(
          (column) => `
            <div class="table-field ${isKeyColumn(column) ? "is-key" : ""}">
              <span class="field-name">${escapeHtml(column.name)}</span>
              <span class="field-type">${escapeHtml(column.type)}${column.array ? "[]" : ""}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderNodes() {
  elements.nodes.innerHTML = schema.tables
    .filter((table) => !isTableHidden(table.name))
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
          style="left: ${node.x}px; top: ${node.y}px; height: ${node.height}px"
        >
          <div class="table-head">
            <span class="table-icon" aria-hidden="true"></span>
            <div class="table-name">${escapeHtml(table.name)}</div>
          </div>
          ${tableFieldRows(table)}
        </button>
      `;
    })
    .join("");

  elements.nodes.querySelectorAll(".table-card").forEach(wireTableCard);
}

function wireTableCard(card) {
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    suppressNextCanvasClick = false;
    if (card.dataset.dragged === "true") {
      event.preventDefault();
      card.dataset.dragged = "false";
      return;
    }
    selectTable(card.dataset.table);
  });

  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    cancelViewportAnimation();
    const tableName = card.dataset.table;
    const node = layout.nodes.get(tableName);
    if (!node) return;

    activeCardDrag = {
      card,
      moved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      tableName,
    };
    card.setPointerCapture(event.pointerId);
  });

  card.addEventListener("pointermove", (event) => {
    if (!activeCardDrag || activeCardDrag.pointerId !== event.pointerId) return;

    const screenDeltaX = event.clientX - activeCardDrag.startClientX;
    const screenDeltaY = event.clientY - activeCardDrag.startClientY;
    if (!activeCardDrag.moved && Math.hypot(screenDeltaX, screenDeltaY) < DRAG_THRESHOLD) {
      return;
    }

    event.preventDefault();
    activeCardDrag.moved = true;
    activeCardDrag.card.classList.add("is-dragging");
    moveTableCard(
      activeCardDrag.tableName,
      activeCardDrag.card,
      activeCardDrag.startX + screenDeltaX / viewport.z,
      activeCardDrag.startY + screenDeltaY / viewport.z,
    );
  });

  card.addEventListener("pointerup", finishCardDrag);
  card.addEventListener("pointercancel", finishCardDrag);
}

function moveTableCard(tableName, card, x, y) {
  const node = layout.nodes.get(tableName);
  if (!node) return;

  node.x = Math.round(x);
  node.y = Math.round(y);
  manualNodePositions.set(tableName, { x: node.x, y: node.y });
  Object.assign(layout, layoutBounds(layout.nodes));
  card.style.left = `${node.x}px`;
  card.style.top = `${node.y}px`;
  renderEdges();
}

function finishCardDrag(event) {
  if (!activeCardDrag || activeCardDrag.pointerId !== event.pointerId) return;

  if (activeCardDrag.card.hasPointerCapture(event.pointerId)) {
    activeCardDrag.card.releasePointerCapture(event.pointerId);
  }
  activeCardDrag.card.classList.remove("is-dragging");
  if (activeCardDrag.moved) {
    event.preventDefault();
    activeCardDrag.card.dataset.dragged = "true";
    selectedTable = activeCardDrag.tableName;
    activeCardDrag = undefined;
    renderAll({ center: false });
    return;
  }

  activeCardDrag = undefined;
}

function edgeGeometry(source, target) {
  const sourceRight = source.x < target.x;
  const direction = sourceRight ? 1 : -1;
  const sourceNodeX = sourceRight ? source.x + source.width : source.x;
  const targetNodeX = sourceRight ? target.x : target.x + target.width;
  const sy = source.y + source.height / 2;
  const ty = target.y + target.height / 2;
  const sx = sourceNodeX + direction * CARDINALITY_MARKER_WIDTH;
  const tx = targetNodeX - direction * CARDINALITY_MARKER_WIDTH;
  const bend = Math.max(80, Math.abs(tx - sx) * 0.45);
  const c1x = sx + (sourceRight ? bend : -bend);
  const c2x = tx + (sourceRight ? -bend : bend);
  return {
    d: `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`,
    sourceNodePoint: { x: sourceNodeX, y: sy },
    targetNodePoint: { x: targetNodeX, y: ty },
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
  const sourceMultiple =
    relationType === "n-1" ||
    relationType === "keyOnly" ||
    (relationType === "foreignKey" && sourceColumn?.unique !== true);
  const targetMultiple = relationType === "keyOnly" && sourceColumn?.array === true;

  return {
    source: { min: 0, max: sourceMultiple ? "n" : 1 },
    target: { min: relation.required ? 1 : 0, max: targetMultiple ? "n" : 1 },
  };
}

function oneMarker(x, y) {
  return `
    <line x1="${x}" y1="${y - 10}" x2="${x}" y2="${y + 10}"></line>
  `;
}

function cardinalityMarker(cardinality, point, sideSign, selected) {
  const crowFootTip = CROW_FOOT_TIP_OFFSET;
  const crowFootJoin = CROW_FOOT_JOIN_OFFSET;
  const outer = CARDINALITY_OUTER_OFFSET;
  const markerEndX = point.x + sideSign * CARDINALITY_MARKER_WIDTH;
  const parts = [
    `<line class="edge-cardinality-line" x1="${point.x}" y1="${point.y}" x2="${markerEndX}" y2="${point.y}"></line>`,
  ];

  if (cardinality.max === "n") {
    const baseX = point.x + sideSign * crowFootJoin;
    const endX = point.x + sideSign * crowFootTip;
    parts.push(`
      <line x1="${baseX}" y1="${point.y}" x2="${endX}" y2="${point.y - 11}"></line>
      <line x1="${baseX}" y1="${point.y}" x2="${endX}" y2="${point.y + 11}"></line>
    `);
    if (cardinality.min === 0) {
      parts.push(`<circle cx="${point.x + sideSign * outer}" cy="${point.y}" r="6"></circle>`);
    } else {
      parts.push(oneMarker(point.x + sideSign * outer, point.y));
    }
  } else {
    parts.push(oneMarker(point.x + sideSign * crowFootJoin, point.y));
    if (cardinality.min === 0) {
      parts.push(`<circle cx="${point.x + sideSign * outer}" cy="${point.y}" r="6"></circle>`);
    } else {
      parts.push(oneMarker(point.x + sideSign * outer, point.y));
    }
  }

  return `
    <g class="edge-cardinality ${selected ? "is-selected" : ""}">
      ${parts.join("")}
    </g>
  `;
}

function renderEdges() {
  const bounds = visibleLayoutBounds();
  elements.edges.setAttribute("width", String(bounds.width + 400));
  elements.edges.setAttribute("height", String(bounds.height + 400));
  elements.edges.innerHTML = schema.relations
    .map((relation) => {
      if (isTableHidden(relation.sourceTable) || isTableHidden(relation.targetTable)) return "";
      const source = layout.nodes.get(relation.sourceTable);
      const target = layout.nodes.get(relation.targetTable);
      if (!source || !target) return "";
      const selected =
        relation.sourceTable === selectedTable || relation.targetTable === selectedTable;
      const geometry = edgeGeometry(source, target);
      const cardinality = relationCardinality(relation);
      const direction = geometry.sourceRight ? 1 : -1;
      return `
          <path class="edge ${selected ? "is-selected" : ""}" d="${geometry.d}"></path>
          ${cardinalityMarker(cardinality.source, geometry.sourceNodePoint, direction, selected)}
          ${cardinalityMarker(cardinality.target, geometry.targetNodePoint, -direction, selected)}
        `;
    })
    .join("");
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

function checkIcon() {
  return `
    <svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5"></path>
    </svg>
  `;
}

function renderShowModeControls() {
  const selectedOption = showModeOption(showMode) ?? showModeOption(DEFAULT_SHOW_MODE);
  elements.showMode.innerHTML = `
    <span>${escapeHtml(selectedOption.label)}</span>
    <span class="show-mode-caret" aria-hidden="true"></span>
  `;
  elements.showMode.setAttribute("aria-label", `Show mode: ${selectedOption.label}`);
  elements.showModeMenu.innerHTML = SHOW_MODE_OPTIONS.map(
    (option) => `
      <button
        type="button"
        class="show-mode-option"
        role="menuitemradio"
        aria-checked="${option.value === showMode}"
        data-show-mode="${option.value}"
      >
        <span>${escapeHtml(option.label)}</span>
        <span class="show-mode-check">${option.value === showMode ? checkIcon() : ""}</span>
      </button>
    `,
  ).join("");

  elements.showModeMenu.querySelectorAll(".show-mode-option").forEach((button) => {
    button.addEventListener("click", () => {
      setShowMode(button.dataset.showMode);
    });
  });
}

function setShowModeMenuOpen(open) {
  elements.showMode.setAttribute("aria-expanded", String(open));
  elements.showModeMenu.hidden = !open;
}

function setShowMode(nextShowMode) {
  if (!showModeOption(nextShowMode)) return;
  setShowModeMenuOpen(false);
  if (showMode === nextShowMode) return;

  showMode = nextShowMode;
  renderAll({ center: false });
}

function toggleTableVisibility(tableName) {
  if (!tableName) return;
  if (hiddenTableNames.has(tableName)) {
    hiddenTableNames.delete(tableName);
  } else {
    hiddenTableNames.add(tableName);
  }
  renderAll({ center: false });
}

function setAllTableVisibility(hidden) {
  if (!schema) return;
  hiddenTableNames.clear();
  if (hidden) {
    for (const table of schema.tables) {
      hiddenTableNames.add(table.name);
    }
  }
  renderAll({ center: false });
}

function cancelViewportAnimation() {
  if (!activeViewportAnimation) return;
  cancelAnimationFrame(activeViewportAnimation.frame);
  activeViewportAnimation = undefined;
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function animateViewportTo(targetViewport) {
  cancelViewportAnimation();
  const startViewport = { ...viewport };
  const duration = 360;
  let startedAt;

  activeViewportAnimation = { frame: undefined };
  const step = () => {
    const now = Date.now();
    startedAt ??= now;
    const progress = clamp((now - startedAt) / duration, 0, 1);
    const eased = easeOutCubic(progress);
    viewport = {
      x: startViewport.x + (targetViewport.x - startViewport.x) * eased,
      y: startViewport.y + (targetViewport.y - startViewport.y) * eased,
      z: startViewport.z + (targetViewport.z - startViewport.z) * eased,
    };
    applyTransform();

    if (progress < 1) {
      activeViewportAnimation.frame = requestAnimationFrame(step);
      return;
    }

    viewport = targetViewport;
    activeViewportAnimation = undefined;
    applyTransform();
  };

  activeViewportAnimation.frame = requestAnimationFrame(step);
}

function applyTransform() {
  elements.world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.z})`;
  elements.canvas.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
  elements.canvas.style.backgroundSize = `${Math.max(4, 22 * viewport.z)}px ${Math.max(4, 22 * viewport.z)}px`;
  elements.zoomLabel.textContent = `${Math.round(viewport.z * 100)}%`;
  writeHashState();
}

function centeredViewportForTable(tableName) {
  const node = layout?.nodes.get(tableName);
  if (!node || isTableHidden(tableName)) return;

  const rect = elements.canvas.getBoundingClientRect();
  return {
    ...viewport,
    x: Math.round(rect.width / 2 - (node.x + node.width / 2) * viewport.z),
    y: Math.round(rect.height / 2 - (node.y + node.height / 2) * viewport.z),
  };
}

function fitView() {
  cancelViewportAnimation();
  if (!layout || visibleTables().length === 0) return;
  const bounds = visibleLayoutBounds();
  const rect = elements.canvas.getBoundingClientRect();
  const scale = clamp(
    Math.min(
      (rect.width - FIT_PADDING) / Math.max(bounds.width, 1),
      (rect.height - FIT_PADDING) / Math.max(bounds.height, 1),
    ),
    MIN_ZOOM,
    1.2,
  );
  viewport = {
    z: scale,
    x: Math.round((rect.width - bounds.width * scale) / 2 - bounds.x * scale),
    y: Math.round((rect.height - bounds.height * scale) / 2 - bounds.y * scale),
  };
  applyTransform();
}

function renderAll(options = {}) {
  layout = computeLayout(schema);
  applyManualNodePositions();
  elements.emptyState.textContent =
    schema.tables.length === 0 ? "No TailorDB types found." : "No visible tables.";
  elements.emptyState.hidden = visibleTables().length > 0;
  renderHeader();
  renderTableList();
  renderShowModeControls();
  renderEdges();
  renderNodes();
  renderDetails();
  if (options.fit) {
    fitView();
    return;
  }
  if (options.center && selectedTable) {
    const nextViewport = centeredViewportForTable(selectedTable);
    if (nextViewport) {
      if (options.smooth) {
        animateViewportTo(nextViewport);
      } else {
        cancelViewportAnimation();
        viewport = nextViewport;
        applyTransform();
      }
      return;
    }
  }
  applyTransform();
}

function selectTable(tableName, options = {}) {
  if (!tableName) return;
  if (selectedTable === tableName) {
    selectedTable = undefined;
    renderAll({ center: false });
    return;
  }

  selectedTable = tableName;
  renderAll({ center: options.center !== false, smooth: options.smooth !== false });
}

function clearTableSelection() {
  if (!selectedTable) return;
  selectedTable = undefined;
  renderAll({ center: false });
}

function zoomAt(nextZoom, clientX, clientY) {
  cancelViewportAnimation();
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
  cancelViewportAnimation();
  viewport = {
    ...viewport,
    x: viewport.x - deltaX,
    y: viewport.y - deltaY,
  };
  applyTransform();
}

function startCanvasPan(event) {
  if (event.button !== 0 || event.target.closest("button, input, .canvas-toolbar")) return;
  cancelViewportAnimation();

  activeCanvasPan = {
    moved: false,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: viewport.x,
    startY: viewport.y,
  };
  elements.canvas.setPointerCapture(event.pointerId);
}

function moveCanvasPan(event) {
  if (!activeCanvasPan || activeCanvasPan.pointerId !== event.pointerId) return;
  if ((event.buttons & 1) === 0) {
    finishCanvasPan(event);
    return;
  }

  const deltaX = event.clientX - activeCanvasPan.startClientX;
  const deltaY = event.clientY - activeCanvasPan.startClientY;
  if (!activeCanvasPan.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

  event.preventDefault();
  activeCanvasPan.moved = true;
  elements.canvas.classList.add("is-panning");
  viewport = {
    ...viewport,
    x: activeCanvasPan.startX + deltaX,
    y: activeCanvasPan.startY + deltaY,
  };
  applyTransform();
}

function finishCanvasPan(event) {
  if (!activeCanvasPan || activeCanvasPan.pointerId !== event.pointerId) return;

  if (elements.canvas.hasPointerCapture(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
  if (activeCanvasPan.moved) {
    event.preventDefault();
    suppressNextCanvasClick = true;
  }
  activeCanvasPan = undefined;
  elements.canvas.classList.remove("is-panning");
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
  elements.showAllTables.addEventListener("click", () => {
    setAllTableVisibility(false);
  });
  elements.hideAllTables.addEventListener("click", () => {
    setAllTableVisibility(true);
  });
  elements.showMode.addEventListener("click", () => {
    setShowModeMenuOpen(elements.showModeMenu.hidden);
  });
  elements.copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showStatus("Link copied");
    } catch {
      showStatus("Copy failed", true);
    }
  });

  elements.canvas.addEventListener("click", (event) => {
    if (suppressNextCanvasClick) {
      suppressNextCanvasClick = false;
      return;
    }
    if (event.target.closest("button, input, .canvas-toolbar")) return;
    clearTableSelection();
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

      // Touchpads report horizontal swipes via deltaX without a modifier key.
      panBy(event.deltaX, event.deltaY);
    },
    { passive: false },
  );
  elements.canvas.addEventListener("pointerdown", startCanvasPan);
  elements.canvas.addEventListener("pointermove", moveCanvasPan);
  elements.canvas.addEventListener("pointerup", finishCanvasPan);
  elements.canvas.addEventListener("pointercancel", finishCanvasPan);
  elements.canvas.addEventListener("lostpointercapture", finishCanvasPan);

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".show-mode-control")) {
      setShowModeMenuOpen(false);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setShowModeMenuOpen(false);
  });
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
          selectedTable = undefined;
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
    if (selectedTable && !tableByName(selectedTable)) {
      selectedTable = undefined;
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
