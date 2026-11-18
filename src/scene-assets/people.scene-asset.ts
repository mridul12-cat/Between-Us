import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from '@iwsdk/core';

/** Original procedural people: floor origin, +Z face, 1.72m tall, 0.6m wide. */
export function createPerson(shirt: string, skin: string, hair: string, style: number): Group {
  const root = new Group(); root.name = 'Person';
  const cloth = new MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const face = new MeshStandardMaterial({ color: skin, roughness: 0.9 });
  const dark = new MeshStandardMaterial({ color: hair, roughness: 0.95 });
  const pants = new MeshStandardMaterial({ color: '#343c50', roughness: 0.9 });
  const ivory = new MeshStandardMaterial({ color: '#faf3df', roughness: 0.8 });
  const eye = new MeshStandardMaterial({ color: '#24283a' });
  const sphere = new SphereGeometry(1, 20, 12);
  const capsule = new CapsuleGeometry(1, 1, 4, 12);
  function part(name: string, material: MeshStandardMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, round = true): Mesh {
    const m = new Mesh(round ? sphere : capsule, material); m.name = name;
    m.position.set(x,y,z); m.scale.set(sx,sy,sz); root.add(m); return m;
  }
  const silhouette = style === 0 ? 0.235 : style === 1 ? 0.222 : 0.263;
  part('Torso', cloth, 0,1.03,0,silhouette,0.34,0.16);
  part('Neck', face,0,1.38,0,0.075,0.11,0.075);
  part('Head',face,0,1.54,0,0.155,0.19,0.145);
  part('Hair',dark,0,1.65,-0.025,0.164,0.105,0.15);
  if(style===0) part('Bun',dark,0,1.64,-0.15,0.09,0.1,0.08);
  if(style===1) { part('HairLeft',dark,-0.13,1.47,-0.025,0.065,0.18,0.11); part('HairRight',dark,0.13,1.47,-0.025,0.065,0.18,0.11); }
  for(const side of [-1,1]) {
    part('Eye',eye,side*0.055,1.56,0.135,0.014,0.018,0.009);
    part('Brow',dark,side*0.055,1.60,0.131,0.027,0.008,0.009);
    const arm=part(side<0?'LeftArm':'RightArm',cloth,side*0.31,1.02,0,0.072,0.17,0.075,false); arm.rotation.z=side*0.12;
    part('Hand',face,side*0.345,0.73,0.025,0.065,0.095,0.06);
    part('Leg',pants,side*0.11,0.42,0,0.088,0.22,0.09,false);
    part('Shoe',ivory,side*0.11,0.075,0.045,0.1,0.075,0.17);
  }
  part('Nose',face,0,1.52,0.143,0.027,0.032,0.03);
  part('Smile',dark,0,1.475,0.135,0.035,0.008,0.008);
  if (style === 0) {
    const scarf = new MeshStandardMaterial({color: '#f4c58f', roughness: 0.93});
    part('Scarf collar', scarf, 0, 1.275, 0.09, 0.156, 0.075, 0.12);
    part('Scarf end', scarf, -0.083, 1.135, 0.153, 0.051, 0.151, 0.026).rotation.z = -0.13;
  } else if (style === 1) {
    for (const side of [-1, 1]) part('Brass earring', ivory, side * 0.15, 1.489, 0.048, 0.021, 0.035, 0.018);
  } else {
    part('Jacket collar', ivory, 0, 1.275, 0.082, 0.127, 0.062, 0.093);
    part('Jacket seam', dark, 0, 1.055, 0.152, 0.015, 0.202, 0.019);
  }

  // Add a pivot to the head assembly so eyes, hair and jewelry follow its motion.
  const head = new Group();
  head.name = 'HeadMotion';
  head.position.y = 1.5;
  for (const mesh of [...root.children]) {
    if (mesh.position.y < 1.45) continue;
    mesh.position.y -= head.position.y;
    head.add(mesh);
  }
  root.add(head);
  const ring=new Mesh(new TorusGeometry(0.43,0.014,6,48),new MeshStandardMaterial({color:shirt,emissive:shirt,emissiveIntensity:0.25}));
  ring.name='SelectionRing'; ring.rotation.x=-Math.PI/2; ring.position.y=0.018; root.add(ring);
  return root;
}
