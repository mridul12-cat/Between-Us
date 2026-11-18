import { describe, expect, it, vi } from 'vitest';
import { resample, resampleTimed, type ModelInput } from '../src/sign/vendor/features';

import { Recognizer, type RecognizerEvent } from '../src/sign/vendor/recognizer';
import { emptyFrame, LEFT_HAND_START, LIPS, N_HAND, POSE_START } from '../src/sign/vendor/landmarks';
import type { ModelMeta, SignLabel } from '../src/sign/vendor/meta';

describe('live landmark sampling', () => {
  it('preserves the timing of irregularly dropped frames', () => {
    const frames = [0, 2, 3].map(value => Float32Array.of(value));
    const values = (sequence: Float32Array[]) => sequence.map(frame => frame[0]);
    const timed = values(resampleTimed(frames, [1000, 1066.6667, 1100], 30));
    expect(timed).toHaveLength(4);
    timed.forEach((value, index) => expect(value).toBeCloseTo(index, 5));
    expect(values(resample(frames, 20, 30))).not.toEqual(values(resampleTimed(frames, [1000, 1066.6667, 1100], 30)));
  });

  it('matches GestureSign uniform interpolation with regular capture times', () => {
    const frames = [1, 3, 9, 11].map(value => Float32Array.of(value, NaN));
    const times = [100, 140, 180, 220];
    expect(resampleTimed(frames, times, 30)).toEqual(resample(frames, 25, 30));
  });
});

const meta = {
  featureSet: 'hands_pose_lips', fps: 30, minFrames: 8, maxFrames: 64,
  calibration: { temperature: 1, notSureBelow: 0.29 },
} as ModelMeta;
const labels = [{ shipped: true }, { shipped: true }] as SignLabel[];

function sample(x: number) {
  const frame = emptyFrame();
  for(let i=0;i<N_HAND;i++) frame.set([x+i*0.001, 0.4, 0], (LEFT_HAND_START+i)*3);
  for (const lip of LIPS) frame.set([0.5, 0.2, 0], lip*3);
  frame.set([0.3, 0.5, 0], (POSE_START+11)*3);
  frame.set([0.7, 0.5, 0], (POSE_START+12)*3);
  return frame;
}

function recognize(live: boolean, gap = 0) {
  const infer = vi.fn(async (_input: ModelInput) => ({ logits: Float32Array.of(5, 0), embedding: new Float32Array(0) }));
  const events: RecognizerEvent[] = [];
  const recognizer = new Recognizer(meta, labels, infer, event => events.push(event), live);
  for (let i=0;i<6;i++) recognizer.push({frame:sample(0.20+0.045*i),t:i*66+(i>=3?gap:0),poses:1});
  for (let i=6;i<13;i++) recognizer.push({frame:emptyFrame(),t:i*66+gap,poses:1});
  return { infer, events };
}

it('admits brief, sufficiently sampled live motion at 15 fps and preserves the eight-model-frame floor', () => {
  expect(recognize(false).infer).not.toHaveBeenCalled();
  const {infer}=recognize(true);
  expect(infer).toHaveBeenCalledTimes(1);
  expect(infer.mock.calls[0][0]).toMatchObject({frames:10,dim:460});
});

it('drops an open segment spanning a camera stall instead of interpolating through it', () => {
  const {infer,events}=recognize(true,350);
  expect(infer).not.toHaveBeenCalled();
  expect(events).toContainEqual({type:'discarded',reason:'camera gap',frames:3});
});
