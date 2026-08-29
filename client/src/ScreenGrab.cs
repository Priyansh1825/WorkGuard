using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class ScreenGrab {
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetProcessDpiAwarenessContext(int dpiFlag);

    [DllImport("gdi32.dll")]
    private static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    // SRCCOPY | CAPTUREBLT (0x00CC0020 | 0x40000000)
    // CAPTUREBLT forces DWM to blend layered, transparent, and hardware-accelerated GPU windows into the capture DC
    private const int SRCCOPY = 0x00CC0020;
    private const int CAPTUREBLT = 0x40000000;
    private const int SRCCOPY_CAPTUREBLT = SRCCOPY | CAPTUREBLT;
    private const int DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;

    public static void Main(string[] args) {
        try {
            // Enable DPI awareness so scaling (125%, 150%, 200%) doesn't crop or distort
            try {
                SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            } catch {
                try { SetProcessDPIAware(); } catch { }
            }

            string outFile = args.Length > 0 ? args[0] : null;
            long quality = 75;
            if (args.Length > 1) {
                long.TryParse(args[1], out quality);
                if (quality < 10) quality = 10;
                if (quality > 100) quality = 100;
            }

            string targetDisplay = args.Length > 2 ? args[2].ToLower() : "primary";

            Rectangle bounds;
            if (targetDisplay == "all" || targetDisplay == "virtual") {
                bounds = SystemInformation.VirtualScreen;
            } else {
                bounds = Screen.PrimaryScreen.Bounds;
            }

            if (bounds.Width <= 0 || bounds.Height <= 0) {
                bounds = new Rectangle(0, 0, 1920, 1080);
            }

            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(bitmap)) {
                    bool captured = false;

                    // Direct Hardware Screen Buffer Grab using GDI+ DC with CAPTUREBLT
                    try {
                        IntPtr hdcDest = g.GetHdc();
                        IntPtr hdcSrc = GetDC(IntPtr.Zero);
                        if (hdcSrc != IntPtr.Zero) {
                            BitBlt(hdcDest, 0, 0, bounds.Width, bounds.Height, hdcSrc, bounds.X, bounds.Y, SRCCOPY_CAPTUREBLT);
                            ReleaseDC(IntPtr.Zero, hdcSrc);
                            captured = true;
                        }
                        g.ReleaseHdc(hdcDest);
                    } catch { }

                    // Fallback to CopyPixelOperation
                    if (!captured) {
                        try {
                            g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy | CopyPixelOperation.CaptureBlt);
                        } catch {
                            g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                        }
                    }
                }

                ImageCodecInfo jpgEncoder = GetEncoder(ImageFormat.Jpeg);
                EncoderParameters encoderParameters = new EncoderParameters(1);
                encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);

                if (string.IsNullOrEmpty(outFile) || outFile == "stdout") {
                    using (MemoryStream ms = new MemoryStream()) {
                        bitmap.Save(ms, jpgEncoder, encoderParameters);
                        byte[] bytes = ms.ToArray();
                        Console.WriteLine(Convert.ToBase64String(bytes));
                    }
                } else {
                    bitmap.Save(outFile, jpgEncoder, encoderParameters);
                    Console.WriteLine("SAVED:" + outFile);
                }
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("ERROR:" + ex.Message);
            Environment.Exit(1);
        }
    }

    private static ImageCodecInfo GetEncoder(ImageFormat format) {
        ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
        foreach (ImageCodecInfo codec in codecs) {
            if (codec.FormatID == format.Guid) {
                return codec;
            }
        }
        return null;
    }
}
