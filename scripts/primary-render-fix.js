const SS_PRIMARY_RENDER_VERSION = "0.1.1-test.2";

function installPrimaryRenderFix() {
  const engine = globalThis.SplineSmithTest?.engine;
  if (!engine) {
    console.error("SplineSmith Test | Primary render fix could not find the test engine.");
    return;
  }

  globalThis.SplineSmithTest.version = SS_PRIMARY_RENDER_VERSION;

  const originalDestroyCanvasObjects = engine.destroyCanvasObjects.bind(engine);
  engine.destroyCanvasObjects = function() {
    const meshContainer = this.meshContainer;

    // In test.2 the textured spline mesh lives directly in canvas.primary,
    // separate from the GM editing overlay which remains on canvas.tiles.
    if (meshContainer?.parent && meshContainer.parent !== this.root) {
      try { meshContainer.parent.removeChild(meshContainer); }
      catch (err) { console.warn("SplineSmith Test | Could not detach primary mesh container", err); }

      try { meshContainer.destroy({ children: true }); }
      catch (err) { console.warn("SplineSmith Test | Could not destroy primary mesh container", err); }
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

    // The original V1 implementation places both path artwork and editing
    // controls on canvas.tiles. That interface layer renders above Foundry's
    // lighting, token vision, and fog. Move only the textured artwork into
    // the PrimaryCanvasGroup so normal scene visibility effects apply.
    if (this.meshContainer.parent) this.meshContainer.parent.removeChild(this.meshContainer);
    canvas.primary.addChild(this.meshContainer);

    // Keep the editor overlay on canvas.tiles so a GM can still see and drag
    // control points while lighting/vision obscures the actual path artwork.
    this.meshContainer.eventMode = "none";

    console.log(`SplineSmith Test | Primary-canvas rendering enabled (${SS_PRIMARY_RENDER_VERSION}).`);
  };
}

if (globalThis.SplineSmithTest?.engine) installPrimaryRenderFix();
else Hooks.once("init", installPrimaryRenderFix);
