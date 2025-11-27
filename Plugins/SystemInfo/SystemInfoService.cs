using System.Runtime.InteropServices;

namespace WidgetEngine.Plugins.SystemInfo
{
    public class SystemInfoService
    {
        public DateTime GetSystemTime()
        {
            return DateTime.Now;
        }

        public string GetMachineName()
        {
            return Environment.MachineName;
        }

        public string GetUserName()
        {
            return Environment.UserName;
        }

        public (int Width, int Height) GetPrimaryScreenResolution()
        {
            try
            {
                return (System.Windows.Forms.Screen.PrimaryScreen.Bounds.Width, System.Windows.Forms.Screen.PrimaryScreen.Bounds.Height);
            }
            catch
            {
                return (0,0);
            }
        }
    }
}
