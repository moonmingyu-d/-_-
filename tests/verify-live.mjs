/* 실제 Firebase 프로젝트(mgsg-344be)에 붙어서 설정이 제대로 됐는지 확인합니다.
   - 익명 로그인이 켜져 있는지
   - 보안 규칙이 게시됐고 의도대로 동작하는지
   - 실제로 쓰고 읽을 수 있는지                                             */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const block = html.match(/const FIREBASE_CONFIG = \{[\s\S]*?\n\};/)[0];
const cfg = Object.fromEntries([...block.matchAll(/(\w+):\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
console.log(`프로젝트: ${cfg.projectId}\n`);

const app = initializeApp(cfg);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const GOOD  = 'zzz-verify-delete-me-01';   // 23자 (검증 후 콘솔에서 지우면 됩니다)
const EMPTY = 'zzz-none-exists-9k4m2';     // 21자, 없는 방
const SHORT = 'bali-123';                  // 8자 — 규칙이 막아야 함

let passed = 0, failed = 0;
const ok  = m => { passed++; console.log('  ✓ ' + m); };
const bad = (m, e) => { failed++; console.log('  ✗ ' + m + (e ? ` — ${e.code || e.message}` : '')); };

async function shouldPass(name, fn){
  try{ await fn(); ok(name); }catch(e){ bad(name, e); }
}
async function shouldFail(name, fn, wantCode = 'permission-denied'){
  try{ await fn(); bad(name + ' (막혔어야 하는데 통과됨)'); }
  catch(e){
    if(e.code === wantCode) ok(name);
    else bad(name + ' (다른 이유로 실패)', e);
  }
}

/* 1. 익명 로그인 */
let uid = null;
try{
  const cred = await signInAnonymously(auth);
  uid = cred.user.uid;
  ok(`익명 로그인 성공 (uid ${uid.slice(0, 8)}…)`);
}catch(e){
  bad('익명 로그인', e);
  if(e.code === 'auth/operation-not-allowed')
    console.log('\n    → Firebase 콘솔 → Authentication → Sign-in method → 익명 을 켜주세요.\n');
  process.exit(1);
}

/* 2. 규칙이 게시됐는지 (기본 프로덕션 규칙이면 읽기도 막힘) */
await shouldPass('정상 길이 방 코드로 읽기 허용 → 규칙이 게시돼 있음',
  () => getDoc(doc(db, 'rooms', EMPTY)));

/* 3. 짧은 방 코드 차단 */
await shouldFail('짧은 방 코드(8자)는 읽기 거부',
  () => getDoc(doc(db, 'rooms', SHORT)));
await shouldFail('짧은 방 코드(8자)는 쓰기 거부',
  () => setDoc(doc(db, 'rooms', SHORT), { tips: '[]' }));

/* 4. 문서 모양 검증 */
await shouldFail('앱이 쓰지 않는 필드가 섞이면 거부',
  () => setDoc(doc(db, 'rooms', GOOD), { tips: '[]', evil: 'x' }));
await shouldFail('updatedBy 를 남의 이름으로 위조하면 거부',
  () => setDoc(doc(db, 'rooms', GOOD), { tips: '[]', updatedBy: 'someone-else' }));

/* 5. 실제 저장·읽기 (앱이 하는 것과 같은 방식) */
const sample = JSON.stringify(['연결 확인용 메모']);
await shouldPass('실제 저장 (앱과 동일한 부분 저장 방식)',
  () => setDoc(doc(db, 'rooms', GOOD),
    { tips: sample, cap: 1000, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true }));

await shouldPass('저장한 내용 다시 읽기', async () => {
  const snap = await getDoc(doc(db, 'rooms', GOOD));
  if(!snap.exists()) throw new Error('문서가 없음');
  if(snap.data().tips !== sample) throw new Error('내용이 다름');
  if(!snap.data().updatedAt) throw new Error('서버 시각이 안 찍힘');
});

/* 6. 삭제 차단 */
await shouldFail('문서 삭제는 차단됨 (사고 방지)',
  () => deleteDoc(doc(db, 'rooms', GOOD)));

/* 7. 다른 경로 차단 */
await shouldFail('rooms 밖의 경로는 차단됨',
  () => getDoc(doc(db, 'secrets', 'anything')));

/* 8. 사진 — 실제로 올리고 읽고 지워봅니다 (뒤처리까지) */
const PH = (extra = {}) => ({
  thumb: 'data:image/jpeg;base64,' + 'A'.repeat(400),
  full:  'data:image/jpeg;base64,' + 'A'.repeat(4000),
  w: 1280, h: 853, by: uid, ...extra
});
const phRef = (id = 'verify1', room = GOOD) => doc(db, 'rooms', room, 'photos', id);

await shouldPass('사진 올리기 (rooms/{방}/photos 경로가 열려 있음)',
  () => setDoc(phRef(), PH()));

await shouldPass('올린 사진 다시 읽기', async () => {
  const s = await getDoc(phRef());
  if(!s.exists()) throw new Error('사진 문서가 없음');
  if(s.data().w !== 1280) throw new Error('내용이 다름');
});

await shouldFail('사진: 앱이 쓰지 않는 필드가 섞이면 거부',
  () => setDoc(phRef('verify2'), PH({ evil: 'x' })));
await shouldFail('사진: 남의 이름으로 올리면 거부',
  () => setDoc(phRef('verify3'), PH({ by: 'someone-else' })));
await shouldFail('사진: 한도(700KB)를 넘으면 거부',
  () => setDoc(phRef('verify4'), PH({ full: 'A'.repeat(700001) })));
await shouldFail('사진: 짧은 방 코드에는 올릴 수 없음',
  () => setDoc(phRef('verify5', SHORT), PH()));

await shouldPass('사진 지우기 (잘못 올린 사진 정리 가능)',
  () => deleteDoc(phRef()));

console.log(`\n통과 ${passed}개 / 실패 ${failed}개`);
if(failed === 0) console.log(`\n검증용 사진은 스스로 지웠습니다. 콘솔에는 rooms/${GOOD} 문서 하나만 남아 있습니다.`);
process.exit(failed ? 1 : 0);
