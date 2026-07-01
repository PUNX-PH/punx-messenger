import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from './firebase'

export async function uploadFile(path, file) {
  const r = ref(storage, path)
  await uploadBytes(r, file, { contentType: file.type })
  return await getDownloadURL(r)
}

export function newId() {
  // 20-char Firestore-compatible id
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(20))
  for (let i = 0; i < 20; i++) s += chars[r[i] % chars.length]
  return s
}
