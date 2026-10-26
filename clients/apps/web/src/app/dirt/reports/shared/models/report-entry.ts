import { BitSvg } from "@vowkey/assets/svg";

import { ReportVariant } from "./report-variant";

export type ReportEntry = {
  title: string;
  description: string;
  route: string;
  icon: BitSvg;
  variant: ReportVariant;
};
