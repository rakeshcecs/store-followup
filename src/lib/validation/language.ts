import { z } from "zod";
import { locales } from "@/i18n/config";

// No custom message key: the value only ever comes from a fixed three-item control,
// so the generic errors.validation is the honest fallback.
export const setLanguageInput = z.object({ language: z.enum(locales) });
