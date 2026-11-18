import { createComponent, defineComponents, Types } from '@iwsdk/core';
export const Speaker = createComponent('Speaker',{ speakerId:{type:Types.String,default:''},phase:{type:Types.Float32,default:0} });
export default defineComponents([Speaker]);
