from PIL import Image, ImageDraw
from pathlib import Path
root = Path(__file__).resolve().parent.parent
im = Image.new('RGBA', (256, 256))
d = ImageDraw.Draw(im)
d.rounded_rectangle((12, 12, 244, 244), radius=58, fill='#476c55')
# A code-drawn W keeps the asset independent of fonts and third-party artwork.
d.line([(51, 81), (86, 190), (125, 88), (164, 190), (201, 81)], fill='#f8fbf2', width=17, joint='curve')
d.ellipse((190, 180, 214, 204), fill='#d7e5a1')
im.save(root / 'assets/workbench.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
im.save(root / 'assets/workbench.png')
