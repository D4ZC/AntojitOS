const hexadecimal = (bytes: Uint8Array): string[] =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

export const createUuid = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const parts = hexadecimal(bytes);

  return [
    parts.slice(0, 4).join(""),
    parts.slice(4, 6).join(""),
    parts.slice(6, 8).join(""),
    parts.slice(8, 10).join(""),
    parts.slice(10, 16).join(""),
  ].join("-");
};
