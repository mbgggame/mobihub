from PIL import Image
import os

apps = {
    r'c:\MobiHub\android-motorista': r'c:\MobiHub - Arquivos\Icon Mobihubi motorista2.png',
    r'c:\MobiHub\android-passageiro': r'c:\MobiHub - Arquivos\Icon Mobihubi passageiro2.png',
}

sizes = {'mipmap-mdpi':48,'mipmap-hdpi':72,'mipmap-xhdpi':96,'mipmap-xxhdpi':144,'mipmap-xxxhdpi':192}

for app_path, src in apps.items():
    img = Image.open(src).convert('RGB')
    w,h = img.size
    m = min(w,h)
    img = img.crop(((w-m)//2,(h-m)//2,(w-m)//2+m,(h-m)//2+m))
    res_path = os.path.join(app_path,'app','src','main','res')
    
    for folder,size in sizes.items():
        d = os.path.join(res_path,folder)
        os.makedirs(d,exist_ok=True)
        r = img.resize((size,size),Image.LANCZOS)
        r.save(os.path.join(d,'ic_launcher.png'))
        r.save(os.path.join(d,'ic_launcher_round.png'))
        fg_size = int(size * 108/48)
        fg = img.resize((fg_size,fg_size),Image.LANCZOS)
        fg.save(os.path.join(d,'ic_launcher_foreground.png'))
    
    anydpi = os.path.join(res_path,'mipmap-anydpi-v26')
    os.makedirs(anydpi,exist_ok=True)
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>'''
    with open(os.path.join(anydpi,'ic_launcher.xml'),'w', encoding='utf-8') as f:
        f.write(xml)
    with open(os.path.join(anydpi,'ic_launcher_round.xml'),'w', encoding='utf-8') as f:
        f.write(xml)
    
    values = os.path.join(res_path,'values')
    os.makedirs(values,exist_ok=True)
    colors = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#39FF14</color>
</resources>'''
    colors_path = os.path.join(values,'colors.xml')
    # If colors.xml already exists, read it and add the color if not present
    if os.path.exists(colors_path):
        with open(colors_path, 'r', encoding='utf-8') as f:
            existing_colors = f.read()
        if 'ic_launcher_background' not in existing_colors:
            # Insert before </resources>
            existing_colors = existing_colors.replace('</resources>', f'    <color name="ic_launcher_background">#39FF14</color>\n</resources>')
            with open(colors_path, 'w', encoding='utf-8') as f:
                f.write(existing_colors)
    else:
        with open(colors_path, 'w', encoding='utf-8') as f:
            f.write(colors)
    print('OK: '+app_path)

print('DONE')
