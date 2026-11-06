"""Installs Android SDK packages from Google's index with curl (the SDK manager can't use the
sandbox proxy): download, SHA-1 check, unpack, and the package.xml the build reads."""
import hashlib, re, shutil, subprocess, sys, tempfile
from pathlib import Path

SDK = Path(__file__).resolve().parents[2] / '.cache' / 'android-sdk'
index = Path(tempfile.gettempdir()) / 'repo.xml'
if not index.exists():
    subprocess.run(['curl', '-sSL', '-o', str(index), 'https://dl.google.com/android/repository/repository2-3.xml'], check=True)
s = index.read_text()
root = re.search(r'<sdk:sdk-repository([^>]*)>', s).group(1)
ns = ' '.join(re.findall(r'xmlns:[\w-]+="[^"]+"', root))
lic = {m.group(1): m.group(0) for m in re.finditer(r'<license id="([^"]+)" type="text">.*?</license>', s, re.S)}
for path in sys.argv[1:]:
    target = SDK / path.replace(';', '/')
    if (target / 'package.xml').exists():
        print(path, 'already installed'); continue
    block = re.search(r'<remotePackage path="%s"[^>]*>(.*?)</remotePackage>' % re.escape(path), s, re.S).group(1)
    archive = next(a for a in re.findall(r'<archive>(.*?)</archive>', block, re.S)
                   if '<host-os>' not in a or '<host-os>linux</host-os>' in a)
    url = re.search(r'<url>([^<]+)</url>', archive).group(1)
    sha = re.search(r'<checksum type="sha1">(\w+)</checksum>', archive).group(1)
    tmp = Path(tempfile.gettempdir()) / url
    if not tmp.exists():
        subprocess.run(['curl', '-sSL', '-o', str(tmp), 'https://dl.google.com/android/repository/' + url], check=True)
    if hashlib.sha1(tmp.read_bytes()).hexdigest() != sha:
        sys.exit(f'{path}: checksum mismatch')
    unpack = Path(tempfile.mkdtemp())
    # The unzip command, not zipfile: it keeps the tools' executable bits.
    subprocess.run(['unzip', '-q', str(tmp), '-d', str(unpack)], check=True)
    tops = list(unpack.iterdir())
    src = tops[0] if len(tops) == 1 and tops[0].is_dir() else unpack
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(target))
    body = re.sub(r'<archives>.*?</archives>|<channelRef[^>]*/>', '', block, flags=re.S)
    used = re.findall(r'<uses-license ref="([^"]+)"', body)
    (target / 'package.xml').write_text(
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<common:repository {ns}>\n'
        + ''.join(lic[u] for u in used)
        + f'\n<localPackage path="{path}" obsolete="false">{body}</localPackage>\n</common:repository>\n')
    print(path, 'installed')
