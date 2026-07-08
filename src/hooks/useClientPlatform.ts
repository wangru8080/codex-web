'use client';

import { useState, useEffect } from 'react';

interface ClientPlatform {
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  fileManagerName: string;
}

const DEFAULT: ClientPlatform = {
  isWindows: false,
  isMac: false,
  isLinux: false,
  fileManagerName: 'File Manager',
};

export function useClientPlatform(): ClientPlatform {
  /* eslint-disable react-hooks/set-state-in-effect */
  const [platform, setPlatform] = useState<ClientPlatform>(DEFAULT);

  useEffect(() => {
    // Check electronAPI first (most reliable in Electron)
    const electronPlatform = (window as unknown as { electronAPI?: { versions?: { platform?: string } } }).electronAPI?.versions?.platform;
    const raw = electronPlatform || navigator.platform || '';

    const isWindows = raw === 'win32' || /^Win/i.test(raw);
    const isMac = raw === 'darwin' || /^Mac/i.test(raw);
    const isLinux = raw === 'linux' || /^Linux/i.test(raw);

    setPlatform({
      isWindows,
      isMac,
      isLinux,
      fileManagerName: isWindows ? 'Explorer' : isMac ? 'Finder' : 'File Manager',
    });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return platform;
}
