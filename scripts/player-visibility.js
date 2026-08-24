const SS_VISIBILITY_VERSION = "0.1.1-test.1";

function installPlayerVisibility() {
  const engine = globalThis.SplineSmithTest?.engine;
  if (!engine) {
    console.error("SplineSmith Test | Player visibility patch could not find the test engine.");
    return;
  }

  globalThis.SplineSmithTest.version = SS_VISIBILITY_VERSION;

  const originalCreateRopeMesh = engine.createRopeMesh.bind(engine);
  engine.createRopeMesh = async function(path) {
    if (path?.hiddenFromPlayers === true && !game.user?.isGM) return null;
    return originalCreateRopeMesh(path);
  };

  engine.togglePlayerVisibility = async function() {
    const path = this.selectedPath;
    if (!path) {
      ui.notifications.warn("SplineSmith Test: select a path first.");
      return;
    }

    path.hiddenFromPlayers = path.hiddenFromPlayers !== true;
    await this.renderPath(path.id);
    this.refreshEditorGraphics();
    await this.saveNow();
    this.updatePanel();

    ui.notifications.info(path.hiddenFromPlayers
      ? "SplineSmith Test: path hidden from players."
      : "SplineSmith Test: path visible to players.");
  };

  function ensureVisibilityButton(instance) {
    const panel = instance.panel;
    if (!panel?.isConnected) return null;
    const actions = panel.querySelector(".ss-select-actions");
    if (!actions) return null;

    let button = actions.querySelector('[data-action="player-visibility"]');
    if (button) return button;

    button = document.createElement("button");
    button.type = "button";
    button.className = "ss-visibility";
    button.dataset.action = "player-visibility";
    button.addEventListener("click", () => {
      instance.togglePlayerVisibility().catch(err => {
        console.error("SplineSmith Test | Failed to change player visibility", err);
        ui.notifications.error("SplineSmith Test could not change player visibility. Check F12 console.");
      });
    });

    const deleteButton = actions.querySelector('[data-action="delete"]');
    if (deleteButton) actions.insertBefore(button, deleteButton);
    else actions.appendChild(button);
    return button;
  }

  const originalOpenPanel = engine.openPanel.bind(engine);
  engine.openPanel = function() {
    originalOpenPanel();
    ensureVisibilityButton(this);
    this.updatePanel();
  };

  const originalUpdatePanel = engine.updatePanel.bind(engine);
  engine.updatePanel = function() {
    originalUpdatePanel();
    const button = ensureVisibilityButton(this);
    if (!button) return;

    const path = this.selectedPath;
    const hidden = path?.hiddenFromPlayers === true;
    button.disabled = !path;
    button.classList.toggle("ss-player-hidden", hidden);
    button.innerHTML = hidden
      ? '<i class="fa-solid fa-eye"></i> Show to Players'
      : '<i class="fa-solid fa-eye-slash"></i> Hide from Players';

    if (path && game.activeTool === "splinesmith-test-select") {
      const status = this.panel?.querySelector('[data-ss="status"]');
      if (status) status.textContent += hidden ? " Players: HIDDEN." : " Players: visible.";
    }
  };

  console.log(`SplineSmith Test | Player visibility feature loaded (${SS_VISIBILITY_VERSION}).`);
}

if (globalThis.SplineSmithTest?.engine) installPlayerVisibility();
else Hooks.once("init", installPlayerVisibility);
