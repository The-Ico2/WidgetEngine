namespace WidgetEngine.Plugins.SystemTime
{
    public class SystemTimeService
    {
        public long GetUnixSeconds()
        {
            return DateTimeOffset.Now.ToUnixTimeSeconds();
        }

        public long GetUnixMilliseconds()
        {
            return DateTimeOffset.Now.ToUnixTimeMilliseconds();
        }

        public DateTime GetNow()
        {
            return DateTime.Now;
        }
    }
}
