import { SendWithIdRequest } from "@vowkey/common/tools/send/models/request/send-with-id.request";
import { CipherWithIdRequest } from "@vowkey/common/vault/models/request/cipher-with-id.request";
import { FolderWithIdRequest } from "@vowkey/common/vault/models/request/folder-with-id.request";
import { AgentRotationRecords } from "@vowkey/common/vault/agent/account-records";

export class UserDataRequest {
  ciphers: CipherWithIdRequest[];
  folders: FolderWithIdRequest[];
  sends: SendWithIdRequest[];
  agentRecords: object[];
  formBindings: object[];

  constructor(
    ciphers: CipherWithIdRequest[],
    folders: FolderWithIdRequest[],
    sends: SendWithIdRequest[],
    agents: AgentRotationRecords = { agentRecords: [], formBindings: [] },
  ) {
    this.ciphers = ciphers;
    this.folders = folders;
    this.sends = sends;
    this.agentRecords = agents.agentRecords;
    this.formBindings = agents.formBindings;
  }
}
