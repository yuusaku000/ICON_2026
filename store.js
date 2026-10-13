// ゲームの一覧とログインを扱う。Firebase が未設定ならブラウザ内だけのデモ用に切り替える。
import { firebaseConfig, adminEmail } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

// URL に ?demo を付けると、本番のデータに触れずに試せる
export const isDemo = !firebaseConfig.apiKey || new URLSearchParams(location.search).has("demo");

// 動画（GIF・MP4 など）は Firestore の1件の上限（1MB）に収まるよう、分けて保存する
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const CHUNK_BYTES = 900 * 1024;

export function createStore() {
  return isDemo ? demoStore() : firebaseStore();
}

async function firebaseStore() {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  // 共用PCなので、ブラウザを閉じたらログインが切れるようにする
  await au.setPersistence(auth, au.browserSessionPersistence);
  const games = fs.collection(db, "games");

  return {
    subscribe(onGames, onError) {
      // つながらないと手元の空データを返してくるので、サーバーから一度届くまでは渡さない
      let reachedServer = false;
      return fs.onSnapshot(
        fs.query(games, fs.orderBy("order")),
        { includeMetadataChanges: true },
        (snap) => {
          if (!snap.metadata.fromCache) reachedServer = true;
          if (reachedServer) onGames(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        onError,
      );
    },
    onAuth(cb) {
      return au.onAuthStateChanged(auth, (user) => cb(!!user));
    },
    login(password) {
      return au.signInWithEmailAndPassword(auth, adminEmail, password);
    },
    logout() {
      return au.signOut(auth);
    },
    async save({ id, ...data }) {
      data.updatedAt = fs.serverTimestamp();
      if (id) await fs.setDoc(fs.doc(games, id), data);
      else await fs.addDoc(games, data);
    },
    remove(id) {
      return fs.deleteDoc(fs.doc(games, id));
    },
    async reorder(ids) {
      const batch = fs.writeBatch(db);
      ids.forEach((id, i) => batch.update(fs.doc(games, id), { order: i }));
      await batch.commit();
    },
    async saveMedia(file, onProgress) {
      const id = crypto.randomUUID();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const count = Math.ceil(bytes.length / CHUNK_BYTES);
      const chunks = fs.collection(db, "media", id, "chunks");
      for (let i = 0; i < count; i++) {
        const part = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
        await fs.setDoc(fs.doc(chunks, String(i)), { i, data: fs.Bytes.fromUint8Array(part) });
        onProgress?.((i + 1) / count);
      }
      await cachePut(id, file);
      return mediaInfo(id, file, count);
    },
    async loadMedia(media) {
      const cached = await cacheGet(media.id);
      if (cached) return cached;
      const snap = await fs.getDocs(fs.query(fs.collection(db, "media", media.id, "chunks"), fs.orderBy("i")));
      if (snap.size !== media.chunks) throw new Error(`動画の一部が見つかりません（${snap.size}/${media.chunks}）`);
      const blob = new Blob(snap.docs.map((d) => d.data().data.toUint8Array()), { type: media.type });
      await cachePut(media.id, blob);
      return blob;
    },
    async removeMedia(id) {
      const snap = await fs.getDocs(fs.collection(db, "media", id, "chunks"));
      const batch = fs.writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      await cacheDelete(id);
    },
  };
}

async function demoStore() {
  const KEY = "gamehub-demo";
  const PASSWORD = "demo";
  const gameSubs = new Set();
  const authSubs = new Set();
  let games = [];
  let admin = false;
  try {
    games = JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {}

  const sorted = () => structuredClone([...games].sort((a, b) => a.order - b.order));
  const emitGames = () => gameSubs.forEach((cb) => cb(sorted()));
  const emitAuth = () => authSubs.forEach((cb) => cb(admin));
  const commit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(games));
    } catch {}
    emitGames();
  };

  return {
    subscribe(onGames) {
      gameSubs.add(onGames);
      queueMicrotask(() => onGames(sorted()));
      return () => gameSubs.delete(onGames);
    },
    onAuth(cb) {
      authSubs.add(cb);
      queueMicrotask(() => cb(admin));
      return () => authSubs.delete(cb);
    },
    async login(password) {
      if (password !== PASSWORD) throw Object.assign(new Error("wrong password"), { code: "auth/invalid-credential" });
      admin = true;
      emitAuth();
    },
    async logout() {
      admin = false;
      emitAuth();
    },
    async save({ id, ...data }) {
      if (id) games = games.map((g) => (g.id === id ? { id, ...data } : g));
      else games.push({ id: crypto.randomUUID(), ...data });
      commit();
    },
    async remove(id) {
      games = games.filter((g) => g.id !== id);
      commit();
    },
    async reorder(ids) {
      games.forEach((g) => (g.order = ids.indexOf(g.id)));
      commit();
    },
    // デモでは動画をブラウザのキャッシュにだけ置く
    async saveMedia(file, onProgress) {
      const id = crypto.randomUUID();
      await cachePut(id, file);
      onProgress?.(1);
      return mediaInfo(id, file, 1);
    },
    async loadMedia(media) {
      const blob = await cacheGet(media.id);
      if (!blob) throw new Error("動画が見つかりません");
      return blob;
    },
    async removeMedia(id) {
      await cacheDelete(id);
    },
  };
}

function mediaInfo(id, file, chunks) {
  return { id, name: file.name, type: file.type, size: file.size, chunks };
}

// 一度読み込んだ動画は、そのPCのブラウザに取っておく（毎回ダウンロードしないように）
const MEDIA_CACHE = "gamehub-media";
const mediaKey = (id) => new URL(`__media/${id}`, location.href).href;

async function cacheGet(id) {
  try {
    const res = await (await caches.open(MEDIA_CACHE)).match(mediaKey(id));
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

async function cachePut(id, blob) {
  try {
    const headers = { "Content-Type": blob.type || "application/octet-stream" };
    await (await caches.open(MEDIA_CACHE)).put(mediaKey(id), new Response(blob, { headers }));
  } catch {}
}

async function cacheDelete(id) {
  try {
    await (await caches.open(MEDIA_CACHE)).delete(mediaKey(id));
  } catch {}
}
