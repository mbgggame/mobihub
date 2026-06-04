from PIL import Image
import os

sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

icons = {
    r'c:\MobiHub\android-motorista': r'c:\MobiHub - Arquivos\Icon Mobihubi motorista2.png',
    r'c:\MobiHub\android-passageiro': r'c:\MobiHub - Arquivos\Icon Mobihubi passageiro2.png',
}

for app_path, src in icons.items():
    # Abre a imagem e converte para RGB (sem transparência)
    img = Image.open(src).convert('RGB')
    w, h = img.size
    # Recorta para quadrado perfeito sem padding
    min_dim = min(w, h)
    left = (w - min_dim) // 2
    top = (h - min_dim) // 2
    img = img.crop((left, top, left + min_dim, top + min_dim))

    for folder, size in sizes.items():
        out_dir = os.path.join(app_path, 'app', 'src', 'main', 'res', folder)
        os.makedirs(out_dir, exist_ok=True)
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(os.path.join(out_dir, 'ic_launcher.png'))
        # Salva também como ic_launcher_round.png
        resized.save(os.path.join(out_dir, 'ic_launcher_round.png'))
        print(f'OK {os.path.basename(app_path)} {folder} ({size}x{size})')

print('Pronto!')
