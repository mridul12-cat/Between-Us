import { AssetType, defineAssets } from '@iwsdk/core';
import { createPerson } from './scene-assets/people.scene-asset.js';
import { createRoom } from './scene-assets/room.scene-asset.js';
const panel = (name: string) => ({url:`${import.meta.env.BASE_URL}ui/${name}.uikitml`,type:AssetType.UIKitML});
export default defineAssets({
  asha:createPerson('#4d9c90','#ba8567','#302b34',0),
  lucia:createPerson('#9181aa','#d7a486','#453137',1),
  alex:createPerson('#c49a62','#d7b397','#574537',2),
  room:createRoom(),
  entry:panel('entry'), toolbar:panel('toolbar'), caption:panel('caption'),
  settings:panel('settings'), history:panel('history'), masthead:panel('masthead'),identity:panel('identity'),
});
