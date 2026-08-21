param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$IconPath,
    [Parameter(Mandatory = $true)][int]$GroupResourceId
)

$ErrorActionPreference = 'Stop'
$ExecutablePath = [IO.Path]::GetFullPath($ExecutablePath)
$IconPath = [IO.Path]::GetFullPath($IconPath)
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { throw "Executable is missing: $ExecutablePath" }
if (-not (Test-Path -LiteralPath $IconPath -PathType Leaf)) { throw "Icon is missing: $IconPath" }

$source = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class PhantomWindowsIcon
{
    const ushort DefaultLanguage = 1033;
    static readonly IntPtr IconType = new IntPtr(3);
    static readonly IntPtr GroupIconType = new IntPtr(14);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, IntPtr data, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr update, bool discard);

    sealed class Entry
    {
        public byte Width;
        public byte Height;
        public byte ColorCount;
        public ushort Planes;
        public ushort BitCount;
        public byte[] Data = Array.Empty<byte>();
    }

    static void SetData(IntPtr update, IntPtr type, int id, byte[] data)
    {
        IntPtr buffer = Marshal.AllocHGlobal(data.Length);
        try
        {
            Marshal.Copy(data, 0, buffer, data.Length);
            if (!UpdateResource(update, type, new IntPtr(id), DefaultLanguage, buffer, (uint)data.Length))
                throw new InvalidOperationException("UpdateResource failed with Win32 error " + Marshal.GetLastWin32Error());
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public static void Embed(string executablePath, string iconPath, int groupResourceId)
    {
        List<Entry> entries = new List<Entry>();
        using (FileStream stream = File.OpenRead(iconPath))
        using (BinaryReader reader = new BinaryReader(stream))
        {
            if (reader.ReadUInt16() != 0 || reader.ReadUInt16() != 1)
                throw new InvalidDataException("The icon file has an invalid ICO header.");
            ushort count = reader.ReadUInt16();
            if (count == 0) throw new InvalidDataException("The icon file contains no images.");
            uint[] offsets = new uint[count];
            for (int index = 0; index < count; index++)
            {
                Entry entry = new Entry();
                entry.Width = reader.ReadByte();
                entry.Height = reader.ReadByte();
                entry.ColorCount = reader.ReadByte();
                if (reader.ReadByte() != 0) throw new InvalidDataException("The icon entry is invalid.");
                entry.Planes = reader.ReadUInt16();
                entry.BitCount = reader.ReadUInt16();
                uint size = reader.ReadUInt32();
                offsets[index] = reader.ReadUInt32();
                entry.Data = new byte[size];
                entries.Add(entry);
            }
            for (int index = 0; index < entries.Count; index++)
            {
                stream.Seek(offsets[index], SeekOrigin.Begin);
                int read = stream.Read(entries[index].Data, 0, entries[index].Data.Length);
                if (read != entries[index].Data.Length) throw new EndOfStreamException("The icon image is truncated.");
            }
        }

        byte[] groupData;
        using (MemoryStream group = new MemoryStream())
        using (BinaryWriter writer = new BinaryWriter(group))
        {
            writer.Write((ushort)0);
            writer.Write((ushort)1);
            writer.Write((ushort)entries.Count);
            for (int index = 0; index < entries.Count; index++)
            {
                Entry entry = entries[index];
                writer.Write(entry.Width);
                writer.Write(entry.Height);
                writer.Write(entry.ColorCount);
                writer.Write((byte)0);
                writer.Write(entry.Planes);
                writer.Write(entry.BitCount);
                writer.Write(entry.Data.Length);
                writer.Write((ushort)(index + 1));
            }
            groupData = group.ToArray();
        }

        IntPtr update = BeginUpdateResource(executablePath, false);
        if (update == IntPtr.Zero)
            throw new InvalidOperationException("BeginUpdateResource failed with Win32 error " + Marshal.GetLastWin32Error());
        bool commit = false;
        try
        {
            SetData(update, GroupIconType, groupResourceId, groupData);
            for (int index = 0; index < entries.Count; index++)
                SetData(update, IconType, index + 1, entries[index].Data);
            commit = true;
        }
        finally
        {
            if (!EndUpdateResource(update, !commit) && commit)
                throw new InvalidOperationException("EndUpdateResource failed with Win32 error " + Marshal.GetLastWin32Error());
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
[PhantomWindowsIcon]::Embed($ExecutablePath, $IconPath, $GroupResourceId)
Write-Host "Embedded PhantomForce icon: $ExecutablePath (group $GroupResourceId)" -ForegroundColor Green
