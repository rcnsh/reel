# reel font add takes the variable fonts, not static/

In the google/fonts repository, a family's static instances live in a `static/` subfolder beside its variable fonts. `addGoogleFont` in `cli/fonts.ts` takes only the files at the top of the family folder and does not descend into `static/`, because the variable fonts already cover those instances.
