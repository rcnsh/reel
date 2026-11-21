# The media example dims its clip over black for white type

`examples/media/scenes/shot.ts` (`Shot.render`) clears to opaque black and draws the background clip at opacity 0.72 rather than at full strength. The clip's colours range from dark to bright yellow; dimmed over black, white type (the line of text and the badge) reads on every part of it.
