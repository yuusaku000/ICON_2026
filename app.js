import { createStore, isDemo, MEDIA_MAX_BYTES } from "./store.js";
import { siteTitle } from "./firebase-config.js";

const $ = (sel) => document.querySelector(sel);

let store = null;
let games = [];
let admin = false;
let editing = null; // 編集中のゲーム（新規なら null）
let thumbData = ""; // 編集フォームのサムネイル（data URL）
let mediaFile = null; // 編集フォームで新しく選んだ動画
let mediaRemoved = false; // 編集フォームで今の動画を外したか
let detailToken = 0; // 詳細を開くたびに増やす（読み込みの遅れた動画を古い画面に出さないため）
let detailMediaUrl = "";
let editorStart = ""; // 編集画面を開いたときの入力内容（閉じるときに、変更があるかを調べる）
let editingStamp = ""; // 編集を始めたときのゲームの中身（ほかの人の変更に気づくため）
// テーマカラーの候補（編集画面の色ボタン）
const DEFAULT_COLOR = "#3b5bfd";
const PRESET_COLORS = [
  ["#3b5bfd", "青"],
  ["#12a594", "青緑"],
  ["#30a46c", "緑"],
  ["#f5b800", "黄"],
  ["#f76b15", "オレンジ"],
  ["#e5484d", "赤"],
  ["#e93d82", "ピンク"],
  ["#8e4ec6", "紫"],
  ["#5b6070", "グレー"],
];

let loaded = false; // 一覧が一度でも届いたか
let loadError = "";

document.title = siteTitle;
$("#site-title").textContent = siteTitle;
$("#demo-banner").hidden = !isDemo;

// ---------- 起動 ----------

// Firestore がまだ無いときなどは、エラーにならずに待ち続けるので、時間で見切る
const loadTimer = setTimeout(() => {
  failLoad("データベースにつながりません。Firestore Database が作られているか確認してください。");
}, 10000);

try {
  store = await createStore();
  store.subscribe(
    (list) => {
      games = list;
      loaded = true;
      loadError = "";
      clearTimeout(loadTimer);
      render();
    },
    (err) => {
      console.error(err);
      failLoad("ゲームの一覧を読み込めませんでした。Firestore のルールを確認してください。");
    },
  );
  store.onAuth((isAdmin) => {
    admin = isAdmin;
    render();
  });
} catch (err) {
  console.error(err);
  failLoad("読み込めませんでした。firebase-config.js の値を確認してください。");
}

function failLoad(message) {
  clearTimeout(loadTimer);
  if (loaded) return;
  loadError = message;
  render();
}

// ---------- 一覧 ----------

function render() {
  const grid = $("#grid");
  grid.replaceChildren(...games.map(card));
  if (admin) grid.append(addCard());
  grid.classList.toggle("editing", admin);

  $("#admin-bar").hidden = !admin;
  $("#admin-guide").hidden = !admin;
  $("#edit-link").hidden = admin;
  if (loadError) setStatus(loadError);
  else if (!loaded) setStatus("読み込み中…");
  else setStatus(games.length || admin ? "" : "まだゲームがありません");
}

function setStatus(text) {
  $("#status").textContent = text;
  $("#status").hidden = !text;
}

function card(game, i) {
  const li = el("li", "card");
  applyTheme(li, themeColor(game));
  const open = el("button", "card-open");
  open.type = "button";
  open.append(thumb(game), el("span", "card-title", game.title));
  open.addEventListener("click", () => (admin ? openEditor(game) : openDetail(game)));
  li.append(open);

  if (admin) {
    const tools = el("div", "card-tools");
    tools.append(
      toolButton("◀", "前へ", i === 0, () => move(i, -1)),
      toolButton("▶", "後ろへ", i === games.length - 1, () => move(i, 1)),
    );
    li.append(tools);
  }
  return li;
}

function addCard() {
  const li = el("li", "card add");
  const btn = el("button", "card-open add-open", "＋ ゲームを追加");
  btn.type = "button";
  btn.addEventListener("click", () => openEditor(null));
  li.append(btn);
  return li;
}

