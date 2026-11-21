# reel video --subtitles writes the subtitles before rendering

For `reel video --subtitles`, `cli/reel.ts` writes the subtitles (`writeSubtitles`) before `exportVideo` starts. A project without timed words then fails at once, not after a render that may take minutes.
