#!/usr/bin/env python3
"""Build the copy of docs/ that visitors download: the same site with its code
comments removed.

Why this exists (V44.3): comments made up 73% of the compressed HTML, CSS and
JavaScript on the site (4.69 MB down to 1.24 MB). They are the project's working
memory, so docs/ keeps every one of them and only the published copy loses them.

What it must never do is change what the code does, so:
  * Only comments and the blank lines they leave behind are removed. No renaming,
    no shortening, no reordering. Strings, regular expressions, template literals
    and JSON-LD are copied through untouched.
  * <!--MF...--> markers stay. docs/index.html and docs/strategies.html read them
    while running (TreeWalker SHOW_COMMENT).
  * Anything carrying @license stays, and docs/assets/vendor/ and *.min.* files
    are copied byte for byte. (The site's own files use /*! as an ordinary header,
    so that marker is not treated as a licence.)
  * Every changed file is checked against its original (see verify_html() and
    check_js.js). A file that fails is published WITH its comments: a slower file
    is an acceptable result of a stripping bug, a broken page is not. Each such
    file is named in /deploy-report.json so it cannot go unnoticed.

Usage: build_site.py <source dir> <output dir> [--no-js-check]
Standard library only, so the runner needs nothing installed. check_js.js is run
with the runner's own Node when it is there.
"""
import gzip
import html.parser
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

TEXT_EXTS = {".html", ".css", ".js"}
NEVER_PUBLISH = {".DS_Store"}
UNTOUCHED = re.compile(r"(?:^|/)assets/vendor/|\.min\.[a-z]+$")


# ── tokenising ───────────────────────────────────────────────────────────────
def _skip_string(s, i):
    """s[i] opens a string. Returns the index just past it, or i + 1 if it does
    not close on its line, in which case that quote was not a string opener."""
    q, j, n = s[i], i + 1, len(s)
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == q:
            return j + 1
        if c == "\n":
            return i + 1
        j += 1
    return i + 1


