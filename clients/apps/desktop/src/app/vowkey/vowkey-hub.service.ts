import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

export type HubOpenMode = "auto" | "document" | "fill";

/** Lets the vault page ask the document/form sheet to open and observe local vault updates without owning it. */
@Injectable({ providedIn: "root" })
export class VowkeyHub {
  readonly openRequests$ = new Subject<HubOpenMode>();
  readonly changed$ = new Subject<void>();

  open(mode: HubOpenMode = "auto"): void {
    this.openRequests$.next(mode);
  }

  openFill(): void {
    this.openRequests$.next("fill");
  }

  notifyChanged(): void {
    this.changed$.next();
  }
}
