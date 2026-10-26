#!/usr/bin/env python3
"""Rename a Bitwarden-family source tree to Vowkey: file contents and paths.

    scripts/rename-brand.py TREE [UNTOUCHED_DIR ...]

TREE is a freshly copied upstream tree (Bitwarden, Vaultwarden, or one of the client apps).
UNTOUCHED_DIR is relative to TREE: its content and names stay as they are (test vectors).

Vowkey keeps Bitwarden's encryption and sync format. The strings in PROTECT are part of
that format, or are test data derived from it, or credit the upstream authors; they are
left as written. Everything else that says Bitwarden or Vaultwarden says Vowkey.
"""
import os
import pathlib
import re
import sys

PROTECT = [
    # encryption format: COSE content types, MAC domain separator, key-derivation salts
    r'application/x\.bitwarden\.',
    r'bitwarden\.aes256-cbc-hmac-sha256-aead\.v1',
    r'"bitwarden-\{name\}"',
    r'bitwarden-accesstoken',
    # test vectors: the account email is the key-derivation salt of the fixture
    r'(?i:[A-Za-z0-9._+:-]*@bitwarden\.com)',
    r'%40bitwarden%2Ecom',
    r'Bitwarden SDK test vector(?: associated data)?',
    # sync protocol: client identification headers
    r'(?i:bitwarden-client-[a-z]+)',
    r'(?i:bitwarden-package-type)',
    # upstream references and credit
    r'github\.com/bitwarden/',
    r'bitwarden\.atlassian\.net',
    r'bitwarden/passkey-rs',
    r'(?i:bitwarden-gov\.com)',
    r'dani-garcia(?:/[A-Za-z0-9_.-]+)?',
    'Daniel García',
]
PRE = [
    ('com.x8bit.bitwarden', 'com.vowkey.app'),
    ('com.8bit.bitwarden', 'com.vowkey.app'),
    ('com/x8bit/bitwarden', 'com/vowkey/app'),
]
PATH_PRE = [
    ('com/x8bit/bitwarden', 'com/vowkey/app'),
]
SKIP_DIRS = {'.git', 'target', 'node_modules'}

protect_re = re.compile('|'.join(f'(?:{p})' for p in PROTECT))


def rename_text(s: str) -> str:
    saved = []

    def stash(m):
        saved.append(m.group(0))
        return f'\x00{len(saved) - 1}\x00'

    s = protect_re.sub(stash, s)
    for a, b in PRE:
        s = s.replace(a, b)
    s = (s.replace('BITWARDEN', 'VOWKEY').replace('Bitwarden', 'Vowkey').replace('bitwarden', 'vowkey')
          .replace('VAULTWARDEN', 'VOWKEY').replace('Vaultwarden', 'Vowkey').replace('vaultwarden', 'vowkey'))
    return re.sub(r'\x00(\d+)\x00', lambda m: saved[int(m.group(1))], s)


def move(src: pathlib.Path, dst: pathlib.Path):
    """Rename src to dst, merging into dst when both are directories."""
    if dst.exists() and src.is_dir() and dst.is_dir():
        for child in list(src.iterdir()):
            move(child, dst / child.name)
        src.rmdir()
    else:
        src.rename(dst)


def main():
    root = pathlib.Path(sys.argv[1]).resolve()
    untouched = sys.argv[2:]

    def is_untouched(rel):
        return any(str(rel) == d or str(rel).startswith(d + os.sep) for d in untouched)

    changed = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            p = pathlib.Path(dirpath) / fn
            if is_untouched(p.relative_to(root)) or p.is_symlink():
                continue
            try:
                s = p.read_text()
            except (UnicodeDecodeError, OSError):
                continue
            n = rename_text(s)
            if n != s:
                p.write_text(n)
                changed += 1

    renamed = 0
    for old, new in PATH_PRE:
        for p in sorted(root.rglob(old.split('/')[-1]), key=lambda x: -len(x.parts)):
            if p.is_dir() and p.as_posix().endswith(old):
                dest = pathlib.Path(p.as_posix()[:-len(old)]) / new
                dest.parent.mkdir(parents=True, exist_ok=True)
                move(p, dest)
                renamed += 1
    pat = re.compile('itwarden|ITWARDEN|aultwarden|AULTWARDEN')
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        if SKIP_DIRS & set(pathlib.Path(dirpath).parts):
            continue
        for name in dirnames + filenames:
            p = pathlib.Path(dirpath) / name
            if not pat.search(name) or is_untouched(p.relative_to(root)):
                continue
            move(p, p.with_name(rename_text(name)))
            renamed += 1

    print(f'{changed} files rewritten, {renamed} paths renamed')


if __name__ == '__main__':
    main()