def _skip_braced(s, i):
    """Just past a template literal's `${`. Returns the index past its `}`."""
    depth, n = 1, len(s)
    while i < n:
        c = s[i]
        if c in "\"'":
            i = _skip_string(s, i)
        elif c == "`":
            i = _skip_template(s, i)
        elif s.startswith("//", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
        elif s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c == "{":
            depth += 1
            i += 1
        elif c == "}":
            depth -= 1
            i += 1
            if depth == 0:
                return i
        else:
            i += 1
    return n


def _skip_template(s, i):
    """s[i] is a backtick. Returns the index just past the closing backtick."""
    i, n = i + 1, len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
        elif c == "`":
            return i + 1
        elif c == "$" and s.startswith("${", i):
            i = _skip_braced(s, i + 2)
        else:
            i += 1
    return n


def _skip_regex(s, i):
    """s[i] is a `/` where a regular expression may start. Returns the index past
    its closing `/`, or None if it does not close on its line (so it is a divide)."""
    j, n, in_class = i + 1, len(s), False
    while j < n:
        c = s[j]
        if c == "\n":
            return None
        if c == "\\":
            j += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            return j + 1
        j += 1
    return None


_JS_STOP = re.compile(r"""["'`/]""")
_JS_REGEX_AFTER_CHAR = set("(,=:[!&|?{};+-*%<>~^}")
_JS_REGEX_AFTER_WORD = re.compile(
    r"(?:^|[^\w$.])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$"
)
_BLANKS = re.compile(r"[ \t]+\n")
_BLANK_LINES = re.compile(r"\n(?:[ \t]*\n)+")


def _keep_comment(text):
    return "@license" in text


def _tidy(code):
    """Blank lines left behind in a run of code. Never called on a literal, so a
    multi-line template string keeps every line it has."""
    return _BLANK_LINES.sub("\n", _BLANKS.sub("\n", code))


def strip_js(s):
    out, code, i, n, tail = [], [], 0, len(s), ""

    def flush():
        if code:
            out.append(_tidy("".join(code)))
            del code[:]

    def literal(text):
        nonlocal tail
        flush()
        out.append(text)
        tail = text[-1:] or tail

    while i < n:
        m = _JS_STOP.search(s, i)
        if not m:
            code.append(s[i:])
            break
        if m.start() > i:
            piece = s[i:m.start()]
            code.append(piece)
            tail = (tail + piece)[-32:]
        i = m.start()
        c = s[i]
        if c in "\"'":
            j = _skip_string(s, i)
            if j == i + 1:                      # not a string after all
                code.append(c)
                tail = c
            else:
                literal(s[i:j])
            i = j
        elif c == "`":
            j = _skip_template(s, i)
            literal(s[i:j])
            i = j
        elif s.startswith("//", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
        elif s.startswith("/*", i):
            j = s.find("*/", i + 2)
            j = n if j < 0 else j + 2
            text = s[i:j]
            if _keep_comment(text):
                literal(text)
            else:
                # A comment holding a line break counts as a line break to the
                # language (automatic semicolons), and one without still separates
                # two tokens, so neither can simply vanish.
                code.append("\n" if "\n" in text else " ")
            i = j
        else:                                   # a lone `/`: regex or divide
            t = tail.rstrip()
            maybe_regex = (not t) or t[-1] in _JS_REGEX_AFTER_CHAR or bool(_JS_REGEX_AFTER_WORD.search(t[-16:]))
            j = _skip_regex(s, i) if maybe_regex else None
            if j is None:
                code.append(c)
                tail = c
                i += 1
            else:
                literal(s[i:j])
                i = j
    flush()
    return "".join(out)


def strip_css(s):
    out, i, n = [], 0, len(s)
    stop = re.compile(r"""["']|/\*""")
    code = []

    def flush():
        if code:
            out.append(_tidy("".join(code)))
            del code[:]

    while i < n:
        m = stop.search(s, i)
        if not m:
            code.append(s[i:])
            break
        code.append(s[i:m.start()])
        i = m.start()
        if s[i] in "\"'":
            j = _skip_string(s, i)
            if j == i + 1:
                code.append(s[i])
            else:
                flush()
                out.append(s[i:j])
            i = j
        else:
            j = s.find("*/", i + 2)
            j = n if j < 0 else j + 2
            text = s[i:j]
            if _keep_comment(text):
                flush()
                out.append(text)
            else:
                code.append(" ")
            i = j
    flush()
    return "".join(out)


# Comments are in this alternation, and first, so that the earliest match wins: a
# comment that merely mentions <script src> is a comment, and a script holding
# "<!--" in a string is a script.
_HTML_SEGMENT = re.compile(
    r"<!--.*?-->|(<script\b[^>]*>)(.*?)(</script\s*>)|(<style\b[^>]*>)(.*?)(</style\s*>)", re.S | re.I
)
_HTML_KEEP_COMMENT = re.compile(r"<!--\s*/?MF|<!--\[if")
_REST_OF_LINE = re.compile(r"[ \t]*\n")
_JS_TYPES = re.compile(r"""\btype\s*=\s*["']?(?:module|(?:text|application)/(?:java|ecma)script)""", re.I)


def _is_inline_js(tag):
    if re.search(r"\bsrc\s*=", tag, re.I):
        return False
    return (not re.search(r"\btype\s*=", tag, re.I)) or bool(_JS_TYPES.search(tag))


def strip_html(s, scripts=None):
    out, pos = [], 0
    for m in _HTML_SEGMENT.finditer(s):
        text = s[pos:m.start()]
        pos = m.end()
        if m.group(0).startswith("<!--"):
            if _HTML_KEEP_COMMENT.match(m.group(0)):
                out.append(text + m.group(0))
                continue
            # A comment alone on its line takes the line with it.
            line_start = text.rfind("\n") + 1
            rest = _REST_OF_LINE.match(s, pos)
            if rest and not text[line_start:].strip(" \t") and (line_start or m.start() - len(text) == 0 or s[m.start() - len(text) - 1] == "\n"):
                text = text[:line_start]
                pos = rest.end()
            out.append(text)
            continue
        out.append(text)
        if m.group(1):
            tag, body, end = m.group(1), m.group(2), m.group(3)
            if _is_inline_js(tag) and body.strip():
                new = strip_js(body)
                if scripts is not None:
                    scripts.append((body, new))
                out.append(tag + new + end)
            else:
                out.append(m.group(0))
        else:
            out.append(m.group(4) + strip_css(m.group(5)) + m.group(6))
    out.append(s[pos:])
    return "".join(out)


# ── checking ─────────────────────────────────────────────────────────────────
class _Signature(html.parser.HTMLParser):
    """Tags, attributes, visible text and kept comments, in order."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.items, self._text = [], []

    def _flush(self):
        t = " ".join("".join(self._text).split())
        self._text = []
        if t:
            self.items.append(("text", t))

    def handle_starttag(self, tag, attrs):
        self._flush()
        self.items.append(("open", tag, tuple(attrs)))

    def handle_startendtag(self, tag, attrs):
        self._flush()
        self.items.append(("open", tag, tuple(attrs)))

    def handle_endtag(self, tag):
        self._flush()
        self.items.append(("close", tag))

    def handle_data(self, data):
        if not self.cdata_elem:
            self._text.append(data)

    def handle_entityref(self, name):
        self._text.append("&" + name + ";")

    def handle_charref(self, name):
        self._text.append("&#" + name + ";")

    def handle_comment(self, data):
        if re.match(r"\s*/?MF|\[if", data):
            self._flush()
            self.items.append(("comment", data))


def _signature(markup):
    p = _Signature()
    p.feed(markup)
    p.close()
    p._flush()
    return p.items


def verify_html(before, after):
    return _signature(before) == _signature(after)


def _gz(b):
    return len(gzip.compress(b, 6))


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return 2
    src, dst = os.path.abspath(args[0]), os.path.abspath(args[1])
    js_check = "--no-js-check" not in argv
    if not os.path.isdir(src):
        print("no such folder: " + src)
        return 2
    if os.path.exists(dst):
        shutil.rmtree(dst)

    started = time.time()
    pairs, fallbacks = [], {}
    n_files = n_changed = raw_before = raw_after = gz_before = gz_after = 0
    for root, dirs, files in os.walk(src):
        rel_root = os.path.relpath(root, src)
        out_root = dst if rel_root == "." else os.path.join(dst, rel_root)
        os.makedirs(out_root, exist_ok=True)
        for name in files:
            if name in NEVER_PUBLISH or name.startswith("._"):
                continue
            n_files += 1
            path, out = os.path.join(root, name), os.path.join(out_root, name)
            rel = os.path.relpath(path, src).replace(os.sep, "/")
            ext = os.path.splitext(name)[1].lower()
            if ext not in TEXT_EXTS or UNTOUCHED.search(rel):
                shutil.copyfile(path, out)
                continue
            with open(path, encoding="utf-8", errors="surrogatepass", newline="") as f:
                before = f.read()
            scripts = []
            if ext == ".html":
                after = strip_html(before, scripts)
                try:
                    if not verify_html(before, after):
                        fallbacks[rel] = "markup differs after stripping"
                        after = before
                except Exception as exc:
                    fallbacks[rel] = "markup check failed: %s" % exc
                    after = before
            elif ext == ".css":
                after = strip_css(before)
            else:
                after = strip_js(before)
                scripts.append((before, after))
            for i, (a, b) in enumerate(scripts):
                pairs.append({"file": rel, "i": i, "before": a, "after": b})
            with open(out, "w", encoding="utf-8", errors="surrogatepass", newline="") as f:
                f.write(after)
            bb, ab = before.encode("utf-8", "surrogatepass"), after.encode("utf-8", "surrogatepass")
            raw_before += len(bb)
            raw_after += len(ab)
            gz_before += _gz(bb)
            gz_after += _gz(ab)
            n_changed += before != after

    # The JavaScript check: same tokens before and after, by a real parser.
    report_js = {"ran": False}
    here = os.path.dirname(os.path.abspath(__file__))
    node = shutil.which("node") if js_check else None
    if node:
        with tempfile.TemporaryDirectory() as td:
            manifest, result = os.path.join(td, "scripts.json"), os.path.join(td, "result.json")
            with open(manifest, "w", encoding="utf-8", errors="surrogatepass") as f:
                json.dump(pairs, f, ensure_ascii=True)
            cmd = [node, "--expose-internals", os.path.join(here, "check_js.js"), manifest, result]
            run = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
            print(run.stdout[-4000:])
            if run.returncode == 0 and os.path.exists(result):
                with open(result, encoding="utf-8") as f:
                    r = json.load(f)
                report_js = {"ran": True, "parser": r.get("parser"), "checked": r.get("checked")}
                for bad in r.get("bad", []):
                    fallbacks.setdefault(bad["file"], "script %s: %s" % (bad["i"], bad["why"]))
            else:
                report_js = {"ran": False, "why": "check_js.js exit %s" % run.returncode}

    for rel, why in sorted(fallbacks.items()):
        shutil.copyfile(os.path.join(src, rel), os.path.join(dst, rel))
        print("::warning::%s kept its comments: %s" % (rel, why))

    report = {
        "commit": os.environ.get("GITHUB_SHA", ""),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "files": n_files,
        "stripped": n_changed - len(fallbacks),
        "kept_comments": fallbacks,
        "js_check": report_js,
        "html_css_js_gzip_bytes": {"before": gz_before, "after": gz_after},
    }
    with open(os.path.join(dst, "deploy-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))
    print("raw %.2f MB -> %.2f MB, gzip %.2f MB -> %.2f MB, %.1f s" % (
        raw_before / 1e6, raw_after / 1e6, gz_before / 1e6, gz_after / 1e6, time.time() - started))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
