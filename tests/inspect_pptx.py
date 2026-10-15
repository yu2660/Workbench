"""Independently inspect native OOXML, not just Workbench round-trip metadata."""
from pathlib import Path
import json, zipfile, xml.etree.ElementTree as ET
root = Path(__file__).resolve().parent.parent
result = json.loads((root / 'test-output/e2e-result.json').read_text(encoding='utf-8'))
profile = Path(result['directory']) / 'profile/settings.json'
library = Path(json.loads(profile.read_text(encoding='utf-8'))['root'])
files = list(library.rglob('线性代数.pptx'))
assert len(files) == 1, files
with zipfile.ZipFile(files[0]) as z:
    comment_parts = [n for n in z.namelist() if n.startswith('ppt/comments/') and n.endswith('.xml')]
    assert comment_parts, 'No native PowerPoint comments'
    comments = ''.join(z.read(n).decode('utf-8') for n in comment_parts)
    assert 'PPT 中文便签' in comments, 'Unicode note missing from native comments'
    slide = ET.fromstring(z.read('ppt/slides/slide1.xml'))
    ns = {'p':'http://schemas.openxmlformats.org/presentationml/2006/main', 'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
    assert len(slide.findall('.//p:sp', ns)) >= 3, 'Original text, highlight and note anchor must survive'
    assert slide.findall('.//a:alpha', ns), 'Highlight transparency missing'
    assert 'Select this text' in ''.join(slide.itertext()), 'Original slide text lost'
print('PASS: native PPTX comment XML, Unicode content, shape count, transparency and original text')
