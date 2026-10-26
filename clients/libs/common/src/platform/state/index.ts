import { StateUpdateOptions as RequiredStateUpdateOptions } from "@vowkey/state";

export * from "@vowkey/state";
export { ActiveUserAccessor } from "@vowkey/state-internal";

export type StateUpdateOptions<T, TCombine> = Partial<RequiredStateUpdateOptions<T, TCombine>>;
