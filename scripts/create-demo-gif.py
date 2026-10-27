"""Encode the actual Electron captures as a short, explicitly paced slideshow.

Requires Python 3 and Pillow. Capture first with npm run demo:capture.
"""
from pathlib import Path
from PIL import Image

media = Path(__file__).resolve().parent.parent / "docs" / "media"
sources = sorted(media.glob("[0-9][0-9]-*.png"))
if len(sources) != 9:
    raise SystemExit("Run npm run demo:capture first: expected nine PNG captures")

frames = []
for source in sources:
    with Image.open(source) as image:
        frames.append(image.convert("RGB").resize((960, 780), Image.Resampling.LANCZOS))
frames[0].save(
    media / "workflow.gif",
    save_all=True,
    append_images=frames[1:],
    duration=[2000, 2500, 2000, 2000, 3000, 2000, 2500, 2000, 2000],
    loop=0,
    optimize=True,
)
print("Created docs/media/workflow.gif: 20 seconds, nine actual UI captures")
