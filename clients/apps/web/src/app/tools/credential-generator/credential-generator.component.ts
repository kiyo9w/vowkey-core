import { Component } from "@angular/core";

import { ButtonModule, DialogService, LinkModule } from "@vowkey/components";
import {
  CredentialGeneratorHistoryDialogComponent,
  GeneratorModule,
} from "@vowkey/generator-components";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "credential-generator",
  templateUrl: "credential-generator.component.html",
  imports: [SharedModule, HeaderModule, GeneratorModule, ButtonModule, LinkModule],
})
export class CredentialGeneratorComponent {
  constructor(private dialogService: DialogService) {}

  openHistoryDialog = () => {
    this.dialogService.open(CredentialGeneratorHistoryDialogComponent);
  };
}
