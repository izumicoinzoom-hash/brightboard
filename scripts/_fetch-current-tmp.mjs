import admin from 'firebase-admin';
import fs from 'node:fs';
admin.initializeApp({ projectId: 'brightboard-4595a' });
const db = admin.firestore();
function ser(v){
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') {
    if (v._seconds !== undefined && v._nanoseconds !== undefined) {
      return { type:'timestamp', seconds:v._seconds, nanoseconds:v._nanoseconds };
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = ser(v[k]);
    return o;
  }
  return v;
}
const snap = await db.collection('boards/main/tasks').get();
const tasks = snap.docs.map(d => ser({id:d.id, ...d.data()}));
fs.writeFileSync('/tmp/bb-forensics/current.json',
  JSON.stringify({exportedAt:new Date().toISOString(), taskCount:tasks.length, tasks}, null, 2));
console.log('wrote', tasks.length);
