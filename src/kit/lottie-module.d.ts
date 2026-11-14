// lottie-web's light canvas player as an ES module (the package types only its main entry).
declare module 'lottie-web/build/player/esm/lottie_light_canvas.min.js' {
  import type { LottiePlayer } from 'lottie-web';
  const lottie: LottiePlayer;
  export default lottie;
}
