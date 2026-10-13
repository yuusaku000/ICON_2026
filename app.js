import { createStore, isDemo } from "./store.js";
import { siteTitle } from "./firebase-config.js";

const $ = (sel) => document.querySelector(sel);

let store = null;
let games = [];
let admin = false;
let editing = null; // 編集中のゲーム（新規なら null）
let thumbData = ""; // 編集フォームのサムネイル（data URL）

document.title = siteTitle;
$("#site-title").textContent = siteTitle;
$("#demo-banner").hidden = !isDemo;

// ---------- 起動 ----------

try {
  store = await createStore();
  store.subscribe(
    (list) => {
      games = list;
      render();
    },
    (err) => {
      console.error(err);
      setStatus("ゲームの一覧を読み込めませんでした。Firestore の設定（ルール）を確認してください。");
    },
  );
  store.onAuth((isAdmin) => {
    admin = isAdmin;
    render();
  });
} catch (err) {
  console.error(err);
  setStatus("読み込めませんでした。firebase-config.js の値を確認してください。");
}

// ---------- 一覧 ----------

function render() {
  const grid = $("#grid");
  grid.replaceChildren(...games.map(card));
  if (admin) grid.append(addCard());
  grid.classList.toggle("editing", admin);

  $("#admin-bar").hidden = !admin;
  $("#edit-link").hidden = admin;
  setStatus(games.length || admin ? "" : "まだゲームがありません");
}

function setStatus(text) {
  $("#status").textContent = text;
  $("#status").hidden = !text;
}

function card(game, i) {
  const li = el("li", "card");
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

function openDetail(game) {
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
}

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
  $("#e-heading").textContent = game ? "ゲームを編集" : "ゲームを追加";
  $("#e-delete").hidden = !game;
  $("#e-error").textContent = "";
  $("#editor").showModal();
}

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
  if (!title) return showEditError("タイトルを入れてください");
  if (!isWebUrl(url)) return showEditError("URL は https:// から始まる形で入れてください");

  const data = {
    title,
    url,
    controls: form.elements.controls.value.trim(),
    description: form.elements.description.value.trim(),
    thumb: thumbData,
    order: editing ? editing.order : nextOrder(),
  };
  if (editing) data.id = editing.id;

  const save = $("#e-save");
  save.disabled = true;
  save.textContent = "保存中…";
  try {
    await store.save(data);
    $("#editor").close();
  } catch (err) {
    showEditError(errorMessage(err));
  } finally {
    save.disabled = false;
    save.textContent = "保存";
  }
});

$("#e-delete").addEventListener("click", async () => {
  if (!editing || !confirm(`「${editing.title}」を削除しますか？`)) return;
  try {
    await store.remove(editing.id);
    $("#editor").close();
  } catch (err) {
    showEditError(errorMessage(err));
  }
});

function showEditError(text) {
  $("#e-error").textContent = text;
}

function nextOrder() {
  return games.length ? Math.max(...games.map((g) => g.order ?? 0)) + 1 : 0;
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

// 背景クリックか「閉じる」系のボタンでダイアログを閉じる
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
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
  if (err.code === "permission-denied") return "保存する権限がありません。firestore.rules の UID を確認してください";
  return "保存できませんでした（" + (err.code || err.message) + "）";
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
