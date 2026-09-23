import ctypes, sys, re
from pathlib import Path
import json
fixture=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8-sig'))
ident=fixture['credentialId']
assert re.fullmatch(r'p-[a-f0-9]{32}',ident)
target='DSHDesktop/InternalLLM/connection-profile-v1/'+ident
api=ctypes.WinDLL('Advapi32.dll',use_last_error=True)
if sys.argv[1]=='delete':
 api.CredDeleteW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32]
 ok=api.CredDeleteW(target,1,0)
 assert ok or ctypes.get_last_error()==1168
 print('Synthetic credential removed or absent')
else:
 assert sys.argv[1]=='put'
 class C(ctypes.Structure):
  _fields_=[('Flags',ctypes.c_uint32),('Type',ctypes.c_uint32),('TargetName',ctypes.c_wchar_p),('Comment',ctypes.c_wchar_p),('LastWritten',ctypes.c_uint64),('CredentialBlobSize',ctypes.c_uint32),('CredentialBlob',ctypes.POINTER(ctypes.c_ubyte)),('Persist',ctypes.c_uint32),('AttributeCount',ctypes.c_uint32),('Attributes',ctypes.c_void_p),('TargetAlias',ctypes.c_wchar_p),('UserName',ctypes.c_wchar_p)]
 value=b'synthetic-local-only';blob=(ctypes.c_ubyte*len(value)).from_buffer_copy(value)
 c=C(Type=1,TargetName=target,CredentialBlobSize=len(value),CredentialBlob=blob,Persist=2,UserName='DSH lock fixture')
 api.CredWriteW.argtypes=[ctypes.POINTER(C),ctypes.c_uint32]
 assert api.CredWriteW(ctypes.byref(c),0),ctypes.get_last_error()
 print('Synthetic credential prepared')
