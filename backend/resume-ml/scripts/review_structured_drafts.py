"""Review local structured JSON drafts in a small loopback-only browser UI."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from structured_pipeline import normalize_extraction


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "structured" / "drafts.jsonl"
DEFAULT_OUTPUT = ROOT / "data" / "structured" / "reviewed.jsonl"

HTML = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resume JSON review</title>
<style>
:root{color-scheme:light;--ink:#19231f;--muted:#65736c;--line:#dbe3de;--green:#147a55;--paper:#f5f7f5}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid var(--line);padding:14px 22px;display:flex;gap:16px;align-items:center;justify-content:space-between}
h1{font-size:18px;margin:0}.meta{color:var(--muted);font-size:13px}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{border:1px solid var(--line);border-radius:8px;padding:9px 13px;background:#fff;color:var(--ink);font-weight:650;cursor:pointer}button.primary{background:var(--green);border-color:var(--green);color:#fff}button:disabled{opacity:.45;cursor:default}
main{display:grid;grid-template-columns:minmax(320px,1fr) minmax(360px,1fr);gap:16px;padding:16px;max-width:1600px;margin:auto;height:calc(100vh - 72px)}
section{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;min-height:0}
h2{font-size:14px;margin:0;padding:12px 15px;border-bottom:1px solid var(--line);color:#35443c}.pane{padding:14px;overflow:auto;min-height:0;flex:1}
#resumeText{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0}
textarea{width:100%;height:100%;min-height:320px;resize:none;border:0;outline:none;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;color:#17251e}
.hint{padding:10px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}#status{font-size:13px;color:var(--green);min-width:150px}.error{color:#a52525!important}
.entity-list{display:grid;gap:6px;padding:10px 14px}.entity-row{display:grid;grid-template-columns:100px 1fr;gap:8px;font-size:12px;border-bottom:1px solid #edf1ee;padding:4px 0}.entity-label{color:var(--green);font-weight:700}.entity-value{overflow-wrap:anywhere}.entity-context{grid-column:2;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}
.flag-list{display:grid;gap:6px;padding:10px 14px}.flag-row{font-size:12px;border-left:3px solid #d29428;padding:5px 8px;background:#fffaf0}.flag-field{font-weight:700;color:#76500f;margin-right:6px}
@media(max-width:850px){header{position:static;align-items:flex-start;flex-direction:column}main{height:auto;grid-template-columns:1fr}.pane{min-height:40vh}}
</style></head><body>
<header><div><h1>Review structured resume extraction</h1><div id="counter" class="meta">Loading…</div></div>
<div class="controls"><label class="meta"><input id="unreviewedOnly" type="checkbox" checked> Unreviewed only</label><label class="meta"><input id="flaggedOnly" type="checkbox"> Flagged only</label>
<button id="prev">← Previous</button><button id="next">Next →</button><button id="save" class="primary">Save review</button><button id="saveNext" class="primary">Save &amp; next</button></div></header>
<main><section><h2 id="resumeHeading">Resume text</h2><div class="pane"><pre id="resumeText"></pre></div><details open><summary class="hint">Review checks — prompts to inspect, not automatic errors</summary><div id="reviewFlags" class="flag-list"></div></details><details><summary class="hint">Unverified candidate suggestions</summary><div id="entities" class="entity-list"></div></details><div class="hint">Check the predicted fields against the resume. Keep supported facts, correct mismatches, and leave truly missing fields empty.</div></section>
<section><h2>Structured JSON fields</h2><div class="pane" style="padding:0"><textarea id="jsonEditor" spellcheck="false" aria-label="Editable structured resume JSON"></textarea></div><div class="hint">Edit the JSON, preserving the schema. A save marks this resume as reviewed, including fields you leave empty.</div></section></main>
<script>
const $=id=>document.getElementById(id);let state=null,currentIndex=0,current=null;
async function api(path,opts){const r=await fetch(path,opts);const body=await r.json();if(!r.ok)throw new Error(body.error||r.statusText);return body}
function visibleIndexes(){return state.items.map((x,i)=>({x,i})).filter(({x})=>(!$('unreviewedOnly').checked||!x.reviewed)&&(!$('flaggedOnly').checked||x.flag_count>0)).map(({i})=>i)}
function positionInVisible(){return visibleIndexes().indexOf(currentIndex)}
async function load(index){const indexes=visibleIndexes();if(!indexes.length){current=null;$('counter').textContent='No records match these filters.';$('resumeText').textContent='';$('jsonEditor').value='';return}
 if(index<0)index=0;if(index>=indexes.length)index=indexes.length-1;currentIndex=indexes[index];current=await api('/api/item/'+currentIndex);
 $('resumeHeading').textContent=`Resume ${currentIndex+1} · ${current.resume_id} · ${current.category}`;$('resumeText').textContent=current.text;$('jsonEditor').value=JSON.stringify(current.extraction,null,2);
 const flagBox=$('reviewFlags');flagBox.replaceChildren();for(const item of (current.review_flags||[])){const row=document.createElement('div');row.className='flag-row';const field=document.createElement('span');field.className='flag-field';field.textContent=item.field;const message=document.createElement('span');message.textContent=item.message;row.append(field,message);flagBox.append(row)}if(!flagBox.children.length){const row=document.createElement('div');row.className='meta';row.textContent='No automatic review prompts for this resume. Still verify the JSON.';flagBox.append(row)}
 const entityBox=$('entities');entityBox.replaceChildren();for(const item of (current.candidate_entities||[])){const row=document.createElement('div');row.className='entity-row';const label=document.createElement('span');label.className='entity-label';label.textContent=item.label;const value=document.createElement('span');value.className='entity-value';value.textContent=item.text;row.append(label,value);if(item.context){const context=document.createElement('span');context.className='entity-context';context.textContent=item.context;row.append(context)}entityBox.append(row)}
 $('counter').textContent=`${index+1} of ${indexes.length} shown · ${state.reviewed_count} reviewed · ${current.reviewed?'Already reviewed':'Draft — review required'}`;
 $('prev').disabled=index===0;$('next').disabled=index===indexes.length-1;$('save').disabled=false;$('saveNext').disabled=false;$('status').textContent='';}
async function refresh(){state=await api('/api/state');$('counter').textContent=`${state.total} resumes · ${state.reviewed_count} reviewed`;await load(0)}
async function save(){try{const extraction=JSON.parse($('jsonEditor').value);const result=await api('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resume_id:current.resume_id,extraction})});state=result.state;$('status').textContent='Saved';current.reviewed=true;return true}catch(e){$('status').textContent=e.message;$('status').className='error';return false}}
$('prev').onclick=()=>load(positionInVisible()-1);$('next').onclick=()=>load(positionInVisible()+1);$('save').onclick=save;
$('saveNext').onclick=async()=>{const pos=positionInVisible();if(await save()){await load(Math.min(Math.max(pos,0),visibleIndexes().length-1))}};
$('unreviewedOnly').onchange=()=>load(0);$('flaggedOnly').onchange=()=>load(0);refresh().catch(e=>{$('counter').textContent=e.message});
</script><div id="status" aria-live="polite" style="position:fixed;right:18px;bottom:12px"></div></body></html>'''


SECTION_HEADINGS = {
    "skills": r"(?im)^\s*(?:technical skills|skills|technologies|tools|competencies|skill set|core competencies)\s*:?\s*$",
    "summary": r"(?im)^\s*(?:summary|objective|profile|about|professional summary)\s*:?\s*$",
    "experience": r"(?im)^\s*(?:work history|work experience|experience|professional experience|employment history|internships?)\s*:?\s*$",
    "education": r"(?im)^\s*(?:education|academic background|qualifications|academic history)\s*:?\s*$",
    "projects": r"(?im)^\s*(?:projects|personal projects|academic projects|key projects)\s*:?\s*$",
    "certifications": r"(?im)^\s*(?:certifications?|certificates|licenses|achievements|courses)\s*:?\s*$",
}


def _fold_for_match(value: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", value.casefold()).split())


def review_flags(text: str, extraction: dict[str, Any]) -> list[dict[str, str]]:
    """Create conservative review prompts; these never change or reject a value."""
    folded_source = _fold_for_match(text)
    flags: list[dict[str, str]] = []
    scalar_fields = ("full_name", "email", "phone", "linkedin", "github", "summary")
    for field in scalar_fields:
        value = extraction.get(field)
        if isinstance(value, str) and value and _fold_for_match(value) not in folded_source:
            flags.append({"field": field, "message": "Value is not an exact text match; verify it against the resume."})

    for field in ("skills", "experience", "education", "projects", "certifications"):
        values = extraction.get(field, [])
        if not values and re.search(SECTION_HEADINGS[field], text):
            flags.append({"field": field, "message": "A matching section heading appears in the resume, but this list is empty."})
        for value in values:
            if _fold_for_match(value) not in folded_source:
                flags.append({"field": field, "message": "An entry is not an exact text match; verify its details and grouping."})
                break
    return flags


class ReviewState:
    def __init__(self, input_path: Path, output_path: Path):
        self.input_path = input_path
        self.output_path = output_path
        self.rows = self._load_rows(input_path)
        self.by_id = {row["resume_id"]: row for row in self.rows}
        if len(self.by_id) != len(self.rows):
            raise SystemExit("Draft JSONL has duplicate resume_id values")
        self.reviewed = self._load_reviewed(output_path)
        unknown = set(self.reviewed) - set(self.by_id)
        if unknown:
            raise SystemExit(f"Review output contains IDs missing from draft input: {len(unknown)}")

    @staticmethod
    def _load_rows(path: Path) -> list[dict[str, Any]]:
        if not path.is_file():
            raise SystemExit(f"Draft JSONL not found: {path}")
        rows = []
        with path.open(encoding="utf-8-sig") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                if not row.get("resume_id") or not isinstance(row.get("text"), str):
                    raise SystemExit(f"Draft row {line_number} needs resume_id and text")
                try:
                    row["extraction"] = normalize_extraction(row.get("extraction", {}))
                except ValueError as error:
                    raise SystemExit(f"Invalid draft schema on line {line_number}: {error}")
                rows.append(row)
        if not rows:
            raise SystemExit(f"No drafts found in {path}")
        return rows

    @staticmethod
    def _load_reviewed(path: Path) -> dict[str, dict[str, Any]]:
        if not path.is_file():
            return {}
        result = {}
        with path.open(encoding="utf-8-sig") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("reviewed") is True and row.get("resume_id"):
                    row["extraction"] = normalize_extraction(row.get("extraction", {}))
                    result[row["resume_id"]] = row
        return result

    def get_item(self, index: int) -> dict[str, Any]:
        if not 0 <= index < len(self.rows):
            raise IndexError("resume index is out of range")
        draft = self.rows[index]
        saved = self.reviewed.get(draft["resume_id"])
        return {
            "index": index,
            "total": len(self.rows),
            "resume_id": draft["resume_id"],
            "category": draft.get("category", "Uncategorized"),
            "text": draft["text"],
            "extraction": saved["extraction"] if saved else draft["extraction"],
            "candidate_entities": draft.get("candidate_entities", []),
            "review_flags": review_flags(draft["text"], saved["extraction"] if saved else draft["extraction"]),
            "reviewed": saved is not None,
            "draft_status": draft.get("draft_status", "ok"),
        }

    def save(self, resume_id: str, extraction: Any) -> dict[str, Any]:
        source = self.by_id.get(resume_id)
        if source is None:
            raise ValueError("Unknown resume_id")
        cleaned = normalize_extraction(extraction)
        self.reviewed[resume_id] = {
            "resume_id": resume_id,
            "category": source.get("category", "Uncategorized"),
            "text": source["text"],
            "extraction": cleaned,
            "reviewed": True,
        }
        self.write_output()
        return self.summary()

    def write_output(self) -> None:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix="reviewed-", suffix=".jsonl", dir=self.output_path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as target:
                for row in self.rows:
                    saved = self.reviewed.get(row["resume_id"])
                    if saved:
                        target.write(json.dumps(saved, ensure_ascii=False) + "\n")
                target.flush()
                os.fsync(target.fileno())
            os.replace(temp_name, self.output_path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def summary(self) -> dict[str, Any]:
        items = []
        for row in self.rows:
            extraction = self.reviewed.get(row["resume_id"], row)["extraction"]
            flags = review_flags(row["text"], extraction)
            items.append({
                "resume_id": row["resume_id"],
                "reviewed": row["resume_id"] in self.reviewed,
                "flag_count": len(flags),
            })
        return {"total": len(self.rows), "reviewed_count": len(self.reviewed), "items": items}


def handler_for(state: ReviewState):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status: int, data: Any) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            route = urlparse(self.path)
            if route.path == "/":
                body = HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif route.path == "/api/state":
                self.send_json(200, state.summary())
            elif route.path.startswith("/api/item/"):
                try:
                    index = int(route.path.rsplit("/", 1)[1])
                    self.send_json(200, state.get_item(index))
                except (ValueError, IndexError):
                    self.send_json(404, {"error": "Resume not found"})
            else:
                self.send_json(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/save":
                self.send_json(404, {"error": "Not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 1_000_000:
                    raise ValueError("Invalid request size")
                payload = json.loads(self.rfile.read(length))
                summary = state.save(payload.get("resume_id", ""), payload.get("extraction"))
                self.send_json(200, {"ok": True, "state": summary})
            except (ValueError, json.JSONDecodeError) as error:
                self.send_json(400, {"error": str(error)})

        def log_message(self, fmt: str, *args) -> None:
            # Avoid writing resume IDs or text to the server log.
            if args and str(args[0]).startswith("/api"):
                return
            super().log_message(fmt, *args)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        raise SystemExit("Input and output must be different files")
    if not 1024 <= args.port <= 65535:
        raise SystemExit("Choose a port between 1024 and 65535")

    state = ReviewState(args.input, args.output)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(state))
    url = f"http://127.0.0.1:{args.port}"
    print(json.dumps({"url": url, "total": len(state.rows), "reviewed": len(state.reviewed), "output": str(args.output)}, indent=2), flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped local review server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
