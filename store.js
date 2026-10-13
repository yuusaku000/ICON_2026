// ゲームの一覧とログインを扱う。Firebase が未設定ならブラウザ内だけのデモ用に切り替える。
import { firebaseConfig, adminEmail } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

// URL に ?demo を付けると、本番のデータに触れずに試せる
export const isDemo = !firebaseConfig.apiKey || new URLSearchParams(location.search).has("demo");

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
  };
}
