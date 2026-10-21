"""Decode the laid-out <mxGraphModel> from open_drawio_xml output (#R fragment).

Usage: layout_back.py [--file PATH --page INDEX|NAME|ID] [URL or tool output]
Input comes from the argument or stdin. Without --file the XML goes to stdout.
"""
import argparse
import base64
import re
import sys
import zlib
from urllib.parse import unquote
from xml.etree import ElementTree as ET


def decode(text):
    m = re.search(r"#R([A-Za-z0-9%+/=]+)", text)
    if not m:
        raise ValueError("no #R fragment found in the input")
    raw = zlib.decompress(base64.b64decode(unquote(m.group(1))), -15)
    xml = unquote(raw.decode("utf-8"))
    root = ET.fromstring(xml)
    if root.tag != "mxGraphModel":
        raise ValueError(f"decoded root is <{root.tag}>, expected <mxGraphModel>")
    return xml, root


def replace_page(path, page, model):
    tree = ET.parse(path)
    diagrams = tree.getroot().findall("diagram")
    if page.isdigit() and int(page) < len(diagrams):
        target = diagrams[int(page)]
    else:
        target = next(
            (d for d in diagrams if page in (d.get("name"), d.get("id"))), None
        )
    if target is None:
        raise ValueError(f"page {page!r} not found in {path} ({len(diagrams)} pages)")
    target.text = None
    for child in list(target):
        target.remove(child)
    target.append(model)
    tree.write(path, encoding="utf-8")
    return target.get("name") or target.get("id") or page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--page", default="0")
    ap.add_argument("text", nargs="?")
    args = ap.parse_args()
    text = args.text if args.text is not None else sys.stdin.read()
    try:
        xml, model = decode(text)
        if not args.file:
            sys.stdout.write(xml)
            return
        name = replace_page(args.file, args.page, model)
        print(f"wrote laid-out page {name!r} to {args.file}")
    except Exception as e:
        sys.exit(f"layout_back: {e}")


if __name__ == "__main__":
    main()
