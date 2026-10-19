// 题目和选项的内部 ID；getRandomValues 在局域网 HTTP 页面中也可使用。
export function newId(source = globalThis.crypto) {
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
