// Whether two paths name the same file on disk.
//
// A plain path comparison misses a symlink, a hard link, `..` segments and a
// case-insensitive file system. When both files exist, their device and inode
// decide; when one does not exist yet, the real paths do (symlinks in its
// directory resolved).

import { realpathSync, statSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function statOf(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/** The real path of `path`; for a file that does not exist yet, its real directory plus its name. */
function realTarget(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    try {
      return join(realpathSync(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

export function sameFile(a: string, b: string): boolean {
  const statA = statOf(a);
  const statB = statOf(b);
  if (statA && statB) return statA.dev === statB.dev && statA.ino === statB.ino;
  return realTarget(a) === realTarget(b);
}
