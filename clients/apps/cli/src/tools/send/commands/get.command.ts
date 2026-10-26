// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { OptionValues } from "commander";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { SendView } from "@vowkey/common/tools/send/models/view/send.view";
import { SendDecryptionService } from "@vowkey/common/tools/send/services/send-decryption.service";
import { SendService } from "@vowkey/common/tools/send/services/send.service.abstraction";
import { SearchService } from "@vowkey/common/vault/abstractions/search.service";
import { isGuid } from "@vowkey/guid";
// eslint-disable-next-line no-restricted-imports
import { EncryptService } from "@vowkey/legacy-crypto";

import { DownloadCommand } from "../../../commands/download.command";
import { Response } from "../../../models/response";
import { SendResponse } from "../models/send.response";

export class SendGetCommand extends DownloadCommand {
  constructor(
    private sendService: SendService,
    private environmentService: EnvironmentService,
    private searchService: SearchService,
    encryptService: EncryptService,
    apiService: ApiService,
    private accountService: AccountService,
    private sendDecryptionService: SendDecryptionService,
  ) {
    super(encryptService, apiService);
  }

  async run(id: string, options: OptionValues) {
    const serveCommand = process.env.VOWKEY_SERVE === "true";
    if (serveCommand && !Utils.isGuid(id)) {
      return Response.badRequest("`" + id + "` is not a GUID.");
    }

    let sends = await this.getSendView(id);
    if (sends == null) {
      return Response.notFound();
    }

    const env = await firstValueFrom(this.environmentService.environment$);
    const sendUrl = env.getSendUrl();
    let filter = (s: SendView) => true;
    let selector = async (s: SendView): Promise<Response> =>
      Response.success(new SendResponse(s, sendUrl));
    if (!serveCommand && options?.text != null) {
      filter = (s) => {
        return filter(s) && s.text != null;
      };
      selector = async (s) => {
        // Write to stdout and response success so we get the text string only to stdout
        process.stdout.write(s.text.text);
        return Response.success();
      };
    }

    if (Array.isArray(sends)) {
      if (filter != null) {
        sends = sends.filter(filter);
      }
      if (sends.length > 1) {
        return Response.multipleResults(sends.map((s) => s.id));
      }
      if (sends.length > 0) {
        return selector(sends[0]);
      } else {
        return Response.notFound();
      }
    }

    return selector(sends);
  }

  private async getSendView(id: string): Promise<SendView | SendView[]> {
    const activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    if (isGuid(id)) {
      const send = await this.sendService.getFromState(id);
      if (send != null) {
        return await this.sendDecryptionService.decryptSend(send, activeUserId);
      }
    } else if (id.trim() !== "") {
      let sends = await this.sendService.getAllDecryptedFromState(activeUserId);
      sends = this.searchService.searchSends(sends, id);
      if (sends.length > 1) {
        return sends;
      } else if (sends.length > 0) {
        return sends[0];
      }
    }
  }
}