function toolButton(label, title, disabled, onClick) {
  const b = el("button", "tool", label);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function thumb(game) {
  const box = el("div", "thumb");
  if (game.thumb) {
    const img = el("img");
    img.src = game.thumb;
    img.alt = "";
    box.append(img);
  } else {
    box.classList.add("noimg");
    box.append(el("span", "", game.title));
  }
  return box;
}

async function move(i, dir) {
  const ids = games.map((g) => g.id);
  [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
  try {
    await store.reorder(ids);
  } catch (err) {
    alert(errorMessage(err));
  }
}

// ---------- 詳細 ----------

function openDetail(game, { preview = false } = {}) {
  resetDetailMedia();
  $("#d-preview").hidden = !preview;
  applyTheme($("#detail"), themeColor(game));
  $("#d-thumb").replaceChildren(thumb(game));
  $("#d-title").textContent = game.title;
  fillSection("#d-controls", "#d-controls-wrap", game.controls);
  fillSection("#d-desc", "#d-desc-wrap", game.description);

  const play = $("#d-play");
  if (isWebUrl(game.url)) {
    play.href = game.url;
    play.classList.remove("disabled");
  } else {
    play.removeAttribute("href");
    play.classList.add("disabled");
  }
  $("#detail").showModal();
  $("#detail .modal-inner").scrollTop = 0;
  showDetailMedia(game);
}

// 動画が登録されていれば、読み込めたところでサムネイルと入れ替える
async function showDetailMedia(game) {
  const token = ++detailToken;
  if (!game.media && !game.mediaBlob) return;
  const box = $("#d-thumb");
  box.classList.add("loading");
  try {
    const blob = game.mediaBlob ?? (await store.loadMedia(game.media));
    if (token !== detailToken) return;
    detailMediaUrl = URL.createObjectURL(blob);
    let node;
    if (blob.type.startsWith("video/")) {
      node = el("video");
      node.muted = true;
      node.loop = true;
      node.autoplay = true;
      node.playsInline = true;
    } else {
      node = el("img");
      node.alt = "";
    }
    node.src = detailMediaUrl;
    const frame = el("div", "thumb media");
    frame.append(node);
    box.replaceChildren(frame);
  } catch (err) {
    console.error(err); // 読めなければサムネイルのまま
  } finally {
    if (token === detailToken) box.classList.remove("loading");
  }
}

// 閉じたら動画を止めて片付ける（開き直したときにも念のため呼ぶ）
function resetDetailMedia() {
  detailToken++;
  $("#d-thumb").replaceChildren();
  $("#d-thumb").classList.remove("loading");
  if (detailMediaUrl) URL.revokeObjectURL(detailMediaUrl);
  detailMediaUrl = "";
}
$("#detail").addEventListener("close", resetDetailMedia);

function fillSection(textSel, wrapSel, text) {
  $(textSel).textContent = text || "";
  $(wrapSel).hidden = !text;
}

// 遊ぶを押したら、ハブ側は一覧に戻しておく（次の人がすぐ選べるように）
$("#d-play").addEventListener("click", () => $("#detail").close());

// ---------- ログイン ----------

$("#edit-link").addEventListener("click", () => {
  $("#login-form").reset();
  $("#l-error").textContent = "";
  $("#login").showModal();
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  $("#l-error").textContent = "";
  try {
    await store.login(form.elements.password.value);
    $("#login").close();
  } catch (err) {
    $("#l-error").textContent = loginMessage(err);
  } finally {
    submit.disabled = false;
  }
});

$("#logout-btn").addEventListener("click", () => store.logout());
$("#add-btn").addEventListener("click", () => openEditor(null));

// ---------- 編集 ----------

function openEditor(game) {
  editing = game;
  const form = $("#edit-form");
  form.reset();
  form.elements.title.value = game?.title ?? "";
  form.elements.url.value = game?.url ?? "";
  form.elements.controls.value = game?.controls ?? "";
  form.elements.description.value = game?.description ?? "";
  setThumb(game?.thumb ?? "");
  setColor(themeColor(game));
  mediaFile = null;
  mediaRemoved = false;
  showMediaName();
  $("#e-heading").textContent = game ? `「${game.title}」を編集` : "ゲームを追加";
  $("#e-delete-wrap").hidden = !game;
  showEditError("");
  editorStart = formSnapshot();
  editingStamp = game ? stamp(game) : "";
  $("#editor").showModal();
  $("#edit-form .e-body").scrollTop = 0;
  if (!game) form.elements.title.focus();
}

// 入力欄の今の中身（変更があったかを比べるため）
function formSnapshot() {
  const f = $("#edit-form").elements;
  return JSON.stringify([
    f.title.value, f.url.value, f.controls.value, f.description.value,
    thumbData, $("#color").value, mediaFile?.name ?? null, mediaRemoved,
  ]);
}

// 並び順だけの変更は、ほかの人の変更として数えない
function stamp(game) {
  return JSON.stringify({ ...game, order: null });
}

function requestCloseEditor() {
  if (formSnapshot() !== editorStart && !confirm("保存していない変更があります。保存せずに閉じますか？")) return;
  $("#editor").close();
}

// Esc キーで閉じるときも、確認を挟む
$("#editor").addEventListener("cancel", (e) => {
  e.preventDefault();
  requestCloseEditor();
});

// 見え方を確認：保存する前の内容で、遊ぶ人に見える画面を開く
$("#e-preview").addEventListener("click", () => {
  const f = $("#edit-form").elements;
  const keepMedia = !mediaRemoved && !mediaFile ? editing?.media : null;
  openDetail(
    {
      title: f.title.value.trim() || "（タイトル未入力）",
      url: f.url.value.trim(),
      controls: f.controls.value.trim(),
      description: f.description.value.trim(),
      thumb: thumbData,
      color: $("#color").value,
      media: keepMedia,
      mediaBlob: mediaFile,
    },
    { preview: true },
  );
});

function setThumb(data) {
  thumbData = data;
  $("#e-thumb").hidden = !data;
  if (data) $("#e-thumb").src = data;
  else $("#e-thumb").removeAttribute("src");
  $("#drop-hint").hidden = !!data;
  $("#thumb-clear").hidden = !data;
}

$("#edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const title = form.elements.title.value.trim();
  const url = form.elements.url.value.trim();
  if (!title) return showEditError("タイトルを入れてください", form.elements.title);
  if (!isWebUrl(url)) return showEditError("URL は https:// から始まる形で入れてください", form.elements.url);

  // 編集している間に、ほかの人が同じゲームを変えたり消したりしていないか
  const latest = editing ? games.find((g) => g.id === editing.id) : null;
  if (editing && !latest) {
    if (!confirm("このゲームは、ほかの人が削除しました。保存すると、もう一度追加されます。保存しますか？")) return;
  } else if (latest && stamp(latest) !== editingStamp) {
    if (!confirm("あなたが編集している間に、ほかの人がこのゲームを変更しました。保存すると、その変更は上書きされます。保存しますか？")) return;
  }

  const data = {
    title,
    url,
    controls: form.elements.controls.value.trim(),
    description: form.elements.description.value.trim(),
    thumb: thumbData,
    color: $("#color").value,
    order: latest ? latest.order : nextOrder(), // 並べ替えられていても、今の位置のまま
  };
  if (editing) data.id = editing.id;

  const oldMedia = latest?.media ?? null;
  data.media = mediaRemoved ? null : oldMedia;

  const save = $("#e-save");
  save.disabled = true;
  save.textContent = "保存中…";
  let uploaded = null;
  try {
    if (mediaFile) {
      uploaded = await store.saveMedia(mediaFile, (p) => {
        save.textContent = `動画を送信中… ${Math.round(p * 100)}%`;
      });
      data.media = uploaded;
      save.textContent = "保存中…";
    }
    await store.save(data);
    // 差し替えたり外したりした古い動画は消す
    if (oldMedia && oldMedia.id !== data.media?.id) store.removeMedia(oldMedia.id).catch(console.error);
    $("#editor").close();
    showToast(editing ? "保存しました。全員の画面に反映されます" : "追加しました。全員の画面に反映されます");
  } catch (err) {
    if (uploaded) store.removeMedia(uploaded.id).catch(console.error);
    showEditError(errorMessage(err));
  } finally {
    save.disabled = false;
    save.textContent = "保存";
  }
});

$("#e-delete").addEventListener("click", async () => {
  if (!editing || !confirm(`「${editing.title}」を削除します。遊ぶ人の一覧からも消えます。よろしいですか？`)) return;
  try {
    await store.remove(editing.id);
    if (editing.media) store.removeMedia(editing.media.id).catch(console.error);
    $("#editor").close();
    showToast(`「${editing.title}」を削除しました`);
  } catch (err) {
    showEditError(errorMessage(err));
  }
});

function showEditError(text, field = null) {
  $("#e-error").textContent = text;
  for (const input of $("#edit-form").querySelectorAll("[aria-invalid]")) input.removeAttribute("aria-invalid");
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}

let toastTimer = 0;
function showToast(text) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function nextOrder() {
  return games.length ? Math.max(...games.map((g) => g.order ?? 0)) + 1 : 0;
}

// 動画：ファイルを選ぶか、外す
$("#media-pick").addEventListener("click", () => $("#media-file").click());
$("#media-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!/^(image\/(gif|webp)|video\/)/.test(file.type)) return showEditError("GIF・WebP か動画のファイルを選んでください");
  if (file.size > MEDIA_MAX_BYTES) {
    return showEditError(`動画が大きすぎます（${formatSize(file.size)}）。15MB までにしてください。GIF は MP4 にするとかなり小さくなります`);
  }
  showEditError("");
  mediaFile = file;
  showMediaName();
});
$("#media-clear").addEventListener("click", () => {
  if (mediaFile) mediaFile = null;
  else mediaRemoved = true;
  showMediaName();
});

