from PIL import Image
import os
import shutil

motorista_src = r'c:\MobiHub - Arquivos\Icon Mobihubi motorista2.png'
passageiro_src = r'c:\MobiHub - Arquivos\Icon Mobihubi passageiro2.png'

sizes = {'mipmap-mdpi':48,'mipmap-hdpi':72,'mipmap-xhdpi':96,'mipmap-xxhdpi':144,'mipmap-xxxhdpi':192}

apps = {
    r'c:\MobiHub\android-motorista\app\src\main\res': motorista_src,
    r'c:\MobiHub\android-passageiro\app\src\main\res': passageiro_src,
}

for res_path, src in apps.items():
    img = Image.open(src).convert('RGBA')
    w,h = img.size
    m = min(w,h)
    img = img.crop(((w-m)//2,(h-m)//2,(w-m)//2+m,(h-m)//2+m))
    for folder,size in sizes.items():
        d = os.path.join(res_path,folder)
        os.makedirs(d,exist_ok=True)
        r = img.resize((size,size),Image.LANCZOS)
        bg = Image.new('RGB',(size,size),(57,255,20))
        if r.mode == 'RGBA':
            bg.paste(r,(0,0),r)
        else:
            bg.paste(r,(0,0))
        bg.save(os.path.join(d,'ic_launcher.png'))
        bg.save(os.path.join(d,'ic_launcher_round.png'))
    # Remove pasta anydpi que causa problema
    anydpi = os.path.join(res_path,'mipmap-anydpi-v26')
    if os.path.exists(anydpi):
        shutil.rmtree(anydpi)
    print('OK: '+res_path)
print('DONE')
