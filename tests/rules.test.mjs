// Firestore 보안 규칙 검증 — 에뮬레이터에 실제로 요청을 보내 확인합니다.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

const GOOD = 'bali-7k4m-9qxt-3rvd';   // 19자
const SHORT = 'bali-123';             // 8자
const UPPER = 'Bali-7k4m-9qxt-3rvd';

let env;
const plan = (extra = {}) => ({
  bookings: JSON.stringify([{ t: '항공권' }]),
  days: JSON.stringify([{ d: '9/13', items: [] }]),
  cap: 1000,
  ...extra
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bali',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') }
  });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env.cleanup(); });

const asUser = (uid) => env.authenticatedContext(uid).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

test('로그인하지 않으면 읽지도 쓰지도 못한다', async () => {
  const db = asGuest();
  await assertFails(getDoc(doc(db, 'rooms', GOOD)));
  await assertFails(setDoc(doc(db, 'rooms', GOOD), plan()));
});

test('로그인한 사람은 정상 방 코드로 읽고 쓸 수 있다', async () => {
  const db = asUser('husband');
  await assertSucceeds(setDoc(doc(db, 'rooms', GOOD), plan({ updatedBy: 'husband' })));
  await assertSucceeds(getDoc(doc(db, 'rooms', GOOD)));
});

test('배우자(다른 익명 계정)도 같은 방을 읽고 쓸 수 있다', async () => {
  await assertSucceeds(setDoc(doc(asUser('husband'), 'rooms', GOOD), plan({ updatedBy: 'husband' })));
  const wife = asUser('wife');
  await assertSucceeds(getDoc(doc(wife, 'rooms', GOOD)));
  await assertSucceeds(setDoc(doc(wife, 'rooms', GOOD), plan({ updatedBy: 'wife' }), { merge: true }));
});

test('짧은 방 코드는 만들 수도 열 수도 없다', async () => {
  const db = asUser('husband');
  await assertFails(setDoc(doc(db, 'rooms', SHORT), plan()));
  await assertFails(getDoc(doc(db, 'rooms', SHORT)));
});

test('대문자나 이상한 문자가 든 방 코드는 거부된다', async () => {
  const db = asUser('husband');
  await assertFails(setDoc(doc(db, 'rooms', UPPER), plan()));
});

test('앱이 쓰지 않는 필드가 섞이면 거부된다', async () => {
  const db = asUser('husband');
  await assertFails(setDoc(doc(db, 'rooms', GOOD), plan({ evil: 'x' })));
});

test('updatedBy 를 남의 이름으로 위조하면 거부된다', async () => {
  const db = asUser('husband');
  await assertFails(setDoc(doc(db, 'rooms', GOOD), plan({ updatedBy: 'someone-else' })));
});

test('cap 이 숫자가 아니면 거부된다', async () => {
  const db = asUser('husband');
  await assertFails(setDoc(doc(db, 'rooms', GOOD), plan({ cap: '천만원' })));
});

test('지나치게 큰 데이터는 거부된다 (200KB 초과)', async () => {
  const db = asUser('husband');
  await assertFails(setDoc(doc(db, 'rooms', GOOD), plan({ tips: 'ㄱ'.repeat(200001) })));
});

test('문서 삭제는 누구도 할 수 없다', async () => {
  const db = asUser('husband');
  await assertSucceeds(setDoc(doc(db, 'rooms', GOOD), plan({ updatedBy: 'husband' })));
  await assertFails(deleteDoc(doc(db, 'rooms', GOOD)));
});

test('rooms 밖의 다른 경로는 전부 막혀 있다', async () => {
  const db = asUser('husband');
  await assertFails(getDoc(doc(db, 'secrets', 'anything')));
  await assertFails(setDoc(doc(db, 'secrets', 'anything'), { a: 1 }));
});

test('바뀐 항목만 보내는 부분 저장(merge)이 통과한다', async () => {
  const db = asUser('husband');
  await assertSucceeds(setDoc(doc(db, 'rooms', GOOD), plan({ updatedBy: 'husband' })));
  await assertSucceeds(setDoc(doc(db, 'rooms', GOOD),
    { tips: JSON.stringify(['메모']), updatedBy: 'husband' }, { merge: true }));
});
