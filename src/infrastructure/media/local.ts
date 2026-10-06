import "server-only";

import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DomainError } from "@/shared/errors/domain-error";

export function validateObjectKey(key: string): string[] {
  const parts = key.split("/");
  if (
    key.length > 1024 ||
    parts.length < 4 ||
    parts[0] !== "tenants" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(parts[1] ?? "") ||
    parts.some(
      (part) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(part) ||
        part.includes("..") ||
        part.endsWith(".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new DomainError("VALIDATION_FAILED", "کلید رسانه معتبر نیست.");
  return parts;
}

function unsafe(): never {
  throw new DomainError("VALIDATION_FAILED", "مسیر رسانه امن نیست.");
}
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["ENOENT", "ENOTDIR"].includes(String(error.code))
  );
}

// Linux production uses directory descriptors, so a renamed parent cannot redirect an
// operation outside the volume. Windows development also rejects junctions/symlinks;
// its private root must not be writable by another local principal.
export class LocalMediaStorage {
  readonly root: string;
  constructor(root: string) {
    if (!path.isAbsolute(root) || root.includes("\0")) unsafe();
    this.root = path.resolve(root);
    if (this.root === path.parse(this.root).root) unsafe();
  }

  private async directory(parts: string[], create: boolean) {
    const handles: FileHandle[] = [];
    let current = path.parse(this.root).root;
    const components = [
      ...this.root.slice(current.length).split(path.sep).filter(Boolean),
      ...parts,
    ];
    try {
      if (process.platform === "linux") {
        handles.push(
          await open(current, constants.O_RDONLY | constants.O_DIRECTORY),
        );
      }
      for (const part of components) {
        const parent = handles.length
          ? `/proc/self/fd/${handles[handles.length - 1]?.fd}`
          : current;
        const next = path.join(parent, part);
        if (create)
          await mkdir(next, { mode: 0o700 }).catch((error) => {
            if (error.code !== "EEXIST") throw error;
          });
        const info = await lstat(next);
        if (info.isSymbolicLink() || !info.isDirectory()) unsafe();
        if (process.platform === "linux") {
          handles.push(
            await open(
              next,
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            ),
          );
        } else {
          // Windows temp paths may contain a legitimate 8.3 alias. lstat above
          // rejects links before canonicalizing the directory name.
          current = await realpath(next);
        }
      }
      return {
        path: handles.length
          ? `/proc/self/fd/${handles[handles.length - 1]?.fd}`
          : current,
        close: async () => {
          for (const handle of handles.reverse()) await handle.close();
        },
      };
    } catch (error) {
      for (const handle of handles.reverse()) await handle.close();
      throw error;
    }
  }

  private async regularFile(file: string, missingAllowed = false) {
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) unsafe();
    } catch (error) {
      if (!missingAllowed || !isMissing(error)) throw error;
    }
  }

  async put(
    key: string,
    _contentType: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const parts = validateObjectKey(key);
    const fileName = parts.pop();
    if (!fileName) unsafe();
    const directory = await this.directory(parts, true);
    const target = path.join(directory.path, fileName);
    const temporary = path.join(directory.path, `.media-write-${randomUUID()}`);
    try {
      await this.regularFile(target, true);
      const file = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await this.regularFile(target, true);
      await rename(temporary, target);
    } finally {
      try {
        await unlink(temporary).catch((error) => {
          if (!isMissing(error)) throw error;
        });
      } finally {
        await directory.close();
      }
    }
  }

  async get(key: string, range?: string): Promise<Uint8Array> {
    const parts = validateObjectKey(key);
    const fileName = parts.pop();
    if (!fileName) unsafe();
    let directory:
      | Awaited<ReturnType<LocalMediaStorage["directory"]>>
      | undefined;
    try {
      directory = await this.directory(parts, false);
      const target = path.join(directory.path, fileName);
      await this.regularFile(target);
      const file = await open(
        target,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1) unsafe();
        const match = range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = match ? Number(match[1]) : 0;
        const end = match
          ? Math.min(match[2] ? Number(match[2]) : info.size - 1, info.size - 1)
          : info.size - 1;
        if (
          range &&
          (!match ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            start >= info.size)
        )
          throw new DomainError("VALIDATION_FAILED", "بازه رسانه معتبر نیست.");
        if (!range) {
          const bytes = await file.readFile();
          return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
        }
        const buffer = Buffer.alloc(end - start + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const result = await file.read(
            buffer,
            offset,
            buffer.length - offset,
            start + offset,
          );
          if (!result.bytesRead)
            throw new DomainError("NOT_FOUND", "رسانه یافت نشد.");
          offset += result.bytesRead;
        }
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isMissing(error))
        throw new DomainError("NOT_FOUND", "رسانه یافت نشد.");
      throw error;
    } finally {
      await directory?.close();
    }
  }

  async delete(key: string): Promise<void> {
    const parts = validateObjectKey(key);
    const fileName = parts.pop();
    if (!fileName) unsafe();
    let directory:
      | Awaited<ReturnType<LocalMediaStorage["directory"]>>
      | undefined;
    try {
      directory = await this.directory(parts, false);
      const target = path.join(directory.path, fileName);
      await this.regularFile(target);
      await unlink(target);
    } catch (error) {
      if (!isMissing(error)) throw error;
    } finally {
      await directory?.close();
    }
  }

  async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    const visit = async (parts: string[]) => {
      const directory = await this.directory(parts, false);
      try {
        for (const entry of await readdir(directory.path, {
          withFileTypes: true,
        })) {
          if (entry.isSymbolicLink()) unsafe();
          // Interrupted atomic writes are not committed media objects.
          if (entry.isFile() && /^\.media-write-[0-9a-f-]+$/.test(entry.name))
            continue;
          const child = [...parts, entry.name];
          if (entry.isDirectory()) await visit(child);
          else if (entry.isFile()) {
            const key = child.join("/");
            validateObjectKey(key);
            await this.regularFile(path.join(directory.path, entry.name));
            keys.push(key);
          } else unsafe();
        }
      } finally {
        await directory.close();
      }
    };
    await visit([]);
    return keys.sort();
  }
}
