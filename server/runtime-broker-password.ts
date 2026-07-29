import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const VERSION = "v1";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashBrokerPassword(password: string): Promise<string> {
  if (!password) throw new Error("密码不能为空");
  const salt = randomBytes(16);
  const digest = await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);
  return [
    "scrypt",
    VERSION,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

export async function verifyBrokerPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  try {
    const actual = await derive(password, parsed.salt, parsed.cost, parsed.blockSize, parsed.parallelization);
    return actual.length === parsed.digest.length && timingSafeEqual(actual, parsed.digest);
  } catch {
    return false;
  }
}

export function isBrokerPasswordHash(value: string): boolean {
  return parsePasswordHash(value) !== null;
}

function parsePasswordHash(encoded: string): {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  digest: Buffer;
} | null {
  const [algorithm, version, costText, blockSizeText, parallelizationText, saltText, digestText, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || version !== VERSION || extra !== undefined) return null;
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);
  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelization !== PARALLELIZATION) return null;
  try {
    const salt = Buffer.from(saltText ?? "", "base64url");
    const digest = Buffer.from(digestText ?? "", "base64url");
    if (salt.length < 16 || digest.length !== KEY_LENGTH) return null;
    return { cost, blockSize, parallelization, salt, digest };
  } catch {
    return null;
  }
}

async function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}
