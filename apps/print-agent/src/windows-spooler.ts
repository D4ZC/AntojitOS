// Static code only. Printer names and ticket bytes arrive as data through the
// environment and stdin, never through PowerShell interpolation.
export const windowsSpoolerScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class AntojitRawSpooler {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string Name;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint StartDocPrinter(IntPtr printer, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool WritePrinter(IntPtr printer, [In] byte[] bytes, int count, out int written);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool AbortPrinter(IntPtr printer);
  [DllImport("winspool.drv", SetLastError = true)]
  private static extern bool ClosePrinter(IntPtr printer);

  private static Exception Failure() { return new Win32Exception(Marshal.GetLastWin32Error()); }
  public static uint Print(string queue, byte[] bytes, string title) {
    IntPtr printer;
    if (!OpenPrinter(queue, out printer, IntPtr.Zero)) throw Failure();
    bool started = false;
    try {
      uint job = StartDocPrinter(printer, 1, new DocInfo { Name = title, DataType = "RAW" });
      if (job == 0) throw Failure();
      started = true;
      if (!StartPagePrinter(printer)) throw Failure();
      int written;
      if (!WritePrinter(printer, bytes, bytes.Length, out written)) throw Failure();
      if (written != bytes.Length) throw new InvalidOperationException("El spooler no acepto todos los bytes");
      if (!EndPagePrinter(printer)) throw Failure();
      if (!EndDocPrinter(printer)) throw Failure();
      started = false;
      return job;
    } catch {
      if (started) AbortPrinter(printer);
      throw;
    } finally { ClosePrinter(printer); }
  }
}
'@
  $buffer = New-Object System.IO.MemoryStream
  try {
    [Console]::OpenStandardInput().CopyTo($buffer)
    $job = [AntojitRawSpooler]::Print($env:ANTOJIT_RAW_PRINTER_QUEUE, $buffer.ToArray(), $env:ANTOJIT_RAW_DOCUMENT_NAME)
    [Console]::Out.WriteLine('ANTOJIT_SPOOL_JOB=' + $job)
  } finally { $buffer.Dispose() }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;
