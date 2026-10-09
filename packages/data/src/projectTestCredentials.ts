import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  getEnv,
  projectTestCredentials,
  type CreateProjectTestCredentialInput,
  type ProjectTestCredential,
  type ProjectTestCredentialAuthType,
  type UpdateProjectTestCredentialInput,
} from "@aif/shared";
import { getDb } from "@aif/shared/server";

export class ProjectTestCredentialError extends Error {
  constructor(
    public readonly code: "key_missing" | "key_invalid" | "not_found" | "duplicate",
    message: string,
  ) {
    super(message);
    this.name = "ProjectTestCredentialError";
  }
}

export interface ResolvedProjectTestCredential {
  ref: string;
  authType: ProjectTestCredentialAuthType;
  loginUrl: string | null;
  username: string | null;
  password: string;
}

function encryptionKey(): Buffer {
  const encoded = getEnv().AIF_PROJECT_CREDENTIALS_KEY;
  if (!encoded) {
    throw new ProjectTestCredentialError(
      "key_missing",
      "AIF_PROJECT_CREDENTIALS_KEY is not configured",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new ProjectTestCredentialError(
      "key_invalid",
      "AIF_PROJECT_CREDENTIALS_KEY must be a base64-encoded 32-byte key",
    );
  }
  return key;
}

function encrypt(secret: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(ciphertext: string, iv: string, tag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function metadata(row: typeof projectTestCredentials.$inferSelect): ProjectTestCredential {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    authType: row.authType as ProjectTestCredentialAuthType,
    loginUrl: row.loginUrl,
    username: row.username,
    hasSecret: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProjectTestCredentials(projectId: string): ProjectTestCredential[] {
  return getDb()
    .select()
    .from(projectTestCredentials)
    .where(eq(projectTestCredentials.projectId, projectId))
    .orderBy(asc(projectTestCredentials.name))
    .all()
    .map(metadata);
}

export function createProjectTestCredential(
  projectId: string,
  input: CreateProjectTestCredentialInput,
): ProjectTestCredential {
  const encrypted = encrypt(input.secret);
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    getDb().insert(projectTestCredentials).values({
      id,
      projectId,
      name: input.name,
      authType: input.authType,
      loginUrl: input.loginUrl ?? null,
      username: input.username ?? null,
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
      createdAt: now,
      updatedAt: now,
    }).run();
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new ProjectTestCredentialError("duplicate", "A credential with this name already exists");
    }
    throw error;
  }
  return listProjectTestCredentials(projectId).find((item) => item.id === id)!;
}

export function updateProjectTestCredential(
  projectId: string,
  credentialId: string,
  input: UpdateProjectTestCredentialInput,
): ProjectTestCredential {
  const current = getDb().select().from(projectTestCredentials).where(and(
    eq(projectTestCredentials.id, credentialId),
    eq(projectTestCredentials.projectId, projectId),
  )).get();
  if (!current) throw new ProjectTestCredentialError("not_found", "Credential not found");
  const encrypted = input.secret ? encrypt(input.secret) : null;
  try {
    getDb().update(projectTestCredentials).set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.authType !== undefined ? { authType: input.authType } : {}),
      ...(input.loginUrl !== undefined ? { loginUrl: input.loginUrl } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(encrypted ? {
        secretCiphertext: encrypted.ciphertext,
        secretIv: encrypted.iv,
        secretTag: encrypted.tag,
      } : {}),
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(projectTestCredentials.id, credentialId),
      eq(projectTestCredentials.projectId, projectId),
    )).run();
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new ProjectTestCredentialError("duplicate", "A credential with this name already exists");
    }
    throw error;
  }
  return listProjectTestCredentials(projectId).find((item) => item.id === credentialId)!;
}

export function deleteProjectTestCredential(projectId: string, credentialId: string): boolean {
  return getDb().delete(projectTestCredentials).where(and(
    eq(projectTestCredentials.id, credentialId),
    eq(projectTestCredentials.projectId, projectId),
  )).run().changes > 0;
}

export function resolveProjectTestCredentials(projectId: string): ResolvedProjectTestCredential[] {
  return getDb().select().from(projectTestCredentials)
    .where(eq(projectTestCredentials.projectId, projectId))
    .orderBy(asc(projectTestCredentials.name)).all().map((row) => ({
      ref: row.name,
      authType: row.authType as ProjectTestCredentialAuthType,
      loginUrl: row.loginUrl,
      username: row.username,
      password: decrypt(row.secretCiphertext, row.secretIv, row.secretTag),
    }));
}
