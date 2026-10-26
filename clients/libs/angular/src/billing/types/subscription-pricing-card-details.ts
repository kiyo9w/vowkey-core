import { VowkeyIcon, ButtonType } from "@vowkey/components";

export type SubscriptionPricingCardDetails = {
  title: string;
  tagline: string;
  price?: {
    amount: number;
    cadence: "month" | "monthly" | "year" | "annually";
    showPerUser?: boolean;
  };
  button: {
    text: string;
    type: ButtonType;
    icon?: { type: VowkeyIcon; position: "before" | "after" };
  };
  features: string[];
};
