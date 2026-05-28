import os
import subprocess

inkscape_paths = [
    r"C:\Program Files\Inkscape\bin\inkscape.exe",
    r"C:\Program Files (x86)\Inkscape\bin\inkscape.exe"
]

inkscape = None
for path in inkscape_paths:
    if os.path.exists(path):
        inkscape = path
        break

if not inkscape:
    try:
        result = subprocess.run(['where', 'inkscape'], capture_output=True, text=True, check=True)
        inkscape = result.stdout.strip().split('\n')[0]
    except:
        print("Inkscape not found!")
        exit(1)

print(f"Using Inkscape at: {inkscape}")

sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

base = r"c:\MobiHub\android-motorista\app\src\main\res"
svg_source = r"c:\MobiHub\android-motorista\icon_motorista.svg"

for folder, size in sizes.items():
    path = os.path.join(base, folder)
    os.makedirs(path, exist_ok=True)
    output_png = os.path.join(path, "ic_launcher.png")
    subprocess.run([
        inkscape,
        svg_source,
        "--export-type=png",
        f"--export-filename={output_png}",
        f"--export-width={size}",
        f"--export-height={size}"
    ], check=True)
    print(f"Generated {folder}/ic_launcher.png ({size}x{size})")

print("All icons generated!")