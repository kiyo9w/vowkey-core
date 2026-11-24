/** @jest-environment node */
import { webcrypto } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BehaviorSubject } from "rxjs";

import { AccountService } from "../../auth/abstractions/account.service";
import { UserId } from "../../types/guid";
import { CipherSdkService } from "../abstractions/cipher-sdk.service";
import { CipherService } from "../abstractions/cipher.service";
import { CipherType } from "../enums";
import { LocalVaultService } from "../local/local-vault.service";
import { NativeLocalVaultStore } from "../local/node/store";
import { AttachmentView } from "../models/view/attachment.view";
import { CipherView } from "../models/view/cipher.view";

import { ProfileService } from "./profile.service";
import { migrateLegacyProfile, recordCapture, writeEnvelope } from "./vk-meta";

const userA = "11111111-1111-4111-8111-111111111111" as UserId;
const userB = "22222222-2222-4222-8222-222222222222" as UserId;
const profileId = "33333333-3333-4333-8333-333333333333";
const nonce = new Uint8Array(12);

function profileWithDocuments(): { profile: CipherView; sourceIds: string[] } {
  const profile = new CipherView();
  profile.id = profileId;
  profile.type = CipherType.Identity;
  profile.name = "Amina Okafor";
  const meta = migrateLegacyProfile(profile);
  for (const name of ["passport", "residence"]) {
    const attachment = new AttachmentView();
    attachment.id = name;
    attachment.fileName = `${name}.png`;
    profile.attachments.push(attachment);
    recordCapture(meta, { fileName: attachment.fileName, mediaType: "image/png", kind: name }, []);
    meta.sources[meta.sources.length - 1].attachmentId = name;
  }
  writeEnvelope(profile, meta);
  return { profile, sourceIds: meta.sources.map((source) => source.id) };
}

describe("Profile document originals offline", () => {
  let directory: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vowkey-originals-"));
    ProfileService.clearByteCache();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    ProfileService.clearByteCache();
    await rm(directory, { recursive: true, force: true });
  });

  it("downloads unopened originals, then decrypts them from disk after restart with no network", async () => {
    const { profile, sourceIds } = profileWithDocuments();
    const activeAccount$ = new BehaviorSubject({ id: userA });
    const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const originals = [new TextEncoder().encode("passport original"), new TextEncoder().encode("residence original")];
    const ciphertext = await Promise.all(originals.map((bytes) => webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, bytes)));
    const downloadUrl = jest.fn(async (_id: string, attachmentId: string) => `https://vault.example/${attachmentId}`);
    const network = jest.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      return new Response(ciphertext[url.endsWith("/passport") ? 0 : 1]);
    });
    globalThis.fetch = network as typeof fetch;
    const ciphers = {
      get: async () => ({ id: profile.id }),
      decrypt: async () => profile,
      getLocalAttachment: async () => null,
      getDecryptedAttachmentBuffer: async (_id: string, _attachment: AttachmentView, response: Response) =>
        new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, await response.arrayBuffer())),
    } as unknown as CipherService;
    const open = () => new ProfileService(
      { activeAccount$ } as unknown as AccountService,
      ciphers,
      { store: new NativeLocalVaultStore(directory) } as unknown as LocalVaultService,
      { getAttachmentDownloadUrl: downloadUrl } as unknown as CipherSdkService,
    );

    await open().prefetch([profile]);
    ProfileService.clearByteCache();
    network.mockImplementation(async () => { throw new Error("Network is disabled"); });
    downloadUrl.mockImplementation(async () => { throw new Error("Cannot renew a URL offline"); });

    const restarted = open();
    expect(await restarted.bytes(profileId, sourceIds[1], "residence")).toEqual(originals[1]);
    expect(await restarted.bytes(profileId, sourceIds[0], "passport")).toEqual(originals[0]);
    expect(network).toHaveBeenCalledTimes(2);
    const persisted = await new NativeLocalVaultStore(directory).list<{ bytes: Blob }>("attachments");
    const storedBytes = await Promise.all(persisted.map(async ({ value }) => new Uint8Array(await value.bytes.arrayBuffer())));
    expect(storedBytes).toEqual(expect.arrayContaining(ciphertext.map((bytes) => new Uint8Array(bytes))));
  });

  it("never reuses another account's original with the same document identifiers", async () => {
    const { profile, sourceIds } = profileWithDocuments();
    const activeAccount$ = new BehaviorSubject({ id: userA });
    const keys = await Promise.all([userA, userB].map(() =>
      webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])));
    const originals = [new TextEncoder().encode("account A document"), new TextEncoder().encode("account B document")];
    const ciphertext = await Promise.all(originals.map((bytes, index) =>
      webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, keys[index], bytes)));
    let downloads = 0;
    globalThis.fetch = jest.fn(async () => {
      downloads++;
      return new Response(ciphertext[activeAccount$.value.id === userA ? 0 : 1]);
    }) as typeof fetch;
    const ciphers = {
      get: async () => ({ id: profile.id }),
      decrypt: async () => profile,
      getLocalAttachment: async () => null,
      getDecryptedAttachmentBuffer: async (_id: string, _attachment: AttachmentView, response: Response, userId: UserId) =>
        new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, keys[userId === userA ? 0 : 1], await response.arrayBuffer())),
    } as unknown as CipherService;
    const service = new ProfileService(
      { activeAccount$ } as unknown as AccountService,
      ciphers,
      { store: new NativeLocalVaultStore(directory) } as unknown as LocalVaultService,
      { getAttachmentDownloadUrl: async () => "https://vault.example/original" } as unknown as CipherSdkService,
    );

    expect(await service.bytes(profileId, sourceIds[0], "passport")).toEqual(originals[0]);
    activeAccount$.next({ id: userB });
    expect(await service.bytes(profileId, sourceIds[0], "passport")).toEqual(originals[1]);
    activeAccount$.next({ id: userA });
    expect(await service.bytes(profileId, sourceIds[0], "passport")).toEqual(originals[0]);
    expect(downloads).toBe(2);
  });
});
