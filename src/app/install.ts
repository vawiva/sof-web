// Installed web app ("Add to Home Screen") on phones and tablets.
//
// On iPhone/iPad, play needs the installed app (opened from its Home Screen icon): it has the whole screen without
// browser bars and keeps its own storage. The browser page stays usable for setup, help and the installation steps.
// On Android installing is offered prominently (the browser's install prompt where it has one, else the menu steps),
// with "Continue in browser" next to it: both work. Desktop browsers play without installing.
//
// Installed = launched as a standalone web app: iOS sets navigator.standalone; other browsers match the
// display-mode media query of the manifest's "standalone" display. Browser fullscreen (the Fullscreen API) is not
// an installed app and is not counted, even though it can also make display-mode match "fullscreen".

export type Platform = 'ios' | 'android' | 'desktop';

export function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  // iPadOS reports a Mac user agent by default; a Mac has no multi-touch screen
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function isStandalone(nav: { standalone?: boolean }, mm: (q: string) => boolean): boolean {
  return nav.standalone === true || mm('(display-mode: standalone)');
}

export interface InstallState {
  platform: Platform;
  standalone: boolean;
  /** play is held back until the app is opened from the Home Screen (iPhone/iPad) */
  gate: boolean;
  /** installing is offered next to play (Android) */
  offer: boolean;
}

export function installState(win: { navigator: Navigator & { standalone?: boolean }; matchMedia: (q: string) => MediaQueryList } = window): InstallState {
  const platform = detectPlatform(win.navigator.userAgent, win.navigator.maxTouchPoints ?? 0);
  const standalone = isStandalone(win.navigator, (q) => win.matchMedia(q).matches);
  return { platform, standalone, gate: platform === 'ios' && !standalone, offer: platform === 'android' && !standalone };
}

/** Android's install offer (Chromium's beforeinstallprompt), kept until the player asks for it. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

export function watchInstallPrompt(onAvailable: () => void) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    onAvailable();
  });
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  await e.prompt();
  return (await e.userChoice).outcome;
}
