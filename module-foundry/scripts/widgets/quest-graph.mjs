// import { CampaignCodexWidget } from "./CampaignCodexWidget.js";

/**
 * QuestGraphWidget
 *
 * An infinite-canvas, auto-arranging graph of every Campaign Codex quest in the
 * world. Built on the bundled vis-network library (same as NetworkGraphWidget)
 * so it looks and feels consistent with the existing graph widgets.
 *
 * Features:
 *  - Auto-populates all quest journals (flags.campaign-codex.type === "quest").
 *  - Edges are derived from each quest's `unlocks` / `dependencies` chains and
 *    from `relatedUuids` (for non-quest entities dropped onto the canvas).
 *  - Drawing an edge writes the link back to BOTH quest documents:
 *      parent.unlocks   += childRefKey   (parent "Unlocks" child)
 *      child.dependencies += parentRefKey (child "Depends On" parent)
 *  - Per-node styling (shape / size / colour / category preset).
 *  - Per-edge styling (connection type -> colour + dashed pattern).
 *  - Drag other Campaign Codex / Foundry documents onto the canvas to link them.
 *  - Node positions, styles and edge styling are saved automatically to the host
 *    journal flags so the layout is identical the next time the graph is opened.
 *
 * All persisted state lives under the standard widget flag path
 * (data.widgets.questgraph.<widgetId>) via getData()/saveData().
 */
