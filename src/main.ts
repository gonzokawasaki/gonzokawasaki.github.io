// ---------------------------------------------------------------------------
// Prototype 3 entry — the resolver + chips loop on top of P2's interaction model:
//   type a phrase → local lexicon resolves it to a thin verb → editable typed
//   chips → apply.ts writes the fat op-tree node → re-bake. Editing a chip
//   re-applies from base (no second resolution). Mouse (select + gizmo) and the
//   nav cube carry over from P2 unchanged.
//
// This build adds three things on the same spine:
//   1. colour/shape object references — "move the green cube up" (resolver)
//   2. ready-made objects built from primitives — rabbit/snowman/… (spawn + library)
//   3. the paste-bridge — generate an AI prompt, paste the reply back (real AI,
//      no key/login). The reply is parsed line-by-line by the SAME resolver.
// ---------------------------------------------------------------------------
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { initCSG } from "./csg-init";
import { addGrid } from "./backdrop";
import { SceneModel, identity, at, type SceneObject } from "./scene-model";
import { Selection } from "./selection";
import { Gizmos, type GizmoMode } from "./gizmos";
import { Nav } from "./nav";
import { NavCube } from "./navcube";
import { plate2 } from "./optree";
import { resolve, type ResolveContext } from "./resolver";
import { withDefaults, type ResolvedVerb } from "./verbs";
import { applyVerb, reapply, undo, type AppliedOp } from "./apply";
import { renderChips, renderEscalation } from "./chips";
import { buildPrompt, extractCommands } from "./paste-bridge";

// --- scene / camera / lights -------------------------------------------------
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(1, 1, 1, 1); // plain white 3D window

const camera = new ArcRotateCamera("main", -Math.PI / 2.2, Math.PI / 3, 130, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.wheelDeltaPercentage = 0.01;
camera.minZ = 0.1;

new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.8;
const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.7), scene);
dir.intensity = 0.7;

// plain white window + a blue grid floor at y=0, no sky fade
addGrid(scene);

