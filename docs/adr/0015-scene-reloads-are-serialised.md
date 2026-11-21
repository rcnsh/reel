# Scene reloads run one at a time

`Engine.reload` in `src/engine/engine.ts` (the preview's HMR path) chains each reload on the one before (`this.reloads`). A scene is made with the clip it belongs to set globally (`LOADING.clip`, `htmlLayers.owner`), so two reloads overlapping would make one scene's components and HTML layers belong to the other's clip.

While the new module imports, the clip's record has its scene set to null, so the clip draws as nothing rather than through the scene just disposed.
