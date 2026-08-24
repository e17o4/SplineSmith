const MODULE_ID = "splinesmith-test";
const STABLE_MODULE_ID = "splinesmith";
const FLAG_KEY = "paths";
const TOOL_SELECT = "splinesmith-test-select";
const TOOL_DRAW = "splinesmith-test-draw";

const log = (...args) => console.log("SplineSmith |", ...args);
const warn = (...args) => console.warn("SplineSmith |", ...args);

class SplineSmithEngine {
  constructor() {
    this.paths = [];
    this.selectedPathId = null;
    this.selectedNodeIndex = null;
    this.mode = "none";
    this.insertMode = false;
    this.dragging = null;
    this.draft = null;

    this.defaults = {
      texture: "",
      width: 128,
      textureScale: 1,
      opacity: 1,
      smooth: true
    };

    this.root = null;
    this.meshContainer = null;
    this.editorContainer = null;
    this.editorGraphics = null;
    this.draftGraphics = null;
    this.meshes = new Map();
    this.smoothCache = new Map();
    this.textureCache = new Map();
    this.renderVersions = new Map();

    this.saveTimer = null;
    this.panel = null;
    this.boundStage = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  async onCanvasReady() {
    this.destroyCanvasObjects();
    if (!canvas?.ready || !canvas?.scene || !canvas?.tiles) return;

    this.root = new PIXI.Container();
    this.root.name = "SplineSmithTestRoot";
    this.root.eventMode = "none";

    this.meshContainer = new PIXI.Container();
    this.meshContainer.name = "SplineSmithTestMeshes";
    this.meshContainer.eventMode = "none";

    this.editorContainer = new PIXI.Container();
    this.editorContainer.name = "SplineSmithTestEditor";
    this.editorContainer.eventMode = "none";

    this.editorGraphics = new PIXI.Graphics();
    this.draftGraphics = new PIXI.Graphics();
    this.editorContainer.addChild(this.editorGraphics, this.draftGraphics);
    this.root.addChild(this.meshContainer, this.editorContainer);

    canvas.tiles.addChild(this.root);
    this.bindStage();
    document.addEventListener("keydown", this._onKeyDown);

    await this.loadFromScene();
    log(`Loaded ${this.paths.length} test path(s) for scene ${canvas.scene.name}.`);
  }

  onCanvasTearDown() {
    this.closePanel();
    this.destroyCanvasObjects();
    this.paths = [];
    this.selectedPathId = null;
    this.selectedNodeIndex = null;
    this.draft = null;
    this.mode = "none";
  }

  destroyCanvasObjects() {
    if (this.boundStage) {
      this.boundStage.off("pointerdown", this._onPointerDown);
      this.boundStage.off("pointermove", this._onPointerMove);
      this.boundStage.off("pointerup", this._onPointerUp);
      this.boundStage.off("pointerupoutside", this._onPointerUp);
      this.boundStage = null;
    }
    document.removeEventListener("keydown", this._onKeyDown);

    if (this.root?.parent) this.root.parent.removeChild(this.root);
    if (this.root) {
      try { this.root.destroy({ children: true }); }
      catch (err) { warn("Error destroying canvas objects", err); }
    }

    this.root = null;
    this.meshContainer = null;
    this.editorContainer = null;
    this.editorGraphics = null;
    this.draftGraphics = null;
    this.meshes.clear();
    this.smoothCache.clear();
    this.renderVersions.clear();
  }

  bindStage() {
    if (!canvas?.stage) return;
    this.boundStage = canvas.stage;
    this.boundStage.on("pointerdown", this._onPointerDown);
    this.boundStage.on("pointermove", this._onPointerMove);
    this.boundStage.on("pointerup", this._onPointerUp);
    this.boundStage.on("pointerupoutside", this._onPointerUp);
  }

  isOurToolActive() {
    return game.user?.isGM && (game.activeTool === TOOL_SELECT || game.activeTool === TOOL_DRAW);
  }

  setMode(mode) {
    if (!game.user?.isGM) return;
    this.mode = mode;
    this.insertMode = false;
    if (mode === "draw") {
      this.selectedPathId = null;
      this.selectedNodeIndex = null;
    }
    else if (this.draft) this.cancelDraft(false);
    this.openPanel();
    this.refreshEditorGraphics();
    this.updatePanel();
  }

  get selectedPath() {
    return this.paths.find(p => p.id === this.selectedPathId) ?? null;
  }

  async loadFromScene() {
    if (!canvas?.scene) return;

    let stored = canvas.scene.getFlag(MODULE_ID, FLAG_KEY);
    if (!Array.isArray(stored)) {
      const stableStored = canvas.scene.getFlag(STABLE_MODULE_ID, FLAG_KEY);
      stored = Array.isArray(stableStored) ? stableStored : [];
    }
    this.paths = foundry.utils.deepClone(stored);

    if (this.selectedPathId && !this.paths.some(p => p.id === this.selectedPathId)) {
      this.selectedPathId = null;
      this.selectedNodeIndex = null;
    }

    await this.renderAll();
    this.refreshEditorGraphics();
    this.updatePanel();
  }

  async saveNow() {
    if (!game.user?.isGM || !canvas?.scene) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await canvas.scene.setFlag(MODULE_ID, FLAG_KEY, foundry.utils.deepClone(this.paths));
  }

  scheduleSave(delay = 180) {
    if (!game.user?.isGM) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow().catch(err => {
        console.error("SplineSmith | Failed to save paths", err);
        ui.notifications.error("SplineSmith could not save the path. Check F12 console.");
      });
    }, delay);
  }

  async renderAll() {
    if (!this.meshContainer) return;
    for (const child of this.meshContainer.removeChildren()) {
      try { child.destroy({ children: true }); }
      catch (_) {}
    }
    this.meshes.clear();
    this.smoothCache.clear();
    await Promise.all(this.paths.map(path => this.renderPath(path.id)));
    if (this.draft) await this.renderDraft();
  }

  async loadPathTexture(src) {
    if (!src) return null;
    if (!this.textureCache.has(src)) {
      const promise = (async () => {
        const loaded = await foundry.canvas.loadTexture(src);
        let texture = loaded;
        if (texture && !(texture instanceof PIXI.Texture)) {
          if (texture.texture instanceof PIXI.Texture) texture = texture.texture;
          else if (texture.baseTexture) texture = new PIXI.Texture(texture.baseTexture);
        }
        if (!(texture instanceof PIXI.Texture)) return null;
        try {
          texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
          texture.baseTexture.update();
        }
        catch (err) { warn(`Could not set repeat wrap mode for ${src}`, err); }
        return texture;
      })();
      this.textureCache.set(src, promise);
    }
    return this.textureCache.get(src);
  }

  buildSmoothPoints(path) {
    const raw = path.points ?? [];
    if (raw.length < 2) return raw.map(p => new PIXI.Point(p.x, p.y));
    if (!path.smooth || raw.length === 2) return raw.map(p => new PIXI.Point(p.x, p.y));
    const out = [];
    const subdivisions = 12;
    for (let i = 0; i < raw.length - 1; i++) {
      const p0 = raw[Math.max(0, i - 1)];
      const p1 = raw[i];
      const p2 = raw[i + 1];
      const p3 = raw[Math.min(raw.length - 1, i + 2)];
      for (let step = 0; step < subdivisions; step++) {
        const t = step / subdivisions, t2 = t*t, t3 = t2*t;
        const x = 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3);
        const y = 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3);
        out.push(new PIXI.Point(x,y));
      }
    }
    const last = raw[raw.length-1];
    out.push(new PIXI.Point(last.x,last.y));
    return out;
  }

  async createRopeMesh(path) {
    if (!path.texture || !path.points || path.points.length < 2) return null;
    const texture = await this.loadPathTexture(path.texture);
    if (!texture) return null;
    const points = this.buildSmoothPoints(path);
    if (points.length < 2) return null;
    const geometry = new PIXI.RopeGeometry(Math.max(1, Number(path.width)||1), points, Math.max(0.01, Number(path.textureScale)||1));
    const material = new PIXI.MeshMaterial(texture);
    const mesh = new PIXI.Mesh(geometry, material);
    mesh.alpha = Math.max(0, Math.min(1, Number(path.opacity)||0));
    mesh.eventMode = "none";
    mesh.name = `SplineSmithTest:${path.id}`;
    return { mesh, points };
  }

  async renderPath(pathId) {
    if (!this.meshContainer) return;
    const path = this.paths.find(p => p.id === pathId);
    if (!path) return;
    const version = (this.renderVersions.get(pathId) ?? 0) + 1;
    this.renderVersions.set(pathId, version);
    const old = this.meshes.get(pathId);
    if (old?.parent) old.parent.removeChild(old);
    if (old) { try { old.destroy({ children: true }); } catch (_) {} }
    this.meshes.delete(pathId);
    this.smoothCache.delete(pathId);
    if (!path.texture || path.points.length < 2) return;
    try {
      const built = await this.createRopeMesh(path);
      if (!built) return;
      if (this.renderVersions.get(pathId) !== version) { built.mesh.destroy({ children: true }); return; }
      this.meshContainer.addChild(built.mesh);
      this.meshes.set(pathId, built.mesh);
      this.smoothCache.set(pathId, built.points);
    }
    catch (err) { console.error(`SplineSmith | Failed to render path ${pathId}`, err); }
  }

  async renderDraft() {
    if (!this.meshContainer) return;
    const draftId = "__draft__";
    const old = this.meshes.get(draftId);
    if (old?.parent) old.parent.removeChild(old);
    if (old) { try { old.destroy({ children: true }); } catch (_) {} }
    this.meshes.delete(draftId);
    if (!this.draft || !this.draft.texture || this.draft.points.length < 2) { this.refreshDraftGraphics(); return; }
    try {
      const built = await this.createRopeMesh(this.draft);
      if (built && this.draft) {
        built.mesh.alpha *= 0.82;
        this.meshContainer.addChild(built.mesh);
        this.meshes.set(draftId, built.mesh);
      }
    }
    catch (err) { console.error("SplineSmith | Failed to render draft", err); }
    this.refreshDraftGraphics();
  }

  removeDraftMesh() {
    const old = this.meshes.get("__draft__");
    if (old?.parent) old.parent.removeChild(old);
    if (old) { try { old.destroy({ children: true }); } catch (_) {} }
    this.meshes.delete("__draft__");
  }

  refreshEditorGraphics() {
    const g = this.editorGraphics;
    if (!g) return;
    g.clear();
    if (!game.user?.isGM || game.activeTool !== TOOL_SELECT) return;
    const path = this.selectedPath;
    if (!path) return;
    const smooth = this.smoothCache.get(path.id) ?? this.buildSmoothPoints(path);
    if (smooth.length >= 2) {
      g.lineStyle(2, 0x39c8ff, 0.95); g.moveTo(smooth[0].x, smooth[0].y);
      for (let i=1;i<smooth.length;i++) g.lineTo(smooth[i].x, smooth[i].y);
    }
    for (let i=0;i<path.points.length;i++) {
      const p=path.points[i], selected=i===this.selectedNodeIndex;
      g.lineStyle(2,0x101014,0.95); g.beginFill(selected?0xffb347:0x39c8ff,1); g.drawCircle(p.x,p.y,selected?9:7); g.endFill();
    }
  }

  refreshDraftGraphics() {
    const g=this.draftGraphics; if (!g) return; g.clear();
    if (!this.draft || game.activeTool !== TOOL_DRAW) return;
    for (const p of this.draft.points) { g.lineStyle(2,0x101014,0.95); g.beginFill(0x9eff75,1); g.drawCircle(p.x,p.y,7); g.endFill(); }
  }

  localPoint(event) { try { return event.getLocalPosition(canvas.tiles); } catch (_) { return null; } }
  swallowEvent(event) { event.stopPropagation?.(); event.nativeEvent?.stopPropagation?.(); event.nativeEvent?.preventDefault?.(); }

  _onPointerDown(event) {
    if (!this.isOurToolActive()) return;
    if ((event.button ?? event.nativeEvent?.button ?? 0) !== 0) return;
    const pos=this.localPoint(event); if (!pos) return; this.swallowEvent(event);
    if (game.activeTool === TOOL_DRAW) { this.addDraftPoint(pos.x,pos.y); return; }
    if (game.activeTool !== TOOL_SELECT) return;
    const selected=this.selectedPath;
    if (selected) {
      const nodeIndex=this.findNodeAt(selected,pos);
      if (nodeIndex !== null) { this.selectedNodeIndex=nodeIndex; this.dragging={pathId:selected.id,nodeIndex}; this.refreshEditorGraphics(); this.updatePanel(); return; }
    }
    if (this.insertMode && selected) {
      if (this.insertNodeAt(selected,pos)) { this.insertMode=false; this.renderPath(selected.id).then(()=>this.refreshEditorGraphics()); this.scheduleSave(); this.updatePanel(); }
      return;
    }
    const hit=this.findPathAt(pos); this.selectedPathId=hit?.id ?? null; this.selectedNodeIndex=null; this.insertMode=false; this.refreshEditorGraphics(); this.updatePanel();
  }

  _onPointerMove(event) {
    if (!this.dragging || game.activeTool !== TOOL_SELECT) return;
    const pos=this.localPoint(event); if (!pos) return; this.swallowEvent(event);
    const path=this.paths.find(p=>p.id===this.dragging.pathId); if (!path) return;
    const node=path.points[this.dragging.nodeIndex]; if (!node) return;
    node.x=pos.x; node.y=pos.y; this.renderPath(path.id).then(()=>this.refreshEditorGraphics()); this.scheduleSave(250);
  }

  _onPointerUp(event) { if (!this.dragging) return; this.swallowEvent(event); this.dragging=null; this.saveNow(); }
  _onKeyDown(event) {
    if (!game.user?.isGM || !this.isOurToolActive()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "Enter" && game.activeTool===TOOL_DRAW) { event.preventDefault(); this.finishDraft(); }
    else if (event.key === "Escape") { if (this.draft) { event.preventDefault(); this.cancelDraft(); } else if (this.insertMode) { event.preventDefault(); this.insertMode=false; this.updatePanel(); } }
  }

  addDraftPoint(x,y) {
    if (!this.draft) {
      if (!this.defaults.texture) { ui.notifications.warn("SplineSmith Test: choose a texture first."); this.openPanel(); return; }
      this.draft={id:"__draft__",texture:this.defaults.texture,width:this.defaults.width,textureScale:this.defaults.textureScale,opacity:this.defaults.opacity,smooth:this.defaults.smooth,points:[]};
    }
    this.draft.points.push({x,y}); this.renderDraft(); this.updatePanel();
  }

  undoDraftPoint() { if (!this.draft?.points.length) return; this.draft.points.pop(); if (!this.draft.points.length) { this.draft=null; this.removeDraftMesh(); } else this.renderDraft(); this.refreshDraftGraphics(); this.updatePanel(); }
  async finishDraft() { if (!this.draft || this.draft.points.length<2) return; const path={...foundry.utils.deepClone(this.draft),id:foundry.utils.randomID()}; this.paths.push(path); this.draft=null; this.removeDraftMesh(); await this.renderPath(path.id); await this.saveNow(); this.updatePanel(); }
  cancelDraft() { this.draft=null; this.removeDraftMesh(); this.refreshDraftGraphics(); this.updatePanel(); }
  async deleteSelectedPath() { const path=this.selectedPath; if (!path) return; this.paths=this.paths.filter(p=>p.id!==path.id); this.selectedPathId=null; await this.renderAll(); await this.saveNow(); this.updatePanel(); }
  removeSelectedNode() { const path=this.selectedPath; if (!path || this.selectedNodeIndex===null || path.points.length<=2) return; path.points.splice(this.selectedNodeIndex,1); this.selectedNodeIndex=null; this.renderPath(path.id).then(()=>this.refreshEditorGraphics()); this.scheduleSave(); this.updatePanel(); }
  armInsertNode() { if (!this.selectedPath) return; this.insertMode=true; this.updatePanel(); }

  insertNodeAt(path,pos) {
    if (path.points.length<2) return false; let best=null;
    for (let i=0;i<path.points.length-1;i++) { const r=projectPointToSegment(pos,path.points[i],path.points[i+1]); if (!best || r.distance<best.distance) best={...r,segmentIndex:i}; }
    if (!best) return false; const threshold=Math.max(30,(Number(path.width)||1)*0.75); if (best.distance>threshold) return false;
    path.points.splice(best.segmentIndex+1,0,{x:best.x,y:best.y}); this.selectedNodeIndex=best.segmentIndex+1; return true;
  }

  findNodeAt(path,pos) { const zoom=Math.max(0.05,Math.abs(canvas.stage?.scale?.x||1)); const radius=13/zoom; let best=null; for (let i=0;i<path.points.length;i++) { const p=path.points[i]; const d=Math.hypot(pos.x-p.x,pos.y-p.y); if (d<=radius && (!best||d<best.distance)) best={index:i,distance:d}; } return best?.index ?? null; }
  findPathAt(pos) { const zoom=Math.max(0.05,Math.abs(canvas.stage?.scale?.x||1)); const clickPad=10/zoom; for (let i=this.paths.length-1;i>=0;i--) { const path=this.paths[i]; const points=this.smoothCache.get(path.id)??this.buildSmoothPoints(path); const distance=pointToPolylineDistance(pos,points); const threshold=Math.max(clickPad,(Number(path.width)||1)/2+clickPad); if (distance<=threshold) return path; } return null; }

  applySettingsFromPanel() {
    if (!this.panel) return;
    const texture=this.panel.querySelector('[data-ss="texture"]').value.trim();
    const width=clampNumber(this.panel.querySelector('[data-ss="width-number"]').value,1,2000,128);
    const textureScale=clampNumber(this.panel.querySelector('[data-ss="scale-number"]').value,0.01,20,1);
    const opacity=clampNumber(this.panel.querySelector('[data-ss="opacity-number"]').value,0,1,1);
    const smooth=this.panel.querySelector('[data-ss="smooth"]').checked;
    this.defaults={texture,width,textureScale,opacity,smooth};
    const target=this.selectedPath??this.draft; if (!target) return;
    Object.assign(target,{texture,width,textureScale,opacity,smooth});
    if (target===this.draft) this.renderDraft(); else { this.renderPath(target.id).then(()=>this.refreshEditorGraphics()); this.scheduleSave(); }
  }

  openPanel() {
    if (!game.user?.isGM) return;
    if (this.panel?.isConnected) { this.updatePanel(); return; }
    const panel=document.createElement("div"); panel.id="splinesmith-test-panel";
    panel.innerHTML=`<div class="ss-header"><div class="ss-title"><i class="fa-solid fa-route"></i> SplineSmith Test</div><button type="button" class="ss-close"><i class="fa-solid fa-xmark"></i></button></div><div class="ss-body"><div class="ss-row ss-texture-row"><label>Texture</label><input data-ss="texture" type="text"/><button type="button" data-action="browse"><i class="fa-solid fa-folder-open"></i></button></div><div class="ss-row"><label>Width</label><div class="ss-range-wrap"><input data-ss="width-range" type="range" min="1" max="600" step="1"/><input data-ss="width-number" type="number"/></div></div><div class="ss-row"><label>Texture scale</label><div class="ss-range-wrap"><input data-ss="scale-range" type="range" min="0.05" max="4" step="0.05"/><input data-ss="scale-number" type="number"/></div></div><div class="ss-row"><label>Opacity</label><div class="ss-range-wrap"><input data-ss="opacity-range" type="range" min="0" max="1" step="0.05"/><input data-ss="opacity-number" type="number"/></div></div><div class="ss-row"><label>Smoothing</label><div class="ss-check"><input data-ss="smooth" type="checkbox"/><span>Catmull-Rom curve</span></div></div><div class="ss-actions ss-draw-actions"><button data-action="finish">Finish Path</button><button data-action="undo">Undo Point</button><button data-action="cancel">Cancel Draft</button><button data-action="switch-select">Select/Edit</button></div><div class="ss-actions ss-select-actions"><button data-action="insert">Insert Node</button><button data-action="remove-node">Remove Node</button><button data-action="switch-draw">Draw New</button><button data-action="delete" class="ss-danger">Delete Path</button></div><div class="ss-status" data-ss="status"></div></div>`;
    document.body.appendChild(panel); this.panel=panel;
    panel.querySelector('.ss-close').onclick=()=>this.closePanel();
    panel.querySelector('[data-action="browse"]').onclick=()=>this.browseTexture();
    panel.querySelector('[data-action="finish"]').onclick=()=>this.finishDraft();
    panel.querySelector('[data-action="undo"]').onclick=()=>this.undoDraftPoint();
    panel.querySelector('[data-action="cancel"]').onclick=()=>this.cancelDraft();
    panel.querySelector('[data-action="insert"]').onclick=()=>this.armInsertNode();
    panel.querySelector('[data-action="remove-node"]').onclick=()=>this.removeSelectedNode();
    panel.querySelector('[data-action="delete"]').onclick=()=>this.deleteSelectedPath();
    panel.querySelector('[data-action="switch-select"]').onclick=()=>ui.controls.activate({control:"tiles",tool:TOOL_SELECT});
    panel.querySelector('[data-action="switch-draw"]').onclick=()=>ui.controls.activate({control:"tiles",tool:TOOL_DRAW});
    for (const [a,b] of [["width-range","width-number"],["scale-range","scale-number"],["opacity-range","opacity-number"]]) { const r=panel.querySelector(`[data-ss="${a}"]`), n=panel.querySelector(`[data-ss="${b}"]`); r.addEventListener("input",()=>{n.value=r.value;this.applySettingsFromPanel();}); n.addEventListener("change",()=>{r.value=n.value;this.applySettingsFromPanel();this.updatePanel();}); }
    panel.querySelector('[data-ss="texture"]').addEventListener("change",()=>this.applySettingsFromPanel());
    panel.querySelector('[data-ss="smooth"]').addEventListener("change",()=>this.applySettingsFromPanel());
    this.updatePanel();
  }

  closePanel(){ if(this.panel?.isConnected)this.panel.remove(); this.panel=null; }
  updatePanel(){ const p=this.panel;if(!p?.isConnected)return;const a=this.selectedPath??this.draft??this.defaults;p.querySelector('[data-ss="texture"]').value=a.texture??"";p.querySelector('[data-ss="width-range"]').value=a.width??128;p.querySelector('[data-ss="width-number"]').value=a.width??128;p.querySelector('[data-ss="scale-range"]').value=a.textureScale??1;p.querySelector('[data-ss="scale-number"]').value=a.textureScale??1;p.querySelector('[data-ss="opacity-range"]').value=a.opacity??1;p.querySelector('[data-ss="opacity-number"]').value=a.opacity??1;p.querySelector('[data-ss="smooth"]').checked=a.smooth??true;const d=p.querySelector('.ss-draw-actions'),s=p.querySelector('.ss-select-actions');d.classList.toggle('ss-hidden',game.activeTool!==TOOL_DRAW);s.classList.toggle('ss-hidden',game.activeTool!==TOOL_SELECT);p.querySelector('[data-ss="status"]').textContent=this.selectedPath?`Test path selected: ${this.selectedPath.points.length} nodes.`:(this.draft?`Drawing test path: ${this.draft.points.length} points.`:'SplineSmith Test ready.'); }
  browseTexture(){ const picker=new foundry.applications.apps.FilePicker({type:"image",current:this.defaults.texture||"",callback:path=>{if(!this.panel?.isConnected)return;this.panel.querySelector('[data-ss="texture"]').value=path;this.applySettingsFromPanel();this.updatePanel();}});picker.render({force:true}); }
}

