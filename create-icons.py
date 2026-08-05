"""
Creates app icons from a source image.
Run: pip install Pillow
Then: python create-icons.py

If you don't have a logo, this creates a simple branded icon.
"""

import os

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Install Pillow first: pip install Pillow")
    exit(1)

ICONS_DIR = "src-tauri/icons"
os.makedirs(ICONS_DIR, exist_ok=True)

def create_icon(size, filename):
    """Create a simple branded icon"""
    img = Image.new("RGBA", (size, size), (37, 99, 235, 255))  # Blue background
    draw = ImageDraw.Draw(img)

    # Draw "I&C" text
    text = "I&C"
    try:
        font = ImageFont.truetype("arial.ttf", size // 3)
    except:
        font = ImageFont.load_default()

    # Center the text
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - size // 10

    draw.text((x, y), text, fill="white", font=font)

    # Add "ERP" below
    try:
        small_font = ImageFont.truetype("arial.ttf", size // 6)
    except:
        small_font = ImageFont.load_default()

    bbox2 = draw.textbbox((0, 0), "ERP", font=small_font)
    text_width2 = bbox2[2] - bbox2[0]
    x2 = (size - text_width2) // 2
    y2 = y + text_height + size // 20

    draw.text((x2, y2), "ERP", fill=(200, 220, 255, 255), font=small_font)

    img.save(os.path.join(ICONS_DIR, filename))
    print(f"  Created: {filename} ({size}x{size})")

# Generate all required sizes
create_icon(32, "32x32.png")
create_icon(128, "128x128.png")
create_icon(256, "128x128@2x.png")

# Create ICO (Windows) - just use the 256px version
img = Image.open(os.path.join(ICONS_DIR, "128x128@2x.png"))
img.save(os.path.join(ICONS_DIR, "icon.ico"), format="ICO", sizes=[(256, 256)])
print("  Created: icon.ico")

# icon.icns (macOS): Pillow cannot write a real ICNS on Windows, and saving
# ICO data into icon.icns would corrupt the existing valid file. Keep the
# existing icon.icns; regenerate it on macOS with `npx tauri icon` or
# `iconutil` if the branding needs updating there.
print("  Skipped: icon.icns (kept existing valid file)")

print("\nAll icons created!")
print(f"Location: {ICONS_DIR}/")
