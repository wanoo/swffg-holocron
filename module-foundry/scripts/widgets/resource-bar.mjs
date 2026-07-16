// import { CampaignCodexWidget } from "./CampaignCodexWidget.js";

/**
 * ResourceBarWidget
 * Companion to the Progress Clock. Reuses the clock's own root class
 * (`cc-widget-progress-clock`) and shell classes so the card, flip animation,
 * fonts, inputs and controls are identical.
 *
 *  - Front face  : the resource bars (name, segments, running total).
 *  - Back face   : compact options revealed by the flip (+/- bars, name,
 *                  free segment count up to 100). No bars here, to stay tight.
 *  - Width       : the clock's container is styled to 25% (4-up). Resource
 *                  Bars has no such CSS rule, so we set the container to
 *                  `flex: 0 1 50%` inline in activateListeners → 2-up
 *                  (half page), matching the Mini Calendar pattern.
 *  - Height      : the flip-card needs a fixed height (absolute faces), so we
 *                  compute one from the bar count instead of hard-coding.
 *
 * Self-contained: no separate .css, no injected <style>. Only the small
 * bar-specific layout is inline; everything else is inherited.
 */
export function createResourceBarWidget (CampaignCodexWidget) {
return class ResourceBarWidget extends CampaignCodexWidget {

    constructor(widgetId, widgetData, document) {
        super(widgetId, widgetData, document);
    }

    static MAX_BARS = 4;
    static MAX_SEGMENTS = 100;

    // Cohesive deep-earth palette (danger -> full).
    static COLORS = {
        bordeaux: "#6E1423",
        brick:    "#B34724",
        amber:    "#D9962B",
        olive:    "#6E7B3D",
        navy:     "#23415F",
    };

    _defaultBar() {
        return { name: "Resource", max: 10, current: 0 };
    }

    // Active segments share one colour, chosen by how full the bar is.
    _segmentColor(current, max) {
        if (current <= 0 || max <= 0) return null;
        const C = ResourceBarWidget.COLORS;
        const pct = (current / max) * 100;
        if (pct <= 10) return C.bordeaux;
        if (pct <= 25) return C.brick;
        if (pct <= 50) return C.amber;
        if (pct <= 75) return C.olive;
        return C.navy;
    }

    _normalizeBars(rawBars) {
        let bars = Array.isArray(rawBars) && rawBars.length ? rawBars : [this._defaultBar()];
        bars = bars.slice(0, ResourceBarWidget.MAX_BARS).map((b) => {
            const max = Math.max(1, Math.min(ResourceBarWidget.MAX_SEGMENTS, parseInt(b?.max) || 10));
            const current = Math.max(0, Math.min(max, parseInt(b?.current) || 0));
            return { name: (b?.name ?? "Resource").toString(), max, current };
        });
        return bars;
    }

    async _prepareContext() {
        const savedData = (await this.getData()) || {};
        return {
            id: this.widgetId,
            title: savedData.title || "New Tracker",
            bars: this._normalizeBars(savedData.bars),
            isGM: this.isGM,
        };
    }

    // ---- Front face: the bars --------------------------------------------
    _renderBar(bar, index) {
        const color = this._segmentColor(bar.current, bar.max);
        const gap = bar.max > 30 ? 1 : 2;
        const segBase = "flex:1 1 0;min-width:0;border-radius:2px;transition:background-color 0.3s ease,box-shadow 0.3s ease;";
        const segIdle = "background:rgba(255,255,255,0.08);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.25);";
        const segOn = (c) => `background:${c};box-shadow:inset 0 0 2px rgba(0,0,0,0.4);`;

        let segments = "";
        for (let i = 0; i < bar.max; i++) {
            const on = i < bar.current;
            segments += `<div style="${segBase}${on ? segOn(color) : segIdle}"></div>`;
        }

        return `
            <div class="res-bar-row" data-bar-index="${index}" title="Left-Click: Add | Right-Click: Remove"
                 style="display:flex;flex-direction:column;gap:2px;cursor:pointer;user-select:none;width:100%;">
                <div style="font-size:0.72rem;font-weight:600;opacity:0.85;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${bar.name}</div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="display:flex;flex:1 1 auto;gap:${gap}px;height:16px;padding:2px;border-radius:4px;background:rgba(0,0,0,0.3);overflow:hidden;">${segments}</div>
                    <div style="flex:0 0 auto;min-width:30px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:0.95rem;">${bar.current}<span style="font-size:0.7em;opacity:0.55;">/${bar.max}</span></div>
                </div>
            </div>
        `;
    }

    // ---- Back face: compact options --------------------------------------
    _renderConfigRow(bar, index) {
        return `
            <div class="res-config-row" data-bar-index="${index}"
                 style="display:flex;align-items:center;gap:4px;width:100%;">
                <input type="text" class="clock-input-max res-input-name" value="${bar.name}" placeholder="Name"
                       style="flex:1 1 auto;min-width:0;"/>
                <input type="number" class="clock-input-max res-input-max" value="${bar.max}" min="1" max="${ResourceBarWidget.MAX_SEGMENTS}"
                       title="Segments (1-${ResourceBarWidget.MAX_SEGMENTS})" style="flex:0 0 auto;width:54px;"/>
            </div>
        `;
    }

    async render() {
        const data = await this._prepareContext();
        const barCount = data.bars.length;

        // Fixed height for the flip-card, scaled to the number of bars so it
        // stays snug on the front and never clips the options on the back.
        const cardHeight = 96 + barCount * 34;

        return `
            <div class="cc-widget-progress-clock standard cc-widget-resource-bars" id="widget-${this.widgetId}" style="height:${cardHeight}px;">
                <div class="cc-widget-card${this._flipped ? " flipped" : ""}">

                    <div class="cc-widget-face cc-widget-front">
                        ${this.isGM
                            ? `<input type="text" class="rel-title-input" value="${data.title}" placeholder="Widget Title" title="Click to edit title"/>`
                            : `<h4 class="rel-title">${data.title}</h4>`
                        }
                        <div class="res-bars-container" style="display:flex;flex-direction:column;gap:8px;width:100%;padding:2px 0;">
                            ${data.bars.map((b, i) => this._renderBar(b, i)).join("")}
                        </div>
                        <div class="clock-controls">
                            ${data.isGM ? `<i class="fas fa-cog clock-settings-toggle" data-action="flip"></i>` : ""}
                        </div>
                    </div>

                    <div class="cc-widget-face cc-widget-back">
                        <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
                            <div style="display:flex;align-items:center;justify-content:center;gap:12px;">
                                <i class="fas fa-minus" data-action="remove-bar" title="Remove bar" style="cursor:pointer;opacity:0.75;padding:2px;"></i>
                                <span class="res-bar-total" style="font-weight:700;min-width:3.5ch;text-align:center;">Bars: ${barCount}</span>
                                <i class="fas fa-plus" data-action="add-bar" title="Add bar" style="cursor:pointer;opacity:0.75;padding:2px;"></i>
                            </div>
                            <div class="res-config-list" style="display:flex;flex-direction:column;gap:4px;width:100%;">
                                ${data.bars.map((b, i) => this._renderConfigRow(b, i)).join("")}
                            </div>
                            <button class="clock-btn reset" data-action="clear" style="align-self:center;margin-top:2px;">Clear All</button>
                        </div>
                        <i class="fas fa-undo clock-settings-toggle" data-action="flip"></i>
                    </div>

                </div>
            </div>
        `;
    }

    async activateListeners(htmlElement) {
        // Make the widget occupy half the row (2 side-by-side). The default
        // container flex is `1 0 100%`; overriding it inline (no !important on
        // the default rule) cleanly matches the clock's container-based sizing.
        const container = htmlElement?.parentElement;
        if (container?.classList?.contains("cc-widget-container")) {
            container.style.flex = "0 1 50%";
        }

        if (!this.isGM) return;

        const card = () => htmlElement.querySelector(".cc-widget-card");
        const isFlipped = () => card()?.classList.contains("flipped");

        // Step size from modifiers: Shift = 10, Ctrl = 5, otherwise 1.
        const stepFor = (e) => (e.shiftKey ? 10 : (e.ctrlKey || e.metaKey) ? 5 : 1);

        // Left / right click each bar (front face only)
        htmlElement.querySelectorAll(".res-bar-row").forEach((row) => {
            const index = parseInt(row.dataset.barIndex);
            row.addEventListener("click", async (e) => {
                e.preventDefault();
                if (isFlipped()) return;
                await this._updateBar(index, stepFor(e), htmlElement);
            });
            row.addEventListener("contextmenu", async (e) => {
                e.preventDefault();
                if (isFlipped()) return;
                await this._updateBar(index, -stepFor(e), htmlElement);
            });
        });

        // Title
        htmlElement.querySelector(".rel-title-input")?.addEventListener("change", async (e) => {
            e.preventDefault();
            await this._saveTitle(e.target.value);
        });

        // Flip (remember state so option edits, which trigger a re-render,
        // keep the card on the options side instead of snapping to the front)
        htmlElement.querySelectorAll('[data-action="flip"]').forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const c = card();
                if (!c) return;
                c.classList.toggle("flipped");
                this._flipped = c.classList.contains("flipped");
            });
        });

        // Add / remove bars
        htmlElement.querySelector('[data-action="add-bar"]')?.addEventListener("click", async (e) => {
            e.preventDefault();
            const savedData = (await this.getData()) || {};
            const bars = this._normalizeBars(savedData.bars);
            if (bars.length >= ResourceBarWidget.MAX_BARS) return;
            bars.push(this._defaultBar());
            await this.saveData({ ...savedData, bars });
            this._refreshWidget(htmlElement);
        });

        htmlElement.querySelector('[data-action="remove-bar"]')?.addEventListener("click", async (e) => {
            e.preventDefault();
            const savedData = (await this.getData()) || {};
            const bars = this._normalizeBars(savedData.bars);
            if (bars.length <= 1) return;
            bars.pop();
            await this.saveData({ ...savedData, bars });
            this._refreshWidget(htmlElement);
        });

        // Per-bar name + free segment count (1-100)
        htmlElement.querySelectorAll(".res-config-row").forEach((rowEl) => {
            const index = parseInt(rowEl.dataset.barIndex);

            rowEl.querySelector(".res-input-name")?.addEventListener("change", async (e) => {
                const savedData = (await this.getData()) || {};
                const bars = this._normalizeBars(savedData.bars);
                if (bars[index]) bars[index].name = e.target.value;
                await this.saveData({ ...savedData, bars });
                this._refreshWidget(htmlElement);
            });

            rowEl.querySelector(".res-input-max")?.addEventListener("change", async (e) => {
                const savedData = (await this.getData()) || {};
                const bars = this._normalizeBars(savedData.bars);
                if (bars[index]) {
                    const newMax = Math.max(1, Math.min(ResourceBarWidget.MAX_SEGMENTS, parseInt(e.target.value) || 1));
                    bars[index].max = newMax;
                    bars[index].current = Math.min(bars[index].current, newMax);
                }
                await this.saveData({ ...savedData, bars });
                this._refreshWidget(htmlElement);
            });
        });

        // Clear all
        htmlElement.querySelector('[data-action="clear"]')?.addEventListener("click", async (e) => {
            e.preventDefault();
            const savedData = (await this.getData()) || {};
            const bars = this._normalizeBars(savedData.bars).map((b) => ({ ...b, current: 0 }));
            await this.saveData({ ...savedData, bars });
            this._refreshWidget(htmlElement);
        });
    }

    async _saveTitle(newTitle) {
        const savedData = (await this.getData()) || {};
        await this.saveData({ ...savedData, title: newTitle });
    }

    async _updateBar(index, delta, htmlElement) {
        const savedData = (await this.getData()) || {};
        const bars = this._normalizeBars(savedData.bars);
        const bar = bars[index];
        if (!bar) return;
        const newValue = Math.max(0, Math.min(bar.max, bar.current + delta));
        if (newValue !== bar.current) {
            bar.current = newValue;
            await this.saveData({ ...savedData, bars });
            this._refreshWidget(htmlElement);
        }
    }

    async _refreshWidget(htmlElement) {
        await super._refreshWidget(htmlElement);
    }
}
}