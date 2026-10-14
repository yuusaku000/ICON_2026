"""Firestore の REST API を、追加のライブラリなしで使うための小さな道具。"""
import base64
import json
import urllib.error
import urllib.parse
import urllib.request

API_KEY = "AIzaSyD1eI84Kay8iqXOVoLdI7G2NPVUMNrtmCE"
PROJECT = "icon-2026"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def request(method, url, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            text = res.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"{method} {url.split('?')[0]} -> {err.code}: {err.read().decode()[:300]}") from None


def list_documents(path, token=None):
    """コレクションの全ドキュメントを返す（1回で返しきれない分も、続きを読んで全部集める）。"""
    docs, page = [], None
    while True:
        query = {"key": API_KEY, "pageSize": "100"}
        if page:
            query["pageToken"] = page
        res = request("GET", f"{BASE}/{path}?{urllib.parse.urlencode(query)}", token=token)
        docs += res.get("documents", [])
        page = res.get("nextPageToken")
        if not page:
            return docs


def doc_id(doc):
    return doc["name"].rsplit("/", 1)[-1]


def from_value(v):
    """Firestore の型付きの値を、ふつうの Python の値にする。"""
    (kind, x), = v.items()
    if kind == "integerValue":
        return int(x)
    if kind == "mapValue":
        return {k: from_value(y) for k, y in x.get("fields", {}).items()}
    if kind == "arrayValue":
        return [from_value(y) for y in x.get("values", [])]
    if kind == "bytesValue":
        return base64.b64decode(x)
    if kind == "nullValue":
        return None
    return x  # stringValue, doubleValue, booleanValue, timestampValue


def to_value(x):
    if x is None:
        return {"nullValue": None}
    if isinstance(x, bool):
        return {"booleanValue": x}
    if isinstance(x, int):
        return {"integerValue": str(x)}
    if isinstance(x, float):
        return {"doubleValue": x}
    if isinstance(x, (bytes, bytearray)):
        return {"bytesValue": base64.b64encode(x).decode()}
    if isinstance(x, dict):
        return {"mapValue": {"fields": {k: to_value(y) for k, y in x.items()}}}
    if isinstance(x, list):
        return {"arrayValue": {"values": [to_value(y) for y in x]}}
    return {"stringValue": str(x)}


def fields_of(doc):
    return {k: from_value(v) for k, v in doc.get("fields", {}).items()}


MEDIA_EXT = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def media_filename(media):
    return f"{media['id']}{MEDIA_EXT.get(media.get('type'), '.bin')}"
