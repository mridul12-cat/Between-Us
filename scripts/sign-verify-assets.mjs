import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../public/sign/asset-manifest.json',import.meta.url),'utf8'));
for(const entry of manifest.assets){
 const bytes=await readFile(new URL('../public/sign/'+entry.path,import.meta.url));
 if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Sign asset mismatch: '+entry.path+'. Restore the pinned model or run npm run sign:assets for runtime assets.');
}
console.log(`Verified ${manifest.assets.length} pinned sign model/runtime assets.`);
