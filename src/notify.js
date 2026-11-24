// A notification without the desktop app, for the scheduled sync: macOS through osascript, Linux through
// notify-send, Windows through a PowerShell balloon. The title and text go in as arguments (or environment
// variables), never pasted into a script, so a bank's or merchant's name can't run anything.
import { execFileSync } from 'node:child_process';

const MAC = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];
const WINDOWS = [
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  '$n = New-Object System.Windows.Forms.NotifyIcon',
  '$n.Icon = [System.Drawing.SystemIcons]::Information',
  '$n.Visible = $true',
  '$n.ShowBalloonTip(10000, $env:MUNTO_TITLE, $env:MUNTO_BODY, [System.Windows.Forms.ToolTipIcon]::Info)',
  'Start-Sleep -Seconds 10',
  '$n.Dispose()',
].join('; ');

// Text that starts with "-" (a bank called "-e …") could be read as an option: osascript's -e runs a script.
// A leading hyphen becomes the look-alike Unicode hyphen, so the text is always just text.
export const notOption = (text) => String(text ?? '').replace(/^-/, '‐');

// [file, args, env] for this platform, or null where there's no way to notify.
export function notifyCommand(title, body, platform = process.platform) {
  const [t, b] = [notOption(title), notOption(body)];
  if (platform === 'darwin') return ['osascript', [...MAC.flatMap((line) => ['-e', line]), t, b], {}];
  if (platform === 'linux') return ['notify-send', ['--app-name=Munto', '--', t, b], {}];
  if (platform === 'win32') return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS], { MUNTO_TITLE: title, MUNTO_BODY: body }];
  return null;
}

// Best effort: no notifier installed (notify-send on a server) isn't an error, the log still says it.
export function notify(title, body) {
  const command = notifyCommand(title, body);
  if (!command) return false;
  const [file, args, env] = command;
  try {
    execFileSync(file, args, { stdio: 'ignore', timeout: 20_000, env: { ...process.env, ...env } });
    return true;
  } catch {
    return false;
  }
}
