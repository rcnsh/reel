# Playbook: briefing an agent to make a video with reel

How to write the prompt for an agent that makes or changes a reel video through the MCP server. It is for whoever writes that prompt: a person, or an agent handing the job to another.

The agent already knows how reel works, from the skills `reel init` puts in the project (`.claude/skills/`: authoring, 3D, audio, the review loop) and from the MCP tools' descriptions. A brief that repeats that is wasted, and a brief that contradicts it does harm. What the agent cannot know is what you want: the subject, the audience, the look, the deliverables and what "done" means. The brief is for that.

## What the agent works with

- **Files are the video.** The agent authors by editing the project: `reel.config.ts` (the edit), `scenes/*.ts`, `narration.txt`, `mix.json`. No MCP tool writes a scene.
- **The MCP tools are for looking and exporting.** `project_info` first, then `render_still`, `motion_strip` and `contact_sheet` to see frames, `check_video` to find layout and render faults, `video_start` / `video_status` to export (`wait_s` on `video_status` waits for the next change, so the agent need not poll; a job keeps running if the server restarts, and `video_status` without a job lists them), `narrate`, `align_recording`, `analyze_song`, `mix_audio`, `subtitles` and `assets` for sound and generated media, `review_notes` and `resolve_note` for a person's notes. Every tool takes the project folder.
- **The server must be registered before the session starts** (`claude mcp add --scope user reel -- bun <path to reel>/cli/reel.ts mcp`); tools do not appear in a session that is already running. Without them the same commands exist as `reel <command>` in a shell, and the brief does not change.
- **The agent sees frames, not video, and hears nothing.** It judges motion from strips and pacing from contact sheets, and it measures loudness instead of listening. Anything only an ear or a played video can judge (the voice's tone, whether the music suits, the feel of a cut) is yours to review.

## The structure of a brief

Seven parts, in this order. A short job needs a sentence for each; none should be left for the agent to guess.

### 1. The project and the job

Name the project folder (or say to make one, and where) and what kind of job this is: a new video, a change to one, another cut of one, a response to review notes. Say what the agent may touch. For a new project, say `--narrated` or not, and leave size, fps and theme to the agent only if you do not care.

### 2. The video

What it is for and who watches it, in two or three sentences: the subject, the one thing a viewer should leave knowing, the length (a range), the tone, and where it will be shown (which decides aspect ratio, caption size and how fast it can move). Then the content it must get right: the facts, figures, names and sources. Give real numbers or say where they are; an agent asked for "a chart" without data will invent some.

If you have a script, a recording or a song, give the file. If the agent is to write the script, say so and say how closely you want to approve it before it builds.

### 3. The look

Either a direction (the theme or palette, typefaces, references described in words, what to avoid) or explicit freedom ("you choose the look; it must not read as a default template"). Saying nothing gets the neutral theme and the kit's defaults.

### 4. What it must contain

The ingredients, each tied to what it is there to explain: "a 3D shot that shows the Moon turning once per orbit", not "use 3D". List only what you would be disappointed to find missing. Typical ones:

- narration and captions; a music bed; cue sounds
- 3D shots, and what each must make visible
- diagrams, charts or counters, with their data
- title and end cards; lower thirds
- media you supply (images, video clips, Lottie, SVG), by path
- generated images or sounds, if a key is set (otherwise the agent reports the prompts for you to make them)

Say what is off limits too: downloaded assets, hosted APIs, a voice provider.

### 5. Deliverables

Every file you want, with what the engine needs to know to make it:

- **Aspect ratios and sizes**: 16:9, 9:16, 1:1; 1080p or 4K. Say whether a second ratio must be laid out again for its frame or may be a crop.
- **Format per file**: H.264 for most delivery, HEVC 10-bit for dark or grainy pictures and for 4K, ProRes for an editor, ProRes 4444 or WebM for overlays with transparency, GIF or WebP for a short loop, frame sequences for grading.
- **Sound**: mixed to the default target (-14 LUFS) or another; subtitles as a soft track, as SRT/VTT files, or burned in as captions.
- **Parts**: a title card alone, a teaser of the first seconds, a range.

- **Variants**: the same video with other data (a title, a figure, a list per region or per customer). Say what varies; the agent gives the config `props` defaults and renders each variant with `--props` (the MCP tools' `props` argument).

Give the output folder if it matters.

### 6. Limits

What the agent cannot find out by itself: the machine's memory and what else it is doing, whether renders may run now or must wait, which API keys are set and which providers are allowed, a deadline, and anything private that must not leave the machine. One export runs at a time on a machine; when several agents share it, tell them to pass `wait: true` to `video_start`, which queues the export instead of failing. Settings every export of a project needs (a `crf`, no sound) belong in its config's `export`, not in the brief.

### 7. Done, and the report

What must be true before the agent stops:

- `check_video` reports no errors at every size delivered, and no warnings it did not choose. (It also renders some frames twice: a frame that comes out different is a `nondeterministic` error, and a `transition` on a clip that overlaps nothing a `timeline` warning.)
- It has looked at a full draft as frames (a contact sheet every half second or so, strips of each transition and each fast move) before any final render.
- It has pulled frames out of each final file and looked at them, measured the loudness, and confirmed the streams.

And what you want back: where the files are with durations and sizes, what it saw in the final frames (with a contact sheet per deliverable), what is weak and what it could not verify (the sound, above all), and anything it had to guess. If you will review in `reel review`, say so: the agent then expects notes and a second round.

## A template

```
Make a video with reel in <project folder> (create it with reel init if it is not there).

The video: <what it is, for whom, the one idea>. <Length> seconds, <tone>, for <where it is shown>.
It must get these right: <facts, figures, names, sources or files>.
<Script: "write it" | the file>. <Voice: local model | a recording at path | provider>.

Look: <direction, or "your choice; nothing that reads as a default template">.

It must contain, each where it serves the explanation:
1. <ingredient>: <what it must show>
2. ...
Do not use: <downloaded assets | hosted APIs | ...>.

Deliver, in <folder>:
- <16:9 at 4K, H.264 and HEVC 10-bit, mixed sound, soft subtitles>
- <9:16 at 1080x1920, laid out again for the tall frame>
- <SRT; a 6 s WebP teaser; the title card as ProRes 4444 with alpha, no sound>

Limits: <memory, other work on the machine, keys set, deadline>. One export at a time: start exports with `wait: true`.

Before you stop: check_video clean at every size delivered; a full draft looked at as frames before
any final; frames pulled from each final file and looked at; loudness measured.
Report: the files with durations and sizes, a contact sheet of each, what is weak, what you could
not verify, and what you had to guess.
```

## Kinds of brief

**A new video.** All seven parts. Expect a long session: script, voice, scenes, many stills, a draft, finals.

**A change to an existing video.** Parts 1, 6 and 7, plus the change itself as what the viewer should see differently, with the time or the clip ("the chart at 0:41 should grow both bars together"). Say whether to re-render and which deliverables. The agent finds the clip with `project_info` and proves the change with stills before and after.

**Review notes.** After you have watched a render in `reel review` and pinned notes: "Work through the open review notes in <project>, re-render <the draft | the finals>, resolve what you fixed, and tell me what you left open and why." The notes carry the time, the area of the frame and your words, so the brief need not repeat them.

**Another cut.** A vertical or square version, a shorter edit, a teaser, a silent loop: name the project, the new size or range, whether the layout must change for it, and the output name. The timing and sound of the original stay unless you say otherwise.

**A music video or a video cut to a song.** Give the song file and the sections you hear in it (or let the analysis find them), say what should follow the beat (cuts, accents, motion), and whether lyrics appear. The rest is as for a new video.

## What makes a brief go wrong

- **Process instead of outcome.** "Use an HtmlLayer for the title" belongs to the skills. "The title must be readable on a phone" belongs to you.
- **Typed times.** "At 12 seconds, show the diagram" breaks when the voice is re-timed. Tie moments to words ("when the narration says 'the bulge'") or to clips.
- **Ingredients as a checklist.** A list of features without what each is for gets a demo reel. Give each a job, or leave it out.
- **No data.** Charts, counters and claims need the numbers and where they come from.
- **Deliverables discovered at the end.** A vertical cut asked for after a 16:9 video is finished costs a second layout pass; asked for up front, every scene is laid out for both from the start.
- **Assuming it listened.** The agent reports loudness figures, not whether the voice sounds right. Listen to the draft yourself before asking for finals.
- **No stopping rule.** Without part 7 an agent stops when the file exists, not when it is good.