function showMediaName() {
  const current = mediaRemoved ? null : editing?.media;
  const shown = mediaFile ?? current;
  $("#media-name").textContent = shown ? `${shown.name}（${formatSize(shown.size)}）` : "なし";
  $("#media-clear").hidden = !shown;
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

// テーマカラー：候補のボタンか、「自由に選ぶ」で色を決める
for (const [color, name] of PRESET_COLORS) {
  const b = el("button", "swatch");
  b.type = "button";
  b.dataset.color = color;
  b.title = name;
  b.setAttribute("aria-label", name);
  b.style.background = color;
  b.addEventListener("click", () => setColor(color));
  $("#swatches .custom").before(b);
}
$("#color").addEventListener("input", (e) => setColor(e.target.value));

function setColor(color) {
  $("#color").value = color;
  const preset = PRESET_COLORS.some(([c]) => c === color);
  for (const b of document.querySelectorAll("#swatches button")) {
    b.setAttribute("aria-pressed", b.dataset.color === color);
  }
  $("#swatches .custom").classList.toggle("selected", !preset);
}

// サムネイル：クリック・ドラッグ・貼り付けのどれでも
const drop = $("#drop");
drop.addEventListener("click", () => $("#file").click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("#file").click();
  }
});
$("#file").addEventListener("change", (e) => {
  takeImage(e.target.files[0]);
  e.target.value = "";
});
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  takeImage(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  if (!$("#editor").open) return;
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    takeImage(file);
  }
});
$("#thumb-clear").addEventListener("click", () => setThumb(""));