export function createQuestGraphWidget(CampaignCodexWidget) {
return class QuestGraphWidget extends CampaignCodexWidget {
    constructor(widgetId, initialData, document) {
        super(widgetId, initialData, document);
        this.network = null;
        this._saveTimer = null;
        this._state = null;          // cached saved state
        this._gridSize = 40;         // grid snap size in canvas units
        this._selectedNodeId = null;
        this._selectedNodeIds = [];   // full multi-selection (box-select / group ops)
        this._selectionBounds = null; // world-coord bbox of the current multi-selection
        this._selectedEdgeId = null;
        this._rootEl = null;
        this._boundDrop = null;
        this._boundDragOver = null;
        this._statusByUuid = new Map(); // uuid -> statusClass (rebuilt each build)
        this._history = [];            // undo/redo stack of {state, links, statuses}
        this._historyIndex = -1;       // pointer into _history for the live state
        this._historyLimit = 60;
        this._restoringHistory = false;
        this._historyBusy = false;     // guard: serialize undo/redo operations
        this._escHandler = null;       // Escape key handler while draw-link is active
    }

    /* -------------------------------------------- */
    /*  Static style dictionaries                   */
    /* -------------------------------------------- */

    // Quest status -> colour. The status lives on the quest node (success /
    // failure / inactive) and drives BOTH the node outline AND the colour of the
    // links flowing out of it to its children.
    static STATUS_COLORS = {
        completed: "#3d8f5b", // success -> green (gold is reserved for main quests)
        failed:    "#e0503a", // failure -> red
        inactive:  "#6b6b6b", // greyed out
        active:    "#7d7a70", // neutral
    };

    // Selectable node statuses shown in the node panel (quest nodes only).
    static STATUS_OPTIONS = [
        { value: "active",   label: "Active" },
        { value: "success",  label: "Success" },
        { value: "failure",  label: "Failure" },
        { value: "inactive", label: "Inactive" },
    ];

    // HTML inserted into an encounter quest's description when the node is
    // categorised as "Encounter". Wrapped in a marker comment so it is only
    // ever inserted once per quest.
    static ENCOUNTER_TEMPLATE = `<!-- cc-encounter-template -->
<div style="display:grid; grid-template-columns: 2fr 1fr; gap:2rem; align-items:start;">
    <div>
        <h4 style="text-align:center;">Encounter Type</h4>
        <hr style="border-color:#0000003b">
        <p><em>Encounter type</em></p>

        <h4 style="text-align:center;">Description</h4>
        <hr style="border-color:#0000003b">
        <p><em>Description</em></p>

        <h4 style="text-align:center;">Goal</h4>
        <hr style="border-color:#0000003b">
        <p><em>Goal</em></p>

        <h4 style="text-align:center;">Resolution/Consequences</h4>
        <hr style="border-color:#0000003b">
        <p><em>Resolution/Consequences</em></p>

        <h4 style="text-align:center;">Rewards</h4>
        <hr style="border-color:#0000003b">
        <p><em>Rewards</em></p>

        <h4 style="text-align:center;">Failure/Ways out</h4>
        <hr style="border-color:#0000003b">
        <p><em>Failure/Ways out</em></p>
    </div>

    <div style="display:flex; flex-direction:column; gap:1rem;">
        <div style="padding:1rem; border-radius:5px; border:1px solid #E8D3B5;">
            <h4><strong>Environment</strong></h4>
            <p><em>Environment details</em></p>
        </div>

        <div style="padding:1rem; border-radius:5px; border:1px solid #E8D3B5;">
            <h4><strong>Environmental effects</strong></h4>
            <p><em>Environmental effects</em></p>
        </div>

        <div style="padding:1rem; border-radius:5px; border:1px solid #E8D3B5;">
            <h4><strong>Obstacles/Angles of approach</strong></h4>
            <p><em>Obstacles or approach angles</em></p>
        </div>
    </div>
</div>
<!-- /cc-encounter-template -->`;

    static ENCOUNTER_MARKER_START = "<!-- cc-encounter-template -->";
    static ENCOUNTER_MARKER_END = "<!-- /cc-encounter-template -->";

    static CATEGORY_PRESETS = {
        main:      { label: "Main Quest", shape: "square",  size: 26, color: "#d4af37" },
        side:      { label: "Side Quest", shape: "diamond", size: 22, color: "#5b8fb9" },
        encounter: { label: "Encounter",  shape: "hexagon", size: 22, color: "#c0392b" },
        default:   { label: "Quest",      shape: "square",  size: 22, color: "#b9a987" },
        entity:    { label: "Entity",     shape: "dot",     size: 18, color: "#7d8a99" },
    };

    // Layout priority: lower number = higher priority (placed first, kept on the
    // parent's row). main > side > encounter; plain quests sit with side, entities last.
    static CATEGORY_PRIORITY = { main: 0, default: 1, side: 2, encounter: 3, entity: 4 };

    static SHAPES = ["dot", "square", "diamond", "hexagon", "triangle", "star"];

    // Panel sentinel: a control shows this when the multi-selection holds mixed
    // values. Choosing it never happens via a real change event, and any patch
    // carrying it is ignored, so "untouched = don't alter" holds.
    static VARIOUS = "__various__";

    /* -------------------------------------------- */
    /*  Persistence helpers                         */
    /* -------------------------------------------- */

    _defaultState() {
        return {
            positions: {},     // uuid -> {x, y}
            nodeStyles: {},    // uuid -> {shape, size, color, category}
            edgeStyles: {},    // "from->to" -> {type, color?, dashes?}
            extraEntities: [], // [uuid] of non-quest documents added to the graph
            viewState: null,   // {scale, position:{x,y}}
            arranged: false,   // whether an auto-arrange has ever run
            knownEdges: null,  // baseline of edge keys for incremental reflow
            hideIsolated: false,  // hide quest nodes that have no links
            isolatedExempt: [],   // [uuid] quests dragged back in while hidden
            hiddenNodes: [],      // [uuid] nodes manually hidden via the node panel
            manualPositions: [],  // [uuid] nodes whose position was set by an explicit user action
        };
    }

    async _loadState() {
        const saved = (await this.getData()) || {};
        const state = this._defaultState();

        // Scalars / plain arrays (safe to copy directly — no dotted keys).
        state.arranged = saved.arranged === true;
        state.hideIsolated = saved.hideIsolated === true;
        state.extraEntities = Array.isArray(saved.extraEntities)
            ? saved.extraEntities.filter((u) => typeof u === "string" && u) : [];
        state.isolatedExempt = Array.isArray(saved.isolatedExempt)
            ? saved.isolatedExempt.filter((u) => typeof u === "string" && u) : [];
        state.hiddenNodes = Array.isArray(saved.hiddenNodes)
            ? saved.hiddenNodes.filter((u) => typeof u === "string" && u) : [];
        state.manualPositions = Array.isArray(saved.manualPositions)
            ? saved.manualPositions.filter((u) => typeof u === "string" && u) : [];
        state.knownEdges = Array.isArray(saved.knownEdges) ? saved.knownEdges.slice() : null;

        // Camera: per-user, read from localStorage. Fall back to a snapshot
        // persisted in the flags by older versions (one-time migration).
        state.viewState = this._loadViewFromClient();
        if (!state.viewState) {
            const vs = saved.viewState;
            state.viewState = (vs && Number.isFinite(vs.scale) && vs.scale > 0
                && vs.position && Number.isFinite(vs.position.x) && Number.isFinite(vs.position.y))
                ? { scale: vs.scale, position: { x: vs.position.x, y: vs.position.y } }
                : null;
        }

        // Keyed maps. ROOT-CAUSE NOTE: these are persisted as [key, value]
        // ENTRY ARRAYS because the keys are document uuids containing dots
        // ("JournalEntry.abc") and Foundry's update pipeline expands dotted
        // keys into nested objects on save. That expansion shattered positions
        // into {JournalEntry: {abc: {...}}} on every save; every load then
        // found NO positions, re-placed every node as "new" (growing an
        // endless y=0 row) and re-saved — which also invalidated the saved
        // camera each session. _decodeMap reads the new array format AND
        // recovers maps already shattered by older saves.
        state.positions = this._decodeMap(saved.positions,
            (v) => Number.isFinite(Number(v?.x)) && Number.isFinite(Number(v?.y)));
        state.nodeStyles = this._decodeMap(saved.nodeStyles,
            (v) => v && typeof v === "object" && !Array.isArray(v)
                && ("shape" in v || "size" in v || "color" in v || "category" in v));
        // Edge keys ("a->b") shatter unrecoverably; purely cosmetic, so legacy
        // objects are simply dropped and only the array format is read.
        state.edgeStyles = Array.isArray(saved.edgeStyles)
            ? Object.fromEntries(saved.edgeStyles.filter((e) => Array.isArray(e) && typeof e[0] === "string" && e[0]))
            : {};

        // Final position sanity pass (non-finite coords render invisibly and
        // poison the fit/visibility bounding box).
        for (const [key, p] of Object.entries(state.positions)) {
            const x = Number(p?.x), y = Number(p?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) delete state.positions[key];
            else state.positions[key] = { x, y };
        }

        this._state = state;
        return state;
    }

    /**
     * Decode a persisted keyed map.
     *  - New format: array of [key, value] entries (round-trips dotted keys).
     *  - Legacy format: an object whose dotted keys Foundry expanded into
     *    nested objects — walk it and stitch the key paths back together.
     *    `isLeaf` identifies a genuine value object so the walk knows where a
     *    key path ends.
     */
    _decodeMap(raw, isLeaf) {
        if (Array.isArray(raw)) {
            return Object.fromEntries(raw.filter((e) => Array.isArray(e) && typeof e[0] === "string" && e[0]));
        }
        const out = {};
        const walk = (obj, path, depth) => {
            if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 12) return;
            if (path && isLeaf(obj)) { out[path] = obj; return; }
            for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k, depth + 1);
        };
        if (raw && typeof raw === "object") walk(raw, "", 0);
        return out;
    }

    /** Persistable snapshot of the state: keyed maps become entry arrays so
     *  uuid keys containing dots survive Foundry's dotted-key expansion. */
    _encodeState(state) {
        const snap = foundry.utils.deepClone(state);
        snap.positions = Object.entries(snap.positions || {});
        snap.nodeStyles = Object.entries(snap.nodeStyles || {});
        snap.edgeStyles = Object.entries(snap.edgeStyles || {});
        // The camera is per-user and lives in localStorage (_saveViewToClient):
        // writing it to the document made Campaign Codex re-render the whole
        // sheet after every zoom/pan (its own update hook ignores render:false),
        // which rebuilt the widget and reset the camera.
        delete snap.viewState;
        return snap;
    }

    /* -------------------------------------------- */
    /*  Per-user camera storage (client-side)       */
    /* -------------------------------------------- */

    _viewStorageKey() {
        return `campaign-codex.questgraph.view:${game.world?.id ?? "world"}:${this.document?.uuid ?? "doc"}:${this.widgetId}`;
    }

    _saveViewToClient(viewState) {
        try { localStorage.setItem(this._viewStorageKey(), JSON.stringify(viewState)); }
        catch (e) { /* storage full/blocked — worst case the camera isn't remembered */ }
    }

    _loadViewFromClient() {
        try {
            const raw = localStorage.getItem(this._viewStorageKey());
            if (!raw) return null;
            const vs = JSON.parse(raw);
            return (vs && Number.isFinite(vs.scale) && vs.scale > 0
                && vs.position && Number.isFinite(vs.position.x) && Number.isFinite(vs.position.y))
                ? { scale: vs.scale, position: { x: vs.position.x, y: vs.position.y } }
                : null;
        } catch (e) { return null; }
    }

    async _persistState() {
        if (!this.isGM) return;
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            try {
                await this.saveData(this._encodeState(this._state));
            } catch (err) {
                console.error("Campaign Codex | QuestGraph save failed:", err);
            }
        }, 250);
    }

    /** Flush state to the document immediately (awaitable). Used for discrete
     *  edits (style/link/position) so a subsequent re-render reads fresh data
     *  and never reverts the change. */
    async _persistNow() {
        if (!this.isGM) return;
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        try {
            await this.saveData(this._encodeState(this._state));
            this._recordHistory();
        } catch (err) {
            console.error("Campaign Codex | QuestGraph save failed:", err);
        }
    }

    /**
     * Persist widget state WITHOUT re-rendering the sheet. The base class saves
     * via setFlag, and every flag write makes Foundry re-render the whole
     * journal sheet — which rebuilt this widget (toolbar flicker) and restored
     * the last SAVED camera, resetting an in-progress zoom/search focus. Our
     * saves are camera/positions/styles only; the in-memory state is already
     * authoritative, so nothing needs re-rendering. Same flag path as the base
     * class (see ownPrefix in _installReactiveHook).
     */
    async saveData(data) {
        if (!this.document) return super.saveData(data);
        await this.document.update(
            { [`flags.campaign-codex.data.widgets.questgraph.${this.widgetId}`]: data },
            { render: false },
        );
    }

    _snap(value) {
        const g = this._gridSize;
        return Math.round(value / g) * g;
    }

    /** Resolve a node's display image (Campaign Codex custom image, else the
     *  document thumbnail / img). Returns null when there is none. */
    _imageFor(doc) {
        try {
            const custom = doc?.getFlag?.("campaign-codex", "image");
            if (custom && String(custom).trim()) return String(custom).trim();
        } catch (e) { /* ignore */ }
        const thumb = String(doc?.thumbnail || "").trim();
        if (thumb) return thumb;
        const img = String(doc?.img || "").trim();
        if (img) return img;
        return null;
    }

    /** Layout priority for a node (lower = higher priority / kept near parent). */
    _priorityOf(uuid, isQuest) {
        const cat = this._categoryFor(uuid, isQuest);
        const p = QuestGraphWidget.CATEGORY_PRIORITY[cat];
        return Number.isFinite(p) ? p : 2;
    }

    /* -------------------------------------------- */
    /*  Quest / entity scanning                     */
    /* -------------------------------------------- */

    _getQuestRecord(doc) {
        const data = doc.getFlag("campaign-codex", "data") || {};
        const quest = Array.isArray(data.quests) && data.quests.length > 0 ? data.quests[0] : null;
        return quest;
    }

    _statusClass(quest) {
        if (!quest) return "active";
        if (quest.failed) return "failed";
        if (quest.completed) return "completed";
        if (quest.inactive) return "inactive";
        return "active";
    }

    /** All quest journals visible to the current user. */
    _scanQuests() {
        const hideByPermission = game.settings.get("campaign-codex", "hideByPermission");
        const out = [];
        for (const doc of game.journal.filter((j) => j.getFlag("campaign-codex", "type") === "quest")) {
            const canView = doc.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
            if (hideByPermission && !this.isGM && !canView) continue;
            const quest = this._getQuestRecord(doc);
            if (!quest?.id) continue;
            out.push({
                uuid: doc.uuid,
                name: doc.name,
                questId: quest.id,
                quest,
                statusClass: this._statusClass(quest),
                img: this._imageFor(doc),
            });
        }
        return out;
    }

    /* -------------------------------------------- */
    /*  Graph data construction                     */
    /* -------------------------------------------- */

    _categoryFor(uuid, isQuest) {
        const style = this._state.nodeStyles[uuid];
        if (style?.category) return style.category;
        return isQuest ? "default" : "entity";
    }

    _resolveNodeStyle(uuid, isQuest) {
        const preset = QuestGraphWidget.CATEGORY_PRESETS[this._categoryFor(uuid, isQuest)]
            || QuestGraphWidget.CATEGORY_PRESETS.default;
        const override = this._state.nodeStyles[uuid] || {};
        const shape = QuestGraphWidget.SHAPES.includes(override.shape) ? override.shape : preset.shape;
        const size = Number.isFinite(Number(override.size)) ? Number(override.size) : preset.size;
        const color = typeof override.color === "string" && override.color ? override.color : preset.color;
        return { shape, size, color };
    }

    _statusBorder(statusClass, fallback) {
        switch (statusClass) {
            case "completed": return "#3d8f5b"; // success -> green outline
            case "failed": return "#e0503a";    // failure -> red outline
            case "inactive": return "#6b6b6b";  // greyed out
            default: return fallback;
        }
    }

    /** Status colour used for a node's outgoing links (success/failure cascade). */
    _statusColor(statusClass) {
        return QuestGraphWidget.STATUS_COLORS[statusClass] || QuestGraphWidget.STATUS_COLORS.active;
    }

    /* -------------------------------------------- */
    /*  Custom node rendering (shape-clipped images)*/
    /* -------------------------------------------- */

    /** Lazy-loaded, cached HTMLImageElement; redraws the graph once it loads. */
    _getImage(url) {
        if (!url) return null;
        if (!this._imgCache) this._imgCache = new Map();
        let img = this._imgCache.get(url);
        if (!img) {
            img = new Image();
            img.onload = () => { try { this.network?.redraw(); } catch (e) { /* ignore */ } };
            img.onerror = () => { img._failed = true; };
            try { img.src = url; } catch (e) { img._failed = true; }
            this._imgCache.set(url, img);
        }
        return img;
    }

    /** Trace the node's polygon/circle path on the context (centred at x,y). */
    _shapePath(ctx, x, y, r, shape) {
        ctx.beginPath();
        const poly = (pts) => {
            pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            ctx.closePath();
        };
        const reg = (sides, rot) => {
            const pts = [];
            for (let i = 0; i < sides; i++) {
                const a = rot + (i * 2 * Math.PI) / sides;
                pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
            }
            poly(pts);
        };
        switch (shape) {
            case "square":
            case "box":
                ctx.rect(x - r, y - r, r * 2, r * 2);
                break;
            case "diamond":
                poly([[x, y - r], [x + r, y], [x, y + r], [x - r, y]]);
                break;
            case "hexagon":
                reg(6, -Math.PI / 2);
                break;
            case "triangle":
                poly([[x, y - r], [x + r * 0.95, y + r * 0.7], [x - r * 0.95, y + r * 0.7]]);
                break;
            case "star": {
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const rad = i % 2 === 0 ? r : r * 0.45;
                    const a = -Math.PI / 2 + (i * Math.PI) / 5;
                    pts.push([x + rad * Math.cos(a), y + rad * Math.sin(a)]);
                }
                poly(pts);
                break;
            }
            case "dot":
            case "circle":
            default:
                ctx.arc(x, y, r, 0, 2 * Math.PI);
                break;
        }
    }

    /** Draw an image "cover"-fitted into the box, already clipped by the caller. */
    _drawCoverImage(ctx, img, x, y, r) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) return;
        const box = r * 2;
        const scale = Math.max(box / iw, box / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
    }

    /**
     * Build a vis-network custom-shape renderer for one node. Clips the image to
     * the actual shape geometry, fills with the background colour otherwise, and
     * draws a border that only THICKENS on hover/selection (never recolours) so
     * there is no blue fill or orange highlight.
     */
    _makeNodeRenderer(meta) {
        const self = this;
        return ({ ctx, x, y, state }) => ({
            drawNode() { self._paintNode(ctx, x, y, meta, state || {}); },
            nodeDimensions: { width: meta.size * 2, height: meta.size * 2 },
        });
    }

    _paintNode(ctx, x, y, meta, state) {
        const r = meta.size;
        const trace = () => this._shapePath(ctx, x, y, r, meta.shape);

        ctx.save();
        // Background fill.
        trace();
        ctx.fillStyle = meta.background;
        ctx.fill();

        // Shape-clipped image.
        const img = this._getImage(meta.image);
        if (img && img.complete && !img._failed && (img.naturalWidth || img.width)) {
            ctx.save();
            trace();
            ctx.clip();
            this._drawCoverImage(ctx, img, x, y, r);
            ctx.restore();
        }

        // Border: thicker (not recoloured) on hover/selection.
        const thicken = (state.selected || state.hover) ? 3 : 0;
        trace();
        ctx.lineWidth = meta.borderWidth + thicken;
        ctx.strokeStyle = meta.border;
        ctx.setLineDash(meta.dashes ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Label below the node (drawn here since custom shapes own their label).
        if (meta.label) {
            ctx.save();
            ctx.font = "14px Signika, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const ly = y + r + 4;
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.strokeText(meta.label, x, ly);
            ctx.fillStyle = meta.fontColor || "#000000";
            ctx.fillText(meta.label, x, ly);
            ctx.restore();
        }
    }

    /** Apply the shape-clipped custom renderer + colours to a node descriptor. */
    _applyRenderer(node, meta) {
        node.shape = "custom";
        node.ctxRenderer = this._makeNodeRenderer(meta);
        node.ccShape = meta.shape;
    }

    /** Resolved render metadata for a quest, honouring status (inc. desaturated inactive). */
    _questMeta(uuid, name, statusClass, imgUrl) {
        const style = this._resolveNodeStyle(uuid, true);
        const inactive = statusClass === "inactive";
        let background, border, fontColor;
        if (inactive) {
            // Halfway-desaturated version of the node's own colour scheme so the
            // intended colour is still recognisable while clearly muted.
            background = this._desaturate(style.color, 0.5);
            border = this._desaturate(this._darken(style.color), 0.5);
            fontColor = "#555555";
        } else {
            background = style.color;
            border = this._statusBorder(statusClass, this._darken(style.color));
            fontColor = "#000000";
        }
        return {
            shape: style.shape,
            size: style.size,
            background,
            border,
            fontColor,
            image: imgUrl || null,
            borderWidth: statusClass === "active" ? 2 : (inactive ? 2 : 3),
            dashes: inactive,
            label: name,
        };
    }

    /** Resolved render metadata for a non-quest entity node. */
    _entityMeta(uuid, label, resolved) {
        const style = this._resolveNodeStyle(uuid, false);
        return {
            shape: style.shape,
            size: style.size,
            background: style.color,
            border: this._darken(style.color),
            fontColor: "#000000",
            image: this._imageFor(resolved),
            borderWidth: 2,
            dashes: false,
            label,
        };
    }

    _createQuestNode(rec) {
        const pos = this._state.positions[rec.uuid];
        const meta = this._questMeta(rec.uuid, rec.name, rec.statusClass, rec.img);
        const node = {
            id: rec.uuid,
            label: rec.name,
            size: meta.size,
            ccKind: "quest",
        };
        this._applyRenderer(node, meta);
        this._nodeSizes?.set(rec.uuid, meta.size);
        if (pos) { node.x = pos.x; node.y = pos.y; }
        return node;
    }

    async _createEntityNode(uuid) {
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) return null;
        const resolved = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
        const canView = resolved.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) ?? true;
        const hideByPermission = game.settings.get("campaign-codex", "hideByPermission");
        if (hideByPermission && !this.isGM && !canView) return null;
        const pos = this._state.positions[uuid];
        const meta = this._entityMeta(uuid, resolved.name, resolved);
        const node = {
            id: uuid,
            label: resolved.name,
            size: meta.size,
            ccKind: "entity",
        };
        this._applyRenderer(node, meta);
        this._nodeSizes?.set(uuid, meta.size);
        if (pos) { node.x = pos.x; node.y = pos.y; }
        return node;
    }

    _darken(hex) {
        try {
            const c = hex.replace("#", "");
            const num = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16);
            const r = Math.max(0, ((num >> 16) & 255) - 50);
            const g = Math.max(0, ((num >> 8) & 255) - 50);
            const b = Math.max(0, (num & 255) - 50);
            return `rgb(${r}, ${g}, ${b})`;
        } catch (e) { return "#444444"; }
    }

    /** Parse a #hex or rgb(...) colour to {r,g,b}. */
    _rgb(color) {
        if (typeof color === "string" && color.startsWith("#")) {
            const c = color.slice(1);
            const h = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
            const n = parseInt(h, 16);
            return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        }
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || "");
        if (m) return { r: +m[1], g: +m[2], b: +m[3] };
        return { r: 120, g: 120, b: 120 };
    }

    /** Mix a colour toward its grey luminance by `amount` (0 = none, 1 = full grey). */
    _desaturate(color, amount = 0.5) {
        const { r, g, b } = this._rgb(color);
        const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const mix = (v) => Math.round(v + (grey - v) * amount);
        return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    }

    /**
     * Derive an edge's colour/dashes purely from quest STATUS:
     *  - parent (from) succeeded  -> gold link
     *  - parent failed            -> red dashed link
     *  - either endpoint inactive -> grey dashed link (greyed out)
     *  - entity (related) link     -> muted purple dashed link
     *  - otherwise (active)        -> neutral link
     */
    _edgeVisualFor(fromUuid, toUuid, isRelated) {
        const fromStatus = this._statusByUuid.get(fromUuid) || "active";
        const toStatus = this._statusByUuid.get(toUuid) || "active";

        // The colour/dashes the link would have ignoring inactivity.
        let base;
        if (isRelated) base = { color: "#9a8fb0", dashes: [2, 4] };
        else if (fromStatus === "completed") base = { color: this._statusColor("completed"), dashes: false };
        else if (fromStatus === "failed") base = { color: this._statusColor("failed"), dashes: [8, 6] };
        else base = { color: this._statusColor("active"), dashes: false };

        // Inactive on either end: keep the intended hue but halfway-desaturated
        // and always dashed so it still reads as muted.
        if (fromStatus === "inactive" || toStatus === "inactive") {
            return { color: this._desaturate(base.color, 0.5), dashes: base.dashes || [4, 4] };
        }
        return base;
    }

    _makeEdge(fromUuid, toUuid, isRelated = false) {
        const v = this._edgeVisualFor(fromUuid, toUuid, isRelated);
        return {
            id: `${fromUuid}->${toUuid}`,
            from: fromUuid,
            to: toUuid,
            ccRelated: !!isRelated,
            // Hover/selection keeps the same colour and only thickens the line.
            color: { color: v.color, highlight: v.color, hover: v.color },
            dashes: v.dashes,
            arrows: { to: { enabled: true, scaleFactor: 0.8 } },
            smooth: { type: "cubicBezier", roundness: 0.4 },
            width: 2,
        };
    }

    /**
     * Build the full {nodes, edges} dataset from quests + extra entities.
     */
    async _buildGraphData() {
        const quests = this._scanQuests();
        const questByUuid = new Map(quests.map((q) => [q.uuid, q]));
        const refKeyToUuid = new Map(quests.map((q) => [`${q.uuid}::${q.questId}`, q.uuid]));

        // Status map drives node outlines and link colours (success/failure cascade).
        this._statusByUuid = new Map(quests.map((q) => [q.uuid, q.statusClass]));

        // Radius (size) per node, so we can compute fit ourselves from known
        // geometry instead of relying on vis-network's internal bounding boxes
        // (which are only valid for custom shapes AFTER a real draw).
        this._nodeSizes = new Map();

        // Remember which nodes already had a saved position BEFORE this build so
        // the incremental reflow can tell genuinely-new nodes from existing ones.
        const preExisting = new Set(Object.keys(this._state.positions));

        const nodes = [];
        const nodeIds = new Set();

        for (const rec of quests) {
            nodes.push(this._createQuestNode(rec));
            nodeIds.add(rec.uuid);
        }

        // Extra (non-quest) entities the GM dragged in
        for (const uuid of this._state.extraEntities) {
            if (nodeIds.has(uuid)) continue;
            const node = await this._createEntityNode(uuid);
            if (node) { nodes.push(node); nodeIds.add(uuid); }
        }

        // Edges: quest -> quest from unlocks/dependencies (deduped, directed parent->child)
        const edgeMap = new Map();
        const addEdge = (from, to, isRelated) => {
            if (!from || !to || from === to) return;
            if (!nodeIds.has(from) || !nodeIds.has(to)) return;
            const key = `${from}->${to}`;
            if (!edgeMap.has(key)) edgeMap.set(key, this._makeEdge(from, to, isRelated));
        };

        for (const rec of quests) {
            const q = rec.quest;
            // This quest unlocks X  => edge thisQuest -> X
            for (const ref of (Array.isArray(q.unlocks) ? q.unlocks : [])) {
                const targetUuid = refKeyToUuid.get(ref) || (ref.includes("::") ? ref.split("::")[0] : ref);
                addEdge(rec.uuid, targetUuid, false);
            }
            // This quest depends on Y => edge Y -> thisQuest
            for (const ref of (Array.isArray(q.dependencies) ? q.dependencies : [])) {
                const sourceUuid = refKeyToUuid.get(ref) || (ref.includes("::") ? ref.split("::")[0] : ref);
                addEdge(sourceUuid, rec.uuid, false);
            }
            // Related entities (only drawn if the target node exists on the canvas)
            for (const uuid of (Array.isArray(q.relatedUuids) ? q.relatedUuids : [])) {
                if (nodeIds.has(uuid)) addEdge(rec.uuid, uuid, true);
            }
        }

        const edgeList = Array.from(edgeMap.values());

        // Guarantee every node has an explicit grid position. vis-network must
        // NEVER be left to position nodes itself (that produces the gravity
        // "circle" cluster). Saved positions win; anything missing is laid out
        // deterministically by its links and then remembered.
        this._ensurePositions(nodes, edgeList);
        // Re-flow only the nodes touched by NEW links so the hierarchy stays
        // readable, without disturbing everything (unlike Auto-Arrange).
        this._reflowNewConnections(nodes, edgeList, preExisting);

        // Visibility filters run AFTER the position/reflow bookkeeping so
        // hidden nodes keep their saved spot and the knownEdges baseline is
        // built from the full link structure.
        let visibleNodes = nodes;
        let visibleEdges = edgeList;

        // Manually hidden nodes (eye-slash button in the node panel): removed
        // together with their edges. Searching for one brings it back.
        const hiddenSet = new Set(this._state.hiddenNodes);
        if (hiddenSet.size) {
            visibleNodes = visibleNodes.filter((n) => !hiddenSet.has(n.id));
            visibleEdges = visibleEdges.filter((e) => !hiddenSet.has(e.from) && !hiddenSet.has(e.to));
        }

        // Optionally hide isolated quests (no links at all). Quests explicitly
        // dragged back onto the canvas are exempt. "Linked" is judged on the
        // FULL link structure, not the filtered edges — otherwise manually
        // hiding a quest would cascade-hide every neighbour whose only link
        // pointed at it.
        if (this._state.hideIsolated) {
            const linked = new Set();
            for (const e of edgeList) { linked.add(e.from); linked.add(e.to); }
            // A previously-exempt quest that has gained a real link no longer
            // needs its exemption (if it later loses the link it hides again).
            if (this._state.isolatedExempt.length) {
                this._state.isolatedExempt = this._state.isolatedExempt.filter((u) => !linked.has(u));
            }
            const exempt = new Set(this._state.isolatedExempt);
            visibleNodes = visibleNodes.filter((n) => n.ccKind !== "quest" || linked.has(n.id) || exempt.has(n.id));
        }

        return { nodes: visibleNodes, edges: visibleEdges, questByUuid, refKeyToUuid, allNodeIds: nodeIds };
    }

    /**
     * Guarantee every node has an explicit grid position without disturbing
     * nodes the user has already placed. On a brand-new graph the full layered
     * layout runs; otherwise only NEW nodes are positioned next to whatever they
     * connect to (existing nodes stay exactly where they are). vis-network is
     * never left to position nodes itself.
     */
    _ensurePositions(nodes, edges) {
        // Apply known positions first.
        for (const node of nodes) {
            const p = this._state.positions[node.id];
            if (p) { node.x = p.x; node.y = p.y; }
        }

        const missing = nodes.filter((n) => !this._state.positions[n.id]);
        if (!missing.length) return;

        const anyPlaced = Object.keys(this._state.positions).length > 0;
        let seeded = false;

        if (!anyPlaced) {
            // Fresh graph: lay everything out from scratch.
            const layout = this._layeredPositions(nodes, edges);
            for (const node of nodes) {
                const p = layout[node.id] || { x: this._snap(0), y: this._snap(0) };
                this._state.positions[node.id] = p;
                node.x = p.x; node.y = p.y;
            }
            seeded = true;
        } else {
            // Incremental: place only the new nodes near their connections.
            seeded = this._placeNewNodes(nodes, edges);
        }

        if (seeded && this.isGM) this._persistState();
    }

    _buildAdjacency(nodes, edges) {
        const idSet = new Set(nodes.map((n) => n.id));
        const parents = new Map(nodes.map((n) => [n.id, []]));
        const children = new Map(nodes.map((n) => [n.id, []]));
        let hasEdge = false;
        for (const e of edges) {
            if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
            parents.get(e.to).push(e.from);
            children.get(e.from).push(e.to);
            hasEdge = true;
        }
        return { parents, children, hasEdge };
    }

    /**
     * Place each new (unsaved) node next to the nodes it connects to, scanning
     * for a free grid cell so it never lands on top of an existing node. Existing
     * nodes are left untouched. Returns true if any node was placed.
     */
    _placeNewNodes(nodes, edges) {
        const colSpacing = this._gridSize * 5;
        const rowSpacing = this._gridSize * 3;
        const { parents, children } = this._buildAdjacency(nodes, edges);
        const placed = this._state.positions;
        const occupied = new Set(Object.values(placed).map((p) => `${p.x},${p.y}`));

        // Order new nodes so parents are positioned before their children.
        const newNodes = nodes.filter((n) => !placed[n.id]);
        if (!newNodes.length) return false;
        newNodes.sort((a, b) => (parents.get(a.id)?.length || 0) - (parents.get(b.id)?.length || 0));

        for (const node of newNodes) {
            const ps = (parents.get(node.id) || []).map((id) => placed[id]).filter(Boolean);
            const cs = (children.get(node.id) || []).map((id) => placed[id]).filter(Boolean);
            let tx, ty;
            if (ps.length) {
                tx = Math.max(...ps.map((p) => p.x)) + colSpacing;
                ty = ps.reduce((s, p) => s + p.y, 0) / ps.length;
            } else if (cs.length) {
                tx = Math.min(...cs.map((p) => p.x)) - colSpacing;
                ty = cs.reduce((s, p) => s + p.y, 0) / cs.length;
            } else {
                const xs = Object.values(placed).map((p) => p.x);
                tx = (xs.length ? Math.max(...xs) : 0) + colSpacing;
                ty = 0;
            }
            const spot = this._findFreeCell(this._snap(tx), this._snap(ty), occupied, rowSpacing);
            placed[node.id] = spot;
            occupied.add(`${spot.x},${spot.y}`);
            node.x = spot.x; node.y = spot.y;
        }
        return true;
    }

    /** Find the nearest free grid cell to (x, y), scanning vertically. */
    _findFreeCell(x, y, occupied, rowSpacing) {
        if (!occupied.has(`${x},${y}`)) return { x, y };
        for (let d = 1; d < 500; d++) {
            const down = this._snap(y + d * rowSpacing);
            if (!occupied.has(`${x},${down}`)) return { x, y: down };
            const up = this._snap(y - d * rowSpacing);
            if (!occupied.has(`${x},${up}`)) return { x, y: up };
        }
        return { x, y };
    }

    /**
     * Incremental hierarchy refresh. When a refresh discovers NEW links between
     * nodes that already existed, re-place the child end of each new link (and
     * its descendants) to the right of its parent in a free row, so the new
     * connection reflects the hierarchy and doesn't cross over other nodes.
     * Everything that didn't gain a link stays exactly where the user left it.
     * This is deliberately NOT a full re-layout (that is what Auto-Arrange does).
     */
    _reflowNewConnections(nodes, edges, preExisting) {
        const currentKeys = edges.map((e) => e.id);
        const firstTime = !Array.isArray(this._state.knownEdges);
        const known = new Set(firstTime ? [] : this._state.knownEdges);
        this._state.knownEdges = currentKeys;
        if (firstTime) return; // establish a baseline without moving anything

        const newEdges = edges.filter((e) => !known.has(e.id));
        if (!newEdges.length) return;

        const { parents, children } = this._buildAdjacency(nodes, edges);
        const colSpacing = this._gridSize * 5;
        const rowSpacing = this._gridSize * 3;
        const placed = this._state.positions;

        // Dirty = the (already-existing) child end of each new link, plus all of
        // its descendants so a moved node drags its subtree along.
        const dirty = new Set();
        const queue = [];
        for (const e of newEdges) {
            if (preExisting.has(e.to)) { if (!dirty.has(e.to)) { dirty.add(e.to); queue.push(e.to); } }
        }
        while (queue.length) {
            const n = queue.shift();
            for (const c of (children.get(n) || [])) {
                if (!dirty.has(c)) { dirty.add(c); queue.push(c); }
            }
        }
        if (!dirty.size) return;

        // Order dirty nodes parent-before-child via longest-path depth.
        const level = new Map();
        const visiting = new Set();
        const lvlOf = (id) => {
            if (level.has(id)) return level.get(id);
            if (visiting.has(id)) return 0;
            visiting.add(id);
            let l = 0;
            for (const p of (parents.get(id) || [])) l = Math.max(l, lvlOf(p) + 1);
            visiting.delete(id);
            level.set(id, l);
            return l;
        };
        const ordered = [...dirty].sort((a, b) => lvlOf(a) - lvlOf(b));

        // Cells occupied by everything that is NOT being moved.
        const occupied = new Set();
        for (const [id, p] of Object.entries(placed)) {
            if (!dirty.has(id)) occupied.add(`${p.x},${p.y}`);
        }

        for (const id of ordered) {
            const ps = (parents.get(id) || []).map((pid) => placed[pid]).filter(Boolean);
            if (!ps.length) continue; // no positioned parent -> leave it where it is
            const tx = Math.max(...ps.map((p) => p.x)) + colSpacing;
            const ty = ps.reduce((s, p) => s + p.y, 0) / ps.length;
            const spot = this._findFreeCell(this._snap(tx), this._snap(ty), occupied, rowSpacing);
            placed[id] = spot;
            occupied.add(`${spot.x},${spot.y}`);
            const node = nodes.find((n) => n.id === id);
            if (node) { node.x = spot.x; node.y = spot.y; }
        }
        if (this.isGM) this._persistState();
    }

    /**
     * Build parent/child relations and a status map across ALL quests from the
     * authoritative quest documents (used by the status cascade).
     */
    _questRelations() {
        const quests = this._scanQuests();
        const refKeyToUuid = new Map(quests.map((q) => [`${q.uuid}::${q.questId}`, q.uuid]));
        const resolve = (ref) => refKeyToUuid.get(ref) || (ref.includes("::") ? ref.split("::")[0] : ref);
        const childrenOf = new Map();
        const parentsOf = new Map();
        const ensure = (m, k) => { if (!m.has(k)) m.set(k, new Set()); return m.get(k); };
        const isQuest = new Set(quests.map((q) => q.uuid));
        for (const rec of quests) {
            const q = rec.quest;
            for (const ref of (Array.isArray(q.unlocks) ? q.unlocks : [])) {
                const t = resolve(ref);
                if (!isQuest.has(t)) continue;
                ensure(childrenOf, rec.uuid).add(t);
                ensure(parentsOf, t).add(rec.uuid);
            }
            for (const ref of (Array.isArray(q.dependencies) ? q.dependencies : [])) {
                const s = resolve(ref);
                if (!isQuest.has(s)) continue;
                ensure(childrenOf, s).add(rec.uuid);
                ensure(parentsOf, rec.uuid).add(s);
            }
        }
        const statusByUuid = new Map(quests.map((q) => [q.uuid, q.statusClass]));
        return { childrenOf, parentsOf, statusByUuid };
    }

    /**
     * Full deterministic left-to-right layout. Rules:
     *  - Each connected quest chain is laid out on its own horizontal BAND;
     *    bands stack vertically with a blank row between them. Chains never
     *    interleave, which removes most edge crossings.
     *  - Within a band, columns are dependency depth — BUT every node that
     *    feeds children is pulled RIGHT, directly left of its earliest child.
     *    A prerequisite unlocking something deep in the tree therefore sits
     *    one column away from it instead of far away at the root column with
     *    a very long edge.
     *  - Several children stack vertically in the next column; category
     *    priority (main > side > encounter) decides which child keeps the
     *    parent's row; lower-priority siblings are pushed above/below.
     *  - Nodes with no links at all share a single row below the bands.
     * Returns { uuid: {x, y} } snapped to the grid. No physics, ever.
     */
    _layeredPositions(nodes, edges) {
        const colSpacing = this._gridSize * 5;
        const rowSpacing = this._gridSize * 3;
        const ids = nodes.map((n) => n.id);
        const labelMap = new Map(nodes.map((n) => [n.id, n.label || n.id]));
        const questMap = new Map(nodes.map((n) => [n.id, n.ccKind === "quest"]));
        const prio = (id) => this._priorityOf(id, questMap.get(id));
        const label = (id) => String(labelMap.get(id) || id);
        const { parents, children, hasEdge } = this._buildAdjacency(nodes, edges);
        const pos = {};

        // No connections: a clean horizontal row, ordered by priority then name.
        if (!hasEdge) {
            const sorted = [...ids].sort((a, b) => prio(a) - prio(b) || label(a).localeCompare(label(b)));
            sorted.forEach((id, i) => { pos[id] = { x: this._snap(i * colSpacing), y: this._snap(0) }; });
            return pos;
        }

        // Split into weakly-connected components.
        const compOf = new Map();
        const comps = [];
        for (const id of ids) {
            if (compOf.has(id)) continue;
            const comp = [];
            const stack = [id];
            compOf.set(id, comps.length);
            while (stack.length) {
                const n = stack.pop();
                comp.push(n);
                for (const m of [...(parents.get(n) || []), ...(children.get(n) || [])]) {
                    if (!compOf.has(m)) { compOf.set(m, comps.length); stack.push(m); }
                }
            }
            comps.push(comp);
        }

        // Multi-node components become bands (largest first, then by name for
        // a stable order); isolated nodes share one row below all the bands.
        const bands = comps.filter((c) => c.length > 1)
            .sort((a, b) => b.length - a.length || label(a[0]).localeCompare(label(b[0])));
        const singles = comps.filter((c) => c.length === 1).map((c) => c[0])
            .sort((a, b) => prio(a) - prio(b) || label(a).localeCompare(label(b)));

        let bandTop = 0;
        for (const comp of bands) {
            const placed = this._layoutComponent(comp, parents, children, prio, label);
            let maxRow = 0;
            for (const [id, rc] of placed) {
                pos[id] = { x: this._snap(rc.col * colSpacing), y: this._snap((bandTop + rc.row) * rowSpacing) };
                maxRow = Math.max(maxRow, rc.row);
            }
            bandTop += maxRow + 2; // one blank row between bands
        }
        singles.forEach((id, i) => {
            pos[id] = { x: this._snap(i * colSpacing), y: this._snap(bandTop * rowSpacing) };
        });
        return pos;
    }

    /**
     * Lay out ONE connected component. Returns Map(id -> {col, row}) with rows
     * and columns normalised to start at 0.
     */
    _layoutComponent(compIds, parents, children, prio, label) {
        const inComp = new Set(compIds);
        const parentsIn = (id) => (parents.get(id) || []).filter((p) => inComp.has(p));
        const childrenIn = (id) => (children.get(id) || []).filter((c) => inComp.has(c));

        // ASAP column = longest path from the component's roots (cycle-guarded).
        const level = new Map();
        const visiting = new Set();
        const lvlOf = (id) => {
            if (level.has(id)) return level.get(id);
            if (visiting.has(id)) return 0;
            visiting.add(id);
            let l = 0;
            for (const p of parentsIn(id)) l = Math.max(l, lvlOf(p) + 1);
            visiting.delete(id);
            level.set(id, l);
            return l;
        };
        compIds.forEach(lvlOf);

        // Pull-right pass: move every node with children directly left of its
        // earliest child (deepest-child order first so pulls cascade down whole
        // chains). Levels only ever grow and never reach a child's level, so
        // parent-left-of-child always holds. This is what keeps a prerequisite
        // chain NEXT to the deep node it unlocks instead of at the far left.
        const byDepthDesc = [...compIds].sort((a, b) => level.get(b) - level.get(a));
        for (const id of byDepthDesc) {
            const cs = childrenIn(id);
            if (!cs.length) continue;
            const pulled = Math.min(...cs.map((c) => level.get(c))) - 1;
            if (pulled > level.get(id)) level.set(id, pulled);
        }

        const byLevel = new Map();
        for (const id of compIds) {
            const l = level.get(id);
            if (!byLevel.has(l)) byLevel.set(l, []);
            byLevel.get(l).push(id);
        }
        const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);

        const rowOf = new Map();
        const usedRows = new Map(); // level -> Set of taken rows
        const takeRow = (lvl, desired) => {
            if (!usedRows.has(lvl)) usedRows.set(lvl, new Set());
            const used = usedRows.get(lvl);
            let r = Math.round(desired);
            if (!used.has(r)) { used.add(r); return r; }
            for (let d = 1; d < 1000; d++) {
                if (!used.has(r + d)) { used.add(r + d); return r + d; }
                if (!used.has(r - d)) { used.add(r - d); return r - d; }
            }
            used.add(r); return r;
        };

        for (const l of sortedLevels) {
            const group = byLevel.get(l);
            // Preferred row = average of parents' rows (children near parents).
            const pref = new Map();
            for (const id of group) {
                const ps = parentsIn(id).filter((p) => rowOf.has(p));
                pref.set(id, ps.length ? ps.reduce((s, p) => s + rowOf.get(p), 0) / ps.length : null);
            }
            // Sort by preferred row, then priority (main keeps the parent row),
            // then name. Unparented nodes (null pref) sort to the end.
            group.sort((a, b) => {
                const va = pref.get(a) == null ? Number.POSITIVE_INFINITY : pref.get(a);
                const vb = pref.get(b) == null ? Number.POSITIVE_INFINITY : pref.get(b);
                if (va !== vb) return va - vb;
                if (prio(a) !== prio(b)) return prio(a) - prio(b);
                return label(a).localeCompare(label(b));
            });
            let auto = 0;
            for (const id of group) {
                let desired = pref.get(id);
                if (desired == null) desired = auto;
                const r = takeRow(l, desired);
                rowOf.set(id, r);
                auto = Math.max(auto, r + 1);
            }
        }

        // Second pass: parentless nodes were rowed blind (their children had no
        // rows yet). Snap them next to their children so e.g. a standalone
        // prerequisite sits on the same row as the quest it unlocks instead of
        // stranded at the bottom of its column.
        for (const id of compIds) {
            if (parentsIn(id).length) continue;
            const cs = childrenIn(id).filter((c) => rowOf.has(c));
            if (!cs.length) continue;
            const desired = cs.reduce((s, c) => s + rowOf.get(c), 0) / cs.length;
            const l = level.get(id);
            usedRows.get(l)?.delete(rowOf.get(id));
            rowOf.set(id, takeRow(l, desired));
        }

        // Normalise so the band starts at row 0 / column 0.
        let minRow = Infinity, minCol = Infinity;
        for (const id of compIds) {
            minRow = Math.min(minRow, rowOf.get(id));
            minCol = Math.min(minCol, level.get(id));
        }
        if (!Number.isFinite(minRow)) minRow = 0;
        if (!Number.isFinite(minCol)) minCol = 0;
        const out = new Map();
        for (const id of compIds) {
            out.set(id, { col: level.get(id) - minCol, row: rowOf.get(id) - minRow });
        }
        return out;
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    async render() {
        // Only load from disk on a genuine first mount. Re-renders must not
        // clobber in-memory state that may not be flushed yet.
        if (!this._state) await this._loadState();
        const id = this.widgetId;
        const gmControls = this.isGM;

        const shapeOptions = QuestGraphWidget.SHAPES
            .map((s) => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
            .join("");
        const categoryOptions = Object.entries(QuestGraphWidget.CATEGORY_PRESETS)
            .map(([key, v]) => `<option value="${key}">${v.label}</option>`)
            .join("");
        const statusOptions = QuestGraphWidget.STATUS_OPTIONS
            .map((s) => `<option value="${s.value}">${s.label}</option>`)
            .join("");

        return `
        <div id="cc-questgraph-${id}" class="cc-questgraph cc-widget-graph-wrapper" style="border:1px solid var(--cc-border); border-radius:4px; overflow:hidden; aspect-ratio:1; display:flex; flex-direction:column;">

            ${gmControls ? `
            <div class="cc-qg-toolbar" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:6px 8px; background:rgba(0,0,0,0.08); border-bottom:1px solid var(--cc-border); font-size:0.82em;">
                <button type="button" class="cc-qg-btn" data-qg="refresh" title="Re-scan the world for quests"><i class="fas fa-sync-alt"></i></button>
                <button type="button" class="cc-qg-btn" data-qg="undo" title="Undo (Ctrl+Z)" disabled><i class="fas fa-undo"></i></button>
                <button type="button" class="cc-qg-btn" data-qg="redo" title="Redo (Ctrl+Shift+Z)" disabled><i class="fas fa-redo"></i></button>
                <button type="button" class="cc-qg-btn" data-qg="arrange" title="Auto-arrange aligned to the grid"><i class="fas fa-sitemap"></i> Auto-sort</button>
                <button type="button" class="cc-qg-btn" data-qg="fit" title="Fit graph to view"><i class="fas fa-expand"></i> Fit</button>
                <span style="border-left:1px solid var(--cc-border); height:18px; margin:0 2px;"></span>
                <button type="button" class="cc-qg-btn" data-qg="addedge" title="Click then drag from one node to another"><i class="fas fa-link"></i> Link</button>
                <button type="button" class="cc-qg-btn" data-qg="deledge" title="Delete the selected link" disabled><i class="fas fa-unlink"></i> Unlink</button>
                <span style="border-left:1px solid var(--cc-border); height:18px; margin:0 2px;"></span>
                <button type="button" class="cc-qg-btn cc-qg-hideiso" title="Hide quests that have no links. Drag a hidden quest from the sidebar onto the canvas to bring it back."><i class="fas fa-eye-slash"></i> Hide isolated</button>
                <span class="cc-qg-searchwrap" style="position:relative; display:inline-flex; margin-left:auto;">
                    <button type="button" class="cc-qg-btn" data-qg="search" title="Search quests and content"><i class="fas fa-search"></i></button>
                    <div class="cc-qg-searchpop" style="display:none; position:absolute; top:calc(100% + 4px); right:0; z-index:30; flex-direction:column; gap:4px; padding:6px; background:var(--cc-card-bg, var(--cc-main-bg, #f4ecd8)); color:var(--cc-main-text, #191813); border:1px solid var(--cc-border); border-radius:4px; box-shadow:0 2px 8px var(--cc-shadow, rgba(0,0,0,0.35)); min-width:230px;">
                        <input type="text" class="cc-qg-searchinput" placeholder="Search quests..." autocomplete="off" style="width:100%;">
                        <div class="cc-qg-searchresults" style="max-height:180px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;"></div>
                    </div>
                </span>
            </div>` : ""}

            <div class="cc-qg-canvaswrap" style="flex:1; position:relative; background:rgba(255,255,255,0.05);">
                <div class="cc-qg-canvas" id="cc-qg-canvas-${id}" style="position:absolute; inset:0;"></div>

                ${gmControls ? `
                <div class="cc-qg-stylepanel" style="display:none; position:absolute; top:0; left:0; right:0; z-index:5; flex-direction:column; gap:4px; padding:5px 7px; background:var(--cc-card-bg, var(--cc-main-bg, #f4ecd8)); color:var(--cc-main-text, #191813); border-bottom:1px solid var(--cc-border); box-shadow:0 2px 6px var(--cc-shadow, rgba(0,0,0,0.3)); font-size:0.78em;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <strong class="cc-qg-style-title" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Node</strong>
                        <button type="button" class="cc-qg-btn" data-qg="removeentity" style="display:none;" title="Remove this entity from the graph"><i class="fas fa-trash"></i></button>
                        <button type="button" class="cc-qg-btn" data-qg="closestyle" title="Close"><i class="fas fa-times"></i></button>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">
                        <label class="cc-qg-statuswrap" style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span style="opacity:0.7;">Status</span><select class="cc-qg-status" title="Quest status (drives the gold/red/grey outline and link colours)" style="width:100%; min-width:0;">${statusOptions}</select></label>
                        <label style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span style="opacity:0.7;">Category</span><select class="cc-qg-cat" style="width:100%; min-width:0;">${categoryOptions}</select></label>
                        <label style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span style="opacity:0.7;">Shape</span><select class="cc-qg-shape" style="width:100%; min-width:0;">${shapeOptions}</select></label>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label style="display:flex; align-items:center; gap:5px; flex:1; min-width:0;"><span style="opacity:0.7;">Size</span><input type="range" class="cc-qg-size" min="8" max="48" step="2" value="18" style="flex:1; min-width:0;"></label>
                        <label style="display:flex; align-items:center; gap:5px;"><span style="opacity:0.7;">Colour</span><input type="color" class="cc-qg-color" value="#b9a987"></label>
                        <button type="button" class="cc-qg-btn" data-qg="hidenode" title="Hide this node (search for it to bring it back)"><i class="fas fa-eye-slash"></i></button>
                    </div>
                </div>` : ""}

                <div class="cc-qg-empty" style="display:none; position:absolute; inset:0; align-items:center; justify-content:center; text-align:center; pointer-events:none; opacity:0.7;">
                    No quests found. Create a Campaign Codex quest, then press Refresh.
                </div>
                <div class="cc-qg-hint" style="position:absolute; bottom:6px; right:8px; font-size:0.7em; opacity:0.6; pointer-events:none;">
                    Double-click a node to open it &middot; right-drag to pan${gmControls ? " &middot; left-drag to box-select &middot; drag entities here to link them" : ""}
                </div>
            </div>
        </div>`;
    }

    /* -------------------------------------------- */
    /*  Listeners / network init                    */
    /* -------------------------------------------- */

    async activateListeners(htmlElement) {
        super.activateListeners(htmlElement);
        this._rootEl = htmlElement;

        const container = htmlElement.querySelector(`#cc-qg-canvas-${this.widgetId}`);
        const emptyEl = htmlElement.querySelector(".cc-qg-empty");
        if (!container) return;
        if (typeof vis === "undefined") {
            container.innerHTML = `<p style="color:red; padding:1em;">Error: vis.js library is not loaded.</p>`;
            return;
        }

        if (!this._state) await this._loadState();

        // Tear down any network left over from a previous activation (Foundry
        // sheets re-render and reuse this widget instance). A zombie network
        // keeps stale canvases alive and its pending view-save timer could
        // overwrite the good saved camera with a default one — one of the ways
        // the graph came back blank on the next open.
        // DO NOT measure the old network's camera here: by the time we run, the
        // sheet has already replaced its DOM and the old canvas is DETACHED
        // (0x0 frame). vis then reports the position shifted by half a viewport
        // in canvas units, and restoring that made every edit jump the view
        // up-left. Instead we rely on _state.viewState, which is captured
        // synchronously on every camera event while the canvas is attached.
        if (this.network && this._didInitialView && this._state?.viewState) {
            this._viewTrusted = true;
        }
        this._teardownNetwork();

        // _buildGraphData guarantees every node has an explicit grid x/y.
        const { nodes, edges } = await this._buildGraphData();
        if (emptyEl) emptyEl.style.display = nodes.length ? "none" : "flex";

        // Remember whether vis is being constructed against a 0x0 container
        // (sheet not laid out yet); if so the dataset is re-fed once the canvas
        // gets a real size, replicating what Auto-Arrange incidentally fixed.
        this._zeroSizedAtInit = !this._canvasSized();
        this._initialGraphData = { nodes, edges };

        try {
            this.network = new vis.Network(container, { nodes, edges }, this._networkOptions());
        } catch (err) {
            console.error("Campaign Codex | QuestGraph init failed:", err);
            container.innerHTML = `<p style="color:red; padding:1em;">Graph Error: ${err.message}</p>`;
            return;
        }

        // A fresh network draws at the DEFAULT camera for the first few frames,
        // before _restoreView lands — a visible zoom-out flash on every
        // re-render. Pre-apply the saved camera immediately and keep the
        // canvas invisible until the restore has settled (failsafe reveal in
        // case settle never fires, e.g. sheet stays hidden).
        const vsNow = this._state.viewState;
        if (vsNow && Number.isFinite(vsNow.scale) && vsNow.scale > 0
            && vsNow.position && Number.isFinite(vsNow.position.x) && Number.isFinite(vsNow.position.y)) {
            container.style.opacity = "0";
            clearTimeout(this._revealTimer);
            this._revealTimer = setTimeout(() => this._revealCanvas(), 800);
            try { this.network.moveTo({ scale: vsNow.scale, position: vsNow.position, animation: false }); }
            catch (e) { /* ignore */ }
        }

        this._installGridRenderer();
        this._scheduleInitialView();
        this._bindNetworkEvents();
        this._bindCanvasControls(htmlElement);
        this._installReactiveHook();
        if (this.isGM) {
            this._bindToolbar(htmlElement);
            this._bindDropZone(htmlElement);
            this._recordHistory(true);   // baseline snapshot for undo/redo
            this._updateUndoRedoButtons();
        }
    }

    /**
     * Network options. Layout and physics are ALWAYS disabled — node positions
     * are managed entirely by this widget on a grid. This is what prevents the
     * force-directed "circle" cluster from ever appearing.
     */
    _networkOptions() {
        const base = {
            nodes: {
                font: { size: 14, color: "#000000", face: "Signika", strokeWidth: 3, strokeColor: "#ffffff", vadjust: 2 },
                borderWidth: 2,
                shadow: false,
            },
            edges: {
                width: 2,
                // Thicken on hover/selection instead of recolouring.
                selectionWidth: 3,
                hoverWidth: 1,
                color: { color: "#9a8fb0", highlight: "#9a8fb0", hover: "#9a8fb0", opacity: 0.9 },
                arrows: { to: { enabled: true, scaleFactor: 0.8 } },
                smooth: { type: "cubicBezier", roundness: 0.4 },
            },
            interaction: {
                hover: true,
                zoomView: true,
                // Panning is RIGHT-drag (custom, see _bindCanvasControls);
                // left-drag on empty canvas draws a box selection instead.
                dragView: false,
                dragNodes: this.isGM,
                multiselect: false,
                navigationButtons: false,
            },
            manipulation: { enabled: false },
            physics: { enabled: false },
            layout: { hierarchical: { enabled: false }, improvedLayout: false, randomSeed: 1 },
        };
        return base;
    }

    /**
     * Draw a faint grid that tracks pan/zoom. vis-network hands us a context
     * already transformed into canvas/world coordinates in `beforeDrawing`, so
     * we draw grid lines in world space and they stay aligned to the nodes.
     */
    _installGridRenderer() {
        if (!this.network) return;
        const g = this._gridSize;
        this.network.on("beforeDrawing", (ctx) => {
            try {
                const scale = this.network.getScale();
                const view = this.network.getViewPosition();
                // Bail out if the camera isn't in a sane state yet. A zero/NaN
                // scale makes the viewport extent Infinite, which would turn the
                // grid loops below into an infinite loop and HARD-FREEZE the tab.
                if (!Number.isFinite(scale) || scale <= 0) return;
                if (!view || !Number.isFinite(view.x) || !Number.isFinite(view.y)) return;
                const dpr = window.devicePixelRatio || 1;
                const cw = ctx.canvas.width / dpr;
                const ch = ctx.canvas.height / dpr;
                const halfW = (cw / 2) / scale;
                const halfH = (ch / 2) / scale;
                const left = view.x - halfW, right = view.x + halfW;
                const top = view.y - halfH, bottom = view.y + halfH;
                if (![left, right, top, bottom].every(Number.isFinite)) return;
                const startX = Math.floor(left / g) * g;
                const startY = Math.floor(top / g) * g;

                ctx.save();
                ctx.strokeStyle = "rgba(150, 150, 150, 0.18)";
                ctx.lineWidth = 1 / scale;
                ctx.beginPath();
                // Hard cap the line count as a final guard against any pathological
                // viewport size — the grid is decorative, never worth a freeze.
                let guard = 0;
                for (let x = startX; x <= right; x += g) { if (++guard > 4000) break; ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
                guard = 0;
                for (let y = startY; y <= bottom; y += g) { if (++guard > 4000) break; ctx.moveTo(left, y); ctx.lineTo(right, y); }
                ctx.stroke();
                ctx.restore();
            } catch (e) { /* ignore draw errors */ }
        });

        // Selection bounding box: drawn in world space (like the grid) so it
        // tracks pan / zoom automatically. Only shown for a 2+ node selection.
        this.network.on("afterDrawing", (ctx) => {
            try {
                const b = this._selectionBounds;
                if (!b || (this._selectedNodeIds?.length || 0) < 2) return;
                const scale = this.network.getScale();
                if (!Number.isFinite(scale) || scale <= 0) return;
                ctx.save();
                ctx.strokeStyle = "rgba(212, 175, 55, 0.95)";
                ctx.fillStyle = "rgba(212, 175, 55, 0.08)";
                ctx.lineWidth = 1.5 / scale;
                ctx.setLineDash([6 / scale, 4 / scale]);
                const w = b.maxX - b.minX, h = b.maxY - b.minY;
                ctx.fillRect(b.minX, b.minY, w, h);
                ctx.strokeRect(b.minX, b.minY, w, h);
                ctx.restore();
            } catch (e) { /* ignore draw errors */ }
        });
    }

    /**
     * Keep the graph in sync with link/status changes made anywhere (e.g. from a
     * quest sheet's Depends-On / Unlocks controls). Reacts only to quest-record
     * changes so our own position/style saves (data.widgets) never loop.
     */
    _installReactiveHook() {
        if (this._updateHookId) { Hooks.off("updateJournalEntry", this._updateHookId); this._updateHookId = null; }
        this._updateHookId = Hooks.on("updateJournalEntry", (doc, changed) => {
            // Look at whatever campaign-codex flags changed. Foundry may deliver
            // the diff with dotted OR nested keys, so flatten and inspect paths.
            const cc = foundry.utils.getProperty(changed, "flags.campaign-codex");
            if (!cc || typeof cc !== "object") return;
            let paths;
            try { paths = Object.keys(foundry.utils.flattenObject(cc)); }
            catch (e) { paths = Object.keys(cc); }
            if (!paths.length) return;
            // Changes that only touch THIS widget's own saved state
            // (positions/styles/camera): the GM authored them, so the GM
            // client ignores them (refresh loop). Player clients pick them up
            // here instead — saveData uses render:false, so their sheet no
            // longer re-renders on its own.
            const ownPrefix = `data.widgets.questgraph.${this.widgetId}`;
            const onlyOwn = paths.every((p) => p.startsWith(ownPrefix));
            if (onlyOwn) {
                if (!this.isGM) this._scheduleReactiveRefresh(true);
                return;
            }
            this._scheduleReactiveRefresh();
        });
    }

    _scheduleReactiveRefresh(reloadState = false) {
        clearTimeout(this._reactiveTimer);
        this._reactiveTimer = setTimeout(async () => {
            if (!this._rootEl || !document.body.contains(this._rootEl)) {
                if (this._updateHookId) { Hooks.off("updateJournalEntry", this._updateHookId); this._updateHookId = null; }
                return;
            }
            // Player clients don't edit state, so a reload can't clobber
            // anything; it pulls in what the GM just saved. Keep the local
            // camera, though — the GM's saved view must not move a player's.
            if (reloadState) {
                const localView = this._state?.viewState;
                await this._loadState();
                if (localView) this._state.viewState = localView;
            }
            this._refresh(false);
        }, 300);
    }

    /* -------------------------------------------- */
    /*  View / camera                               */
    /* -------------------------------------------- */

    /** The canvas wrapper element (the box vis-network draws into), or null. */
    _canvasWrap() {
        return this._rootEl?.querySelector(".cc-qg-canvaswrap") || null;
    }

    /** True only when the canvas wrapper has a real (non-zero) size. */
    _canvasSized() {
        const wrap = this._canvasWrap();
        return !!(wrap && wrap.clientWidth > 0 && wrap.clientHeight > 0);
    }

    /**
     * Force vis-network to re-measure its container and repaint. Required because
     * vis only measures the canvas at construction; if that happened at 0x0 (page
     * not laid out / hidden tab), the canvas is stuck blank until we tell it the
     * real size. Safe to call repeatedly.
     */
    _syncCanvasSize() {
        if (!this.network || !this._canvasSized()) return;
        try {
            this.network.setSize("100%", "100%");
            this.network.redraw();
        } catch (e) { /* ignore */ }
    }

    /**
     * Get the graph drawn and framed on open, and keep it correctly sized for the
     * widget's whole life.
     *
     * The real "blank on open" cause: vis-network measures its canvas ONCE, at
     * construction. The journal sheet frequently isn't laid out yet at that point
     * (first open, or the page is on an inactive tab), so vis builds a 0x0 canvas
     * and every later moveTo()/fit() just moves the camera over an empty 0x0
     * surface — nothing ever appears. Moving the camera does NOT make vis
     * re-measure, which is why every camera-only fix failed.
     *
     * Fix: a PERSISTENT ResizeObserver. Whenever the wrapper has a real size it
     * forces vis to re-measure and repaint (`_syncCanvasSize`), and the very first
     * time that happens it restores the saved camera (or fits). Keeping it alive
     * also handles the sheet being resized or the tab being shown later. The
     * observer only calls setSize/redraw — which never change the element's box —
     * so it cannot re-trigger itself: no loop, no freeze.
     */
    _scheduleInitialView() {
        if (!this.network) return;
        this._didInitialView = false;

        const settle = () => {
            if (!this.network || !this._canvasSized()) return;
            this._syncCanvasSize();
            if (!this._didInitialView) {
                this._didInitialView = true;
                // If vis was constructed against a 0x0 container, its internal
                // node geometry was built at that broken size and a plain
                // redraw is not always enough — re-feed the dataset now that
                // the canvas is real (this is what Auto-Arrange incidentally
                // did, which is why it "fixed" the blank graph).
                if (this._zeroSizedAtInit && this._initialGraphData) {
                    try { this.network.setData(this._initialGraphData); } catch (e) { /* ignore */ }
                    this._syncCanvasSize();
                }
                this._initialGraphData = null;
                this._restoreView();
                this._revealCanvas();
            }
        };

        const wrap = this._canvasWrap();
        if (typeof ResizeObserver !== "undefined" && wrap) {
            this._resizeObs = new ResizeObserver(() => settle());
            try { this._resizeObs.observe(wrap); } catch (e) { /* ignore */ }
        }

        // Cover the already-visible case (ResizeObserver fires once on observe,
        // but try immediately and on the next couple of frames as belt & braces).
        settle();
        if (!this._didInitialView) {
            setTimeout(settle, 0);
            setTimeout(settle, 150);
            try { requestAnimationFrame(settle); } catch (e) { /* ignore */ }
        }
    }

    /** Detach the persistent canvas-size observer. */
    _stopInitialViewWatch() {
        if (this._resizeObs) {
            try { this._resizeObs.disconnect(); } catch (e) { /* ignore */ }
            this._resizeObs = null;
        }
    }

    /**
     * Restore the saved pan/zoom, falling back to a fit. The graph must ALWAYS be
     * visible on open, so even when a saved view exists we verify it actually
     * frames some content (e.g. every node it framed has since been deleted),
     * in which case we fit instead.
     */
    _restoreView() {
        if (!this.network || !this._canvasSized()) return;
        const vs = this._state.viewState;
        const validPos = vs && vs.position && Number.isFinite(vs.position.x) && Number.isFinite(vs.position.y);
        let restored = false;
        const trusted = this._viewTrusted === true;
        this._viewTrusted = false;
        if (vs && Number.isFinite(vs.scale) && vs.scale > 0 && validPos) {
            try {
                this.network.moveTo({ scale: vs.scale, position: vs.position, animation: false });
                restored = true;
            } catch (e) { /* fall through to fit */ }
        }
        if (!restored) { this._fitGraph(); return; }
        if (!this._contentVisible()) {
            // Right after a sheet re-render vis's internal frame can still be
            // mid-layout, so the visibility math runs against a stale canvas
            // and would trigger a spurious fit (= camera reset). Re-sync and
            // re-apply the view over the next few frames until the geometry
            // settles. A TRUSTED view (carried live across the rebuild) is
            // never fit-fallbacked — it framed real content moments ago.
            const reapply = (attempt) => {
                if (!this.network) return;
                this._syncCanvasSize();
                try { this.network.moveTo({ scale: vs.scale, position: vs.position, animation: false }); }
                catch (e) { /* ignore */ }
                if (this._contentVisible()) return;
                if (attempt < 6) { requestAnimationFrame(() => reapply(attempt + 1)); return; }
                if (!trusted) this._fitGraph();
            };
            requestAnimationFrame(() => reapply(1));
        }
    }

    /** Make the (possibly opacity-0, see activateListeners) canvas visible. */
    _revealCanvas() {
        clearTimeout(this._revealTimer);
        const el = this._rootEl?.querySelector(`#cc-qg-canvas-${this.widgetId}`);
        if (el) el.style.opacity = "1";
    }

    /** Destroy the current network and every timer/observer tied to it. Used on
     *  re-activation (sheet re-render) and on final destroy so no zombie
     *  network or pending view-save can act on a stale canvas. */
    _teardownNetwork() {
        this._stopInitialViewWatch();
        clearTimeout(this._viewTimer);
        clearTimeout(this._revealTimer);
        clearTimeout(this._clickTimer);
        this._didInitialView = false;
        if (this.network) {
            try { this.network.destroy(); } catch (e) { /* ignore */ }
            this.network = null;
        }
    }

    /**
     * True when the current viewport actually overlaps the node bounding box, i.e.
     * some of the graph is on screen. Used to detect (and correct) a saved view
     * that would otherwise leave the canvas blank.
     */
    _contentVisible() {
        if (!this.network) return false;
        const b = this._contentBounds();
        if (!b) {
            // No measurable content. Fine when the graph is genuinely empty,
            // but if nodes DO exist their positions are unusable — report
            // "not visible" so callers fall back to a fit instead of leaving
            // the canvas blank (previously this returned true and blocked
            // the fit, which was one of the blank-on-open causes).
            let count = 0;
            try { count = this.network.body?.data?.nodes?.length || 0; } catch (e) { /* ignore */ }
            return count === 0;
        }
        let scale, view;
        try { scale = this.network.getScale(); view = this.network.getViewPosition(); }
        catch (e) { return false; }
        if (!Number.isFinite(scale) || scale <= 0) return false;
        if (!view || !Number.isFinite(view.x) || !Number.isFinite(view.y)) return false;
        const wrap = this._canvasWrap();
        const cw = wrap?.clientWidth || 0;
        const ch = wrap?.clientHeight || 0;
        if (cw <= 0 || ch <= 0) return false;
        const halfW = (cw / 2) / scale;
        const halfH = (ch / 2) / scale;
        const vl = view.x - halfW, vr = view.x + halfW;
        const vt = view.y - halfH, vb = view.y + halfH;
        const overlapX = Math.min(b.maxX, vr) - Math.max(b.minX, vl);
        const overlapY = Math.min(b.maxY, vb) - Math.max(b.minY, vt);
        return overlapX > 0 && overlapY > 0;
    }

    /**
     * Compute the world-space bounding box of all nodes from positions and sizes
     * THIS widget owns — never from vis-network's internal bounding boxes. Those
     * are only populated for custom shapes after a real draw at full size, which
     * is why the built-in fit() was unreliable until an Auto-Arrange forced a
     * redraw. This is always correct because we know every node's grid x/y and
     * radius regardless of draw state. Returns null if there are no nodes.
     */
    _contentBounds() {
        if (!this.network) return null;
        let pos;
        try { pos = this.network.getPositions(); } catch (e) { return null; }
        const ids = pos ? Object.keys(pos) : [];
        if (!ids.length) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of ids) {
            const p = pos[id];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            // Radius padded to cover the border and the label drawn beneath.
            const r = (this._nodeSizes?.get(id) || 25) + 8;
            const labelPad = 22; // label sits below the node
            minX = Math.min(minX, p.x - r);
            maxX = Math.max(maxX, p.x + r);
            minY = Math.min(minY, p.y - r);
            maxY = Math.max(maxY, p.y + r + labelPad);
        }
        if (!Number.isFinite(minX)) return null;
        return { minX, minY, maxX, maxY };
    }

    /**
     * Fit the whole graph into view. Scale and centre are computed from the
     * bounding box THIS widget owns (positions + sizes) and the live canvas size,
     * then applied with moveTo() — so it works on the very first open without
     * depending on vis-network having drawn the custom shapes (whose internal
     * bounding boxes are unreliable until then). No animation, no rescheduling.
     *
     * `save` persists the resulting camera as the saved view (used for the
     * explicit toolbar Fit / Auto-Arrange; the automatic fallback fit on open
     * doesn't save, since it is re-derived identically on the next open).
     */
    _fitGraph(save = false) {
        if (!this.network || !this._canvasSized()) return;
        const wrap = this._canvasWrap();
        const cw = wrap?.clientWidth || 0;
        const ch = wrap?.clientHeight || 0;
        const b = this._contentBounds();
        if (!b || cw <= 0 || ch <= 0) return;
        const bw = Math.max(b.maxX - b.minX, 1);
        const bh = Math.max(b.maxY - b.minY, 1);
        let scale = Math.min(cw / bw, ch / bh) * 0.88; // 0.88 = breathing room
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
        scale = Math.max(0.05, Math.min(scale, 1.2));
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        try { this.network.moveTo({ scale, position: { x: cx, y: cy }, animation: false }); }
        catch (e) { return; }
        if (save) this._saveViewDebounced();
    }

    _bindNetworkEvents() {
        // Double-click opens the document. It cancels the pending single-click
        // panel so the panel never appears over (and steals) the second click.
        this.network.on("doubleClick", (params) => {
            clearTimeout(this._clickTimer);
            if (params.nodes.length === 0) return;
            this._onOpenDocument(params.nodes[0], "Quest");
        });

        // Single click drives the style/edge panel, but is deferred briefly so a
        // double-click can cancel it (otherwise the panel would cover the node).
        this.network.on("click", (params) => {
            clearTimeout(this._clickTimer);
            const nodeId = params.nodes.length > 0 ? params.nodes[0] : null;
            const edgeId = !nodeId && params.edges.length > 0 ? params.edges[0] : null;
            const src = params.event?.srcEvent;
            const additive = !!(nodeId && src && (src.ctrlKey || src.metaKey));
            this._clickTimer = setTimeout(() => {
                if (additive) {
                    // Ctrl/Cmd+click toggles a node in/out of the multi-selection.
                    const set = new Set(this._selectedNodeIds || []);
                    if (set.has(nodeId)) set.delete(nodeId); else set.add(nodeId);
                    this._selectedNodeIds = [...set];
                    this._selectedNodeId = this._selectedNodeIds.length === 1 ? this._selectedNodeIds[0] : null;
                    this._selectedEdgeId = null;
                    try { this.network.selectNodes(this._selectedNodeIds); } catch (e) { /* ignore */ }
                    this._recomputeSelectionBounds();
                    this.network?.redraw();
                    if (this.isGM) this._syncPanels();
                    return;
                }
                this._selectedNodeId = nodeId;
                this._selectedNodeIds = nodeId ? [nodeId] : [];
                this._selectedEdgeId = edgeId;
                this._recomputeSelectionBounds();
                this.network?.redraw();
                if (this.isGM) this._syncPanels();
            }, 260);
        });

        if (!this.isGM) return;

        // Snap + save when a node finishes being dragged. Flush immediately so a
        // re-render reads the new position and the node never snaps back.
        this.network.on("dragEnd", (params) => {
            if (params.nodes && params.nodes.length > 0) {
                const positions = this.network.getPositions(params.nodes);
                for (const [uuid, p] of Object.entries(positions)) {
                    const x = this._snap(p.x);
                    const y = this._snap(p.y);
                    this._state.positions[uuid] = { x, y };
                    this.network.moveNode(uuid, x, y);
                }
                this._markManual(params.nodes);
                this._recomputeSelectionBounds();
                this._persistNow();
            }
            this._saveViewDebounced();
        });

        // Save pan/zoom (debounced)
        this.network.on("zoom", () => this._saveViewDebounced());
    }

    _saveViewDebounced() {
        // Capture the camera SYNCHRONOUSLY, while the canvas is guaranteed to
        // still be attached and correctly sized. Measuring later (in the timer,
        // or worse at rebuild time in activateListeners) can read a DETACHED
        // canvas whose frame is 0x0 — vis then reports a position shifted by
        // exactly half a viewport, and restoring that value made the camera
        // jump up-left after every edit-triggered re-render.
        // Never save the camera before the initial view has settled (the
        // pre-layout camera is garbage) and never save non-finite values —
        // a bad persisted view is restored as a blank graph next open.
        if (!this.network || !this._didInitialView) return;
        let scale, position;
        try {
            scale = this.network.getScale();
            position = this.network.getViewPosition();
        } catch (e) { return; }
        if (!Number.isFinite(scale) || scale <= 0) return;
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
        this._state.viewState = { scale, position: { x: position.x, y: position.y } };
        // A camera captured live from the attached canvas is authoritative:
        // _restoreView must apply it as-is and never fit-fallback.
        this._viewTrusted = true;
        // Only the localStorage write is debounced.
        clearTimeout(this._viewTimer);
        this._viewTimer = setTimeout(() => {
            // Client-side only — NO document write. A flag write here made
            // Campaign Codex re-render the sheet after every zoom/pan, which
            // rebuilt this widget and reset the camera. Bonus: players can
            // keep their own camera now too.
            this._saveViewToClient(this._state.viewState);
        }, 400);
    }

    /* -------------------------------------------- */
    /*  Canvas mouse controls (pan / box select)    */
    /* -------------------------------------------- */

    /**
     * Custom pointer handling on the canvas wrapper:
     *  - RIGHT-drag pans the view (vis's built-in left-drag pan is disabled).
     *  - LEFT-drag on EMPTY canvas draws a selection rectangle; every node
     *    inside it is selected, and dragging any selected node then moves the
     *    whole group (vis moves the full selection natively).
     *  - A plain left-click on empty canvas clears the selection.
     * Presses on nodes/edges are NOT intercepted, so single-node drag, click
     * panels, double-click-to-open and Draw Link all behave as before.
     * Registered in the capture phase so vis-network never sees the presses
     * we handle. Listeners die with the wrapper element on re-render; the
     * window-level move/up listeners only live for the duration of one drag.
     */
    _bindCanvasControls(root) {
        const wrap = root.querySelector(".cc-qg-canvaswrap");
        if (!wrap) return;

        // The browser context menu would swallow right-drag.
        wrap.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); });

        wrap.addEventListener("pointerdown", (ev) => {
            if (!this.network) return;
            // Only engage on the vis canvas itself. Overlays inside the wrap
            // (style panel, hint, ...) must keep their normal click behaviour —
            // otherwise the box-select's pointerup clears the selection before
            // a panel button's click handler runs.
            if (!(ev.target instanceof HTMLCanvasElement)) return;
            if (ev.button === 2) { this._startPan(ev); return; }
            if (ev.button === 0 && this.isGM && !this._drawMode) {
                const rect = wrap.getBoundingClientRect();
                const pt = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                // A live multi-selection with a visible bounding box: a press
                // INSIDE the box drags the whole group; a press OUTSIDE it falls
                // through to node-hit / box-select (which clears the selection).
                if (!(ev.ctrlKey || ev.metaKey)
                    && (this._selectedNodeIds?.length || 0) >= 2 && this._pointInSelection(pt)) {
                    this._startGroupDrag(ev);
                    return;
                }
                let onNode = null, onEdge = null;
                try { onNode = this.network.getNodeAt(pt); onEdge = this.network.getEdgeAt(pt); }
                catch (e) { /* ignore */ }
                if (onNode || onEdge) {
                    // Pressing a node/edge outside the current group clears the
                    // multi-selection so vis can select just that node; the
                    // deferred click handler then repopulates _selectedNodeIds.
                    // Ctrl/Cmd is additive, so it must NOT clear the selection.
                    if (!(ev.ctrlKey || ev.metaKey)
                        && (this._selectedNodeIds?.length || 0) >= 2
                        && !(onNode && this._selectedNodeIds.includes(onNode))) {
                        this._clearMultiSelection();
                    }
                    return; // let vis handle single-node drag / click
                }
                // Empty canvas: rubber-band box select (a tiny box deselects).
                this._startBoxSelect(ev, wrap);
            }
        }, true);
    }

    /** Right-button drag: pan the camera, then save the view. */
    _startPan(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        let scale, view;
        try { scale = this.network.getScale(); view = this.network.getViewPosition(); }
        catch (e) { return; }
        if (!Number.isFinite(scale) || scale <= 0) return;
        if (!view || !Number.isFinite(view.x) || !Number.isFinite(view.y)) return;
        const sx = ev.clientX, sy = ev.clientY;
        const move = (e) => {
            if (!this.network) return;
            try {
                this.network.moveTo({
                    position: { x: view.x - (e.clientX - sx) / scale, y: view.y - (e.clientY - sy) / scale },
                    scale,
                    animation: false,
                });
            } catch (err) { /* ignore */ }
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            this._saveViewDebounced();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }

    /** Left-drag on empty canvas: rubber-band selection rectangle. */
    _startBoxSelect(ev, wrap) {
        ev.preventDefault();
        ev.stopPropagation();
        const origin = wrap.getBoundingClientRect();
        const sx = ev.clientX - origin.left;
        const sy = ev.clientY - origin.top;
        let cx = sx, cy = sy;

        const box = document.createElement("div");
        box.className = "cc-qg-selectbox";
        box.style.cssText = "position:absolute; z-index:4; border:1px dashed var(--cc-accent, #d4af37); background:rgba(212,175,55,0.12); pointer-events:none; left:0; top:0; width:0; height:0;";
        wrap.appendChild(box);

        const draw = () => {
            box.style.left = `${Math.min(sx, cx)}px`;
            box.style.top = `${Math.min(sy, cy)}px`;
            box.style.width = `${Math.abs(cx - sx)}px`;
            box.style.height = `${Math.abs(cy - sy)}px`;
        };
        const move = (e) => {
            const r = wrap.getBoundingClientRect();
            cx = e.clientX - r.left;
            cy = e.clientY - r.top;
            draw();
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            box.remove();
            if (!this.network) return;
            clearTimeout(this._clickTimer);

            // A near-zero box is just a click on empty canvas: deselect.
            if (Math.abs(cx - sx) < 4 && Math.abs(cy - sy) < 4) {
                this._clearMultiSelection();
                this._selectedEdgeId = null;
                this._syncPanels();
                return;
            }

            // Select every node whose centre falls inside the rectangle.
            let a, b;
            try {
                a = this.network.DOMtoCanvas({ x: Math.min(sx, cx), y: Math.min(sy, cy) });
                b = this.network.DOMtoCanvas({ x: Math.max(sx, cx), y: Math.max(sy, cy) });
            } catch (e) { return; }
            let positions = {};
            try { positions = this.network.getPositions(); } catch (e) { /* ignore */ }
            const ids = Object.entries(positions)
                .filter(([, p]) => p && p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y)
                .map(([id]) => id);
            try { this.network.selectNodes(ids); } catch (e) { /* ignore */ }
            this._selectedNodeIds = ids;
            this._selectedNodeId = ids.length === 1 ? ids[0] : null;
            this._selectedEdgeId = null;
            this._recomputeSelectionBounds();
            this.network.redraw();
            this._syncPanels();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }

    /* -------------------------------------------- */
    /*  Multi-selection: bounding box + group drag  */
    /* -------------------------------------------- */

    /** Recompute the world-space bounding box around the current multi-selection
     *  (>= 2 nodes). Cleared to null otherwise. Padded by node radius + grid. */
    _recomputeSelectionBounds() {
        const ids = (this._selectedNodeIds || []).filter((id) => this.network?.body.data.nodes.get(id));
        this._selectedNodeIds = ids;
        if (ids.length < 2) { this._selectionBounds = null; return; }
        let ps;
        try { ps = this.network.getPositions(ids); } catch (e) { this._selectionBounds = null; return; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of ids) {
            const p = ps[id];
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            const r = (this._nodeSizes?.get(id) || 20) + 8;
            minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
            minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
        }
        if (!Number.isFinite(minX)) { this._selectionBounds = null; return; }
        const pad = this._gridSize * 0.6;
        this._selectionBounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }

    /** Is a DOM point (relative to the canvas wrapper) inside the selection box? */
    _pointInSelection(domPoint) {
        if (!this._selectionBounds || !this.network) return false;
        let w;
        try { w = this.network.DOMtoCanvas(domPoint); } catch (e) { return false; }
        const b = this._selectionBounds;
        return w.x >= b.minX && w.x <= b.maxX && w.y >= b.minY && w.y <= b.maxY;
    }

    /** Drop the whole multi-selection (box + highlight). */
    _clearMultiSelection() {
        try { this.network?.unselectAll(); } catch (e) { /* ignore */ }
        this._selectedNodeIds = [];
        this._selectedNodeId = null;
        this._selectionBounds = null;
        try { this.network?.redraw(); } catch (e) { /* ignore */ }
    }

    /** Flag nodes as having a user-set (manual) position — drives the "jump to
     *  it vs. drop into view" choice when the node is later un-hidden. */
    _markManual(ids) {
        if (!this._state) return;
        const list = Array.isArray(this._state.manualPositions)
            ? this._state.manualPositions : (this._state.manualPositions = []);
        for (const id of (Array.isArray(ids) ? ids : [ids])) {
            if (id && !list.includes(id)) list.push(id);
        }
    }

    /** Left-drag started inside the selection box: move every selected node
     *  together, snapping to the grid and persisting on release. */
    _startGroupDrag(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const ids = (this._selectedNodeIds || []).slice();
        if (ids.length < 2) return;
        let scale;
        try { scale = this.network.getScale(); } catch (e) { return; }
        if (!Number.isFinite(scale) || scale <= 0) return;
        let start;
        try { start = this.network.getPositions(ids); } catch (e) { return; }
        const origin = {};
        for (const id of ids) if (start[id]) origin[id] = { x: start[id].x, y: start[id].y };
        const sx = ev.clientX, sy = ev.clientY;
        let moved = false;
        const move = (e) => {
            if (!this.network) return;
            const dx = (e.clientX - sx) / scale;
            const dy = (e.clientY - sy) / scale;
            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;
            for (const id of ids) {
                const p = origin[id];
                if (!p) continue;
                try { this.network.moveNode(id, p.x + dx, p.y + dy); } catch (err) { /* ignore */ }
            }
            this._recomputeSelectionBounds();
            try { this.network.redraw(); } catch (err) { /* ignore */ }
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            if (moved) {
                for (const id of ids) {
                    let p;
                    try { p = this.network.getPositions([id])[id]; } catch (e) { continue; }
                    if (!p) continue;
                    const x = this._snap(p.x), y = this._snap(p.y);
                    this._state.positions[id] = { x, y };
                    try { this.network.moveNode(id, x, y); } catch (e) { /* ignore */ }
                }
                this._markManual(ids);
                this._recomputeSelectionBounds();
                try { this.network.redraw(); } catch (e) { /* ignore */ }
                this._persistNow();
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    }

    /** A free grid cell near the centre of the CURRENT view (used to drop a
     *  freshly un-hidden node into sight without moving the camera). */
    _freeCellInView() {
        let view;
        try { view = this.network.getViewPosition(); } catch (e) { view = { x: 0, y: 0 }; }
        const cx = this._snap(view?.x ?? 0), cy = this._snap(view?.y ?? 0);
        const occupied = new Set(Object.values(this._state.positions || {}).map((p) => `${p.x},${p.y}`));
        return this._findFreeCell(cx, cy, occupied, this._gridSize * 3);
    }

    /* -------------------------------------------- */
    /*  Undo / redo                                 */
    /* -------------------------------------------- */

    /** Snapshot of everything an undo needs to restore: the full widget state
     *  (positions, styles, hidden flags, ...) plus the current link topology
     *  (links live in document flags, mirrored by the live edge set). */
    _snapshot() {
        let state;
        try { state = JSON.parse(JSON.stringify(this._state)); }
        catch (e) { state = null; }
        const links = [];
        try {
            for (const e of this.network.body.data.edges.get()) links.push({ from: e.from, to: e.to });
        } catch (e) { /* ignore */ }
        // Quest statuses live on the quest documents, not in _state, so capture
        // them explicitly (statusClass per quest) to make status changes undoable.
        const statuses = [];
        try {
            for (const [uuid, cls] of (this._statusByUuid || new Map())) statuses.push([uuid, cls]);
        } catch (e) { /* ignore */ }
        return { state, links, statuses };
    }

    _sameSnapshot(a, b) {
        if (!a || !b) return false;
        try {
            return JSON.stringify(a.state) === JSON.stringify(b.state)
                && JSON.stringify(a.links) === JSON.stringify(b.links)
                && JSON.stringify(a.statuses) === JSON.stringify(b.statuses);
        } catch (e) { return false; }
    }

    /** Record the CURRENT (post-mutation) state onto the undo stack. Called at
     *  the end of every _persistNow. `baseline` marks the first push after a
     *  (re)render so the log always has a starting point to undo back to. */
    _recordHistory(baseline = false) {
        if (this._restoringHistory || !this.isGM || !this.network) return;
        const snap = this._snapshot();
        if (!snap.state) return;
        const cur = this._historyIndex >= 0 ? this._history[this._historyIndex] : null;
        if (cur && this._sameSnapshot(cur, snap)) return;   // no real change
        this._history = this._history.slice(0, this._historyIndex + 1); // drop redo tail
        this._history.push(snap);
        if (this._history.length > this._historyLimit) this._history.shift();
        this._historyIndex = this._history.length - 1;
        this._updateUndoRedoButtons();
    }

    async _undo() {
        if (this._historyBusy || this._historyIndex <= 0) return;
        this._historyBusy = true;
        this._updateUndoRedoButtons();
        try {
            this._historyIndex--;
            await this._applySnapshot(this._history[this._historyIndex]);
        } finally { this._historyBusy = false; this._updateUndoRedoButtons(); }
    }

    async _redo() {
        if (this._historyBusy || this._historyIndex >= this._history.length - 1) return;
        this._historyBusy = true;
        this._updateUndoRedoButtons();
        try {
            this._historyIndex++;
            await this._applySnapshot(this._history[this._historyIndex]);
        } finally { this._historyBusy = false; this._updateUndoRedoButtons(); }
    }

    /** Restore a snapshot: reconcile the link topology (add/remove document
     *  links so they match the snapshot), then swap in the saved widget state
     *  and rebuild. The live camera is preserved — undo never moves the view. */
    async _applySnapshot(snap) {
        if (!snap || !snap.state || !this.network) return;
        this._restoringHistory = true;
        try {
            // 1) Quest statuses: write each quest whose status differs from target.
            await this._reconcileStatuses(snap.statuses || []);

            // 2) Link topology: add/remove document links to match the snapshot.
            const key = (l) => `${l.from}\u0000${l.to}`;
            const target = new Set((snap.links || []).map(key));
            const current = this.network.body.data.edges.get();
            const curKeys = new Set(current.map((e) => key(e)));
            for (const e of current) if (!target.has(key(e))) await this._removeLink(e);
            for (const l of (snap.links || [])) if (!curKeys.has(key(l))) await this._createLink(l.from, l.to);

            // 3) Widget state (positions/styles/hidden/...), keeping the LIVE camera.
            const liveView = this._state?.viewState;
            let restored;
            try { restored = JSON.parse(JSON.stringify(snap.state)); } catch (e) { restored = null; }
            if (restored) { restored.viewState = liveView; this._state = restored; }

            this._clearMultiSelection();
            await this._persistNow();      // guarded: won't re-record while restoring
            await this._refresh(false);
        } finally {
            this._restoringHistory = false;
        }
        this._updateUndoRedoButtons();
    }

    /** Write quest status flags so every quest matches the target statusClass
     *  map (used by undo/redo). Absolute set, no cascade — the snapshot already
     *  captured the post-cascade status of every quest. */
    async _reconcileStatuses(targetStatuses) {
        const patchFor = (cls) => ({
            completed: cls === "completed",
            failed: cls === "failed",
            inactive: cls === "inactive",
        });
        for (const [uuid, cls] of targetStatuses) {
            if ((this._statusByUuid.get(uuid) || "active") === cls) continue; // already correct
            const doc = await fromUuid(uuid).catch(() => null);
            if (!doc) continue;
            await this._updateQuestStatusFlags(doc, patchFor(cls));
        }
    }

    _updateUndoRedoButtons() {
        const u = this._rootEl?.querySelector('[data-qg="undo"]');
        const r = this._rootEl?.querySelector('[data-qg="redo"]');
        const busy = !!this._historyBusy;
        if (u) u.disabled = busy || this._historyIndex <= 0;
        if (r) r.disabled = busy || this._historyIndex >= this._history.length - 1;
    }

    /* -------------------------------------------- */
    /*  Toolbar / panels                            */
    /* -------------------------------------------- */

    _bindToolbar(root) {
        const q = (sel) => root.querySelector(sel);

        q('[data-qg="refresh"]')?.addEventListener("click", () => this._refresh(true));
        q('[data-qg="undo"]')?.addEventListener("click", () => this._undo());
        q('[data-qg="redo"]')?.addEventListener("click", () => this._redo());
        q('[data-qg="arrange"]')?.addEventListener("click", () => this._autoArrange());
        q('[data-qg="fit"]')?.addEventListener("click", () => this._fitGraph(true));

        q('[data-qg="addedge"]')?.addEventListener("click", () => {
            if ((this._selectedNodeIds?.length || 0) >= 2) this._linkSelected(this._selectedNodeIds.slice());
            else this._toggleDrawMode();
        });
        q('[data-qg="deledge"]')?.addEventListener("click", () => {
            if ((this._selectedNodeIds?.length || 0) >= 2) this._unlinkSelected(this._selectedNodeIds.slice());
            else this._deleteSelectedEdge();
        });
        q('[data-qg="hidenode"]')?.addEventListener("click", () => this._hideSelectedNode());
        this._bindSearch(root);

        // Hide-isolated toggle button (persisted in the widget state).
        const hideIso = q(".cc-qg-hideiso");
        if (hideIso) {
            const paint = () => {
                const on = !!this._state.hideIsolated;
                hideIso.setAttribute("aria-pressed", String(on));
                hideIso.style.background = on ? "var(--cc-accent, #d4af37)" : "";
                hideIso.style.color = on ? "#1a1813" : "";
                const icon = hideIso.querySelector("i");
                if (icon) icon.className = on ? "fas fa-eye-slash" : "fas fa-eye";
            };
            paint();
            hideIso.addEventListener("click", async () => {
                this._state.hideIsolated = !this._state.hideIsolated;
                paint();
                await this._persistNow();
                await this._refresh(false);
            });
        }

        // Node style panel
        q(".cc-qg-status")?.addEventListener("change", (e) => this._applyQuestStatus(e.target.value));
        q(".cc-qg-cat")?.addEventListener("change", (e) => this._applyNodeStyle({ category: e.target.value }, true));
        q(".cc-qg-shape")?.addEventListener("change", (e) => this._applyNodeStyle({ shape: e.target.value }));
        // Size: live preview on input (no save), persist once on release.
        q(".cc-qg-size")?.addEventListener("input", (e) => this._applyNodeStyle({ size: Number(e.target.value) }, false, false));
        q(".cc-qg-size")?.addEventListener("change", () => this._persistNow());
        q(".cc-qg-color")?.addEventListener("change", (e) => this._applyNodeStyle({ color: e.target.value }));
        q('[data-qg="removeentity"]')?.addEventListener("click", () => this._removeSelectedEntity());
        q('[data-qg="closestyle"]')?.addEventListener("click", () => {
            this._clearMultiSelection();
            this._syncPanels();
        });
    }

    /* -------------------------------------------- */
    /*  Search / focus / hide                       */
    /* -------------------------------------------- */

    _bindSearch(root) {
        const q = (sel) => root.querySelector(sel);
        const btn = q('[data-qg="search"]');
        const pop = q(".cc-qg-searchpop");
        const input = q(".cc-qg-searchinput");
        const results = q(".cc-qg-searchresults");
        if (!btn || !pop || !input || !results) return;

        const close = () => { pop.style.display = "none"; };

        btn.addEventListener("click", async () => {
            const open = pop.style.display !== "flex";
            pop.style.display = open ? "flex" : "none";
            if (open) {
                this._searchIndex = await this._searchCandidates();
                input.value = "";
                results.innerHTML = "";
                input.focus();
            }
        });

        const matchesFor = (term) => (this._searchIndex || [])
            .filter((c) => c.name.toLowerCase().includes(term) || (c.text && c.text.includes(term)));

        const renderResults = () => {
            const term = input.value.trim().toLowerCase();
            results.innerHTML = "";
            if (!term) return;
            const matches = matchesFor(term).slice(0, 10);
            if (!matches.length) {
                const none = document.createElement("div");
                none.style.cssText = "opacity:0.6; padding:2px 4px;";
                none.textContent = "No match";
                results.appendChild(none);
                return;
            }
            for (const m of matches) {
                const isHidden = this._state.hiddenNodes.includes(m.uuid)
                    || !this.network?.body.data.nodes.get(m.uuid);
                const item = document.createElement("button");
                item.type = "button";
                item.className = "cc-qg-btn";
                item.style.cssText = "text-align:left; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
                item.textContent = m.name + (isHidden ? "  (hidden)" : "");
                item.addEventListener("click", async () => { close(); await this._focusNode(m.uuid); });
                results.appendChild(item);
            }
        };

        input.addEventListener("input", renderResults);
        input.addEventListener("keydown", async (e) => {
            if (e.key === "Escape") { close(); return; }
            if (e.key === "Enter") {
                e.preventDefault();
                const m = matchesFor(input.value.trim().toLowerCase())[0];
                if (m) { close(); await this._focusNode(m.uuid); }
            }
        });
    }

    /** Search index: every quest in the world (matched on name AND description
     *  text, hidden or not) plus every extra entity on the canvas (name only). */
    async _searchCandidates() {
        const out = [];
        for (const doc of game.journal.filter((j) => j.getFlag("campaign-codex", "type") === "quest")) {
            if (!this._getQuestRecord(doc)?.id) continue;
            const data = doc.getFlag("campaign-codex", "data") || {};
            const text = String(data.description || "").replace(/<[^>]*>/g, " ").toLowerCase();
            out.push({ uuid: doc.uuid, name: doc.name, text });
        }
        for (const uuid of this._state.extraEntities) {
            const doc = await fromUuid(uuid).catch(() => null);
            const resolved = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
            if (resolved?.name) out.push({ uuid, name: resolved.name, text: "" });
        }
        return out;
    }

    /** Zoom the camera onto a node, un-hiding it first if necessary (both the
     *  manual eye-slash hide and the "Hide isolated" filter). */
    async _focusNode(uuid) {
        if (!this.network) return;
        let changed = false;
        const hid = this._state.hiddenNodes.indexOf(uuid);
        if (hid !== -1) { this._state.hiddenNodes.splice(hid, 1); changed = true; }
        if (this._state.hideIsolated && !this.network.body.data.nodes.get(uuid)
            && !this._state.isolatedExempt.includes(uuid)) {
            this._state.isolatedExempt.push(uuid);
            changed = true;
        }
        // Un-hiding always returns the node to its last saved position (the
        // position is never discarded on hide); the code below then zooms the
        // camera to it. (Earlier "drop into current view" behaviour removed.)
        if (changed) {
            await this._persistNow();
            await this._refresh(false);
        }
        if (!this.network?.body.data.nodes.get(uuid)) return; // not on the canvas
        let p = null;
        try { p = this.network.getPositions([uuid])[uuid]; } catch (e) { /* ignore */ }
        if (!p) p = this._state.positions[uuid];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const cur = (() => { try { return this.network.getScale(); } catch (e) { return 1; } })();
        const scale = Number.isFinite(cur) && cur > 1 ? cur : 1;
        try {
            if (changed) {
                // The un-hide save above makes Campaign Codex re-render the
                // sheet in ~100ms, which would kill an animation midway. Snap
                // instantly instead; the rebuild then restores this exact view.
                this.network.moveTo({ position: { x: p.x, y: p.y }, scale, animation: false });
            } else {
                // Animated moveTo drifts off-target when the scale changes at
                // the same time (vis-network quirk), so snap to the exact node
                // position once the animation finishes.
                this.network.once("animationFinished", () => {
                    try { this.network?.moveTo({ position: { x: p.x, y: p.y }, scale, animation: false }); }
                    catch (e) { /* ignore */ }
                    this._saveViewDebounced();
                });
                this.network.moveTo({
                    position: { x: p.x, y: p.y },
                    scale,
                    animation: { duration: 300, easingFunction: "easeInOutQuad" },
                });
            }
            this.network.selectNodes([uuid]);
        } catch (e) { /* ignore */ }
        this._selectedNodeId = uuid;
        this._selectedNodeIds = [uuid];
        this._selectedEdgeId = null;
        this._recomputeSelectionBounds();
        // Record the focused view (the TARGET, not the live camera — the
        // animated case is still mid-flight) so a rebuild right after the
        // un-hide save restores it. The animationFinished handler above
        // re-captures the settled camera for the animated case.
        this._state.viewState = { scale, position: { x: p.x, y: p.y } };
        this._viewTrusted = true;
        this._saveViewToClient(this._state.viewState);
        if (this.isGM) this._syncPanels();
    }

    /** Hide the selected node (persisted). The search brings it back. */
    async _hideSelectedNode() {
        const uuid = this._selectedNodeId;
        if (!uuid) return;
        if (!this._state.hiddenNodes.includes(uuid)) this._state.hiddenNodes.push(uuid);
        this._clearMultiSelection();
        this._syncPanels();
        await this._persistNow();
        await this._refresh(false);
        ui.notifications?.info("Node hidden. Search for it to bring it back.");
    }

    /** Nodes the config panel edits: the whole multi-selection when >= 2 nodes
     *  are box/ctrl-selected, otherwise the single selected node (or none). */
    _panelTargets() {
        const ids = (this._selectedNodeIds || []).filter((id) => this.network?.body.data.nodes.get(id));
        if (ids.length >= 2) return ids;
        if (this._selectedNodeId && this.network?.body.data.nodes.get(this._selectedNodeId)) {
            return [this._selectedNodeId];
        }
        return [];
    }

    /** Shared value if every entry is equal, else the VARIOUS sentinel. */
    _commonValue(values) {
        if (!values.length) return QuestGraphWidget.VARIOUS;
        const first = values[0];
        return values.every((v) => v === first) ? first : QuestGraphWidget.VARIOUS;
    }

    /** Set a <select>'s value, injecting/removing a "— Various —" option so a
     *  mixed selection reads as various and a uniform one reads concretely. */
    _setSelectValue(sel, value) {
        if (!sel) return;
        let opt = sel.querySelector('option[value="__various__"]');
        if (value === QuestGraphWidget.VARIOUS) {
            if (!opt) {
                opt = document.createElement("option");
                opt.value = QuestGraphWidget.VARIOUS;
                opt.textContent = "— Various —";
                sel.insertBefore(opt, sel.firstChild);
            }
            sel.value = QuestGraphWidget.VARIOUS;
        } else {
            if (opt) opt.remove();
            sel.value = value;
        }
    }

    /** Set a range/colour input, dimming it when the selection is mixed. A mixed
     *  input left untouched fires no change event, so node values are preserved;
     *  the moment the user drags/picks, the real value flows to all selected. */
    _setVariousInput(input, value) {
        if (!input) return;
        if (value === QuestGraphWidget.VARIOUS) {
            input.dataset.various = "1";
            input.style.opacity = "0.5";
            input.title = "Various — change to set all selected nodes";
        } else {
            delete input.dataset.various;
            input.style.opacity = "";
            input.title = "";
            input.value = value;
        }
    }

    _syncPanels() {
        const root = this._rootEl;
        if (!root) return;
        const panel = root.querySelector(".cc-qg-stylepanel");
        const delBtn = root.querySelector('[data-qg="deledge"]');
        const removeBtn = root.querySelector('[data-qg="removeentity"]');

        const targets = this._panelTargets();
        const multi = targets.length >= 2;
        const hasEdge = !!this._selectedEdgeId;
        if (delBtn) delBtn.disabled = !hasEdge && !multi;
        const addBtn = root.querySelector('[data-qg="addedge"]');
        if (addBtn) addBtn.title = multi
            ? "Link the selected nodes (left = parent, right = child)"
            : "Click then drag from one node to another";

        if (!targets.length || !panel) {
            if (panel) panel.style.display = "none";
            return;
        }

        panel.style.display = "flex";
        const nodes = targets.map((id) => this.network.body.data.nodes.get(id)).filter(Boolean);
        const anyQuest = nodes.some((n) => n.ccKind !== "entity");
        const anyEntity = nodes.some((n) => n.ccKind === "entity");

        const title = root.querySelector(".cc-qg-style-title");
        if (title) {
            title.textContent = multi
                ? `${targets.length} nodes selected`
                : (nodes[0]?.label ? `Node: ${nodes[0].label}` : "Node");
        }

        // Status: shown when ANY selected node is a quest; reflects only quests.
        const statusSel = root.querySelector(".cc-qg-status");
        const statusLbl = root.querySelector(".cc-qg-statuswrap");
        if (statusSel && statusLbl) {
            statusSel.style.display = anyQuest ? "" : "none";
            statusLbl.style.display = anyQuest ? "flex" : "none";
            if (anyQuest) {
                const vals = targets
                    .filter((id) => this.network.body.data.nodes.get(id)?.ccKind !== "entity")
                    .map((id) => this._statusValueOf(id));
                this._setSelectValue(statusSel, this._commonValue(vals));
            }
        }

        // Category / shape / size / colour apply to every selected node.
        const cats = targets.map((id) => {
            const isEntity = this.network.body.data.nodes.get(id)?.ccKind === "entity";
            return this._categoryFor(id, !isEntity);
        });
        const styles = targets.map((id) => {
            const isEntity = this.network.body.data.nodes.get(id)?.ccKind === "entity";
            return this._resolveNodeStyle(id, !isEntity);
        });
        this._setSelectValue(root.querySelector(".cc-qg-cat"), this._commonValue(cats));
        this._setSelectValue(root.querySelector(".cc-qg-shape"), this._commonValue(styles.map((s) => s.shape)));
        this._setVariousInput(root.querySelector(".cc-qg-size"), this._commonValue(styles.map((s) => String(s.size))));
        this._setVariousInput(root.querySelector(".cc-qg-color"), this._commonValue(styles.map((s) => this._toHex(s.color))));

        // "Remove entity" only makes sense for a single selected entity node.
        if (removeBtn) removeBtn.style.display = (!multi && anyEntity) ? "inline-block" : "none";
    }

    /** Map a quest's statusClass to the panel's status-select value. */
    _statusValueOf(uuid) {
        switch (this._statusByUuid.get(uuid)) {
            case "completed": return "success";
            case "failed": return "failure";
            case "inactive": return "inactive";
            default: return "active";
        }
    }

    _toHex(color) {
        if (typeof color === "string" && color.startsWith("#")) {
            if (color.length === 4) return "#" + color.slice(1).split("").map((c) => c + c).join("");
            return color;
        }
        // rgb(...) -> hex
        const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || "");
        if (m) {
            return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
        }
        return "#b9a987";
    }

    async _applyNodeStyle(patch, isCategory = false, persist = true) {
        // A control left on "— Various —" must not touch any node.
        for (const k of Object.keys(patch)) {
            if (patch[k] === QuestGraphWidget.VARIOUS) return;
        }
        const targets = this._panelTargets();
        if (!targets.length) return;
        for (const uuid of targets) {
            await this._applyNodeStyleOne(uuid, patch, isCategory);
        }
        if (persist) await this._persistNow();
        if (isCategory) this._syncPanels();
    }

    /** Apply a style patch to ONE node (no persist/sync — the caller batches). */
    async _applyNodeStyleOne(uuid, patch, isCategory) {
        const current = this._state.nodeStyles[uuid] || {};
        const prevCategory = current.category;
        const next = { ...current, ...patch };
        // Choosing a category resets the explicit shape/size/colour to that preset
        if (isCategory && patch.category) {
            const preset = QuestGraphWidget.CATEGORY_PRESETS[patch.category];
            if (preset) {
                next.shape = preset.shape;
                next.size = preset.size;
                next.color = preset.color;
            }
        }
        this._state.nodeStyles[uuid] = next;

        const node = this.network.body.data.nodes.get(uuid);
        const isEntity = node?.ccKind === "entity";
        let meta;
        if (isEntity) {
            const doc = await fromUuid(uuid).catch(() => null);
            const resolved = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
            meta = this._entityMeta(uuid, node?.label, resolved);
        } else {
            const statusClass = this._statusByUuid.get(uuid) || "active";
            meta = this._questMeta(uuid, node?.label, statusClass, this._imageFor(await fromUuid(uuid).catch(() => null)));
        }
        const update = { id: uuid, size: meta.size };
        this._applyRenderer(update, meta);
        this.network.body.data.nodes.update(update);
        // Categorising a quest as an Encounter seeds the encounter template into
        // its description (once); changing it AWAY from Encounter removes that
        // block again (only the block, leaving the rest of the description).
        if (isCategory && patch.category && !isEntity) {
            if (patch.category === "encounter") {
                await this._insertEncounterTemplate(uuid);
            } else if (prevCategory === "encounter") {
                await this._removeEncounterTemplate(uuid);
            }
        }
    }

    /**
     * Insert the encounter HTML block into a quest's description, but only if it
     * isn't already present (guarded by the marker comment).
     */
    async _insertEncounterTemplate(uuid) {
        if (!this.isGM) return;
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) return;
        if (doc.getFlag?.("campaign-codex", "type") !== "quest") return;
        const data = doc.getFlag("campaign-codex", "data") || {};
        const desc = String(data.description || "");
        if (desc.includes("cc-encounter-template")) return; // already inserted
        const next = desc.trim() ? `${desc}\n${QuestGraphWidget.ENCOUNTER_TEMPLATE}` : QuestGraphWidget.ENCOUNTER_TEMPLATE;
        await doc.setFlag("campaign-codex", "data.description", next);
        await this._refreshQuestSheets([uuid]);
        ui.notifications?.info(`Encounter template added to "${doc.name}".`);
    }

    /**
     * Remove ONLY the encounter HTML block this widget inserted, leaving the rest
     * of the description intact. Blocks written with both markers are cut between
     * them; legacy blocks (start marker only, always appended at the end) are cut
     * from the marker to the end of the text.
     */
    async _removeEncounterTemplate(uuid) {
        if (!this.isGM) return;
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) return;
        if (doc.getFlag?.("campaign-codex", "type") !== "quest") return;
        const data = doc.getFlag("campaign-codex", "data") || {};
        const desc = String(data.description || "");
        const START = QuestGraphWidget.ENCOUNTER_MARKER_START;
        const END = QuestGraphWidget.ENCOUNTER_MARKER_END;
        if (!desc.includes(START)) return;

        let next;
        if (desc.includes(END)) {
            // Fully-marked block: remove start..end (and a leading blank line).
            next = desc.replace(/\n?[ \t]*<!-- cc-encounter-template -->[\s\S]*?<!-- \/cc-encounter-template -->[ \t]*/g, "");
        } else {
            // Legacy block with no end marker: it was appended at the end.
            let i = desc.indexOf(START);
            if (i > 0 && desc[i - 1] === "\n") i -= 1;
            next = desc.slice(0, i);
        }
        next = next.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
        if (next === desc) return;
        await doc.setFlag("campaign-codex", "data.description", next);
        await this._refreshQuestSheets([uuid]);
        ui.notifications?.info(`Encounter template removed from "${doc.name}".`);
    }

    /* -------------------------------------------- */
    /*  Edge create / delete / recolour             */
    /* -------------------------------------------- */

    /** (Re)install the add-edge manipulation handler and enter add-edge mode.
     *  Called when enabling draw mode AND after every refresh/setData (which
     *  drops vis's edit mode) so the Link button stays active for many links. */
    _armDrawMode() {
        if (!this.network) return;
        this.network.setOptions({
            manipulation: {
                enabled: false,
                addEdge: (edgeData, callback) => {
                    callback(null);                 // discard vis's temp edge; we own the dataset
                    this._onAddEdge(edgeData);      // write the link + draw it
                    if (this._drawMode) { try { this.network.addEdgeMode(); } catch (e) { /* ignore */ } }
                },
            },
        });
        try { this.network.addEdgeMode(); } catch (e) { /* ignore */ }
    }

    /**
     * Toggle a persistent "draw link" mode so several connections can be drawn
     * in a row without re-clicking the button. Click again (or it auto-clears on
     * destroy) to leave the mode.
     */
    _toggleDrawMode() {
        if (!this.network) return;
        this._drawMode = !this._drawMode;
        const btn = this._rootEl?.querySelector('[data-qg="addedge"]');
        if (this._drawMode) {
            if (btn) {
                btn.classList.add("cc-qg-active");
                btn.style.background = "var(--cc-accent, #d4af37)";
                btn.style.color = "#1b1b1b";
            }
            this._armDrawMode();
            // Draw mode is a sticky toggle: it re-enters addEdgeMode after every
            // link (see addEdge callback) AND after every refresh so you can draw
            // many in a row. Escape or clicking the button again exits.
            if (!this._escHandler) {
                this._escHandler = (e) => { if (e.key === "Escape" && this._drawMode) this._toggleDrawMode(); };
                document.addEventListener("keydown", this._escHandler);
            }
        } else {
            if (btn) { btn.classList.remove("cc-qg-active"); btn.style.background = ""; btn.style.color = ""; }
            try { this.network.disableEditMode(); } catch (e) { /* ignore */ }
            if (this._escHandler) { document.removeEventListener("keydown", this._escHandler); this._escHandler = null; }
        }
    }

    async _onAddEdge(edgeData) {
        if (await this._createLink(edgeData.from, edgeData.to)) await this._persistNow();
    }

    /**
     * Create a single link from -> to (parent -> child for quest pairs; quest
     * <-> entity writes the quest's relatedUuids). Adds the edge to the live
     * dataset. Returns true on success. Does NOT persist (callers batch that).
     */
    async _createLink(from, to) {
        if (!from || !to || from === to) return false;
        const fromNode = this.network.body.data.nodes.get(from);
        const toNode = this.network.body.data.nodes.get(to);
        const fromIsQuest = fromNode?.ccKind === "quest";
        const toIsQuest = toNode?.ccKind === "quest";

        let isRelated;
        if (fromIsQuest && toIsQuest) {
            // quest -> quest : parent unlocks child, child depends on parent
            const ok = await this._writeQuestLink(from, to, true);
            if (!ok) return false;
            isRelated = false;
        } else {
            // quest <-> entity : write to the quest's relatedUuids
            const questUuid = fromIsQuest ? from : (toIsQuest ? to : null);
            const otherUuid = fromIsQuest ? to : from;
            if (!questUuid) {
                ui.notifications?.warn("At least one end of the link must be a quest.");
                return false;
            }
            await this._writeRelatedLink(questUuid, otherUuid, true);
            isRelated = true;
        }

        // Add/refresh the edge in the live dataset (colour derives from status).
        const edge = this._makeEdge(from, to, isRelated);
        this.network.body.data.edges.update(edge);
        return true;
    }

    /**
     * Link the selected nodes. Two nodes -> a single parent->child link (the
     * left-most node by x is the parent). Three or more -> a nearest-neighbour
     * chain starting from the left-most node, so each node connects to a nearby
     * one (left = parent, right = child on every hop).
     */
    async _linkSelected(ids) {
        if (!this.isGM || !this.network) return;
        ids = ids.filter((id) => this.network.body.data.nodes.get(id));
        if (ids.length < 2) return;
        let ps;
        try { ps = this.network.getPositions(ids); } catch (e) { return; }
        const xOf = (id) => (ps[id]?.x ?? 0);
        const yOf = (id) => (ps[id]?.y ?? 0);

        // Ordered list of pairs to link.
        const pairs = [];
        if (ids.length === 2) {
            pairs.push([ids[0], ids[1]]);
        } else {
            // Nearest-neighbour chain from the left-most node.
            const remaining = new Set(ids);
            let current = ids.slice().sort((a, b) => xOf(a) - xOf(b))[0];
            remaining.delete(current);
            while (remaining.size) {
                let best = null, bestD = Infinity;
                for (const id of remaining) {
                    const dx = xOf(id) - xOf(current), dy = yOf(id) - yOf(current);
                    const d = dx * dx + dy * dy;
                    if (d < bestD) { bestD = d; best = id; }
                }
                pairs.push([current, best]);
                remaining.delete(best);
                current = best;
            }
        }

        let linked = 0;
        for (const [a, b] of pairs) {
            // Parent = left-most (smaller x); tie-break on y (upper = parent).
            const parent = (xOf(a) < xOf(b) || (xOf(a) === xOf(b) && yOf(a) <= yOf(b))) ? a : b;
            const child = parent === a ? b : a;
            if (await this._createLink(parent, child)) linked++;
        }
        if (linked) {
            await this._persistNow();
            ui.notifications?.info(`Linked ${linked} connection${linked === 1 ? "" : "s"}.`);
        } else {
            ui.notifications?.warn("Could not link the selected nodes.");
        }
    }

    /**
     * Remove every link that runs BETWEEN two selected nodes. Links from a
     * selected node to an UNSELECTED node are left intact.
     */
    async _unlinkSelected(ids) {
        if (!this.isGM || !this.network) return;
        const idSet = new Set(ids.filter((id) => this.network.body.data.nodes.get(id)));
        if (idSet.size < 2) return;
        const edges = this.network.body.data.edges.get()
            .filter((e) => idSet.has(e.from) && idSet.has(e.to));
        if (!edges.length) { ui.notifications?.info("No links between the selected nodes."); return; }
        for (const edge of edges) await this._removeLink(edge);
        await this._persistNow();
        ui.notifications?.info(`Removed ${edges.length} link${edges.length === 1 ? "" : "s"} between selected nodes.`);
    }

    async _deleteSelectedEdge() {
        const edgeId = this._selectedEdgeId;
        if (!edgeId) return;
        const edge = this.network.body.data.edges.get(edgeId);
        if (!edge) return;
        await this._removeLink(edge);
        this._selectedEdgeId = null;
        this._syncPanels();
        await this._persistNow();
    }

    /**
     * Remove one link: unwrite the quest/related flags and drop the edge from
     * the live dataset. Does NOT persist widget state — callers batch that.
     */
    async _removeLink(edge) {
        if (!edge) return;
        const fromNode = this.network.body.data.nodes.get(edge.from);
        const toNode = this.network.body.data.nodes.get(edge.to);
        const fromIsQuest = fromNode?.ccKind === "quest";
        const toIsQuest = toNode?.ccKind === "quest";

        if (fromIsQuest && toIsQuest) {
            await this._writeQuestLink(edge.from, edge.to, false);
        } else {
            const questUuid = fromIsQuest ? edge.from : edge.to;
            const otherUuid = fromIsQuest ? edge.to : edge.from;
            await this._writeRelatedLink(questUuid, otherUuid, false);
        }

        delete this._state.edgeStyles[edge.id];
        this.network.body.data.edges.remove(edge.id);
    }

    /* -------------------------------------------- */
    /*  Quest status (success / failure / inactive) */
    /* -------------------------------------------- */

    /**
     * Apply a status to the selected quest node and cascade it to its children.
     *  - success  : quest completed + gold outline; child quests have their
     *               inactive flag cleared (re-activated).
     *  - failure  : quest failed + red outline; child quests are set inactive,
     *               UNLESS a child still has another parent that is not
     *               inactive/failed (i.e. it's reachable another way).
     *  - inactive : quest greyed out.
     *  - active   : cleared back to the neutral state.
     * Writing the quest flags fires updateJournalEntry, which the reactive hook
     * picks up to redraw outlines and link colours.
     */
    async _applyQuestStatus(status) {
        if (!this.isGM) return;
        if (status === QuestGraphWidget.VARIOUS) return;   // "— Various —" left untouched
        const targets = this._panelTargets()
            .filter((id) => this.network?.body.data.nodes.get(id)?.ccKind === "quest");
        if (!targets.length) return;

        const touched = new Set();
        for (const uuid of targets) {
            for (const u of await this._applyQuestStatusOne(uuid, status)) touched.add(u);
        }

        await this._refreshQuestSheets([...touched]);
        await this._refresh(false);
        this._recordHistory();
    }

    /** Apply a status to ONE quest and cascade to its children. Returns the
     *  uuids it touched; the caller batches the refresh + history record. */
    async _applyQuestStatusOne(uuid, status) {
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) return [];

        const patches = {
            active:   { completed: false, failed: false, inactive: false },
            success:  { completed: true,  failed: false, inactive: false },
            failure:  { completed: false, failed: true,  inactive: false },
            inactive: { completed: false, failed: false, inactive: true },
        };
        const patch = patches[status] || patches.active;
        await this._updateQuestStatusFlags(doc, patch);

        // Cascade to children for success / failure.
        const touched = [uuid];
        if (status === "success" || status === "failure") {
            const { childrenOf, parentsOf, statusByUuid } = this._questRelations();
            const children = childrenOf.get(uuid) || new Set();
            for (const childUuid of children) {
                const childDoc = await fromUuid(childUuid).catch(() => null);
                if (!childDoc) continue;
                if (status === "success") {
                    // Re-activate the child.
                    await this._updateQuestStatusFlags(childDoc, { inactive: false });
                    touched.push(childUuid);
                } else {
                    // Deactivate the child only if no OTHER parent keeps it alive.
                    const otherParents = [...(parentsOf.get(childUuid) || [])].filter((p) => p !== uuid);
                    const keptAlive = otherParents.some((p) => {
                        const s = statusByUuid.get(p);
                        return s && s !== "inactive" && s !== "failed";
                    });
                    if (!keptAlive) {
                        await this._updateQuestStatusFlags(childDoc, { inactive: true });
                        touched.push(childUuid);
                    }
                }
            }
        }
        return touched;
    }

    /** Patch the completed/failed/inactive flags on a quest document. */
    async _updateQuestStatusFlags(doc, patch) {
        const data = doc.getFlag("campaign-codex", "data") || {};
        const quests = foundry.utils.deepClone(Array.isArray(data.quests) ? data.quests : []);
        if (!quests.length) return false;
        const quest = quests[0];
        let changed = false;
        for (const key of ["completed", "failed", "inactive"]) {
            if (patch[key] !== undefined && Boolean(quest[key]) !== patch[key]) {
                quest[key] = patch[key];
                changed = true;
            }
        }
        if (!changed) return false;
        quest.updatedAt = Date.now();
        await doc.setFlag("campaign-codex", "data.quests", quests);
        return true;
    }

    /* -------------------------------------------- */
    /*  Quest document writers                      */
    /* -------------------------------------------- */

    async _getQuestRefKey(uuid) {
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) return null;
        const quest = this._getQuestRecord(doc);
        if (!quest?.id) return null;
        return `${uuid}::${quest.id}`;
    }

    /**
     * Write (or remove) a parent->child quest link.
     * parent.unlocks gains childRefKey; child.dependencies gains parentRefKey.
     */
    async _writeQuestLink(parentUuid, childUuid, add) {
        if (!this.isGM) return false;
        const parentDoc = await fromUuid(parentUuid).catch(() => null);
        const childDoc = await fromUuid(childUuid).catch(() => null);
        if (!parentDoc || !childDoc) return false;

        const parentRef = await this._getQuestRefKey(parentUuid);
        const childRef = await this._getQuestRefKey(childUuid);
        if (!parentRef || !childRef) return false;

        await this._updateQuestArray(parentDoc, "unlocks", childRef, add);
        await this._updateQuestArray(childDoc, "dependencies", parentRef, add);

        await this._refreshQuestSheets([parentUuid, childUuid]);
        return true;
    }

    async _writeRelatedLink(questUuid, entityUuid, add) {
        if (!this.isGM) return false;
        const questDoc = await fromUuid(questUuid).catch(() => null);
        if (!questDoc) return false;
        // relatedUuids stores the (possibly page-level) document uuid
        await this._updateQuestArray(questDoc, "relatedUuids", entityUuid, add);
        await this._refreshQuestSheets([questUuid]);
        return true;
    }

    async _updateQuestArray(doc, field, value, add) {
        const data = doc.getFlag("campaign-codex", "data") || {};
        const quests = foundry.utils.deepClone(Array.isArray(data.quests) ? data.quests : []);
        if (!quests.length) return;
        const quest = quests[0];
        quest[field] = Array.isArray(quest[field]) ? quest[field] : [];
        const has = quest[field].includes(value);
        if (add && !has) quest[field].push(value);
        else if (!add && has) quest[field] = quest[field].filter((v) => v !== value);
        else return; // no change
        quest.updatedAt = Date.now();
        await doc.setFlag("campaign-codex", "data.quests", quests);
    }

    async _refreshQuestSheets(uuids) {
        if (!game.campaignCodex?.scheduleSheetRefresh) return;
        for (const uuid of new Set(uuids)) {
            try { await game.campaignCodex.scheduleSheetRefresh(uuid); } catch (e) { /* ignore */ }
        }
    }

    /* -------------------------------------------- */
    /*  Entity drop-in                              */
    /* -------------------------------------------- */

    _bindDropZone(root) {
        const wrap = root.querySelector(".cc-qg-canvaswrap");
        if (!wrap) return;
        this._boundDragOver = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; };
        this._boundDrop = (ev) => this._onDropEntity(ev, wrap);
        wrap.addEventListener("dragover", this._boundDragOver);
        wrap.addEventListener("drop", this._boundDrop);
    }

    async _onDropEntity(event, wrap) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try {
            const TE = foundry.applications?.ux?.TextEditor?.implementation || globalThis.TextEditor;
            data = TE?.getDragEventData ? TE.getDragEventData(event) : JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (e2) { return; }
        }
        if (!data) return;

        // Resolve a uuid for the dropped document
        let uuid = data.uuid;
        if (!uuid && data.type && data.id) {
            // Best-effort for older drag payloads
            uuid = `${data.type}.${data.id}`;
        }
        if (!uuid) return;

        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) { ui.notifications?.warn("Could not resolve the dropped document."); return; }

        const resolved = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
        const isQuest = resolved.getFlag?.("campaign-codex", "type") === "quest";

        // Compute canvas coordinates from the drop point
        const rect = wrap.getBoundingClientRect();
        const domPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const canvasPoint = this.network ? this.network.DOMtoCanvas(domPoint) : { x: 0, y: 0 };
        const pos = { x: this._snap(canvasPoint.x), y: this._snap(canvasPoint.y) };

        if (isQuest) {
            // Quests are auto-populated; just reposition / focus it.
            this._state.positions[resolved.uuid] = pos;
            // A quest hidden by "Hide isolated" that is dragged back onto the
            // canvas is explicitly exempted from the filter from now on (the
            // exemption clears itself automatically once it gains a link).
            if (this._state.hideIsolated && !this._state.isolatedExempt.includes(resolved.uuid)) {
                this._state.isolatedExempt.push(resolved.uuid);
            }
            if (this.network?.body.data.nodes.get(resolved.uuid)) {
                this.network.moveNode(resolved.uuid, pos.x, pos.y);
            } else {
                await this._refresh();
            }
            this._markManual([resolved.uuid]);
            try { this.network?.selectNodes([resolved.uuid]); } catch (e) { /* ignore */ }
            this._selectedNodeId = resolved.uuid;
            this._selectedNodeIds = [resolved.uuid];
            this._recomputeSelectionBounds();
            await this._persistNow();
            return;
        }

        // Non-quest entity: add to the graph as a linkable node
        if (!this._state.extraEntities.includes(resolved.uuid)) {
            this._state.extraEntities.push(resolved.uuid);
        }
        this._state.positions[resolved.uuid] = pos;
        await this._persistNow();

        this._markManual([resolved.uuid]);
        const node = await this._createEntityNode(resolved.uuid);
        if (node) {
            node.x = pos.x; node.y = pos.y;
            this.network.body.data.nodes.update(node);
            this.network.selectNodes([resolved.uuid]);
            this._selectedNodeId = resolved.uuid;
            this._selectedNodeIds = [resolved.uuid];
            this._recomputeSelectionBounds();
            this._syncPanels();
        }
        ui.notifications?.info(`Added "${resolved.name}". Draw a link from a quest to connect it.`);
    }

    async _removeSelectedEntity() {
        const uuid = this._selectedNodeId;
        if (!uuid) return;
        const node = this.network.body.data.nodes.get(uuid);
        if (node?.ccKind !== "entity") return;

        // Remove related links from every quest pointing at this entity
        for (const rec of this._scanQuests()) {
            const related = Array.isArray(rec.quest.relatedUuids) ? rec.quest.relatedUuids : [];
            if (related.includes(uuid)) await this._writeRelatedLink(rec.uuid, uuid, false);
        }

        this._state.extraEntities = this._state.extraEntities.filter((u) => u !== uuid);
        this._state.hiddenNodes = this._state.hiddenNodes.filter((u) => u !== uuid);
        delete this._state.positions[uuid];
        delete this._state.nodeStyles[uuid];
        // Remove any edges touching this node from styling map
        for (const key of Object.keys(this._state.edgeStyles)) {
            if (key.includes(uuid)) delete this._state.edgeStyles[key];
        }
        this.network.body.data.nodes.remove(uuid);
        this._state.manualPositions = (this._state.manualPositions || []).filter((u) => u !== uuid);
        this._clearMultiSelection();
        this._syncPanels();
        await this._persistNow();
    }

    /* -------------------------------------------- */
    /*  Refresh / auto-arrange                      */
    /* -------------------------------------------- */

    async _refresh(notify = false) {
        if (!this.network) return;
        // Do NOT reload _state from disk here: in-memory state is authoritative
        // and may hold un-flushed style/position edits. Quest data is re-read
        // fresh by _scanQuests inside _buildGraphData regardless. Existing nodes
        // keep their saved positions; only genuinely new nodes get placed.
        // Preserve the current pan/zoom across the rebuild so a refresh never
        // jumps the view (only an explicit Fit / Auto-Arrange should).
        let prev = null;
        try {
            const s = this.network.getScale();
            if (Number.isFinite(s) && s > 0) prev = { scale: s, position: this.network.getViewPosition() };
        } catch (e) { /* ignore */ }

        const { nodes, edges } = await this._buildGraphData();
        this.network.setData({ nodes, edges });
        // setData clears vis's selection; re-apply our multi-selection so the
        // bounding box and highlight survive a structural refresh.
        if ((this._selectedNodeIds?.length || 0) >= 2) {
            const still = this._selectedNodeIds.filter((id) => nodes.some((n) => n.id === id));
            this._selectedNodeIds = still;
            try { this.network.selectNodes(still); } catch (e) { /* ignore */ }
        }
        this._recomputeSelectionBounds();
        const emptyEl = this._rootEl?.querySelector(".cc-qg-empty");
        if (emptyEl) emptyEl.style.display = nodes.length ? "none" : "flex";

        if (prev) {
            try { this.network.moveTo({ scale: prev.scale, position: prev.position, animation: false }); }
            catch (e) { /* ignore */ }
            // Persist the preserved view so reopening shows exactly this framing.
            this._saveViewDebounced();
        } else {
            this._restoreView();
        }
        // setData drops edit mode; resume it if the user is mid draw-link.
        if (this._drawMode) { try { this._armDrawMode(); } catch (e) { /* ignore */ } }
        // A refresh rebuilds the graph data but keeps the widget alive; if a node
        // is still selected, re-open its config panel so status/style edits (which
        // trigger a refresh) don't make the panel vanish.
        if (this.isGM && this._selectedNodeId
            && this.network.body.data.nodes.get(this._selectedNodeId)) {
            this._syncPanels();
        }
        if (notify) ui.notifications?.info("Quest graph refreshed.");
    }

    async _autoArrange() {
        if (!this.network) return;
        // With a live multi-selection, sort ONLY those nodes among themselves
        // (anchored at their current centroid) and leave the rest untouched.
        const sel = (this._selectedNodeIds || []).filter((id) => this.network.body.data.nodes.get(id));
        if (sel.length >= 2) { await this._autoArrangeSelection(sel); return; }
        const { nodes, edges, allNodeIds } = await this._buildGraphData();
        // Recompute the grid from the link structure. Deterministic layered
        // layout — no physics, no gravity. Only VISIBLE nodes are arranged:
        // quests hidden by "Hide isolated" keep their saved spot (wiping them
        // would make every hidden quest count as "new" on the next build and
        // string them out along an endless row). Positions of nodes that no
        // longer exist at all are pruned here.
        const layout = this._layeredPositions(nodes, edges);
        const prevPositions = this._state.positions;
        this._state.positions = {};
        for (const id of allNodeIds) {
            if (layout[id]) this._state.positions[id] = layout[id];
            else if (prevPositions[id]) this._state.positions[id] = prevPositions[id];
        }
        for (const node of nodes) {
            const p = this._state.positions[node.id] || { x: this._snap(0), y: this._snap(0) };
            node.x = p.x;
            node.y = p.y;
            this._state.positions[node.id] = p;
        }
        this.network.setData({ nodes, edges });
        this._markManual(nodes.map((n) => n.id));
        await this._persistNow();
        this._fitGraph(true);
        ui.notifications?.info("Quest graph auto-arranged.");
    }

    /**
     * Auto-sort ONLY the selected nodes. Runs the same deterministic layered
     * layout on the sub-graph formed by the selection (edges strictly between
     * selected nodes), then offsets it so the group's centroid stays put — the
     * surrounding graph and the camera don't move.
     */
    async _autoArrangeSelection(ids) {
        const idSet = new Set(ids);
        const nodes = ids.map((id) => this.network.body.data.nodes.get(id)).filter(Boolean);
        if (nodes.length < 2) return;
        const edges = this.network.body.data.edges.get()
            .filter((e) => idSet.has(e.from) && idSet.has(e.to));

        // Current centroid, to anchor the new layout in place.
        let cur;
        try { cur = this.network.getPositions(ids); } catch (e) { cur = {}; }
        let cx0 = 0, cy0 = 0, n0 = 0;
        for (const id of ids) { const p = cur[id]; if (p) { cx0 += p.x; cy0 += p.y; n0++; } }
        if (n0) { cx0 /= n0; cy0 /= n0; }

        const layout = this._layeredPositions(nodes, edges);
        let lx = 0, ly = 0, n1 = 0;
        for (const id of ids) { const p = layout[id]; if (p) { lx += p.x; ly += p.y; n1++; } }
        if (n1) { lx /= n1; ly /= n1; }
        const offX = this._snap(cx0 - lx), offY = this._snap(cy0 - ly);

        for (const node of nodes) {
            const p = layout[node.id];
            if (!p) continue;
            const x = this._snap(p.x + offX), y = this._snap(p.y + offY);
            this._state.positions[node.id] = { x, y };
            try { this.network.moveNode(node.id, x, y); } catch (e) { /* ignore */ }
        }
        this._markManual(ids);
        this._recomputeSelectionBounds();
        try { this.network.redraw(); } catch (e) { /* ignore */ }
        await this._persistNow();
        ui.notifications?.info(`Auto-sorted ${nodes.length} selected node${nodes.length === 1 ? "" : "s"}.`);
    }

    /** Cleanup if the widget element is torn down. */
    destroy() {
        try {
            if (this._boundDrop && this._rootEl) {
                const wrap = this._rootEl.querySelector(".cc-qg-canvaswrap");
                wrap?.removeEventListener("drop", this._boundDrop);
                wrap?.removeEventListener("dragover", this._boundDragOver);
            }
            this._drawMode = false;
            if (this._escHandler) { document.removeEventListener("keydown", this._escHandler); this._escHandler = null; }
            if (this._updateHookId) { Hooks.off("updateJournalEntry", this._updateHookId); this._updateHookId = null; }
            clearTimeout(this._reactiveTimer);
            clearTimeout(this._saveTimer);
            this._teardownNetwork();
        } catch (e) { /* ignore */ }
    }
}
}