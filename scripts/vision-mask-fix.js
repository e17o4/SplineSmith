const SS_VISION_MASK_VERSION = "0.1.1-test.4";

function installVisionMaskFix() {
  const engine = globalThis.SplineSmithTest?.engine;
  if (!engine) {
    console.error("SplineSmith Test | Vision mask fix could not find the test engine.");
    return;
  }

  globalThis.SplineSmithTest.version = SS_VISION_MASK_VERSION;

  function applyVisionMask() {
    const container = engine.meshContainer;
    if (!container || !canvas?.visibility) return;

    const tokenVision = Boolean(canvas.visibility.tokenVision);
    const visionSourceCount = Number(canvas.effects?.visionSources?.size ?? 0);

    // A GM with no active vision source remains omniscient, matching Foundry's
    // normal GM view. Players, and GMs currently viewing through a token, are
    // clipped to Foundry's live vision container.
    const shouldMask = tokenVision && (!game.user?.isGM || visionSourceCount > 0);

    if (!shouldMask) {
      container.mask = null;
      return;
    }

    const vision = canvas.visibility.vision;
    if (!vision) {
      // Fail closed for non-GM users if Foundry says token vision is active
      // but the vision container has not been created yet.
      container.visible = Boolean(game.user?.isGM);
      container.mask = null;
      return;
    }

    container.visible = true;
    container.mask = vision;
  }

  const originalOnCanvasReady = engine.onCanvasReady.bind(engine);
  engine.onCanvasReady = async function() {
    await originalOnCanvasReady();
    applyVisionMask();
    console.log(`SplineSmith Test | Vision masking enabled (${SS_VISION_MASK_VERSION}).`);
  };

  // Foundry documents both visibilityRefresh and sightRefresh as the events
  // which rebuild dynamic token vision and fog. Re-apply the mask after either
  // event in case the underlying vision container was recreated.
  Hooks.on("visibilityRefresh", applyVisionMask);
  Hooks.on("sightRefresh", applyVisionMask);

  console.log(`SplineSmith Test | Vision mask patch loaded (${SS_VISION_MASK_VERSION}).`);
}

if (globalThis.SplineSmithTest?.engine) installVisionMaskFix();
else Hooks.once("init", installVisionMaskFix);
