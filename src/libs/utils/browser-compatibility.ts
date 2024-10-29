function getBrowserEngineInfo() {
  const userAgent = navigator.userAgent;
  let engineInfo = { engine: "", version: "" };

  if (
    userAgent.includes("Chrome") &&
    userAgent.includes("Safari") &&
    !userAgent.includes("Edge")
  ) {
    const versionMatch = userAgent.match(
      /Chrome\/([\d.]+)/,
    );
    engineInfo = {
      engine: "Chrome",
      version: versionMatch ? versionMatch[1] : "unknown",
    };
  } else if (userAgent.includes("Firefox")) {
    const versionMatch = userAgent.match(
      /Firefox\/([\d.]+)/,
    );
    engineInfo = {
      engine: "Firefox",
      version: versionMatch ? versionMatch[1] : "unknown",
    };
  } else if (
    userAgent.includes("Safari") &&
    !userAgent.includes("Chrome")
  ) {
    const versionMatch = userAgent.match(
      /Version\/([\d.]+)/,
    );
    engineInfo = {
      engine: "Safari",
      version: versionMatch ? versionMatch[1] : "unknown",
    };
  } else if (userAgent.includes("Edge")) {
    const versionMatch = userAgent.match(/Edg\/([\d.]+)/);
    engineInfo = {
      engine: "Edge",
      version: versionMatch ? versionMatch[1] : "unknown",
    };
  } else if (userAgent.includes("Opera")) {
    const versionMatch = userAgent.match(/OPR\/([\d.]+)/);
    engineInfo = {
      engine: "Opera",
      version: versionMatch ? versionMatch[1] : "unknown",
    };
  }

  return engineInfo;
}

function compareVersions(current: string, target: string) {
  const currentParts = current.split(".").map(Number);
  const targetParts = target.split(".").map(Number);

  for (
    let i = 0;
    i < Math.max(currentParts.length, targetParts.length);
    i++
  ) {
    const currentPart = currentParts[i] || 0;
    const targetPart = targetParts[i] || 0;

    if (currentPart < targetPart) return false;
    if (currentPart > targetPart) return true;
  }
  return false;
}

export function checkBrowserSupport() {
  const { engine, version } = getBrowserEngineInfo();

  const minVersions = {
    Chrome: "66",
    Firefox: "63",
    Safari: "13",
    Edge: "79", // Chromium-based Edge
    Opera: "53",
  };

  return (
    engine &&
    version &&
    minVersions[engine as keyof typeof minVersions] &&
    compareVersions(
      version,
      minVersions[engine as keyof typeof minVersions],
    )
  );
}

export function isWebRTCAvailable() {
  return (
    "RTCPeerConnection" in window ||
    "webkitRTCPeerConnection" in window ||
    "mozRTCPeerConnection" in window
  );
}