// --- boot --------------------------------------------------------------------
(async () => {
  await initCSG();

  const model = new SceneModel(scene);
  model.add({ id: "plate", transform: identity(), tree: plate2, color: [0.40, 0.55, 0.85], kind: "box" });
  model.add({
    id: "block", transform: at(-38, 0, 0), color: [0.36, 0.66, 0.40], kind: "box",
    tree: { type: "primitive", id: "block.1", kind: "box", size: { w: 22, h: 18, d: 22 }, cornerRadius: 3 },
  });
  model.add({
    id: "post", transform: at(38, 0, 0), color: [0.86, 0.52, 0.26], kind: "cylinder",
    tree: { type: "primitive", id: "post.1", kind: "cylinder", size: { d: 16, h: 22 } },
  });

  // placement convention: every object sits on the y=0 grid
  for (const o of model.objects) model.seatOnGround(o);

  const selection = new Selection(scene, model, camera);
  const gizmos = new Gizmos(scene, model);
  const nav = new Nav(camera);
  const navcube = new NavCube(scene, camera, nav);

  scene.activeCameras = [camera, navcube.cam];
  scene.activeCamera = camera;

  // the op the chips are currently bound to (the last resolved command)
  let currentOp: AppliedOp | null = null;
  // the last phrase the student typed (used as the request when asking an AI)
  let lastPhrase = "";

  // selection drives gizmo + title (NOT the chips — chips belong to the command)
  selection.onChange = (obj) => {
    gizmos.attach(obj);
    setSelTitle(obj);
    markTree(obj);
  };
  // a gizmo drag synced model→ refresh JSON (no rebake — it's just a transform)
  gizmos.onEdit = () => renderJSON();

  // pointer: cube first, then object pick. A manual pick resets the chip strip
  // (the chips reflect the last typed command, not the current selection).
  scene.onPointerObservable.add((pi) => {
    if (pi.type !== PointerEventTypes.POINTERTAP) return;
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    if (navcube.tryPick(scene.pointerX, scene.pointerY, w, h)) return;
    selection.pickAt(scene.pointerX, scene.pointerY, camera);
    showChipHint();
  });

  scene.onBeforeRenderObservable.add(() => navcube.update());
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  setInterval(() => { document.getElementById("fps")!.textContent = `FPS ${engine.getFps().toFixed(0)}`; }, 500);

  // ---- UI wiring ----
  wireButtons();
  buildTree();
  buildShapeLibrary();
  renderJSON();
  showChipHint();
  setSelTitle(null);

  // ---- the resolver context: selection + the whole scene (for colour refs) ----
  function buildCtx(): ResolveContext {
    return {
      hasSelection: !!selection.current,
      objects: model.objects.map((o) => ({ id: o.id, color: o.color, kind: o.kind })),
    };
  }

  function selectById(id: string) {
    const o = model.find(id);
    if (o) selection.select(o);
  }

  // ---- commit a resolved verb: apply → wire selection/gizmo → render chips ----
  // shared by typed phrases, Shape-Library tiles, and the AI paste-bridge.
  function commit(verb: ResolvedVerb, target?: string): AppliedOp {
    if (target) selectById(target);
    const op = applyVerb(verb, model, selection.current);
    currentOp = op;
    if (op.kind === "create") {
      buildTree();
      selection.select(op.obj); // auto-select the new object
    } else if (op.rebakes) {
      selection.refresh(); // the rebake replaced the mesh — re-highlight + re-attach
      gizmos.attach(op.obj);
    }
    renderChips(document.getElementById("chips")!, op.verb, refreshAfterEdit, refreshAfterEdit);
    renderJSON();
    return op;
  }

  // ---- the resolver → apply → chips loop ----
  function runPhrase(text: string) {
    const log = document.getElementById("cmdlog")!;
    const chips = document.getElementById("chips")!;
    lastPhrase = text.trim();
    const r = resolve(text, buildCtx());

    if (!r.ok) {
      if (r.reason === "empty") return;
      renderEscalation(chips, r.reason, r.message);
      if (r.reason === "composition") appendSendToAI(chips); // offer the paste-bridge
      log.textContent = r.reason === "no-verb" || r.reason === "no-target" ? `· ${r.message}` : "";
      currentOp = null;
      return;
    }

    const op = commit(r.verb, r.target);
    log.textContent = `✓ resolved → ${describe(op)}`;
    (document.getElementById("cmd") as HTMLTextAreaElement).value = "";
  }

  // a chip edit → re-apply the SAME op from its base (no re-resolution)
  function refreshAfterEdit() {
    if (!currentOp) return;
    reapply(currentOp, model);
    if (currentOp.rebakes) {
      selection.refresh();
      gizmos.attach(currentOp.obj);
    }
    renderJSON();
  }

  function doUndo() {
    if (!currentOp) { document.getElementById("cmdlog")!.textContent = "nothing to undo"; return; }
    undo(currentOp, model);
    const wasCreate = currentOp.kind === "create";
    document.getElementById("cmdlog")!.textContent = `↩ undid ${currentOp.verb.verb}`;
    currentOp = null;
    if (wasCreate) {
      buildTree();
      selection.select(null);
    } else {
      selection.refresh();
      gizmos.attach(selection.current);
    }
    renderJSON();
    showChipHint();
  }

  // ---- the paste-bridge: ask whatever AI the student already has -------------
  // Generate a self-contained prompt (grammar + scene + request), they paste it
  // into their chat AI, paste the reply back; we parse each line with resolve().
  function openBridge(request: string) {
    const prompt = buildPrompt({
      request: request || "(describe what you want to build)",
      sceneJSON: JSON.stringify(model.toJSON(), null, 2),
    });
    (document.getElementById("bridgePrompt") as HTMLTextAreaElement).value = prompt;
    document.getElementById("bridgePanel")!.hidden = false;
    const step = document.getElementById("bridgeStep")!;
    step.textContent = "Copy the prompt above into your AI, then paste its reply below ↓";
    navigator.clipboard?.writeText(prompt).then(
      () => { step.textContent = "✓ Copied! Paste it into your AI, then paste its reply below ↓"; },
      () => {},
    );
  }

  function applyAIReply(text: string) {
    const log = document.getElementById("cmdlog")!;
    const lines = extractCommands(text);
    if (!lines.length) { log.textContent = "· no commands found in that reply"; return; }
    let applied = 0;
    const notes: string[] = [];
    for (const line of lines) {
      const r = resolve(line, buildCtx()); // re-read the scene each step (colour refs)
      if (!r.ok) { notes.push(`✗ ${line}`); continue; }
      commit(r.verb, r.target);
      applied++;
      notes.push(`✓ ${line}`);
    }
    buildTree();
    log.textContent = `AI: applied ${applied}/${lines.length} command${lines.length === 1 ? "" : "s"} — ${notes.join("  ·  ")}`;
  }

  function appendSendToAI(host: HTMLElement) {
    const b = document.createElement("button");
    b.className = "btn bridge-cta";
    b.textContent = "📋 Send this to your AI";
    b.addEventListener("click", () => openBridge(lastPhrase));
    host.appendChild(b);
  }

  // ---- small UI helpers ----
  function setSelTitle(obj: SceneObject | null) {
    document.getElementById("selTitle")!.textContent = obj ? `${obj.id} selected` : "nothing selected";
  }

  function updateStatus() {
    document.getElementById("objcount")!.textContent = `Objects: ${model.objects.length}`;
  }

  function showChipHint() {
    document.getElementById("chips")!.innerHTML =
      `<div class="sub">type what to do — it resolves to editable chips</div>`;
  }

  function wireButtons() {
    document.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((b) => {
      b.addEventListener("click", () => (b.dataset.view === "home" ? nav.goHome() : nav.view(b.dataset.view!)));
    });
    const modeBtns = document.querySelectorAll<HTMLButtonElement>("button[data-mode]");
    modeBtns.forEach((b) => {
      b.addEventListener("click", () => {
        gizmos.setMode(b.dataset.mode as GizmoMode);
        if (selection.current) gizmos.attach(selection.current);
        modeBtns.forEach((x) => x.classList.toggle("on", x === b));
      });
    });
    const cmd = document.getElementById("cmd") as HTMLTextAreaElement;
    document.getElementById("runCmd")!.addEventListener("click", () => runPhrase(cmd.value));
    // Enter sends; Shift+Enter inserts a newline (it's a multi-line AI/chat input)
    cmd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runPhrase(cmd.value); }
    });
    document.getElementById("undoBtn")!.addEventListener("click", doUndo);
    document.querySelectorAll<HTMLButtonElement>("button[data-ex]").forEach((b) => {
      b.addEventListener("click", () => { cmd.value = b.dataset.ex!; runPhrase(cmd.value); });
    });

    // paste-bridge controls (the simple, login-free AI path)
    document.getElementById("aiCopyPrompt")!.addEventListener("click", () => openBridge(cmd.value || lastPhrase));
    document.getElementById("aiPasteReply")!.addEventListener("click", () => {
      document.getElementById("bridgePanel")!.hidden = false;
      document.getElementById("bridgeStep")!.textContent = "Paste your AI's reply below, then Apply.";
      (document.getElementById("bridgeReply") as HTMLTextAreaElement).focus();
    });
    document.getElementById("applyReply")!.addEventListener("click", () => {
      applyAIReply((document.getElementById("bridgeReply") as HTMLTextAreaElement).value);
      document.getElementById("bridgePanel")!.hidden = true;
    });
    document.getElementById("bridgeClose")!.addEventListener("click", () => {
      document.getElementById("bridgePanel")!.hidden = true;
    });

    // brush creator: stamp the current selection into the library as a new
    // predefined shape (blockout — bookkeeping only, no geometry yet).
    document.getElementById("makeBrush")!.addEventListener("click", () => {
      const name = selection.current ? selection.current.id : "brush";
      addBrushTile(name);
      document.getElementById("cmdlog")!.textContent = `· saved “${name}” to the Shape Library`;
    });
    // collapsible inspector accordions
    document.querySelectorAll<HTMLElement>(".acc-head").forEach((h) => {
      h.addEventListener("click", () => h.parentElement!.classList.toggle("collapsed"));
    });
  }

  function buildTree() {
    const list = document.getElementById("treeList")!;
    list.innerHTML = "";
    for (const o of model.objects) {
      const item = document.createElement("div");
      item.className = "treeItem";
      item.dataset.id = o.id;
      item.textContent = `◈ ${o.id}`;
      item.addEventListener("click", () => { selection.select(o); showChipHint(); });
      list.appendChild(item);
    }
    markTree(selection.current);
    updateStatus();
  }

  function markTree(obj: SceneObject | null) {
    document.querySelectorAll<HTMLElement>(".treeItem").forEach((el) => {
      el.classList.toggle("sel", !!obj && el.dataset.id === obj.id);
    });
  }

  // ---- Shape Library — now PLACES geometry ----
  // Primitive tiles run `add`; ready-made tiles run `spawn` (a brush sub-tree of
  // primitives, library.ts). Both go through commit() → same chips/undo path.
  function buildShapeLibrary() {
    const grid = document.getElementById("shapeGrid")!;
    grid.innerHTML = "";
    for (const s of LIB_SHAPES) {
      grid.appendChild(makeTile(s.glyph, s.nm, () => placeTile(s)));
    }
  }

  function placeTile(s: LibTile) {
    if (s.lib) commit(withDefaults("spawn", { object: s.lib }));
    else if (s.shape) commit(withDefaults("add", { shape: s.shape }));
    document.getElementById("cmdlog")!.textContent = `· placed ${s.nm}`;
  }

  function addBrushTile(name: string) {
    document.getElementById("shapeGrid")!.appendChild(
      makeTile("❖", name, () => {
        document.getElementById("cmdlog")!.textContent = `· brush “${name}” — stamping comes in a later prototype`;
      }, true),
    );
  }

  function makeTile(glyph: string, nm: string, onClick: () => void, brush = false): HTMLElement {
    const tile = document.createElement("div");
    tile.className = brush ? "shapetile brush" : "shapetile";
    tile.title = brush ? `Brush: ${nm}` : nm;
    tile.innerHTML = `<span class="glyph">${glyph}</span><span class="nm">${nm}</span>`;
    tile.addEventListener("click", onClick);
    return tile;
  }

  function renderJSON() {
    (document.getElementById("json")!).textContent = JSON.stringify(model.toJSON(), null, 2);
  }
})();

interface LibTile { nm: string; glyph: string; shape?: string; lib?: string }

/** the Shape Library tiles: primitives (→ add) + ready-made objects (→ spawn) */
const LIB_SHAPES: LibTile[] = [
  { nm: "Box", glyph: "■", shape: "box" },
  { nm: "Sphere", glyph: "●", shape: "sphere" },
  { nm: "Cylinder", glyph: "▮", shape: "cylinder" },
  { nm: "Rabbit", glyph: "🐰", lib: "rabbit" },
  { nm: "Snowman", glyph: "⛄", lib: "snowman" },
  { nm: "Rocket", glyph: "🚀", lib: "rocket" },
  { nm: "Robot", glyph: "🤖", lib: "robot" },
];

/** one-line human summary of what an op did (for the log) */
function describe(op: AppliedOp): string {
  const vals = Object.entries(op.verb.params).map(([k, v]) => `${k}=${v}`).join(" ");
  return `${op.verb.verb} ${vals}`;
}
