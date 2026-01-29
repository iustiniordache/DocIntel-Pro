'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.formatFileSize = formatFileSize;
exports.truncate = truncate;
exports.generateId = generateId;
exports.sleep = sleep;
exports.retry = retry;
exports.formatConfidence = formatConfidence;
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
async function retry(fn, options = {}) {
  const { maxAttempts = 3, initialDelay = 1000, maxDelay = 10000, factor = 2 } = options;
  let attempt = 0;
  let delay = initialDelay;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxAttempts) throw error;
      await sleep(Math.min(delay, maxDelay));
      delay *= factor;
    }
  }
  throw new Error('Max retry attempts reached');
}
function formatConfidence(confidence) {
  return `${(confidence * 100).toFixed(2)}%`;
}
//# sourceMappingURL=utils.js.map
