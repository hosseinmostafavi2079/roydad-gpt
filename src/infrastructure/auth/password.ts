import "server-only";

import { hash, verify, type Options } from "@node-rs/argon2";

const argon2idOptions: Options = {
  algorithm: 2,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 2,
  outputLen: 32,
};

export function hashPlatformPassword(password: string): Promise<string> {
  return hash(password, argon2idOptions);
}

export function verifyPlatformPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password, argon2idOptions);
}