function clampNumber(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
function projectPointToSegment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;if(len2===0)return{x:a.x,y:a.y,t:0,distance:Math.hypot(p.x-a.x,p.y-a.y)};const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));const x=a.x+t*dx,y=a.y+t*dy;return{x,y,t,distance:Math.hypot(p.x-x,p.y-y)};}
function pointToPolylineDistance(p,points){if(!points?.length)return Infinity;let best=Infinity;for(let i=0;i<points.length-1;i++)best=Math.min(best,projectPointToSegment(p,points[i],points[i+1]).distance);return best;}

const engine=new SplineSmithEngine();
globalThis.SplineSmithTest={engine,version:"0.1.1-test.1"};
Hooks.once("init",()=>log("Initializing test v0.1.1-test.1 for Foundry VTT v14."));
Hooks.on("getSceneControlButtons",controls=>{if(!game.user?.isGM)return;const tileControl=controls.tiles;if(!tileControl?.tools)return;const existingOrders=Object.values(tileControl.tools).map(t=>Number(t.order)||0);let order=Math.max(0,...existingOrders)+20;tileControl.tools[TOOL_SELECT]={name:TOOL_SELECT,title:"SplineSmith Test: Select/Edit",icon:"fa-solid fa-flask",order:order++,visible:true,interaction:false,control:false,onChange:(_e,a)=>a?engine.setMode("select"):engine.updatePanel()};tileControl.tools[TOOL_DRAW]={name:TOOL_DRAW,title:"SplineSmith Test: Draw Path",icon:"fa-solid fa-vial",order:order++,visible:true,interaction:false,control:false,onChange:(_e,a)=>a?engine.setMode("draw"):engine.updatePanel()};});
Hooks.on("canvasReady",async()=>{try{await engine.onCanvasReady();}catch(err){console.error("SplineSmith Test | Canvas initialization failed",err);}});
Hooks.on("canvasTearDown",()=>engine.onCanvasTearDown());
Hooks.on("updateScene",async(scene,changes,_options,userId)=>{if(!canvas?.ready||scene.id!==canvas.scene?.id||userId===game.user?.id)return;const nested=foundry.utils.hasProperty(changes,`flags.${MODULE_ID}.${FLAG_KEY}`);const flat=Object.keys(changes??{}).some(key=>key.startsWith(`flags.${MODULE_ID}`));if(!nested&&!flat)return;await engine.loadFromScene();});
