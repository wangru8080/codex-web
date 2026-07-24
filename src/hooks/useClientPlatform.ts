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
    const raw = navigator.platform || '';

    const isWindows = /^Win/i.test(raw);
    const isMac = /^Mac/i.test(raw);
    const isLinux = /^Linux/i.test(raw);

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
