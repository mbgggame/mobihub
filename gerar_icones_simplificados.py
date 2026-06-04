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
        r.save(os.path.join(d,'ic_launcher_foreground.png'))
    
    anydpi = os.path.join(res_path,'mipmap-anydpi-v26')
    os.makedirs(anydpi,exist_ok=True)
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher"/>
    <foreground android:drawable="@mipmap/ic_launcher"/>
</adaptive-icon>'''
    with open(os.path.join(anydpi,'ic_launcher.xml'),'w', encoding='utf-8') as f:
        f.write(xml)
    with open(os.path.join(anydpi,'ic_launcher_round.xml'),'w', encoding='utf-8') as f:
        f.write(xml)
    print('OK: '+os.path.basename(app_path))

print('DONE')
