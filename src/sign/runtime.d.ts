// The npm alias keeps ORT 1.31.1 separate from Whisper's development runtime.
// ORT Web re-exports this public, shared API; its alias types redirect is not a TS module.
declare module 'gesturesign-ort/wasm' {
  export { env, Tensor, InferenceSession } from 'onnxruntime-common';
}
