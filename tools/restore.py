"""バックアップのフォルダから、Firestore を元に戻す。

使い方:
  python tools/restore.py <バックアップのフォルダ> --dry-run   何が変わるかを見るだけ
  python tools/restore.py <バックアップのフォルダ>             本当に戻す（管理者のパスワードを聞かれる）

戻すと、ゲームの一覧はバックアップと同じになる（バックアップにないゲームは消える）。
動画は、Firestore に残っていないものだけ送り直す。
"""
import base64
import getpass
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from firestore_rest import API_KEY, BASE, doc_id, fields_of, list_documents, media_filename, request, to_value

ADMIN_EMAIL = "takakura.yusaku.25@shizuoka.ac.jp"
CHUNK_BYTES = 900 * 1024  # store.js と同じ


def main(folder, dry_run):
    folder = pathlib.Path(folder)
    games = json.loads((folder / "games.json").read_text(encoding="utf-8"))
    current = {doc_id(d): fields_of(d) for d in list_documents("games")}
    keep = {g["id"] for g in games}

    print(f"バックアップ: {len(games)} 件 / 今の Firestore: {len(current)} 件")
    for g in games:
        print(("  変更なしか上書き: " if g["id"] in current else "  よみがえらせる: ") + g.get("title", ""))
    for gid, g in current.items():
        if gid not in keep:
            print("  消す: " + g.get("title", ""))
    if dry_run:
        print("（--dry-run なので、何も変えていません）")
        return

    password = getpass.getpass(f"{ADMIN_EMAIL} のパスワード: ")
    auth = request("POST", f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}",
                   {"email": ADMIN_EMAIL, "password": password, "returnSecureToken": True})
    token = auth["idToken"]

    # 先に動画をそろえてから、一覧を書き戻す
    for g in games:
        media = g.get("media")
        if media and not media_is_complete(media, token):
            data = (folder / "media" / media_filename(media)).read_bytes()
            for i in range(media["chunks"]):
                part = data[i * CHUNK_BYTES:(i + 1) * CHUNK_BYTES]
                request("PATCH", f"{BASE}/media/{media['id']}/chunks/{i}",
                        {"fields": {"i": to_value(i), "data": to_value(part)}}, token)
            print(f"動画を送り直しました: {g.get('title')}")

    for g in games:
        data = {k: v for k, v in g.items() if k != "id"}
        if data.get("thumb", "").startswith("thumbs/"):
            jpg = (folder / data["thumb"]).read_bytes()
            data["thumb"] = "data:image/jpeg;base64," + base64.b64encode(jpg).decode()
        fields = {k: to_value(v) for k, v in data.items()}
        request("PATCH", f"{BASE}/games/{g['id']}", {"fields": fields}, token)
    for gid in current:
        if gid not in keep:
            request("DELETE", f"{BASE}/games/{gid}", token=token)
    print("戻しました")


def media_is_complete(media, token):
    chunks = list_documents(f"media/{media['id']}/chunks", token)
    return len(chunks) == media["chunks"]


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0], "--dry-run" in sys.argv)
