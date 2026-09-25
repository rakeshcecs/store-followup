// What a template placeholder can be filled with (M22: first name, store name, branch,
// visit date, bill number — plus the full name and the occasion). No imports: the
// settings screen and the validation schema use it in the browser too.
export const TEMPLATE_FIELDS = [
  "customerFirstName",
  "customerName",
  "storeName",
  "branchName",
  "visitDate",
  "billNumber",
  "occasion",
] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];
export type TemplateMapping = Record<string, TemplateField>;

// M23: what a campaign can fill a placeholder with per customer. No visit date or bill
// number — a campaign goes to hundreds of people who have no one follow-up or sale in
// common; the rest is typed once as a fixed text ("20% off till Sunday").
export const CAMPAIGN_FIELDS = [
  "customerFirstName",
  "customerName",
  "storeName",
  "branchName",
  "occasion",
] as const satisfies readonly TemplateField[];
export type CampaignField = (typeof CAMPAIGN_FIELDS)[number];

export type CampaignVariable =
  { kind: "text"; text: string } | { kind: "field"; field: CampaignField };
export type CampaignVariables = Record<string, CampaignVariable>;
