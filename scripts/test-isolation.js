const SS_TEST_VERSION = "0.1.1-test.3";
const SS_TEST_MODULE_ID = "splinesmith-test";
const SS_STABLE_MODULE_ID = "splinesmith";
const SS_FLAG_KEY = "paths";

function installTestIsolation() {
  const stableGlobal = globalThis.SplineSmith;
  const engine = stableGlobal?.engine;
  if (!engine) {
    console.error("SplineSmith Test | Could not find the restored V1 engine.");
    return;
  }

  // Expose a separate global for test-only extensions. The underlying editor
  // is the known-good V1 engine, but test data is stored in a different Scene
  // flag namespace so experiments cannot overwrite stable path data.
  globalThis.SplineSmithTest = { engine, version: SS_TEST_VERSION };

  engine.loadFromScene = async function() {
    if (!canvas?.scene) return;

    const testStored = canvas.scene.getFlag(SS_TEST_MODULE_ID, SS_FLAG_KEY);
    const stableStored = canvas.scene.getFlag(SS_STABLE_MODULE_ID, SS_FLAG_KEY);

    // First run of the test build starts from a clone of the stable paths.
    // Once test data has been saved, always use the isolated test copy.
    const stored = Array.isArray(testStored)
      ? testStored
      : (Array.isArray(stableStored) ? stableStored : []);

    this.paths = foundry.utils.deepClone(stored);

    if (this.selectedPathId && !this.paths.some(p => p.id === this.selectedPathId)) {
      this.selectedPathId = null;
      this.selectedNodeIndex = null;
    }

    await this.renderAll();
    this.refreshEditorGraphics();
    this.updatePanel();
  };

  engine.saveNow = async function() {
    if (!game.user?.isGM || !canvas?.scene) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await canvas.scene.setFlag(
      SS_TEST_MODULE_ID,
      SS_FLAG_KEY,
      foundry.utils.deepClone(this.paths)
    );
  };

  // The V1 hook watches the stable flag namespace. Add a second watcher for
  // the isolated test namespace so player clients update immediately.
  Hooks.on("updateScene", async (scene, changes, _options, userId) => {
    if (!canvas?.ready || scene.id !== canvas.scene?.id) return;
    if (userId === game.user?.id) return;

    const nested = foundry.utils.hasProperty(changes, `flags.${SS_TEST_MODULE_ID}.${SS_FLAG_KEY}`);
    const flattened = Object.keys(changes ?? {}).some(key => key.startsWith(`flags.${SS_TEST_MODULE_ID}`));
    if (!nested && !flattened) return;

    try { await engine.loadFromScene(); }
    catch (err) { console.error("SplineSmith Test | Failed to synchronize test paths", err); }
  });

  // Make the editor visibly identify itself as the test build after it opens.
  const originalOpenPanel = engine.openPanel.bind(engine);
  engine.openPanel = function() {
    originalOpenPanel();
    const title = this.panel?.querySelector(".ss-title");
    if (title) title.innerHTML = '<i class="fa-solid fa-flask"></i> SplineSmith Test';
  };

  console.log(`SplineSmith Test | Isolation layer loaded (${SS_TEST_VERSION}).`);
}

if (globalThis.SplineSmith?.engine) installTestIsolation();
else Hooks.once("init", installTestIsolation);
