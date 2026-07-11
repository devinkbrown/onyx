// SPDX-License-Identifier: AGPL-3.0-or-later
const ELLIPSIS = '…';
const COMBINING_MARK = /^\p{Mark}$/u;

const isVariationSelector = (value: string) => {
  const codePoint = value.codePointAt(0);

  return (
    codePoint !== undefined &&
    ((codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      (codePoint >= 0xe0100 && codePoint <= 0xe01ef))
  );
};

const isEmojiModifier = (value: string) => {
  const codePoint = value.codePointAt(0);

  return codePoint !== undefined && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
};

const isZeroWidthJoiner = (value: string) => value === '\u200d';

const isClusterContinuation = (value: string) =>
  COMBINING_MARK.test(value) ||
  isVariationSelector(value) ||
  isEmojiModifier(value) ||
  isZeroWidthJoiner(value);

const toTextClusters = (value: string) => {
  const clusters: string[] = [];
  let appendAfterJoiner = false;

  for (const codePoint of value) {
    const previousIndex = clusters.length - 1;
    if (previousIndex >= 0 && (appendAfterJoiner || isClusterContinuation(codePoint))) {
      clusters[previousIndex] += codePoint;
    } else {
      clusters.push(codePoint);
    }

    appendAfterJoiner = codePoint === '\u200d';
  }

  return clusters;
};

const normalizeMax = (max: number) => {
  if (!Number.isFinite(max)) {
    return max === Number.POSITIVE_INFINITY ? max : 0;
  }

  return Math.floor(max);
};

const takeStart = (clusters: readonly string[], maxLength: number) => {
  let result = '';

  for (const cluster of clusters) {
    if (result.length + cluster.length > maxLength) {
      break;
    }

    result += cluster;
  }

  return result;
};

const takeEnd = (clusters: readonly string[], maxLength: number) => {
  let result = '';

  for (let i = clusters.length - 1; i >= 0; i--) {
    const cluster = clusters[i]!;
    if (result.length + cluster.length > maxLength) {
      break;
    }

    result = cluster + result;
  }

  return result;
};

export const truncateEnd = (value: string, max: number) => {
  const limit = normalizeMax(max);
  if (limit <= 0) {
    return '';
  }
  if (limit >= value.length) {
    return value;
  }
  if (limit === ELLIPSIS.length) {
    return ELLIPSIS;
  }

  return `${takeStart(toTextClusters(value), limit - ELLIPSIS.length)}${ELLIPSIS}`;
};

export const truncateMiddle = (value: string, max: number) => {
  const limit = normalizeMax(max);
  if (limit <= 0) {
    return '';
  }
  if (limit >= value.length) {
    return value;
  }
  if (limit === ELLIPSIS.length) {
    return ELLIPSIS;
  }

  const remaining = limit - ELLIPSIS.length;
  const headLength = Math.floor(remaining / 2);
  const tailLength = remaining - headLength;
  const clusters = toTextClusters(value);

  return `${takeStart(clusters, headLength)}${ELLIPSIS}${takeEnd(clusters, tailLength)}`;
};
