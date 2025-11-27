using NAudio.CoreAudioApi;

namespace WidgetEngine.Plugins.SystemAudio
{
    public class AudioService
    {
        private readonly MMDeviceEnumerator _enumerator = new MMDeviceEnumerator();

        public (float volume, bool isMuted) GetDefaultPlaybackVolume()
        {
            try
            {
                var device = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                return (device.AudioEndpointVolume.MasterVolumeLevelScalar, device.AudioEndpointVolume.Mute);
            }
            catch
            {
                return (0f, false);
            }
        }

        public IEnumerable<string> GetPlaybackDevices()
        {
            try
            {
                var devices = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
                return devices.Select(d => d.FriendlyName).ToList();
            }
            catch
            {
                return Enumerable.Empty<string>();
            }
        }
    }
}
