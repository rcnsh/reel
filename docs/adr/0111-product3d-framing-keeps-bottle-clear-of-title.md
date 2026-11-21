# The product shot frames the bottle clear of the title

`examples/product3d/scenes/bottle.ts` places the set so the title card (`scenes/title.ts`, in the left third on the track above) never covers the product:

- The orbit (`Bottle.rig`) aims a little left of the bottle (`target` x = -0.07), so the bottle stands right of the frame's centre. The orbit runs from the front left round to the right, rising a little, always on the bottle's shoulder.
- The size label stands on the ground right of the bottle and level with it (`label.position` 0.125, 0.015, 0), so the orbit never swings it across the bottle.
- The focus distance is the camera's distance to a point 0.06 up the bottle, less 0.05, which puts the front of the bottle and the label beside it in focus at f/2.8.
