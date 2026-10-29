import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, OnDestroy, signal, untracked, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SafeInjectionToken } from "@vowkey/ui-common";
import { getDocument, PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import "pdfjs-dist/webpack.mjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherSdkService } from "@vowkey/common/vault/abstractions/cipher-sdk.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { ProfileDetailEdit, ProfileService } from "@vowkey/common/vault/profile/profile.service";
import { agentRuleOf, DetailVariant, Locator, ProfileDetail, ProfileSource, readEnvelope, resolveDetailVariant, ValueType } from "@vowkey/common/vault/profile/vk-meta";

export interface ProfileDocumentActions {
  remove(profileId: string, sourceId: string): Promise<CipherView>;
  move(profileId: string, sourceId: string, destinationId: string): Promise<CipherView>;
  replace(profileId: string, sourceId: string, file: File): Promise<CipherView | null>;
  profiles(): Promise<CipherView[]>;
  pending?(): Promise<{ id: string; kind: "capture" | "move" | "delete"; profileId: string; sourceId: string; fileName: string }[]>;
  retry?(id: string): Promise<CipherView>;
}
export const PROFILE_DOCUMENT_ACTIONS = new SafeInjectionToken<ProfileDocumentActions>("Profile document actions");

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="profile" aria-label="Profile details and documents">
      <nav class="tabs" aria-label="Profile view">
        <button type="button" [attr.aria-pressed]="tab() === 'details'" (click)="tab.set('details')">Details</button>
        <button type="button" [attr.aria-pressed]="tab() === 'documents'" (click)="tab.set('documents')">Documents</button>
      </nav>
      @if (error()) { <p class="notice" role="alert">{{ error() }}</p> }
      @if (message()) { <p class="notice" role="status">{{ message() }}</p> }
      @for (operation of operations(); track operation.id) {
        <div class="pending"><span>{{ operation.fileName }} · {{ operation.kind === 'move' ? 'Move waiting' : operation.kind === 'delete' ? 'Deletion waiting' : 'Upload waiting' }}</span><button type="button" [disabled]="busy()" (click)="retry(operation.id)">Retry</button></div>
      }
      @if (meta(); as envelope) {
        @if (tab() === 'details') {
          @for (detail of visibleDetails(); track detail.id) {
            @if (winner(detail); as variant) {
              <article class="detail">
                <button type="button" class="copy" (click)="copy(detail, variant)">
                  <small>{{ detail.label }}</small><strong>{{ variant.value }}</strong>
                </button>
                <details class="more">
                  <summary [attr.aria-label]="'More for ' + detail.label">•••</summary>
                  <div class="menu">
                    @if (variant.sourceId) { <button type="button" (click)="show(variant)">Show in document</button> }
                    @if (editable()) { <button type="button" (click)="beginEdit(detail, variant)">Correct value</button> }
                    <button type="button" (click)="expanded.set(expanded() === detail.id ? null : detail.id)">Variants and history</button>
                    @if (editable()) {
                      <label>AI agents
                        <select [ngModel]="rule(detail)" (ngModelChange)="edit({kind:'rule', detailId:detail.id, rule:$event})" [disabled]="busy()">
                          <option value="ask">Ask first</option><option value="fill">Fill without asking</option><option value="never">Don't fill</option>
                        </select>
                      </label>
                      <button type="button" class="danger" (click)="deleteDetail(detail)">Delete detail</button>
                    }
                  </div>
                </details>
                @if (editing()?.detailId === detail.id) {
                  <form class="editor" (submit)="$event.preventDefault(); saveCorrection()">
                    <label>{{ detail.label }}<input [ngModel]="correction()" (ngModelChange)="correction.set($event)" name="value" autocomplete="off" /></label>
                    <button type="button" (click)="editing.set(null)">Cancel</button><button type="submit" [disabled]="busy() || !correction().trim()">Save</button>
                  </form>
                }
                @if (expanded() === detail.id) {
                  <div class="variants">
                    @for (alternative of detail.variants; track alternative.id) {
                      @if (alternative.current) {
                        <div class="variant"><span><b>{{ alternative.value }}</b><small>{{ alternative.script || alternative.tag || 'Current value' }} · {{ sourceName(alternative) }}</small></span>
                          @if (alternative.id === variant.id) { <small>Chosen</small> }
                          @else if (editable()) { <button type="button" [disabled]="busy()" (click)="edit({kind:'choose',detailId:detail.id,variantId:alternative.id})">Use this</button> }
                          <details><summary aria-label="More for saved value">•••</summary><div class="menu">
                            @if (alternative.sourceId) { <button type="button" (click)="show(alternative)">Show in document</button> }
                            @if (editable()) { <button type="button" [disabled]="busy()" (click)="edit({kind:'dismiss',detailId:detail.id,variantId:alternative.id})">Dismiss alternative</button> }
                          </div></details>
                        </div>
                      }
                    }
                    @for (entry of detail.history; track $index) {
                      <div class="variant history"><span><b>{{ entry.variant.value }}</b><small>{{ entry.retiredAt | date:'mediumDate' }} · {{ sourceName(entry.variant) }}</small></span>
                        <details><summary aria-label="More for previous value">•••</summary><div class="menu">
                          @if (entry.variant.sourceId) { <button type="button" (click)="show(entry.variant)">Show in document</button> }
                          @if (editable()) { <button type="button" [disabled]="busy()" (click)="edit({kind:'restore',detailId:detail.id,variantId:entry.variant.id})">Use this value</button> }
                        </div></details>
                      </div>
                    }
                  </div>
                }
              </article>
            }
          } @empty { <p class="empty">No details saved yet.</p> }
          @if (editable()) {
            <details class="new-detail"><summary>Add detail</summary>
              <form class="editor" (submit)="$event.preventDefault(); add()">
                <label>Label<input name="label" [(ngModel)]="newLabel" required /></label>
                <label>Value<input name="value" [(ngModel)]="newValue" required autocomplete="off" /></label>
                <label>Type<select name="type" [(ngModel)]="newType"><option value="text">Text</option><option value="date">Date</option><option value="phone">Phone</option><option value="email">Email</option><option value="address">Address</option><option value="number">Number</option><option value="link">Link</option><option value="secret">Secret</option></select></label>
                <button type="submit" [disabled]="busy() || !newLabel.trim() || !newValue.trim()">Save detail</button>
              </form>
            </details>
          }
        } @else {
          <div class="documents">
            <aside aria-label="Documents">
              @for (source of envelope.sources; track source.id) {
                <button type="button" class="source" [class.selected]="selectedSource()?.id === source.id" (click)="openSource(source)">
                  <b>{{ source.fileName }}</b><small>{{ source.status === 'deleted' ? 'Document deleted' : source.status === 'retained' ? 'Previous document' : (source.capturedAt | date:'mediumDate') }}</small>
                </button>
              } @empty { <p class="empty">No documents saved yet.</p> }
            </aside>
            @if (selectedSource(); as source) {
              <section class="reader" [attr.aria-label]="source.fileName">
                <header><b>{{ source.fileName }}</b><details><summary aria-label="Document actions">•••</summary><div class="menu">
                  <button type="button" [disabled]="loading() || source.status === 'deleted'" (click)="download()">Download original</button>
                  @if (actions && editable() && source.status !== 'deleted') {
                    <label class="file-action">Replace document<input type="file" (change)="replace($event)" [disabled]="busy()" /></label>
                    <button type="button" (click)="pickDestination()">Move to another profile</button>
                    <button type="button" class="danger" (click)="removeSource()">Delete document</button>
                  }
                </div></details></header>
                @if (destinations().length) {
                  <label>Move to<select [ngModel]="destinationId()" (ngModelChange)="destinationId.set($event)"><option value="">Choose profile</option>@for (profile of destinations(); track profile.id) { <option [value]="profile.id">{{ profile.name }}</option> }</select></label>
                  <button type="button" [disabled]="busy() || !destinationId()" (click)="move()">Move document</button>
                }
                @if (loading()) { <p role="status">Opening document…</p> }
                @if (preview() || pdfVisible()) {
                  <div class="page">
                    @if (pdfVisible()) { <canvas #pdfCanvas [attr.aria-label]="source.fileName + ', page ' + (page() + 1)" role="img"></canvas> }
                    @else { <img [src]="preview()" [alt]="source.fileName + ', page ' + (page() + 1)" /> }
                    @if (pageBox(); as box) { <span class="box" [style.left.%]="box.x * 100" [style.top.%]="box.y * 100" [style.width.%]="box.w * 100" [style.height.%]="box.h * 100" aria-label="Saved detail location"></span> }
                  </div>
                }
                @if (pageCount() > 1) {
                  <div class="pager"><button type="button" [disabled]="page() === 0 || loading()" (click)="renderPage(page() - 1)">Previous page</button><span>{{ page() + 1 }} / {{ pageCount() }}</span><button type="button" [disabled]="page() + 1 >= pageCount() || loading()" (click)="renderPage(page() + 1)">Next page</button></div>
                }
                @if (selectedLocator(); as locator) { @if (locator.kind === 'cell') { <p class="notice">Sheet or page {{ locator.page + 1 }} · {{ locator.a1 || ('row ' + (locator.row + 1) + ', column ' + (locator.column + 1)) }}</p> } }
                @if (!loading() && !preview() && !pdfVisible() && source.status !== 'deleted' && source.attachmentId) { <p class="notice">Download the original to open this document.</p> }
                @if (source.status === 'deleted' || !source.attachmentId) { <p class="notice">The original document is unavailable. Its saved details and history are unchanged.</p> }
                <div class="document-details">
                  @for (entry of documentDetails(); track entry.variant.id) {
                    <div class="document-detail">
                      <button type="button" (click)="locate(entry.variant)"><small>{{ entry.detail.label }}</small><b>{{ entry.variant.value }}</b></button>
                      @if (editable()) {
                        <details><summary [attr.aria-label]="'More for ' + entry.detail.label">•••</summary><div class="menu">
                          @if (entry.variant.current) {
                            <button type="button" (click)="beginEdit(entry.detail, entry.variant)">Correct value</button>
                            <button type="button" [disabled]="busy()" (click)="edit({kind:'choose',detailId:entry.detail.id,variantId:entry.variant.id})">Use this value</button>
                          } @else { <button type="button" [disabled]="busy()" (click)="edit({kind:'restore',detailId:entry.detail.id,variantId:entry.variant.id})">Use this value</button> }
                        </div></details>
                      }
                    </div>
                  }
                </div>
                @if (editing(); as edit) {
                  <form class="editor" (submit)="$event.preventDefault(); saveCorrection()">
                    <label>Correct value<input [ngModel]="correction()" (ngModelChange)="correction.set($event)" name="documentValue" autocomplete="off" /></label>
                    <button type="button" (click)="editing.set(null)">Cancel</button><button type="submit" [disabled]="busy() || !correction().trim()">Save</button>
                  </form>
                }
              </section>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host{display:block;color:inherit}.profile{min-width:0}.tabs{display:flex;gap:20px;border-bottom:1px solid rgb(var(--color-secondary-300,218 221 226));margin-bottom:16px}.tabs button{padding:12px 4px;background:none;border:0;border-bottom:2px solid transparent}.tabs button[aria-pressed=true]{border-color:rgb(var(--color-primary-600,37 99 235));font-weight:600}button,summary,select{cursor:pointer}button:disabled{cursor:default;opacity:.55}button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #2563eb;outline-offset:3px}button{color:inherit}.detail{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;border-bottom:1px solid #d9dde3}.copy{border:0;background:none;text-align:left;padding:14px 12px;min-width:0}.copy small,.copy strong,.variant small,.source small{display:block}.copy small,.variant small,.source small{font-size:12px;opacity:.7}.copy strong{font-size:15px;font-weight:500;overflow-wrap:anywhere}.more{align-self:center;margin:8px}summary{list-style:none;padding:6px}.menu{position:absolute;right:8px;z-index:5;min-width:220px;max-width:90%;padding:6px;background:rgb(var(--color-background,255 255 255));border:1px solid #cdd2da;border-radius:8px;box-shadow:0 8px 24px #0002}.menu button,.menu label{display:block;border:0;background:none;width:100%;text-align:left;padding:9px 10px}.menu select{width:100%;margin-top:6px}.danger{color:#b42318!important}.editor{grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;align-items:end;padding:12px}.editor label{display:grid;gap:5px;flex:1;min-width:130px}.editor input,.editor select,.reader select{border:1px solid #aab3c0;border-radius:6px;padding:8px;color:inherit;background:transparent}.editor button,.pager button,.reader>button{border:1px solid #aab3c0;border-radius:6px;background:transparent;padding:7px 12px}.variants{grid-column:1/-1;padding:0 12px 12px 24px}.variant{position:relative;display:flex;align-items:center;gap:12px;padding:10px 0}.variant>span{flex:1;min-width:0;overflow-wrap:anywhere}.variant b{font-size:14px;font-weight:500}.variant button{background:none;border:0;color:#2563eb}.history{opacity:.8}.notice,.empty{padding:12px;font-size:13px;opacity:.8}.new-detail{padding:14px 0}.documents{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px}.source{display:block;width:100%;border:0;border-radius:7px;background:none;text-align:left;padding:12px;overflow-wrap:anywhere}.source.selected{background:#2563eb14}.source b{font-size:13px;font-weight:500}.reader{min-width:0}.reader header{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;font-size:13px}.page{position:relative;margin:8px auto;background:#f0f1f4;line-height:0;max-width:900px}.page img{display:block;width:100%;height:auto}.box{position:absolute;border:2px solid #2563eb;background:#2563eb25;border-radius:3px;pointer-events:none;box-sizing:border-box}.pager{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;margin:8px 0}.file-action input{display:block;max-width:200px;font-size:12px;margin-top:5px}.document-details{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:4px}.document-details button{border:0;border-radius:6px;background:none;text-align:left;padding:10px;overflow-wrap:anywhere}.document-details button:hover{background:#2563eb12}.document-details small,.document-details b{display:block}.document-details small{opacity:.7;font-size:11px}.document-details b{font-weight:500;font-size:13px}@media(max-width:620px){.documents{grid-template-columns:1fr}.documents aside{display:flex;overflow-x:auto}.source{min-width:150px}.reader header b{overflow-wrap:anywhere}}
  `, `.page canvas{display:block;width:100%;height:auto}.pending{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;font-size:13px}.pending button{border:0;background:none;color:var(--vk-blue,#2563eb)}.document-detail{position:relative;display:flex;align-items:center}.document-detail>button{flex:1;min-width:0}.document-detail>details{flex-shrink:0}`],
})
export class ProfileComponent implements OnDestroy {
  readonly cipher = input.required<CipherView>();
  readonly initialSourceId = input<string | null>(null);
  readonly initialVariantId = input<string | null>(null);
  private readonly profiles = new ProfileService(
    inject(AccountService),
    inject(CipherService),
    inject(LocalVaultService, { optional: true }),
    inject(CipherSdkService),
  );
  private readonly platform = inject(PlatformUtilsService);
  readonly actions = inject<ProfileDocumentActions | null>(PROFILE_DOCUMENT_ACTIONS, { optional: true });
  readonly current = signal<CipherView | null>(null);
  readonly meta = computed(() => this.current() ? readEnvelope(this.current()!) : null);
  readonly editable = computed(() => !!this.current()?.edit && !this.current()?.isDeleted);
  readonly visibleDetails = computed(() => this.meta()?.details.filter((detail) => detail.valueType !== "secret" || this.current()?.viewPassword !== false) ?? []);
  readonly tab = signal<"details" | "documents">("details");
  readonly expanded = signal<string | null>(null);
  readonly editing = signal<{ detailId: string; variantId: string } | null>(null);
  readonly correction = signal("");
  readonly error = signal("");
  readonly message = signal("");
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly selectedSource = signal<ProfileSource | null>(null);
  readonly selectedLocator = signal<Locator | null>(null);
  readonly pageBox = computed(() => { const locator = this.selectedLocator(); return locator?.kind === "page" && locator.page === this.page() && locator.w > 0 && locator.h > 0 ? locator : null; });
  readonly preview = signal("");
  readonly pdfVisible = signal(false);
  readonly operations = signal<{ id: string; kind: "capture" | "move" | "delete"; fileName: string }[]>([]);
  readonly page = signal(0);
  readonly pageCount = signal(1);
  readonly destinations = signal<CipherView[]>([]);
  readonly destinationId = signal("");
  readonly documentDetails = computed(() => this.visibleDetails().flatMap((detail) => [...detail.variants, ...detail.history.map((entry) => entry.variant)].filter((variant) => variant.sourceId === this.selectedSource()?.id).map((variant) => ({ detail, variant }))));
  newLabel = "";
  newValue = "";
  newType: ValueType = "text";
  private pdf: PDFDocumentProxy | null = null;
  private pdfLoading: PDFDocumentLoadingTask | null = null;
  private rendering: RenderTask | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private objectUrl: string | null = null;
  private readonly downloads = new Set<string>();
  private generation = 0;
  private renderGeneration = 0;
  private inputEpoch = 0;
  private original: Uint8Array | null = null;

  @ViewChild("pdfCanvas") set pdfCanvas(element: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvas = element?.nativeElement ?? null;
    if (this.canvas != null && this.pdf != null) { void this.renderPage(this.page()); }
  }

  constructor() {
    effect(() => {
      const cipher = this.cipher();
      const sourceId = this.initialSourceId();
      const variantId = this.initialVariantId();
      untracked(() => {
        this.inputEpoch++;
        this.current.set(cipher);
        this.resetReader();
        this.busy.set(false);
        this.error.set("");
        this.message.set("");
        this.expanded.set(null);
        this.editing.set(null);
        this.tab.set("details");
        const meta = readEnvelope(cipher);
        const variant = meta?.details.flatMap((detail) => [...detail.variants, ...detail.history.map((entry) => entry.variant)]).find((entry) => entry.id === variantId);
        const source = meta?.sources.find((entry) => entry.id === (sourceId ?? variant?.sourceId));
        if (source != null) { void this.openSource(source, variant?.locator ?? null); }
        void this.refreshOperations();
      });
    });
  }

  ngOnDestroy(): void {
    this.inputEpoch++;
    this.resetReader();
    for (const url of this.downloads) { URL.revokeObjectURL(url); }
    this.downloads.clear();
  }
  winner(detail: ProfileDetail): DetailVariant | null { return this.meta() ? resolveDetailVariant(this.meta()!, detail) : null; }
  rule = agentRuleOf;
  sourceName(variant: DetailVariant): string {
    const source = this.meta()?.sources.find((entry) => entry.id === variant.sourceId);
    return source == null ? "Entered by hand" : source.status === "deleted" ? `${source.fileName} (deleted)` : source.fileName;
  }
  copy(detail: ProfileDetail, variant: DetailVariant): void {
    if (detail.valueType === "secret" && this.current()?.viewPassword === false) { return; }
    this.platform.copyToClipboard(variant.value);
    this.message.set(`Copied ${detail.label}`);
  }
  beginEdit(detail: ProfileDetail, variant: DetailVariant): void { this.editing.set({ detailId: detail.id, variantId: variant.id }); this.correction.set(variant.value); }
  async saveCorrection(): Promise<void> { const editing = this.editing(); if (editing) { await this.edit({ kind: "correct", ...editing, value: this.correction() }); } }
  async add(): Promise<void> { if (await this.edit({ kind: "add", label: this.newLabel, value: this.newValue, valueType: this.newType })) { this.newLabel = ""; this.newValue = ""; } }
  async deleteDetail(detail: ProfileDetail): Promise<void> { if (window.confirm(`Delete ${detail.label}? Its saved values and history will be removed.`)) { await this.edit({ kind: "delete", detailId: detail.id }); } }
  async edit(edit: ProfileDetailEdit): Promise<boolean> {
    if (this.busy() || !this.editable()) { return false; }
    const epoch = this.inputEpoch;
    const id = this.current()!.id;
    this.busy.set(true); this.error.set(""); this.message.set("");
    try {
      const updated = await this.profiles.edit(id, edit);
      if (epoch !== this.inputEpoch) { return false; }
      this.current.set(updated); this.editing.set(null); this.message.set("Saved"); return true;
    } catch (error) {
      if (epoch === this.inputEpoch) { this.error.set(error instanceof Error ? error.message : String(error)); }
      return false;
    } finally { if (epoch === this.inputEpoch) { this.busy.set(false); } }
  }
  async show(variant: DetailVariant): Promise<void> {
    const source = this.meta()?.sources.find((entry) => entry.id === variant.sourceId);
    if (source) { await this.openSource(source, variant.locator); }
  }
  private resetReader(): void {
    this.generation++; this.renderGeneration++;
    this.rendering?.cancel(); this.rendering = null;
    const loading = this.pdfLoading; this.pdfLoading = null;
    this.pdf = null;
    if (loading != null) { void loading.destroy(); }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.original = null; this.preview.set(""); this.pdfVisible.set(false); this.loading.set(false);
    this.selectedSource.set(null); this.selectedLocator.set(null); this.pageCount.set(1); this.page.set(0);
  }
  async openSource(source: ProfileSource, locator: Locator | null = null): Promise<void> {
    this.resetReader(); this.tab.set("documents"); this.selectedSource.set(source); this.selectedLocator.set(locator); this.error.set(""); this.destinations.set([]);
    if (source.status === "deleted" || source.attachmentId == null) { return; }
    const generation = this.generation; this.loading.set(true);
    try {
      const bytes = await this.profiles.bytes(this.current()!.id, source.id);
      if (generation !== this.generation) { return; }
      this.original = bytes;
      if (source.mediaType === "application/pdf" || /\.pdf$/i.test(source.fileName)) {
        const resources = new URL("pdfjs/", document.baseURI).href;
        const loading = getDocument({
          data: bytes.slice(),
          cMapUrl: `${resources}cmaps/`,
          standardFontDataUrl: `${resources}standard_fonts/`,
          wasmUrl: `${resources}wasm/`,
          iccUrl: `${resources}iccs/`,
        });
        this.pdfLoading = loading;
        const pdf = await loading.promise;
        if (generation !== this.generation) { await loading.destroy(); return; }
        this.pdf = pdf; this.pageCount.set(pdf.numPages);
        this.page.set(Math.max(0, Math.min(locator?.page ?? 0, pdf.numPages - 1)));
        this.pdfVisible.set(true);
        if (this.canvas != null) { await this.renderPage(this.page()); }
      } else if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(source.mediaType)) {
        this.objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: source.mediaType }));
        this.preview.set(this.objectUrl);
      }
    } catch (error) { if (generation === this.generation) { this.error.set(error instanceof Error ? error.message : String(error)); } }
    finally { if (generation === this.generation) { this.loading.set(false); } }
  }
  async renderPage(index: number): Promise<void> {
    const pdf = this.pdf;
    const canvas = this.canvas;
    if (pdf == null || canvas == null || index < 0 || index >= pdf.numPages) { return; }
    const generation = this.generation;
    const renderGeneration = ++this.renderGeneration;
    this.rendering?.cancel(); this.rendering = null;
    this.loading.set(true); this.page.set(index); this.error.set("");
    try {
      const page = await pdf.getPage(index + 1);
      if (generation !== this.generation || renderGeneration !== this.renderGeneration) { return; }
      const viewport = page.getViewport({ scale: Math.min(window.devicePixelRatio || 1, 2) * 1.5 });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext("2d");
      if (canvasContext == null) { throw new Error("The document preview is unavailable."); }
      const rendering = page.render({ canvasContext, canvas, viewport });
      this.rendering = rendering;
      await rendering.promise;
      page.cleanup();
    } catch (error) {
      if (generation === this.generation && renderGeneration === this.renderGeneration) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === this.generation && renderGeneration === this.renderGeneration) { this.rendering = null; this.loading.set(false); }
    }
  }
  async locate(variant: DetailVariant): Promise<void> { this.selectedLocator.set(variant.locator); if (this.pdf && variant.locator) { await this.renderPage(variant.locator.page); } }
  download(): void {
    const source = this.selectedSource(); if (this.original == null || source == null) { return; }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(this.original).buffer], { type: source.mediaType }));
    this.downloads.add(url);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = source.fileName; anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); this.downloads.delete(url); }, 1000);
  }
  async pickDestination(): Promise<void> { try { this.destinations.set((await this.actions!.profiles()).filter((profile) => profile.id !== this.current()!.id && profile.edit)); } catch (error) { this.error.set(String(error)); } }
  async removeSource(): Promise<void> {
    const source = this.selectedSource(); if (!this.actions || !source || !window.confirm(`Delete ${source.fileName}? Its saved details and history will stay.`)) { return; }
    await this.documentAction(() => this.actions!.remove(this.current()!.id, source.id));
  }
  async move(): Promise<void> {
    const source = this.selectedSource(); if (!this.actions || !source || !this.destinationId()) { return; }
    const originId = this.current()!.id;
    await this.documentAction(async () => { await this.actions!.move(originId, source.id, this.destinationId()); return this.profiles.load(originId); });
  }
  async replace(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; const source = this.selectedSource();
    if (!file || !source || !this.actions) { return; }
    await this.documentAction(() => this.actions!.replace(this.current()!.id, source.id, file)); input.value = "";
  }
  private async documentAction(action: () => Promise<CipherView | null>): Promise<void> {
    if (this.busy()) { return; }
    const epoch = this.inputEpoch;
    this.busy.set(true); this.error.set("");
    try {
      const updated = await action();
      if (epoch === this.inputEpoch && updated) { this.current.set(updated); this.resetReader(); this.message.set("Saved"); }
    } catch (error) {
      if (epoch === this.inputEpoch) { this.error.set(error instanceof Error ? error.message : String(error)); }
    } finally {
      if (epoch === this.inputEpoch) { this.busy.set(false); await this.refreshOperations(); }
    }
  }
  private async refreshOperations(): Promise<void> {
    const epoch = this.inputEpoch;
    try {
      const operations = await this.actions?.pending?.() ?? [];
      if (epoch === this.inputEpoch) { this.operations.set(operations.filter((operation) => operation.profileId === this.current()?.id)); }
    } catch (error) { if (epoch === this.inputEpoch) { this.error.set(error instanceof Error ? error.message : String(error)); } }
  }
  async retry(id: string): Promise<void> {
    const profileId = this.current()!.id;
    if (this.actions?.retry != null) {
      await this.documentAction(async () => { await this.actions!.retry!(id); return this.profiles.load(profileId); });
    }
  }
}
