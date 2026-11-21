# The bottle's cap is modelled about its own origin

In `examples/product3d/make_assets.ts` the cap's lathe profile starts at y = 0 and the mesh is placed by `cap.position.y = 0.128`, the top of the collar, instead of baking that offset into the geometry. The 'open' animation's `cap.position` and `cap.quaternion` tracks then lift and turn the cap in place about its own axis; with the offset in the geometry the rotation would swing it about the bottle's base.
