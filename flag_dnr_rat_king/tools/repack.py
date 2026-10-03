import struct, zlib, hashlib, sys
src, dst = sys.argv[1], sys.argv[2]
repl = dict(a.split('=',1) for a in sys.argv[3:])
b = bytearray(open(src,'rb').read())
sig, ver, tree, fdata, amd5, omd5, ssz = struct.unpack_from('<7I', b, 0)
assert ver==2 and amd5==0 and omd5==48 and ssz==0
HS=28; ds=HS+tree
def rs(p):
    e=b.index(0,p); return b[p:e].decode(), e+1
ents=[]; p=HS
while True:
    ext,p=rs(p)
    if not ext: break
    while True:
        path,p=rs(p)
        if not path: break
        while True:
            name,p=rs(p)
            if not name: break
            crc,pre,idx,off,ln,term=struct.unpack_from('<IHHIIH',b,p)
            assert idx==0x7fff and pre==0 and term==0xffff
            ents.append([f'{path}/{name}.{ext}',p,off,ln]); p+=18
assert p==HS+tree
newdata=bytearray()
for e in sorted(ents,key=lambda e:e[2]):
    full,tp,off,ln=e
    data=open(repl.pop(full),'rb').read() if full in repl else bytes(b[ds+off:ds+off+ln])
    struct.pack_into('<IHHII',b,tp,zlib.crc32(data)&0xffffffff,0,0x7fff,len(newdata),len(data))
    newdata+=data
assert not repl, repl
out=bytearray(b[:HS+tree])+newdata
struct.pack_into('<I',out,12,len(newdata))
out+=hashlib.md5(out[HS:HS+tree]).digest()+hashlib.md5(b'').digest()
out+=hashlib.md5(out).digest()
open(dst,'wb').write(out)
