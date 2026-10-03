import struct, zlib, hashlib, sys
src, dst = sys.argv[1], sys.argv[2]
new = open('flag_new.vtex_c','rb').read()
TARGET = 'models/heroes_wip/ratking/materials/ratking_ratannia_flag_color_png_155b4b23.vtex_c'
b = bytearray(open(src,'rb').read())
sig, ver, tree, fdata, amd5, omd5, ssz = struct.unpack_from('<7I', b, 0)
HS = 28; data_start = HS + tree
def rs(p):
    e = b.index(0, p); return b[p:e].decode(), e+1
p = HS; found = False
while True:
    ext, p = rs(p)
    if not ext: break
    while True:
        path, p = rs(p)
        if not path: break
        while True:
            name, p = rs(p)
            if not name: break
            crc, pre, idx, off, ln, term = struct.unpack_from('<IHHIIH', b, p)
            full = f'{path}/{name}.{ext}'
            if full == TARGET:
                assert idx == 0x7fff and pre == 0 and ln == len(new)
                b[data_start+off:data_start+off+ln] = new
                struct.pack_into('<I', b, p, zlib.crc32(new) & 0xffffffff)
                found = True
            p += 18 + pre
assert found
mo = data_start + fdata + amd5
assert omd5 == 48 and ssz == 0 and mo + 48 == len(b)
tree_md5 = hashlib.md5(b[HS:HS+tree]).digest()
arch_md5 = hashlib.md5(b[data_start+fdata:data_start+fdata+amd5]).digest()
b[mo:mo+16] = tree_md5; b[mo+16:mo+32] = arch_md5
b[mo+32:mo+48] = hashlib.md5(b[:mo+32]).digest()
open(dst,'wb').write(b)
