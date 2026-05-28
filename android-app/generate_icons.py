import os
import subprocess

# Inkscape path (common installation locations on Windows)
inkscape_paths = [
    r'C:\Program Files\Inkscape\bin\inkscape.exe',
    r'C:\Program Files (x86)\Inkscape\bin\inkscape.exe',
]

inkscape = None
for path in inkscape_paths:
    if os.path.exists(path):
        inkscape = path
        break

if not inkscape:
    # Try to find Inkscape in PATH
    try:
        result = subprocess.run(['where', 'inkscape'], capture_output=True, text=True, check=True)
        inkscape = result.stdout.strip().split('\n')[0]
    except:
        print("Inkscape não encontrado! Instale o Inkscape em C:\\Program Files\\Inkscape")
        exit(1)

print(f"Usando Inkscape em: {inkscape}")

sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

base = r'c:\MobiHub\android-app\app\src\main\res'
svg_source = r'c:\MobiHub\android-app\icon_source.svg'

for folder, size in sizes.items():
    path = os.path.join(base, folder)
    os.makedirs(path, exist_ok=True)
    output_png = os.path.join(path, 'ic_launcher.png')
    
    # Run Inkscape command to export PNG
    subprocess.run([
        inkscape,
        svg_source,
        '--export-type=png',
        f'--export-filename={output_png}',
        f'--export-width={size}',
        f'--export-height={size}'
    ], check=True)
    
    print(f'Gerado {folder}/ic_launcher.png ({size}x{size})')

print('Todos os ícones gerados!')