async function takeImage(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return showEditError("画像ファイルを選んでください");
  try {
    setThumb(await shrinkImage(file));
    showEditError("");
  } catch (err) {
    console.error(err);
    showEditError("この画像は読み込めませんでした");
  }
}

// Firestore の1件の上限（1MB）に収まるよう、横幅を縮めて JPEG にする
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 960 / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // 透過PNGが黒くならないように
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const data = canvas.toDataURL("image/jpeg", q);
    if (data.length < 400_000) return data;
  }
  return canvas.toDataURL("image/jpeg", 0.3);
}

// ---------- 共通 ----------

// 編集画面だけは、入力が消えないよう外側を押しても閉じず、キャンセルでは確認を挟む
for (const dialog of document.querySelectorAll("dialog")) {
  const isEditor = dialog.id === "editor";
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) isEditor ? requestCloseEditor() : dialog.close();
    else if (e.target === dialog && !isEditor) dialog.close();
  });
}

function themeColor(game) {
  return /^#[0-9a-f]{6}$/i.test(game?.color ?? "") ? game.color : DEFAULT_COLOR;
}

// テーマカラーと、その上に載せる文字の色（白か黒の読みやすいほう）を設定する
function applyTheme(node, color) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  node.style.setProperty("--theme", color);
  node.style.setProperty("--on-theme", luminance > 0.179 ? "#14161f" : "#ffffff");
}

function isWebUrl(text) {
  try {
    return ["https:", "http:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

function loginMessage(err) {
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/missing-password":
      return "パスワードが違います";
    case "auth/too-many-requests":
      return "失敗が続いたので、しばらく待ってからもう一度試してください";
    case "auth/invalid-email":
    case "auth/user-not-found":
      return "firebase-config.js の adminEmail を確認してください";
    default:
      return "ログインできませんでした（" + (err.code || err.message) + "）";
  }
}

function errorMessage(err) {
  console.error(err);
  if (err.code === "permission-denied") return "保存する権限がありません。firestore.rules のメールアドレスを確認してください";
  return "保存できませんでした（" + (err.code || err.message) + "）";
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
