const SS_PRIMARY_RENDER_VERSION = "0.1.1-test.3";

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

    // Move only the textured spline artwork into Foundry's primary scene group.
    // GM editing guides and nodes remain on canvas.tiles above scene effects.
    if (this.meshContainer.parent) this.meshContainer.parent.removeChild(this.meshContainer);
    canvas.primary.addChild(this.meshContainer);
    this.meshContainer.eventMode = "none";

    console.log(`SplineSmith Test | Primary-canvas rendering enabled (${SS_PRIMARY_RENDER_VERSION}).`);
  };
}

if (globalThis.SplineSmithTest?.engine) installPrimaryRenderFix();
else Hooks.once("init", installPrimaryRenderFix);
