export const piInstallCommand = 'pi install git:https://github.com/lalitjeevanrao/bb-plugins.git@v0.3.2';
export async function copyPiInstallCommand(clipboard = globalThis.navigator?.clipboard) {
  try {
    if (!clipboard?.writeText) throw Error('Clipboard unavailable');
    await clipboard.writeText(piInstallCommand);
    return 'Command copied.';
  } catch { return 'Copy unavailable. Select and copy the command below.'; }
}
