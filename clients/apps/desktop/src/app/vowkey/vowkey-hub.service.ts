import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

/** Lets the vault page ask the document sheet to open and observe local vault updates without owning it. */
@Injectable({ providedIn: "root" })
export class VowkeyHub {
  readonly openRequests$ = new Subject<void>();
  readonly changed$ = new Subject<void>();

  open(): void {
    this.openRequests$.next();
  }

  notifyChanged(): void {
    this.changed$.next();
  }
}
