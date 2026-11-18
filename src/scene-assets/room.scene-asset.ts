import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from '@iwsdk/core';

/** Floor-contact origin, +Z open entry. All geometry belongs to the virtual lounge. */
export function createRoom(): Group {
  const room = new Group();
  room.name = 'ConversationLounge';
  const plaster = material('#d9c3aa');
  const oak = material('#97674b');
  const trim = material('#543d3d');
  const indigo = material('#505376');
  const teal = material('#487d77');
  const linen = material('#e8d5b7');
  const darkLeaf = material('#315d52');
  const lightLeaf = material('#598575');
  const pendantGlow = new MeshStandardMaterial({
    color: '#fff0c8', emissive: '#ffba79', emissiveIntensity: 0.65, roughness: 0.75,
  });
  const rounded = new SphereGeometry(1, 14, 8);

  function material(color: string) {
    return new MeshStandardMaterial({color, roughness: 0.9});
  }

  function box(name: string, x: number, y: number, z: number, w: number, h: number, d: number, finish: MeshStandardMaterial) {
    const mesh = new Mesh(new BoxGeometry(w, h, d), finish);
    mesh.name = name;
    mesh.position.set(x, y, z);
    room.add(mesh);
  }

  box('Oak floor', 0, -0.06, -2, 12, 0.12, 12, oak);
  for (let seam = -5; seam <= 5; seam++) {
    box('Floor joint', seam, 0.001, -2, 0.008, 0.002, 12, trim);
  }

  const rug = new Mesh(new CylinderGeometry(2.85, 2.85, 0.014, 56), indigo);
  rug.name = 'Woven conversation rug';
  rug.position.set(0, 0.009, -3.18);
  rug.scale.z = 0.86;
  room.add(rug);
  const piping = new Mesh(new TorusGeometry(2.66, 0.009, 5, 64), linen);
  piping.name = 'Rug stitching';
  piping.rotation.x = -Math.PI / 2;
  piping.scale.y = 0.86;
  piping.position.set(0, 0.021, -3.18);
  room.add(piping);

  box('Warm plaster', 0, 1.88, -6.6, 11, 3.76, 0.17, plaster);
  box('Indigo alcove', 0, 1.94, -6.48, 4.9, 3.65, 0.1, indigo);
  box('Oak picture rail', 0, 3.51, -6.36, 4.94, 0.055, 0.08, oak);
  for (const side of [-1, 1]) {
    box('Side return', side * 4.75, 1.88, -4.85, 0.17, 3.76, 3.5, plaster);
    for (let slat = 0; slat < 9; slat++) {
      box('Oak slat', side * (2.57 + slat * 0.195), 1.88, -6.38, 0.073, 3.76, 0.095, oak);
    }
    box('Low shelf', side * 3.85, 0.74, -5.48, 1.3, 0.065, 0.52, oak);
    box('Shelf support', side * 3.85, 0.35, -5.48, 0.15, 0.7, 0.4, trim);
    const pot = new Mesh(new CylinderGeometry(0.19, 0.14, 0.31, 14), linen);
    pot.name = 'Ceramic planter';
    pot.position.set(side * 3.75, 0.93, -5.45);
    room.add(pot);
    for (let i = 0; i < 7; i++) {
      const leaf = new Mesh(rounded, i % 2 ? darkLeaf : lightLeaf);
      const angle = i * 2.4;
      leaf.name = 'Plant leaf';
      leaf.position.set(side * 3.75 + Math.cos(angle) * 0.16, 1.18 + i * 0.055, -5.45 + Math.sin(angle) * 0.14);
      leaf.rotation.set(0.3, angle, Math.cos(angle) * 0.9);
      leaf.scale.set(0.09, 0.23, 0.025);
      room.add(leaf);
    }
    box('Pendant stem', side * 2.13, 3.49, -5.3, 0.028, 0.68, 0.028, trim);
    const shade = new Mesh(rounded, pendantGlow);
    shade.name = 'Opal pendant';
    shade.position.set(side * 2.13, 3.11, -5.3);
    shade.scale.set(0.29, 0.16, 0.29);
    room.add(shade);
  }

  box('Bench plinth', 0, 0.2, -5.98, 3.62, 0.4, 0.44, oak);
  box('Bench seat', 0, 0.45, -5.95, 3.86, 0.17, 0.64, teal);
  box('Bench back', 0, 0.77, -6.21, 3.86, 0.49, 0.13, teal);
  return room;
}
