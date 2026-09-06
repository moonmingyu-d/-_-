// Firebase SDK 를 사이트에 함께 담습니다.
// CDN(gstatic) 을 안 쓰므로 배포 후에도 외부 상황과 무관하게 항상 뜹니다.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

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

await build({
  entryPoints: ['build/firebase-entry.js'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  outfile: 'public/vendor/firebase.js',
});
console.log('built public/vendor/firebase.js');
