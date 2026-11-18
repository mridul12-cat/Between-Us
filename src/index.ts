import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ExperienceSystem } from './experience.js';
World.create(document.getElementById('scene-container') as HTMLDivElement,projectOptions)
  .then(world=>world.registerSystem(ExperienceSystem))
  .catch((error:unknown)=>{ console.error('Between Us could not start',error);document.getElementById('startup-error')!.textContent='Unable to start the XR scene. Check the development console and reload.'; });
