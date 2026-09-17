"""Check the built site for links that go nowhere.

    python3 pipeline/check_site.py [dist]

HANDOFF §4 again: find something the output can be checked against, and check it
every build. `pipeline/verify.py` does that for the data; this does it for the
pages, and it earned its place immediately — the first run found 544 dead links,
because two components were still assembling a game's URL by hand instead of
going through `gameUrl()`.

Only internal links are followed. External ones are somebody else's uptime.
"""
from __future__ import annotations

import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HREF = re.compile(r'(?:href|src)="([^"]+)"')


def main() -> int:
    dist = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site" / "dist"
    if not dist.exists():
        sys.exit(f"no build at {dist} — run `make build` first")

    pages = sorted(dist.rglob("*.html"))
    if not pages:
        sys.exit(f"no pages in {dist}")

    # Every address the built site actually answers on. A directory-format build
    # serves foo/index.html at /foo/, so both spellings are registered.
    served: set[str] = set()
    for f in dist.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(dist).as_posix()
        served.add("/" + rel)
        if rel.endswith("index.html"):
            served.add("/" + rel[: -len("index.html")])

    # The site is served under a base path, which is baked into every href.
    # Strip it before matching rather than guessing at it.
    sample = pages[0].read_text(encoding="utf-8")
    base = ""
    if (m := re.search(r'href="(/[^"/]+)/(?:index\.html)?"', sample)):
        candidate = m.group(1)
        if not (dist / candidate.lstrip("/")).exists():
            base = candidate

    broken: collections.Counter[tuple[str, str]] = collections.Counter()
    internal = 0
    for page in pages:
        html = page.read_text(encoding="utf-8")
        src = page.relative_to(dist).as_posix()
        for href in HREF.findall(html):
            if not href.startswith("/"):
                continue          # external, anchor, or data: URI
            internal += 1
            target = href.split("#")[0].split("?")[0]
            if base and target.startswith(base):
                target = target[len(base):] or "/"
            if target not in served:
                broken[(target, src)] += 1

    if broken:
        print(f"FAILED — {len(broken)} dead internal links across {len(pages)} pages\n")
        for (target, src), _ in broken.most_common(30):
            print(f"  {target}  (from {src})")
        if len(broken) > 30:
            print(f"  … and {len(broken) - 30} more")
        return 1

    print(f"{internal} internal links across {len(pages)} pages, none dead")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
