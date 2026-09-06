// Firebase SDK 를 사이트에 함께 담습니다.
// CDN(gstatic) 을 안 쓰므로 배포 후에도 외부 상황과 무관하게 항상 뜹니다.
//
// 파일 이름에 내용 지문(해시)을 붙입니다.
// 내용이 바뀌면 주소가 바뀌므로, 브라우저에 캐시된 옛 파일을 새 index.html 이
// 불러오다 앱 전체가 죽는 사고가 생기지 않습니다.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';

const ENTRY = `
export { initializeApp } from 'firebase/app';
export {
  getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, getDoc, deleteDoc, serverTimestamp,
  enableNetwork, disableNetwork, connectFirestoreEmulator
} from 'firebase/firestore';
`;

mkdirSync('build', { recursive: true });
writeFileSync('build/firebase-entry.js', ENTRY);

const out = await build({
  entryPoints: ['build/firebase-entry.js'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
});
const code = out.outputFiles[0].text;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
const name = `firebase.${hash}.js`;

mkdirSync('public/vendor', { recursive: true });
for(const f of readdirSync('public/vendor')){
  if(/^firebase[.\w]*\.js$/.test(f) && f !== name) unlinkSync('public/vendor/' + f);
}
writeFileSync('public/vendor/' + name, code);

// index.html 의 import 주소를 새 파일로 맞춥니다
const page = 'public/index.html';
const html = readFileSync(page, 'utf8');
const fixed = html.replace(/from '\.\/vendor\/firebase[.\w]*\.js'/, `from './vendor/${name}'`);
if(fixed === html && !html.includes(`./vendor/${name}`))
  throw new Error('index.html 의 import 줄을 찾지 못했습니다');
writeFileSync(page, fixed);

console.log(`built public/vendor/${name} (${(code.length / 1024).toFixed(0)}KB)`);
