// M19: the Server Actions the forms call, each able to fall back to the phone's outbox.
// What comes back offline stands in for the server's answer: the ids are the clientIds,
// which the sync turns into real ids, so the next screen can already use them.
import { createCustomer } from "@/lib/actions/customer";
import { recordFollowUpResult, setFollowUp } from "@/lib/actions/follow-up";
import { recordSale } from "@/lib/actions/sale";
import { recordVisit } from "@/lib/actions/visit";
import { offlineAware } from "@/lib/offline/submit";

export const saveCustomer = offlineAware("customer", createCustomer, (input, id) => ({
  id,
  name: String(input["name"]),
}));

export const saveVisit = offlineAware("visit", recordVisit, (input, id) => ({
  visitId: id,
  customerId: String(input["customerId"]),
}));

export const saveFollowUp = offlineAware("followUp", setFollowUp, (_input, id) => ({
  followUpId: id,
}));

export const saveFollowUpResult = offlineAware("result", recordFollowUpResult, (input) => ({
  followUpId: String(input["id"]),
  nextFollowUpId: input["result"] === "NOT_INTERESTED" ? null : String(input["clientId"]),
}));

export const saveSale = offlineAware("sale", recordSale, (input, id) => ({
  saleId: id,
  billNumber: String((input["sale"] as Record<string, unknown>)["billNumber"]),
}));
