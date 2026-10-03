import etcpak, texture2ddecoder as t
from PIL import Image
src='ax/models/heroes_wip/ratking/materials/ratking_ratannia_flag_color_png_155b4b23.vtex_c'
d=open(src,'rb').read()
HDR=2228
W,H,M=2048,1024,9
sizes=[(W>>i,H>>i) for i in range(M)][::-1]  # smallest first
flag=Image.open('dpr_native.png').convert('RGB')
out=bytearray(d[:HDR]); off=HDR
for w,h in sizes:
    n=max(1,w//4)*max(1,h//4)*16
    orig=Image.frombytes('RGBA',(w,h),t.decode_bc7(d[off:off+n],w,h),'raw','BGRA')
    off+=n
    im=flag.resize((w,h),Image.LANCZOS).convert('RGBA')
    im.putalpha(orig.getchannel('A'))
    blk=etcpak.compress_bc7(im.tobytes(),w,h,None)
    assert len(blk)==n,(len(blk),n)
    out+=blk
assert off==len(d) and len(out)==len(d)
open('flag_new.vtex_c','wb').write(out)
# check
top=Image.frombytes('RGBA',(W,H),t.decode_bc7(out[-W*H:],W,H),'raw','BGRA')
top.convert('RGB').resize((1024,512)).save('check.png')
m=Image.frombytes('RGBA',(64,32),t.decode_bc7(out[HDR+32+128+512+2048: HDR+32+128+512+2048+512],64,32),'raw','BGRA')
m.convert('RGB').resize((512,256),Image.NEAREST).save('check_mip.png')
