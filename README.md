# SplineSmith 0.1.0

A deliberately small textured spline/path editor for Foundry VTT v14.

## V1 features

- GM-only editing controls under Foundry's **Tiles** tools.
- Choose any image in Foundry's File Picker as a path texture.
- Click control points to draw a path.
- Catmull-Rom smoothing, toggleable per path.
- Repeating texture along the path using PixiJS rope geometry.
- Independent path width, texture scale, and opacity.
- Select existing paths by clicking them.
- Drag control points to reshape a selected path.
- Insert a new control point into a selected path.
- Remove a selected control point.
- Delete selected paths.
- Scene-local persistence using `flags.splinesmith.paths`.
- Paths automatically render for non-GM players too.

## Install manually

1. Close the Foundry world.
2. Put the `splinesmith` folder in:
   `FoundryVTT/Data/modules/`
3. Start Foundry and enable **SplineSmith** in Manage Modules.
4. Open a Scene as GM.
5. Select the **Tiles** controls on the left.
6. Choose **SplineSmith: Select/Edit** or **SplineSmith: Draw Path**.

## Drawing a path

1. Open **SplineSmith: Draw Path**.
2. In the panel, click **Browse** and select a horizontal strip texture.
3. Click on the Scene to add control points.
4. Press **Enter** or click **Finish Path** when done.
5. Press **Escape** or click **Cancel Draft** to discard the current draft.

## Editing

- Choose **SplineSmith: Select/Edit**.
- Click a path to select it.
- Drag circular control points to reshape it.
- Click a control point to select that node.
- **Insert Node** arms insert mode; click the selected path where the new node should go.
- **Remove Node** removes the selected node, as long as at least two nodes remain.

## Texture recommendations

SplineSmith expects a path texture to run left-to-right. A road texture, for example, should look roughly like:

`[================ road ================]`

Transparent PNG/WebP works well. Power-of-two dimensions are safest for repeating textures in PixiJS, for example 512x128 or 1024x256.

`Texture Scale = 1` attempts to preserve the source texture's pixel scale along the path. Smaller values shrink the texture; larger values enlarge it.

## V1 limitations

- Foundry v14 only.
- Constant width along each whole path. Per-node width/tapering is a later feature.
- Paths currently render in the Tiles layer, above/below other tiles according to Foundry's layer child ordering, but below token-level interaction.
- No path intersections/automatic joins.
- No generated walls.
- No flatten-to-tile/export yet.
- No built-in texture preset library yet.
- Texture UV repeat behavior is ultimately controlled by PixiJS/WebGL. Power-of-two source images are the safest choice.

## Troubleshooting

Open Foundry's developer console with **F12** and search for `SplineSmith`.

If the toolbar appears but textures do not render, confirm the image can be displayed normally as a Foundry Tile and try a power-of-two image such as 512x128.

If you encounter an error, copy the red console error and its stack trace. The module logs with the prefix `SplineSmith |`.
