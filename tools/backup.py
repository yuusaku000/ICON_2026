"""Firestore のゲーム一覧と動画を、フォルダに書き出す（GitHub Actions から定期的に呼ばれる）。

使い方: python tools/backup.py <書き出し先フォルダ>

書き出し先の中身は、その時点の状態そのものになる:
  games.json         ゲームの一覧（サムネイル以外）
  thumbs/<id>.jpg    サムネイル
  media/<id>.mp4 など 動画（一度保存したものは同じ id のまま変わらないので、新しいものだけ取りに行く）
"""
import base64
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from firestore_rest import doc_id, fields_of, list_documents, media_filename


def main(out):
    out = pathlib.Path(out)
    (out / "thumbs").mkdir(parents=True, exist_ok=True)
    (out / "media").mkdir(parents=True, exist_ok=True)

    # 途中で失敗したら例外で止まり、中途半端な状態は記録されない
    games = []
    for doc in list_documents("games"):
        game = {"id": doc_id(doc), **fields_of(doc)}
        game.pop("updatedAt", None)  # 保存のたびに変わるだけなので、差分に出さない
        games.append(game)
    games.sort(key=lambda g: (g.get("order", 0), g["id"]))

    thumbs, medias = set(), set()
    for game in games:
        thumb = game.get("thumb") or ""
        if thumb.startswith("data:"):
            name = f"{game['id']}.jpg"
            (out / "thumbs" / name).write_bytes(base64.b64decode(thumb.split(",", 1)[1]))
            game["thumb"] = f"thumbs/{name}"
            thumbs.add(name)

        media = game.get("media")
        if media:
            name = media_filename(media)
            path = out / "media" / name
            if not (path.exists() and path.stat().st_size == media["size"]):
                path.write_bytes(download_media(media))
                print(f"動画を保存: {game.get('title')} ({media['size']:,} bytes)")
            medias.add(name)

    # 今はもう使われていないものは消す（過去の記録の中には残る）
    for folder, keep in (("thumbs", thumbs), ("media", medias)):
        for path in (out / folder).iterdir():
            if path.name not in keep:
                path.unlink()

    (out / "games.json").write_text(json.dumps(games, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"ゲーム {len(games)} 件、動画 {len(medias)} 本")


def download_media(media):
    chunks = list_documents(f"media/{media['id']}/chunks")
    chunks.sort(key=lambda d: fields_of(d)["i"])
    data = b"".join(fields_of(d)["data"] for d in chunks)
    if len(chunks) != media["chunks"] or len(data) != media["size"]:
        raise RuntimeError(f"動画 {media['id']} がそろっていません（{len(chunks)}/{media['chunks']} 個、{len(data)}/{media['size']} bytes）")
    return data


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
