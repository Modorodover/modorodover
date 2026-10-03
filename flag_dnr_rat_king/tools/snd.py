import lz4.block, struct, subprocess, sys
def samples(f):
    p=subprocess.run(['ffmpeg','-v','error','-i',f,'-f','s16le','-ac','2','-'],capture_output=True,check=True); return len(p.stdout)//4
def build(orig, newmp3, out):
    d=open(orig,'rb').read()
    hs,hv,ver,bo,bc=struct.unpack_from('<IHHII',d,0)
    blocks=[]
    for i in range(bc):
        o=8+bo+i*12; blocks.append([d[o:o+4],o+4,o+4+struct.unpack_from('<I',d,o+4)[0],struct.unpack_from('<I',d,o+8)[0]])
    assert [b[0] for b in blocks]==[b'RED2',b'DATA',b'CTRL']
    cs=blocks[2][2]; c=bytearray(d[cs:cs+blocks[2][3]]); assert cs+len(c)==hs
    u0,c0,u1,c1=struct.unpack_from('<4I',c,72)
    B=bytearray(lz4.block.decompress(c[120+c0:120+c0+c1],uncompressed_size=u1))
    mp3=open(newmp3,'rb').read(); n=samples(newmp3); dur=n/44100
    oldn=samples_orig[orig]
    def setint(key,val):
        i=B.index(struct.pack('<I',key)); 
        # key index is followed by its value
        B[i+4:i+8]=struct.pack('<I',val)
    # ints buffer: sequence of (key, value?) ; patch known keys by locating value after key
    def patch_after(key, old, new):
        pat=struct.pack('<II',key,old); assert B.count(pat)==1,(key,old); i=B.index(pat); B[i+4:i+8]=struct.pack('<I',new)
    patch_after(8, oldn, n)                       # m_nSampleCount
    patch_after(11, len(d)-hs, len(mp3))          # m_nStreamingSize
    if B.count(struct.pack('<II',13,oldn)): patch_after(13, oldn, n)  # m_nLoopEnd
    f32=lambda x: struct.unpack('<f',struct.pack('<f',x))[0]
    od=struct.pack('<d',f32(oldn/44100)); assert B.count(od)==1; i=B.index(od); B[i:i+8]=struct.pack('<d',f32(dur))  # m_flDuration
    nb=lz4.block.compress(bytes(B),store_size=False)
    assert lz4.block.decompress(nb,uncompressed_size=u1)==bytes(B)
    tail=c[120+c0+c1:]
    newc=c[:120+c0]+nb+tail
    struct.pack_into('<I',newc,84,len(nb))
    struct.pack_into('<I',newc,56,c0+len(nb))
    delta=len(newc)-len(c)
    hdr=bytearray(d[:cs])
    struct.pack_into('<I',hdr,0,hs+delta)
    struct.pack_into('<I',hdr,blocks[2][1]+4,len(newc))
    res=bytes(hdr)+bytes(newc)+mp3
    open(out,'wb').write(res)
    print(out, 'samples',oldn,'->',n, f'dur {oldn/44100:.3f}->{dur:.3f}', 'size',len(d)-hs,'->',len(mp3))
samples_orig={}
for n in ['1003_12','1003_14_2']:
    o=f'bx/sounds/abilities/ratking/{n}.vsnd_c'
    samples_orig[o]=samples(f'{n}.mp3')
    build(o, f'new_{n}.mp3', f'out_{n}.vsnd_c')
