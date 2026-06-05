// ---------------------------------------------------------------------------
// Clickable typed chips (spec §3) — the explanation IS the control. A resolved
// thin verb renders as a row of chips, each one drawn + made editable straight
// from its ParamSpec metadata (enum→picker, number→slider, with discrete
// suggestion chips for things like rotate 15·45·90). Editing a chip mutates the
// verb's params and calls back so apply.ts can re-apply from base — the
// "radius 3→5 is a slider drag, no second resolution" payoff.
//
// The chips are also the always-visible RESOLUTION: the student sees their
// sentence become typed verbs every time — the implicit training signal the
// design treats as a hard requirement (session-state items 10–11).
// ---------------------------------------------------------------------------
import { VERBS, type ResolvedVerb } from "./verbs";

function fmtVal(n: number, unit?: string): string {
  const s = Math.round(n * 100) / 100;
  return unit ? `${s}${unit === "mm" || unit === "°" || unit === "×" ? "" : " "}${unit}` : `${s}`;
}

/**
 * Render `verb` into `host` as editable chips.
 * `onLiveEdit`  — fires continuously while a non-rebaking value drags (cheap).
 * `onCommitEdit`— fires on release / discrete change (used for re-baking verbs,
 *                 so a geometry slider doesn't run CSG2 every pixel).
 */
export function renderChips(
  host: HTMLElement,
  verb: ResolvedVerb,
  onLiveEdit: () => void,
  onCommitEdit: () => void,
) {
  const spec = VERBS[verb.verb];
  host.innerHTML = "";

  const row = document.createElement("div");
  row.className = "chiprow";

  const pill = document.createElement("span");
  pill.className = "verbpill";
  pill.textContent = verb.verb;
  row.appendChild(pill);

  for (const p of spec.params) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const lab = document.createElement("label");
    lab.textContent = p.label;
    chip.appendChild(lab);

    if (p.type === "enum" || p.type === "direction") {
      const sel = document.createElement("select");
      for (const opt of p.options!) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (String(verb.params[p.key]) === opt) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        verb.params[p.key] = sel.value;
        onCommitEdit(); // shape/direction change can alter geometry → commit
      });
      chip.appendChild(sel);
    } else {
      // number → slider + live value, with optional discrete suggestion chips
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(p.min);
      range.max = String(p.max);
      range.step = String(p.step);
      range.value = String(verb.params[p.key]);

      const val = document.createElement("span");
      val.className = "chipval";
      val.textContent = fmtVal(Number(verb.params[p.key]), p.unit);

      const live = spec.rebakes
        ? () => { // geometry: update the number live, re-bake only on release
            verb.params[p.key] = parseFloat(range.value);
            val.textContent = fmtVal(parseFloat(range.value), p.unit);
          }
        : () => { // transform: cheap, re-apply every frame
            verb.params[p.key] = parseFloat(range.value);
            val.textContent = fmtVal(parseFloat(range.value), p.unit);
            onLiveEdit();
          };
      range.addEventListener("input", live);
      if (spec.rebakes) range.addEventListener("change", onCommitEdit);

      chip.appendChild(range);
      chip.appendChild(val);

      if (p.suggest) {
        const sg = document.createElement("span");
        sg.className = "suggest";
        for (const n of p.suggest) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = `${n}${p.unit ?? ""}`;
          b.addEventListener("click", () => {
            verb.params[p.key] = n;
            range.value = String(n);
            val.textContent = fmtVal(n, p.unit);
            (spec.rebakes ? onCommitEdit : onLiveEdit)();
          });
          sg.appendChild(b);
        }
        chip.appendChild(sg);
      }
    }
    row.appendChild(chip);
  }
  host.appendChild(row);

  const sub = document.createElement("div");
  sub.className = "chipsummary";
  sub.textContent = spec.summary;
  host.appendChild(sub);
}

/** Render a visible escalation (no LLM in this prototype — shown, not sent). */
export function renderEscalation(host: HTMLElement, reason: string, message: string) {
  host.innerHTML = "";
  const box = document.createElement("div");
  box.className = "escalate";
  const tag = reason === "composition" ? "⚡ needs an AI step" : reason === "needs-selection" ? "↳ pick first" : "·";
  box.innerHTML = `<span class="esctag">${tag}</span> <span class="escmsg"></span>`;
  (box.querySelector(".escmsg") as HTMLElement).textContent = message;
  host.appendChild(box);
}
