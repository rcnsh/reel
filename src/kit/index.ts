// The component kit: text, captions, titles, images, charts, timers and code, coloured by the theme, reported to
// `reel check`, and pure functions of time.
export { HtmlComponent, motionAt, safeBox, SAFE, UNIT, val, cssColor, esc, type Anim, type Box, type ComponentOptions, type Motion } from './common';
export { TextBlock, TitleCard, LowerThird, fitText, type TextBlockOptions, type TitleCardOptions, type LowerThirdOptions } from './text';
export { Captions, captionPages, type CaptionsOptions, type CaptionPage } from './captions';
export { ImageBox, type ImageBoxOptions, type Framing } from './image';
export { BarChart, LineChart, Counter, ProgressBar, Timer, clock, formatNumber, type BarChartOptions, type LineChartOptions, type CounterOptions, type ProgressBarOptions, type TimerOptions, type ProgressOptions } from './charts';
export { CodeBlock, CODE_LANGUAGES, splitHighlighted, type CodeBlockOptions } from './code';
