// The component kit: text, kinetic text, captions, titles, images, video, Lottie, charts, timers, code, drawn-on lines and arrows, and layout helpers, coloured by the theme, reported to
// `reel check`, and pure functions of time.
export { HtmlComponent, motionAt, progressOf, lineWidth, safeBox, SAFE, UNIT, val, cssColor, esc, type Anim, type Box, type ComponentOptions, type Motion, type ProgressOptions } from './common';
export { inset, split, grid, align, center, type Inset, type Align } from './layout';
export { TextBlock, TitleCard, LowerThird, fitText, type TextBlockOptions, type TitleCardOptions, type LowerThirdOptions } from './text';
export { KineticText, kineticPieces, type KineticTextOptions, type KineticEntrance } from './kinetic';
export { Captions, captionPages, textWidth, type CaptionsOptions, type CaptionPage } from './captions';
export { ImageBox, svgSize, drawPicture, kenBurnsAt, type ImageBoxOptions, type Framing, type Picture } from './image';
export { VideoClip, type VideoClipOptions } from './video';
export { LottieBox, type LottieBoxOptions } from './lottie';
export { sourceTime, frameAt, framesAt, trimFrames, videoSounds, type VideoTiming, type FrameSpan } from './video-time';
export { BarChart, LineChart, Counter, ProgressBar, Timer, clock, formatNumber, type BarChartOptions, type LineChartOptions, type CounterOptions, type ProgressBarOptions, type TimerOptions } from './charts';
export { SvgDraw, Arrow, anchor, arrowTrack, pointAlong, drawShares, svgLength, type SvgDrawOptions, type SvgPath, type ArrowOptions, type Point, type Side, type Track } from './draw';
export { CodeBlock, CODE_LANGUAGES, splitHighlighted, type CodeBlockOptions } from './code';
