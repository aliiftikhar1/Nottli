import { Composition, Still } from 'remotion';
import { Trailer, TOTAL_FRAMES, FPS } from './Trailer';
import { Thumbnail } from './Thumbnail';

export const Root = () => (
  <>
    <Composition id="Trailer" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
  </>
);
