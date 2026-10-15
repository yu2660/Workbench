"""Download the official Electron archive in ranges; verify npm's bundled hash."""
import concurrent.futures, hashlib, json, pathlib, subprocess
root = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((root / 'node_modules/electron/package.json').read_text())['version']
name = f'electron-v{version}-win32-x64.zip'
url = f'https://github.com/electron/electron/releases/download/v{version}/{name}'
cache = root / '.cache/electron-parts'
cache.mkdir(parents=True, exist_ok=True)
total = 157867015
chunk = 4 * 1024 * 1024
def download(i):
    start, end = i * chunk, min((i + 1) * chunk, total) - 1
    target = cache / str(i)
    if target.exists() and target.stat().st_size == end - start + 1:
        return target
    subprocess.run(['curl.exe', '-fLsS', '--retry', '3', '--max-time', '120', '--range', f'{start}-{end}', '-o', str(target), url], check=True)
    if target.stat().st_size != end - start + 1:
        raise RuntimeError(f'Unexpected range length: {i}')
    print(f'Part {i + 1}/{(total + chunk - 1) // chunk} complete', flush=True)
    return target
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    parts = list(pool.map(download, range((total + chunk - 1) // chunk)))
output = root / '.cache' / ('verified-' + name)
with output.open('wb') as out:
    for part in parts:
        out.write(part.read_bytes())
expected = json.loads((root / 'node_modules/electron/checksums.json').read_text())[name]
actual = hashlib.sha256(output.read_bytes()).hexdigest()
if actual != expected:
    raise RuntimeError('Electron checksum mismatch')
print('Verified official Electron SHA-256:', actual)
