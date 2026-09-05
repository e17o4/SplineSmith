const SS_PRIMARY_RENDER_VERSION = "0.1.1-test.4";

function installPrimaryRenderFix() {
  const engine = globalThis.SplineSmithTest?.engine;
  if (!engine) {
    console.error("SplineSmith Test | Vision-mask fix could not find the test engine.");
    return;
  }

  globalThis.SplineSmithTest.version = SS_PRIMARY_RENDER_VERSION;

  /**
   * Apply Foundry's current token sight geometry as an explicit PIXI mask.
   *
   * Simply moving the rope mesh into canvas.primary is not sufficient for a
   * raw custom PIXI mesh: native Tiles/Tokens participate in Foundry's own
   * visibility pipeline, while our rope does not. The `vision.sight` graphics
   * contains the current field-of-view polygons, so using it as a mask keeps
   * the spline from rendering through walls or outside current token sight.
   *
   * Lighting/darkness still comes from the Primary/Effects canvas pipeline;
   * this mask is specifically the missing LOS/FOV restriction.
   */
  function applyVisionMask() {
    const container = engine.meshContainer;
    if (!container || !canvas?.ready) return;

    const visibility = canvas.visibility;
    const sightMask = visibility?.vision?.sight;
    const sources = canvas.effects?.visionSources;
    const sourceCount = Number(sources?.size ?? sources?.length ?? 0);

    // If token vision is not active for the scene/client, or there is no
    // active vision source, behave like ordinary map artwork and show it.
    if (!visibility?.tokenVision || sourceCount < 1 || !sightMask) {
      container.mask = null;
      if (canvas.primary) canvas.primary.renderDirty = true;
      return;
    }

    container.mask = sightMask;
    if (canvas.primary) canvas.primary.renderDirty = true;
  }

  engine.applyVisionMask = applyVisionMask;

  const originalDestroyCanvasObjects = engine.destroyCanvasObjects.bind(engine);
  engine.destroyCanvasObjects = function() {
    const meshContainer = this.meshContainer;

    if (meshContainer) meshContainer.mask = null;

    if (meshContainer?.parent && meshContainer.parent !== this.root) {
      try { meshContainer.parent.removeChild(meshContainer); }
      catch (err) { console.warn("SplineSmith Test | Could not detach primary mesh container", err); }
      try { meshContainer.destroy({ children: true }); }
      catch (err) { console.warn("SplineSmith Test | Could not destroy primary mesh container", err); }
      this.meshContainer = null;
    }

    originalDestroyCanvasObjects();
  };

  const originalOnCanvasReady = engine.onCanvasReady.bind(engine);
  engine.onCanvasReady = async function() {
    await originalOnCanvasReady();

    if (!this.meshContainer || !canvas?.primary) {
      console.warn("SplineSmith Test | canvas.primary was unavailable; splines remain on their fallback layer.");
      return;
    }

    // Keep the actual textured rope in the environment rendering path.
    if (this.meshContainer.parent) this.meshContainer.parent.removeChild(this.meshContainer);
    canvas.primary.addChild(this.meshContainer);
    this.meshContainer.eventMode = "none";
    canvas.primary.renderDirty = true;

    // Apply the current FOV immediately after moving the mesh.
    applyVisionMask();

    console.log(`SplineSmith Test | Primary rendering + explicit token-vision mask enabled (${SS_PRIMARY_RENDER_VERSION}).`);
  };

  // Foundry exposes these hooks whenever vision geometry is regenerated.
  // Re-applying is cheap and protects against the visibility containers being
  // rebuilt/replaced when a token moves, changes sight mode, or the scene
  // refreshes fog/vision.
  Hooks.on("sightRefresh", () => applyVisionMask());
  Hooks.on("visibilityRefresh", () => applyVisionMask());
  Hooks.on("initializeVisionSources", () => queueMicrotask(applyVisionMask));
}

if (globalThis.SplineSmithTest?.engine) installPrimaryRenderFix();
else Hooks.once("init", installPrimaryRenderFix);
