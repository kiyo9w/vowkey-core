import { Component, ChangeDetectionStrategy } from "@angular/core";
import { FormBuilder, FormControl, Validators } from "@angular/forms";

import { PolicyType } from "@vowkey/common/admin-console/enums";
import { SavePolicyRequest } from "@vowkey/common/admin-console/models/request/save-policy.request";
import {
  UriMatchStrategy,
  UriMatchStrategySetting,
} from "@vowkey/common/models/domain/domain-service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { OrgKey } from "@vowkey/common/types/key";
import { SwitchComponent } from "@vowkey/components";

import { SharedModule } from "../../../../shared";
import { BasePolicyEditDefinition, BasePolicyEditComponent } from "../base-policy-edit.component";
import { PolicyCategory } from "../pipes/policy-category";

export class UriMatchDefaultPolicy extends BasePolicyEditDefinition {
  name = "uriMatchDetectionPolicy";
  description = "uriMatchDetectionPolicyDescV2";
  descriptionVfo1 = "uriMatchDetectionPolicyDescVfo1";
  drawerDescriptionVfo1 = "uriMatchDetectionPolicyDescV2";
  type = PolicyType.UriMatchDefaults;
  category = PolicyCategory.VaultManagement;
  priority = 20;
  component = UriMatchDefaultPolicyComponent;
  prerequisiteKey = "requireSsoPolicyReqV2";
  prerequisiteKeyVfo1 = "requireSsoPolicyReqV2Vfo1";
}
@Component({
  selector: "uri-match-default-policy-edit",
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "uri-match-default.component.html",
  imports: [SharedModule, SwitchComponent],
})
export class UriMatchDefaultPolicyComponent extends BasePolicyEditComponent {
  readonly uriMatchOptions: {
    label: string;
    value: UriMatchStrategySetting | null;
    disabled?: boolean;
  }[];

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly i18nService: I18nService,
  ) {
    super();

    this.data = this.formBuilder.group({
      uriMatchDetection: new FormControl<UriMatchStrategySetting>(UriMatchStrategy.Domain, {
        validators: [Validators.required],
        nonNullable: true,
      }),
    });

    this.uriMatchOptions = [
      { label: i18nService.t("baseDomain"), value: UriMatchStrategy.Domain },
      { label: i18nService.t("host"), value: UriMatchStrategy.Host },
      { label: i18nService.t("exact"), value: UriMatchStrategy.Exact },
      { label: i18nService.t("never"), value: UriMatchStrategy.Never },
    ];
  }

  protected loadData() {
    const uriMatchDetection = this.policyResponse()?.data?.uriMatchDetection;

    this.data?.patchValue({
      uriMatchDetection: uriMatchDetection,
    });
  }

  protected buildRequestData() {
    return {
      uriMatchDetection: this.data?.value?.uriMatchDetection,
    };
  }

  override async buildRequest(orgKey?: OrgKey): Promise<SavePolicyRequest> {
    const request = await super.buildRequest(orgKey);
    if (request.policy.data?.uriMatchDetection == null) {
      throw new Error(this.i18nService.t("invalidUriMatchDefaultPolicySetting"));
    }

    return request;
  }
}
