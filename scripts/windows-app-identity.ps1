$ErrorActionPreference = 'Stop'
# WScript.Shell cannot write the application identity stored in a Shell link.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AssAppIdentity {
    [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
    [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {
        [FieldOffset(0)] public ushort type;
        [FieldOffset(8)] public IntPtr text;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface Store {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out Key key);
        [PreserveSig] int GetValue(ref Key key, out Value value);
        [PreserveSig] int SetValue(ref Key key, ref Value value);
        [PreserveSig] int Commit();
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string file, IntPtr bind, uint flags, ref Guid iid, out Store store);
    public static void SetShortcut(string file, string appId) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); Store store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(file, IntPtr.Zero, 2, ref iid, out store));
        var key = new Key { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = 5 };
        var value = new Value { type = 31, text = Marshal.StringToCoTaskMemUni(appId) };
        try {
            Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
            Marshal.ThrowExceptionForHR(store.Commit());
        } finally { Marshal.FreeCoTaskMem(value.text); Marshal.ReleaseComObject(store); }
    }
}
'@
$spec = ConvertFrom-Json $env:ASS_SHORTCUT_SPEC
if ($spec.AppUserModelId -ne 'local.ass.desktop' -or [IO.Path]::GetExtension($spec.Path) -ne '.lnk') {
    throw 'Unexpected ASS shortcut identity request'
}
[AssAppIdentity]::SetShortcut($spec.Path, $spec.AppUserModelId)
