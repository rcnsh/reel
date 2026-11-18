// The component kit: text, captions, titles, images, video, Lottie, charts, timers, code and audio visualisers, coloured by the theme, reported to
// `reel check`, and pure functions of time.
export { HtmlComponent, motionAt, safeBox, SAFE, UNIT, val, cssColor, esc, type Anim, type Box, type ComponentOptions, type Motion } from './common';
export { TextBlock, TitleCard, LowerThird, fitText, type TextBlockOptions, type TitleCardOptions, type LowerThirdOptions } from './text';
export { Captions, captionPages, textWidth, type CaptionsOptions, type CaptionPage } from './captions';
export { ImageBox, svgSize, drawPicture, kenBurnsAt, type ImageBoxOptions, type Framing, type Picture } from './image';
export { VideoClip, type VideoClipOptions } from './video';
export { LottieBox, type LottieBoxOptions } from './lottie';
export { sourceTime, frameAt, framesAt, trimFrames, videoSounds, type VideoTiming, type FrameSpan } from './video-time';
export { BarChart, LineChart, Counter, ProgressBar, Timer, clock, formatNumber, type BarChartOptions, type LineChartOptions, type CounterOptions, type ProgressBarOptions, type TimerOptions, type ProgressOptions } from './charts';
export { CodeBlock, CODE_LANGUAGES, splitHighlighted, type CodeBlockOptions } from './code';
export { Waveform, Spectrum, type WaveformOptions, type SpectrumOptions } from './audio-vis';
